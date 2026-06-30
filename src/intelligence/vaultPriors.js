'use strict';

// Per-vault statistical priors — what the vault itself has learned.
//
// Everything here is derived from the actual notes in this vault.
// No global heuristics. No hardcoded type names. No hardcoded field lists.
// The vault teaches the system — the system does not assume.
//
// Ten things are computed:
//   1. fieldTargetTypes     — for relational fields, what note types do they link to?
//   2. typeFieldBundles     — for each note type, what fields commonly co-occur?
//   3. fieldAmbiguity       — per field, what fraction of values are wikilinks vs scalar?
//   4. noteRoleTypePriors   — for each inferred note role, which vault type dominates?
//   5. vaultMaturity        — 0–1 scalar driving adaptive confidence thresholds
//   6. implicitFieldWeights — mutation log history: fields used as wikilinks in the past
//   7. valuePatterns        — per field, what do values actually look like? (date, wikilink, short scalar)
//   8. workflowFields       — vault-detected status-like fields (finite scalar value sets)
//   9. typeRoleMap          — structural role inference per type (no hardcoded type names)
//  10. outcomeCalibration   — user feedback: which field relation suggestions were accepted

const { buildImplicitFieldWeights, buildBehavioralRelationPriors } = require('./implicitWeights');
const { buildOutcomeCalibration } = require('./outcomeCalibration');
const {
    buildFieldTargetTypes,
    getDominantTargetType,
    buildTypeFieldBundles,
    buildTypeBundleTotals,
    getCommonFieldsForType,
    buildFieldAmbiguity,
    buildNoteRoleTypePriors,
    inferLikelyTypesForNote,
    buildValuePatterns,
    buildWorkflowFields,
    buildTypeRoleMap,
    getVaultMaturity,
    buildVaultStatusValues,
    buildVaultSemanticRolePriors,
    buildNoteRoleNamePriors,
    buildNoteRoleFieldHints
} = require('./vaultStatBuilders');

// Injection point — set by the VS Code extension at activation so vaultPriors
// can access the mutation log without importing from src/runtime/ (which would
// break the pure-module boundary and the CLI/test harness).
let _getMutationEventsFn = null;

/**
 * Inject a function that returns the current mutation events array.
 * Called once from extension.js after initMutationLog().
 * In tests and CLI: left null → implicit weights are empty but everything else works.
 * @param {() => Array<{ type: string, field: string|null, newValue: * }>} fn
 * @returns {void}
 */
function setMutationEventsProvider(fn) {
    _getMutationEventsFn = typeof fn === 'function' ? fn : null;
}

/**
 * @typedef {{ dateCount: number, wikilinkCount: number, shortScalarCount: number, longScalarCount: number, distinctScalars: Set<string> }} ValuePattern
 */

/**
 * @typedef {{ role: string, confidence: number, inboundRatio: number, relCount: number, dateCount: number, workflowCount: number }} TypeRoleEntry
 */

/**
 * @typedef {{
 *   fieldTargetTypes: Map<string, Map<string, number>>,
 *   typeFieldBundles: Map<string, Map<string, number>>,
 *   typeBundleTotals: Map<string, number>,
 *   fieldAmbiguity: Map<string, {linkCount: number, scalarCount: number, total: number, linkRatio: number}>,
 *   noteRoleTypePriors: Map<string, {dominantType: string, count: number}>,
 *   vaultMaturity: number,
 *   implicitFieldWeights: Map<string, {relationCount: number, total: number}>,
 *   valuePatterns: Map<string, ValuePattern>,
 *   workflowFields: Map<string, {values: string[], count: number}>,
 *   typeRoleMap: Map<string, TypeRoleEntry>,
 *   noteRoleNamePriors: Record<string, string[]>,
 *   noteRoleFieldHints: Record<string, string[]>,
 *   behavioralRelationPriors: {
 *     fieldTargetTypeScores: Map<string, Map<string, number>>,
 *     fieldTargetIdScores: Map<string, Map<string, number>>,
 *     noteTypeFieldTargetTypeScores: Map<string, Map<string, Map<string, number>>>,
 *     noteTypeFieldTargetIdScores: Map<string, Map<string, Map<string, number>>>
 *   },
 *   outcomeCalibration: import('./outcomeCalibration').OutcomeCalibration
 * }} VaultPriors
 */


// Generation-keyed cache — rebuilt once per vault mutation, not once per call.
let _cachedGeneration = -1;
let _cachedPriors = null;

/** @returns {void} */
function resetVaultPriorsCache() {
    _cachedGeneration = -1;
    _cachedPriors = null;
}

/**
 * Return all four prior maps for the current vault, computing them only when
 * the vault generation has changed since the last call.
 *
 * @param {Map} fieldsCache
 * @param {number} generation  — value from getVaultGeneration()
 * @returns {{ fieldTargetTypes: Map, typeFieldBundles: Map, fieldAmbiguity: Map, noteRoleTypePriors: Map }}
 */
/**
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {number} generation
 * @returns {VaultPriors}
 */
function getCachedPriors(fieldsCache, generation) {
    if (generation !== _cachedGeneration || !_cachedPriors) {
        const mutationEvents = _getMutationEventsFn ? _getMutationEventsFn() : [];
        const fieldTargetTypes  = buildFieldTargetTypes(fieldsCache);
        const typeFieldBundles  = buildTypeFieldBundles(fieldsCache);
        const typeBundleTotals  = buildTypeBundleTotals(fieldsCache);
        const fieldAmbiguity    = buildFieldAmbiguity(fieldsCache);
        const valuePatterns     = buildValuePatterns(fieldsCache);
        _cachedPriors = {
            fieldTargetTypes,
            typeFieldBundles,
            typeBundleTotals,
            fieldAmbiguity,
            noteRoleTypePriors:   buildNoteRoleTypePriors(fieldsCache),
            vaultMaturity:        getVaultMaturity(fieldsCache),
            implicitFieldWeights: buildImplicitFieldWeights(mutationEvents),
            behavioralRelationPriors: buildBehavioralRelationPriors(mutationEvents, fieldsCache),
            valuePatterns,
            workflowFields:       buildWorkflowFields(valuePatterns),
            typeRoleMap:          buildTypeRoleMap(typeFieldBundles, valuePatterns, fieldTargetTypes, fieldAmbiguity, fieldsCache),
            outcomeCalibration:   buildOutcomeCalibration(mutationEvents)
        };
        _cachedPriors.noteRoleNamePriors = buildNoteRoleNamePriors(_cachedPriors.typeRoleMap, fieldsCache);
        _cachedPriors.noteRoleFieldHints = buildNoteRoleFieldHints(_cachedPriors.typeFieldBundles, _cachedPriors.typeBundleTotals, _cachedPriors.typeRoleMap);
        _cachedGeneration = generation;
    }
    return _cachedPriors;
}

// ─── Vault-derived semantic values ─────────────────────────────────────────
// These replace the hardcoded DEFAULT_STATUS_LIKE_VALUES and
// DEFAULT_SEMANTIC_ROLE_PRIORS in fieldRolesCore.js. No static lists.
// The vault's own observed values and field patterns teach the system.

module.exports = {
    buildFieldTargetTypes,
    getDominantTargetType,
    buildTypeFieldBundles,
    buildTypeBundleTotals,
    getCommonFieldsForType,
    buildFieldAmbiguity,
    buildNoteRoleTypePriors,
    inferLikelyTypesForNote,
    getCachedPriors,
    resetVaultPriorsCache,
    getVaultMaturity,
    setMutationEventsProvider,
    buildValuePatterns,
    buildWorkflowFields,
    buildTypeRoleMap,
    buildVaultStatusValues,
    buildVaultSemanticRolePriors
};
