'use strict';

// Field action planner — the layer between classifier and surface.
//
// Contract: classifier -> planner -> surface
//
// The classifier says what a field probably is and how confident it is.
// The planner decides what help is appropriate given that classification
// and the cost of the surface being invoked.
// The surface decides whether to render.
//
// This is what turns "pattern matching" into trustworthy behavior:
// weak inference does not become loud UI.

const { CATEGORY, RELATION_STRENGTH } = require('./fieldCategory');

// Action levels — ordered from least to most assertive.
const LEVEL = Object.freeze({
    SILENCE:         0,  // no UI — planner is uncertain, or field is structural
    COMPLETION_ONLY: 1,  // [[]] candidates when user explicitly types — nothing proactive
    HINT:            2,  // candidates + contextual detail text in completion item
    DOCUMENT:        3,  // proactive document-level actions only (bundles, view suggestions)
    QUICKFIX:        4   // proactive field-scoped lightbulb quick-fix allowed
});

// How much to trust each evidence source.
// Schema is authoritative. Usage is learned. Calibration is user feedback. Prior is heuristic.
const SOURCE_WEIGHT = Object.freeze({
    schema:      1.00,
    usage:       0.85,
    calibration: 0.83,  // user accepted our prediction — high trust, accumulates over time
    implicit:    0.80,  // mutation log history — strong but not as strong as current vault state
    context:     0.75,  // same-note field pattern — supporting evidence, not primary
    prior:       0.70,
    default:     0.00
});

// These categories never receive relation UI — no exception, no confidence override.
const HARD_BLOCKED = new Set([
    CATEGORY.IDENTITY,
    CATEGORY.STRUCTURAL,
    CATEGORY.DATE,
    CATEGORY.WORKFLOW
]);

// Scale a confidence threshold by vault maturity.
// maturity=0 (brand new vault): bars drop to 65% — the system must speak up.
// maturity=1 (established vault): full bars — the system can afford to be selective.
/** @param {number} base @param {number|null|undefined} vaultMaturity @returns {number} */
function _adjustedThreshold(base, vaultMaturity) {
    return base * (0.65 + 0.35 * Math.max(0, Math.min(1, vaultMaturity ?? 1)));
}

/**
 * Decide what UI level and which actions are appropriate for a classified field
 * on a given surface.
 *
 * Surfaces differ in cost:
 *   lightbulb  — proactive, interruptive. User did not ask. Higher bar.
 *   completion — reactive. User typed [[ or triggered suggest. Lower bar.
 *   decoration — passive. Lowest bar.
 *
 * @param {{ category: string, confidence: number, source: string, reasons?: string[], relationStrength?: string|null, vaultMaturity?: number }} classification
 * @param {string} surface
 * @returns {{ level: number, allowedActions: Set<string>, reason: string }}
 */
function planFieldActions(classification, surface) {
    const { category, confidence, source, relationStrength = null } = classification;
    const vaultMaturity = classification.vaultMaturity ?? 1;
    const weight = SOURCE_WEIGHT[source] ?? 0.70;
    const ec = confidence * weight; // effective confidence
    const isCertainRelation = relationStrength === RELATION_STRENGTH.CERTAIN;
    const isLikelyRelation = relationStrength === RELATION_STRENGTH.LIKELY;
    const isWeakRelation = relationStrength === RELATION_STRENGTH.WEAK;

    if (HARD_BLOCKED.has(/** @type {any} */ (category))) {
        return _plan(LEVEL.SILENCE, [], `${category} fields never receive relation UI`, classification, ec, weight);
    }

    if (surface === 'lightbulb') {
        // Proactive — only speak when we are fairly sure.
        // On immature vaults the bars lower so the first typed link isn't met with silence.
        if (category !== CATEGORY.RELATION) {
            return _plan(LEVEL.SILENCE, [], `${category} below lightbulb threshold — staying quiet`, classification, ec, weight);
        }
        if (ec >= _adjustedThreshold(0.72, vaultMaturity) && !isWeakRelation) {
            return _plan(LEVEL.QUICKFIX,
                ['relationCompletion', 'fieldQuickfix', 'documentBundle', 'documentView', 'createNote'],
                `RELATION confirmed (ec=${_pct(ec)} via ${source}${relationStrength ? `, ${relationStrength}` : ''})`,
                classification,
                ec,
                weight);
        }
        if (ec >= _adjustedThreshold(0.38, vaultMaturity) || (isLikelyRelation && ec >= _adjustedThreshold(0.34, vaultMaturity))) {
            return _plan(LEVEL.DOCUMENT,
                ['documentBundle', 'documentView'],
                `RELATION likely (ec=${_pct(ec)} via ${source}${relationStrength ? `, ${relationStrength}` : ''}) — document actions only`,
                classification,
                ec,
                weight);
        }
        if (ec >= _adjustedThreshold(0.28, vaultMaturity) || (isWeakRelation && ec >= _adjustedThreshold(0.24, vaultMaturity))) {
            return _plan(LEVEL.HINT,
                ['fieldHint'],
                `weak RELATION signal (ec=${_pct(ec)}${relationStrength ? `, ${relationStrength}` : ''}) — hint only`,
                classification,
                ec,
                weight);
        }
        return _plan(LEVEL.SILENCE, [], `RELATION confidence too low (ec=${_pct(ec)}) — silence`, classification, ec, weight);
    }

    if (surface === 'completion') {
        // Reactive — user explicitly triggered; more permissive
        if (category === CATEGORY.RELATION) {
            const actions = ['relationCompletion', 'fieldHint'];
            // Only offer create-note when we have real signal, not just a name pattern
            if (source === 'schema' || (ec >= 0.60 && !isWeakRelation) || (isCertainRelation && ec >= 0.54)) actions.push('createNote');
            return _plan(LEVEL.HINT, actions, `RELATION completion (ec=${_pct(ec)} via ${source}${relationStrength ? `, ${relationStrength}` : ''})`, classification, ec, weight);
        }
        // DESCRIPTIVE or UNKNOWN — user typed [[, let them have candidates but no extras
        if (source === 'usage' || ec >= 0.15) {
            return _plan(LEVEL.COMPLETION_ONLY,
                ['relationCompletion'],
                `${category} — candidates allowed on explicit request`,
                classification,
                ec,
                weight);
        }
        return _plan(LEVEL.SILENCE, [], `${category} — no signal for completion`, classification, ec, weight);
    }

    if (surface === 'decoration') {
        return _plan(LEVEL.COMPLETION_ONLY, ['relationCompletion'], 'decoration — passive surface', classification, ec, weight);
    }

    return _plan(LEVEL.SILENCE, [], 'unknown surface', classification, ec, weight);
}

/**
 * Quick test — can a specific action fire for this field on this surface?
 * @param {{ category: string, confidence: number, source: string }} classification
 * @param {'lightbulb'|'completion'|'decoration'} surface
 * @param {string} actionName
 */
/**
 * @param {{ category: string, confidence: number, source: string, relationStrength?: string|null }} classification
 * @param {string} surface
 * @param {string} actionName
 * @returns {boolean}
 */
function canAct(classification, surface, actionName) {
    return planFieldActions(classification, surface).allowedActions.has(actionName);
}

function _plan(level, actions, reason, classification, effectiveConfidence, sourceWeight) {
    return {
        level,
        allowedActions: new Set(actions),
        reason,
        debug: {
            category: classification.category,
            confidence: classification.confidence,
            source: classification.source,
            sourceWeight,
            effectiveConfidence,
            relationStrength: classification.relationStrength || null,
            reasons: classification.reasons || []
        }
    };
}

function _pct(n) {
    return `${Math.round(n * 100)}%`;
}

module.exports = { LEVEL, SOURCE_WEIGHT, planFieldActions, canAct };
