// src/engine/suggestions.js
//
// Single source of truth for query suggestion logic.
// Imported by both diagnostics.js and codeActions.js so the two
// systems can never disagree about what constitutes a suggestion.
//
// Key design decisions:
//
//   • Groups by (field, sourceType) — a consistent relation pattern
//     means a single type flowing through a single field name.
//     Mixed-type patterns (contacts + meetings both via "account")
//     are intentionally kept separate; a single query can't express
//     a union of types cleanly.
//
//   • queryAlreadyExists() normalises whitespace before matching so
//     multi-line !view blocks don't produce duplicate suggestions.
//
//   • No state held here — pure functions, safe to call any time.

const { getBacklinks } = require('../core/graph');
const { getFieldsCache } = require('../core/index');

// Must stay in sync with the same constant in diagnostics.js and codeActions.js.
// Single definition here; both files import it.
const QUERY_SUGGESTION_THRESHOLD = 2;

// ─────────────────────────────────────────────────────────────────
// queryAlreadyExists
//
// Returns true if the document text already contains a !view query
// that is semantically equivalent to the proposed one, regardless
// of whether the user wrote it on one line or multiple lines.
//
//   Single-line:  !view incoming mission via commander
//   Multi-line:   !view mission
//                 where commander = [[johnny-rico]]
//
// Both are detected as existing.
// ─────────────────────────────────────────────────────────────────
function queryAlreadyExists(text, sourceType, field, nodeId) {
    // Collapse all whitespace runs to a single space for normalised matching.
    // This catches any combination of spaces, tabs, and newlines between tokens.
    const flat = text.replace(/[ \t]*\r?\n[ \t]*/g, ' ').replace(/  +/g, ' ');
    // Check current via-style incoming queries (canonical format)
    if (flat.includes(`!view incoming ${sourceType} via ${field}`)) return true;
    // Check the short-lived forward via format for backward compatibility
    if (flat.includes(`!view ${sourceType} via ${field}`)) return true;
    // Check legacy where-style queries so existing notes don't get duplicate suggestions
    if (nodeId && flat.includes(`!view ${sourceType} where ${field} = [[${nodeId}]]`)) return true;
    return false;
}

// ─────────────────────────────────────────────────────────────────
// computeSuggestionsForNode
//
// Returns an array of suggestion objects for a given node ID.
// Each object describes one (field, sourceType) group that has
// reached the threshold and doesn't already have a matching view.
//
// Parameters:
//   nodeId  — the ID of the node being examined (the target of backlinks)
//   docText — current text of the node's document (used to skip
//             suggestions that are already written in the file).
//             Pass null to skip the "already exists" check.
//
// Returns: [{ field, sourceType, count, queryText }]
// ─────────────────────────────────────────────────────────────────
function computeSuggestionsForNode(nodeId, docText) {
    const backlinks = getBacklinks(nodeId);
    const fCache    = getFieldsCache();
    const groups    = new Map();

    for (const { field, sourceId } of backlinks) {
        if (field === 'body') continue;            // prose mentions are noise
        const sf = fCache.get(sourceId);
        if (!sf) continue;
        const st = (sf.type || '').trim().toLowerCase();
        if (!st) continue;
        const key = `${field}\x00${st}`;
        groups.set(key, (groups.get(key) || 0) + 1);
    }

    const results = [];
    for (const [key, count] of groups.entries()) {
        if (count < QUERY_SUGGESTION_THRESHOLD) continue;
        const [field, sourceType] = key.split('\x00');
        const queryText = `!view incoming ${sourceType}\nvia ${field}`;
        if (docText !== null && queryAlreadyExists(docText, sourceType, field, nodeId)) continue;
        results.push({ field, sourceType, count, queryText });
    }

    return results;
}

module.exports = { computeSuggestionsForNode, queryAlreadyExists, QUERY_SUGGESTION_THRESHOLD };
