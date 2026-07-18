'use strict';

const { getIndex, getFieldsCache, getVaultGeneration } = require('../core/indexService');
const { getCachedPriors, getCommonFieldsForType } = require('./vaultPriors');
const { buildNoteArc } = require('./noteArc');
const { inferLifecycleState } = require('./lifecycleState');
const { computeNoteDrift } = require('./driftDetector');
const { buildNoteEvolution } = require('./noteEvolution');
const {
    classifyFieldForAuthoring,
    evaluateFieldForSurface,
    getExpectedRelationTypes
} = require('./authoringEngine');
const { getBacklinks } = require('../core/graph');

let _getMutationEventsFn = null;

function setMutationEventsProvider(fn) {
    _getMutationEventsFn = typeof fn === 'function' ? fn : null;
}

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
        { typeBundleTotals: priors.typeBundleTotals, emergentClusters: priors.emergentClusters }
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

function getMutationEvents() {
    if (typeof _getMutationEventsFn !== 'function') return [];
    try {
        const events = _getMutationEventsFn();
        return Array.isArray(events) ? events : [];
    } catch (_) {
        return [];
    }
}

function buildTimeInState(lifecycle, evolution) {
    if (!lifecycle || typeof lifecycle !== 'object') return null;
    const lastTouchedDays = lifecycle.metrics?.lastTouchedDays;
    const created = evolution?.created || null;
    const lastActivity = evolution?.lastActivity || null;
    const approxDays = Number.isFinite(lastTouchedDays)
        ? lastTouchedDays
        : null;
    return {
        state: lifecycle.state || null,
        approxDays,
        basis: approxDays !== null ? 'lastTouchedDays' : 'unknown',
        created,
        lastActivity
    };
}

function buildMutationVelocity(noteId) {
    const events = getMutationEvents().filter((event) => event && event.noteId === noteId && event.timestamp);
    if (!events.length) {
        return {
            totalEvents: 0,
            lastActivity: null,
            eventsLast7d: 0,
            eventsLast30d: 0,
            editsLast7d: 0,
            editsLast30d: 0,
            averagePerWeek: 0
        };
    }

    const nowMs = Date.now();
    const sevenDaysAgo = nowMs - (7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = nowMs - (30 * 24 * 60 * 60 * 1000);
    let eventsLast7d = 0;
    let eventsLast30d = 0;
    let editsLast7d = 0;
    let editsLast30d = 0;
    const editTypes = new Set([
        'field_added',
        'field_changed',
        'field_removed',
        'relation_added',
        'relation_changed',
        'relation_removed',
        'type_set',
        'note_created'
    ]);

    for (const event of events) {
        const timestampMs = Date.parse(event.timestamp);
        if (Number.isNaN(timestampMs)) continue;
        if (timestampMs >= thirtyDaysAgo) {
            eventsLast30d++;
            if (editTypes.has(event.type)) editsLast30d++;
        }
        if (timestampMs >= sevenDaysAgo) {
            eventsLast7d++;
            if (editTypes.has(event.type)) editsLast7d++;
        }
    }

    const firstMs = Date.parse(events[0].timestamp);
    const spanDays = Number.isFinite(firstMs)
        ? Math.max(1, (nowMs - firstMs) / (24 * 60 * 60 * 1000))
        : 1;

    return {
        totalEvents: events.length,
        lastActivity: events[events.length - 1]?.timestamp || null,
        eventsLast7d,
        eventsLast30d,
        editsLast7d,
        editsLast30d,
        averagePerWeek: Number((events.length / (spanDays / 7)).toFixed(2))
    };
}

function buildCrossNotePatterns(noteFields, noteType, priors, fieldsCache) {
    if (!noteType) {
        return {
            inferredType: null,
            commonFields: [],
            matchedCommonFields: [],
            relationTargets: []
        };
    }

    const commonFields = getCommonFieldsForType(
        noteType,
        priors.typeFieldBundles,
        fieldsCache || getFieldsCache(),
        { limit: 6, minRatio: 0.2 },
        priors.typeBundleTotals
    );
    const commonFieldNames = commonFields.map((entry) => entry.field).filter(Boolean);
    const matchedCommonFields = commonFieldNames.filter((field) => Object.prototype.hasOwnProperty.call(noteFields, field));
    const relationTargets = Object.keys(noteFields || {})
        .filter((field) => priors.fieldTargetTypes?.has(field))
        .map((field) => {
            const rankedTargets = [...(priors.fieldTargetTypes.get(field) || new Map()).entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([targetType, count]) => ({ targetType, count }));
            return {
                field,
                targets: rankedTargets
            };
        })
        .filter((entry) => entry.targets.length > 0);

    return {
        inferredType: noteType,
        commonFields: commonFieldNames,
        matchedCommonFields,
        relationTargets
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
            likelyType: result.likelyType || null,
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
            { typeBundleTotals: priors.typeBundleTotals, emergentClusters: priors.emergentClusters }
        );
    } catch (_) {
        arc = null;
    }

    const evolution = buildNoteEvolution(noteId, getMutationEvents().filter((event) => event && event.noteId === noteId));
    const timeInState = buildTimeInState(lifecycle, evolution);
    const mutationVelocity = buildMutationVelocity(noteId);
    const crossNotePatterns = buildCrossNotePatterns(noteFields, noteType || lifecycle?.likelyType || '', priors, fieldsCache);

    return {
        id: noteId,
        lifecycle,
        drift,
        arc,
        timeInState,
        mutationVelocity,
        crossNotePatterns
    };
}

module.exports = {
    getNoteContext,
    buildArcSnapshot,
    buildTypeArcSnapshot,
    buildFieldCategorySnapshot,
    buildNoteIntelligenceSnapshot,
    setMutationEventsProvider
};
