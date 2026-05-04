'use strict';

const SURFACE_POLICY = {
    'hover-note-role': { minimum: 0.44, fallbackLimit: 1 },
    'report-note-role': { minimum: 0.34, fallbackLimit: 1 },
    'frontmatter-note-role': { minimum: 0.48, fallbackLimit: 5 },
    'frontmatter-actions': { minimum: 0.56, fallbackLimit: 2 },
    'hover-opportunities': { minimum: 0.5, fallbackLimit: 1 },
    'report-opportunities': { minimum: 0.42, fallbackLimit: 3 },
    'report-suggestions': { minimum: 0.52, fallbackLimit: 2 }
};

function getSurfacePolicy(surface) {
    return SURFACE_POLICY[surface] || { minimum: 0.5, fallbackLimit: 3 };
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value || 0)));
}

function scoreToConfidence(score, scale = 600) {
    const normalized = Number(score || 0) / Math.max(1, scale);
    return clamp01(normalized);
}

function readConfidence(item, options = {}) {
    const confidenceKey = options.confidenceKey || 'confidence';
    const scoreKey = options.scoreKey || 'score';
    const scoreScale = options.scoreScale || 600;
    const direct = item?.[confidenceKey];
    if (typeof direct === 'number') return clamp01(direct);
    if (typeof item?.[scoreKey] === 'number') return scoreToConfidence(item[scoreKey], scoreScale);
    return 0;
}

function filterItemsForSurface(items = [], surface, options = {}) {
    const list = Array.isArray(items) ? items : [];
    const policy = getSurfacePolicy(surface);
    const enriched = list.map((item) => ({
        item,
        confidence: readConfidence(item, options)
    }));
    const accepted = enriched
        .filter((entry) => entry.confidence >= policy.minimum)
        .map((entry) => ({
            ...entry.item,
            confidence: entry.item?.confidence ?? entry.confidence
        }));
    if (accepted.length) return accepted;
    return enriched
        .slice(0, policy.fallbackLimit)
        .map((entry) => ({
            ...entry.item,
            confidence: entry.item?.confidence ?? entry.confidence
        }));
}

function shouldSurface(value, surface, options = {}) {
    return readConfidence(value, options) >= getSurfacePolicy(surface).minimum;
}

module.exports = {
    SURFACE_POLICY,
    getSurfacePolicy,
    scoreToConfidence,
    readConfidence,
    filterItemsForSurface,
    shouldSurface
};
