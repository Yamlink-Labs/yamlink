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
// known relational. The system never forgets it.

const WIKILINK_RE = /^\[\[/;

/**
 * @typedef {{ relationCount: number, total: number }} FieldWeight
 */

/**
 * Build field interaction history from mutation events.
 *
 * Counts how many times each field has been assigned a wikilink value
 * across all `relation_changed` and `field_added` events in the log.
 *
 * @param {Array<{ type: string, field: string|null, newValue: * }>} mutationEvents
 * @returns {Map<string, FieldWeight>}
 */
function buildImplicitFieldWeights(mutationEvents) {
    const weights = new Map();
    for (const event of (mutationEvents || [])) {
        if (!event || !event.field) continue;
        if (event.type !== 'relation_changed' && event.type !== 'field_added') continue;
        const fn = String(event.field || '').trim().toLowerCase();
        if (!fn || fn === 'id' || fn === 'type') continue;
        if (!weights.has(fn)) weights.set(fn, { relationCount: 0, total: 0 });
        const w = weights.get(fn);
        w.total++;
        if (WIKILINK_RE.test(String(event.newValue || '').trim())) w.relationCount++;
    }
    return weights;
}

/**
 * Confidence boost from implicit relation history for a field with no current
 * vault evidence. Returns { boost: 0, reason: null } when history is absent
 * or insufficient.
 *
 * Boost schedule:
 *   1 confirmed relation use  → +0.10  (first time we've seen it used this way)
 *   2 uses                    → +0.13
 *   5 uses                    → +0.22
 *   8+ uses                   → +0.28 (cap — history alone never reaches QUICKFIX)
 *
 * @param {string} fieldName
 * @param {Map<string, FieldWeight>} implicitWeights
 * @returns {{ boost: number, reason: string|null }}
 */
function getImplicitBoost(fieldName, implicitWeights) {
    if (!implicitWeights || !implicitWeights.size) return { boost: 0, reason: null };
    const fn = String(fieldName || '').trim().toLowerCase();
    const w = implicitWeights.get(fn);
    if (!w || w.relationCount < 1) return { boost: 0, reason: null };
    const boost = Math.min(0.28, 0.10 + (w.relationCount - 1) * 0.03);
    const reason = w.relationCount === 1
        ? `"${fn}" was used as a relation field once in this vault's history`
        : `"${fn}" has been used as a relation field ${w.relationCount}× in this vault's history`;
    return { boost, reason };
}

module.exports = { buildImplicitFieldWeights, getImplicitBoost };
