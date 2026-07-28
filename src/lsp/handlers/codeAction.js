'use strict';

const { getFieldsCache, getVaultGeneration, getIndex, getAliasIndex } = require('../../core/indexService');
const { resolveYamlFieldNameForLine } = require('../../core/frontmatter');
const { getCachedPriors, getCommonFieldsForType } = require('../../intelligence/vaultPriors');
const {
    resolveFrontmatterRelationCandidates,
    rankCandidateIds,
    rankScalarValues
} = require('../../intelligence/completionRelationHelpers');
const { getSchema } = require('../../registries/schemaRegistry');
const { CONTENT_MODIFIED, isStaleDocumentRequest, getDocumentText } = require('../documentState');
const { respond, respondError } = require('../transport');
const { uriToPath } = require('../utils');
const {
    buildCreateNoteEdit,
    buildScaffoldIdentityEdit,
    insertFieldsBeforeClosing,
    replaceFrontmatterFieldValue,
    suggestUniqueId,
    inferSchemaTarget,
    inferTargetTypeFromField,
    buildFormattedFrontmatterContent,
    buildFullDocumentEdit,
    collectMissingFieldsForNote,
    buildConvertRelationFieldsEdit,
    extractDocumentNoteId
} = require('../documentHelpers');

// Direct port of viewLightbulb.js's buildTypedEmptyFieldFallbackActions — the
// bounded, testable slice of VS Code's adaptive-frontmatter lightbulb (the
// full feature is a much larger webview-adjacent UI system not being ported).
// For an empty field on a typed note that's either schema-required or
// commonly used for that type, offers "Use X for field?" quickfixes using
// the same candidate-ranking logic as completion.
function buildEmptyFieldQuickfixes(textDocument, range, state) {
    if (!range || typeof range.start?.line !== 'number') return [];
    const content = getDocumentText(state, textDocument.uri);
    const lines = content.split('\n');
    const lineIndex = range.start.line;
    const lineText = lines[lineIndex] || '';
    const emptyMatch = /^\s*([\w-]+):\s*$/.exec(lineText);
    if (!emptyMatch) return [];
    const fieldName = emptyMatch[1].trim().toLowerCase();
    if (fieldName === 'id' || fieldName === 'type') return [];

    let noteType = null;
    let seenOpeningFence = false;
    for (const l of lines) {
        if (l.trim() === '---') {
            if (!seenOpeningFence) { seenOpeningFence = true; continue; }
            break;
        }
        const typeMatch = /^type:\s+(\S+)/.exec(l);
        if (typeMatch && !noteType) noteType = typeMatch[1];
    }
    const normalizedType = noteType ? String(noteType).trim().toLowerCase() : null;
    if (!normalizedType) return [];

    const fieldsCache = getFieldsCache();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const schema = getSchema(normalizedType);
    const schemaField = schema?.fields?.[fieldName] || schema?.fields?.[fieldName.replace(/-/g, '_')] || null;
    const commonFields = getCommonFieldsForType(normalizedType, priors.typeFieldBundles, fieldsCache, { limit: 8, minRatio: 0.25 });
    const isExpectedField = Boolean(schemaField) || commonFields.some((entry) => String(entry.field || '').trim().toLowerCase() === fieldName);
    if (!isExpectedField) return [];

    const idIndex = getIndex();
    const documentAdapter = {
        getText: () => content,
        lineAt: (n) => ({ text: lines[n] || '' }),
        uri: { fsPath: uriToPath(textDocument.uri) }
    };
    const relationState = resolveFrontmatterRelationCandidates(
        documentAdapter, { line: lineIndex, character: lineText.length }, idIndex
    );
    // Direct port of viewLightbulb.js's buildTypedEmptyFieldFallbackActions —
    // same schema-less-vault fallback: a formal schema type is sufficient but
    // never required, since resolveFrontmatterRelationCandidates already
    // carries the same real-usage relation inference the completion dropdown
    // uses.
    const isRelation = String(schemaField?.type || '').trim().toLowerCase() === 'relation' || Boolean(relationState?.targetType);
    const actions = [];

    if (isRelation) {
        if (relationState) {
            const ranked = rankCandidateIds(
                relationState.candidateIds,
                relationState.partial,
                relationState.preferredIds,
                relationState.localLinkedIds,
                relationState.observedIdScores,
                relationState.rankingHints
            ).slice(0, 2);
            for (const id of ranked) {
                const edit = replaceFrontmatterFieldValue(textDocument.uri, content, fieldName, `[[${id}]]`);
                if (!edit) continue;
                actions.push({
                    title: `Use ${id} for ${fieldName}?`,
                    kind: 'quickfix',
                    isPreferred: actions.length === 0,
                    edit
                });
            }
        }
    } else {
        const rankedValues = rankScalarValues(fieldName, normalizedType).slice(0, 3);
        for (const { value } of rankedValues) {
            const edit = replaceFrontmatterFieldValue(textDocument.uri, content, fieldName, value);
            if (!edit) continue;
            actions.push({
                title: `Use ${value} for ${fieldName}?`,
                kind: 'quickfix',
                isPreferred: actions.length === 0,
                edit
            });
        }
    }

    return actions;
}

function buildQuickFixesForDocument(textDocument, diagnostics, state, options = {}) {
    const content = getDocumentText(state, textDocument.uri);
    const actions = [];
    const priors = getCachedPriors(getFieldsCache(), getVaultGeneration());

    for (const diag of diagnostics) {
        if (!diag?.message || diag.source !== 'yamlink') continue;
        const diagCode = String(diag.code || '').trim();

        if (diagCode === 'yamlink.missingId') {
            const scaffold = buildScaffoldIdentityEdit(textDocument.uri, content);
            if (scaffold?.edit) {
                actions.push({
                    title: 'Scaffold Yamlink identity frontmatter',
                    kind: 'quickfix',
                    diagnostics: [diag],
                    isPreferred: true,
                    edit: scaffold.edit
                });
            }
            continue;
        }

        if (diagCode === 'yamlink.duplicateId') {
            const suggestedId = suggestUniqueId(textDocument.uri, content, getIndex());
            if (!suggestedId) continue;
            const edit = replaceFrontmatterFieldValue(textDocument.uri, content, 'id', suggestedId);
            if (!edit) continue;
            actions.push({
                title: `Change id to "${suggestedId}"`,
                kind: 'quickfix',
                diagnostics: [diag],
                isPreferred: true,
                edit
            });
            continue;
        }

        if (diagCode === 'yamlink.brokenLink' || diagCode === 'yamlink.brokenRelation' || /Broken (?:link|relation): \[\[([^\]]+)\]\]/.test(diag.message)) {
            const messageMatch = /Broken (?:link|relation): \[\[([^\]]+)\]\]/.exec(diag.message);
            const brokenId = String(diag?.data?.targetId || (messageMatch ? messageMatch[1] : '')).trim();
            if (!brokenId) continue;
            const lineIndex = diag?.data?.line || 0;
            // Only walk upward for a parent field name inside frontmatter
            // (data.relation === true) — a body broken-link has no YAML
            // list-continuation concept, and scanning upward through arbitrary
            // prose could misattribute to an unrelated "Label:"-shaped line.
            const fieldName = diag?.data?.relation
                ? resolveYamlFieldNameForLine(content.split('\n'), lineIndex)
                : (() => {
                    const lineText = content.split('\n')[lineIndex] || '';
                    const fieldMatch = /^\s*([\w-]+)\s*:/.exec(lineText);
                    return fieldMatch ? fieldMatch[1].toLowerCase() : null;
                })();
            const inferredType = inferTargetTypeFromField(fieldName || '', priors) || 'note';

            // Structural autocomplete, Behavior B: only passed through when
            // this document is itself a real Yamlink note — buildCreateNoteEdit
            // only ever acts on it when there's real vault evidence anyway.
            const sourceId = extractDocumentNoteId(content);
            const sourceTypeMatch = /^type:\s+(\S+)/m.exec(content);
            const sourceType = sourceTypeMatch ? sourceTypeMatch[1].trim().toLowerCase() : null;
            const reverseLinkContext = sourceId && sourceType ? { sourceId, sourceType } : null;

            actions.push({
                title: inferredType !== 'note' ? `Create ${inferredType} note "${brokenId}"` : `Create note "${brokenId}"`,
                kind: 'quickfix',
                diagnostics: [diag],
                isPreferred: true,
                edit: buildCreateNoteEdit(state.vaultPath, brokenId, inferredType, reverseLinkContext)
            });
            continue;
        }

        if (diagCode === 'yamlink.malformedSchema') {
            const inferredTarget = inferSchemaTarget(textDocument.uri, content) || 'note';
            const edit = insertFieldsBeforeClosing(textDocument.uri, content, [{ key: 'target', value: inferredTarget }]);
            if (!edit) continue;
            actions.push({
                title: `Add schema target: ${inferredTarget}`,
                kind: 'quickfix',
                diagnostics: [diag],
                isPreferred: true,
                edit
            });
            continue;
        }

        if (diagCode === 'yamlink.duplicateSchema') {
            const inferredTarget = inferSchemaTarget(textDocument.uri, content);
            if (!inferredTarget) continue;
            const edit = replaceFrontmatterFieldValue(textDocument.uri, content, 'target', inferredTarget);
            if (!edit) continue;
            actions.push({
                title: `Retarget schema to "${inferredTarget}"`,
                kind: 'quickfix',
                diagnostics: [diag],
                isPreferred: false,
                edit
            });
            continue;
        }

        if (diagCode === 'yamlink.missingRequiredField' || diagCode === 'yamlink.templateDrift' || diagCode === 'yamlink.noteDrift') {
            const missingFields = Array.isArray(diag?.data?.missingFields) ? diag.data.missingFields : [];
            if (!missingFields.length) continue;
            const edit = insertFieldsBeforeClosing(
                textDocument.uri,
                content,
                missingFields.map((field) => ({ key: field, value: '' }))
            );
            if (!edit) continue;
            actions.push({
                title: `Add missing fields: ${missingFields.join(', ')}`,
                kind: 'quickfix',
                diagnostics: [diag],
                isPreferred: true,
                edit
            });
        }
    }

    if (options.workspace) {
        return actions.map((action) => ({
            ...action,
            data: {
                uri: textDocument.uri,
                scope: 'workspace'
            }
        }));
    }
    return actions;
}

function buildRefactorActionsForDocument(textDocument, state) {
    const content = getDocumentText(state, textDocument.uri);
    const actions = [];
    const priors = getCachedPriors(getFieldsCache(), getVaultGeneration());
    const idIndex = getIndex();
    const formatted = buildFormattedFrontmatterContent(textDocument.uri, content);
    if (formatted && formatted !== content) {
        actions.push({
            title: 'Normalize Yamlink frontmatter',
            kind: 'refactor.rewrite',
            isPreferred: true,
            edit: buildFullDocumentEdit(textDocument.uri, content, formatted)
        });
    }

    const noteId = extractDocumentNoteId(content);
    if (noteId) {
        const missing = collectMissingFieldsForNote(noteId, state.vaultPath).missingFields || [];
        if (missing.length) {
            const edit = insertFieldsBeforeClosing(
                textDocument.uri,
                content,
                missing.map((field) => ({ key: field, value: '' }))
            );
            if (edit) {
                actions.push({
                    title: `Add likely missing fields: ${missing.join(', ')}`,
                    kind: 'refactor.rewrite',
                    isPreferred: false,
                    edit
                });
            }
        }
    }

    const aliasIndex = getAliasIndex();
    const relationEdit = buildConvertRelationFieldsEdit(textDocument.uri, content, priors, idIndex, aliasIndex);
    if (relationEdit) {
        actions.push({
            title: 'Convert relation fields to wikilinks',
            kind: 'refactor.rewrite',
            isPreferred: false,
            edit: relationEdit
        });
    }

    return actions;
}

function handleCodeAction(msg, state) {
    const { textDocument, range, context } = msg.params || {};
    if (!textDocument) { respond(msg.id, []); return; }
    if (isStaleDocumentRequest(state, textDocument.uri, textDocument?.version)) {
        respondError(msg.id, CONTENT_MODIFIED, 'Content modified');
        return;
    }

    const only = Array.isArray(context?.only) ? context.only : null;
    const wantsQuickFix = !only || only.some((kind) => kind === 'quickfix' || kind.startsWith('quickfix.'));
    const wantsRefactorRewrite = !only || only.some((kind) => kind === 'refactor.rewrite' || kind.startsWith('refactor.rewrite.'));
    const actions = [];
    if (wantsQuickFix) {
        actions.push(...buildQuickFixesForDocument(textDocument, (context && context.diagnostics) || [], state));
        actions.push(...buildEmptyFieldQuickfixes(textDocument, range, state));
    }
    if (wantsRefactorRewrite) {
        actions.push(...buildRefactorActionsForDocument(textDocument, state));
    }
    respond(msg.id, actions);
}

function handleWorkspaceCodeAction(msg, state) {
    const items = msg?.params?.context?.items || msg?.params?.items || [];
    const actions = [];

    for (const item of items) {
        const uri = item?.uri;
        if (!uri || !Array.isArray(item.items) || item.items.length === 0) continue;
        actions.push(...buildQuickFixesForDocument({ uri }, item.items, state, { workspace: true }));
    }

    respond(msg.id, actions);
}

module.exports = {
    handleCodeAction,
    handleWorkspaceCodeAction
};
