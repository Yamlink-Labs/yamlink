'use strict';

// Confidence contract:
// - Some inference layers emit direct probability-like confidence in [0, 1].
// - Adaptive suggestion layers emit additive integer evidence scores
//   (shared structure, tags, relations, recency boosts, etc.).
// - Those raw scores are NOT probabilities and must be normalized through
//   scoreToConfidence() before any surface thresholding happens.
// - Keep the default scale explicit so new signals do not silently normalize
//   to near-zero just because they were written as "small" scores.
const DEFAULT_SCORE_CONFIDENCE_SCALE = 600;

const SURFACE_POLICY = {
    // Hover role copy should only show when the inferred role is stronger than a
    // generic type/title hint. Low-0.4 roles are often "record-ish" fallbacks.
    'hover-note-role': { minimum: 0.5, fallbackLimit: 1 },
    // Note Report can be a little more exploratory, but still should not narrate
    // very weak role guesses as if they are settled truth.
    'report-note-role': { minimum: 0.4, fallbackLimit: 1 },
    // Note-role field suggestions drive frontmatter completions directly, so they
    // should require more than a barely-above-fallback role inference.
    'frontmatter-note-role': { minimum: 0.58, fallbackLimit: 5 },
    // Lightbulb actions are the most assertive surface: they mutate notes or insert
    // blocks. Keep them available only when adaptive evidence is genuinely strong.
    'frontmatter-actions': { minimum: 0.62, fallbackLimit: 2 },
    // Hover opportunities collapse many additive evidence sources into one line of
    // prose. Keep this stricter so hover only speaks when the signal is decisive.
    'hover-opportunities': { minimum: 0.62, fallbackLimit: 1 },
    // Note Report can surface broader "possible next" guidance, but 0.42 was low
    // enough to promote weak additive scores into authoritative-seeming rows.
    'report-opportunities': { minimum: 0.5, fallbackLimit: 3 },
    // "Next view" suggestions are useful only when they are clearly better than the
    // fallback explanation path; otherwise they read as noisy invented certainty.
    'report-suggestions': { minimum: 0.6, fallbackLimit: 2 }
};

function getSurfacePolicy(surface) {
    return SURFACE_POLICY[surface] || { minimum: 0.5, fallbackLimit: 3 };
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value || 0)));
}

function scoreToConfidence(score, scale = DEFAULT_SCORE_CONFIDENCE_SCALE) {
    const normalized = Number(score || 0) / Math.max(1, scale);
    return clamp01(normalized);
}

function readConfidence(item, options = {}) {
    const confidenceKey = options.confidenceKey || 'confidence';
    const scoreKey = options.scoreKey || 'score';
    const scoreScale = options.scoreScale || DEFAULT_SCORE_CONFIDENCE_SCALE;
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
    DEFAULT_SCORE_CONFIDENCE_SCALE,
    SURFACE_POLICY,
    getSurfacePolicy,
    scoreToConfidence,
    readConfidence,
    filterItemsForSurface,
    shouldSurface
};
