'use strict';

const { respond, respondError } = require('../transport');
const { buildFormattedFrontmatterContent, buildFullDocumentEdit } = require('../documentHelpers');
const { CONTENT_MODIFIED, isStaleDocumentRequest, getDocumentText } = require('../documentState');

function handleFormatting(msg, state) {
    const textDocument = msg?.params?.textDocument || null;
    const uri = textDocument?.uri || null;
    if (!uri) { respond(msg.id, []); return; }
    if (isStaleDocumentRequest(state, uri, textDocument?.version)) {
        respondError(msg.id, CONTENT_MODIFIED, 'Content modified');
        return;
    }

    const content = getDocumentText(state, uri);
    const formatted = buildFormattedFrontmatterContent(uri, content);
    if (!formatted || formatted === content) {
        respond(msg.id, []);
        return;
    }

    const edit = buildFullDocumentEdit(uri, content, formatted);
    respond(msg.id, edit.changes[uri]);
}

module.exports = { handleFormatting };
