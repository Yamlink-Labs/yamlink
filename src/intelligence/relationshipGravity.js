'use strict';

// Relationship gravity — how much weight a specific edge (source note, field,
// target note) carries, beyond the binary fact that it exists.
//
// Combines:
//   structural  — how many distinct fields on the source note point at the
//                 same target. A note that's both `commander` and `mentor`
//                 to the same person is more entangled with them than one
//                 that's only ever `commander` — real corroboration, not
//                 just "a link exists."
//   repetition  — how many times this exact edge has been set/reaffirmed
//                 across the mutation log — the user touched this
//                 relationship more than once, not just typed it and moved on.
//   recency     — same half-life decay convention as implicitWeights.js
//                 (180 days): a relationship reinforced last week outweighs
//                 one only ever touched two years ago.
//
// This never gates anything — no SILENCE/QUICKFIX decisions here. It's a
// ranking signal only, meant to reorder relation lists (Note Report groups,
// candidate ranking, graph edge weight) by how much the vault's own history
// says a connection actually matters. Degrades gracefully to structural-only
// scoring when there's no mutation history — never silent, since existence
// of an edge is still real information, just with lower gravity.

const GRAVITY_HALF_LIFE_DAYS = 180;
const MS_PER_DAY = 86400000;
const RELATION_EVENT_TYPES = new Set(['relation_added', 'relation_changed', 'relation_removed']);
const STRUCTURAL_WEIGHT_FACTOR = 0.3;
const MUTATION_WEIGHT_FACTOR = 0.7;

function _decayFactor(ageDays) {
    return Math.pow(0.5, ageDays / GRAVITY_HALF_LIFE_DAYS);
}

function _extractTargetId(value) {
    const match = String(value || '').trim().match(/^\[\[([^\]|#^]+)/);
    return match ? String(match[1] || '').trim().toLowerCase() : null;
}

/**
 * @typedef {{ score: number, structuralWeight: number, decayedMutationWeight: number, repetition: number }} EdgeGravity
 */

/**
 * Structural weight for every (sourceId, targetId) pair: how many distinct
 * fields on sourceId point at targetId. Vault-wide, one pass over fieldsCache.
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {Map<string, Map<string, number>>} sourceId -> targetId -> field count
 */
function _buildStructuralWeights(fieldsCache) {
    const weights = new Map();
    for (const [sourceId, fields] of fieldsCache) {
        for (const [field, rawValue] of Object.entries(fields || {})) {
            if (field === 'id' || field === 'type') continue;
            const values = Array.isArray(rawValue) ? rawValue : [rawValue];
            for (const raw of values) {
                const targetId = _extractTargetId(raw);
                if (!targetId) continue;
                if (!weights.has(sourceId)) weights.set(sourceId, new Map());
                const perTarget = weights.get(sourceId);
                perTarget.set(targetId, (perTarget.get(targetId) || 0) + 1);
            }
        }
    }
    return weights;
}

/**
 * @param {Array<{type: string, noteId: string, field: string|null, newValue: *, oldValue: *, timestamp?: string}>} mutationEvents
 * @returns {Map<string, Map<string, Map<string, {decayedMutationWeight: number, repetition: number}>>>} sourceId -> field -> targetId -> mutation weight
 */
function _buildMutationWeights(mutationEvents, nowMs) {
    const weights = new Map();
    for (const event of (mutationEvents || [])) {
        if (!event || !RELATION_EVENT_TYPES.has(event.type) || !event.noteId || !event.field) continue;
        const value = event.type === 'relation_removed' ? event.oldValue : event.newValue;
        const targetId = _extractTargetId(value);
        if (!targetId) continue;

        const ageDays = event.timestamp
            ? Math.max(0, (nowMs - new Date(event.timestamp).getTime()) / MS_PER_DAY)
            : 0;
        // Removals still carry some signal (the relationship existed and mattered
        // enough to be set in the first place) but at reduced weight.
        const baseWeight = event.type === 'relation_removed' ? 0.4 : 1.0;
        const decayed = _decayFactor(ageDays) * baseWeight;

        if (!weights.has(event.noteId)) weights.set(event.noteId, new Map());
        const byField = weights.get(event.noteId);
        if (!byField.has(event.field)) byField.set(event.field, new Map());
        const byTarget = byField.get(event.field);
        if (!byTarget.has(targetId)) byTarget.set(targetId, { decayedMutationWeight: 0, repetition: 0 });
        const entry = byTarget.get(targetId);
        entry.decayedMutationWeight += decayed;
        entry.repetition += 1;
    }
    return weights;
}

/**
 * Build the full vault-wide relationship gravity map from current edges plus
 * mutation history.
 * @param {Array<{type: string, noteId: string, field: string|null, newValue: *, oldValue: *, timestamp?: string}>} mutationEvents
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {number} [nowMs] Current time in ms — pass explicitly in tests to freeze time.
 * @returns {Map<string, Map<string, Map<string, EdgeGravity>>>} sourceId -> field -> targetId -> gravity
 */
function buildRelationshipGravity(mutationEvents, fieldsCache, nowMs = Date.now()) {
    const structuralWeights = _buildStructuralWeights(fieldsCache);
    const mutationWeights = _buildMutationWeights(mutationEvents, nowMs);

    const gravity = new Map();
    for (const [sourceId, fields] of fieldsCache) {
        for (const [field, rawValue] of Object.entries(fields || {})) {
            if (field === 'id' || field === 'type') continue;
            const values = Array.isArray(rawValue) ? rawValue : [rawValue];
            for (const raw of values) {
                const targetId = _extractTargetId(raw);
                if (!targetId) continue;

                const structuralWeight = structuralWeights.get(sourceId)?.get(targetId) || 1;
                const mutationEntry = mutationWeights.get(sourceId)?.get(field)?.get(targetId)
                    || { decayedMutationWeight: 0, repetition: 0 };
                const score = structuralWeight * STRUCTURAL_WEIGHT_FACTOR
                    + mutationEntry.decayedMutationWeight * MUTATION_WEIGHT_FACTOR;

                if (!gravity.has(sourceId)) gravity.set(sourceId, new Map());
                const byField = gravity.get(sourceId);
                if (!byField.has(field)) byField.set(field, new Map());
                byField.get(field).set(targetId, {
                    score,
                    structuralWeight,
                    decayedMutationWeight: mutationEntry.decayedMutationWeight,
                    repetition: mutationEntry.repetition
                });
            }
        }
    }
    return gravity;
}

/**
 * @param {string} sourceId
 * @param {string} field
 * @param {string} targetId
 * @param {Map<string, Map<string, Map<string, EdgeGravity>>>|null|undefined} gravity
 * @returns {EdgeGravity}
 */
function getEdgeGravity(sourceId, field, targetId, gravity) {
    return gravity?.get(sourceId)?.get(field)?.get(targetId)
        || { score: 0, structuralWeight: 0, decayedMutationWeight: 0, repetition: 0 };
}

/**
 * Flattens the full gravity map into a ranked list of the vault's most
 * corroborated edges — connections reinforced by more than one field
 * pointing at the same target, or by repeated mutation-log touches, not
 * just single-instance links (which is most edges in any vault and would
 * make a "top edges" list meaningless noise).
 *
 * @param {Map<string, Map<string, Map<string, EdgeGravity>>>|null|undefined} gravity
 * @param {{ limit?: number }} [options]
 * @returns {Array<{sourceId: string, field: string, targetId: string, score: number, structuralWeight: number, decayedMutationWeight: number, repetition: number}>}
 */
function getTopGravityEdges(gravity, { limit = 10 } = {}) {
    if (!gravity) return [];
    const edges = [];
    for (const [sourceId, byField] of gravity) {
        for (const [field, byTarget] of byField) {
            for (const [targetId, g] of byTarget) {
                if (g.structuralWeight <= 1 && g.repetition === 0) continue;
                edges.push({ sourceId, field, targetId, ...g });
            }
        }
    }
    edges.sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId));
    return edges.slice(0, limit);
}

module.exports = { buildRelationshipGravity, getEdgeGravity, getTopGravityEdges };
