'use strict';

const vscode = require('vscode');
const { perfTracker } = require('../runtime/performanceTracker');
const { getPathIndex, getFieldsCache, getAliasIndex, getVaultGeneration } = require('../core/indexService');
const { getSchema } = require('../registries/schemaRegistry');
const { LEVEL } = require('../intelligence/fieldPlanner');
const { getCachedPriors } = require('../intelligence/vaultPriors');
const { evaluateFieldForSurface } = require('../intelligence/authoringEngine');
const {
    CLAUSE_KEYWORDS,
    SIMPLE_VIEW_TYPES,
    normalizeFrontmatterKey,
    isTypeLikeField,
    isPositionInFrontmatter,
    getDocumentType,
    extractFrontmatterFields,
    fieldLooksRelational,
    buildFieldInferenceDetail,
    buildRelationCandidateDetail,
    buildAdaptiveFrontmatterContext,
    resolveFrontmatterRelationCandidates,
    resolveQueryRelationCandidates,
    getViewBlockContext,
    collectFieldsForType,
    inferRelationField,
    rankScalarValues,
    collectObservedFrontmatterFields,
    collectRoleAlignedObservedFrontmatterFields,
    collectContextualObservedFrontmatterFields,
    collectAdaptiveFrontmatterFieldSuggestions,
    collectSchemaAdaptiveGapSuggestions,
    collectArchetypeFieldSuggestions,
    collectNoteRoleFieldSuggestions,
    collectDriftMissingFieldSuggestions,
    scoreFieldSuggestion,
    rankCandidateIds,
    collectLocalLinkedIds,
    getHumanLabel
} = require('../intelligence/completionHelpers');
const { getKnownTypeCandidates } = require('./completionCore');
const { buildNoteArc } = require('../intelligence/noteArc');
const { summarizeNoteRoleReasons } = require('../intelligence/noteRolesCore');
const { recordCompletionShown } = require('./completionTracker');
const {
    makeReplaceRange,
    buildMissingRelationItem,
    buildCreateRelationTemplateItem,
    shouldOfferFrontmatterRelationCompletion,
    buildMissingQueryRelationItem,
    buildDateShortcutItems,
    collectDocumentHeadingCandidates,
    buildHeadingAnchorItems,
    buildBlockReferenceItems,
    buildFootnoteReferenceItems,
    buildLongformBodyStructureItems,
    inferBootstrapNoteTypes,
    buildPreTypeBootstrapItems
} = require('./completionItemBuilders');

function buildFrontmatterValueItems(document, position, getIndex, completionContext) {
    if (!isPositionInFrontmatter(document, position.line)) return undefined;

    const line = document.lineAt(position.line).text;
    const textBeforeCursor = line.substring(0, position.character);
    const explicitWikiMatch = textBeforeCursor.match(/^\s*[\w-]+:\s*\[\[[^\]]*$/);
    if (explicitWikiMatch) {
        // The dedicated link provider owns explicit [[... completion. If we also
        // return relation items here, VS Code merges both providers and users
        // see duplicate wikilink suggestions.
        return undefined;
    }
    const valueMatch = textBeforeCursor.match(/^\s*([\w-]+):\s*(.*?)$/);
    if (!valueMatch) return undefined;

    const fieldKey = normalizeFrontmatterKey(valueMatch[1]);
    if (!fieldKey) return undefined;

    const idIndex = getIndex();
    const relationState = resolveFrontmatterRelationCandidates(document, position, idIndex);
    if (relationState && shouldOfferFrontmatterRelationCompletion(relationState, completionContext || { triggerKind: 0 })) {
        const valueStart = position.character - relationState.partial.length - (relationState.wikiPrefixLength || 0);
        const replaceRange = new vscode.Range(
            new vscode.Position(position.line, Math.max(0, valueStart)),
            new vscode.Position(position.line, position.character + (relationState.closingLength || 0))
        );
        const templateItem = buildCreateRelationTemplateItem(document, relationState);
        if (relationState.missingTargetType) {
            return [templateItem, buildMissingRelationItem(relationState)];
        }
        const items = rankCandidateIds(
            relationState.candidateIds,
            relationState.partial,
            relationState.preferredIds,
            relationState.localLinkedIds,
            relationState.observedIdScores,
            relationState.rankingHints
        ).map((id) => {
            const humanName = getHumanLabel(id);
            const label = humanName ? { label: humanName, description: id } : id;
            const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Reference);
            item.insertText = `[[${id}]]`;
            item.range = replaceRange;
            item.filterText = humanName ? `${id} ${humanName}` : id;
            const preferred = relationState.preferredIds.includes(id);
            item.detail = buildRelationCandidateDetail(id, idIndex, relationState, preferred);
            item.sortText = preferred ? `01-${id}` : `02-${id}`;
            return item;
        });
        return [templateItem, ...items];
    }

    if (isTypeLikeField(fieldKey)) return undefined;

    const docType = getDocumentType(document);
    const partial = String(valueMatch[2] || '').trim().toLowerCase();
    const rankedScalarValues = rankScalarValues(fieldKey, docType, partial);
    if (!rankedScalarValues.length) return undefined;

    return rankedScalarValues
        .map(({ value, count }) => {
            const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
            item.insertText = value;
            item.range = makeReplaceRange(document, position, partial.length);
            item.detail = count > 0
                ? `observed in ${count} ${docType || 'vault'} note${count === 1 ? '' : 's'}`
                : `observed ${docType || 'vault'} value`;
            item.sortText = String(999 - Math.min(count, 998)).padStart(4, '0') + value.toLowerCase();
            return item;
        });
}

/** @param {import('vscode').TextDocument} document @param {import('vscode').Position} position @param {any} _token @param {any} completionContext @param {() => Map<string,string>} getIndex */
function provideLinkAndDateCompletions(document, position, _token, completionContext, getIndex) {
    return perfTracker.measureSync('completion.linkProvider', { budgetMs: 30 }, () => {
        const line = document.lineAt(position.line).text;
        const textBeforeCursor = line.substring(0, position.character);

        const idIndex = getIndex();
        const frontmatterRelation = resolveFrontmatterRelationCandidates(document, position, idIndex);
        if (frontmatterRelation) {
            if (!shouldOfferFrontmatterRelationCompletion(frontmatterRelation, completionContext)) {
                return undefined;
            }
            // Gate only non-wiki suggestions. Explicit [[ is user intent — never silence it.
            let classification = null;
            if (frontmatterRelation.fieldName && !frontmatterRelation.hasWiki) {
                const docTypeForClass = getDocumentType(document);
                const fieldsCache = getFieldsCache();
                const noteFields = extractFrontmatterFields(document);
                const evaluation = evaluateFieldForSurface(frontmatterRelation.fieldName, 'completion', /** @type {any} */ ({
                    noteType: docTypeForClass,
                    noteFields,
                    documentText: document.getText(),
                    fieldsCache,
                    generation: getVaultGeneration()
                }));
                classification = evaluation.classification;
                if (evaluation.plan.level < LEVEL.COMPLETION_ONLY) return undefined;
            }
            const templateItem = buildCreateRelationTemplateItem(document, frontmatterRelation);
            if (frontmatterRelation.missingTargetType) {
                return [templateItem, buildMissingRelationItem(frontmatterRelation)];
            }
            const valueStart = position.character - frontmatterRelation.partial.length - (frontmatterRelation.wikiPrefixLength || 0);
            const replaceRange = new vscode.Range(
                new vscode.Position(position.line, Math.max(0, valueStart)),
                new vscode.Position(position.line, position.character + (frontmatterRelation.closingLength || 0))
            );
            const _noteId = getPathIndex().get(document.uri.fsPath) || null;
            const _outcomeNoteId = classification ? _noteId : null;
            recordCompletionShown(_noteId, frontmatterRelation.fieldName, position.line);
            const relationItems = rankCandidateIds(
                frontmatterRelation.candidateIds,
                frontmatterRelation.partial,
                frontmatterRelation.preferredIds,
                frontmatterRelation.localLinkedIds,
                frontmatterRelation.observedIdScores,
                frontmatterRelation.rankingHints
            )
                .map(id => {
                    const humanName = getHumanLabel(id);
                    const label = humanName ? { label: humanName, description: id } : id;
                    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Reference);
                    item.insertText = `[[${id}]]`;
                    item.range = replaceRange;
                    const filterBase = frontmatterRelation.hasWiki ? `[[${id}` : id;
                    item.filterText = humanName ? `${filterBase} ${humanName}` : filterBase;
                    const preferred = frontmatterRelation.preferredIds.includes(id);
                    item.detail = buildRelationCandidateDetail(id, idIndex, frontmatterRelation, preferred);
                    item.sortText = preferred ? `01-${id}` : `02-${id}`;
                    if (classification && _outcomeNoteId) {
                        item.command = {
                            command: 'yamlink._completionAccepted',
                            title: '',
                            arguments: [{
                                noteId: _outcomeNoteId,
                                field: frontmatterRelation.fieldName,
                                targetId: id,
                                confidence: classification.confidence,
                                source: classification.source,
                                category: classification.category
                            }]
                        };
                    }
                    return item;
                });
            return [templateItem, ...relationItems];
        }

        const wikiMatch = textBeforeCursor.match(/\[\[([^\]]*)$/);
        const currentHeadingMatch = textBeforeCursor.match(/\[\[#([^\]]*)$/);
        if (currentHeadingMatch) {
            const items = buildHeadingAnchorItems(document, position, idIndex, '', currentHeadingMatch[1] || '');
            if (items.length) return items;
        }

        const noteHeadingMatch = textBeforeCursor.match(/\[\[([^#\]\|]+)#([^\]]*)$/);
        if (noteHeadingMatch) {
            const targetId = String(noteHeadingMatch[1] || '').trim();
            const items = buildHeadingAnchorItems(document, position, idIndex, targetId, noteHeadingMatch[2] || '');
            if (items.length) return items;
        }

        const currentBlockMatch = textBeforeCursor.match(/\[\[\^([^\]]*)$/);
        if (currentBlockMatch) {
            const items = buildBlockReferenceItems(document, position, idIndex, '', currentBlockMatch[1] || '');
            if (items.length) return items;
        }

        const noteBlockMatch = textBeforeCursor.match(/\[\[([^#\]\|^]+)\^([^\]]*)$/);
        if (noteBlockMatch) {
            const targetId = String(noteBlockMatch[1] || '').trim();
            const items = buildBlockReferenceItems(document, position, idIndex, targetId, noteBlockMatch[2] || '');
            if (items.length) return items;
        }

        if (wikiMatch) {
            const partial = wikiMatch[1];
            const bracketStart = position.character - partial.length - 2;
            const textAfterCursor = line.substring(position.character);
            const hasClosing = textAfterCursor.startsWith(']]');
            const replaceRange = new vscode.Range(
                new vscode.Position(position.line, bracketStart),
                new vscode.Position(position.line, position.character + (hasClosing ? 2 : 0))
            );

            const candidateIds = Array.from(idIndex.keys());
            const aliasIdx = getAliasIndex();
            const fieldsCache = getFieldsCache();
            const aliasItems = [];
            for (const [alias, canonId] of aliasIdx.entries()) {
                if (!candidateIds.includes(alias)) {
                    const humanName = getHumanLabel(canonId);
                    const label = humanName
                        ? { label: alias, description: `alias for ${humanName || canonId}` }
                        : { label: alias, description: `alias for ${canonId}` };
                    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Reference);
                    item.insertText = `[[${alias}]]`;
                    item.range = replaceRange;
                    item.filterText = `[[${alias} ${humanName || canonId}`;
                    const noteType = String(fieldsCache.get(canonId)?.type || '').trim();
                    item.detail = noteType ? `${noteType} (alias)` : 'alias';
                    item.sortText = `03-${alias}`;
                    aliasItems.push(item);
                }
            }
            const idItems = rankCandidateIds(candidateIds, partial)
                .map(id => {
                    const humanName = getHumanLabel(id);
                    const label = humanName ? { label: humanName, description: id } : id;
                    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Reference);
                    item.insertText = `[[${id}]]`;
                    item.range = replaceRange;
                    item.filterText = humanName ? `[[${id} ${humanName}` : `[[${id}`;
                    const noteType = String(fieldsCache.get(String(id || '').trim().toLowerCase())?.type || '').trim();
                    item.detail = noteType || idIndex.get(id);
                    return item;
                });
            return [...idItems, ...aliasItems];
        }

        const footnoteRefMatch = !isPositionInFrontmatter(document, position.line)
            ? textBeforeCursor.match(/\[\^([^\]\s]*)$/)
            : null;
        if (footnoteRefMatch) {
            const footnoteItems = buildFootnoteReferenceItems(document, position, footnoteRefMatch[1] || '');
            if (footnoteItems.length) return footnoteItems;
        }

        const longformItems = buildLongformBodyStructureItems(document, position);
        if (longformItems.length) return longformItems;

        const dateShortcutMatch = textBeforeCursor.match(/(^|[\s:(-])@([a-z-]*)$/i);
        if (dateShortcutMatch) {
            const partial = dateShortcutMatch[2] || '';
            const dateItems = buildDateShortcutItems(document, position, partial);
            if (dateItems.length) return dateItems;
        }

        const typeMatch = textBeforeCursor.match(/^\s*([^:\n]+):\s*(\S*)$/);
        if (typeMatch && isTypeLikeField(typeMatch[1])) {
            const partial = (typeMatch[2] || '').toLowerCase();
            const colonIdx = textBeforeCursor.lastIndexOf(':');
            // Replace from the colon onward so the result is always "field: value"
            const typeReplaceRange = new vscode.Range(
                new vscode.Position(position.line, colonIdx),
                position
            );
            return getKnownTypeCandidates()
                .filter(v => !partial || v.toLowerCase().startsWith(partial))
                .map(v => {
                    const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.EnumMember);
                    item.detail = 'Known or likely note type';
                    item.insertText = `: ${v}`;
                    // filterText must match what VS Code sees within the range
                    // (the text from the colon to the cursor)
                    item.filterText = `: ${v}`;
                    item.range = typeReplaceRange;
                    return item;
                });
        }

        return undefined;
    });
}

/** @param {import('vscode').TextDocument} document @param {import('vscode').Position} position @param {() => Map<string,string>} getIndex */
function provideFrontmatterFieldCompletions(document, position, getIndex) {
    return perfTracker.measureSync('completion.frontmatterProvider', { budgetMs: 30 }, () => {
        if (!isPositionInFrontmatter(document, position.line)) return undefined;
        const line = document.lineAt(position.line).text;
        const trimmed = line.trimStart();
        const valueItems = buildFrontmatterValueItems(document, position, getIndex, { triggerKind: 0 });
        if (valueItems && valueItems.length) return valueItems;
        const keyMatch = trimmed.match(/^([^:\n]*)$/);
        if (!keyMatch) return undefined;
        const docType = getDocumentType(document);
        const schema = getSchema(docType);
        const partialKey = normalizeFrontmatterKey(keyMatch[1]);
        const schemaFields = Object.entries(schema?.fields || {});
        const adaptiveContext = buildAdaptiveFrontmatterContext(document, docType, getIndex(), getSchema);
        const preTypeBootstrapItems = !docType
            ? buildPreTypeBootstrapItems(document, partialKey, adaptiveContext)
            : [];

        const observedFields = docType
            ? collectObservedFrontmatterFields(docType).map((entry) => ({ ...entry, roleAligned: false }))
            : collectRoleAlignedObservedFrontmatterFields(document, docType, getIndex());
        const archetypeFields = collectArchetypeFieldSuggestions(document, docType);
        const noteRoleFields = collectNoteRoleFieldSuggestions(document, docType, getIndex());
        const driftFields = collectDriftMissingFieldSuggestions(document, docType, getIndex());
        const contextualFields = collectContextualObservedFrontmatterFields(document, docType, getIndex());
        const adaptiveFields = collectAdaptiveFrontmatterFieldSuggestions(document, docType, getIndex(), adaptiveContext);
        const adaptiveGapFields = collectSchemaAdaptiveGapSuggestions(document, docType, getIndex(), adaptiveContext);

        // Arc prediction: fields this note is likely missing relative to same-type vault notes
        const _arcFieldsCache = getFieldsCache();
        const _arcPriors = getCachedPriors(_arcFieldsCache, getVaultGeneration());
        const _arcNoteFields = extractFrontmatterFields(document);
        const _arc = buildNoteArc(
            _arcNoteFields, docType, _arcFieldsCache,
            _arcPriors.typeFieldBundles, _arcPriors.fieldTargetTypes,
            _arcPriors.outcomeCalibration,
            { typeBundleTotals: _arcPriors.typeBundleTotals, emergentClusters: _arcPriors.emergentClusters }
        );

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

        for (const entry of driftFields) {
            const existing = combined.get(entry.key);
            if (!existing) {
                combined.set(entry.key, {
                    key: entry.key,
                    sortScore: 1350 + entry.score,
                    detail: entry.driftNote,
                    source: 'drift-pattern'
                });
            } else {
                existing.detail = `${existing.detail}; ${entry.driftNote}`;
                existing.sortScore += 200 + entry.score;
            }
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
                    sortScore: 900 + entry.score + (!docType ? 220 : 0),
                    detail: noteRoleReason
                        ? `common on ${roleLead}; ${noteRoleReason}`
                        : `common on ${roleLead}`,
                    source: 'note-role'
                });
            } else {
                existing.detail = `${existing.detail}; common on ${roleLead}`;
                existing.sortScore += entry.score + (!docType ? 120 : 0);
            }
        }
        for (const entry of archetypeFields) {
            const existing = combined.get(entry.key);
            if (!existing) {
                combined.set(entry.key, {
                    key: entry.key,
                    sortScore: 1000 + entry.score + (!docType ? 160 : 0),
                    detail: `suggested for ${entry.source} notes`,
                    source: 'archetype'
                });
            } else {
                existing.detail = `${existing.detail}; suggested for ${entry.source} notes`;
                existing.sortScore += entry.score + (!docType ? 80 : 0);
            }
        }
        for (const entry of observedFields) {
            const existing = combined.get(entry.key);
            const observedScope = docType || 'similar';
            const observedDetail = entry.roleAligned
                ? `common in ${/** @type {any} */ (entry).noteRole?.noteRole || observedScope} workflows (${entry.count} notes)`
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
            const detail = [entry.summary, entry.bodyEvidence].filter(Boolean).join('; ');
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
            const detail = `${entry.missingSummary}. ${entry.summary}${alternatives}${entry.bodyEvidence ? `; ${entry.bodyEvidence}` : ''}`;
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

        for (const { field, ratio, calibrationCount, isRelation, coldStart, emergentCluster } of (_arc.missingFields || [])) {
            const relNote = isRelation ? ' · relation' : '';
            const calNote = calibrationCount > 0 ? ` · accepted ${calibrationCount}×` : '';
            const arcDetail = emergentCluster
                ? `matches an emerging pattern in this vault${relNote}`
                : coldStart
                    ? `starter field${relNote}`
                    : `in ${Math.round(ratio * 100)}% of ${_arc.inferredType || ''} notes · likely missing${relNote}${calNote}`;
            const existing = combined.get(field);
            if (!existing) {
                combined.set(field, {
                    key: field,
                    // Emergent-cluster matches are real vault-taught evidence — rank above the
                    // hardcoded universal cold-start list, but below confirmed type-bundle arcs.
                    sortScore: emergentCluster ? 1250 : (coldStart ? 1200 : 1300 + Math.round(ratio * 80) + calibrationCount * 5),
                    detail: arcDetail,
                    source: 'arc'
                });
            } else {
                existing.detail = `${existing.detail}; ${arcDetail}`;
                existing.sortScore += 200 + Math.round(ratio * 40);
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
        return [...preTypeBootstrapItems, ...fieldItems];
    });
}

/** @param {import('vscode').TextDocument} document @param {import('vscode').Position} position @param {() => Map<string,string>} getIndex */
function provideQueryCompletions(document, position, getIndex) {
    return perfTracker.measureSync('completion.queryProvider', { budgetMs: 30 }, () => {
        const ctx = getViewBlockContext(document, position);
        if (!ctx) return undefined;
        const line = document.lineAt(position.line).text;
        const before = line.slice(0, position.character);
        const queryType = ctx.queryType || '*';
        const fields = collectFieldsForType(queryType);

        if (/^\s*!view\s+[^|\n]*$/.test(before)) {
            const partial = before.replace(/^\s*!view\s+/, '').trim().toLowerCase();
            return [...new Set([...SIMPLE_VIEW_TYPES, ...getKnownTypeCandidates()])]
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
            if (relationCandidates.missingTargetType) {
                return [buildMissingQueryRelationItem(relationCandidates)];
            }
            return rankCandidateIds(
                relationCandidates.candidateIds,
                partial,
                relationCandidates.preferredIds,
                relationCandidates.localLinkedIds,
                relationCandidates.observedIdScores,
                relationCandidates.rankingHints
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
            const values = rankScalarValues(fieldName, queryType, partial);
            return values.map(({ value }) => {
                const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
                item.range = makeReplaceRange(document, position, partial.length);
                return item;
            });
        }

        return undefined;
    });
}

module.exports = {
    makeReplaceRange,
    buildMissingRelationItem,
    buildCreateRelationTemplateItem,
    shouldOfferFrontmatterRelationCompletion,
    buildMissingQueryRelationItem,
    buildDateShortcutItems,
    collectDocumentHeadingCandidates,
    buildHeadingAnchorItems,
    buildBlockReferenceItems,
    buildFootnoteReferenceItems,
    buildLongformBodyStructureItems,
    inferBootstrapNoteTypes,
    buildPreTypeBootstrapItems,
    buildFrontmatterValueItems,
    provideLinkAndDateCompletions,
    provideFrontmatterFieldCompletions,
    provideQueryCompletions
};
