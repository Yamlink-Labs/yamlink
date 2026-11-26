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
 * `publish:` is a dedicated boolean field for publish intent, independent of
 * `status:` — a vault's own `status:` field is often already used for
 * lifecycle meaning unrelated to publishing (`active`, `blocked`, `done`),
 * and a project should be able to be both `status: active` and publicly
 * published without a naming conflict. Accepts a real YAML boolean or the
 * string `"true"`/`"false"` (frontmatter values sometimes round-trip as
 * strings depending on how they were written).
 * @param {Record<string, any>} fields
 * @returns {boolean}
 */
function getPublishFlag(fields) {
    const raw = fields ? fields.publish : undefined;
    if (raw === true) return true;
    if (raw === false) return false;
    if (typeof raw === 'string') {
        const lowered = raw.trim().toLowerCase();
        if (lowered === 'true') return true;
        if (lowered === 'false') return false;
    }
    return null;
}

/**
 * Read-side query behavior (!view, completions, hover, diagnostics) never
 * calls this — it exists only for publish/export-time surfaces. Strict
 * opt-in: a note with neither `publish: true` nor `status: published` is
 * never publishable. A local-first, privacy-respecting product must never
 * treat "the author forgot to set a field" as "the author wants this
 * public" — the safe path is remembering to mark something public, not
 * remembering to mark it private.
 *
 * `status: archived` always wins over a stale `publish: true` left behind
 * on a note that's since been retired — an explicit "take this down" signal
 * should never be silently overridden by an older "make this public" one.
 * `publish:` is the primary, collision-free field; `status: published` is
 * kept working as an equivalent alias for continuity, and `status: draft`
 * still stages a note for review in preview mode only.
 * @param {Record<string, any>} fields
 * @param {{ mode?: 'production'|'preview' }} [options]
 * @returns {boolean}
 */
function isPublishable(fields, options) {
    const mode = (options && options.mode) === 'preview' ? 'preview' : 'production';
    const status = getPublishStatus(fields);
    if (status === ARCHIVED_STATUS) return false;
    if (getPublishFlag(fields) === true) return true;
    if (status === PUBLISHED_STATUS) return true;
    if (status === DRAFT_STATUS) return mode === 'preview';
    return false;
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
 * `fields.type` is free-form frontmatter text, not a validated identifier —
 * the publish pipeline uses it raw as a directory name under `notes/<type>/`.
 * Used unsanitized, a crafted `type: ../../../etc` lets a note write files
 * outside the publish output directory (confirmed, not theoretical:
 * `fs.mkdirSync(typeDir, { recursive: true })` happily creates every
 * traversed segment). Collapses to a closed-safe charset so the result can
 * never contain a path separator or a `..` segment — path.join() can then
 * never escape `outDir` no matter what `type:` says, so no separate
 * containment check is needed here the way image-embed resolution needs one
 * for real filesystem paths. Falls back to the same `_untyped` default
 * already used when `type:` is absent or sanitizes to nothing.
 * @param {Record<string, any>} fields
 * @returns {string}
 */
function getTypeSegment(fields) {
    const raw = fields && fields.type != null ? String(fields.type).trim() : '';
    if (!raw) return '_untyped';
    const safe = raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return safe || '_untyped';
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
 * @param {Set<string>} [publishableIds] When given, a resolved target not in this
 *   set is treated exactly like an unresolvable one: plain text, no slug, no hint
 *   that a private note by that name exists. A private note linked from a public
 *   one must never be distinguishable from a note that was never there at all.
 * @returns {string}
 */
function resolveLinksInLine(line, idIndex, aliasIndex, publishableIds) {
    let result = '';
    let lastIndex = 0;
    INLINE_WIKILINK_RE.lastIndex = 0;
    let match;
    while ((match = INLINE_WIKILINK_RE.exec(line)) !== null) {
        result += line.slice(lastIndex, match.index);
        const parts = parseLinkedTargetParts(match[1]);
        const displayText = parts.label || parts.target || match[1];
        let resolvedId = idIndex ? resolveLinkedTarget(match[1], idIndex, aliasIndex) : null;
        if (resolvedId && publishableIds && !publishableIds.has(resolvedId)) resolvedId = null;
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
 * @param {Set<string>} [publishableIds]
 * @returns {string}
 */
function resolvePublishLinks(text, idIndex, aliasIndex, publishableIds) {
    return mapLinesOutsideFences(text, (line) => resolveLinksInLine(line, idIndex, aliasIndex, publishableIds));
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
 * @param {Set<string>} [publishableIds]
 * @returns {string}
 */
function resolvePublishFieldValue(text, idIndex, aliasIndex, publishableIds) {
    const raw = String(text || '');
    let result = '';
    let lastIndex = 0;
    INLINE_WIKILINK_RE.lastIndex = 0;
    let match;
    while ((match = INLINE_WIKILINK_RE.exec(raw)) !== null) {
        result += raw.slice(lastIndex, match.index);
        const parts = parseLinkedTargetParts(match[1]);
        let resolvedId = idIndex ? resolveLinkedTarget(match[1], idIndex, aliasIndex) : null;
        if (resolvedId && publishableIds && !publishableIds.has(resolvedId)) resolvedId = null;
        result += resolvedId ? `/${getSlug(resolvedId)}` : (parts.target || match[1]);
        lastIndex = match.index + match[0].length;
    }
    result += raw.slice(lastIndex);
    return result;
}

module.exports = {
    getPublishStatus,
    getPublishFlag,
    isPublishable,
    getSlug,
    getTypeSegment,
    getOrder,
    sortByOrder,
    resolvePublishLinks,
    resolvePublishFieldValue,
    filterOutFencedLines,
    DRAFT_STATUS,
    ARCHIVED_STATUS,
    PUBLISHED_STATUS
};
