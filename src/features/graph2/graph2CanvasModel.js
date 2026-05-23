'use strict';

const TYPE_COLOR_PALETTE = [
    '#79c0ff', '#4fc4a0', '#f1d08a', '#a371f7', '#f78166',
    '#56d364', '#ffa657', '#ff79c6', '#8be9fd', '#e5a96a'
];

function typeColor(type) {
    if (!type) return TYPE_COLOR_PALETTE[0];
    let h = 0;
    for (let i = 0; i < type.length; i++) h = ((h * 31) + type.charCodeAt(i)) >>> 0;
    return TYPE_COLOR_PALETTE[h % TYPE_COLOR_PALETTE.length];
}

function buildGraph2CanvasModel(payload) {
    const model = payload && payload.model ? payload.model : { elements: [], summary: {} };
    const nodeElements = [];
    const edgeElements = [];

    for (const entry of model.elements || []) {
        const data = entry && entry.data;
        if (!data) continue;
        if (data.source && data.target) edgeElements.push(data);
        else if (data.id) nodeElements.push(data);
    }

    const scope = String(payload?.scope || '');
    const isVaultScope = scope === 'vault' || scope === 'domain';
    const hiddenWorkspaceNeighborCount = (!isVaultScope && payload?.hiddenWorkspaceNeighborCount) ? payload.hiddenWorkspaceNeighborCount : 0;
    const centerId = isVaultScope
        ? (payload?.centerNodeId || null)
        : (payload?.centerNodeId
            || payload?.selectedNodeId
            || model.summary?.primaryFocusId
            || nodeElements[0]?.id
            || null);
    const isSidebarConstellation = isVaultScope && payload?.uiMode === 'sidebar';
    const selectedId = isVaultScope
        ? (payload?.selectedNodeId || null)
        : (payload?.selectedNodeId || centerId);
    const visualCenterId = isVaultScope ? null : centerId;
    const adjacency = buildAdjacency(edgeElements);
    const depths = computeDepths(centerId, edgeElements);
    const selectedNeighborIds = selectedId ? new Set(adjacency.get(selectedId) || []) : new Set();
    const tiers = inferNodeTiers(nodeElements, centerId, isVaultScope);

    const nodes = nodeElements.map((node, index) => {
        const tier = tiers.get(node.id) || 'minor';
        const size = isVaultScope ? vaultDotTierSize(tier, isSidebarConstellation) : tierSize(tier);
        const selectionRole = inferSelectionRole(node.id, visualCenterId, selectedId, selectedNeighborIds);
        const nodeType = isVaultScope ? 'vaultDotNode' : 'yamlinkNode';
        const color = typeColor(node.type);
        return {
            id: node.id,
            type: nodeType,
            position: seedPosition(index, depths.get(node.id) ?? 99, selectionRole),
            data: {
                id: node.id,
                label: node.label,
                type: node.type,
                tags: Array.isArray(node.tags) ? node.tags : [],
                weightedDegree: Number(node.weightedDegree || 0),
                hubScore: Number(node.hubScore || 0),
                isCenter: visualCenterId ? node.id === visualCenterId : false,
                tier,
                selectionRole,
                color,
                dotSize: isVaultScope ? size.width : null,
                nodeShape: isVaultScope ? 'circle' : 'rect',
                isVaultScope,
                uiMode: payload?.uiMode || 'workspace',
                width: size.width,
                height: size.height,
                hiddenNeighborCount: (!isVaultScope && visualCenterId && node.id === visualCenterId) ? hiddenWorkspaceNeighborCount : 0
            },
            width: size.width,
            height: size.height
        };
    });

    // Count edges per undirected source-target pair for parallel offset (item 12).
    const pairCounts = new Map();
    for (const edge of edgeElements) {
        const key = [edge.source, edge.target].sort().join('\x00');
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }
    const pairNextIdx = new Map();

    const edges = edgeElements.map((edge) => {
        const key = [edge.source, edge.target].sort().join('\x00');
        const edgeSiblingCount = pairCounts.get(key) || 1;
        const edgeIndex = pairNextIdx.get(key) || 0;
        pairNextIdx.set(key, edgeIndex + 1);
        return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            data: {
                label: edge.label,
                weight: Number(edge.weight || 0),
                strength: edge.strength || 'medium',
                color: edge.color || '#79c0ff',
                isVaultScope,
                uiMode: payload?.uiMode || 'workspace',
                isCenterEdge: Boolean(visualCenterId && (edge.source === visualCenterId || edge.target === visualCenterId)),
                isSelectedPath: Boolean(selectedId && (edge.source === selectedId || edge.target === selectedId)),
                edgeSiblingCount,
                edgeIndex
            }
        };
    });

    return {
        centerId,
        selectedId,
        adjacency,
        nodes,
        edges,
        summary: {
            nodeCount: nodes.length,
            edgeCount: edges.length
        }
    };
}

// Tier assignment governs dot/card size and visual weight.
// Neighborhood/local: center note is always primary, top ~22% secondary, rest minor.
// Vault/domain: purely by hub score — top 5% primary, next 22% secondary, rest minor.
// This prevents the active note from dominating the constellation view.
function inferNodeTiers(nodes, centerId, isVaultScope = false) {
    const scored = nodes.map(node => ({
        id: node.id,
        score: Math.max(Number(node.hubScore || 0), Number(node.weightedDegree || 0))
    })).sort((a, b) => b.score - a.score);

    const n = scored.length;
    const primaryCap = isVaultScope ? Math.max(1, Math.ceil(n * 0.05)) : 0;
    const secondaryCap = Math.max(1, Math.ceil(n * 0.22));
    const tiers = new Map();
    let primaryCount = 0;
    let secondaryCount = 0;

    for (const entry of scored) {
        if (!isVaultScope && entry.id === centerId) {
            tiers.set(entry.id, 'primary');
        } else if (primaryCount < primaryCap) {
            tiers.set(entry.id, 'primary');
            primaryCount++;
        } else if (secondaryCount < secondaryCap) {
            tiers.set(entry.id, 'secondary');
            secondaryCount++;
        } else {
            tiers.set(entry.id, 'minor');
        }
    }
    return tiers;
}

function tierSize(tier) {
    if (tier === 'primary')   return { width: 172, height: 72 };
    if (tier === 'secondary') return { width: 136, height: 54 };
    return { width: 100, height: 40 };
}

function vaultDotTierSize(tier, isSidebarConstellation = false) {
    if (isSidebarConstellation) {
        if (tier === 'primary')   return { width: 22, height: 22 };
        if (tier === 'secondary') return { width: 15, height: 15 };
        return { width: 11, height: 11 };
    }
    if (tier === 'primary')   return { width: 24, height: 24 };
    if (tier === 'secondary') return { width: 15, height: 15 };
    return { width: 9, height: 9 };
}

function inferSelectionRole(nodeId, centerId, selectedId, selectedNeighborIds) {
    if (nodeId === centerId) return 'center';
    if (nodeId === selectedId) return 'selected';
    if (selectedNeighborIds.has(nodeId)) return 'neighbor';
    return 'peripheral';
}

function seedPosition(index, depth, selectionRole) {
    if (selectionRole === 'center') return { x: 0, y: 0 };
    const safeDepth = Number.isFinite(depth) ? Math.max(1, depth) : 2;
    return {
        x: safeDepth * 200,
        y: (index % 7) * 100 - 300
    };
}

function computeDepths(centerId, edges) {
    const adjacency = buildAdjacency(edges);
    const depths = new Map();
    if (!centerId) return depths;
    const queue = [centerId];
    depths.set(centerId, 0);
    while (queue.length) {
        const current = queue.shift();
        const d = depths.get(current) || 0;
        for (const nextId of adjacency.get(current) || []) {
            if (depths.has(nextId)) continue;
            depths.set(nextId, d + 1);
            queue.push(nextId);
        }
    }
    return depths;
}

function buildAdjacency(edges) {
    const adjacency = new Map();
    for (const edge of edges || []) {
        if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
        if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
        adjacency.get(edge.source).add(edge.target);
        adjacency.get(edge.target).add(edge.source);
    }
    return adjacency;
}

module.exports = {
    buildGraph2CanvasModel,
    computeDepths,
    typeColor
};
