'use strict';

// Note arc prediction — what fields does this note likely need next?
//
// A note has a trajectory: it starts sparse and accumulates fields as the user
// develops it. Other notes of the same type in the vault are at various points
// on that trajectory. By comparing the current note's field set against the
// canonical bundle for its type, we can predict which fields are likely missing.
//
// Two evidence sources combine:
//   Vault evidence      — how often a field appears on same-type notes (typeFieldBundles)
//   Feedback evidence   — how often the system's suggestions for that field were accepted (outcomeCalibration)
//
// Together: "notes like yours typically also have faction and last-contact — yours is missing both."
// The system makes this call from structure alone. No hardcoded field lists.

const { getCommonFieldsForType } = require('./vaultPriors');

const SKIP_FIELDS = new Set(['id', 'type', 'created', 'modified', 'updated']);

function _norm(s) { return String(s || '').trim().toLowerCase(); }

/**
 * @typedef {{
 *   field: string,
 *   ratio: number,
 *   calibrationCount: number,
 *   score: number,
 *   isRelation: boolean
 * }} ArcField
 *
 * @typedef {{
 *   inferredType: string|null,
 *   missingFields: ArcField[]
 * }} NoteArc
 */

/**
 * Given a note's current fields, predict which fields it is likely missing
 * relative to how similar notes in the vault have developed.
 *
 * Returns an empty missingFields array when:
 *   - noteType is absent (untyped note)
 *   - the type has no vault bundle yet (no other notes of this type)
 *   - all common fields are already present
 *
 * @param {Record<string,any>} noteFields
 * @param {string|null} noteType
 * @param {Map<string,Record<string,any>>} fieldsCache
 * @param {Map<string,Map<string,number>>} typeFieldBundles
 * @param {Map<string,Map<string,number>>} fieldTargetTypes
 * @param {import('./outcomeCalibration').OutcomeCalibration|null} [outcomeCalibration]
 * @param {{ limit?: number, minRatio?: number }} [opts]
 * @returns {NoteArc}
 */
function buildNoteArc(noteFields, noteType, fieldsCache, typeFieldBundles, fieldTargetTypes, outcomeCalibration, opts = {}) {
    const { limit = 5, minRatio = 0.30 } = opts;
    const nt = _norm(noteType);
    if (!nt || !typeFieldBundles || !typeFieldBundles.has(nt)) {
        return { inferredType: null, missingFields: [] };
    }

    // Build the set of fields the note already has — non-empty, non-structural
    const currentFields = new Set();
    for (const [key, raw] of Object.entries(noteFields || {})) {
        const norm = _norm(key);
        if (!norm || SKIP_FIELDS.has(norm)) continue;
        const vals = Array.isArray(raw) ? raw : [raw];
        if (vals.some(v => String(v || '').trim())) currentFields.add(norm);
    }

    // Fetch fields common to this type; ask for more than limit so filtering
    // to missing still leaves enough candidates
    const commonFields = getCommonFieldsForType(
        nt, typeFieldBundles, fieldsCache,
        { limit: limit + currentFields.size + 5, minRatio }
    );

    const calByField = outcomeCalibration?.byField || new Map();

    const missingFields = commonFields
        .filter(({ field }) => !SKIP_FIELDS.has(_norm(field)) && !currentFields.has(_norm(field)))
        .map(({ field, ratio }) => {
            const fn = _norm(field);
            const calCount = calByField.get(fn) || 0;
            // Calibration boost: each accepted suggestion adds a small upward pull.
            // Capped so calibration alone cannot dominate vault evidence.
            const calBoost = calCount > 0 ? Math.min(0.20, calCount * 0.04) : 0;
            // 75% vault frequency, 25% user-feedback pull
            const score = ratio * 0.75 + calBoost * 0.25;
            const isRelation = Boolean(fieldTargetTypes?.has(fn));
            return { field: fn, ratio, calibrationCount: calCount, score, isRelation };
        })
        .sort((a, b) => b.score - a.score || a.field.localeCompare(b.field))
        .slice(0, limit);

    return { inferredType: nt, missingFields };
}

module.exports = { buildNoteArc };
