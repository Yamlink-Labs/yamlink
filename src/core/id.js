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

module.exports = {
    canonicalizeId,
    extractCanonicalIdFromFrontmatter
};
