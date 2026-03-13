const vscode = require('vscode');
const { getTypes, getRegistry } = require('../registries/typeRegistry');
const { getSchema } = require('../registries/schemaRegistry');
const { getEdges } = require('../core/graph');

// ─────────────────────────────────────────────────────────────────
// completion.js
//
// Two registered providers:
//
//   Provider A — trigger chars ['[', ':']
//     Branch 1: [[wikilink]] with relation-aware filtering
//     Branch 2: type: dropdown
//
//   Provider B — no trigger chars (fires on every keystroke via
//     quickSuggestions, or manually via Ctrl+Space)
//     Branch 3: YAML field name suggestions from schema
//
// Splitting into two providers is required because wikilink/type
// completions need specific trigger chars, while field name
// suggestions need to fire while typing plain letters.
// ─────────────────────────────────────────────────────────────────

const INFERENCE_CONFIDENCE = 0.6;

// ─────────────────────────────────────────────────────────────────
// isPositionInFrontmatter
//
// Returns true when lineIndex is strictly between the opening ---
// and closing --- of YAML frontmatter.
//
// Scans for exactly two --- lines. The opening must be line 0
// (or first non-empty line). Any line in between is frontmatter.
// ─────────────────────────────────────────────────────────────────
function isPositionInFrontmatter(document, lineIndex) {
    const lines   = document.getText().split('\n');
    let openLine  = -1;
    let closeLine = -1;

    for (let i = 0; i < lines.length; i++) {
        if (/^---\s*$/.test(lines[i])) {
            if (openLine === -1) { openLine  = i; }
            else                 { closeLine = i; break; }
        }
    }

    if (openLine === -1 || closeLine === -1) return false;
    // lineIndex must be strictly between the two --- markers
    return lineIndex > openLine && lineIndex < closeLine;
}

function getDocumentType(document) {
    const match = document.getText().match(/^\s*type:\s*(.+?)\s*$/m);
    return match ? match[1].trim().toLowerCase() : null;
}

// ─────────────────────────────────────────────────────────────────
// inferTargetType
//
// Scans all outbound graph edges for a given field name.
// Returns the plurality target type if >= INFERENCE_CONFIDENCE
// of edges for that field point to it. Otherwise null.
// ─────────────────────────────────────────────────────────────────
function inferTargetType(fieldName, idIndex) {
    const registry = getRegistry();

    const idToType = new Map();
    for (const [type, ids] of registry.entries()) {
        for (const id of ids) idToType.set(id, type);
    }

    const typeCounts = new Map();
    let total = 0;

    for (const sourceId of idIndex.keys()) {
        const edges = getEdges(sourceId);
        for (const edge of edges) {
            if (edge.field.toLowerCase() !== fieldName.toLowerCase()) continue;
            const targetType = idToType.get(edge.targetId);
            if (!targetType) continue;
            typeCounts.set(targetType, (typeCounts.get(targetType) ?? 0) + 1);
            total++;
        }
    }

    if (total === 0) return null;

    let topType  = null;
    let topCount = 0;
    for (const [type, count] of typeCounts.entries()) {
        if (count > topCount) { topType = type; topCount = count; }
    }
    
    
    return (topCount / total) >= INFERENCE_CONFIDENCE ? topType : null;
}

function registerCompletion(context, getIndex) {

    // ── Provider A: wikilinks + type dropdown ──────────────────────
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'markdown',
            {
                provideCompletionItems(document, position) {
                    const line             = document.lineAt(position.line).text;
                    const textBeforeCursor = line.substring(0, position.character);

                    // ── Branch 1: [[wikilink]] ─────────────────────────────────
                    const wikiMatch = textBeforeCursor.match(/\[\[([^\]]*)$/);
                    if (wikiMatch) {
                        const idIndex         = getIndex();
                        const partial         = wikiMatch[1];
                        const bracketStart    = position.character - partial.length - 2;
                        const textAfterCursor = line.substring(position.character);
                        const hasClosing      = textAfterCursor.startsWith(']]');

                        const replaceRange = new vscode.Range(
                            new vscode.Position(position.line, bracketStart),
                            new vscode.Position(
                                position.line,
                                position.character + (hasClosing ? 2 : 0)
                            )
                        );

                        let candidateIds = Array.from(idIndex.keys());

                        // Only attempt relation filtering inside frontmatter
                        if (isPositionInFrontmatter(document, position.line)) {
                            // Extract field name from start of line e.g. "account: [[a"
                            const fieldNameMatch = line.match(/^([\w-]+):\s*\[\[/);

                            if (fieldNameMatch) {
                                const fieldName  = fieldNameMatch[1].toLowerCase();
                                let   targetType = null;

                                // Schema override (explicit, power user)
                                const docType  = getDocumentType(document);
                                const schema   = docType ? getSchema(docType) : null;
                                const fieldDef = schema?.fields?.[fieldName];
                                if (fieldDef?.type === 'relation' && fieldDef.target) {
                                    targetType = fieldDef.target.toLowerCase();
                                }

                                // Observational inference (no schema needed)
                                if (!targetType) {
                                    targetType = inferTargetType(fieldName, idIndex);
                                }

                                // Filter — only apply if it produces results.
                                // Never show an empty list.
                                if (targetType) {
                                    const typeNodes = getRegistry().get(targetType) ?? new Set();
                                    const filtered  = candidateIds.filter(id => typeNodes.has(id));
                                    if (filtered.length > 0) candidateIds = filtered;
                                }
                            }
                        }

                        return candidateIds
                            .filter(id => id.toLowerCase().startsWith(partial.toLowerCase()))
                            .map(id => {
                                const item = new vscode.CompletionItem(
                                    id,
                                    vscode.CompletionItemKind.Reference
                                );
                                item.insertText = `[[${id}]]`;
                                item.range      = replaceRange;
                                item.filterText = `[[${id}`;
                                item.sortText   = id;
                                item.detail     = idIndex.get(id);
                                return item;
                            });
                    }

                    // ── Branch 2: type: dropdown ───────────────────────────────
                    const typeMatch = textBeforeCursor.match(/^type:\s*(\S*)$/);
                    if (typeMatch) {
                        const knownTypes = [...getTypes()];
                        if (knownTypes.length === 0) return undefined;

                        return knownTypes.map(t => {
                            const item = new vscode.CompletionItem(
                                t,
                                vscode.CompletionItemKind.EnumMember
                            );
                            item.detail     = 'Type used in vault';
                            item.insertText = t;
                            item.sortText   = t;
                            return item;
                        });
                    }

                    return undefined;
                }
            },
            '[', ':'
        )
    );

    // ── Provider B: YAML field name suggestions ────────────────────
    //
    // Registered without trigger characters so it fires while the
    // user types plain letters inside frontmatter.
    //
    // Activates when:
    //   - cursor is inside frontmatter
    //   - current line contains only a partial key (no colon yet)
    //   - document type has a schema
    //
    // Silently absent when no schema exists for this doc's type.
    //
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'markdown',
            {
                provideCompletionItems(document, position) {
                    if (!isPositionInFrontmatter(document, position.line)) {
                        return undefined;
                    }

                    const line    = document.lineAt(position.line).text;
                    const trimmed = line.trimStart();

                    // Only fire when typing a key — line has no colon yet
                    const keyMatch = trimmed.match(/^([\w-]*)$/);
                    if (!keyMatch) return undefined;

                    const docType = getDocumentType(document);
                    if (!docType) return undefined;

                    const schema = getSchema(docType);
                    if (!schema) return undefined;

                    const fields = Object.entries(schema.fields || {});
                    if (fields.length === 0) return undefined;

                    // Required fields first, then alphabetical
                    fields.sort((a, b) => {
                        const reqA = a[1].required ? 0 : 1;
                        const reqB = b[1].required ? 0 : 1;
                        if (reqA !== reqB) return reqA - reqB;
                        return a[0].localeCompare(b[0]);
                    });

                    const partialKey = keyMatch[1].toLowerCase();

                    return fields
                        .filter(([key]) => key.toLowerCase().startsWith(partialKey))
                        .map(([key, def]) => {
                            const label = def.required ? `${key}*` : key;
                            const item  = new vscode.CompletionItem(
                                label,
                                vscode.CompletionItemKind.Field
                            );
                            item.detail   = `${def.type}${def.required ? ' (required)' : ''}`;
                            item.sortText = def.required ? `0${key}` : `1${key}`;

                            if (def.type === 'relation') {
                                item.insertText = new vscode.SnippetString(`${key}: [[\${1}]]`);
                            } else {
                                item.insertText = `${key}: `;
                            }

                            return item;
                        });
                }
            }
            // No trigger characters — fires on letter typing
        )
    );
}

module.exports = { registerCompletion };