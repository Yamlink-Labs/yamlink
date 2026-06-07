'use strict';

// Per-node task cache. Entry shape: { tasks: Task[], generation: number }.
//
// Phase 1 (now): coarse vaultGeneration invalidation — any vault mutation
// causes all entries to miss on the next render, then re-populate from disk.
// The win: a second panel rendering in the same generation gets N free hits.
//
// Phase 2 (future, depends on changedId threading from refreshRouter):
// only invalidate the specific changed node — 1 disk read per save instead of N.

const _cache = new Map();

/** @param {string} nodeId @param {number} generation @returns {import('./tasks').TaskRow[]|null} */
function getCachedTasks(nodeId, generation) {
    const entry = _cache.get(nodeId);
    if (!entry || entry.generation !== generation) return null;
    return entry.tasks;
}

/** @param {string} nodeId @param {import('./tasks').TaskRow[]} tasks @param {number} generation @returns {void} */
function setCachedTasks(nodeId, tasks, generation) {
    _cache.set(nodeId, { tasks, generation });
}

/** @returns {void} */
function clearTaskCache() {
    _cache.clear();
}

module.exports = { getCachedTasks, setCachedTasks, clearTaskCache };
