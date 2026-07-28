'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const {
    getEdges,
    getBacklinks,
    computeGraphEdgeWeight,
    classifyGraphEdgeStrength,
    computeHubScore,
    computeNodeWeightedDegree,
    computeNodeExplorerScore
} = require('../../core/graph');

/**
 * @param {string[]} nodeIds
 * @param {string|null} [centerNodeId]
 * @returns {object}
 */
function buildGraphModel(nodeIds, centerNodeId = null) {
    const ids = Array.from(new Set((Array.isArray(nodeIds) ? nodeIds : []).filter(Boolean)));
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const typeColors = new Map();
    const relationColors = new Map();
    const palette = ['#58a6ff', '#3fb950', '#ffa657', '#f778ba', '#a371f7', '#39d3f2', '#c4e449', '#db61a2'];
    const relationPalette = ['#79c0ff', '#56d364', '#ffc680', '#ffa198', '#c9aeff', '#76e3ea'];
    for (const id of ids) {
        const type = getNodeType(id, fieldsCache);
        if (!typeColors.has(type)) {
            typeColors.set(type, palette[typeColors.size % palette.length]);
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
            const reciprocalKey = `${pair.tgt}\x00${pair.src}`;
            const reciprocal = pairMap.get(reciprocalKey);
            const weight = computeGraphEdgeWeight(label, {
                reciprocal: !!reciprocal,
                targetType: getNodeType(pair.tgt, fieldsCache),
                sourceType: getNodeType(pair.src, fieldsCache)
            });
            edges.push({
                id: edgeId,
                source: pair.src,
                target: pair.tgt,
                label,
                color: relationColors.get(label),
                weight,
                strength: classifyGraphEdgeStrength(label, weight)
            });
        }
    }

    const degreeMap = new Map();
    const weightedDegreeMap = new Map();
    const incomingByNode = new Map();
    const outgoingByNode = new Map();
    for (const edge of edges) {
        degreeMap.set(edge.source, (degreeMap.get(edge.source) || 0) + 1);
        degreeMap.set(edge.target, (degreeMap.get(edge.target) || 0) + 1);
        weightedDegreeMap.set(edge.source, round2((weightedDegreeMap.get(edge.source) || 0) + edge.weight));
        weightedDegreeMap.set(edge.target, round2((weightedDegreeMap.get(edge.target) || 0) + edge.weight));
        if (!incomingByNode.has(edge.target)) incomingByNode.set(edge.target, []);
        if (!outgoingByNode.has(edge.source)) outgoingByNode.set(edge.source, []);
        incomingByNode.get(edge.target).push(edge);
        outgoingByNode.get(edge.source).push(edge);
    }

    const typeCounts = new Map();
    const tagCounts = new Map();
    for (const id of ids) {
        const type = getNodeType(id, fieldsCache);
        typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
        for (const tag of getNodeTags(fieldsCache.get(id) || {})) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
    }

    const nodes = ids.map((id) => {
        const fields = fieldsCache.get(id) || {};
        const type = getNodeType(id, fieldsCache);
        const tags = getNodeTags(fields);
        const relationKinds = new Set([
            ...(outgoingByNode.get(id) || []).map((edge) => edge.label),
            ...(incomingByNode.get(id) || []).map((edge) => edge.label)
        ]);
        const connectedTypes = new Set([
            ...(outgoingByNode.get(id) || []).map((edge) => getNodeType(edge.target, fieldsCache)),
            ...(incomingByNode.get(id) || []).map((edge) => getNodeType(edge.source, fieldsCache))
        ].filter(Boolean));
        const strongEdges = [
            ...(outgoingByNode.get(id) || []),
            ...(incomingByNode.get(id) || [])
        ].filter((edge) => edge.strength !== 'weak').length;
        const weightedDegree = weightedDegreeMap.get(id) || 0;
        const hubScore = computeHubScore({
            weightedDegree,
            relationKinds: relationKinds.size,
            connectedTypes: connectedTypes.size,
            strongEdges,
            tagCount: tags.length
        });
        return {
            id,
            label: getNodeLabel(id, fields),
            type,
            color: typeColors.get(type),
            shape: 'ellipse',
            degree: degreeMap.get(id) || 0,
            weightedDegree,
            hubScore,
            tagCount: tags.length,
            tags,
            isContext: id === centerNodeId,
            filePath: idIndex.get(id) || ''
        };
    });

    const topNodes = nodes
        .map((node) => ({
            id: node.id,
            label: node.label,
            type: node.type,
            degree: node.degree,
            weightedDegree: node.weightedDegree,
            hubScore: node.hubScore,
            tagCount: node.tagCount
        }))
        .sort((a, b) => b.hubScore - a.hubScore || b.weightedDegree - a.weightedDegree || a.label.localeCompare(b.label))
        .slice(0, 8);

    const types = Array.from(typeColors.entries())
        .map(([type, color]) => ({
            type,
            color,
            shape: 'ellipse',
            count: typeCounts.get(type) || 0
        }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

    const relations = Array.from(relationColors.entries())
        .map(([field, color]) => ({
            field,
            color,
            count: edges.filter((edge) => edge.label === field).length,
            totalWeight: round2(edges.filter((edge) => edge.label === field).reduce((sum, edge) => sum + edge.weight, 0))
        }))
        .sort((a, b) => b.totalWeight - a.totalWeight || b.count - a.count || a.field.localeCompare(b.field));

    const topTags = Array.from(tagCounts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
        .slice(0, 8);

    const nodeDetails = {};
    for (const node of nodes) {
        const outgoing = (outgoingByNode.get(node.id) || []).map((edge) => ({
            targetId: edge.target,
            label: edge.label,
            weight: edge.weight,
            strength: edge.strength
        }));
        const incoming = (incomingByNode.get(node.id) || []).map((edge) => ({
            sourceId: edge.source,
            label: edge.label,
            weight: edge.weight,
            strength: edge.strength
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
            const current = relationSummary.get(edge.label) || { count: 0, weight: 0 };
            current.count += 1;
            current.weight += edge.weight;
            relationSummary.set(edge.label, current);
        }

        const visibleNeighborIds = new Set([
            ...outgoing.map((edge) => edge.targetId),
            ...incoming.map((edge) => edge.sourceId)
        ]);
        const allNeighborIds = new Set([
            ...(getEdges(node.id) || []).map((edge) => edge.targetId),
            ...(getBacklinks(node.id) || []).map((edge) => edge.sourceId)
        ]);
        const hiddenNeighborCount = [...allNeighborIds].filter((neighborId) => !visibleNeighborIds.has(neighborId)).length;

        nodeDetails[node.id] = {
            outgoing,
            incoming,
            tags: node.tags,
            weightedDegree: node.weightedDegree,
            hubScore: node.hubScore,
            hiddenNeighborCount,
            connectedTypes: Array.from(connectedTypes.entries())
                .map(([type, count]) => ({ type, count }))
                .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
            relationSummary: Array.from(relationSummary.entries())
                .map(([field, stats]) => ({ field, count: stats.count, weight: round2(stats.weight) }))
                .sort((a, b) => b.weight - a.weight || b.count - a.count || a.field.localeCompare(b.field)),
            strongestLinks: [...outgoing, ...incoming]
                .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
                .slice(0, 4)
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
            topTagCount: topTags.length,
            contextId: centerNodeId || null,
            primaryFocusId: centerNodeId || (topNodes[0]?.id || null),
            largestClusterSize,
            strongestRelation: relations[0]?.field || null,
            dominantType: types[0]?.type || null
        },
        types,
        relations,
        topTags,
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
    const fieldsCache = getFieldsCache();
    return ids
        .map((id) => ({
            id,
            weightedDegree: computeNodeWeightedDegree(id),
            hubScore: computeNodeExplorerScore(id, fieldsCache),
            label: getNodeLabel(id, fieldsCache.get(id) || {})
        }))
        .sort((a, b) => b.hubScore - a.hubScore || b.weightedDegree - a.weightedDegree || a.label.localeCompare(b.label))
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

function getNodeTags(fields = {}) {
    const raw = String(fields.__yamlink_tags || '').trim();
    if (!raw) return [];
    return [...new Set(raw.split(',').map((tag) => String(tag || '').trim()).filter(Boolean))];
}

function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
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
    computeLargestCluster,
    getNodeTags
};
