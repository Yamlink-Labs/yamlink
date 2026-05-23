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

let _cached = null;
let _cacheGeneration = -1;
let _cachedFieldsCache = null;

function getVaultPatterns(fieldsCache, vaultGeneration) {
    if (_cached !== null && _cacheGeneration === vaultGeneration && _cachedFieldsCache === fieldsCache) {
        return _cached;
    }
    const observedFields = buildObservedFields(fieldsCache);
    const observedIndex = buildObservedNoteIndex(fieldsCache, { observedFields });
    _cached = { observedFields, observedIndex };
    _cacheGeneration = vaultGeneration;
    _cachedFieldsCache = fieldsCache;
    return _cached;
}

function clearIntelligenceCache() {
    _cached = null;
    _cacheGeneration = -1;
}

module.exports = { getVaultPatterns, clearIntelligenceCache };
