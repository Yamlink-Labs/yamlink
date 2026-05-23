'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getGraphStats, getEdges, isOrphan } = require('../../core/graph');
const { getRegistry, getRegistryStats } = require('../../registries/typeRegistry');
const { getSchemaStats } = require('../../registries/schemaRegistry');
const { getBrokenCount } = require('../../diagnostics/diagnostics');
const { getVaultGeneration } = require('../../core/indexService');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { inferNoteRole } = require('../../intelligence/noteRolesCore');
const { inferLifecycleState, summarizeLifecycleState } = require('../../intelligence/lifecycleState');
const { computeVaultDrift, getDriftSummary } = require('../../intelligence/driftDetector');

const SYSTEM_TYPES = new Set(['schema', 'dashboard', 'template']);

function collectHealthStats() {
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
            const lifecycle = inferLifecycleState(id, fields, {
                idIndex,
                fieldsCache,
                fieldTargetTypes,
                typeFieldBundles,
                noteRoleTypePriors,
                noteRole,
                noteType: nodeType,
                inboundCount: getInboundCount(id, fieldsCache),
                avgInbound
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
        schemas: schemaStats.schemas,
        uniqueTypes: registryStats.uniqueTypes,
        density
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

function computeHealthScore(stats) {
    if (stats.nodes === 0) return 100;
    const brokenPenalty = Math.min(50, stats.broken * 10);
    const orphanPenalty = Math.min(30, Math.round(stats.orphans.length / stats.nodes * 30));
    return Math.max(0, 100 - brokenPenalty - orphanPenalty);
}

module.exports = {
    collectHealthStats,
    computeHealthScore
};
