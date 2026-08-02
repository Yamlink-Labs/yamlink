'use strict';
// Pure publish/export layer shared by `yamlink build` and `yamlink export`.
// No VS Code imports. Reads already-built fieldsCache/idIndex — never touches disk itself.

const { resolveLinkedTarget, parseLinkedTargetParts } = require('./id');

// [^\]\r\n] — deliberately excludes newlines from the capture group. A bare
// `[[` in prose (e.g. "type `[[` to trigger autocomplete", illustrating the
// trigger character rather than opening a real link) has no matching `]]`
// on its own line; without the newline exclusion, the regex would hunt
// forward across paragraphs for the next `]]` anywhere in the text and
// swallow everything in between as one giant "link target" — confirmed via
// the real sample vault's welcome.md, which does exactly this.
const INLINE_WIKILINK_RE = /\[\[([^\]\r\n]+)\]\]/g;

// Statuses this closed vocabulary recognizes. Anything else in a `status:`
// field is treated the same as no status at all — a reliable structural
// check, not a fuzzy string match.
const DRAFT_STATUS = 'draft';
const ARCHIVED_STATUS = 'archived';
const PUBLISHED_STATUS = 'published';

/** @param {Record<string, any>} fields @returns {string|null} */
function getPublishStatus(fields) {
    const raw = fields && fields.status != null ? String(fields.status).trim().toLowerCase() : '';
    if (raw === DRAFT_STATUS || raw === ARCHIVED_STATUS || raw === PUBLISHED_STATUS) return raw;
    return null;
}

/**
 * Read-side query behavior (!view, completions, hover, diagnostics) never
 * calls this — it exists only for publish/export-time surfaces. A vault
 * that never sets `status:` sees every note as publishable, unconditionally.
 * @param {Record<string, any>} fields
 * @param {{ mode?: 'production'|'preview' }} [options]
 * @returns {boolean}
 */
function isPublishable(fields, options) {
    const mode = (options && options.mode) === 'preview' ? 'preview' : 'production';
    const status = getPublishStatus(fields);
    if (status === ARCHIVED_STATUS) return false;
    if (status === DRAFT_STATUS) return mode === 'preview';
    return true;
}

/**
 * Canonical id doubles as the slug — both are already kebab-case per
 * `core/id.js`'s canonicalizeId. No separate slug field to keep in sync.
 * @param {string} id
 * @returns {string}
 */
function getSlug(id) {
    return String(id || '').trim();
}

/**
 * Recognized manual-ordering convention: a numeric `order:` frontmatter
 * field. Notes without it sort after every note that has one, in their
 * original relative order (stable) — honest "no guaranteed order" rather
 * than inventing one.
 * @param {Record<string, any>} fields
 * @returns {number|null}
 */
function getOrder(fields) {
    const raw = fields ? fields.order : undefined;
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

/**
 * Stable sort by `order:` ascending; notes without a valid `order:` sort
 * after every note that has one, preserving their relative input order.
 * @param {Array<{ id: string, fields: Record<string, any> }>} notes
 * @returns {Array<{ id: string, fields: Record<string, any> }>}
 */
function sortByOrder(notes) {
    return notes
        .map((note, index) => ({ note, index, order: getOrder(note.fields) }))
        .sort((a, b) => {
            if (a.order === null && b.order === null) return a.index - b.index;
            if (a.order === null) return 1;
            if (b.order === null) return -1;
            if (a.order !== b.order) return a.order - b.order;
            return a.index - b.index;
        })
        .map((entry) => entry.note);
}

/**
 * @param {string} line
 * @param {Map<string, string>} idIndex
 * @param {Map<string, string>} [aliasIndex]
 * @returns {string}
 */
function resolveLinksInLine(line, idIndex, aliasIndex) {
    let result = '';
    let lastIndex = 0;
    INLINE_WIKILINK_RE.lastIndex = 0;
    let match;
    while ((match = INLINE_WIKILINK_RE.exec(line)) !== null) {
        result += line.slice(lastIndex, match.index);
        const parts = parseLinkedTargetParts(match[1]);
        const displayText = parts.label || parts.target || match[1];
        const resolvedId = idIndex ? resolveLinkedTarget(match[1], idIndex, aliasIndex) : null;
        result += resolvedId ? `[${displayText}](/${getSlug(resolvedId)})` : displayText;
        lastIndex = match.index + match[0].length;
    }
    result += line.slice(lastIndex);
    return result;
}

const FENCE_LINE_RE = /^\s*(`{3,}|~{3,})/;

/**
 * Walks text line by line, tracking fenced code block state (```/~~~), and
 * calls `transformLine` only on lines outside a fence — a fenced example
 * showing `[[wikilink]]` syntax (like a "how links work" tutorial note) is
 * documentation, not a real reference, and must never be resolved or
 * flagged as broken.
 * @param {string} text
 * @param {(line: string) => string} transformLine
 * @returns {string}
 */
function mapLinesOutsideFences(text, transformLine) {
    const lines = String(text || '').split('\n');
    let inFence = false;
    let fenceMarker = '';
    return lines.map((line) => {
        const fenceMatch = line.match(FENCE_LINE_RE);
        if (fenceMatch) {
            if (!inFence) { inFence = true; fenceMarker = fenceMatch[1][0]; }
            else if (line.trim().startsWith(fenceMarker)) inFence = false;
            return line;
        }
        if (inFence) return line;
        return transformLine(line);
    }).join('\n');
}

/**
 * @param {string} text
 * @param {Map<string, string>} idIndex
 * @param {Map<string, string>} [aliasIndex]
 * @returns {string}
 */
function resolvePublishLinks(text, idIndex, aliasIndex) {
    return mapLinesOutsideFences(text, (line) => resolveLinksInLine(line, idIndex, aliasIndex));
}

/**
 * Returns only the lines of `text` outside a fenced code block, joined —
 * used to scan for real `[[wikilink]]` references (e.g. the pre-publish
 * safety gate) without tripping on documentation/example syntax shown
 * inside a fence.
 * @param {string} text
 * @returns {string}
 */
function filterOutFencedLines(text) {
    const lines = String(text || '').split('\n');
    let inFence = false;
    let fenceMarker = '';
    const kept = [];
    for (const line of lines) {
        const fenceMatch = line.match(FENCE_LINE_RE);
        if (fenceMatch) {
            if (!inFence) { inFence = true; fenceMarker = fenceMatch[1][0]; }
            else if (line.trim().startsWith(fenceMarker)) inFence = false;
            continue;
        }
        if (inFence) continue;
        kept.push(line);
    }
    return kept.join('\n');
}

/**
 * Resolves every `[[wikilink]]` occurrence in a plain (non-Markdown-target)
 * frontmatter field value to a bare relative URL — no label, no Markdown
 * link syntax, since a frontmatter relation field is structured data, not
 * prose. Unresolvable targets fall back to their raw target text.
 * @param {string} text
 * @param {Map<string, string>} idIndex
 * @param {Map<string, string>} [aliasIndex]
 * @returns {string}
 */
function resolvePublishFieldValue(text, idIndex, aliasIndex) {
    const raw = String(text || '');
    let result = '';
    let lastIndex = 0;
    INLINE_WIKILINK_RE.lastIndex = 0;
    let match;
    while ((match = INLINE_WIKILINK_RE.exec(raw)) !== null) {
        result += raw.slice(lastIndex, match.index);
        const parts = parseLinkedTargetParts(match[1]);
        const resolvedId = idIndex ? resolveLinkedTarget(match[1], idIndex, aliasIndex) : null;
        result += resolvedId ? `/${getSlug(resolvedId)}` : (parts.target || match[1]);
        lastIndex = match.index + match[0].length;
    }
    result += raw.slice(lastIndex);
    return result;
}

module.exports = {
    getPublishStatus,
    isPublishable,
    getSlug,
    getOrder,
    sortByOrder,
    resolvePublishLinks,
    resolvePublishFieldValue,
    filterOutFencedLines,
    DRAFT_STATUS,
    ARCHIVED_STATUS,
    PUBLISHED_STATUS
};
