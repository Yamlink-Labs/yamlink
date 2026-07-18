'use strict';

const HOVER_BADGE_FIELDS = [
    { key: 'type', bg: '#C49BF0', fg: '#151617' },
    { key: 'status', bg: '#5ECFBE', fg: '#151617' }
];
const HOVER_BADGE_FONT_SIZE = 11;
const HOVER_BADGE_PADDING_X = 8;
const HOVER_BADGE_GAP = 6;
const HOVER_BADGE_HEIGHT = 20;
const HOVER_BADGE_GLYPH_WIDTH_RATIO = 0.6;

function _escapeXml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _estimateTextWidth(text) {
    return Math.ceil(String(text).length * HOVER_BADGE_FONT_SIZE * HOVER_BADGE_GLYPH_WIDTH_RATIO);
}

function normalizeHoverBadgeValue(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildHoverBadgeSvg(labels) {
    let x = 0;
    const parts = [];
    for (const { text, bg, fg } of labels) {
        const boxWidth = _estimateTextWidth(text) + HOVER_BADGE_PADDING_X * 2;
        parts.push(`<rect x="${x}" y="0" width="${boxWidth}" height="${HOVER_BADGE_HEIGHT}" rx="4" fill="${bg}" />`);
        parts.push(
            `<text x="${x + boxWidth / 2}" y="${HOVER_BADGE_HEIGHT / 2 + 4}" ` +
            `font-family="Segoe UI, -apple-system, sans-serif" font-size="${HOVER_BADGE_FONT_SIZE}" ` +
            `font-weight="600" fill="${fg}" text-anchor="middle">${_escapeXml(text)}</text>`
        );
        x += boxWidth + HOVER_BADGE_GAP;
    }
    const totalWidth = Math.max(0, x - HOVER_BADGE_GAP);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${HOVER_BADGE_HEIGHT}" viewBox="0 0 ${totalWidth} ${HOVER_BADGE_HEIGHT}">${parts.join('')}</svg>`;
}

function buildHoverBadgeDataUri(labels) {
    const svg = buildHoverBadgeSvg(labels);
    const base64 = Buffer.from(svg, 'utf8').toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
}

function buildHoverBadgeMarkdown(frontmatter) {
    const labels = [];
    for (const { key, bg, fg } of HOVER_BADGE_FIELDS) {
        const value = String(frontmatter?.[key] || '').trim();
        if (!value) continue;
        labels.push({ text: normalizeHoverBadgeValue(value), bg, fg });
    }
    if (!labels.length) return '';
    return `![](${buildHoverBadgeDataUri(labels)})`;
}

module.exports = {
    buildHoverBadgeSvg,
    buildHoverBadgeDataUri,
    buildHoverBadgeMarkdown
};
