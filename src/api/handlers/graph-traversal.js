'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getEdges, getBacklinks } = require('../../core/graph');
const { json, methodNotAllowed, notFound, coercePositiveInt } = require('../http');

function ensureKnownNode(id, res) {
    const idIndex = getIndex();
    if (!idIndex.has(id)) {
        notFound(res, 'Note not found: ' + id);
        return false;
    }
    return true;
}

function getNodeMeta(id) {
    const fields = getFieldsCache().get(id) || {};
    return {
        type: fields.type || null,
        name: fields.name || fields.title || id
    };
}

async function handleOutbound(req, res, id) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    if (!ensureKnownNode(id, res)) return;
    const edges = (getEdges(id) || []).map((edge) => {
        const meta = getNodeMeta(edge.targetId);
        return { field: edge.field, to: edge.targetId, toType: meta.type, toName: meta.name };
    });
    json(res, { id, edges });
}

async function handleInbound(req, res, id) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    if (!ensureKnownNode(id, res)) return;
    const edges = (getBacklinks(id) || []).map((edge) => {
        const meta = getNodeMeta(edge.sourceId);
        return { field: edge.field, from: edge.sourceId, fromType: meta.type, fromName: meta.name };
    });
    json(res, { id, edges });
}

async function handleNeighborhood(req, res, id, url) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    if (!ensureKnownNode(id, res)) return;

    const fieldsCache = getFieldsCache();
    const depth = Math.min(3, Math.max(1, coercePositiveInt(url.searchParams.get('depth'), 1, 1)));
    const MAX_NODES = 200;
    const seenNodes = new Set([id]);
    const seenEdges = new Set();
    const nodes = [];
    const edges = [];
    const queue = [{ id, depth: 0 }];
    let truncated = false;

    while (queue.length) {
        const current = queue.shift();
        const currentFields = fieldsCache.get(current.id) || {};
        nodes.push({ id: current.id, type: currentFields.type || null });

        if (current.depth >= depth) continue;

        const outbound = getEdges(current.id) || [];
        for (const edge of outbound) {
            const edgeKey = `${current.id}|${edge.targetId}|${edge.field}`;
            if (!seenEdges.has(edgeKey)) {
                seenEdges.add(edgeKey);
                edges.push({ from: current.id, to: edge.targetId, field: edge.field });
            }
            if (!seenNodes.has(edge.targetId)) {
                if (seenNodes.size >= MAX_NODES) {
                    truncated = true;
                    continue;
                }
                seenNodes.add(edge.targetId);
                queue.push({ id: edge.targetId, depth: current.depth + 1 });
            }
        }

        const inbound = getBacklinks(current.id) || [];
        for (const edge of inbound) {
            const edgeKey = `${edge.sourceId}|${current.id}|${edge.field}`;
            if (!seenEdges.has(edgeKey)) {
                seenEdges.add(edgeKey);
                edges.push({ from: edge.sourceId, to: current.id, field: edge.field });
            }
            if (!seenNodes.has(edge.sourceId)) {
                if (seenNodes.size >= MAX_NODES) {
                    truncated = true;
                    continue;
                }
                seenNodes.add(edge.sourceId);
                queue.push({ id: edge.sourceId, depth: current.depth + 1 });
            }
        }
    }

    json(res, {
        id,
        depth,
        nodes,
        edges,
        ...(truncated ? { truncated: true } : {})
    });
}

module.exports = {
    handleOutbound,
    handleInbound,
    handleNeighborhood
};
