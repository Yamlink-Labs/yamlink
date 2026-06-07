'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { parseViewQuery, runQuery } = require('../../engine/query');
const {
    buildGraphModel,
    collectNeighborhood,
    getNodeTags,
    getNodeType
} = require('../graph/graphModel');
const { GRAPH2_SCOPES, GRAPH2_SOURCES } = require('./graph2State');
const { buildXGraphData } = require('../graph/graphPayload');

function buildGraph2Payload(state, getActiveNodeId = () => null) {
    const activeNodeId = getActiveNodeId();
    const seedNodeIds = resolveSeedNodeIds(state, activeNodeId);
    const candidateNodeIds = resolveScopeNodeIds(state, seedNodeIds);
    const centerNodeId = resolveCenterNodeId(state, activeNodeId, seedNodeIds);
    const rawModel = buildGraphModel(candidateNodeIds, centerNodeId);
    const facets = buildGraph2Facets(candidateNodeIds, rawModel);
    const model = filterGraphModel(rawModel, state.filters, state.scope, centerNodeId, state.workspaceFocusCap, state.expandedNodeIds);
    const preferredSelectedNodeId = shouldFollowActiveNode(state)
        ? (activeNodeId || centerNodeId || null)
        : state.selectedNodeId;
    const selectedNodeId = pickSelectedNodeId(preferredSelectedNodeId, model, state.scope);

    return {
        version: 2,
        source: state.source,
        scope: state.scope,
        depth: state.depth,
        nodeCap: state.nodeCap,
        workspaceFocusCap: state.workspaceFocusCap,
        centerNodeId,
        selectedNodeId,
        seedNodeIds,
        filters: state.filters,
        queryText: state.queryText || '',
        facets,
        model,
        graphData: buildXGraphData(rawModel),
        hiddenWorkspaceNeighborCount: model.summary.hiddenWorkspaceNeighborCount || 0,
        empty: model.summary.nodeCount === 0
    };
}

function resolveSeedNodeIds(state, activeNodeId) {
    if (state.source === GRAPH2_SOURCES.QUERY) {
        const queryNodeIds = resolveQueryNodeIds(state.queryText, state.nodeCap);
        return uniqueIds(queryNodeIds.length > 0 ? queryNodeIds : state.queryNodeIds.length > 0 ? state.queryNodeIds : [state.centerNodeId, activeNodeId]);
    }
    if (state.source === GRAPH2_SOURCES.CUSTOM) {
        return uniqueIds(state.customNodeIds.length > 0 ? state.customNodeIds : [state.centerNodeId, activeNodeId]);
    }
    return uniqueIds([state.centerNodeId, activeNodeId]);
}

function resolveCenterNodeId(state, activeNodeId, seedNodeIds) {
    if (state.scope === GRAPH2_SCOPES.VAULT || state.scope === GRAPH2_SCOPES.DOMAIN) {
        return null;
    }
    // Pinned center takes priority: "Center graph here" clicked a specific node,
    // don't let the active-editor override it until the user switches tabs.
    if (state.pinnedCenter && state.centerNodeId) {
        return state.centerNodeId;
    }
    if (shouldFollowActiveNode(state) && activeNodeId) {
        return activeNodeId;
    }
    if (state.source === GRAPH2_SOURCES.QUERY && seedNodeIds.length > 0) {
        return seedNodeIds[0];
    }
    return state.centerNodeId || activeNodeId || seedNodeIds[0] || null;
}

function shouldFollowActiveNode(state) {
    return state.source === GRAPH2_SOURCES.CURRENT
        && state.scope !== GRAPH2_SCOPES.VAULT
        && state.scope !== GRAPH2_SCOPES.DOMAIN;
}

function resolveScopeNodeIds(state, seedNodeIds) {
    const limit = state.nodeCap;
    if (state.scope === GRAPH2_SCOPES.VAULT) {
        return uniqueIds(Array.from(getIndex().keys())).slice(0, limit);
    }

    if (state.scope === GRAPH2_SCOPES.DOMAIN) {
        return collectDomainNodeIds(seedNodeIds, limit);
    }

    if (state.scope === GRAPH2_SCOPES.CUSTOM) {
        const customIds = uniqueIds(state.customNodeIds);
        if (customIds.length > 0) return customIds.slice(0, limit);
    }

    if (state.scope === GRAPH2_SCOPES.LOCAL) {
        return Array.from(collectNeighborhood(new Set(seedNodeIds), 1, limit));
    }

    return Array.from(collectNeighborhood(new Set(seedNodeIds), state.depth, limit));
}

function collectDomainNodeIds(seedNodeIds, limit) {
    const fieldsCache = getFieldsCache();
    const allIds = Array.from(getIndex().keys());
    const seedTypes = new Set();
    const seedTags = new Set();

    for (const id of seedNodeIds) {
        if (!id) continue;
        seedTypes.add(getNodeType(id, fieldsCache));
        for (const tag of getNodeTags(fieldsCache.get(id) || {})) seedTags.add(tag.toLowerCase());
    }

    const matches = [];
    for (const id of allIds) {
        const fields = fieldsCache.get(id) || {};
        const type = getNodeType(id, fieldsCache);
        const tags = getNodeTags(fields).map((tag) => tag.toLowerCase());
        const sharesType = seedTypes.size > 0 && seedTypes.has(type);
        const sharesTag = tags.some((tag) => seedTags.has(tag));
        if (!sharesType && !sharesTag && !seedNodeIds.includes(id)) continue;
        matches.push(id);
        if (matches.length >= limit) break;
    }

    return uniqueIds([...seedNodeIds, ...matches]).slice(0, limit);
}

function resolveQueryNodeIds(queryText, limit) {
    const text = String(queryText || '').trim();
    if (!text) return [];
    try {
        const query = parseViewQuery(text);
        if (!query) return [];
        const result = runQuery(query);
        if (!result || result.success === false || !Array.isArray(result.rows)) return [];
        return uniqueIds(result.rows.map((row) => row && row.id).filter(Boolean)).slice(0, limit);
    } catch (_) {
        return [];
    }
}

function buildGraph2Facets(candidateNodeIds, rawModel) {
    const fieldsCache = getFieldsCache();
    const typeCounts = new Map();
    const tagCounts = new Map();

    for (const id of candidateNodeIds) {
        const fields = fieldsCache.get(id) || {};
        const type = getNodeType(id, fieldsCache);
        typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
        for (const tag of getNodeTags(fields)) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
    }

    return {
        types: [...typeCounts.entries()]
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
        relations: (rawModel.relations || []).map((entry) => ({
            field: entry.field,
            count: entry.count,
            totalWeight: entry.totalWeight
        })),
        tags: [...tagCounts.entries()]
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    };
}

function filterGraphModel(rawModel, filters, scope = 'neighborhood', centerNodeId = null, workspaceFocusCap = 5, expandedNodeIds = new Set()) {
    const nodeById = new Map();
    const nodes = [];
    const edges = [];

    for (const element of rawModel.elements || []) {
        const data = element && element.data;
        if (!data) continue;
        if (data.source && data.target) {
            edges.push(data);
        } else if (data.id) {
            nodeById.set(data.id, data);
            nodes.push(data);
        }
    }

    const allowedTypes = new Set((filters.types || []).map((value) => String(value).toLowerCase()));
    const allowedRelationTypes = new Set((filters.relationTypes || []).map((value) => String(value).toLowerCase()));
    const allowedTags = new Set((filters.tags || []).map((value) => String(value).toLowerCase()));

    let filteredNodeIds = nodes
        .filter((node) => nodePassesFilters(node, allowedTypes, allowedTags, filters.hideArchived))
        .map((node) => node.id);

    let filteredEdges = edges.filter((edge) => {
        if (!filteredNodeIds.includes(edge.source) || !filteredNodeIds.includes(edge.target)) return false;
        if (filters.hideWeakMentions && edge.label === 'mention') return false;
        if (allowedRelationTypes.size > 0 && !allowedRelationTypes.has(String(edge.label || '').toLowerCase())) return false;
        return true;
    });

    if (allowedRelationTypes.size > 0 || filters.hideWeakMentions || filters.hideOrphans) {
        const connectedNodeIds = new Set();
        for (const edge of filteredEdges) {
            connectedNodeIds.add(edge.source);
            connectedNodeIds.add(edge.target);
        }
        // Center node is always kept visible even if it has no edges of the allowed types.
        if (centerNodeId) connectedNodeIds.add(centerNodeId);

        filteredNodeIds = filteredNodeIds.filter((id) => {
            if (allowedRelationTypes.size > 0 && !connectedNodeIds.has(id)) return false;
            if (filters.hideOrphans && !connectedNodeIds.has(id)) return false;
            return true;
        });
        const keptNodeIds = new Set(filteredNodeIds);
        filteredEdges = filteredEdges.filter((edge) => keptNodeIds.has(edge.source) && keptNodeIds.has(edge.target));
    }

    const filteredNodes = nodes.filter((node) => filteredNodeIds.includes(node.id));
    const densePruned = pruneDenseScope(scope, filteredNodes, filteredEdges, centerNodeId);
    // When explicit filters are active the user is asking to see a specific filtered
    // subgraph. Bypassing the workspace neighbor cap avoids the pruner silently
    // eliminating filter-passing nodes that aren't direct neighbors of the center.
    const hasExplicitFilters = allowedTypes.size > 0 || allowedRelationTypes.size > 0 || allowedTags.size > 0;
    const workspacePruned = hasExplicitFilters
        ? { nodes: densePruned.nodes, edges: densePruned.edges, hiddenNeighborCount: 0 }
        : pruneWorkspaceScope(scope, densePruned.nodes, densePruned.edges, centerNodeId, workspaceFocusCap, expandedNodeIds);
    const denseNodeIds = new Set(workspacePruned.nodes.map((node) => node.id));
    const finalEdges = workspacePruned.edges;
    const finalNodes = workspacePruned.nodes;
    const hiddenNeighborCount = workspacePruned.hiddenNeighborCount;
    const nodeDetails = {};
    for (const node of finalNodes) {
        const rawDetails = rawModel.nodeDetails?.[node.id] || {};
        nodeDetails[node.id] = {
            outgoing: (rawDetails.outgoing || []).filter((edge) => denseNodeIds.has(edge.targetId) && edgePassesRelationFilter(edge, allowedRelationTypes, filters.hideWeakMentions) && finalEdges.some((candidate) => candidate.source === node.id && candidate.target === edge.targetId && candidate.label === edge.label)),
            incoming: (rawDetails.incoming || []).filter((edge) => denseNodeIds.has(edge.sourceId) && edgePassesRelationFilter(edge, allowedRelationTypes, filters.hideWeakMentions) && finalEdges.some((candidate) => candidate.target === node.id && candidate.source === edge.sourceId && candidate.label === edge.label)),
            tags: Array.isArray(rawDetails.tags) ? rawDetails.tags : (node.tags || []),
            weightedDegree: node.weightedDegree || 0,
            hubScore: node.hubScore || 0,
            hiddenNeighborCount: rawDetails.hiddenNeighborCount || 0,
            connectedTypes: rebuildConnectedTypes(node.id, finalEdges, nodeById),
            relationSummary: rebuildRelationSummary(node.id, finalEdges),
            strongestLinks: rebuildStrongestLinks(node.id, finalEdges).slice(0, 4)
        };
    }

    const relations = summarizeRelations(finalEdges);
    const types = summarizeTypes(finalNodes);
    const topTags = summarizeTags(finalNodes);
    const topNodes = finalNodes
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

    return {
        elements: [
            ...finalNodes.map((node) => ({ data: node })),
            ...finalEdges.map((edge) => ({ data: edge }))
        ],
        summary: {
            nodeCount: finalNodes.length,
            edgeCount: finalEdges.length,
            typeCount: types.length,
            topTagCount: topTags.length,
            contextId: rawModel.summary?.contextId || null,
            primaryFocusId: rawModel.summary?.contextId || topNodes[0]?.id || null,
            largestClusterSize: computeLargestFilteredCluster([...denseNodeIds], finalEdges),
            strongestRelation: relations[0]?.field || null,
            dominantType: types[0]?.type || null,
            hiddenWorkspaceNeighborCount: hiddenNeighborCount
        },
        types,
        relations,
        topTags,
        topNodes,
        nodeDetails
    };
}

function pruneDenseScope(scope, nodes, edges, centerNodeId) {
    const broadScope = scope === GRAPH2_SCOPES.VAULT || scope === GRAPH2_SCOPES.DOMAIN || scope === GRAPH2_SCOPES.CUSTOM;
    if (!broadScope || nodes.length <= 6) {
        return { nodes, edges };
    }

    const rankedEdges = [...edges]
        .filter((edge) => edge.strength !== 'weak')
        .sort((a, b) => {
            const aCenter = a.source === centerNodeId || a.target === centerNodeId ? 1 : 0;
            const bCenter = b.source === centerNodeId || b.target === centerNodeId ? 1 : 0;
            return bCenter - aCenter || Number(b.weight || 0) - Number(a.weight || 0) || String(a.label || '').localeCompare(String(b.label || ''));
        });

    // Vault/domain = constellation view: always keep ALL nodes regardless of active note.
    // centerNodeId in vault/domain is only a visual hint, never a pruning axis.
    const isConstellationScope = scope === GRAPH2_SCOPES.VAULT || scope === GRAPH2_SCOPES.DOMAIN;
    if (isConstellationScope || !centerNodeId) {
        const edgeCap = Math.max(24, Math.round(nodes.length * 1.8));
        return { nodes, edges: rankedEdges.slice(0, edgeCap) };
    }

    // Centered broad scope: per-node degree cap keeps the graph readable while
    // preserving all edges touching the center node.
    const degreeCap = nodes.length > 36 ? 3 : 4;
    const edgeCap = Math.max(16, Math.round(nodes.length * 1.45));
    const degreeByNode = new Map();
    const keptEdges = [];

    for (const edge of rankedEdges) {
        const srcDegree = degreeByNode.get(edge.source) || 0;
        const tgtDegree = degreeByNode.get(edge.target) || 0;
        const touchesCenter = edge.source === centerNodeId || edge.target === centerNodeId;
        if (!touchesCenter && (srcDegree >= degreeCap || tgtDegree >= degreeCap)) continue;
        keptEdges.push(edge);
        degreeByNode.set(edge.source, srcDegree + 1);
        degreeByNode.set(edge.target, tgtDegree + 1);
        if (keptEdges.length >= edgeCap) break;
    }

    const connectedNodeIds = new Set();
    for (const edge of keptEdges) {
        connectedNodeIds.add(edge.source);
        connectedNodeIds.add(edge.target);
    }
    connectedNodeIds.add(centerNodeId);

    const keptNodes = nodes.filter((node) => connectedNodeIds.has(node.id));
    return {
        nodes: keptNodes,
        edges: keptEdges.filter((edge) => connectedNodeIds.has(edge.source) && connectedNodeIds.has(edge.target))
    };
}

// Workspace-scope neighbor cap. For local/neighborhood scopes, ranks all direct neighbors
// of the center note by (sum of edge weights × 2) + (hubScore × 0.5) and keeps the
// top `cap` results. Depth-2 nodes are only revealed for explicitly expanded neighbors.
// Vault/domain/custom scopes are passed through unchanged.
function pruneWorkspaceScope(scope, nodes, edges, centerNodeId, cap, expandedNodeIds) {
    const isWorkspace = scope === GRAPH2_SCOPES.LOCAL || scope === GRAPH2_SCOPES.NEIGHBORHOOD;
    if (!isWorkspace || !centerNodeId || nodes.length === 0) {
        return { nodes, edges, hiddenNeighborCount: 0 };
    }

    const nodeById = new Map(nodes.map(n => [n.id, n]));
    if (!nodeById.has(centerNodeId)) return { nodes, edges, hiddenNeighborCount: 0 };

    // Accumulate score per direct neighbor: hubScore counted once, edge weights summed.
    const neighborScore = new Map();
    const hubScoreSeen = new Set();
    for (const edge of edges) {
        const atCenter = edge.source === centerNodeId || edge.target === centerNodeId;
        if (!atCenter) continue;
        const nid = edge.source === centerNodeId ? edge.target : edge.source;
        if (!nodeById.has(nid)) continue;
        const neighbor = nodeById.get(nid);
        const hubBonus = hubScoreSeen.has(nid) ? 0 : Number(neighbor.hubScore || 0) * 0.5;
        hubScoreSeen.add(nid);
        neighborScore.set(nid, (neighborScore.get(nid) || 0) + Number(edge.weight || 0) * 2 + hubBonus);
    }

    const ranked = [...neighborScore.entries()].sort((a, b) => b[1] - a[1]);
    const visibleIds = new Set(ranked.slice(0, cap).map(([id]) => id));
    const hiddenNeighborCount = Math.max(0, ranked.length - cap);

    // Depth-2 nodes for explicitly expanded depth-1 neighbors.
    const expandedSet = expandedNodeIds instanceof Set ? expandedNodeIds : new Set(expandedNodeIds || []);
    const depth2Ids = new Set();
    for (const xid of expandedSet) {
        if (!visibleIds.has(xid)) continue;
        for (const edge of edges) {
            const nid = edge.source === xid ? edge.target : edge.target === xid ? edge.source : null;
            if (!nid || nid === centerNodeId || visibleIds.has(nid) || !nodeById.has(nid)) continue;
            depth2Ids.add(nid);
        }
    }

    const allowed = new Set([centerNodeId, ...visibleIds, ...depth2Ids]);
    return {
        nodes: nodes.filter(n => allowed.has(n.id)),
        edges: edges.filter(e => allowed.has(e.source) && allowed.has(e.target)),
        hiddenNeighborCount
    };
}

function nodePassesFilters(node, allowedTypes, allowedTags, hideArchived) {
    if (allowedTypes.size > 0 && !allowedTypes.has(String(node.type || '').toLowerCase())) return false;
    if (allowedTags.size > 0) {
        const nodeTags = Array.isArray(node.tags) ? node.tags.map((tag) => String(tag).toLowerCase()) : [];
        const hasTag = nodeTags.some((tag) => allowedTags.has(tag));
        if (!hasTag) return false;
    }
    if (hideArchived && isArchivedNode(node)) return false;
    return true;
}

function edgePassesRelationFilter(edge, allowedRelationTypes, hideWeakMentions) {
    if (hideWeakMentions && edge.label === 'mention') return false;
    if (allowedRelationTypes.size > 0 && !allowedRelationTypes.has(String(edge.label || '').toLowerCase())) return false;
    return true;
}

function isArchivedNode(node) {
    const raw = node && node.archived;
    if (raw === true) return true;
    return String(raw || '').trim().toLowerCase() === 'true';
}

function summarizeRelations(edges) {
    const stats = new Map();
    for (const edge of edges) {
        const current = stats.get(edge.label) || { field: edge.label, count: 0, totalWeight: 0 };
        current.count += 1;
        current.totalWeight += Number(edge.weight || 0);
        stats.set(edge.label, current);
    }
    return [...stats.values()]
        .map((entry) => ({ field: entry.field, count: entry.count, totalWeight: round2(entry.totalWeight) }))
        .sort((a, b) => b.totalWeight - a.totalWeight || b.count - a.count || a.field.localeCompare(b.field));
}

function summarizeTypes(nodes) {
    const stats = new Map();
    for (const node of nodes) {
        const current = stats.get(node.type) || { type: node.type, color: node.color, shape: node.shape, count: 0 };
        current.count += 1;
        stats.set(node.type, current);
    }
    return [...stats.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function summarizeTags(nodes) {
    const stats = new Map();
    for (const node of nodes) {
        for (const tag of Array.isArray(node.tags) ? node.tags : []) {
            stats.set(tag, (stats.get(tag) || 0) + 1);
        }
    }
    return [...stats.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
        .slice(0, 8);
}

function rebuildConnectedTypes(nodeId, edges, nodeById) {
    const counts = new Map();
    for (const edge of edges) {
        if (edge.source !== nodeId && edge.target !== nodeId) continue;
        const neighborId = edge.source === nodeId ? edge.target : edge.source;
        const type = nodeById.get(neighborId)?.type || 'unknown';
        counts.set(type, (counts.get(type) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function rebuildRelationSummary(nodeId, edges) {
    const stats = new Map();
    for (const edge of edges) {
        if (edge.source !== nodeId && edge.target !== nodeId) continue;
        const current = stats.get(edge.label) || { field: edge.label, count: 0, weight: 0 };
        current.count += 1;
        current.weight += Number(edge.weight || 0);
        stats.set(edge.label, current);
    }
    return [...stats.values()]
        .map((entry) => ({ field: entry.field, count: entry.count, weight: round2(entry.weight) }))
        .sort((a, b) => b.weight - a.weight || b.count - a.count || a.field.localeCompare(b.field));
}

function rebuildStrongestLinks(nodeId, edges) {
    const matches = [];
    for (const edge of edges) {
        if (edge.source === nodeId) {
            matches.push({ targetId: edge.target, label: edge.label, weight: edge.weight, strength: edge.strength });
        } else if (edge.target === nodeId) {
            matches.push({ sourceId: edge.source, label: edge.label, weight: edge.weight, strength: edge.strength });
        }
    }
    return matches.sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0) || String(a.label || '').localeCompare(String(b.label || '')));
}

function computeLargestFilteredCluster(nodeIds, edges) {
    const allowed = new Set(nodeIds);
    const adjacency = new Map();
    for (const id of nodeIds) adjacency.set(id, new Set());
    for (const edge of edges) {
        if (!allowed.has(edge.source) || !allowed.has(edge.target)) continue;
        adjacency.get(edge.source).add(edge.target);
        adjacency.get(edge.target).add(edge.source);
    }

    const visited = new Set();
    let largest = 0;
    for (const id of nodeIds) {
        if (visited.has(id)) continue;
        let count = 0;
        const stack = [id];
        visited.add(id);
        while (stack.length > 0) {
            const current = stack.pop();
            count += 1;
            for (const nextId of adjacency.get(current) || []) {
                if (visited.has(nextId)) continue;
                visited.add(nextId);
                stack.push(nextId);
            }
        }
        largest = Math.max(largest, count);
    }
    return largest;
}

function pickSelectedNodeId(preferredId, model, scope = 'neighborhood') {
    const nodeIds = (model.elements || [])
        .map((element) => element?.data)
        .filter((data) => data && data.id && !data.source)
        .map((data) => data.id);
    if (preferredId && nodeIds.includes(preferredId)) return preferredId;
    if (scope === GRAPH2_SCOPES.VAULT || scope === GRAPH2_SCOPES.DOMAIN) return null;
    return model.summary?.primaryFocusId && nodeIds.includes(model.summary.primaryFocusId)
        ? model.summary.primaryFocusId
        : (nodeIds[0] || null);
}

function uniqueIds(values) {
    const seen = new Set();
    const result = [];
    for (const value of values || []) {
        const next = String(value || '').trim();
        if (!next || seen.has(next)) continue;
        seen.add(next);
        result.push(next);
    }
    return result;
}

function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

module.exports = {
    buildGraph2Payload,
    resolveSeedNodeIds,
    resolveScopeNodeIds,
    filterGraphModel,
    pruneWorkspaceScope
};
