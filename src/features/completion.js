'use strict';

const fs = require('fs');
const vscode = require('vscode');
const { perfTracker } = require('../runtime/performanceTracker');
const { buildDateShortcutEntries } = require('../core/date');
const { getPathIndex, getFieldsCache, getAliasIndex, getVaultGeneration } = require('../core/indexService');
const { getTypes } = require('../registries/typeRegistry');
const { getSchema } = require('../registries/schemaRegistry');
const {
    extractHeadingsFromText,
    extractFootnoteDefinitions,
    collectBodySignals,
    collectUndefinedFootnoteReferences
} = require('../intelligence/bodySignals');
const {
    CLAUSE_KEYWORDS,
    SIMPLE_VIEW_TYPES,
    FRONTMATTER_ARCHETYPES,
    normalizeFrontmatterKey,
    isTypeLikeField,
    isPositionInFrontmatter,
    getDocumentType,
    extractFrontmatterFields,
    fieldLooksRelational,
    buildFieldInferenceDetail,
    buildRelationCandidateDetail,
    collectLocalLinkedIds,
    collectObservedRelationUsage,
    buildAdaptiveFrontmatterContext,
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
    collectDriftMissingFieldSuggestions,
    scoreFieldSuggestion,
    rankCandidateIds,
    getHumanLabel,
    extractDocumentArchetype
} = require('./completionHelpers');
const { inferTargetTypeFromFieldName } = require('../intelligence/fieldRoles');
const { inferNoteRole, summarizeNoteRoleReasons } = require('../intelligence/noteRolesCore');
const { extractBodyMentionedIds } = require('../intelligence/frontmatterBodyHints');
const { classifyField } = require('../intelligence/fieldCategory');
const { planFieldActions, LEVEL } = require('../intelligence/fieldPlanner');
const { getCachedPriors } = require('../intelligence/vaultPriors');

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

function getKnownTypeCandidates() {
    return [...new Set([
        ...Array.from(getTypes()),
        ...Object.keys(FRONTMATTER_ARCHETYPES)
    ])].sort();
}

function buildClassificationSignals(noteType, fieldsCache) {
    const priors = (!fieldsCache || !fieldsCache.size)
        ? { fieldTargetTypes: null, typeFieldBundles: null, fieldAmbiguity: null }
        : getCachedPriors(fieldsCache, getVaultGeneration());
    return { noteType, fieldsCache, ...priors };
}

function buildMissingRelationItem(frontmatterRelation) {
    const targetType = frontmatterRelation.targetType || 'related';
    const item = new vscode.CompletionItem(`No ${targetType} notes found yet`, vscode.CompletionItemKind.Text);
    const fieldLead = frontmatterRelation.fieldName
        ? `\`${frontmatterRelation.fieldName}\` expects a ${targetType} note`
        : `This field expects a ${targetType} note`;
    item.detail = `${fieldLead}. Create one, then link it here.`;
    item.insertText = '';
    item.sortText = '0000';
    return item;
}

function buildCreateRelationTemplateItem(document, frontmatterRelation) {
    const targetType = frontmatterRelation.targetType || frontmatterRelation.fieldName || 'related';
    const sourceId = getPathIndex().get(document.uri.fsPath) || null;
    const sourceType = sourceId ? String(getFieldsCache().get(sourceId)?.type || '').trim().toLowerCase() : '';
    const item = new vscode.CompletionItem(`New ${targetType}`, vscode.CompletionItemKind.Snippet);
    item.detail = sourceType
        ? `Create a new ${targetType} note, back-linked to this ${sourceType}`
        : `Create a new ${targetType} note, back-linked to this note`;
    item.insertText = '';
    item.sortText = '0000';
    item.preselect = true;
    item.command = {
        command: 'yamlink.createRelatedNote',
        title: 'Create related note',
        arguments: [{
            targetType,
            fieldName: frontmatterRelation.fieldName,
            sourceFilePath: document.uri.fsPath,
            sourceId,
            sourceType
        }]
    };
    return item;
}

function shouldOfferFrontmatterRelationCompletion(frontmatterRelation, completionContext = {}) {
    if (!frontmatterRelation) return false;
    if (frontmatterRelation.hasWiki) return true;
    const triggerKind = completionContext?.triggerKind;
    return triggerKind === vscode.CompletionTriggerKind?.Invoke || triggerKind === 0;
}

function buildMissingQueryRelationItem(relationState) {
    const targetType = relationState.targetType || 'related';
    const item = new vscode.CompletionItem(`No ${targetType} notes found yet`, vscode.CompletionItemKind.Text);
    const fieldLead = relationState.fieldName
        ? `\`${relationState.fieldName}\` expects a ${targetType} note`
        : `This field expects a ${targetType} note`;
    item.detail = `${fieldLead}. Create one, then use [[...]] here.`;
    item.insertText = '';
    item.sortText = '0000';
    return item;
}

function buildDateShortcutItems(document, position, partial) {
    const replaceRange = makeReplaceRange(document, position, partial.length + 1);
    return buildDateShortcutEntries()
        .filter((entry) => entry.token.startsWith(String(partial || '').toLowerCase()))
        .map((entry, index) => {
            const item = new vscode.CompletionItem(`@${entry.token}`, vscode.CompletionItemKind.Event);
            item.insertText = entry.iso;
            item.range = replaceRange;
            item.detail = `${entry.label} -> ${entry.iso}`;
            item.sortText = `00${index}`;
            return item;
        });
}

function collectDocumentHeadingCandidates(document, targetId, idIndex) {
    let content = '';
    if (!targetId) {
        content = document.getText();
    } else {
        const targetPath = idIndex.get(String(targetId || '').trim());
        if (!targetPath) return [];
        try {
            content = fs.readFileSync(targetPath, 'utf8');
        } catch (_) {
            return [];
        }
    }
    return [...new Set(extractHeadingsFromText(content))];
}

function buildHeadingAnchorItems(document, position, idIndex, targetId, partial) {
    const textAfterCursor = document.lineAt(position.line).text.substring(position.character);
    const replaceRange = new vscode.Range(
        new vscode.Position(position.line, Math.max(0, position.character - String(partial || '').length)),
        new vscode.Position(position.line, position.character + (textAfterCursor.startsWith(']]') ? 2 : 0))
    );
    const sourceLabel = targetId || 'current note';
    return collectDocumentHeadingCandidates(document, targetId, idIndex)
        .filter((heading) => heading.toLowerCase().startsWith(String(partial || '').toLowerCase()))
        .map((heading, index) => {
            const item = new vscode.CompletionItem(heading, vscode.CompletionItemKind.Reference);
            item.insertText = `${heading}]]`;
            item.range = replaceRange;
            item.filterText = targetId ? `[[${targetId}#${heading}` : `[[#${heading}`;
            item.detail = `Heading in ${sourceLabel}`;
            item.sortText = `01${String(index).padStart(3, '0')}`;
            return item;
        });
}

function buildFootnoteReferenceItems(document, position, partial) {
    const textAfterCursor = document.lineAt(position.line).text.substring(position.character);
    const replaceRange = new vscode.Range(
        new vscode.Position(position.line, Math.max(0, position.character - String(partial || '').length)),
        new vscode.Position(position.line, position.character + (textAfterCursor.startsWith(']') ? 1 : 0))
    );
    return [...new Set(extractFootnoteDefinitions(document.getText()))]
        .filter((id) => id.toLowerCase().startsWith(String(partial || '').toLowerCase()))
        .map((id, index) => {
            const item = new vscode.CompletionItem(`[^${id}]`, vscode.CompletionItemKind.Reference);
            item.insertText = `${id}]`;
            item.range = replaceRange;
            item.detail = 'Reference existing footnote';
            item.sortText = `02${String(index).padStart(3, '0')}`;
            return item;
        });
}

function buildLongformBodyStructureItems(document, position) {
    if (isPositionInFrontmatter(document, position.line)) return [];
    const line = document.lineAt(position.line).text;
    const textBeforeCursor = line.substring(0, position.character);
    const trimmedBefore = textBeforeCursor.trim();
    const bodySignals = collectBodySignals(document.getText());
    const sourceHeavy = (bodySignals.blockquoteCount || 0) >= 1
        || (bodySignals.footnoteDefinitionCount || 0) >= 1
        || (bodySignals.footnoteReferenceCount || 0) >= 1;
    if (!sourceHeavy) return [];

    const items = [];
    const lineReplaceRange = new vscode.Range(
        new vscode.Position(position.line, 0),
        new vscode.Position(position.line, line.length)
    );
    const allowQuoteSnippets = trimmedBefore === '' || /^\s*>\s*/.test(textBeforeCursor);
    const allowHeadingSnippets = trimmedBefore === '' || /^\s*#{1,3}\s*[^#]*$/.test(textBeforeCursor);

    if (allowQuoteSnippets) {
        const quoteSource = new vscode.CompletionItem('Quote from linked source', vscode.CompletionItemKind.Snippet);
        quoteSource.insertText = new vscode.SnippetString('> From [[source-note]]\n> ${1:Quoted passage here.}');
        quoteSource.range = lineReplaceRange;
        quoteSource.detail = 'Source-aware quote block';
        quoteSource.sortText = '0300';
        items.push(quoteSource);

        const quoteSection = new vscode.CompletionItem('Quote from linked section', vscode.CompletionItemKind.Snippet);
        quoteSection.insertText = new vscode.SnippetString('> From [[source-note#Heading]]\n> ${1:Quoted passage here.}');
        quoteSection.range = lineReplaceRange;
        quoteSection.detail = 'Source-aware quote block with heading anchor';
        quoteSection.sortText = '0301';
        items.push(quoteSection);
    }

    if (allowHeadingSnippets) {
        const evidenceHeading = new vscode.CompletionItem('## Evidence', vscode.CompletionItemKind.Snippet);
        evidenceHeading.insertText = '## Evidence';
        evidenceHeading.range = lineReplaceRange;
        evidenceHeading.detail = 'Longform heading suggestion';
        evidenceHeading.sortText = '0310';
        items.push(evidenceHeading);

        const referencesHeading = new vscode.CompletionItem('## References', vscode.CompletionItemKind.Snippet);
        referencesHeading.insertText = '## References';
        referencesHeading.range = lineReplaceRange;
        referencesHeading.detail = 'Longform heading suggestion';
        referencesHeading.sortText = '0311';
        items.push(referencesHeading);
    }

    const undefinedRefs = collectUndefinedFootnoteReferences(document.getText());
    if (trimmedBefore === '' || /^\[\^[^\]]*\]:?\s*$/.test(trimmedBefore)) {
        undefinedRefs.slice(0, 6).forEach((id, index) => {
            const item = new vscode.CompletionItem(`[^${id}]:`, vscode.CompletionItemKind.Snippet);
            item.insertText = new vscode.SnippetString(`[^${id}]: \${1:Source detail}`);
            item.range = lineReplaceRange;
            item.detail = 'Define missing footnote';
            item.sortText = `032${String(index).padStart(2, '0')}`;
            items.push(item);
        });
    }

    return items;
}

function inferBootstrapNoteTypes(document, adaptiveContext) {
    const likely = new Set();
    for (const archetype of extractDocumentArchetype(document, null)) {
        if (archetype) likely.add(archetype);
    }
    const priors = getCachedPriors(getFieldsCache(), getVaultGeneration());
    const noteRole = adaptiveContext?.intelligence?.noteRole;
    const proxyType = noteRole?.noteRole
        ? priors.noteRoleTypePriors.get(noteRole.noteRole)?.dominantType || ''
        : '';
    if (proxyType) likely.add(proxyType);
    return [...likely].filter(Boolean);
}

function buildPreTypeBootstrapItems(document, partialKey, adaptiveContext) {
    const likelyTypes = inferBootstrapNoteTypes(document, adaptiveContext);
    const topType = likelyTypes[0] || '';
    const items = [];

    if ('type'.startsWith(String(partialKey || '').toLowerCase())) {
        const item = new vscode.CompletionItem('type', vscode.CompletionItemKind.Field);
        item.detail = topType
            ? `Set note identity first · likely ${topType}`
            : 'Set note identity first';
        item.insertText = topType
            ? new vscode.SnippetString(`type: ${topType}`)
            : new vscode.SnippetString('type: ${1|account,contact,mission,character,task,project,note|}');
        item.sortText = '000-type';
        items.push(item);
    }

    return items;
}

function registerCompletion(context, getIndex) {
    let relationSuggestTimer = null;
    let lastRelationSuggestSignature = '';

    function maybeTriggerRelationSuggest(editor) {
        if (!editor || editor.document.languageId !== 'markdown') return;
        const position = editor.selection?.active;
        if (!position) return;
        const relationState = resolveFrontmatterRelationCandidates(editor.document, position, getIndex());
        if (!relationState || !isPositionInFrontmatter(editor.document, position.line)) return;
        if (!relationState.hasWiki) return;
        const candidateCount = (relationState.candidateIds || []).length;
        if (!candidateCount && !relationState.missingTargetType) return;
        const signature = [
            editor.document.uri.fsPath,
            editor.document.version,
            position.line,
            position.character,
            relationState.fieldName,
            relationState.partial,
            relationState.hasWiki ? 'wiki' : 'plain'
        ].join(':');
        if (signature === lastRelationSuggestSignature) return;
        lastRelationSuggestSignature = signature;
        clearTimeout(relationSuggestTimer);
        relationSuggestTimer = setTimeout(() => {
            vscode.commands.executeCommand('editor.action.triggerSuggest');
        }, 90);
    }

    context.subscriptions.push({
        dispose() {
            clearTimeout(relationSuggestTimer);
        }
    });

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection((event) => {
            maybeTriggerRelationSuggest(event.textEditor);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document !== event.document) return;
            maybeTriggerRelationSuggest(editor);
        })
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'markdown',
            {
                provideCompletionItems(document, position, _token, completionContext) {
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
                            if (frontmatterRelation.fieldName && !frontmatterRelation.hasWiki) {
                                const docTypeForClass = getDocumentType(document);
                                const schemaForClass = getSchema(docTypeForClass);
                                const schemaFieldDef = schemaForClass?.fields?.[frontmatterRelation.fieldName] || null;
                                const fieldsCache = getFieldsCache();
                                const noteFields = extractFrontmatterFields(document);
                                const bodyWikilinkCounts = extractBodyMentionedIds(document.getText());
                                const noteRole = inferNoteRole(noteFields || {}, {});
                                const classification = classifyField(frontmatterRelation.fieldName, {
                                    schemaFieldDef,
                                    noteFields,
                                    bodyWikilinkCounts,
                                    noteRole: noteRole.noteRole ? noteRole : null,
                                    ...buildClassificationSignals(docTypeForClass, fieldsCache)
                                });
                                const plan = planFieldActions(classification, 'completion');
                                if (plan.level < LEVEL.COMPLETION_ONLY) return undefined;
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
                            return createItems(getKnownTypeCandidates(), vscode.CompletionItemKind.EnumMember, 'Known or likely note type');
                        }

                        return undefined;
                    });
                }
            },
            '[', ':', '@'
        )
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'markdown',
            {
                provideCompletionItems(document, position) {
                    return perfTracker.measureSync('completion.frontmatterProvider', { budgetMs: 30 }, () => {
                        if (!isPositionInFrontmatter(document, position.line)) return undefined;
                        const line = document.lineAt(position.line).text;
                        const trimmed = line.trimStart();
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
            }
        )
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'markdown',
            {
                provideCompletionItems(document, position) {
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
                        const values = collectScalarValues(fieldName, queryType).filter(v => v.toLowerCase().startsWith(partial));
                        return values.map(v => {
                            const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.Value);
                            item.range = makeReplaceRange(document, position, partial.length);
                            return item;
                        });
                    }

                        return undefined;
                    });
                }
            },
            ' ', '=', ',', '['
        )
    );
}

module.exports = {
    registerCompletion,
    buildDateShortcutItems,
    buildHeadingAnchorItems,
    buildFootnoteReferenceItems,
    buildLongformBodyStructureItems,
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
    collectDriftMissingFieldSuggestions,
    collectLocalLinkedIds,
    collectObservedRelationUsage,
    rankCandidateIds,
    buildFieldInferenceDetail,
    resolveQueryRelationCandidates,
    shouldOfferFrontmatterRelationCompletion,
    buildPreTypeBootstrapItems
};
