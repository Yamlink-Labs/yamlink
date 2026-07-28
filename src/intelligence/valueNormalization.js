'use strict';

const { getFieldsCache } = require('../core/indexService');
const { levenshtein } = require('./queryDiagnostics');

const FUZZY_MAX_DISTANCE = 2;

/** @param {string} value @returns {string} */
function normalizeForComparison(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Collects every *distinct literal* scalar value on `fieldName` across notes
 * of `queryType`, with how many notes use each exact string. Deliberately
 * NOT deduped by normalized form — unlike `rankScalarValues` in
 * `completionRelationHelpers.js` (which collapses "Buenos Aires" and "buenos
 * aires" into one representative candidate, correct for a completion
 * dropdown that shouldn't show near-identical entries twice), near-duplicate
 * *detection* needs to see every distinct casing to compare them against
 * each other — collapsing them here would hide the exact thing this module
 * exists to find.
 *
 * @param {string} fieldName
 * @param {string|null} queryType
 * @returns {{ value: string, count: number }[]}
 */
function collectDistinctScalarValues(fieldName, queryType) {
    const fieldsCache = getFieldsCache();
    const normalizedType = String(queryType || '').trim().toLowerCase();
    const counts = new Map();
    for (const fields of fieldsCache.values()) {
        const nodeType = String(fields?.type || '').trim().toLowerCase();
        if (normalizedType && normalizedType !== '*' && nodeType !== normalizedType) continue;
        const raw = String(fields?.[fieldName] ?? '').trim();
        if (!raw || /\[\[[^\]]+\]\]/.test(raw)) continue;
        counts.set(raw, (counts.get(raw) || 0) + 1);
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count }));
}

/**
 * Flags a scalar frontmatter value as a likely near-duplicate of a
 * *different* value already present elsewhere in the vault on the same
 * field (e.g. "Buenos Aires" vs "buenos aires") — a lightweight HINT, never
 * an automatic rewrite. Only ever compares against notes of the same type
 * on the same field, so a "status" field on `contact` notes is never
 * compared against a "status" field on `mission` notes.
 *
 * Deliberately does NOT bail out just because the candidate string already
 * exists verbatim somewhere in the vault (e.g. validating a note against its
 * own already-saved value) — a note whose own value is "buenos aires" must
 * still be flagged if some *other* note has "Buenos Aires", since that's
 * exactly the inconsistency this exists to catch. It only ever matches
 * against a distinct literal value different from the candidate itself.
 *
 * Two distinct match qualities, deliberately not collapsed into one:
 * - `normalized` — some other literal value normalizes to the same thing
 *   once case/whitespace differences are ignored. High confidence: this is
 *   almost certainly the same real-world value written inconsistently.
 * - `fuzzy` — a small edit distance (typo-level) to some other literal
 *   value, but not a normalized match. Lower confidence: could be a genuine
 *   typo, or could be two legitimately different short values that happen
 *   to be close (e.g. "active"/"stale").
 *
 * @param {string} fieldName
 * @param {string} candidateValue
 * @param {string|null} queryType
 * @returns {{ value: string, count: number, matchType: 'normalized'|'fuzzy' } | null}
 */
function findNearDuplicateScalarValue(fieldName, candidateValue, queryType) {
    const trimmedCandidate = String(candidateValue || '').trim();
    if (!trimmedCandidate) return null;

    const distinctValues = collectDistinctScalarValues(fieldName, queryType);
    if (!distinctValues.length) return null;

    const normalizedCandidate = normalizeForComparison(trimmedCandidate);

    const normalizedMatch = distinctValues.find(
        (entry) => entry.value !== trimmedCandidate && normalizeForComparison(entry.value) === normalizedCandidate
    );
    if (normalizedMatch) {
        return { value: normalizedMatch.value, count: normalizedMatch.count, matchType: 'normalized' };
    }

    /** @type {{ value: string, count: number, matchType: 'fuzzy', distance: number } | null} */
    let best = null;
    for (const entry of distinctValues) {
        if (entry.value === trimmedCandidate) continue;
        const distance = levenshtein(normalizedCandidate, normalizeForComparison(entry.value));
        if (distance === 0 || distance > FUZZY_MAX_DISTANCE) continue;
        if (!best || distance < best.distance) {
            best = { value: entry.value, count: entry.count, matchType: 'fuzzy', distance };
        }
    }
    if (!best) return null;
    return { value: best.value, count: best.count, matchType: best.matchType };
}

module.exports = {
    findNearDuplicateScalarValue
};
