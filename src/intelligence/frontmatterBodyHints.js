'use strict';

const { pickConnectionField } = require('./frontmatterFieldFamilies');

/**
 * @param {string} content Full note content (frontmatter + body).
 * @returns {Map<string, number>} id → occurrence count in body (code blocks excluded).
 */
function extractBodyMentionedIds(content) {
    if (!content) return new Map();
    let body = content;
    if (/^\s*---/.test(content)) {
        const firstDash = content.indexOf('---');
        const closingIdx = content.indexOf('---', firstDash + 3);
        if (closingIdx !== -1) body = content.slice(closingIdx + 3);
    }
    body = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '');
    const counts = new Map();
    const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = regex.exec(body)) !== null) {
        const id = match[1].trim().toLowerCase();
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
}

/**
 * @param {string} content
 * @param {object} frontmatterFields Current frontmatter fields map.
 * @param {Map<string,object>} fieldsCache
 * @param {{ threshold?: number }} [options]
 * @returns {{ id: string, count: number, field: string, insertText: string }[]}
 */
function buildBodyMentionHints(content, frontmatterFields, fieldsCache, options = {}) {
    const threshold = options.threshold || 2;
    const bodyCounts = extractBodyMentionedIds(content);
    if (!bodyCounts.size) return [];

    const frontmatterIds = new Set();
    const wikilinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    for (const value of Object.values(frontmatterFields || {})) {
        let match;
        while ((match = wikilinkRegex.exec(String(value || ''))) !== null) {
            frontmatterIds.add(match[1].trim().toLowerCase());
        }
    }

    const hints = [];
    for (const [id, count] of bodyCounts.entries()) {
        if (count < threshold) continue;
        if (frontmatterIds.has(id)) continue;
        if (fieldsCache.size && !fieldsCache.has(id)) continue;
        hints.push({
            id,
            count,
            field: pickConnectionField(frontmatterFields),
            insertText: `${pickConnectionField(frontmatterFields)}: [[${id}]]\n`
        });
    }

    return hints.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

module.exports = {
    extractBodyMentionedIds,
    buildBodyMentionHints
};
