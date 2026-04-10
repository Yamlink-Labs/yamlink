const vscode = require('vscode');
const { getTypes, getRegistry } = require('../registries/typeRegistry');
const { getFieldsCache } = require('../core/index');
const { inferFieldRole, inferTargetTypeFromFieldName } = require('../intelligence/fieldRoles');

const CLAUSE_KEYWORDS = ['select', 'where', 'sort', 'limit', 'via'];
const SIMPLE_VIEW_TYPES = ['*', 'task', 'tasks', 'calendar', 'today', 'upcoming', 'agenda'];
const FRONTMATTER_ARCHETYPES = {
    account: ['name', 'status', 'owner', 'contacts', 'website', 'domain', 'industry', 'stage', 'email', 'phone'],
    company: ['name', 'status', 'owner', 'contacts', 'website', 'domain', 'industry', 'stage', 'email', 'phone'],
    contact: ['name', 'account', 'email', 'phone', 'title', 'status', 'owner', 'city'],
    lead: ['name', 'account', 'email', 'phone', 'status', 'owner', 'source', 'stage'],
    opportunity: ['name', 'account', 'owner', 'status', 'stage', 'value', 'close-date'],
    mission: ['name', 'date', 'commander', 'unit', 'outcome', 'status'],
    character: ['name', 'status', 'rank', 'unit', 'species', 'homeworld'],
    task: ['status', 'owner', 'date', 'priority', 'account']
};
const TITLE_ARCHETYPE_KEYWORDS = {
    account: ['account', 'company', 'client', 'customer'],
    contact: ['contact', 'person', 'lead'],
    opportunity: ['deal', 'opportunity', 'pipeline'],
    mission: ['mission', 'operation'],
    character: ['character', 'profile', 'persona']
};

function isPositionInFrontmatter(document, lineIndex) {
    const lines = document.getText().split('\n');
    let openLine = -1;
    let closeLine = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^---\s*$/.test(lines[i])) {
            if (openLine === -1) openLine = i;
            else { closeLine = i; break; }
        }
    }
    if (openLine === -1 || closeLine === -1) return false;
    return lineIndex > openLine && lineIndex < closeLine;
}

function getDocumentType(document) {
    const match = document.getText().match(/^\s*type:\s*(.+?)\s*$/m);
    return match ? match[1].trim().toLowerCase() : null;
}

function fieldLooksRelational(fieldName, document, idIndex) {
    const docType = getDocumentType(document);
    const role = inferFieldRole(fieldName, { documentType: docType, idIndex });
    return {
        relational: role.relational,
        targetType: role.targetType,
        semanticRole: role.semanticRole,
        reasons: role.reasons
    };
}

function summariseInferenceReasons(reasons = [], max = 2) {
    return reasons
        .filter(Boolean)
        .slice(0, max)
        .join('; ');
}

function buildFieldInferenceDetail(entryDetail, relationState) {
    const reasonText = summariseInferenceReasons(relationState.reasons);
    if (relationState.relational) {
        const base = relationState.targetType
            ? `${entryDetail} → ${relationState.targetType}`
            : `${entryDetail} → relation`;
        return reasonText ? `${base} · ${reasonText}` : base;
    }
    if (relationState.semanticRole) {
        const base = `${entryDetail} · inferred ${relationState.semanticRole}`;
        return reasonText ? `${base} · ${reasonText}` : base;
    }
    return reasonText ? `${entryDetail} · ${reasonText}` : entryDetail;
}

function buildRelationCandidateDetail(id, idIndex, frontmatterRelation, preferred) {
    const reasonText = frontmatterRelation.reasonText || '';
    if (frontmatterRelation.targetType) {
        const base = preferred
            ? `${frontmatterRelation.targetType} relation (preferred match)`
            : `${idIndex.get(id) || 'Yamlink node'} (outside suggested ${frontmatterRelation.targetType} target)`;
        return reasonText ? `${base} · ${reasonText}` : base;
    }
    const base = idIndex.get(id) || 'Yamlink node';
    return reasonText ? `${base} · ${reasonText}` : base;
}

function resolveFrontmatterRelationCandidates(document, position, idIndex) {
    if (!isPositionInFrontmatter(document, position.line)) return null;

    const line = document.lineAt(position.line).text;
    const before = line.substring(0, position.character);
    const textAfterCursor = line.substring(position.character);
    const match = before.match(/^\s*([\w-]+):\s*(\[\[)?([^\]]*)$/);
    if (!match) return null;

    const fieldName = match[1].toLowerCase();
    const hasWiki = !!match[2];
    const partial = (match[3] || '').trim();
    const relationState = fieldLooksRelational(fieldName, document, idIndex);
    if (!hasWiki && !relationState.relational) return null;

    const candidateIds = Array.from(idIndex.keys());
    let preferredIds = [];
    if (relationState.targetType) {
        const typeNodes = getRegistry().get(relationState.targetType) ?? new Set();
        preferredIds = candidateIds.filter(id => typeNodes.has(id));
    }

    return {
        fieldName,
        partial,
        hasWiki,
        hasClosing: hasWiki && textAfterCursor.startsWith(']]'),
        candidateIds,
        preferredIds,
        targetType: relationState.targetType,
        reasonText: summariseInferenceReasons(relationState.reasons)
    };
}

function resolveQueryRelationCandidates(fieldName, queryType, partial, idIndex) {
    const normalizedType = String(queryType || '').trim().toLowerCase();
    const relationState = inferFieldRole(fieldName, {
        documentType: normalizedType && normalizedType !== '*' ? normalizedType : '',
        idIndex
    });
    if (!relationState.relational) return null;

    const candidateIds = Array.from(idIndex.keys());
    let preferredIds = [];
    if (relationState.targetType) {
        const typeNodes = getRegistry().get(relationState.targetType) ?? new Set();
        preferredIds = candidateIds.filter(id => typeNodes.has(id));
    }

    return {
        fieldName,
        partial,
        candidateIds,
        preferredIds,
        targetType: relationState.targetType,
        reasonText: summariseInferenceReasons(relationState.reasons)
    };
}

function getViewBlockContext(document, position) {
    const lines = document.getText().split('\n');
    let start = position.line;
    while (start >= 0) {
        const t = lines[start].trim();
        if (t.startsWith('!view ')) break;
        if (!t || (!/^(select|where|sort|limit|via)\b/i.test(t) && start !== position.line)) return null;
        start--;
    }
    if (start < 0 || !lines[start].trim().startsWith('!view ')) return null;

    const block = [lines[start]];
    let end = start + 1;
    while (end < lines.length) {
        const t = lines[end].trim();
        if (!t) break;
        if (t.startsWith('!view ')) break;
        if (/^(select|where|sort|limit|via)\b/i.test(t)) {
            block.push(lines[end]);
            end++;
        } else {
            break;
        }
    }

    const first = lines[start].trim();
    const rest = first.slice(6).trim();
    const typeMatch = rest.match(/^([\w*-]+)/);
    const queryType = typeMatch ? typeMatch[1].toLowerCase() : null;

    return { start, end, lines: block, queryType, currentLine: lines[position.line] };
}

function collectFieldsForType(type) {
    const fieldsCache = getFieldsCache();
    const fields = new Set();
    for (const value of fieldsCache.values()) {
        const nodeType = (value.type || '').trim().toLowerCase();
        if (type !== '*' && type !== 'tasks' && nodeType !== type) continue;
        for (const key of Object.keys(value)) {
            if (key !== 'id') fields.add(key.toLowerCase());
        }
    }
    if (type === 'tasks') ['text', 'done', 'date', 'file', 'line'].forEach(f => fields.add(f));
    return Array.from(fields).sort();
}

function inferRelationField(fieldName, queryType) {
    if (queryType === 'tasks') return false;
    const fieldsCache = getFieldsCache();
    let relationHits = 0;
    let scalarHits = 0;
    for (const value of fieldsCache.values()) {
        const nodeType = (value.type || '').trim().toLowerCase();
        if (queryType && queryType !== '*' && nodeType !== queryType) continue;
        const raw = String(value[fieldName] ?? '');
        if (!raw) continue;
        if (/\[\[[^\]]+\]\]/.test(raw)) relationHits++;
        else scalarHits++;
    }
    return relationHits > 0 && relationHits >= scalarHits;
}

function collectScalarValues(fieldName, queryType) {
    const fieldsCache = getFieldsCache();
    const values = new Map();
    for (const value of fieldsCache.values()) {
        const nodeType = (value.type || '').trim().toLowerCase();
        if (queryType && queryType !== '*' && nodeType !== queryType) continue;
        const raw = String(value[fieldName] ?? '').trim();
        if (!raw || /\[\[[^\]]+\]\]/.test(raw)) continue;
        values.set(raw.toLowerCase(), raw);
    }
    return Array.from(values.values()).sort();
}

function createItems(values, kind, detail) {
    return values.map(v => {
        const item = new vscode.CompletionItem(v, kind);
        if (detail) item.detail = detail;
        return item;
    });
}

function collectObservedFrontmatterFields(docType) {
    const fieldsCache = getFieldsCache();
    const counts = new Map();
    for (const value of fieldsCache.values()) {
        const nodeType = String(value.type || '').trim().toLowerCase();
        if (!docType || nodeType !== docType) continue;
        for (const key of Object.keys(value)) {
            const normalized = String(key || '').trim().toLowerCase();
            if (!normalized || normalized === 'id' || normalized === 'type') continue;
            counts.set(normalized, (counts.get(normalized) || 0) + 1);
        }
    }
    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([key, count]) => ({ key, count }));
}

function extractDocumentArchetype(document, docType) {
    const candidates = new Set();
    if (docType) candidates.add(String(docType).trim().toLowerCase());

    const text = document.getText();
    const headingMatch = text.match(/^#\s+(.+)$/m);
    const nameMatch = text.match(/^\s*name:\s*(.+?)\s*$/m);
    const pathBits = [];
    if (headingMatch) pathBits.push(headingMatch[1]);
    if (nameMatch) pathBits.push(nameMatch[1]);
    if (document.uri?.fsPath) pathBits.push(document.uri.fsPath.split(/[\\/]/).pop() || '');
    const haystack = pathBits.join(' ').toLowerCase();

    for (const [type, keywords] of Object.entries(TITLE_ARCHETYPE_KEYWORDS)) {
        if (keywords.some(keyword => haystack.includes(keyword))) {
            candidates.add(type);
        }
    }
    return Array.from(candidates);
}

function collectArchetypeFieldSuggestions(document, docType) {
    const archetypes = extractDocumentArchetype(document, docType);
    const fields = new Map();
    for (const archetype of archetypes) {
        const suggestions = FRONTMATTER_ARCHETYPES[archetype] || [];
        suggestions.forEach((field, index) => {
            const current = fields.get(field);
            const score = 100 - index;
            if (!current || score > current.score) {
                fields.set(field, { key: field, score, source: archetype });
            }
        });
    }
    return Array.from(fields.values()).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

function scoreCandidateMatch(value, partial) {
    const candidate = String(value || '').toLowerCase();
    const query = String(partial || '').trim().toLowerCase();
    if (!query) return 500;
    if (candidate === query) return 1000;
    if (candidate.startsWith(query)) return 800 - candidate.length;
    if (candidate.includes(query)) return 600 - candidate.indexOf(query);

    let matched = 0;
    let cursor = 0;
    for (const ch of query) {
        const idx = candidate.indexOf(ch, cursor);
        if (idx === -1) return -1;
        matched++;
        cursor = idx + 1;
    }
    return matched === query.length ? 300 - candidate.length : -1;
}

function rankCandidateIds(candidateIds, partial, preferredIds = []) {
    const preferred = new Set(preferredIds);
    return candidateIds
        .map(id => {
            const matchScore = scoreCandidateMatch(id, partial);
            return {
                id,
                score: matchScore >= 0 ? matchScore + (preferred.has(id) ? 1000 : 0) : matchScore,
                preferred: preferred.has(id)
            };
        })
        .filter(entry => entry.score >= 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .map(entry => entry.id);
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
                            frontmatterRelation.preferredIds
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

                    const typeMatch = textBeforeCursor.match(/^type:\s*(\S*)$/);
                    if (typeMatch) return createItems([...getTypes()], vscode.CompletionItemKind.EnumMember, 'Type used in vault');

                    return undefined;
                }
            },
            '[', ':', ' '
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
                    const keyMatch = trimmed.match(/^([\w-]*)$/);
                    if (!keyMatch) return undefined;
                    const docType = getDocumentType(document);
                    if (!docType) return undefined;
                    const schema = getSchema(docType);
                    const partialKey = keyMatch[1].toLowerCase();
                    const schemaFields = Object.entries(schema?.fields || {});
                    if (schemaFields.length > 0) {
                        schemaFields.sort((a, b) => (a[1].required ? 0 : 1) - (b[1].required ? 0 : 1) || a[0].localeCompare(b[0]));
                        return schemaFields.filter(([key]) => key.toLowerCase().startsWith(partialKey)).map(([key, def]) => {
                            const label = def.required ? `${key}*` : key;
                            const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Field);
                            item.detail = def.type === 'relation'
                                ? `${def.type}${def.target ? ` → ${def.target}` : ''}${def.required ? ' (required)' : ''}`
                                : `${def.type}${def.required ? ' (required)' : ''}`;
                            item.insertText = def.type === 'relation' ? new vscode.SnippetString(`${key}: [[\${1}]]`) : `${key}: `;
                            return item;
                        });
                    }

                    const observedFields = collectObservedFrontmatterFields(docType);
                    const archetypeFields = collectArchetypeFieldSuggestions(document, docType);
                    const combined = new Map();

                    for (const entry of archetypeFields) {
                        combined.set(entry.key, {
                            key: entry.key,
                            sortScore: 1000 + entry.score,
                            detail: `suggested for ${entry.source} notes`,
                            source: 'archetype'
                        });
                    }
                    for (const entry of observedFields) {
                        const existing = combined.get(entry.key);
                        const observedDetail = `observed in ${entry.count} ${docType} note${entry.count === 1 ? '' : 's'}`;
                        if (!existing) {
                            combined.set(entry.key, {
                                key: entry.key,
                                sortScore: 500 + entry.count,
                                detail: observedDetail,
                                source: 'observed'
                            });
                        } else {
                            existing.detail = `${existing.detail}; ${observedDetail}`;
                            existing.sortScore += entry.count;
                        }
                    }

                    const rankedFields = Array.from(combined.values())
                        .filter(entry => !partialKey || entry.key.startsWith(partialKey) || scoreCandidateMatch(entry.key, partialKey) >= 0)
                        .sort((a, b) => b.sortScore - a.sortScore || a.key.localeCompare(b.key));

                    if (!rankedFields.length) return undefined;
                    return rankedFields.map(entry => {
                        const relationState = fieldLooksRelational(entry.key, document, getIndex());
                        const item = new vscode.CompletionItem(entry.key, vscode.CompletionItemKind.Field);
                        item.detail = buildFieldInferenceDetail(entry.detail, relationState);
                        item.insertText = relationState.relational
                            ? new vscode.SnippetString(`${entry.key}: [[\${1}]]`)
                            : `${entry.key}: `;
                        return item;
                    });
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
                        const relationCandidates = resolveQueryRelationCandidates(fieldName, queryType, partial, getIndex());
                        if (!relationCandidates) return undefined;
                        return rankCandidateIds(
                            relationCandidates.candidateIds,
                            partial,
                            relationCandidates.preferredIds
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
    resolveFrontmatterRelationCandidates,
    inferTargetTypeFromFieldName,
    collectObservedFrontmatterFields,
    collectArchetypeFieldSuggestions,
    rankCandidateIds,
    buildFieldInferenceDetail,
    resolveQueryRelationCandidates
};
