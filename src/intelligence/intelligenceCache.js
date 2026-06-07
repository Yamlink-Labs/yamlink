'use strict';

// Vault-wide intelligence pattern cache.
// Caches { observedFields, observedIndex } keyed on vaultGeneration.
//
// Phase 1 (now): coarse invalidation — any vault mutation rebuilds the cache
// on the next access. The win: all per-keypress and per-hover calls in the
// same generation get the vault scan for free after the first one.
//
// Phase 2 (future): per-type or per-region invalidation when change scope
// from changedId threading proves sufficient.

const { buildObservedFields, buildObservedNoteIndex } = require('./suggestionCore');
const {
    getCachedPriors,
    buildVaultStatusValues,
    buildVaultSemanticRolePriors
} = require('./vaultPriors');

/**
 * @typedef {{ observedFields: object[], observedIndex: object }} VaultPatterns
 */

let _cached = null;
let _cacheGeneration = -1;
let _cachedFieldsCache = null;

/**
 * Returns observed field patterns for the current vault generation.
 * Rebuilds once per generation; subsequent calls in the same generation are free.
 * @param {Map<string,object>} fieldsCache
 * @param {number} vaultGeneration
 * @returns {VaultPatterns}
 */
function getVaultPatterns(fieldsCache, vaultGeneration) {
    if (_cached !== null && _cacheGeneration === vaultGeneration && _cachedFieldsCache === fieldsCache) {
        return _cached;
    }
    const observedFields = buildObservedFields(fieldsCache);
    // Use vault-derived semantic values so the suggestion index learns from this
    // vault's actual vocabulary — not from a global hardcoded list.
    const priors = getCachedPriors(fieldsCache, vaultGeneration);
    const observedIndex = buildObservedNoteIndex(fieldsCache, {
        observedFields,
        statusLikeValues:  buildVaultStatusValues(priors.workflowFields),
        semanticRolePriors: buildVaultSemanticRolePriors(priors)
    });
    _cached = { observedFields, observedIndex };
    _cacheGeneration = vaultGeneration;
    _cachedFieldsCache = fieldsCache;
    return _cached;
}

/** @returns {void} */
function clearIntelligenceCache() {
    _cached = null;
    _cacheGeneration = -1;
}

module.exports = { getVaultPatterns, clearIntelligenceCache };
