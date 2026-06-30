'use strict';

const { getFieldsCache, getVaultGeneration, getIndex, getAliasIndex } = require('../../core/indexService');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { CONTENT_MODIFIED, isStaleDocumentRequest, getDocumentText } = require('../documentState');
const { respond, respondError } = require('../transport');
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
            const lineText = content.split('\n')[diag?.data?.line || 0] || '';
            const fieldMatch = /^\s*([\w-]+)\s*:/.exec(lineText);
            const inferredType = inferTargetTypeFromField(fieldMatch ? fieldMatch[1].toLowerCase() : '', priors) || 'note';

            actions.push({
                title: `Create note "${brokenId}"`,
                kind: 'quickfix',
                diagnostics: [diag],
                isPreferred: true,
                edit: buildCreateNoteEdit(state.vaultPath, brokenId, inferredType)
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
    const { textDocument, context } = msg.params || {};
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
