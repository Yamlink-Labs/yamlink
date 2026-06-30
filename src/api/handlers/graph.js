'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getEdges } = require('../../core/graph');
const { json, methodNotAllowed } = require('../http');

async function handleGraph(req, res) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
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
