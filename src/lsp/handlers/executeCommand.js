'use strict';

const { respond, respondError } = require('../transport');
const { CONTENT_MODIFIED, isStaleDocumentRequest, getDocumentText } = require('../documentState');
const {
    buildArcSnapshot,
    buildFieldCategorySnapshot,
    buildNoteIntelligenceSnapshot
} = require('../../intelligence/intelligenceSnapshots');
const { getIndex } = require('../../core/indexService');
const {
    buildScaffoldIdentityEdit,
    collectMissingFieldsForNote,
    insertFieldsBeforeClosing
} = require('../documentHelpers');

const COMMANDS = Object.freeze({
    NOTE_INTELLIGENCE: 'yamlink.noteIntelligence',
    NOTE_ARC: 'yamlink.noteArc',
    FIELD_CATEGORY: 'yamlink.fieldCategory',
    ADD_MISSING_FIELDS: 'yamlink.addMissingFields',
    SCAFFOLD_IDENTITY: 'yamlink.scaffoldIdentity'
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

function handleExecuteCommand(msg, _state) {
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
        respond(id, {
            ok: true,
            id: noteId,
            missingFields,
            edit
        });
        return;
    }

    if (command === COMMANDS.SCAFFOLD_IDENTITY) {
        const uri = String(args.uri || '').trim();
        if (!uri) return invalidParams(id, 'Missing param: uri');
        if (isStaleDocumentRequest(_state, uri, args.version)) return contentModified(id);
        const content = _state.openDocs.get(uri);
        if (typeof content !== 'string') return invalidParams(id, 'Document not open: ' + uri);
        const result = buildScaffoldIdentityEdit(uri, content);
        if (!result) return invalidParams(id, 'Document already has Yamlink identity');
        respond(id, { ok: true, uri, ...result });
        return;
    }

    invalidParams(id, 'Unknown Yamlink command: ' + command);
}

module.exports = {
    COMMANDS,
    handleExecuteCommand
};
