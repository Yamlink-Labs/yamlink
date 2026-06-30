const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { isKnownType } = require('../registries/typeRegistry');
const { hasSchema, getSchema, getDuplicateSchemas } = require('../registries/schemaRegistry');
const { getDuplicateIds, getFieldsCache, getAliasIndex } = require('../core/indexService');
const { getBacklinks } = require('../core/graph');
const { computeSuggestionsForNode, QUERY_SUGGESTION_THRESHOLD } = require('../engine/suggestions');
const { extractCanonicalIdFromFrontmatter, resolveLinkedTarget } = require('../core/id');
const { getTemplateForType, extractTemplateFields, extractTemplateType, TEMPLATES_DIR } = require('../core/templateRegistry');
const { getPrimaryWorkspaceRoot } = require('../core/workspace');
const { initializeIgnoredDiagnostics, isDiagnosticIgnored } = require('./ignoredDiagnostics');
const { isSuppressed } = require('../core/suppressions');


const MIN_VAULT_SIZE_FOR_TYPE_ADVISORY = 10;

let diagnosticCollection;

function findFmClosingLine(text) {
    const lines = text.split('\n');
    let inFm = false;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].replace(/\r$/, '').trim();
        if (!inFm && trimmed === '---') { inFm = true; continue; }
        if (inFm && trimmed === '---') return i;
    }
    return -1;
}

/**
 * @param {import('vscode').ExtensionContext} context
 * @param {() => Map<string, string>} getIndex
 * @returns {void}
 */
function registerDiagnostics(context, getIndex) {
    let debounceTimer;
    initializeIgnoredDiagnostics(context);
    diagnosticCollection = vscode.languages.createDiagnosticCollection("yamlink");
    context.subscriptions.push(diagnosticCollection);

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                validateDocument(event.document, getIndex);
                // Template edited — re-validate all open notes so drift diagnostics
                // fire immediately. validateDocument reads from the open buffer, so
                // unsaved template changes are reflected without needing Ctrl+S.
                if (event.document.uri.fsPath.includes('_templates')) {
                    validateAll(getIndex);
                }
            }, 500);
        })
    );

    // When a template is saved, find ALL vault notes with that type that are
    // missing the new fields — open or closed — and offer to fix them all.
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((savedDoc) => {
            if (savedDoc.languageId !== 'markdown' || !savedDoc.uri.fsPath.includes('_templates')) return;
            validateAll(getIndex);

            const savedContent = savedDoc.getText();
            const savedType = extractTemplateType(savedContent);
            const savedFields = extractTemplateFields(savedContent);
            if (!savedType || !savedFields.length) return;

            // Use the index to find every note of this type, not just open tabs.
            const idIndex = getIndex();      // Map<noteId, filePath>
            const fieldsCache = getFieldsCache(); // Map<noteId, fields>
            const allDrifted = [];
            for (const [noteId, fields] of fieldsCache) {
                const noteType = String(fields?.type || '').trim().toLowerCase();
                if (noteType !== savedType) continue;
                const filePath = idIndex.get(noteId);
                if (!filePath || filePath.includes('_templates')) continue;
                const existingKeys = new Set(Object.keys(fields || {}).map(k => k.toLowerCase()));
                const missing = savedFields.filter(f => !existingKeys.has(f.toLowerCase()));
                if (missing.length > 0) allDrifted.push({ filePath, missing });
            }

            if (allDrifted.length === 0) return;

            const n = allDrifted.length;
            vscode.window.showInformationMessage(
                `Yamlink: Template "${savedType}" has new fields. Apply to ${n} note${n !== 1 ? 's' : ''}?`,
                'Apply', 'Later'
            ).then(async choice => {
                if (choice !== 'Apply') return;
                let fixed = 0;
                for (const { filePath, missing } of allDrifted) {
                    const openDoc = (vscode.workspace.textDocuments || []).find(
                        d => d.uri.fsPath === filePath
                    );
                    if (openDoc) {
                        const closingDash = findFmClosingLine(openDoc.getText());
                        if (closingDash === -1) continue;
                        const insertion = missing.map(f => `${f}:`).join('\n') + '\n';
                        const edit = new vscode.WorkspaceEdit();
                        edit.insert(openDoc.uri, new vscode.Position(closingDash, 0), insertion);
                        await vscode.workspace.applyEdit(edit);
                        await openDoc.save();
                    } else {
                        try {
                            const content = fs.readFileSync(filePath, 'utf8');
                            const closingDash = findFmClosingLine(content);
                            if (closingDash === -1) continue;
                            const lines = content.split('\n');
                            lines.splice(closingDash, 0, ...missing.map(f => `${f}:`));
                            fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
                        } catch (_) { continue; }
                    }
                    fixed++;
                }
                if (fixed > 0) {
                    validateAll(getIndex);
                    vscode.window.showInformationMessage(
                        `Yamlink: Added missing fields to ${fixed} note${fixed !== 1 ? 's' : ''}.`
                    );
                }
            });
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

/**
 * @param {() => Map<string, string>} getIndex
 * @returns {void}
 */
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
        const thisId = extractCanonicalIdFromFrontmatter(text);
        if (thisId) {
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
    const aliasIndex = getAliasIndex();
    let match;

    while ((match = linkRegex.exec(text)) !== null) {
        const rawTarget       = match[1].trim();
        const id              = rawTarget.split('|')[0].trim();
        const isInFrontmatter = frontmatterEnd > 0 && match.index < frontmatterEnd;

        if (!resolveLinkedTarget(rawTarget, idIndex, aliasIndex)) {
            const range = new vscode.Range(
                document.positionAt(match.index),
                document.positionAt(match.index + match[0].length)
            );
            const diagnostic = new vscode.Diagnostic(
                range,
                isInFrontmatter
                    ? `Yamlink: Relation "${id}" does not exist.`
                    : `Yamlink: ID "${id}" does not exist.`,
                vscode.DiagnosticSeverity.Hint
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
    // Diagnostic 5: Duplicate schema / malformed schema
    // ─────────────────────────────────────────────
    if (hasFrontmatter && hasId) {
        const isSchemaNode = /^\s*type:\s*schema\s*$/im.test(text);
        if (isSchemaNode) {
            const targetMatch = text.match(/^\s*target:\s*(.+?)\s*$/m);
            if (!targetMatch) {
                const typeLine = text.split('\n').findIndex(l => /^\s*type:\s*schema\s*$/i.test(l));
                const range = typeLine !== -1
                    ? document.lineAt(typeLine).range
                    : new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Yamlink: Schema node is missing a "target:" field — add "target: <type>" to define which type this schema applies to.`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'yamlink';
                diagnostic.code   = 'yamlink.malformedSchema';
                diagnostics.push(diagnostic);
            } else {
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
    // codeActions never disagree. Anchor the hint to the id line so
    // quick-fix does not select the whole document when invoked.
    // ─────────────────────────────────────────────
    if (hasFrontmatter && hasId) {
        const thisId = extractCanonicalIdFromFrontmatter(text);
        if (thisId) {
            const suggestions = computeSuggestionsForNode(thisId, text);
            const lines = text.split('\n');
            const idLineIndex = lines.findIndex(line => /^\s*id\s*:/.test(line));
            const anchorLine = idLineIndex >= 0 ? idLineIndex : 0;
            const anchorText = lines[anchorLine] || '';
            const anchorRange = new vscode.Range(
                new vscode.Position(anchorLine, 0),
                new vscode.Position(anchorLine, anchorText.length)
            );

            if (suggestions.length > 0 && !isSuppressed(thisId, 'querySuggestion')) {
                const top = suggestions[0];
                const diagnostic = new vscode.Diagnostic(
                    anchorRange,
                    suggestions.length === 1
                        ? `Yamlink: ${top.title} — click 💡 to insert`
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
                        `Yamlink: ${best[1]} ${best[1] === 1 ? sourceType : sourceType + 's'} linked via "${field}" — add 1 more to unlock a view suggestion`,
                        vscode.DiagnosticSeverity.Information
                    );
                    hint.source = 'yamlink';
                    hint.code   = 'yamlink.nearSuggestion';
                    diagnostics.push(hint);
                }
            }
        }
    }

    // ─────────────────────────────────────────────
    // Diagnostic 7: Template drift
    // Fires when a note's type has a _templates/ file and the note is
    // missing one or more of its field keys.
    // Guard: only fire when frontmatter is fully closed (has opening AND
    // closing ---), so the insert command always has a valid insertion point.
    // ─────────────────────────────────────────────
    const firstDashIdx = text.indexOf('---');
    const closingDashIdx = firstDashIdx !== -1 ? text.indexOf('---', firstDashIdx + 3) : -1;
    const hasClosedFrontmatter = hasFrontmatter && closingDashIdx !== -1;
    if (hasClosedFrontmatter && hasId) {
        const typeMatch = text.match(/^\s*type:\s*(.+?)\s*$/m);
        if (typeMatch) {
            const typeValue = typeMatch[1].trim().toLowerCase();
            const SKIP_TYPES = new Set(['schema', 'dashboard', 'template']);
            if (!SKIP_TYPES.has(typeValue)) {
                const root = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
                if (root) {
                    // Prefer the open buffer for the template file so that edits
                    // to the template tab are reflected before the user saves.
                    const templateFilePath = path.join(root, TEMPLATES_DIR, typeValue + '.md');
                    const openTpl = (vscode.workspace.textDocuments || []).find(
                        d => d.uri.fsPath.toLowerCase() === templateFilePath.toLowerCase()
                    );
                    const templateFields = openTpl
                        ? extractTemplateFields(openTpl.getText())
                        : (getTemplateForType(root, typeValue)?.fields || null);

                    if (templateFields && templateFields.length > 0) {
                        const existingKeys = new Set(
                            [...text.matchAll(/^\s*([\w-]+):/gm)].map(m => m[1].toLowerCase())
                        );
                        const missing = templateFields.filter(f => !existingKeys.has(f.toLowerCase()));
                        if (missing.length > 0) {
                            const typeLineIndex = text.split('\n').findIndex(l => /^\s*type:\s*.+/.test(l));
                            const range = typeLineIndex !== -1
                                ? document.lineAt(typeLineIndex).range
                                : new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
                            const diagnostic = new vscode.Diagnostic(
                                range,
                                `Yamlink: Missing template fields: ${missing.join(', ')}`,
                                vscode.DiagnosticSeverity.Warning
                            );
                            diagnostic.source = 'yamlink';
                            diagnostic.code = 'yamlink.templateDrift';
                            diagnostics.push(diagnostic);
                        }
                    }
                }
            }
        }
    }

    diagnosticCollection.set(
        document.uri,
        diagnostics.filter((diagnostic) => !isDiagnosticIgnored(document, diagnostic))
    );
}

/** @returns {number} */
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
