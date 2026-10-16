'use strict';

// Real, I/O-backed implementation of the `resolveCrossNoteRef` callback
// scanInlineCalcs() accepts (see inlineCalc.js). Kept in its own file,
// separate from inlineCalc.js itself, so that module can stay exactly as
// pure/no-I/O as its own header comment already claims — this is the one
// place that actually touches the filesystem and the vault index for this
// feature.
//
// Deliberately single-hop: `scanInlineCalcs(otherNoteBody)` below is called
// with NO resolver of its own, so if the target note's own formula in turn
// references a third note, that nested reference simply fails inside the
// target note's own scan — not our problem to detect or prevent here. This
// is what keeps a cross-note cycle structurally impossible rather than
// something that needs a visited-set or depth counter.

const fs = require('fs');
const { scanInlineCalcs } = require('./inlineCalc');

function normalizeText(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripLeadingFrontmatter(content) {
    const normalized = normalizeText(content);
    if (/^\s*---/.test(normalized)) {
        const firstDash = normalized.indexOf('---');
        const closingIdx = normalized.indexOf('---', firstDash + 3);
        return closingIdx !== -1 ? normalized.slice(closingIdx + 3) : normalized;
    }
    return normalized;
}

/**
 * @param {string} filePath
 * @returns {string|null}
 */
function defaultReadBody(filePath) {
    try {
        return stripLeadingFrontmatter(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

/**
 * Builds a `resolveCrossNoteRef(noteId, label)` callback for scanInlineCalcs.
 * No caching — deliberately, matching calcHealth.js's own stated reasoning:
 * this isn't meant to be a hot path, and decorations.js already re-scans the
 * whole active note on every render with no cache of its own.
 *
 * @param {{ getIndex: () => Map<string,string>, readBody?: (filePath: string) => string|null }} deps
 * @returns {(noteId: string, label: string) => {ok: true, value: import('./mathExpr').ScalarValue} | {ok: false, reason: string}}
 */
function createCrossNoteResolver({ getIndex, readBody = defaultReadBody }) {
    return function resolveCrossNoteCell(noteId, label) {
        const normalizedId = String(noteId || '').trim().toLowerCase();
        if (!normalizedId) return { ok: false, reason: 'no note id given' };

        const filePath = getIndex().get(normalizedId);
        if (!filePath) return { ok: false, reason: `Reference broken: note "${noteId}" not found` };

        const body = readBody(filePath);
        if (!body) return { ok: false, reason: `Reference broken: note "${noteId}" is unreadable` };

        // findLast, not find: inlineCalc.js lets a name be redefined (a later
        // `name=expr` block simply overwrites the earlier one in that note's
        // own env), so a same-note reference to that name always sees the
        // LAST definition. Cross-note resolution must match that exactly —
        // `find()` would silently return the first definition instead,
        // disagreeing with what the target note's own formulas see.
        const blocks = scanInlineCalcs(body);
        let match = null;
        for (let i = blocks.length - 1; i >= 0; i--) {
            if (blocks[i].label === label || blocks[i].name === label) { match = blocks[i]; break; }
        }
        if (!match) return { ok: false, reason: `Reference broken: no cell named "${label}" in "${noteId}"` };
        if (!match.evalResult.ok) return { ok: false, reason: `Reference broken: "${noteId}^${label}" has its own error` };

        return { ok: true, value: match.evalResult.value };
    };
}

module.exports = { createCrossNoteResolver, defaultReadBody };
