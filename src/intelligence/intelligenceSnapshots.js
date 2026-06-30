'use strict';

const { getIndex, getFieldsCache, getVaultGeneration } = require('../core/indexService');
const { getCachedPriors } = require('./vaultPriors');
const { buildNoteArc } = require('./noteArc');
const { inferLifecycleState } = require('./lifecycleState');
const { computeNoteDrift } = require('./driftDetector');
const {
    classifyFieldForAuthoring,
    evaluateFieldForSurface,
    getExpectedRelationTypes
} = require('./authoringEngine');
const { getBacklinks } = require('../core/graph');

function getNoteContext(noteId) {
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    if (!idIndex.has(noteId)) return null;
    const noteFields = fieldsCache.get(noteId) || {};
    const noteType = noteFields.type || null;
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    return { noteId, idIndex, fieldsCache, noteFields, noteType, priors };
}

function buildArcSnapshot(noteId) {
    const context = getNoteContext(noteId);
    if (!context) return null;
    const { noteFields, noteType, fieldsCache, priors } = context;
    const arc = buildNoteArc(
        noteFields,
        noteType,
        fieldsCache,
        priors.typeFieldBundles,
        priors.fieldTargetTypes,
        priors.outcomeCalibration,
        { typeBundleTotals: priors.typeBundleTotals }
    );
    return { id: noteId, ...arc };
}

function buildTypeArcSnapshot(noteType) {
    const normalizedType = String(noteType || '').trim().toLowerCase();
    const fieldsCache = getFieldsCache();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());

    if (!normalizedType || !priors.typeFieldBundles.has(normalizedType)) {
        return {
            ok: true,
            id: null,
            type: normalizedType || null,
            inferredType: normalizedType || null,
            missingFields: [],
            coldStart: true
        };
    }

    const arc = buildNoteArc(
        {},
        normalizedType,
        fieldsCache,
        priors.typeFieldBundles,
        priors.fieldTargetTypes,
        priors.outcomeCalibration,
        { limit: 5, typeBundleTotals: priors.typeBundleTotals }
    );

    return {
        ok: true,
        id: null,
        type: normalizedType,
        inferredType: normalizedType,
        missingFields: Array.isArray(arc.missingFields)
            ? arc.missingFields.map((entry) => ({
                field: entry.field,
                confidence: entry.score ?? 0,
                reason: entry.coldStart
                    ? 'Cold-start suggestion for a new note of this type'
                    : `Common in ${normalizedType} notes across this vault`
            }))
            : [],
        ...(Array.isArray(arc.missingFields) && arc.missingFields.some((entry) => entry.coldStart) ? { coldStart: true } : {})
    };
}

function buildFieldCategorySnapshot(noteId, fieldName) {
    const context = getNoteContext(noteId);
    if (!context) return null;
    const { noteFields, noteType, fieldsCache } = context;
    const authoringOptions = {
        fieldsCache,
        noteFields,
        noteType,
        generation: getVaultGeneration()
    };
    const { classification } = classifyFieldForAuthoring(fieldName, authoringOptions);
    const lightbulb = evaluateFieldForSurface(fieldName, 'lightbulb', authoringOptions);
    const completion = evaluateFieldForSurface(fieldName, 'completion', authoringOptions);
    const decoration = evaluateFieldForSurface(fieldName, 'decoration', authoringOptions);
    const expectedTypes = getExpectedRelationTypes(fieldName, authoringOptions);
    return {
        id: noteId,
        field: fieldName,
        ...classification,
        expectedTypes,
        surfaces: {
            lightbulb: {
                level: lightbulb.plan.level,
                reason: lightbulb.plan.reason
            },
            completion: {
                level: completion.plan.level,
                reason: completion.plan.reason
            },
            decoration: {
                level: decoration.plan.level,
                reason: decoration.plan.reason
            }
        },
        debug: {
            lightbulb: lightbulb.plan.debug,
            completion: completion.plan.debug,
            decoration: decoration.plan.debug
        }
    };
}

function buildNoteIntelligenceSnapshot(noteId) {
    const context = getNoteContext(noteId);
    if (!context) return null;
    const { idIndex, fieldsCache, noteFields, noteType, priors } = context;

    let lifecycle = null;
    try {
        const result = inferLifecycleState(noteId, noteFields, {
            fieldsCache,
            idIndex,
            typeFieldBundles: priors.typeFieldBundles,
            noteRoleTypePriors: priors.noteRoleTypePriors,
            inboundCount: getBacklinks(noteId)?.length || 0,
            noteType: noteType || null
        });
        lifecycle = result ? {
            state: String(result.state || '').toLowerCase(),
            label: String(result.label || result.state || ''),
            isStale: Boolean(result.isStale),
            reasons: Array.isArray(result.reasons) ? result.reasons : [],
            metrics: result.metrics || {}
        } : null;
    } catch (_) {
        lifecycle = null;
    }

    let drift = null;
    try {
        const result = computeNoteDrift(noteId, noteFields, fieldsCache, priors);
        drift = result ? {
            insufficientData: Boolean(result.insufficientData),
            driftLabel: result.driftLabel || null,
            driftLabelHuman: result.driftLabelHuman || null,
            driftScore: result.driftScore ?? null,
            missingExpected: Array.isArray(result.missingExpected) ? result.missingExpected : [],
            unusualFields: Array.isArray(result.unusualFields) ? result.unusualFields : []
        } : null;
    } catch (_) {
        drift = null;
    }

    let arc = null;
    try {
        arc = buildNoteArc(
            noteFields,
            noteType,
            fieldsCache,
            priors.typeFieldBundles,
            priors.fieldTargetTypes,
            priors.outcomeCalibration,
            { typeBundleTotals: priors.typeBundleTotals }
        );
    } catch (_) {
        arc = null;
    }

    return { id: noteId, lifecycle, drift, arc };
}

module.exports = {
    getNoteContext,
    buildArcSnapshot,
    buildTypeArcSnapshot,
    buildFieldCategorySnapshot,
    buildNoteIntelligenceSnapshot
};
