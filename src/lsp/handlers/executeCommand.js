'use strict';

const { respond, respondError, request } = require('../transport');
const { CONTENT_MODIFIED, isStaleDocumentRequest, getDocumentText } = require('../documentState');
const {
    buildArcSnapshot,
    buildFieldCategorySnapshot,
    buildNoteIntelligenceSnapshot
} = require('../../intelligence/intelligenceSnapshots');
const { getIndex, getFieldsCache, getAliasIndex, getVaultGeneration } = require('../../core/indexService');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const {
    buildScaffoldIdentityEdit,
    buildFormattedFrontmatterContent,
    buildFullDocumentEdit,
    buildConvertRelationFieldsEdit,
    collectMissingFieldsForNote,
    insertFieldsBeforeClosing
} = require('../documentHelpers');

const COMMANDS = Object.freeze({
    NOTE_INTELLIGENCE: 'yamlink.noteIntelligence',
    NOTE_ARC: 'yamlink.noteArc',
    FIELD_CATEGORY: 'yamlink.fieldCategory',
    ADD_MISSING_FIELDS: 'yamlink.addMissingFields',
    SCAFFOLD_IDENTITY: 'yamlink.scaffoldIdentity',
    NORMALIZE_FRONTMATTER: 'yamlink.normalizeFrontmatter',
    CONVERT_RELATIONS: 'yamlink.convertRelations'
});

function firstArg(params) {
    return Array.isArray(params?.arguments) ? (params.arguments[0] || {}) : {};
}

function invalidParams(id, message) {
    respondError(id, -32602, message);
}

function contentModified(id) {
    respondError(id, CONTENT_MODIFIED, 'Content modified');
}

async function applyWorkspaceEdit(edit, label) {
    if (!edit) return { applied: false, failureReason: 'No edit generated' };
    try {
        const result = await request('workspace/applyEdit', { label, edit });
        return {
            applied: !!result?.applied,
            failureReason: result?.failureReason || null
        };
    } catch (error) {
        return {
            applied: false,
            failureReason: error && error.message ? error.message : 'workspace/applyEdit failed'
        };
    }
}

async function handleExecuteCommand(msg, _state) {
    const id = msg.id;
    const command = String(msg?.params?.command || '').trim();
    const args = firstArg(msg.params);

    if (command === COMMANDS.NOTE_INTELLIGENCE) {
        const noteId = String(args.id || '').trim();
        if (!noteId) return invalidParams(id, 'Missing param: id');
        const snapshot = buildNoteIntelligenceSnapshot(noteId);
        if (!snapshot) return invalidParams(id, 'Note not found: ' + noteId);
        respond(id, snapshot);
        return;
    }

    if (command === COMMANDS.NOTE_ARC) {
        const noteId = String(args.id || '').trim();
        if (!noteId) return invalidParams(id, 'Missing param: id');
        const snapshot = buildArcSnapshot(noteId);
        if (!snapshot) return invalidParams(id, 'Note not found: ' + noteId);
        respond(id, snapshot);
        return;
    }

    if (command === COMMANDS.FIELD_CATEGORY) {
        const noteId = String(args.id || '').trim();
        const field = String(args.field || '').trim();
        if (!noteId) return invalidParams(id, 'Missing param: id');
        if (!field) return invalidParams(id, 'Missing param: field');
        const snapshot = buildFieldCategorySnapshot(noteId, field);
        if (!snapshot) return invalidParams(id, 'Note not found: ' + noteId);
        respond(id, snapshot);
        return;
    }

    if (command === COMMANDS.ADD_MISSING_FIELDS) {
        const noteId = String(args.id || '').trim();
        if (!noteId) return invalidParams(id, 'Missing param: id');
        const idIndex = getIndex();
        if (!idIndex.has(noteId)) return invalidParams(id, 'Note not found: ' + noteId);
        const { missingFields } = collectMissingFieldsForNote(noteId, _state.vaultPath);
        const fileUri = idIndex.get(noteId).replace(/\\/g, '/').startsWith('/')
            ? 'file://' + idIndex.get(noteId).replace(/\\/g, '/')
            : 'file:///' + idIndex.get(noteId).replace(/\\/g, '/');
        if (isStaleDocumentRequest(_state, fileUri, args.version)) return contentModified(id);
        const content = getDocumentText(_state, fileUri);
        const edit = insertFieldsBeforeClosing(
            fileUri,
            content,
            missingFields.map((field) => ({ key: field, value: '' }))
        );
        const applyResult = await applyWorkspaceEdit(edit, `Yamlink: add missing fields to ${noteId}`);
        respond(id, {
            ok: true,
            id: noteId,
            missingFields,
            edit,
            applyEdit: applyResult
        });
        return;
    }

    if (command === COMMANDS.SCAFFOLD_IDENTITY) {
        const uri = String(args.uri || '').trim();
        if (!uri) return invalidParams(id, 'Missing param: uri');
        if (isStaleDocumentRequest(_state, uri, args.version)) return contentModified(id);
        const content = getDocumentText(_state, uri);
        const result = buildScaffoldIdentityEdit(uri, content);
        if (!result) return invalidParams(id, 'Document already has Yamlink identity');
        const applyResult = await applyWorkspaceEdit(result.edit, `Yamlink: scaffold identity for ${result.id}`);
        respond(id, { ok: true, uri, ...result, applyEdit: applyResult });
        return;
    }

    if (command === COMMANDS.NORMALIZE_FRONTMATTER) {
        const uri = String(args.uri || '').trim();
        if (!uri) return invalidParams(id, 'Missing param: uri');
        if (isStaleDocumentRequest(_state, uri, args.version)) return contentModified(id);
        const content = getDocumentText(_state, uri);
        const formatted = buildFormattedFrontmatterContent(uri, content);
        if (!formatted || formatted === content) return invalidParams(id, 'Document does not need frontmatter normalization');
        const edit = buildFullDocumentEdit(uri, content, formatted);
        const applyResult = await applyWorkspaceEdit(edit, 'Yamlink: normalize frontmatter');
        respond(id, {
            ok: true,
            uri,
            edit,
            applyEdit: applyResult
        });
        return;
    }

    if (command === COMMANDS.CONVERT_RELATIONS) {
        const uri = String(args.uri || '').trim();
        if (!uri) return invalidParams(id, 'Missing param: uri');
        if (isStaleDocumentRequest(_state, uri, args.version)) return contentModified(id);
        const content = getDocumentText(_state, uri);
        const priors = getCachedPriors(getFieldsCache(), getVaultGeneration());
        const edit = buildConvertRelationFieldsEdit(uri, content, priors, getIndex(), getAliasIndex());
        if (!edit) return invalidParams(id, 'Document has no scalar relation fields that can be converted');
        const applyResult = await applyWorkspaceEdit(edit, 'Yamlink: convert relation fields to wikilinks');
        respond(id, {
            ok: true,
            uri,
            edit,
            applyEdit: applyResult
        });
        return;
    }

    invalidParams(id, 'Unknown Yamlink command: ' + command);
}

module.exports = {
    COMMANDS,
    handleExecuteCommand
};
