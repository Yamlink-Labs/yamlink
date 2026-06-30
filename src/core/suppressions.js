'use strict';

// Vault-persistent per-note suggestion suppression.
// Stored in .yamlink/suppress.json as { [noteId]: { [key]: true } }
//
// Keys in use:
//   querySuggestion — suppress "view suggestions available" hints for a note

const fs = require('fs');
const path = require('path');

let _suppressPath = null;
let _data = {};

function initSuppressions(yamLinkDir) {
    _suppressPath = path.join(yamLinkDir, 'suppress.json');
    try {
        const raw = JSON.parse(fs.readFileSync(_suppressPath, 'utf8'));
        _data = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    } catch (_) {
        _data = {};
    }
}

function isSuppressed(noteId, key) {
    return Boolean(noteId && key && _data[noteId]?.[key]);
}

function suppress(noteId, key) {
    if (!noteId || !key) return;
    if (!_data[noteId]) _data[noteId] = {};
    _data[noteId][key] = true;
    _write();
}

function _write() {
    if (!_suppressPath) return;
    try { fs.writeFileSync(_suppressPath, JSON.stringify(_data, null, 2), 'utf8'); } catch (_) {}
}

module.exports = { initSuppressions, isSuppressed, suppress };
