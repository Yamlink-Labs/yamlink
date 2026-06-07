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
 *   drift: any, todayActivity: Array<{noteId:string,count:number}>,
 *   schemas: any, uniqueTypes: number, density: string,
 *   templateDrift: Map<string,any>, schemaIntelligence: SchemaIntelligence
 * }} HealthStats
 */

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getGraphStats, getEdges, isOrphan } = require('../../core/graph');
const { getRegistry, getRegistryStats } = require('../../registries/typeRegistry');
const { getSchemaStats, getSchema, getSchemaTargets } = require('../../registries/schemaRegistry');
const { getBrokenCount } = require('../../diagnostics/diagnostics');
const { getVaultGeneration } = require('../../core/indexService');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { inferNoteRole } = require('../../intelligence/noteRolesCore');
const { inferLifecycleState, summarizeLifecycleState } = require('../../intelligence/lifecycleState');
const { computeVaultDrift, getDriftSummary } = require('../../intelligence/driftDetector');
const { getMutationEvents } = require('../../runtime/mutationEventLog');
const { getTemplateDrift, summarizeTemplateDrift } = require('../../core/templateRegistry');

const SYSTEM_TYPES = new Set(['schema', 'dashboard', 'template']);

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
    const lastMutationByNote = new Map();
    for (const event of getMutationEvents()) {
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
            const noteRole = inferNoteRole(fields, {});
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

    const templateDriftByType = workspaceRoot
        ? summarizeTemplateDrift(getTemplateDrift(workspaceRoot, fieldsCache))
        : new Map();

    const schemaIntelligence = buildSchemaIntelligence(idIndex, fieldsCache, registry);

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
        schemas: schemaStats.schemas,
        uniqueTypes: registryStats.uniqueTypes,
        density,
        templateDrift: templateDriftByType,
        schemaIntelligence
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
    buildSchemaIntelligence
};
