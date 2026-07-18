'use strict';

// Per-vault implicit field relation history.
//
// Mines the mutation event log to learn which field names have historically
// been used as wikilink-valued (relational) fields in this vault.
//
// This is the "sticky knowledge" layer: even after a user clears a relation
// field or rewrites notes, the vault's accumulated history of using that field
// as a relation persists and informs future inference.
//
// Unlike vaultPriors (which reflects current vault state), implicit weights
// reflect accumulated user intent across the vault's lifetime. A field the
// user has set to [[wikilinks]] five times — even if currently empty — is
// known relational.
//
// Signal decay: recent relation uses carry more weight than stale ones.
// Half-life = 180 days. An event 6 months old contributes 0.5x its original
// signal. Very old events (> 4 half-lives ≈ 2 years) decay below the floor
// and are ignored — preventing ancient vault archaeology from inflating
// confidence in the current vault's structure.

const WIKILINK_RE = /^\[\[/;
const IMPLICIT_HALF_LIFE_DAYS = 180;
const BEHAVIOR_HALF_LIFE_DAYS = 45;
const MS_PER_DAY = 86400000;
const DECAY_FLOOR = 0.1;

function _decayFactor(ageDays) {
    return Math.pow(0.5, ageDays / IMPLICIT_HALF_LIFE_DAYS);
}

function _behaviorDecayFactor(ageDays) {
    return Math.pow(0.5, ageDays / BEHAVIOR_HALF_LIFE_DAYS);
}

function _extractTargetId(value) {
    const match = String(value || '').trim().match(/^\[\[([^\]|#^]+)/);
    return match ? String(match[1] || '').trim().toLowerCase() : null;
}

function _ensureNestedMap(root, key) {
    if (!root.has(key)) root.set(key, new Map());
    return root.get(key);
}

/**
 * @typedef {{ relationCount: number, total: number, decayedWeight: number }} FieldWeight
 */

/**
 * Build field interaction history from mutation events.
 *
 * Counts how many times each field has been assigned a wikilink value
 * across all `relation_changed` and `field_added` events in the log.
 * Each wikilink event also contributes a time-decayed weight (`decayedWeight`):
 * recent events contribute ~1.0, events at the half-life contribute ~0.5,
 * and events older than 4× the half-life contribute < 0.1 (noise).
 *
 * @param {Array<{ type: string, field: string|null, newValue: *, timestamp?: string }>} mutationEvents
 * @param {number} [nowMs] Current time in ms — pass explicitly in tests to freeze time.
 * @returns {Map<string, FieldWeight>}
 */
const RELATION_EVENT_TYPES = new Set(['relation_changed', 'relation_added', 'relation_removed', 'field_added']);

function buildImplicitFieldWeights(mutationEvents, nowMs = Date.now()) {
    const weights = new Map();
    for (const event of (mutationEvents || [])) {
        if (!event || !event.field) continue;
        if (!RELATION_EVENT_TYPES.has(event.type)) continue;
        const fn = String(event.field || '').trim().toLowerCase();
        if (!fn || fn === 'id' || fn === 'type') continue;
        if (!weights.has(fn)) weights.set(fn, { relationCount: 0, total: 0, decayedWeight: 0 });
        const w = weights.get(fn);
        w.total++;
        // For relation_removed, the evidence of relationality is in oldValue
        const wikilinkValue = event.type === 'relation_removed'
            ? String(event.oldValue || '').trim()
            : String(event.newValue || '').trim();
        if (WIKILINK_RE.test(wikilinkValue)) {
            w.relationCount++;
            const ageDays = event.timestamp
                ? Math.max(0, (nowMs - new Date(event.timestamp).getTime()) / MS_PER_DAY)
                : 0;
            // Removals carry 50% weight — field was relational but link was dropped
            const baseWeight = event.type === 'relation_removed' ? 0.5 : 1.0;
            w.decayedWeight += _decayFactor(ageDays) * baseWeight;
        }
    }
    return weights;
}

/**
 * Recent behavioral relation priors derived from mutation history.
 *
 * Unlike implicit weights, these focus on *current modeling behavior*:
 * what target types and concrete targets the user has been linking lately,
 * optionally scoped by the note type being edited.
 *
 * @param {Array<{ type: string, field: string|null, newValue: *, noteId?: string, timestamp?: string }>} mutationEvents
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {number} [nowMs]
 * @returns {{
 *   fieldTargetTypeScores: Map<string, Map<string, number>>,
 *   fieldTargetIdScores: Map<string, Map<string, number>>,
 *   noteTypeFieldTargetTypeScores: Map<string, Map<string, Map<string, number>>>,
 *   noteTypeFieldTargetIdScores: Map<string, Map<string, Map<string, number>>>
 * }}
 */
function buildBehavioralRelationPriors(mutationEvents, fieldsCache, nowMs = Date.now()) {
    /** @type {Map<string, Map<string, number>>} */
    const fieldTargetTypeScores = new Map();
    /** @type {Map<string, Map<string, number>>} */
    const fieldTargetIdScores = new Map();
    /** @type {Map<string, Map<string, Map<string, number>>>} */
    const noteTypeFieldTargetTypeScores = new Map();
    /** @type {Map<string, Map<string, Map<string, number>>>} */
    const noteTypeFieldTargetIdScores = new Map();

    for (const event of (mutationEvents || [])) {
        if (!event || !event.field) continue;
        if (!RELATION_EVENT_TYPES.has(event.type)) continue;
        const field = String(event.field || '').trim().toLowerCase();
        if (!field || field === 'id' || field === 'type') continue;
        const targetId = _extractTargetId(event.newValue);
        if (!targetId) continue;
        const targetType = String(fieldsCache?.get(targetId)?.type || '').trim().toLowerCase();
        if (!targetType) continue;
        const ageDays = event.timestamp
            ? Math.max(0, (nowMs - new Date(event.timestamp).getTime()) / MS_PER_DAY)
            : 0;
        const weight = _behaviorDecayFactor(ageDays) * (event.type === 'relation_changed' ? 1.05 : 0.95);

        const typeMap = _ensureNestedMap(fieldTargetTypeScores, field);
        typeMap.set(targetType, (typeMap.get(targetType) || 0) + weight);

        const idMap = _ensureNestedMap(fieldTargetIdScores, field);
        idMap.set(targetId, (idMap.get(targetId) || 0) + weight);

        const noteType = String(fieldsCache?.get(String(event.noteId || '').trim().toLowerCase())?.type || '').trim().toLowerCase();
        if (!noteType) continue;
        const byFieldType = _ensureNestedMap(noteTypeFieldTargetTypeScores, noteType);
        const byFieldTypeTargets = _ensureNestedMap(byFieldType, field);
        byFieldTypeTargets.set(targetType, (byFieldTypeTargets.get(targetType) || 0) + weight);

        const byFieldId = _ensureNestedMap(noteTypeFieldTargetIdScores, noteType);
        const byFieldIdTargets = _ensureNestedMap(byFieldId, field);
        byFieldIdTargets.set(targetId, (byFieldIdTargets.get(targetId) || 0) + weight);
    }

    return {
        fieldTargetTypeScores,
        fieldTargetIdScores,
        noteTypeFieldTargetTypeScores,
        noteTypeFieldTargetIdScores
    };
}

/**
 * Confidence boost from implicit relation history for a field with no current
 * vault evidence. Returns { boost: 0, reason: null } when history is absent
 * or insufficient.
 *
 * Boost is computed from the time-decayed relation weight rather than raw count,
 * so a field used frequently long ago gets a lower boost than one used recently.
 *
 * Boost schedule (based on decayedWeight):
 *   ~1.0  → +0.10  (single recent confirmed use)
 *   ~2.0  → +0.13
 *   ~5.0  → +0.22
 *   ~8.0+ → +0.28 (cap — history alone never reaches QUICKFIX)
 *
 * @param {string} fieldName
 * @param {Map<string, FieldWeight>} implicitWeights
 * @returns {{ boost: number, reason: string|null }}
 */
function getImplicitBoost(fieldName, implicitWeights) {
    if (!implicitWeights || !implicitWeights.size) return { boost: 0, reason: null };
    const fn = String(fieldName || '').trim().toLowerCase();
    const w = implicitWeights.get(fn);
    if (!w || w.decayedWeight < DECAY_FLOOR) return { boost: 0, reason: null };
    const boost = Math.min(0.28, 0.10 + (w.decayedWeight - 1) * 0.03);
    const reason = w.relationCount === 1
        ? `"${fn}" was used as a relation field once in this vault's history`
        : `"${fn}" has been used as a relation field ${w.relationCount}× in this vault's history`;
    return { boost, reason };
}

// ─── Temporal confidence from mutation volatility ──────────────────────────
//
// A field revised often (`field_changed`) relative to how often it's set
// (`field_added`) is noisier evidence than one that's set once and left
// alone. This mines the mutation log per field, vault-wide, into a
// volatilityScore in [0,1] — changed / (added + changed) — and requires a
// minimum sample before returning anything, so a field with one or two
// observations never gets a confident-sounding score either way.

const VOLATILITY_MIN_SAMPLES = 3;
const VOLATILITY_HIGH = 0.6;
const VOLATILITY_LOW = 0.15;

/**
 * @typedef {{ added: number, changed: number, total: number, volatilityScore: number }} FieldVolatility
 */

/**
 * Per-field, vault-wide volatility from mutation log history.
 * @param {Array<{ type: string, field: string|null }>} mutationEvents
 * @returns {Map<string, FieldVolatility>}
 */
function buildFieldVolatility(mutationEvents) {
    const stats = new Map();
    for (const event of (mutationEvents || [])) {
        if (!event || !event.field) continue;
        if (event.type !== 'field_added' && event.type !== 'field_changed') continue;
        const fn = String(event.field || '').trim().toLowerCase();
        if (!fn || fn === 'id' || fn === 'type') continue;
        if (!stats.has(fn)) stats.set(fn, { added: 0, changed: 0 });
        const s = stats.get(fn);
        if (event.type === 'field_added') s.added++;
        else s.changed++;
    }
    const volatility = new Map();
    for (const [field, { added, changed }] of stats) {
        const total = added + changed;
        if (total < VOLATILITY_MIN_SAMPLES) continue;
        volatility.set(field, { added, changed, total, volatilityScore: changed / total });
    }
    return volatility;
}

/**
 * Bounded confidence multiplier from a field's mutation volatility.
 * No evidence (field absent, or under the minimum sample) → multiplier 1, no-op.
 * @param {string} fieldName
 * @param {Map<string, FieldVolatility>|null|undefined} fieldVolatility
 * @returns {{ multiplier: number, reason: string|null }}
 */
function getTemporalConfidenceAdjustment(fieldName, fieldVolatility) {
    if (!fieldVolatility || !fieldVolatility.size) return { multiplier: 1, reason: null };
    const fn = String(fieldName || '').trim().toLowerCase();
    const v = fieldVolatility.get(fn);
    if (!v) return { multiplier: 1, reason: null };
    if (v.volatilityScore >= VOLATILITY_HIGH) {
        return {
            multiplier: 0.85,
            reason: `"${fn}" has been revised often in this vault (${v.changed}/${v.total} changes) — treated as less settled`
        };
    }
    if (v.volatilityScore <= VOLATILITY_LOW) {
        return {
            multiplier: 1.08,
            reason: `"${fn}" has stayed stable once set in this vault (${v.total} observations, ${v.changed} revisions)`
        };
    }
    return { multiplier: 1, reason: null };
}

module.exports = {
    buildImplicitFieldWeights,
    buildBehavioralRelationPriors,
    getImplicitBoost,
    buildFieldVolatility,
    getTemporalConfidenceAdjustment
};
