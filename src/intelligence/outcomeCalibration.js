'use strict';

// Per-vault outcome calibration — what the user has actually accepted.
//
// The classifier predicts field categories at various confidence levels from
// various evidence sources. This module closes the feedback loop: every time
// the user accepts a relation completion we offered, that acceptance is logged
// as a `completion_accepted` event. Every `lightbulb_applied` event is the
// same signal via the lightbulb surface.
//
// Unlike implicitWeights (which tracks any time a field was set to a wikilink
// value), calibration tracks specifically when the SYSTEM'S PREDICTION was
// acted on by the user. This is the difference between "vault evidence" and
// "feedback evidence": the vault says what fields look like; calibration says
// whether our inferences about those fields were useful.
//
// A field with many accepted suggestions is one the system reliably classifies
// correctly. Confidence for that field gets a small upward adjustment so future
// suggestions fire earlier and with less hesitation.

/**
 * @typedef {{ byField: Map<string, number> }} OutcomeCalibration
 */

const OUTCOME_TYPES = new Set(['completion_accepted', 'lightbulb_applied']);

/**
 * Build per-field acceptance counts from the outcome event log.
 *
 * @param {Array<{ type: string, field: string|null }>} mutationEvents
 * @returns {OutcomeCalibration}
 */
function buildOutcomeCalibration(mutationEvents) {
    /** @type {Map<string, number>} */
    const byField = new Map();
    for (const event of (mutationEvents || [])) {
        if (!event || !OUTCOME_TYPES.has(event.type)) continue;
        const field = String(event.field || '').trim().toLowerCase();
        if (!field) continue;
        byField.set(field, (byField.get(field) || 0) + 1);
    }
    return { byField };
}

/**
 * Confidence boost for a field whose relation suggestions have been repeatedly
 * accepted by the user. Returns zero when there is no calibration history.
 *
 * Boost schedule:
 *   1 accepted suggestion  → +0.07   (strong enough to cross HINT threshold)
 *   3 accepted suggestions → +0.10
 *   6+ accepted suggestions → +0.15  (cap — calibration alone never reaches QUICKFIX)
 *
 * @param {string} fieldName
 * @param {OutcomeCalibration|null} calibration
 * @returns {{ boost: number, reason: string|null }}
 */
function getFieldCalibrationBoost(fieldName, calibration) {
    if (!calibration || !calibration.byField) return { boost: 0, reason: null };
    const fn = String(fieldName || '').trim().toLowerCase();
    const count = calibration.byField.get(fn) || 0;
    if (count === 0) return { boost: 0, reason: null };
    const boost = Math.min(0.15, 0.07 + (count - 1) * 0.016);
    const reason = count === 1
        ? `"${fn}" relation suggestion accepted once — system prediction confirmed`
        : `"${fn}" relation suggestions accepted ${count}× — system reliably predicts this field`;
    return { boost, reason };
}

module.exports = { buildOutcomeCalibration, getFieldCalibrationBoost };
