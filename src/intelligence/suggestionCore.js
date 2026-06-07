'use strict';

// Thin re-export shim — all callers import from this module unchanged.
// Index building: suggestionNoteIndex.js
// Pattern scoring: suggestionScorer.js
// Relation/bridge analysis: suggestionRelations.js

const {
    buildObservedFields,
    buildObservedNoteIndex,
    resetObservedNoteIndexCache,
    buildFieldRoleResults,
    buildNoteRoleHints,
    buildNoteContext,
    extractRelationIds,
    collectCurrentRelationSignals,
    computeObservedRecency
} = require('./suggestionNoteIndex');

const {
    buildAdaptiveConfidence,
    buildTypeTotals,
    computeFieldBundleOverlap,
    buildAdaptiveFieldPatterns,
    summarizeAdaptiveFieldHints
} = require('./suggestionScorer');

const {
    groupStructuredBacklinks,
    buildSchemaRelationGroups,
    buildObservedRelationGroups,
    buildSharedRelationContexts,
    describeContextOrigin,
    buildBridgePaths,
    buildSharedContextTraces,
    summarizeBridgeHints,
    summarizeTraceHints
} = require('./suggestionRelations');

module.exports = {
    buildObservedFields,
    buildObservedNoteIndex,
    resetObservedNoteIndexCache,
    buildFieldRoleResults,
    buildNoteRoleHints,
    buildNoteContext,
    extractRelationIds,
    collectCurrentRelationSignals,
    computeObservedRecency,
    buildAdaptiveConfidence,
    buildTypeTotals,
    computeFieldBundleOverlap,
    buildAdaptiveFieldPatterns,
    summarizeAdaptiveFieldHints,
    groupStructuredBacklinks,
    buildSchemaRelationGroups,
    buildObservedRelationGroups,
    buildSharedRelationContexts,
    describeContextOrigin,
    buildBridgePaths,
    buildSharedContextTraces,
    summarizeBridgeHints,
    summarizeTraceHints
};
