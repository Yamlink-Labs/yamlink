'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getEdges, getBacklinks } = require('../../core/graph');

function buildGraphModel(nodeIds, centerNodeId = null) {
    const ids = Array.from(new Set((Array.isArray(nodeIds) ? nodeIds : []).filter(Boolean)));
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const typeColors = new Map();
    const relationColors = new Map();
    const palette = ['#58a6ff', '#3fb950', '#ffa657', '#f778ba', '#a371f7', '#39d3f2', '#c4e449', '#db61a2'];
    const relationPalette = ['#79c0ff', '#56d364', '#ffc680', '#ffa198', '#c9aeff', '#76e3ea'];
    const shapes = ['ellipse', 'round-rectangle', 'diamond', 'hexagon', 'tag', 'vee'];
    const typeShapes = new Map();

    for (const id of ids) {
        const type = getNodeType(id, fieldsCache);
        if (!typeColors.has(type)) {
            typeColors.set(type, palette[typeColors.size % palette.length]);
            typeShapes.set(type, shapes[typeShapes.size % shapes.length]);
        }
    }

    // Group by source→target and collapse body mentions behind named relations.
    const pairMap = new Map();
    for (const id of ids) {
        for (const edge of getEdges(id) || []) {
            if (!edge || !ids.includes(edge.targetId)) continue;
            const key = `${id}\x00${edge.targetId}`;
            if (!pairMap.has(key)) pairMap.set(key, { src: id, tgt: edge.targetId, named: new Set(), hasBody: false });
            if (edge.field === 'body') pairMap.get(key).hasBody = true;
            else pairMap.get(key).named.add(edge.field);
        }
    }

    const edges = [];
    for (const pair of pairMap.values()) {
        const fields = pair.named.size > 0 ? [...pair.named] : (pair.hasBody ? ['mention'] : []);
        for (const label of fields) {
            const edgeId = `${pair.src}->${pair.tgt}->${label}`;
            if (!relationColors.has(label)) {
                relationColors.set(label, relationPalette[relationColors.size % relationPalette.length]);
            }
            edges.push({
                id: edgeId,
                source: pair.src,
                target: pair.tgt,
                label,
                color: relationColors.get(label)
            });
        }
    }

    const degreeMap = new Map();
    const incomingByNode = new Map();
    const outgoingByNode = new Map();
    for (const edge of edges) {
        degreeMap.set(edge.source, (degreeMap.get(edge.source) || 0) + 1);
        degreeMap.set(edge.target, (degreeMap.get(edge.target) || 0) + 1);
        if (!incomingByNode.has(edge.target)) incomingByNode.set(edge.target, []);
        if (!outgoingByNode.has(edge.source)) outgoingByNode.set(edge.source, []);
        incomingByNode.get(edge.target).push(edge);
        outgoingByNode.get(edge.source).push(edge);
    }

    const nodes = ids.map((id) => {
        const fields = fieldsCache.get(id) || {};
        const type = getNodeType(id, fieldsCache);
        return {
            id,
            label: getNodeLabel(id, fields),
            type,
            color: typeColors.get(type),
            shape: typeShapes.get(type) || 'ellipse',
            degree: degreeMap.get(id) || 0,
            isContext: id === centerNodeId,
            filePath: idIndex.get(id) || ''
        };
    });

    const topNodes = nodes
        .map((node) => ({ id: node.id, label: node.label, type: node.type, degree: node.degree }))
        .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
        .slice(0, 8);

    const types = Array.from(typeColors.entries())
        .map(([type, color]) => ({
            type,
            color,
            shape: typeShapes.get(type) || 'ellipse',
            count: nodes.filter((node) => node.type === type).length
        }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

    const relations = Array.from(relationColors.entries())
        .map(([field, color]) => ({
            field,
            color,
            count: edges.filter((edge) => edge.label === field).length
        }))
        .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));

    const nodeDetails = {};
    for (const node of nodes) {
        const outgoing = (outgoingByNode.get(node.id) || []).map((edge) => ({
            targetId: edge.target,
            label: edge.label
        }));
        const incoming = (incomingByNode.get(node.id) || []).map((edge) => ({
            sourceId: edge.source,
            label: edge.label
        }));

        const connectedTypes = new Map();
        for (const edge of outgoingByNode.get(node.id) || []) {
            const type = getNodeType(edge.target, fieldsCache);
            connectedTypes.set(type, (connectedTypes.get(type) || 0) + 1);
        }
        for (const edge of incomingByNode.get(node.id) || []) {
            const type = getNodeType(edge.source, fieldsCache);
            connectedTypes.set(type, (connectedTypes.get(type) || 0) + 1);
        }

        const relationSummary = new Map();
        for (const edge of [...(outgoingByNode.get(node.id) || []), ...(incomingByNode.get(node.id) || [])]) {
            relationSummary.set(edge.label, (relationSummary.get(edge.label) || 0) + 1);
        }

        nodeDetails[node.id] = {
            outgoing,
            incoming,
            connectedTypes: Array.from(connectedTypes.entries())
                .map(([type, count]) => ({ type, count }))
                .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
            relationSummary: Array.from(relationSummary.entries())
                .map(([field, count]) => ({ field, count }))
                .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field))
        };
    }

    const largestClusterSize = computeLargestCluster(ids);

    return {
        elements: [
            ...nodes.map((node) => ({ data: node })),
            ...edges.map((edge) => ({ data: edge }))
        ],
        summary: {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            typeCount: types.length,
            contextId: centerNodeId || null,
            primaryFocusId: centerNodeId || (topNodes[0]?.id || null),
            largestClusterSize
        },
        types,
        relations,
        topNodes,
        nodeDetails
    };
}

function collectNeighborhood(seedIds, depth, limit) {
    const result = new Set();
    const queue = [];

    for (const id of seedIds) {
        if (!id) continue;
        result.add(id);
        queue.push({ id, level: 0 });
    }

    while (queue.length > 0 && result.size < limit) {
        const current = queue.shift();
        if (current.level >= depth) continue;

        const neighbors = [
            ...(getEdges(current.id) || []).map((edge) => edge.targetId),
            ...(getBacklinks(current.id) || []).map((edge) => edge.sourceId)
        ];

        for (const neighborId of neighbors) {
            if (!neighborId || result.has(neighborId)) continue;
            result.add(neighborId);
            queue.push({ id: neighborId, level: current.level + 1 });
            if (result.size >= limit) break;
        }
    }

    return result;
}

function getTopVaultNodes(limit) {
    const ids = Array.from(getIndex().keys());
    return ids
        .map((id) => ({
            id,
            degree: (getEdges(id) || []).length + (getBacklinks(id) || []).length,
            label: getNodeLabel(id, getFieldsCache().get(id) || {})
        }))
        .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
        .slice(0, Math.max(20, limit))
        .map((entry) => entry.id);
}

function getNodeSnapshot(id) {
    if (!id) return null;
    const fields = getFieldsCache().get(id) || {};
    return {
        id,
        label: getNodeLabel(id, fields),
        type: getNodeType(id, getFieldsCache()),
        filePath: getIndex().get(id) || '',
        outgoing: (getEdges(id) || []).map((edge) => ({
            label: edge.field === 'body' ? 'mention' : edge.field,
            targetId: edge.targetId
        })),
        incoming: (getBacklinks(id) || []).map((edge) => ({
            label: edge.field === 'body' ? 'mention' : edge.field,
            sourceId: edge.sourceId
        }))
    };
}

function getNodeLabel(id, fields) {
    return String(fields.name || fields.title || id);
}

function getNodeType(id, fieldsCache) {
    const fields = fieldsCache.get(id) || {};
    return String(fields.type || 'unknown');
}

function computeLargestCluster(ids) {
    const allowed = new Set(ids);
    const visited = new Set();
    let largest = 0;

    for (const id of ids) {
        if (visited.has(id)) continue;
        let count = 0;
        const stack = [id];
        visited.add(id);
        while (stack.length > 0) {
            const current = stack.pop();
            count++;
            const nextIds = [
                ...(getEdges(current) || []).map((edge) => edge.targetId),
                ...(getBacklinks(current) || []).map((edge) => edge.sourceId)
            ];
            for (const nextId of nextIds) {
                if (!allowed.has(nextId) || visited.has(nextId)) continue;
                visited.add(nextId);
                stack.push(nextId);
            }
        }
        largest = Math.max(largest, count);
    }

    return largest;
}

module.exports = {
    buildGraphModel,
    collectNeighborhood,
    getTopVaultNodes,
    getNodeSnapshot,
    getNodeLabel,
    getNodeType,
    computeLargestCluster
};
