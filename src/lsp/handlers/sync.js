'use strict';

const { notify }       = require('../transport');
const { requestRebuild, collectTextDiagnostics } = require('../vaultService');

function positionToOffset(text, position) {
    const targetLine = Math.max(0, position?.line || 0);
    const targetCharacter = Math.max(0, position?.character || 0);
    let line = 0;
    let offset = 0;

    while (line < targetLine && offset < text.length) {
        const nextBreak = text.indexOf('\n', offset);
        if (nextBreak === -1) return text.length;
        offset = nextBreak + 1;
        line += 1;
    }

    return Math.min(offset + targetCharacter, text.length);
}

function applyContentChanges(originalText, contentChanges) {
    let text = String(originalText || '');

    for (const change of contentChanges) {
        if (!change || typeof change.text !== 'string') continue;
        if (!change.range) {
            text = change.text;
            continue;
        }

        const start = positionToOffset(text, change.range.start);
        const end = positionToOffset(text, change.range.end);
        text = text.slice(0, start) + change.text + text.slice(end);
    }

    return text;
}

function handleDidOpen(msg, state) {
    const { textDocument } = msg.params || {};
    if (!textDocument) return;
    state.openDocs.set(textDocument.uri, textDocument.text || '');
    state.openDocVersions.set(textDocument.uri, Number.isFinite(textDocument.version) ? textDocument.version : null);
    const diagnostics = collectTextDiagnostics(textDocument.uri, state);
    notify('textDocument/publishDiagnostics', { uri: textDocument.uri, diagnostics });
}

function handleDidChange(msg, state) {
    const { textDocument, contentChanges } = msg.params || {};
    if (!textDocument || !Array.isArray(contentChanges)) return;
    const incomingVersion = Number.isFinite(textDocument.version) ? textDocument.version : null;
    const currentVersion = state.openDocVersions.has(textDocument.uri)
        ? state.openDocVersions.get(textDocument.uri)
        : null;
    if (
        incomingVersion != null
        && currentVersion != null
        && incomingVersion < currentVersion
    ) {
        return;
    }
    const currentText = state.openDocs.get(textDocument.uri) || '';
    const nextText = applyContentChanges(currentText, contentChanges);
    state.openDocs.set(textDocument.uri, nextText);
    state.openDocVersions.set(textDocument.uri, incomingVersion);
    const diagnostics = collectTextDiagnostics(textDocument.uri, state);
    notify('textDocument/publishDiagnostics', { uri: textDocument.uri, diagnostics });
}

function handleDidClose(msg, state) {
    const { textDocument } = msg.params || {};
    if (textDocument) {
        state.openDocs.delete(textDocument.uri);
        state.openDocVersions.delete(textDocument.uri);
        notify('textDocument/publishDiagnostics', { uri: textDocument.uri, diagnostics: [] });
    }
}

async function handleDidChangeWatchedFiles(msg, state) {
    const changes = (msg.params && msg.params.changes) || [];
    const hasMd = changes.some(c => String(c.uri || '').endsWith('.md'));
    if (hasMd) {
        state.linkTokenIndex = null;
        await requestRebuild(state);
    }
}

module.exports = { handleDidOpen, handleDidChange, handleDidClose, handleDidChangeWatchedFiles };
