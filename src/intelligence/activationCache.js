'use strict';

const { getVaultGeneration } = require('../core/indexService');

// ─────────────────────────────────────────────────────────────────
// activationCache — vault-generation-keyed result cache
//
// Caches the expensive triple (observedFields, noteContext,
// frontmatterOpportunities) per (nodeId, vaultGeneration).
// Any vault mutation bumps the generation counter, which makes
// every cached entry stale on the next access without an explicit
// invalidation step.
//
// Max 20 entries; oldest evicted on overflow via Map insertion order.
// ─────────────────────────────────────────────────────────────────

const MAX_ENTRIES = 20;
const _cache      = new Map();

/**
 * Returns the cached value for (nodeId, currentVaultGeneration).
 * Calls builder() on a miss; caches and returns the result.
 * @param {string} nodeId
 * @param {() => *} builder Zero-argument builder called on cache miss.
 * @returns {*}
 */
function getCachedContext(nodeId, builder) {
    const gen = getVaultGeneration();

    // Generation 0 means the index has never been built yet (or a stub returns 0
    // in tests). Skip caching entirely — there is no stable vault state to key on.
    if (gen === 0) return builder();

    const key = `${nodeId}:${gen}`;

    if (_cache.has(key)) return _cache.get(key);

    const value = builder();

    if (_cache.size >= MAX_ENTRIES) {
        _cache.delete(_cache.keys().next().value);
    }
    _cache.set(key, value);

    return value;
}

/** @returns {void} */
function clearActivationCache() {
    _cache.clear();
}

module.exports = { getCachedContext, clearActivationCache };
