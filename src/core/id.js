/** @param {any} value @returns {string} */
function canonicalizeId(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    return raw
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['".,!?()[\]{}:;@#$%^&*+=~`|\\/]+/g, ' ')
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '');
}

/** @param {string} content @returns {string|null} */
function extractCanonicalIdFromFrontmatter(content) {
    if (!content || !/^\s*---/.test(content)) return null;

    const firstDash = content.indexOf('---');
    const closingIndex = content.indexOf('---', firstDash + 3);
    if (closingIndex === -1) return null;

    const frontmatter = content.slice(firstDash + 3, closingIndex);
    const match = frontmatter.match(/^\s*id:\s*(.+?)\s*$/m);
    if (!match) return null;

    const rawValue = String(match[1] || '').trim().replace(/^['"]|['"]$/g, '');
    const canonical = canonicalizeId(rawValue);
    return canonical || null;
}

/** @param {any} raw @returns {string} */
function canonicalizeLinkedTarget(raw) {
    const target = String(raw || '').trim().split('|')[0].trim().split('#')[0].trim().split('^')[0].trim();
    return target ? canonicalizeId(target) : '';
}

// Resolves a raw wikilink target to a canonical ID that actually exists
// in idIndex. Checks direct ID first, then alias index. Returns the
// resolved canonical ID, or null if not found.
/**
 * @param {any} raw
 * @param {Map<string, string>} idIndex
 * @param {Map<string, string>} [aliasIndex]
 * @returns {string|null}
 */
function resolveLinkedTarget(raw, idIndex, aliasIndex) {
    const canonical = canonicalizeLinkedTarget(raw);
    if (!canonical) return null;
    if (idIndex.has(canonical)) return canonical;
    if (aliasIndex) {
        const resolved = aliasIndex.get(canonical);
        if (resolved && idIndex.has(resolved)) return resolved;
    }
    return null;
}

module.exports = {
    canonicalizeId,
    extractCanonicalIdFromFrontmatter,
    canonicalizeLinkedTarget,
    resolveLinkedTarget
};
