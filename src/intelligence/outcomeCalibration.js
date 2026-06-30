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
//
// Signal decay: user preferences evolve faster than vault structure.
// Half-life = 60 days. An acceptance 2 months old contributes 0.5x its original
// signal. This prevents stale calibration data from inflating confidence for
// fields the vault has since evolved away from.

/**
 * @typedef {{ byField: Map<string, number> }} OutcomeCalibration
 */

const OUTCOME_TYPES = new Set(['completion_accepted', 'lightbulb_applied']);
const CALIBRATION_HALF_LIFE_DAYS = 60;
const MS_PER_DAY = 86400000;
const DECAY_FLOOR = 0.1;

function _decayFactor(ageDays) {
    return Math.pow(0.5, ageDays / CALIBRATION_HALF_LIFE_DAYS);
}

/**
 * Build per-field acceptance counts from the outcome event log.
 *
 * Each accepted event contributes a time-decayed weight to `byField` rather
 * than a flat +1. Recent acceptances count fully; older ones fade out. This
 * means `byField` values are floats when timestamps are present.
 *
 * @param {Array<{ type: string, field: string|null, timestamp?: string }>} mutationEvents
 * @param {number} [nowMs] Current time in ms — pass explicitly in tests to freeze time.
 * @returns {OutcomeCalibration}
 */
function buildOutcomeCalibration(mutationEvents, nowMs = Date.now()) {
    /** @type {Map<string, number>} */
    const byField = new Map();
    for (const event of (mutationEvents || [])) {
        if (!event || !OUTCOME_TYPES.has(event.type)) continue;
        const field = String(event.field || '').trim().toLowerCase();
        if (!field) continue;
        const ageDays = event.timestamp
            ? Math.max(0, (nowMs - new Date(event.timestamp).getTime()) / MS_PER_DAY)
            : 0;
        byField.set(field, (byField.get(field) || 0) + _decayFactor(ageDays));
    }
    return { byField };
}

/**
 * Confidence boost for a field whose relation suggestions have been repeatedly
 * accepted by the user. Returns zero when there is no calibration history.
 *
 * Boost is computed from the time-decayed acceptance count (float), so recent
 * acceptances carry more weight than old ones.
 *
 * Boost schedule:
 *   ~1.0  accepted (effective) → +0.07   (strong enough to cross HINT threshold)
 *   ~3.0  accepted             → +0.10
 *   ~6.0+ accepted             → +0.15  (cap — calibration alone never reaches QUICKFIX)
 *
 * @param {string} fieldName
 * @param {OutcomeCalibration|null} calibration
 * @returns {{ boost: number, reason: string|null }}
 */
function getFieldCalibrationBoost(fieldName, calibration) {
    if (!calibration || !calibration.byField) return { boost: 0, reason: null };
    const fn = String(fieldName || '').trim().toLowerCase();
    const count = calibration.byField.get(fn) || 0;
    if (count < DECAY_FLOOR) return { boost: 0, reason: null };
    const boost = Math.min(0.15, 0.07 + (count - 1) * 0.016);
    const rawCount = Math.round(count);
    const reason = rawCount <= 1
        ? `"${fn}" relation suggestion accepted once — system prediction confirmed`
        : `"${fn}" relation suggestions accepted ${rawCount}× — system reliably predicts this field`;
    return { boost, reason };
}

module.exports = { buildOutcomeCalibration, getFieldCalibrationBoost };
