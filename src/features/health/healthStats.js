'use strict';

/**
 * @typedef {{ type: string, count: number }} SchemaAdvisory
 * @typedef {{ noteId: string, missingFields: string[] }} NonConformantNote
 * @typedef {{
 *   type: string, total: number, conformant: number, nonConformant: number,
 *   requiredCount: number, notesWithMissing: NonConformantNote[]
 * }} SchemaCoverage
 * @typedef {{ schemaType: string, field: string, targetType: string }} DanglingRelation
 * @typedef {{
 *   advisories: SchemaAdvisory[], coverage: SchemaCoverage[], danglingRelations: DanglingRelation[]
 * }} SchemaIntelligence
 */

/**
 * @typedef {{
 *   nodes: number, edges: number, broken: number, orphans: string[],
 *   types: Array<{type: string, count: number, nodes: string[]}>,
 *   lifecycle: { counts: Record<string,number>, notes: Array<{id:string,state:string,label:string,summary:string}> },
 *   drift: any, todayActivity: Array<{noteId:string,count:number}>, todaySessions?: object[],
 *   todaySummary?: Record<string, any>, todayBursts?: Array<{type:string,count:number,noteIds:string[],windowMs:number}>,
 *   schemas: any, uniqueTypes: number, density: string,
 *   templateDrift: Map<string,any>, schemaIntelligence: SchemaIntelligence,
 *   intelligenceHealth: Record<string, any>,
 *   emergingClusters?: Array<{ fields: string[], noteIds: string[], noteCount: number, dominantType: string|null, confidence: string }>,
 *   topRelationships?: Array<{sourceId:string,field:string,targetId:string,score:number,structuralWeight:number,decayedMutationWeight:number,repetition:number}>,
  healthTrend?: { brokenTrend: 'up'|'down'|'same'|null, orphanTrend: 'up'|'down'|'same'|null, brokenDelta: number|null, orphanDelta: number|null, snapshotCount: number }
 * }} HealthStats
 */

const path = require('path');
const { getIndex, getFieldsCache } = require('../../core/indexService');
const { readHealthSnapshotTrend } = require('../../core/healthSnapshot');
const { getGraphStats, getEdges, isOrphan } = require('../../core/graph');
const { getRegistry, getRegistryStats } = require('../../registries/typeRegistry');
const { getSchemaStats, getSchema, getSchemaTargets } = require('../../registries/schemaRegistry');
const { getVaultGeneration } = require('../../core/indexService');
const { getCachedPriors, getVaultMaturity } = require('../../intelligence/vaultPriors');
const { inferNoteRole } = require('../../intelligence/noteRolesCore');
const { inferLifecycleState, summarizeLifecycleState } = require('../../intelligence/lifecycleState');
const { computeVaultDrift, getDriftSummary } = require('../../intelligence/driftDetector');
const { detectClusters } = require('../../intelligence/clusterEmergence');
const { buildNoteArc } = require('../../intelligence/noteArc');
const { getMutationEvents, getVaultSnapshots } = require('../../runtime/mutationEventLog');
const { buildSessionNarratives, buildFamilyStreaks, buildBehaviorEvolution } = require('../../runtime/mutationNarratives');
const { buildSessionSummary, detectWorkflowBursts } = require('../../intelligence/sessionSummary');
const { getTopGravityEdges } = require('../../intelligence/relationshipGravity');
const { getTemplateDrift, summarizeTemplateDrift } = require('../../core/templateRegistry');
const { buildLaneTrajectories, buildLaneRetrospectiveAccuracy, buildStalenessForecast } = require('../../intelligence/vaultTrends');

const SYSTEM_TYPES = new Set(['schema', 'dashboard', 'template']);
// A note is "stale" once this many days pass with no recorded mutation. Named
// so the threshold can be stated explicitly in projection summaries instead
// of leaving "stale" as an undefined term the vault owner has to guess at.
const STALE_DAYS_THRESHOLD = 90;

/**
 * @param {Map<string, string>} idIndex
 * @param {Map<string, object>} fieldsCache
 * @param {Map<string, Set<string>>} registry  type → Set<nodeId>
 * @returns {SchemaIntelligence}
 */
function buildSchemaIntelligence(idIndex, fieldsCache, registry) {
    const schemaTargets = getSchemaTargets(); // all lowercase
    const advisories = [];
    const coverage = [];
    const danglingRelations = [];

    // Build a lowercase-keyed view of the registry for cross-referencing with schema targets
    const registryByLower = new Map();
    for (const [type, ids] of registry.entries()) {
        registryByLower.set(type.toLowerCase(), { type, ids });
    }

    // Advisory: types with notes but no schema — only surfaced when ≥1 schema exists (amplifies, never gates)
    if (schemaTargets.size > 0) {
        for (const [type, nodeIds] of registry.entries()) {
            if (SYSTEM_TYPES.has(type.toLowerCase())) continue;
            if (!schemaTargets.has(type.toLowerCase())) {
                advisories.push({ type, count: nodeIds.size });
            }
        }
        advisories.sort((a, b) => b.count - a.count);
    }

    // Coverage: for each schema, compute required-field conformance across matching notes
    for (const schemaType of schemaTargets) {
        const schema = getSchema(schemaType);
        if (!schema) continue;

        const requiredFields = Object.entries(schema.fields)
            .filter(([, def]) => def.required)
            .map(([name]) => name);

        const registryEntry = registryByLower.get(schemaType);
        const nodeIds = registryEntry ? registryEntry.ids : new Set();
        const total = nodeIds.size;
        let conformant = 0;
        const notesWithMissing = [];

        for (const noteId of nodeIds) {
            const fields = fieldsCache.get(noteId) || {};
            const missing = requiredFields.filter(f => {
                const val = fields[f];
                return val === undefined || val === null || String(val).trim() === '';
            });
            if (missing.length === 0) {
                conformant++;
            } else {
                notesWithMissing.push({ noteId, missingFields: missing });
            }
        }

        coverage.push({
            type: schemaType,
            total,
            conformant,
            nonConformant: notesWithMissing.length,
            requiredCount: requiredFields.length,
            notesWithMissing: notesWithMissing.slice(0, 20)
        });

        // Dangling relation: field targets a type that has no notes in the vault
        for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
            if (fieldDef.type === 'relation' && fieldDef.target) {
                if (!registryByLower.has(fieldDef.target.toLowerCase())) {
                    danglingRelations.push({ schemaType, field: fieldName, targetType: fieldDef.target });
                }
            }
        }
    }

    coverage.sort((a, b) => a.type.localeCompare(b.type));

    return { advisories, coverage, danglingRelations };
}

/** @param {{ workspaceRoot?: string }} [options] @returns {HealthStats} */
function collectHealthStats(options = {}) {
    const { getBrokenCount } = require('../../diagnostics/diagnostics');
    const workspaceRoot = options.workspaceRoot || null;
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const graphStats = getGraphStats();
    const registryStats = getRegistryStats();
    const schemaStats = getSchemaStats();
    const brokenCount = getBrokenCount();
    const registry = getRegistry();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const { fieldTargetTypes, typeFieldBundles, noteRoleTypePriors } = priors;

    const indexedEdgePairs = new Set();
    for (const id of idIndex.keys()) {
        for (const edge of getEdges(id)) {
            if (idIndex.has(edge.targetId)) {
                indexedEdgePairs.add(`${id}\x00${edge.targetId}`);
            }
        }
    }
    const indexedEdgeCount = indexedEdgePairs.size;

    // Build last-mutation timestamp map and today's activity from the event log
    const allMutationEventsEarly = getMutationEvents();
    const lastMutationByNote = new Map();
    for (const event of allMutationEventsEarly) {
        const existing = lastMutationByNote.get(event.noteId);
        if (!existing || event.timestamp > existing) {
            lastMutationByNote.set(event.noteId, event.timestamp);
        }
    }
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEvents = getMutationEvents({ since: todayStart.toISOString() });
    const activityByNote = new Map();
    for (const event of todayEvents) {
        activityByNote.set(event.noteId, (activityByNote.get(event.noteId) || 0) + 1);
    }
    const todayActivity = [...activityByNote.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([noteId, count]) => ({ noteId, count }));
    const todaySessions = buildSessionNarratives(todayEvents, fieldsCache, { limit: 8 });
    const todaySummary = buildSessionSummary(todayEvents);
    const todayBursts = detectWorkflowBursts(todayEvents);

    const orphans = [];
    const lifecycleCounts = {
        draft: 0,
        growing: 0,
        consolidated: 0,
        hub: 0,
        stale: 0
    };
    const lifecycleNotes = [];
    const avgInbound = idIndex.size > 0
        ? (graphStats.totalBacklinks || 0) / idIndex.size
        : 0;
    for (const id of idIndex.keys()) {
        const fields = fieldsCache.get(id);
        const nodeType = (fields?.type || '').trim().toLowerCase();
        if (SYSTEM_TYPES.has(nodeType)) continue;

        if (fields) {
            const noteRole = inferNoteRole(fields, {
                typeRoleMap: priors.typeRoleMap || null,
                noteRolePriors: priors.noteRoleNamePriors || null,
                noteRoleFieldHints: priors.noteRoleFieldHints || null
            });
            const rawLastMs = lastMutationByNote.has(id) ? Date.parse(lastMutationByNote.get(id)) : null;
            const lifecycle = inferLifecycleState(id, fields, {
                idIndex,
                fieldsCache,
                fieldTargetTypes,
                typeFieldBundles,
                noteRoleTypePriors,
                noteRole,
                noteType: nodeType,
                inboundCount: getInboundCount(id, fieldsCache),
                avgInbound,
                lastMutationMs: Number.isFinite(rawLastMs) ? rawLastMs : undefined
            });
            lifecycleCounts[lifecycle.state] = (lifecycleCounts[lifecycle.state] || 0) + 1;
            lifecycleNotes.push({
                id,
                state: lifecycle.state,
                label: lifecycle.label,
                summary: summarizeLifecycleState(lifecycle)
            });
        }

        if (!isOrphan(id)) continue;
        orphans.push(id);
    }

    const types = [...registry.entries()]
        .map(([type, ids]) => ({
            type,
            count: ids.size,
            nodes: [...ids].sort()
        }))
        .sort((a, b) => b.count - a.count);

    const density = idIndex.size > 0
        ? (indexedEdgeCount / idIndex.size).toFixed(2)
        : '0.00';

    const vaultDrift = computeVaultDrift(fieldsCache, priors);
    const drift = getDriftSummary(vaultDrift);

    const intelligenceHealth = buildIntelligenceHealth(
        lifecycleCounts, drift, fieldsCache, priors, allMutationEventsEarly, lastMutationByNote
    );

    const templateDriftByType = workspaceRoot
        ? summarizeTemplateDrift(getTemplateDrift(workspaceRoot, fieldsCache))
        : new Map();

    const schemaIntelligence = buildSchemaIntelligence(idIndex, fieldsCache, registry);
    const emergingClusters = detectClusters(fieldsCache).clusters
        .filter((cluster) => cluster.confidence === 'medium' || cluster.confidence === 'high')
        .slice(0, 3);
    const topRelationships = getTopGravityEdges(priors.relationshipGravity, { limit: 8 });

    const healthTrend = workspaceRoot
        ? readHealthSnapshotTrend(path.join(workspaceRoot, '.yamlink'))
        : { brokenTrend: null, orphanTrend: null, brokenDelta: null, orphanDelta: null, snapshotCount: 0 };

    return {
        nodes: idIndex.size,
        edges: indexedEdgeCount,
        broken: brokenCount,
        orphans: orphans.sort(),
        types,
        lifecycle: {
            counts: lifecycleCounts,
            notes: lifecycleNotes.sort((a, b) => a.id.localeCompare(b.id))
        },
        drift,
        todayActivity,
        todaySessions,
        todaySummary,
        todayBursts,
        schemas: schemaStats.schemas,
        uniqueTypes: registryStats.uniqueTypes,
        density,
        templateDrift: templateDriftByType,
        schemaIntelligence,
        intelligenceHealth,
        emergingClusters,
        topRelationships,
        healthTrend
    };
}

/** @returns {object} */
function buildVaultTrendsSnapshot() {
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const graphStats = getGraphStats();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const mutationEvents = getMutationEvents();
    const lastMutationByNote = buildLastMutationByNote(mutationEvents);
    const lifecycleCounts = {
        draft: 0,
        growing: 0,
        consolidated: 0,
        hub: 0,
        stale: 0
    };
    const avgInbound = idIndex.size > 0
        ? (graphStats.totalBacklinks || 0) / idIndex.size
        : 0;

    for (const id of idIndex.keys()) {
        const fields = fieldsCache.get(id);
        const nodeType = String(fields?.type || '').trim().toLowerCase();
        if (!fields || SYSTEM_TYPES.has(nodeType)) continue;
        const rawLastMs = lastMutationByNote.has(id) ? Date.parse(lastMutationByNote.get(id)) : null;
        const noteRole = inferNoteRole(fields, {
            typeRoleMap: priors.typeRoleMap || null,
            noteRolePriors: priors.noteRoleNamePriors || null,
            noteRoleFieldHints: priors.noteRoleFieldHints || null
        });
        const lifecycle = inferLifecycleState(id, fields, {
            idIndex,
            fieldsCache,
            fieldTargetTypes: priors.fieldTargetTypes,
            typeFieldBundles: priors.typeFieldBundles,
            noteRoleTypePriors: priors.noteRoleTypePriors,
            noteRole,
            noteType: nodeType,
            inboundCount: getInboundCount(id, fieldsCache),
            avgInbound,
            lastMutationMs: Number.isFinite(rawLastMs) ? rawLastMs : undefined
        });
        lifecycleCounts[lifecycle.state] = (lifecycleCounts[lifecycle.state] || 0) + 1;
    }

    const vaultDrift = computeVaultDrift(fieldsCache, priors);
    const driftSummary = getDriftSummary(vaultDrift);
    const mutationBehavior = buildMutationBehavior(mutationEvents, fieldsCache);
    const projections = buildVaultProjections({
        fieldsCache,
        lifecycleCounts,
        vaultDrift,
        driftSummary,
        mutationEvents,
        calibrationEvents: mutationEvents.filter((event) => event.type === 'completion_accepted'),
        mutationBehavior,
        priors,
        lastMutationByNoteAll: lastMutationByNote
    });

    return {
        generatedAt: new Date().toISOString(),
        generation: getVaultGeneration(),
        horizonDays: projections.scenarios?.horizonDays || 90,
        ...projections
    };
}

/** @param {object[]} mutationEvents @returns {Map<string,string>} */
function buildLastMutationByNote(mutationEvents) {
    const lastMutationByNote = new Map();
    for (const event of mutationEvents || []) {
        if (!event?.noteId || !event?.timestamp) continue;
        const existing = lastMutationByNote.get(event.noteId);
        if (!existing || event.timestamp > existing) {
            lastMutationByNote.set(event.noteId, event.timestamp);
        }
    }
    return lastMutationByNote;
}

/**
 * Audit the four intelligence sub-systems and return a structured summary
 * for the "Intelligence Health" panel section.
 *
 * @param {Record<string,number>} lifecycleCounts
 * @param {object} driftSummary  result of getDriftSummary()
 * @param {Map<string,object>} fieldsCache
 * @param {object} priors  result of getCachedPriors()
 * @param {object[]} mutationEvents  full mutation log array
 * @returns {object}
 */
function buildIntelligenceHealth(lifecycleCounts, driftSummary, fieldsCache, priors, mutationEvents, lastMutationByNoteAll) {
    const { typeFieldBundles, fieldTargetTypes, outcomeCalibration } = priors;

    // ── System confidence score ──────────────────────────────────────────
    const vaultMaturity = getVaultMaturity(fieldsCache);

    const calibrationEvents = (mutationEvents || []).filter(e => e.type === 'completion_accepted');
    const calibrationNorm   = Math.min(1, calibrationEvents.length / 50);

    // Average field count per well-sampled type bundle (≥3 notes)
    const typeTotals = new Map();
    for (const [, fields] of fieldsCache) {
        const t = String(fields?.type || '').trim().toLowerCase();
        if (t) typeTotals.set(t, (typeTotals.get(t) || 0) + 1);
    }
    let bundleTotal = 0, bundleCount = 0;
    for (const [type, bundle] of typeFieldBundles) {
        if ((typeTotals.get(type) || 0) < 3) continue;
        bundleTotal += bundle.size;
        bundleCount++;
    }
    const avgBundleSize = bundleCount > 0 ? bundleTotal / bundleCount : 0;
    const bundleNorm    = Math.min(1, avgBundleSize / 8);

    const systemConfidence = Math.round(
        (vaultMaturity * 0.50 + calibrationNorm * 0.20 + bundleNorm * 0.30) * 100
    );

    // ── Lifecycle analysis ───────────────────────────────────────────────
    const lifecycleTotal = Object.values(lifecycleCounts).reduce((s, n) => s + n, 0);
    const staleRate       = lifecycleTotal > 0 ? (lifecycleCounts.stale || 0) / lifecycleTotal : 0;
    const consolidatedRate = lifecycleTotal > 0 ? (lifecycleCounts.consolidated || 0) / lifecycleTotal : 0;
    const draftRate       = lifecycleTotal > 0 ? (lifecycleCounts.draft || 0) / lifecycleTotal : 0;

    // ── Drift analysis ───────────────────────────────────────────────────
    const driftTotal      = driftSummary?.total ?? 0;
    const typedNotesCount = [...fieldsCache.values()].filter(f => {
        const t = String(f?.type || '').trim().toLowerCase();
        return t && !SYSTEM_TYPES.has(t);
    }).length;
    const insufficientCount  = Math.max(0, typedNotesCount - driftTotal);
    const problematicRate    = driftTotal > 0
        ? ((driftSummary?.drifting || 0) + (driftSummary?.outliers || 0)) / driftTotal
        : 0;

    // ── Arc prediction coverage (sample up to 60 typed notes) ───────────
    let arcEligible = 0, arcWithPredictions = 0;
    const fieldMissCounts = new Map();
    let sampled = 0;
    for (const [, fields] of fieldsCache) {
        if (sampled >= 60) break;
        const noteType = String(fields?.type || '').trim().toLowerCase();
        if (!noteType || SYSTEM_TYPES.has(noteType)) continue;
        if (!typeFieldBundles.has(noteType)) continue;
        sampled++;
        arcEligible++;
        const arc = buildNoteArc(
            fields, noteType, fieldsCache, typeFieldBundles,
            fieldTargetTypes, outcomeCalibration
        );
        if (arc.missingFields.length > 0) {
            arcWithPredictions++;
            for (const { field } of arc.missingFields.slice(0, 3)) {
                fieldMissCounts.set(field, (fieldMissCounts.get(field) || 0) + 1);
            }
        }
    }
    const topMissingFields = [...fieldMissCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([field, count]) => ({ field, count }));

    const vaultDrift = computeVaultDrift(fieldsCache, priors);
    const mutationBehavior = buildMutationBehavior(mutationEvents || [], fieldsCache);
    const projections = buildVaultProjections({
        fieldsCache,
        lifecycleCounts,
        vaultDrift,
        driftSummary,
        mutationEvents,
        calibrationEvents,
        mutationBehavior,
        priors,
        lastMutationByNoteAll
    });

    return {
        systemConfidence,
        vaultMaturityPct: Math.round(vaultMaturity * 100),
        lifecycle: {
            total:            lifecycleTotal,
            staleRate,
            consolidatedRate,
            draftRate,
            staleFlag:        staleRate > 0.30,
            sparseFlag:       lifecycleTotal < 5
        },
        drift: {
            total:            driftTotal,
            onTrack:          driftSummary?.onTrack   ?? 0,
            minorDrift:       driftSummary?.minorDrift ?? 0,
            drifting:         driftSummary?.drifting   ?? 0,
            outliers:         driftSummary?.outliers   ?? 0,
            insufficientCount,
            problematicRate,
            noisyFlag:        driftTotal > 5 && problematicRate > 0.30,
            topDriftingNotes: (driftSummary?.needsAttention || []).slice(0, 3)
        },
        arc: {
            eligible:         arcEligible,
            withPredictions:  arcWithPredictions,
            coverageRate:     arcEligible > 0 ? arcWithPredictions / arcEligible : 0,
            topMissingFields
        },
        calibration: {
            totalAccepted:    calibrationEvents.length,
            uniqueFields:     new Set(calibrationEvents.map(e => e.field).filter(Boolean)).size
        },
        mutationBehavior,
        projections
    };
}

function projectionConfidence(sampleScore) {
    if (sampleScore >= 0.8) return 'high';
    if (sampleScore >= 0.45) return 'medium';
    return 'low';
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function startOfUtcDay(ts) {
    const d = new Date(ts);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
}

function buildWeeklyBuckets(now, bucketCount, bucketDays) {
    const bucketMs = bucketDays * 86400000;
    const currentStart = startOfUtcDay(now);
    const buckets = [];
    for (let i = bucketCount - 1; i >= 0; i--) {
        const start = currentStart - (i * bucketMs);
        const end = start + bucketMs;
        buckets.push({
            start,
            end,
            label: `W${bucketCount - i}`,
            created: 0,
            touches: 0,
            structure: 0,
            completions: 0
        });
    }
    return buckets;
}

function classifyScenarioConfidence(baseEvidenceScore, extraWeight = 0) {
    return projectionConfidence(clamp01(baseEvidenceScore + extraWeight));
}

function buildMutationBehavior(mutationEvents, fieldsCache) {
    const now = Date.now();
    const windowMs = 30 * 86400000;
    const recentEvents = (mutationEvents || []).filter((event) => {
        const ts = Date.parse(event.timestamp);
        return Number.isFinite(ts) && (now - ts) <= windowMs;
    });
    const sessions = buildSessionNarratives(recentEvents, fieldsCache, { limit: 100 });
    const familyCounts = new Map();
    const modeCounts = new Map();
    let causalSessions = 0;
    let appliedSessions = 0;
    let exploratorySessions = 0;
    let mixedSessions = 0;

    for (const session of sessions) {
        familyCounts.set(session.family, (familyCounts.get(session.family) || 0) + 1);
        modeCounts.set(session.mode, (modeCounts.get(session.mode) || 0) + 1);
        if ((session.causalChain || []).length >= 2) causalSessions += 1;
        if (session.mode === 'applied') appliedSessions += 1;
        if (session.mode === 'exploratory') exploratorySessions += 1;
        if (session.mode === 'mixed') mixedSessions += 1;
    }

    const dominantFamily = [...familyCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'authoring';
    const totalSessions = sessions.length;
    const causalDensity = totalSessions > 0 ? causalSessions / totalSessions : 0;
    const appliedRate = totalSessions > 0 ? appliedSessions / totalSessions : 0;
    const exploratoryRate = totalSessions > 0 ? exploratorySessions / totalSessions : 0;
    const mixedRate = totalSessions > 0 ? mixedSessions / totalSessions : 0;
    const coherenceScore = clamp01((causalDensity * 0.5) + (mixedRate * 0.2) + (appliedRate * 0.3));
    const streaks = buildFamilyStreaks(sessions);
    const evolution = buildBehaviorEvolution(sessions);

    const summary = totalSessions === 0
        ? 'No recent session behavior yet.'
        : appliedRate >= 0.5
            ? 'Recent sessions are mostly execution-oriented; Yamlink is observing real structural work, not just browsing.'
            : exploratoryRate >= 0.5
                ? 'Recent sessions skew exploratory; the vault is being inspected more than structurally changed.'
                : 'Recent sessions mix exploration and execution, which is a healthy sign for adaptive authoring.';

    return {
        totalSessions,
        dominantFamily,
        familyCounts: Object.fromEntries(familyCounts),
        modeCounts: Object.fromEntries(modeCounts),
        causalDensity: Number(causalDensity.toFixed(2)),
        appliedRate: Number(appliedRate.toFixed(2)),
        exploratoryRate: Number(exploratoryRate.toFixed(2)),
        mixedRate: Number(mixedRate.toFixed(2)),
        coherenceScore: Number(coherenceScore.toFixed(2)),
        summary,
        streaks,
        evolution,
        recentSessions: sessions.slice(0, 5)
    };
}

function buildVaultProjections({ fieldsCache, lifecycleCounts, vaultDrift, driftSummary, mutationEvents, calibrationEvents, mutationBehavior, priors, lastMutationByNoteAll }) {
    const now = Date.now();
    // Shared 90-day horizon for growth trend-fitting (Time Engine-backed,
    // see below), the cleanup scenario, and retrospective accuracy scoring
    // — one constant so all three can never silently drift apart.
    const trendHorizonDays = 90;
    const windowDays = 30;
    const windowMs = windowDays * 86400000;
    const windowStart = now - windowMs;
    const weeklyBuckets = buildWeeklyBuckets(now, 4, 7);
    const touchedRecentByType = new Map();
    const lastMutationByNote = new Map();
    let touchEventsRecent = 0;
    let structureEventsRecent = 0;
    let acceptedCompletionsRecent = 0;
    const staleByType = new Map();
    const problematicByType = new Map();
    const fieldsByNoteId = new Map(fieldsCache);

    for (const event of mutationEvents || []) {
        const ts = Date.parse(event.timestamp);
        if (!Number.isFinite(ts) || ts < windowStart) continue;
        const existingLast = lastMutationByNote.get(event.noteId);
        if (!existingLast || ts > existingLast) {
            lastMutationByNote.set(event.noteId, ts);
        }
        const eventFields = fieldsByNoteId.get(event.noteId) || {};
        const eventType = String(eventFields?.type || '').trim().toLowerCase() || 'untyped';

        const bucket = weeklyBuckets.find((entry) => ts >= entry.start && ts < entry.end);
        if (bucket) {
            if (event.type === 'note_created') bucket.created += 1;
            if (event.type === 'note_touched') bucket.touches += 1;
            if (event.type === 'completion_accepted') bucket.completions += 1;
            if (event.type === 'field_added' || event.type === 'field_changed' || event.type === 'relation_added' || event.type === 'relation_changed' || event.type === 'relation_removed' || event.type === 'completion_accepted') {
                bucket.structure += 1;
            }
        }

        if (event.type === 'note_created') continue;

        if (event.type === 'note_touched') {
            touchEventsRecent += 1;
            if (!SYSTEM_TYPES.has(eventType) && eventType !== 'untyped') {
                touchedRecentByType.set(eventType, (touchedRecentByType.get(eventType) || 0) + 1);
            }
            continue;
        }

        if (event.type === 'completion_accepted') {
            acceptedCompletionsRecent += 1;
        }

        if (event.type === 'field_added' || event.type === 'field_changed' || event.type === 'relation_added' || event.type === 'relation_changed' || event.type === 'relation_removed' || event.type === 'completion_accepted') {
            structureEventsRecent += 1;
        }
    }

    for (const [noteId, fields] of fieldsByNoteId) {
        const noteType = String(fields?.type || '').trim().toLowerCase();
        if (!noteType || SYSTEM_TYPES.has(noteType)) continue;
        const lastMutation = lastMutationByNote.get(noteId);
        const isStaleByActivity = Number.isFinite(lastMutation)
            ? (now - lastMutation) > STALE_DAYS_THRESHOLD * 86400000
            : false;
        if (!staleByType.has(noteType)) {
            staleByType.set(noteType, { total: 0, stale: 0 });
        }
        const bucket = staleByType.get(noteType);
        bucket.total += 1;
        if (isStaleByActivity) bucket.stale += 1;
    }

    const missingFieldsByType = new Map();
    for (const drift of vaultDrift || []) {
        if (!drift || !drift.noteType) continue;
        if (!problematicByType.has(drift.noteType)) {
            problematicByType.set(drift.noteType, { total: 0, problematic: 0 });
        }
        const bucket = problematicByType.get(drift.noteType);
        bucket.total += 1;
        if (drift.driftLabel === 'drifting' || drift.driftLabel === 'outlier') {
            bucket.problematic += 1;
            // The actual "shape" a drifting note deviates from — real field
            // names from driftDetector.js's missingExpected, not a vague count.
            if (!missingFieldsByType.has(drift.noteType)) {
                missingFieldsByType.set(drift.noteType, new Map());
            }
            const fieldCounts = missingFieldsByType.get(drift.noteType);
            for (const entry of drift.missingExpected || []) {
                fieldCounts.set(entry.field, (fieldCounts.get(entry.field) || 0) + 1);
            }
        }
    }

    // Real trend-fitting via the Time Engine, replacing the old rolling-
    // 4-week-window-plus-multiplier model entirely (2026-07-13 rebuild,
    // extended to Stale/Structure 2026-07-16 — Phase 3/4). `buildLaneTrajectories`
    // reconstructs the vault at real historical checkpoints ONCE per
    // checkpoint and fits real least-squares lines through Growth, Stale,
    // and Structure together from that single reconstruction pass — see
    // src/intelligence/vaultTrends.js for the full rationale (this avoids
    // tripling the reconstruction cost that three independent trajectory
    // sweeps would otherwise pay). Persisted Time Engine snapshots (see
    // docs/architecture/TIME-ENGINE.md §4.1) extend how far back real
    // checkpoints can reach once the live mutation-log window runs out.
    const vaultSnapshots = getVaultSnapshots();
    const laneTrajectories = buildLaneTrajectories(
        { fieldsCache, mutationEvents, snapshots: vaultSnapshots, priors },
        { now, horizonDays: trendHorizonDays, staleDays: STALE_DAYS_THRESHOLD }
    );
    const laneRetrospective = buildLaneRetrospectiveAccuracy(
        { fieldsCache, mutationEvents, snapshots: vaultSnapshots, priors },
        { now, horizonDays: trendHorizonDays, staleDays: STALE_DAYS_THRESHOLD }
    );
    const trajectory = laneTrajectories.growth;
    const retrospective = { available: !!laneRetrospective.growth, overall: laneRetrospective.growth || null };
    const staleTrendFit = laneTrajectories.stale?.trend || null;
    const structureTrendFit = laneTrajectories.structure?.trend || null;
    const staleRetrospective = laneRetrospective.stale || null;
    const structureRetrospective = laneRetrospective.structure || null;

    const topGrowth = Object.entries(trajectory.byType || {})
        .map(([type, fit]) => ({
            type,
            currentTotal: fit.current,
            projected90: fit.projected,
            slope: fit.slope,
            r2: fit.r2,
            weeklyTotals: (trajectory.checkpoints || []).map((c) => c.byType[type] || 0),
            checkpointDates: (trajectory.checkpoints || []).map((c) => c.timestamp)
        }))
        .sort((a, b) => (b.projected90 - b.currentTotal) - (a.projected90 - a.currentTotal))
        .slice(0, 3);

    // A real trend exists or it doesn't — no partial credit blended in here.
    // Fit quality (r²) is reported separately on the leader below, rather
    // than folded into the same gate, so a real-but-noisy growth pattern
    // isn't hidden just because it doesn't fit a straight line well.
    const growthSampleScore = trajectory.overall ? 1 : 0;
    const growthConfidence = projectionConfidence(trajectory.overall ? trajectory.overall.r2 : 0);
    const leaderGrowth = topGrowth[0] || null;
    const retrospectiveClause = retrospective.available
        ? ` ${trendHorizonDays} days ago, this same model projected about ${retrospective.overall.projected} notes for today; the vault actually has ${retrospective.overall.actual} — ${Math.round(retrospective.overall.accuracy * 100)}% accurate.`
        : '';
    const growthSummary = !leaderGrowth
        ? 'Too little recent creation history for a growth forecast yet.'
        : `${leaderGrowth.type} notes are growing fastest — trending at about ${(leaderGrowth.slope * 7).toFixed(1)} notes/week (r²=${leaderGrowth.r2}), on track for about ${leaderGrowth.projected90} in ${trendHorizonDays} days.${retrospectiveClause}`;
    const growthTrend = !trajectory.overall
        ? 'steady'
        // A slope under ~1 note per 90-day horizon isn't a real trend worth
        // calling "rising" or "falling" — reads as steady rather than
        // reacting to noise in a very slow-moving vault.
        : trajectory.overall.slope * trendHorizonDays > 1 ? 'rising'
            : trajectory.overall.slope * trendHorizonDays < -1 ? 'falling'
                : 'steady';

    const lifecycleTotal = Object.values(lifecycleCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    const staleCount = lifecycleCounts?.stale || 0;
    const staleRate = lifecycleTotal > 0 ? staleCount / lifecycleTotal : 0;
    const staleTypeLeaders = [...staleByType.entries()]
        .filter(([, bucket]) => bucket.total >= 2)
        .map(([type, bucket]) => ({
            type,
            staleRate: bucket.total > 0 ? bucket.stale / bucket.total : 0,
            stale: bucket.stale,
            total: bucket.total,
            touchEventsRecent: touchedRecentByType.get(type) || 0
        }))
        .filter((entry) => entry.stale > 0)
        .sort((a, b) => b.staleRate - a.staleRate || b.stale - a.stale)
        .slice(0, 3);
    const stalePressure = staleRate >= 0.35
        ? 'high'
        : staleRate >= 0.2
            ? 'medium'
            : 'low';
    const staleSampleScore = clamp01(
        (Math.min(lifecycleTotal, 20) / 20) * 0.5 +
        (Math.min(touchEventsRecent, 12) / 12) * 0.3 +
        (staleTypeLeaders.length > 0 ? 0.2 : 0) +
        ((mutationBehavior?.appliedRate || 0) * 0.06)
    );
    // Real fitted trend (Phase 3, 2026-07-16) through actual reconstructed
    // checkpoints, replacing the weekly-touch-count heuristic — a rising
    // stale-count slope over real history is a genuine "worsening" signal,
    // not a proxy for one.
    const staleTrend = !staleTrendFit
        ? 'steady'
        : staleTrendFit.slope * trendHorizonDays > 1 ? 'worsening'
            : staleTrendFit.slope * trendHorizonDays < -1 ? 'improving'
                : 'steady';
    const staleTrendDelta = staleTrendFit ? Number((staleTrendFit.slope * 7).toFixed(2)) : 0;

    const problematic = (driftSummary?.drifting || 0) + (driftSummary?.outliers || 0);
    const sampled = driftSummary?.total || 0;
    const structureTypeLeaders = [...problematicByType.entries()]
        .filter(([, bucket]) => bucket.total >= 2)
        .map(([type, bucket]) => ({
            type,
            problematicRate: bucket.total > 0 ? bucket.problematic / bucket.total : 0,
            problematic: bucket.problematic,
            sampled: bucket.total,
            topMissingFields: [...(missingFieldsByType.get(type)?.entries() || [])]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([field]) => field)
        }))
        .filter((entry) => entry.problematic > 0)
        .sort((a, b) => b.problematicRate - a.problematicRate || b.problematic - a.problematic)
        .slice(0, 3);
    const structureDirection = acceptedCompletionsRecent > problematic && structureEventsRecent >= 3
        ? 'improving'
        : problematic > 0
            ? 'fragile'
            : 'steady';
    const structureSampleScore = clamp01(
        (Math.min(sampled, 16) / 16) * 0.45 +
        (Math.min(structureEventsRecent, 10) / 10) * 0.25 +
        (Math.min(acceptedCompletionsRecent, 8) / 8) * 0.15 +
        (structureTypeLeaders.length > 0 ? 0.15 : 0) +
        ((mutationBehavior?.coherenceScore || 0) * 0.12)
    );
    // Real fitted trend (Phase 3, 2026-07-16) — a rising problematic-note
    // slope over real history is genuine structural fragility, not a proxy
    // signal. Value space ('improving'/'fragile'/'steady') deliberately
    // matches structureDirection's existing vocabulary above.
    const structureTrend = !structureTrendFit
        ? 'steady'
        : structureTrendFit.slope * trendHorizonDays > 1 ? 'fragile'
            : structureTrendFit.slope * trendHorizonDays < -1 ? 'improving'
                : 'steady';
    const structureTrendDelta = structureTrendFit ? Number((structureTrendFit.slope * 7).toFixed(2)) : 0;
    const scenarioHorizonDays = trendHorizonDays;
    // Real fitted 90-day projections (Phase 3, 2026-07-16), replacing the
    // old rate*horizon*0.18 hand-tuned multiplier entirely — same rebuild
    // Growth itself went through on 2026-07-13. `staleTrendFit`/
    // `structureTrendFit` come from `buildLaneTrajectories`'s real
    // least-squares fit through reconstructed historical checkpoints, not a
    // guess extrapolated from 30 days of recent activity volume.
    const projectedStaleHold = staleTrendFit ? staleTrendFit.projected : staleCount;
    const projectedProblematicHold = structureTrendFit ? structureTrendFit.projected : problematic;
    const projectedStaleShareHold = lifecycleTotal > 0 ? projectedStaleHold / lifecycleTotal : 0;
    const cleanupScenarioBaseEvidence = clamp01((staleSampleScore * 0.45) + (structureSampleScore * 0.55));

    // Real numbers baked directly into the sentence — no canned 3-bucket
    // template. Always names the actual count/percentage and the 90-day
    // threshold that defines "stale" in the first place, rather than
    // assuming the reader already knows what "stale" or "structural drag"
    // concretely mean for their own vault.
    // Naming the actual offending type directly in the primary sentence,
    // not just a vault-wide abstract count with the real answer buried in a
    // secondary footnote — direct user feedback ("WHAT IS THE TYPE") after a
    // round that left the headline sentence generic and only named the type
    // in a separate, visually deprioritized paragraph underneath.
    const staleLeader = staleTypeLeaders[0] || null;
    const staleLeaderClause = staleLeader
        ? staleLeader.stale === staleCount
            ? ` — all of it in ${staleLeader.type} (${staleLeader.stale} of ${staleLeader.total})`
            : ` — mostly in ${staleLeader.type} (${staleLeader.stale} of ${staleLeader.total})`
        : '';
    const staleRetrospectiveClause = staleRetrospective
        ? ` ${scenarioHorizonDays} days ago, this same model projected about ${staleRetrospective.projected} stale notes for today; the vault actually has ${staleRetrospective.actual} — ${Math.round(staleRetrospective.accuracy * 100)}% accurate.`
        : '';
    const staleSummary = staleCount === 0
        ? `No notes have gone ${STALE_DAYS_THRESHOLD}+ days without a change yet — the vault looks current.`
        : projectedStaleHold < staleCount
            ? `${staleCount} of ${lifecycleTotal} notes (${Math.round(staleRate * 100)}%) haven't been changed in ${STALE_DAYS_THRESHOLD}+ days${staleLeaderClause}. Based on the real trend, that could ease to about ${projectedStaleHold} in ${scenarioHorizonDays} days.${staleRetrospectiveClause}`
            : `${staleCount} of ${lifecycleTotal} notes (${Math.round(staleRate * 100)}%) haven't been changed in ${STALE_DAYS_THRESHOLD}+ days${staleLeaderClause}. Based on the real trend, that number isn't likely to drop much in ${scenarioHorizonDays} days without more review activity than recently.${staleRetrospectiveClause}`;

    const structureLeader = structureTypeLeaders[0] || null;
    const structureLeaderFields = structureLeader?.topMissingFields?.length
        ? `, commonly missing ${structureLeader.topMissingFields.join(', ')}`
        : '';
    const structureLeaderClause = structureLeader
        ? structureLeader.problematic === problematic
            ? ` — all of it in ${structureLeader.type} (${structureLeader.problematic} of ${structureLeader.sampled})${structureLeaderFields}`
            : ` — mostly in ${structureLeader.type} (${structureLeader.problematic} of ${structureLeader.sampled})${structureLeaderFields}`
        : '';
    const structureRetrospectiveClause = structureRetrospective
        ? ` ${scenarioHorizonDays} days ago, this same model projected about ${structureRetrospective.projected} problematic notes for today; the vault actually has ${structureRetrospective.actual} — ${Math.round(structureRetrospective.accuracy * 100)}% accurate.`
        : '';
    const structureSummary = problematic === 0
        ? `No notes are currently drifting from their type's usual shape.`
        : projectedProblematicHold < problematic
            ? `${problematic} of ${sampled} sampled notes don't match their type's usual shape${structureLeaderClause}. Based on the real trend, that could ease to about ${projectedProblematicHold} in ${scenarioHorizonDays} days.${structureRetrospectiveClause}`
            : `${problematic} of ${sampled} sampled notes don't match their type's usual shape${structureLeaderClause}. Based on the real trend, that number isn't likely to drop much in ${scenarioHorizonDays} days without more structural edits than recently.${structureRetrospectiveClause}`;

    // Growth's own scenario used to live here as a separate `growthHold`
    // object — now redundant and removed: `growth.summary` already carries
    // the real trend-fit projection (and, when available, the retrospective
    // accuracy check), so a second copy of the same conclusion in a
    // different shape was dead weight nothing in the UI ever read.
    const scenarios = {
        horizonDays: scenarioHorizonDays,
        cleanupHold: {
            confidence: classifyScenarioConfidence(cleanupScenarioBaseEvidence, 0),
            summary: projectedStaleHold < staleCount || projectedProblematicHold < problematic
                ? `At the current pace over ${scenarioHorizonDays} days, stale share could ease to about ${Math.round(projectedStaleShareHold * 100)}% and problematic notes to about ${projectedProblematicHold}.`
                : `At the current pace over ${scenarioHorizonDays} days, the vault likely stabilizes rather than clearing much additional stale or fragile structure.`,
            projectedStaleCount: projectedStaleHold,
            projectedStaleShare: projectedStaleShareHold,
            projectedProblematic: projectedProblematicHold
        }
    };

    return {
        windowDays,
        history: {
            bucketDays: 7,
            buckets: weeklyBuckets.map((bucket) => ({
                label: bucket.label,
                start: new Date(bucket.start).toISOString(),
                end: new Date(bucket.end).toISOString(),
                created: bucket.created,
                touches: bucket.touches,
                structure: bucket.structure,
                completions: bucket.completions
            }))
        },
        growth: {
            confidence: growthConfidence,
            evidenceScore: Number(growthSampleScore.toFixed(2)),
            summary: growthSummary,
            trend: growthTrend,
            r2: trajectory.overall ? trajectory.overall.r2 : null,
            slope: trajectory.overall ? trajectory.overall.slope : null,
            insufficientHistory: trajectory.insufficientHistory,
            notesWithoutHistory: trajectory.notesWithoutHistory ?? 0,
            retrospectiveAccuracy: retrospective.available ? retrospective.overall : null,
            topTypes: topGrowth
        },
        stale: {
            confidence: projectionConfidence(staleSampleScore),
            evidenceScore: Number(staleSampleScore.toFixed(2)),
            summary: staleSummary,
            staleRate,
            staleCount,
            total: lifecycleTotal,
            touchEventsRecent,
            pressure: stalePressure,
            trend: staleTrend,
            trendDelta: Number(staleTrendDelta.toFixed(2)),
            r2: staleTrendFit ? staleTrendFit.r2 : null,
            slope: staleTrendFit ? staleTrendFit.slope : null,
            retrospectiveAccuracy: staleRetrospective,
            weeklyTotals: (laneTrajectories.stale?.checkpoints || []).map((c) => c.staleCount),
            checkpointDates: (laneTrajectories.stale?.checkpoints || []).map((c) => c.timestamp),
            projected90: projectedStaleHold,
            upcoming: lastMutationByNoteAll
                ? buildStalenessForecast(fieldsCache, lastMutationByNoteAll, { now, staleDays: STALE_DAYS_THRESHOLD, limit: 8 })
                : [],
            topTypes: staleTypeLeaders
        },
        structure: {
            confidence: projectionConfidence(structureSampleScore),
            evidenceScore: Number(structureSampleScore.toFixed(2)),
            summary: structureSummary,
            direction: structureDirection,
            trend: structureTrend,
            trendDelta: Number(structureTrendDelta.toFixed(2)),
            r2: structureTrendFit ? structureTrendFit.r2 : null,
            slope: structureTrendFit ? structureTrendFit.slope : null,
            retrospectiveAccuracy: structureRetrospective,
            weeklyTotals: (laneTrajectories.structure?.checkpoints || []).map((c) => c.problematic),
            checkpointDates: (laneTrajectories.structure?.checkpoints || []).map((c) => c.timestamp),
            projected90: projectedProblematicHold,
            problematic,
            sampled,
            structureEventsRecent,
            acceptedCompletionsRecent,
            topTypes: structureTypeLeaders
        },
        mutationBehavior: mutationBehavior || null,
        scenarios
    };
}

function getInboundCount(targetId, fieldsCache) {
    let count = 0;
    for (const [, fields] of fieldsCache) {
        for (const rawValue of Object.values(fields || {})) {
            const text = String(rawValue || '');
            for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
                const target = String(match[1] || '').trim().split('|')[0].trim().split('#')[0].trim().split('^')[0].trim();
                if (target === targetId) count += 1;
            }
        }
    }
    return count;
}

/** @param {HealthStats} stats @returns {number} */
function computeHealthScore(stats) {
    if (stats.nodes === 0) return 100;
    const brokenPenalty = Math.min(50, stats.broken * 10);
    const orphanPenalty = Math.min(30, Math.round(stats.orphans.length / stats.nodes * 30));
    return Math.max(0, 100 - brokenPenalty - orphanPenalty);
}

module.exports = {
    collectHealthStats,
    computeHealthScore,
    buildVaultTrendsSnapshot,
    buildSchemaIntelligence,
    buildIntelligenceHealth,
    buildMutationBehavior
};
