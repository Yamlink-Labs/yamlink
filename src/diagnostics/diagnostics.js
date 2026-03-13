const vscode = require('vscode');
const { isKnownType } = require('../registries/typeRegistry');
const { hasSchema, getSchema, getDuplicateSchemas } = require('../registries/schemaRegistry');
const { getDuplicateIds, getFieldsCache } = require('../core/index');
const { getBacklinks } = require('../core/graph');
const { computeSuggestionsForNode, QUERY_SUGGESTION_THRESHOLD } = require('../engine/suggestions');


const MIN_VAULT_SIZE_FOR_TYPE_ADVISORY = 10;

let diagnosticCollection;
let debounceTimer;

function registerDiagnostics(context, getIndex) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection("yamlink");
    context.subscriptions.push(diagnosticCollection);

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                validateDocument(event.document, getIndex);
            }, 500);
        })
    );

    // Re-validate whenever the user focuses a file.
    // onDidOpenTextDocument is unreliable for tab-switches on already-open
    // documents — it may not fire, or it may fire before the index is warm.
    // onDidChangeActiveTextEditor fires on every switch, always after the
    // previous editor's index state is settled, making it the right place
    // to refresh querySuggestion diagnostics (which read live backlink data).
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && editor.document.languageId === 'markdown') {
                validateDocument(editor.document, getIndex);
                // Second pass after 50ms: the graph index may not have fully
                // settled on the first tick (especially if the file was just
                // indexed). The 50ms delay costs nothing and ensures
                // querySuggestion diagnostics see fresh backlink counts.
                setTimeout(() => validateDocument(editor.document, getIndex), 50);
            }
        })
    );

    // onDidOpenTextDocument: useful for files opened cold (not yet in any
    // tab). Debounce 300ms so it doesn't race with a concurrent index build.
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((doc) => {
            if (doc.languageId !== 'markdown') return;
            setTimeout(() => validateDocument(doc, getIndex), 300);
        })
    );

    // Initial pass — delay long enough for buildIndex + graph to be warm.
    // 500ms was too short on slower machines; 1500ms covers most vaults.
    setTimeout(() => {
        vscode.workspace.textDocuments.forEach((doc) => {
            validateDocument(doc, getIndex);
        });
    }, 1500);
}

function validateAll(getIndex) {
    vscode.workspace.textDocuments.forEach((doc) => {
        if (doc.languageId === 'markdown') {
            validateDocument(doc, getIndex);
        }
    });
}

// Wipes all diagnostics across all files.
// Called in rebuildAll() before validateAll() so stale diagnostics
// from deleted or renamed files never linger in the status bar count.
function clearAll() {
    if (diagnosticCollection) diagnosticCollection.clear();
}

function validateDocument(document, getIndex) {
    if (document.languageId !== 'markdown') return;
    if (!diagnosticCollection) return;

    const diagnostics = [];
    const text        = document.getText();
    const idIndex     = getIndex();

    // ─────────────────────────────────────────────
    // Diagnostic 1: Missing id field
    // ─────────────────────────────────────────────
    const hasFrontmatter = /^\s*---/.test(text);
    const hasId          = /^\s*id:\s*.+/m.test(text);

    if (!hasFrontmatter || !hasId) {
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
            `Yamlink: This file has no id field and will not be indexed as a node.`,
            vscode.DiagnosticSeverity.Hint
        );
        diagnostic.source = "yamlink";
        diagnostic.code   = "yamlink.missingId";
        diagnostics.push(diagnostic);
    }

    // ─────────────────────────────────────────────
    // Diagnostic 1b: Duplicate id
    // ─────────────────────────────────────────────
    if (hasFrontmatter && hasId) {
        const idMatch = text.match(/^\s*id:\s*([a-zA-Z0-9_-]+)\s*$/m);
        if (idMatch) {
            const thisId     = idMatch[1].trim();
            const duplicates = getDuplicateIds();
            if (duplicates.has(thisId)) {
                const idLineIndex = text
                    .split('\n')
                    .findIndex(line => /^\s*id:\s*.+/.test(line));
                const range = idLineIndex !== -1
                    ? document.lineAt(idLineIndex).range
                    : new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
                const conflictPaths = duplicates.get(thisId)
                    .map(p => p.split(/[\\/]/).pop())
                    .join(', ');
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Yamlink: id "${thisId}" is declared in multiple files: ${conflictPaths}`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = "yamlink";
                diagnostic.code   = "yamlink.duplicateId";
                diagnostics.push(diagnostic);
            }
        }
    }

    // ─────────────────────────────────────────────
    // Diagnostic 2: Broken [[links]]
    // ─────────────────────────────────────────────
    let frontmatterEnd = 0;
    if (hasFrontmatter) {
        const firstDash = text.indexOf('---');
        const closing   = text.indexOf('---', firstDash + 3);
        if (closing !== -1) frontmatterEnd = closing + 3;
    }

    const linkRegex = /\[\[([^\]]+)\]\]/g;
    let match;

    while ((match = linkRegex.exec(text)) !== null) {
        const id              = match[1].trim();
        const isInFrontmatter = frontmatterEnd > 0 && match.index < frontmatterEnd;

        if (!idIndex.has(id)) {
            const range = new vscode.Range(
                document.positionAt(match.index),
                document.positionAt(match.index + match[0].length)
            );
            const diagnostic = new vscode.Diagnostic(
                range,
                isInFrontmatter
                    ? `Yamlink: Relation "${id}" does not exist.`
                    : `Yamlink: ID "${id}" does not exist.`,
                vscode.DiagnosticSeverity.Warning
            );
            diagnostic.source = "yamlink";
            diagnostic.code   = isInFrontmatter
                ? "yamlink.brokenRelation"
                : "yamlink.brokenLink";
            diagnostics.push(diagnostic);
        }
    }

    // ─────────────────────────────────────────────
    // Diagnostic 3: Unknown type advisory
    // ─────────────────────────────────────────────
    if (hasFrontmatter && idIndex.size >= MIN_VAULT_SIZE_FOR_TYPE_ADVISORY) {
        const typeMatch = text.match(/^\s*type:\s*(.+?)\s*$/m);
        if (typeMatch) {
            const typeValue     = typeMatch[1].trim();
            const typeLineIndex = text
                .split('\n')
                .findIndex(line => /^\s*type:\s*.+/.test(line));

            if (typeLineIndex !== -1 && !isKnownType(typeValue)) {
                const range = document.lineAt(typeLineIndex).range;
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Yamlink: Type "${typeValue}" is not used by any other node yet.`,
                    vscode.DiagnosticSeverity.Information
                );
                diagnostic.source = "yamlink";
                diagnostic.code   = "yamlink.unknownType";
                diagnostics.push(diagnostic);
            }
        }
    }

    // ─────────────────────────────────────────────
    // Diagnostic 4: Missing required schema fields
    // ─────────────────────────────────────────────
    if (hasFrontmatter && hasId) {
        const typeMatch = text.match(/^\s*type:\s*(.+?)\s*$/m);
        if (typeMatch) {
            const typeValue = typeMatch[1].trim();
            if (hasSchema(typeValue)) {
                const schema = getSchema(typeValue);

                const firstDash    = text.indexOf('---');
                const closingIndex = text.indexOf('---', firstDash + 3);
                const fmText       = closingIndex !== -1
                    ? text.slice(firstDash + 3, closingIndex)
                    : '';

                const typeLineIndex = text
                    .split('\n')
                    .findIndex(l => /^\s*type:\s*.+/.test(l));

                for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
                    if (!fieldDef.required) continue;

                    const fieldPresent = new RegExp(
                        `^\\s*${fieldName}:\\s*.+`, 'm'
                    ).test(fmText);

                    if (!fieldPresent) {
                        const range = typeLineIndex !== -1
                            ? document.lineAt(typeLineIndex).range
                            : new vscode.Range(
                                new vscode.Position(0, 0),
                                new vscode.Position(0, 0)
                            );
                        const diagnostic = new vscode.Diagnostic(
                            range,
                            `Yamlink: Required field "${fieldName}" is missing` +
                            ` (schema: ${schema.sourceId})`,
                            vscode.DiagnosticSeverity.Warning
                        );
                        diagnostic.source = "yamlink";
                        diagnostic.code   = "yamlink.missingRequiredField";
                        diagnostics.push(diagnostic);
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────────
    // Diagnostic 5: Duplicate schema
    // ─────────────────────────────────────────────
    if (hasFrontmatter && hasId) {
        const isSchemaNode = /^\s*type:\s*schema\s*$/im.test(text);
        if (isSchemaNode) {
            const targetMatch = text.match(/^\s*target:\s*(.+?)\s*$/m);
            if (targetMatch) {
                const targetType = targetMatch[1].trim().toLowerCase();
                const dupSchemas = getDuplicateSchemas();
                if (dupSchemas.has(targetType)) {
                    const targetLineIndex = text
                        .split('\n')
                        .findIndex(l => /^\s*target:\s*.+/.test(l));
                    const range = targetLineIndex !== -1
                        ? document.lineAt(targetLineIndex).range
                        : new vscode.Range(
                            new vscode.Position(0, 0),
                            new vscode.Position(0, 0)
                        );
                    const canonical = dupSchemas.get(targetType)[0];
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Yamlink: A schema for "${targetType}" already exists` +
                        ` in "${canonical}" — this schema will be ignored.`,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = "yamlink";
                    diagnostic.code   = "yamlink.duplicateSchema";
                    diagnostics.push(diagnostic);
                }
            }
        }
    }

    // ─────────────────────────────────────────────
    // Diagnostic 6: Query suggestion available
    //
    // Computed via the shared suggestions engine so diagnostics and
    // codeActions never disagree. Range covers the full frontmatter
    // so the lightbulb is visible wherever the cursor rests in the header.
    // ─────────────────────────────────────────────
    if (hasFrontmatter && hasId) {
        const idMatch = text.match(/^\s*id:\s*([a-zA-Z0-9_-]+)\s*$/m);
        if (idMatch) {
            const thisId      = idMatch[1].trim();
            const suggestions = computeSuggestionsForNode(thisId, text);
            const fullRange   = new vscode.Range(
                new vscode.Position(0, 0),
                new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length)
            );

            if (suggestions.length > 0) {
                const diagnostic = new vscode.Diagnostic(
                    fullRange,
                    suggestions.length === 1
                        ? `Yamlink: ${suggestions[0].count} ${suggestions[0].sourceType}s linked via "${suggestions[0].field}" — click 💡 to insert a view`
                        : `Yamlink: ${suggestions.length} view suggestions available — click 💡 to insert`,
                    vscode.DiagnosticSeverity.Hint
                );
                diagnostic.source = 'yamlink';
                diagnostic.code   = 'yamlink.querySuggestion';
                diagnostics.push(diagnostic);
            } else {
                // Progressive hint: backlinks exist but threshold not yet met.
                // Shows in status bar via updateStatusBar, not as a squiggle.
                // We store the near-miss data on the collection so extension.js
                // can read it for the status bar "X more needed" message.
                const backlinks  = getBacklinks(thisId);
                const fCache     = getFieldsCache();
                const groups     = new Map();
                for (const { field, sourceId } of backlinks) {
                    if (field === 'body') continue;
                    const sf = fCache.get(sourceId);
                    if (!sf) continue;
                    const st = (sf.type || '').trim().toLowerCase();
                    if (!st) continue;
                    groups.set(`${field}\x00${st}`, (groups.get(`${field}\x00${st}`) || 0) + 1);
                }
                const best = [...groups.entries()].sort((a, b) => b[1] - a[1])[0];
                if (best && best[1] === QUERY_SUGGESTION_THRESHOLD - 1) {
                    const [field, sourceType] = best[0].split('\x00');
                    const hint = new vscode.Diagnostic(
                        new vscode.Range(0, 0, 0, 0),
                        `Yamlink: ${best[1]} ${sourceType}s linked via "${field}" — add 1 more to unlock a view suggestion`,
                        vscode.DiagnosticSeverity.Information
                    );
                    hint.source = 'yamlink';
                    hint.code   = 'yamlink.nearSuggestion';
                    diagnostics.push(hint);
                }
            }
        }
    }

    diagnosticCollection.set(document.uri, diagnostics);
}

function getBrokenCount() {
    if (!diagnosticCollection) return 0;
    let count = 0;
    diagnosticCollection.forEach((_uri, diags) => {
        count += diags.filter(d =>
            d.code === 'yamlink.brokenLink' || d.code === 'yamlink.brokenRelation'
        ).length;
    });
    return count;
}

module.exports = {
    registerDiagnostics,
    validateAll,
    validateDocument,
    clearAll,
    getBrokenCount
};