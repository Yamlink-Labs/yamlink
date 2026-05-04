'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getGraphStats, isOrphan } = require('../../core/graph');
const { getRegistry, getRegistryStats } = require('../../registries/typeRegistry');
const { getSchemaStats } = require('../../registries/schemaRegistry');
const { getBrokenCount } = require('../../diagnostics/diagnostics');

const SYSTEM_TYPES = new Set(['schema', 'dashboard', 'template']);

function collectHealthStats() {
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const graphStats = getGraphStats();
    const registryStats = getRegistryStats();
    const schemaStats = getSchemaStats();
    const brokenCount = getBrokenCount();
    const registry = getRegistry();

    const orphans = [];
    for (const id of idIndex.keys()) {
        if (!isOrphan(id)) continue;
        const fields = fieldsCache.get(id);
        const nodeType = (fields?.type || '').trim().toLowerCase();
        if (SYSTEM_TYPES.has(nodeType)) continue;
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
        ? (graphStats.totalEdges / idIndex.size).toFixed(2)
        : '0.00';

    return {
        nodes: idIndex.size,
        edges: graphStats.totalEdges,
        broken: brokenCount,
        orphans: orphans.sort(),
        types,
        schemas: schemaStats.schemas,
        uniqueTypes: registryStats.uniqueTypes,
        density
    };
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
