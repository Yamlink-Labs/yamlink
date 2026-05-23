'use strict';

const MAX_CACHE_ENTRIES = 300;
const _cache = new Map();

function touch(key, entry) {
    _cache.delete(key);
    _cache.set(key, entry);
}

function getCachedQueryResult(queryText, vaultGeneration, todayIso, executeFn) {
    const key = `${String(queryText || '').trim()}::${vaultGeneration}::${todayIso}`;
    const existing = _cache.get(key);
    if (existing && existing.generation === vaultGeneration) {
        touch(key, existing);
        return existing.result;
    }

    const result = executeFn();
    touch(key, { result, generation: vaultGeneration });

    if (_cache.size > MAX_CACHE_ENTRIES) {
        const oldestKey = _cache.keys().next().value;
        _cache.delete(oldestKey);
    }

    return result;
}

function clearQueryCache() {
    _cache.clear();
}

module.exports = {
    getCachedQueryResult,
    clearQueryCache
};
