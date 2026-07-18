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

// Universal starter fields shown on cold-start (new type, sparse vault).
// Ordered by how broadly useful they are across any domain. Last-resort
// fallback — only used when no emergent cluster match is found below.
const COLD_START_FIELDS = ['name', 'status', 'date', 'summary', 'tags', 'owner', 'link'];

const CLUSTER_CONFIDENCE_SCORE = { high: 0.55, medium: 0.35, low: 0.20 };

/**
 * Find the best emergent cluster whose field signature is a strict superset
 * of the note's current fields — i.e. this note's fields so far are
 * consistent with a real, repeated pattern elsewhere in the vault, and the
 * cluster has more fields to suggest. Prefers higher-confidence clusters,
 * then larger ones. Requires at least one current field: an entirely blank
 * note matches every cluster trivially, which would be a guess, not a match.
 * @param {Set<string>} currentFields
 * @param {Array<{fields: string[], noteCount: number, confidence: 'low'|'medium'|'high'}>|null} emergentClusters
 * @returns {{fields: string[], noteCount: number, confidence: string}|null}
 */
function _matchEmergentCluster(currentFields, emergentClusters) {
    if (!Array.isArray(emergentClusters) || !emergentClusters.length || !currentFields.size) return null;
    const rank = { high: 3, medium: 2, low: 1 };
    let best = null;
    for (const cluster of emergentClusters) {
        const clusterFields = new Set(cluster.fields);
        if (clusterFields.size <= currentFields.size) continue;
        let isSubset = true;
        for (const f of currentFields) {
            if (!clusterFields.has(f)) { isSubset = false; break; }
        }
        if (!isSubset) continue;
        if (!best
            || rank[cluster.confidence] > rank[best.confidence]
            || (rank[cluster.confidence] === rank[best.confidence] && cluster.noteCount > best.noteCount)
        ) {
            best = cluster;
        }
    }
    return best;
}

/**
 * Cold-start arc: no vault bundle yet for this type (or too few peers to trust).
 * Checks for a matching emergent cluster first — a real, vault-taught pattern
 * beats a hardcoded universal guess whenever one applies. Falls back to
 * universally useful fields, at low confidence, when no cluster matches.
 */
function _buildColdStartArc(nt, noteFields, opts = {}) {
    const { limit = 5, emergentClusters = null } = opts;
    const currentFields = new Set();
    for (const [key, raw] of Object.entries(noteFields || {})) {
        const norm = _norm(key);
        if (!norm || SKIP_FIELDS.has(norm)) continue;
        const vals = Array.isArray(raw) ? raw : [raw];
        if (vals.some(v => String(v || '').trim())) currentFields.add(norm);
    }

    const matchedCluster = _matchEmergentCluster(currentFields, emergentClusters);
    if (matchedCluster) {
        /** @type {ArcField[]} */
        const clusterMissingFields = matchedCluster.fields
            .filter((f) => !currentFields.has(f) && !SKIP_FIELDS.has(f))
            .slice(0, limit)
            .map((field) => ({
                field,
                ratio:            0,
                adjustedRatio:    0,
                calibrationCount: 0,
                score:            CLUSTER_CONFIDENCE_SCORE[matchedCluster.confidence] || 0.20,
                confidenceLabel:  /** @type {'high'|'medium'|'low'} */ (matchedCluster.confidence),
                isRelation:       false,
                coldStart:        true,
                emergentCluster:  true
            }));
        if (clusterMissingFields.length) {
            return { inferredType: nt || null, missingFields: clusterMissingFields };
        }
    }

    /** @type {ArcField[]} */
    const missingFields = COLD_START_FIELDS
        .filter(f => !currentFields.has(f))
        .slice(0, limit)
        .map(field => ({
            field,
            ratio:           0,
            adjustedRatio:   0,
            calibrationCount: 0,
            score:           0.08,
            /** @type {'low'} */ confidenceLabel: 'low',
            isRelation:      false,
            coldStart:       true
        }));

    return { inferredType: nt || null, missingFields };
}

function _norm(s) { return String(s || '').trim().toLowerCase(); }

/**
 * @typedef {{
 *   field: string,
 *   ratio: number,
 *   adjustedRatio: number,
 *   calibrationCount: number,
 *   score: number,
 *   confidenceLabel: 'high' | 'medium' | 'low',
 *   isRelation: boolean,
 *   coldStart?: boolean,
 *   emergentCluster?: boolean
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
 * @param {{ limit?: number, minRatio?: number, typeBundleTotals?: Map<string, number>|null, emergentClusters?: Array<{fields: string[], noteIds: string[], noteCount: number, dominantType: string|null, confidence: 'low'|'medium'|'high'}>|null }} [opts]
 * @returns {NoteArc}
 */
function buildNoteArc(noteFields, noteType, fieldsCache, typeFieldBundles, fieldTargetTypes, outcomeCalibration, opts = {}) {
    const { limit = 5, minRatio = 0.30, typeBundleTotals = null } = opts;
    const nt = _norm(noteType);

    // Untyped note — suggest adding type: first, then universal starter fields.
    if (!nt) return _buildColdStartArc(null, noteFields, opts);

    // No vault bundle yet for this type → cold start.
    const hasBundle = typeFieldBundles && typeFieldBundles.has(nt);
    if (!hasBundle) return _buildColdStartArc(nt, noteFields, opts);

    // Only 1 peer — if the caller passes typeBundleTotals we can detect this reliably.
    // When typeBundleTotals is not provided we trust the bundle (backward compat).
    if (typeBundleTotals) {
        const bundleTotal = typeBundleTotals.get(nt) || 0;
        if (bundleTotal < 2) return _buildColdStartArc(nt, noteFields, opts);
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
        { limit: limit + currentFields.size + 5, minRatio },
        typeBundleTotals
    );

    const calByField = outcomeCalibration?.byField || new Map();

    const missingFields = commonFields
        .filter(({ field }) => !SKIP_FIELDS.has(_norm(field)) && !currentFields.has(_norm(field)))
        .map(({ field, ratio, adjustedRatio }) => {
            const fn = _norm(field);
            const calCount = calByField.get(fn) || 0;
            // Calibration boost: each accepted suggestion adds a small upward pull.
            // Capped so calibration alone cannot dominate vault evidence.
            // Bundle-frequency weighting: when vault consensus and user acceptance both
            // agree on a field (high ratio + accepted suggestions), the combined signal
            // is proportionally stronger than acceptance on a rare field.
            // At ratio=1.0 the boost is 40% larger than at ratio=0.
            const calBoostBase = calCount > 0 ? Math.min(0.20, calCount * 0.04) : 0;
            const calBoost = calBoostBase * (1.0 + ratio * 0.40);
            // Score on adjustedRatio: sample-size-weighted vault frequency.
            // A 2-note vault gets lower scores than a 20-note vault for the same
            // raw density — fewer confident predictions, not silence.
            const score = adjustedRatio * 0.75 + calBoost * 0.25;
            /** @type {'high' | 'medium' | 'low'} */
            const confidenceLabel = score >= 0.50 ? 'high' : score >= 0.25 ? 'medium' : 'low';
            const isRelation = Boolean(fieldTargetTypes?.has(fn));
            return { field: fn, ratio, adjustedRatio, calibrationCount: calCount, score, confidenceLabel, isRelation };
        })
        .sort((a, b) => b.score - a.score || a.field.localeCompare(b.field))
        .slice(0, limit);

    return { inferredType: nt, missingFields };
}

module.exports = { buildNoteArc };
