'use strict';

const { getIndex, getFieldsCache, getAliasIndex, getBodyLinksCache, extractAndResolveRelationTargets } = require('../../core/indexService');
const { getEdges } = require('../../core/graph');
const { reconstructVaultAtTime, buildHistoricalGraph } = require('../../core/timeEngine');
const { getMutationEvents } = require('../../runtime/mutationEventLog');
const { json, badRequest, methodNotAllowed } = require('../http');

async function handleGraph(req, res, url) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }

    const at = String(url?.searchParams?.get('at') || '').trim();
    if (at) {
        if (!Number.isFinite(Date.parse(at))) {
            badRequest(res, 'Invalid "at" timestamp — expected ISO-8601', 'INVALID_PARAM');
            return;
        }
        const idIndex = getIndex();
        const aliasIndex = getAliasIndex();
        const reconstructed = reconstructVaultAtTime(at, {
            fieldsCache: getFieldsCache(),
            mutationEvents: getMutationEvents(),
            bodyLinksCache: getBodyLinksCache()
        });
        const { nodes, edges } = buildHistoricalGraph(
            reconstructed,
            (value) => extractAndResolveRelationTargets(value, idIndex, aliasIndex)
        );
        const types = new Set(nodes.map((node) => node.type).filter(Boolean));
        const incomplete = nodes.filter((node) => !node.complete).length;
        json(res, {
            at,
            nodes,
            edges,
            stats: {
                nodes: nodes.length,
                edges: edges.length,
                types: types.size,
                incomplete
            }
        });
        return;
    }

    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const nodes = [];
    const edges = [];
    for (const [id] of idIndex) {
        const fields = fieldsCache.get(id) || {};
        nodes.push({ id, type: fields.type || null });
        for (const edge of getEdges(id) || []) edges.push({ from: id, to: edge.targetId, field: edge.field });
    }
    const types = new Set(nodes.map((node) => node.type).filter(Boolean));
    json(res, {
        nodes,
        edges,
        stats: {
            nodes: nodes.length,
            edges: edges.length,
            types: types.size
        }
    });
}

module.exports = { handleGraph };
