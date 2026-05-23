'use strict';

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

function computeNoteDrift(noteId, noteFields, fieldsCache, priors) {
    const noteType = _norm(noteFields?.type);
    if (!noteType || noteType === 'schema') return null;

    const bundle = priors.typeFieldBundles.get(noteType);
    if (!bundle || !bundle.size) return { noteId, noteType, insufficientData: true };

    let typeTotal = 0;
    for (const [, f] of fieldsCache) {
        if (_norm(f?.type) === noteType) typeTotal++;
    }
    if (typeTotal < MIN_TYPE_SAMPLE) return { noteId, noteType, insufficientData: true };

    const currentFieldSet = _currentFields(noteFields);

    // 1. Missing expected
    const missingExpected = [];
    for (const [field, count] of bundle.entries()) {
        const ratio = count / typeTotal;
        if (ratio >= EXPECTED_RATIO && !currentFieldSet.has(field)) {
            missingExpected.push({ field, ratio, count });
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
                unusualFields.push({ field, ratio, count });
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
            valueMismatches.push({ field, expected: 'wikilink', actual: 'scalar', linkRatio: ambiguity.linkRatio });
        } else if ((1 - ambiguity.linkRatio) >= LINK_MISMATCH_THRESHOLD && noteHasLink) {
            valueMismatches.push({ field, expected: 'scalar', actual: 'wikilink', linkRatio: ambiguity.linkRatio });
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

    return {
        noteId,
        noteType,
        driftScore,
        driftLabel,
        missingExpected,
        unusualFields,
        valueMismatches,
        typeTotal,
        insufficientData: false
    };
}

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
