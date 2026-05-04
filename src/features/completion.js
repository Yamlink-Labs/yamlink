'use strict';

const vscode = require('vscode');
const { getTypes } = require('../registries/typeRegistry');
const { getSchema } = require('../registries/schemaRegistry');
const {
    CLAUSE_KEYWORDS,
    SIMPLE_VIEW_TYPES,
    normalizeFrontmatterKey,
    isTypeLikeField,
    isPositionInFrontmatter,
    getDocumentType,
    extractFrontmatterFields,
    buildDocumentIntelligence,
    fieldLooksRelational,
    buildFieldInferenceDetail,
    buildRelationCandidateDetail,
    collectLocalLinkedIds,
    collectObservedRelationUsage,
    collectAdaptiveFrontmatterStarterSuggestions,
    resolveFrontmatterRelationCandidates,
    resolveQueryRelationCandidates,
    getViewBlockContext,
    collectFieldsForType,
    inferRelationField,
    collectScalarValues,
    collectObservedFrontmatterFields,
    collectRoleAlignedObservedFrontmatterFields,
    collectContextualObservedFrontmatterFields,
    collectAdaptiveFrontmatterFieldSuggestions,
    collectSchemaAdaptiveGapSuggestions,
    collectArchetypeFieldSuggestions,
    collectNoteRoleFieldSuggestions,
    scoreCandidateMatch,
    scoreFieldSuggestion,
    rankCandidateIds
} = require('./completionHelpers');
const { inferTargetTypeFromFieldName } = require('../intelligence/fieldRoles');
const { summarizeNoteRoleReasons } = require('../intelligence/noteRolesCore');

function createItems(values, kind, detail) {
    return values.map(v => {
        const item = new vscode.CompletionItem(v, kind);
        if (detail) item.detail = detail;
        return item;
    });
}

function makeReplaceRange(document, position, prefixLength) {
    return new vscode.Range(
        new vscode.Position(position.line, Math.max(0, position.character - prefixLength)),
        position
    );
}

function registerCompletion(context, getIndex) {
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'markdown',
            {
                provideCompletionItems(document, position) {
                    const line = document.lineAt(position.line).text;
                    const textBeforeCursor = line.substring(0, position.character);

                    const idIndex = getIndex();
                    const frontmatterRelation = resolveFrontmatterRelationCandidates(document, position, idIndex);
                    if (frontmatterRelation) {
                        const valueStart = position.character - frontmatterRelation.partial.length - (frontmatterRelation.hasWiki ? 2 : 0);
                        const replaceRange = new vscode.Range(
                            new vscode.Position(position.line, Math.max(0, valueStart)),
                            new vscode.Position(position.line, position.character + (frontmatterRelation.hasClosing ? 2 : 0))
                        );
                        return rankCandidateIds(
                            frontmatterRelation.candidateIds,
                            frontmatterRelation.partial,
                            frontmatterRelation.preferredIds,
                            frontmatterRelation.localLinkedIds,
                            frontmatterRelation.observedIdScores
                        )
                            .map(id => {
                                const item = new vscode.CompletionItem(id, vscode.CompletionItemKind.Reference);
                                item.insertText = `[[${id}]]`;
                                item.range = replaceRange;
                                item.filterText = frontmatterRelation.hasWiki ? `[[${id}` : id;
                                const preferred = frontmatterRelation.preferredIds.includes(id);
                                item.detail = buildRelationCandidateDetail(id, idIndex, frontmatterRelation, preferred);
                                return item;
                            });
                    }

                    const wikiMatch = textBeforeCursor.match(/\[\[([^\]]*)$/);
                    if (wikiMatch) {
                        const partial = wikiMatch[1];
                        const bracketStart = position.character - partial.length - 2;
                        const textAfterCursor = line.substring(position.character);
                        const hasClosing = textAfterCursor.startsWith(']]');
                        const replaceRange = new vscode.Range(
                            new vscode.Position(position.line, bracketStart),
                            new vscode.Position(position.line, position.character + (hasClosing ? 2 : 0))
                        );

                        let candidateIds = Array.from(idIndex.keys());
                        return rankCandidateIds(candidateIds, partial)
                            .map(id => {
                                const item = new vscode.CompletionItem(id, vscode.CompletionItemKind.Reference);
                                item.insertText = `[[${id}]]`;
                                item.range = replaceRange;
                                item.filterText = `[[${id}`;
                                item.detail = idIndex.get(id);
                                return item;
                            });
                    }

                    const typeMatch = textBeforeCursor.match(/^\s*([^:\n]+):\s*(\S*)$/);
                    if (typeMatch && isTypeLikeField(typeMatch[1])) {
                        return createItems([...getTypes()], vscode.CompletionItemKind.EnumMember, 'Type used in vault');
                    }

                    return undefined;
                }
            },
            '[', ':'
        )
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'markdown',
            {
                provideCompletionItems(document, position) {
                    if (!isPositionInFrontmatter(document, position.line)) return undefined;
                    const line = document.lineAt(position.line).text;
                    const trimmed = line.trimStart();
                    const keyMatch = trimmed.match(/^([^:\n]*)$/);
                    if (!keyMatch) return undefined;
                    const docType = getDocumentType(document);
                    const schema = getSchema(docType);
                    const partialKey = normalizeFrontmatterKey(keyMatch[1]);
                    const schemaFields = Object.entries(schema?.fields || {});

                    const observedFields = docType
                        ? collectObservedFrontmatterFields(docType).map((entry) => ({ ...entry, roleAligned: false }))
                        : collectRoleAlignedObservedFrontmatterFields(document, docType, getIndex());
                    const archetypeFields = collectArchetypeFieldSuggestions(document, docType);
                    const noteRoleFields = collectNoteRoleFieldSuggestions(document, docType, getIndex());
                    const contextualFields = collectContextualObservedFrontmatterFields(document, docType, getIndex());
                    const adaptiveFields = collectAdaptiveFrontmatterFieldSuggestions(document, docType, getIndex());
                    const adaptiveGapFields = collectSchemaAdaptiveGapSuggestions(document, docType, getIndex());
                    const starterSuggestions = collectAdaptiveFrontmatterStarterSuggestions(document, docType, getIndex());
                    const combined = new Map();

                    for (const [key, def] of schemaFields) {
                        const label = normalizeFrontmatterKey(key);
                        combined.set(label, {
                            key: label,
                            sortScore: 1400 + (def.required ? 80 : 0),
                            detail: def.type === 'relation'
                                ? `${key}${def.required ? ' (required)' : ''} · schema relation${def.target ? ` → ${def.target}` : ''}`
                                : `${key}${def.required ? ' (required)' : ''} · from schema`,
                            source: 'schema',
                            snippetKey: key
                        });
                    }

                    for (const entry of noteRoleFields) {
                        const noteRoleReason = entry.noteRole
                            ? summarizeNoteRoleReasons(entry.noteRole)
                            : '';
                        const roleLead = entry.roleSummary || `${entry.source} note`;
                        const existing = combined.get(entry.key);
                        if (!existing) {
                            combined.set(entry.key, {
                                key: entry.key,
                                sortScore: 900 + entry.score,
                                detail: noteRoleReason
                                    ? `common on ${roleLead}; ${noteRoleReason}`
                                    : `common on ${roleLead}`,
                                source: 'note-role'
                            });
                        } else {
                            existing.detail = `${existing.detail}; common on ${roleLead}`;
                            existing.sortScore += entry.score;
                        }
                    }
                    for (const entry of archetypeFields) {
                        const existing = combined.get(entry.key);
                        if (!existing) {
                            combined.set(entry.key, {
                                key: entry.key,
                                sortScore: 1000 + entry.score,
                                detail: `suggested for ${entry.source} notes`,
                                source: 'archetype'
                            });
                        } else {
                            existing.detail = `${existing.detail}; suggested for ${entry.source} notes`;
                            existing.sortScore += entry.score;
                        }
                    }
                    for (const entry of observedFields) {
                        const existing = combined.get(entry.key);
                        const observedScope = docType || 'similar';
                        const observedDetail = entry.roleAligned
                            ? `common in ${entry.noteRole?.noteRole || observedScope} workflows (${entry.count} notes)`
                            : `observed in ${entry.count} ${observedScope} note${entry.count === 1 ? '' : 's'}`;
                        if (!existing) {
                            combined.set(entry.key, {
                                key: entry.key,
                                sortScore: 500 + entry.count + (entry.roleAligned ? 120 : 0),
                                detail: observedDetail,
                                source: 'observed'
                            });
                        } else {
                            existing.detail = `${existing.detail}; ${observedDetail}`;
                            existing.sortScore += entry.count + (entry.roleAligned ? 40 : 0);
                        }
                    }
                    for (const entry of contextualFields) {
                        const existing = combined.get(entry.key);
                        const sharedLead = entry.sharedFields.length
                            ? `common alongside ${entry.sharedFields.slice(0, 2).join(', ')}`
                            : `common in ${entry.role} notes`;
                        const detail = `${sharedLead} (${entry.count} similar notes)`;
                        if (!existing) {
                            combined.set(entry.key, {
                                key: entry.key,
                                sortScore: 1100 + entry.score,
                                detail,
                                source: 'contextual'
                            });
                        } else {
                            existing.detail = `${existing.detail}; ${detail}`;
                            existing.sortScore += Math.min(180, entry.count * 20);
                        }
                    }
                    for (const entry of adaptiveFields) {
                        const existing = combined.get(entry.key);
                        const detail = entry.summary;
                        if (!existing) {
                            combined.set(entry.key, {
                                key: entry.key,
                                sortScore: 1250 + entry.score,
                                detail,
                                source: 'adaptive-pattern'
                            });
                        } else {
                            existing.detail = `${existing.detail}; ${detail}`;
                            existing.sortScore += 160 + entry.score;
                        }
                    }
                    for (const entry of adaptiveGapFields) {
                        const existing = combined.get(entry.key);
                        const alternatives = entry.alternatives?.length
                            ? `; similar notes also use ${entry.alternatives.join(', ')}`
                            : '';
                        const detail = `${entry.missingSummary}. ${entry.summary}${alternatives}`;
                        if (!existing) {
                            combined.set(entry.key, {
                                key: entry.key,
                                sortScore: 1180 + entry.score,
                                detail,
                                source: 'adaptive-gap'
                            });
                        } else {
                            existing.detail = `${existing.detail}; ${detail}`;
                            existing.sortScore += 140 + Math.min(180, entry.score);
                        }
                    }

                    const rankedFields = Array.from(combined.values())
                        .map((entry) => ({
                            ...entry,
                            matchScore: scoreFieldSuggestion(entry, partialKey)
                        }))
                        .filter(entry => entry.matchScore >= 0)
                        .sort((a, b) => b.matchScore - a.matchScore || a.key.localeCompare(b.key));

                    if (!rankedFields.length) return undefined;
                    const starterItems = partialKey.length <= 2
                        ? starterSuggestions.map((entry, index) => {
                            const item = new vscode.CompletionItem(entry.label, vscode.CompletionItemKind.Snippet);
                            item.detail = [entry.detail, entry.headline, entry.workflowSummary].filter(Boolean).join(' · ');
                            item.documentation = entry.why || entry.headline || entry.detail;
                            item.sortText = `00${index}`;
                            item.insertText = new vscode.SnippetString(entry.insertText);
                            return item;
                        })
                        : [];

                    const fieldItems = rankedFields.map(entry => {
                        const relationState = fieldLooksRelational(entry.key, document, getIndex());
                        const item = new vscode.CompletionItem(entry.key, vscode.CompletionItemKind.Field);
                        item.detail = buildFieldInferenceDetail(entry.detail, relationState);
                        const outputKey = entry.snippetKey || entry.key;
                        item.insertText = relationState.relational
                            ? new vscode.SnippetString(`${outputKey}: [[\${1}]]`)
                            : `${outputKey}: `;
                        return item;
                    });
                    return [...starterItems, ...fieldItems];
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'markdown',
            {
                provideCompletionItems(document, position) {
                    const ctx = getViewBlockContext(document, position);
                    if (!ctx) return undefined;
                    const line = document.lineAt(position.line).text;
                    const before = line.slice(0, position.character);
                    const queryType = ctx.queryType || '*';
                    const fields = collectFieldsForType(queryType);

                    if (/^\s*!view\s+[^|\n]*$/.test(before)) {
                        const partial = before.replace(/^\s*!view\s+/, '').trim().toLowerCase();
                        return [...new Set([...SIMPLE_VIEW_TYPES, ...Array.from(getTypes()).sort()])]
                            .filter(v => v.toLowerCase().startsWith(partial))
                            .map(v => {
                                const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.Class);
                                item.range = makeReplaceRange(document, position, partial.length);
                                return item;
                            });
                    }

                    if (/^\s*!view\s+[\w*-]+\s*$/.test(before)) {
                        return CLAUSE_KEYWORDS.map(k => new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword));
                    }

                    if (/^\s*(select|sort)\s*([^\n]*)$/i.test(before)) {
                        const partial = before.replace(/^\s*(select|sort)\s*/i, '').split(',').pop().trim().toLowerCase();
                        return fields.filter(f => f.startsWith(partial)).map(f => {
                            const item = new vscode.CompletionItem(f, vscode.CompletionItemKind.Field);
                            item.range = makeReplaceRange(document, position, partial.length);
                            return item;
                        });
                    }

                    if (/^\s*where\s*$/i.test(before) || /^\s*where\s+[\w-]*$/i.test(before)) {
                        const partial = before.replace(/^\s*where\s*/i, '').trim().toLowerCase();
                        return fields.filter(f => f.startsWith(partial)).map(f => {
                            const item = new vscode.CompletionItem(f, vscode.CompletionItemKind.Field);
                            item.range = makeReplaceRange(document, position, partial.length);
                            return item;
                        });
                    }

                    const whereFieldMatch = before.match(/^\s*where\s+([\w-]+)\s*$/i);
                    if (whereFieldMatch) {
                        return ['=', 'contains'].map(op => new vscode.CompletionItem(op, vscode.CompletionItemKind.Operator));
                    }

                    const relationMatch = before.match(/^\s*where\s+([\w-]+)\s*=\s*\[\[([^\]]*)$/i);
                    if (relationMatch) {
                        const fieldName = relationMatch[1].toLowerCase();
                        const partial = relationMatch[2].toLowerCase();
                        const relationCandidates = resolveQueryRelationCandidates(fieldName, queryType, partial, getIndex(), {
                            localLinkedIds: collectLocalLinkedIds(document, getIndex()),
                            document
                        });
                        if (!relationCandidates) return undefined;
                        return rankCandidateIds(
                            relationCandidates.candidateIds,
                            partial,
                            relationCandidates.preferredIds,
                            relationCandidates.localLinkedIds,
                            relationCandidates.observedIdScores
                        )
                            .map(id => {
                                const item = new vscode.CompletionItem(id, vscode.CompletionItemKind.Reference);
                                item.insertText = `${id}]]`;
                                item.range = makeReplaceRange(document, position, partial.length);
                                const preferred = relationCandidates.preferredIds.includes(id);
                                item.detail = buildRelationCandidateDetail(id, getIndex(), relationCandidates, preferred);
                                return item;
                            });
                    }

                    const scalarMatch = before.match(/^\s*where\s+([\w-]+)\s*=\s*([^\[]*)$/i);
                    if (scalarMatch) {
                        const fieldName = scalarMatch[1].toLowerCase();
                        const partial = scalarMatch[2].trim().toLowerCase();
                        if (inferRelationField(fieldName, queryType)) {
                            const item = new vscode.CompletionItem('[[', vscode.CompletionItemKind.Snippet);
                            item.insertText = '[[';
                            item.range = makeReplaceRange(document, position, partial.length);
                            return [item];
                        }
                        const values = collectScalarValues(fieldName, queryType).filter(v => v.toLowerCase().startsWith(partial));
                        return values.map(v => {
                            const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.Value);
                            item.range = makeReplaceRange(document, position, partial.length);
                            return item;
                        });
                    }

                    return undefined;
                }
            },
            ' ', '=', ',', '['
        )
    );
}

module.exports = {
    registerCompletion,
    // Re-export helpers so existing test imports continue to work
    resolveFrontmatterRelationCandidates,
    inferTargetTypeFromFieldName,
    collectObservedFrontmatterFields,
    collectRoleAlignedObservedFrontmatterFields,
    collectContextualObservedFrontmatterFields,
    collectAdaptiveFrontmatterFieldSuggestions,
    collectSchemaAdaptiveGapSuggestions,
    collectAdaptiveFrontmatterStarterSuggestions,
    collectArchetypeFieldSuggestions,
    collectNoteRoleFieldSuggestions,
    collectLocalLinkedIds,
    collectObservedRelationUsage,
    rankCandidateIds,
    buildFieldInferenceDetail,
    resolveQueryRelationCandidates
};
