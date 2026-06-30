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
    const parsed = parseLinkedTargetParts(raw);
    return parsed.target ? canonicalizeId(parsed.target) : '';
}

/**
 * @param {any} raw
 * @returns {{ raw: string, target: string, label: string, anchor: string, blockId: string }}
 */
function parseLinkedTargetParts(raw) {
    const full = String(raw || '').trim();
    if (!full) {
        return { raw: '', target: '', label: '', anchor: '', blockId: '' };
    }

    const [beforeLabel, label = ''] = full.split('|', 2);
    const relationText = String(beforeLabel || '').trim();

    const hashIndex = relationText.indexOf('#');
    const blockIndex = relationText.indexOf('^');
    let splitIndex = -1;
    let mode = '';

    if (hashIndex !== -1 && blockIndex !== -1) {
        splitIndex = Math.min(hashIndex, blockIndex);
        mode = splitIndex === hashIndex ? '#' : '^';
    } else if (hashIndex !== -1) {
        splitIndex = hashIndex;
        mode = '#';
    } else if (blockIndex !== -1) {
        splitIndex = blockIndex;
        mode = '^';
    }

    const target = splitIndex === -1 ? relationText : relationText.slice(0, splitIndex).trim();
    const suffix = splitIndex === -1 ? '' : relationText.slice(splitIndex + 1).trim();

    return {
        raw: full,
        target,
        label: String(label || '').trim(),
        anchor: mode === '#' ? suffix : '',
        blockId: mode === '^' ? suffix : ''
    };
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
    parseLinkedTargetParts,
    resolveLinkedTarget
};
