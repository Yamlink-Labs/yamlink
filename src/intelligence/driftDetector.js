'use strict';

/**
 * @typedef {{
 *   noteId: string,
 *   noteType: string,
 *   insufficientData: boolean,
 *   driftScore?: number,
 *   driftLabel?: string,
 *   driftLabelHuman?: string,
 *   missingExpected?: Array<{field: string, ratio: number, count: number, message: string}>,
 *   unusualFields?: Array<{field: string, ratio: number, count: number, message: string}>,
 *   valueMismatches?: Array<{field: string, expected: string, actual: string, linkRatio: number, message: string}>,
 *   typeTotal?: number
 * }} NoteDrift
 */

// Structural drift detection — computes how far a note's field structure has
// diverged from how its type is normally shaped in this vault.
//
// Three signals:
//   1. missingExpected  — fields that ≥60% of the same type have, but this note doesn't
//   2. unusualFields    — fields this note has that <15% of its type have (needs ≥5 notes)
//   3. valueMismatches  — fields where the value type (link vs. scalar) contradicts vault norm
//
// driftScore 0–100 → labels: on-track / minor-drift / drifting / outlier
//
// Minimum vault data required before reporting drift: 3 notes of the same type.
// Below that, the bundle is too sparse to be meaningful — returns insufficientData: true.

const SYSTEM_FIELDS = new Set(['id', 'type', 'created', 'updated', 'modified', 'indexed', '__yamlink_tags']);
const EXPECTED_RATIO = 0.60;
const UNUSUAL_RATIO  = 0.15;
const LINK_MISMATCH_THRESHOLD = 0.70;
const MIN_TYPE_SAMPLE = 3;
const MIN_UNUSUAL_SAMPLE = 5;

function _norm(s) { return String(s || '').trim().toLowerCase(); }

function _currentFields(noteFields) {
    return new Set(
        Object.keys(noteFields || {})
            .map(_norm)
            .filter(k => k && !SYSTEM_FIELDS.has(k))
    );
}

function _rawValue(noteFields, normalizedField) {
    const direct = noteFields[normalizedField];
    if (direct !== undefined) return direct;
    const key = Object.keys(noteFields || {}).find(k => _norm(k) === normalizedField);
    return key !== undefined ? noteFields[key] : undefined;
}

/**
 * @param {string} noteId
 * @param {Record<string, any>} noteFields
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {{ typeFieldBundles: Map<string, Map<string, number>>, fieldAmbiguity: Map<string, {linkRatio: number, total: number}>, typeBundleTotals?: Map<string, number> }} priors
 * @returns {NoteDrift|null}
 */
function computeNoteDrift(noteId, noteFields, fieldsCache, priors) {
    const noteType = _norm(noteFields?.type);
    if (!noteType || noteType === 'schema') return null;

    const bundle = priors.typeFieldBundles.get(noteType);
    if (!bundle || !bundle.size) return { noteId, noteType, insufficientData: true };

    // Use precomputed totals when available — avoids O(n) rescan per note
    let typeTotal;
    if (priors.typeBundleTotals?.has(noteType)) {
        typeTotal = priors.typeBundleTotals.get(noteType);
    } else {
        typeTotal = 0;
        for (const [, f] of fieldsCache) {
            if (_norm(f?.type) === noteType) typeTotal++;
        }
    }
    if (typeTotal < MIN_TYPE_SAMPLE) return { noteId, noteType, insufficientData: true };

    const currentFieldSet = _currentFields(noteFields);

    // 1. Missing expected
    const missingExpected = [];
    for (const [field, count] of bundle.entries()) {
        const ratio = count / typeTotal;
        if (ratio >= EXPECTED_RATIO && !currentFieldSet.has(field)) {
            const pct = Math.round(ratio * 100);
            const message = `Add '${field}' — ${pct}% of ${noteType} notes include it`;
            missingExpected.push({ field, ratio, count, message });
        }
    }
    missingExpected.sort((a, b) => b.ratio - a.ratio);

    // 2. Unusual fields (only when type is well-sampled)
    const unusualFields = [];
    if (typeTotal >= MIN_UNUSUAL_SAMPLE) {
        for (const field of currentFieldSet) {
            const count = bundle.get(field) || 0;
            const ratio = count / typeTotal;
            if (ratio < UNUSUAL_RATIO) {
                const pct = Math.round(ratio * 100);
                const message = pct === 0
                    ? `'${field}' isn't seen in other ${noteType} notes`
                    : `'${field}' is uncommon in ${noteType} notes (only ${pct}% have it)`;
                unusualFields.push({ field, ratio, count, message });
            }
        }
        unusualFields.sort((a, b) => a.ratio - b.ratio);
    }

    // 3. Value type mismatches
    const valueMismatches = [];
    for (const field of currentFieldSet) {
        const ambiguity = priors.fieldAmbiguity.get(field);
        if (!ambiguity || ambiguity.total < MIN_TYPE_SAMPLE) continue;
        const raw = _rawValue(noteFields, field);
        const noteValue = String(raw || '').trim();
        if (!noteValue) continue;
        const noteHasLink = noteValue.startsWith('[[');
        if (ambiguity.linkRatio >= LINK_MISMATCH_THRESHOLD && !noteHasLink) {
            const pct = Math.round(ambiguity.linkRatio * 100);
            const message = `'${field}' is usually a wikilink (${pct}% of cases) — consider linking to a note`;
            valueMismatches.push({ field, expected: 'wikilink', actual: 'scalar', linkRatio: ambiguity.linkRatio, message });
        } else if ((1 - ambiguity.linkRatio) >= LINK_MISMATCH_THRESHOLD && noteHasLink) {
            const pct = Math.round((1 - ambiguity.linkRatio) * 100);
            const message = `'${field}' is usually a plain value (${pct}% of cases) — this note has a wikilink`;
            valueMismatches.push({ field, expected: 'scalar', actual: 'wikilink', linkRatio: ambiguity.linkRatio, message });
        }
    }

    const missingScore  = missingExpected.reduce((s, e) => s + Math.round((e.ratio - EXPECTED_RATIO) * 80), 0);
    const unusualScore  = unusualFields.length * 10;
    const mismatchScore = valueMismatches.length * 15;
    const driftScore    = Math.min(100, missingScore + unusualScore + mismatchScore);

    const driftLabel =
        driftScore < 20 ? 'on-track'    :
        driftScore < 50 ? 'minor-drift' :
        driftScore < 80 ? 'drifting'    : 'outlier';

    const DRIFT_HUMAN = { 'on-track': 'On Track', 'minor-drift': 'Minor Drift', 'drifting': 'Drifting', 'outlier': 'Outlier' };
    const driftLabelHuman = DRIFT_HUMAN[driftLabel] || driftLabel;

    return {
        noteId,
        noteType,
        driftScore,
        driftLabel,
        driftLabelHuman,
        missingExpected,
        unusualFields,
        valueMismatches,
        typeTotal,
        insufficientData: false
    };
}

/**
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {{ typeFieldBundles: Map<string, Map<string, number>>, fieldAmbiguity: Map<string, {linkRatio: number, total: number}> }} priors
 * @returns {NoteDrift[]}
 */
function computeVaultDrift(fieldsCache, priors) {
    const results = [];
    for (const [noteId, noteFields] of fieldsCache) {
        if (!noteFields) continue;
        const noteType = _norm(noteFields?.type);
        if (!noteType || noteType === 'schema') continue;
        const drift = computeNoteDrift(noteId, noteFields, fieldsCache, priors);
        if (drift && !drift.insufficientData) results.push(drift);
    }
    return results.sort((a, b) => b.driftScore - a.driftScore || a.noteId.localeCompare(b.noteId));
}

/**
 * @param {NoteDrift[]} vaultDrift
 * @returns {{ total: number, onTrack: number, minorDrift: number, drifting: number, outliers: number, needsAttention: NoteDrift[] }}
 */
function getDriftSummary(vaultDrift) {
    const counts = { 'on-track': 0, 'minor-drift': 0, drifting: 0, outlier: 0 };
    for (const d of vaultDrift) counts[d.driftLabel] = (counts[d.driftLabel] || 0) + 1;
    return {
        total: vaultDrift.length,
        onTrack: counts['on-track'],
        minorDrift: counts['minor-drift'],
        drifting: counts.drifting,
        outliers: counts.outlier,
        needsAttention: vaultDrift.filter(d => d.driftLabel === 'drifting' || d.driftLabel === 'outlier')
    };
}

module.exports = {
    computeNoteDrift,
    computeVaultDrift,
    getDriftSummary
};
