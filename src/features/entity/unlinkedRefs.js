'use strict';

const fs = require('fs');

// Unlinked references — finds body text in other notes that mentions a note's
// name or id without a formal [[wikilink]].
//
// This is the Roam Research discovery pattern: organic mentions surface before
// the user formalises the link. "You mentioned this note 3 times in your
// research notes — maybe link them?"
//
// Detection is lazy (on Note Report open) and generation-cached so repeated
// panel interactions are free. Body reads are mtime-cached.

const WIKILINK_RE = /\[\[[^\]]+\]\]/g;
const MIN_TERM_LENGTH = 3;
const BODY_CACHE_MAX = 150;

const _bodyCache = new Map();

/** @returns {string|null} */
function _readBody(filePath) {
    if (!filePath) return null;
    let mtime = null;
    try { mtime = fs.statSync(filePath).mtimeMs; } catch (_) { return null; }
    const cached = _bodyCache.get(filePath);
    if (cached && cached.mtime === mtime) return cached.body;
    let raw = null;
    try { raw = fs.readFileSync(filePath, 'utf8'); } catch (_) { return null; }
    // Strip YAML frontmatter and return body only
    const body = raw.replace(/^---[\s\S]*?---\n?/, '');
    if (_bodyCache.size >= BODY_CACHE_MAX) {
        _bodyCache.delete(_bodyCache.keys().next().value);
    }
    _bodyCache.set(filePath, { mtime, body });
    return body;
}

/**
 * Build the set of text terms we look for in other notes' bodies.
 * We match the id (as a word) and the name/title field values.
 * Aliases are also included when present.
 *
 * @param {string} nodeId
 * @param {Record<string, any>} nodeFields
 * @returns {string[]}  lower-cased terms, deduplicated, min length 3
 */
function buildSearchTerms(nodeId, nodeFields) {
    const raw = new Set();
    if (nodeId && nodeId.length >= MIN_TERM_LENGTH) raw.add(nodeId.toLowerCase());

    const name = String(nodeFields.name || nodeFields.title || '').trim();
    if (name.length >= MIN_TERM_LENGTH) raw.add(name.toLowerCase());

    // Include aliases
    const aliases = nodeFields.aliases;
    const aliasList = Array.isArray(aliases)
        ? aliases
        : typeof aliases === 'string'
            ? aliases.split(',').map(a => a.trim())
            : [];
    for (const alias of aliasList) {
        const a = String(alias || '').trim().toLowerCase();
        if (a.length >= MIN_TERM_LENGTH) raw.add(a);
    }

    return [...raw];
}

/**
 * Test whether `term` appears in `body` as a plain-text mention
 * (not inside a [[wikilink]]).
 *
 * @param {string} body
 * @param {string} term  lower-cased
 * @returns {number}  count of unlinked occurrences (0 if none)
 */
function countUnlinkedOccurrences(body, term) {
    // Remove wikilink content so [[john-doe]] doesn't count as a mention of "john-doe"
    const stripped = body.replace(WIKILINK_RE, '[[LINK]]');
    const lower = stripped.toLowerCase();
    // Word-boundary match — the term must not be immediately preceded or followed by
    // a letter, number, or hyphen (to avoid matching "Rico" inside "Puerto Rico" as the
    // same entity, or "status" inside "statusReport")
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![a-z0-9-])${escaped}(?![a-z0-9-])`, 'gi');
    const matches = lower.match(pattern);
    return matches ? matches.length : 0;
}

// Generation-keyed cache so repeated Note Report opens are free.
let _cache = null;
let _cacheNodeId = null;
let _cacheGen = -1;

/**
 * Find all notes in the vault whose body text mentions `nodeId`'s name or id
 * without a formal wikilink.
 *
 * @param {string} nodeId
 * @param {Record<string, any>} nodeFields
 * @param {Map<string, string>} pathIndex   nodeId → absolute file path
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {number} vaultGeneration
 * @returns {Array<{ mentioningId: string, mentioningType: string, term: string, count: number }>}
 */
function findUnlinkedMentions(nodeId, nodeFields, pathIndex, fieldsCache, vaultGeneration) {
    if (_cache !== null && _cacheNodeId === nodeId && _cacheGen === vaultGeneration) {
        return _cache;
    }

    const terms = buildSearchTerms(nodeId, nodeFields);
    if (!terms.length) {
        _cache = [];
        _cacheNodeId = nodeId;
        _cacheGen = vaultGeneration;
        return _cache;
    }

    const results = [];

    for (const [id, filePath] of pathIndex) {
        if (id === nodeId) continue;
        const body = _readBody(filePath);
        if (!body) continue;

        let totalCount = 0;
        let matchedTerm = null;
        for (const term of terms) {
            const count = countUnlinkedOccurrences(body, term);
            if (count > 0) {
                totalCount += count;
                if (!matchedTerm) matchedTerm = term;
            }
        }

        if (totalCount > 0) {
            const mentioningType = String(fieldsCache.get(id)?.type || '').trim().toLowerCase();
            results.push({ mentioningId: id, mentioningType, term: matchedTerm, count: totalCount });
        }
    }

    // Sort by count descending so the most-mentioning notes surface first
    results.sort((a, b) => b.count - a.count || a.mentioningId.localeCompare(b.mentioningId));

    _cache = results;
    _cacheNodeId = nodeId;
    _cacheGen = vaultGeneration;
    return _cache;
}

/** @returns {void} */
function clearUnlinkedRefsCache() {
    _cache = null;
    _cacheNodeId = null;
    _cacheGen = -1;
}

module.exports = { findUnlinkedMentions, buildSearchTerms, countUnlinkedOccurrences, clearUnlinkedRefsCache };
