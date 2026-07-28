// graph.js — In-memory graph layer (Stage 2A)
//
// Tracks directed labeled edges between Yamlink nodes.
// Identity index answers: "does this node exist?"
// Graph layer answers:    "what is this node connected to?"
//
// Lifecycle: rebuilt on every buildIndex(). No persistence — Phase 3 concern.

/** @typedef {{ field: string, targetId: string }} OutboundEdge */
/** @typedef {{ field: string, sourceId: string }} InboundEdge */

let outboundEdges = new Map(); // id → [{ field, targetId }]
let inboundEdges  = new Map(); // id → [{ field, sourceId }]

/** @returns {void} */
function clearGraph() {
    outboundEdges.clear();
    inboundEdges.clear();
}

// Called during incremental update to remove a node's outbound edges
// and clean up every inbound entry that pointed back to it.
// Must be called BEFORE re-registering new edges for the same sourceId.
/** @param {string} sourceId @returns {void} */
function removeEdgesForSource(sourceId) {
    const oldEdges = outboundEdges.get(sourceId) ?? [];
    for (const { targetId } of oldEdges) {
        const inbound = inboundEdges.get(targetId);
        if (!inbound) continue;
        const filtered = inbound.filter(e => e.sourceId !== sourceId);
        if (filtered.length === 0) inboundEdges.delete(targetId);
        else inboundEdges.set(targetId, filtered);
    }
    outboundEdges.delete(sourceId);
}

// Called once per node during index build
/** @param {string} sourceId @param {OutboundEdge[]} edges @returns {void} */
function registerEdges(sourceId, edges) {
    if (!edges || edges.length === 0) return;

    outboundEdges.set(sourceId, edges);

    for (const { field, targetId } of edges) {
        if (!inboundEdges.has(targetId)) inboundEdges.set(targetId, []);
        inboundEdges.get(targetId).push({ field, sourceId });
    }
}

// Outbound edges FROM a node → [{ field, targetId }]
/** @param {string} id @returns {OutboundEdge[]} */
function getEdges(id) {
    return outboundEdges.get(id) ?? [];
}

// Inbound edges pointing TO a node → [{ field, sourceId }]
/** @param {string} id @returns {InboundEdge[]} */
function getBacklinks(id) {
    return inboundEdges.get(id) ?? [];
}

// No inbound AND no outbound — stub for Phase 3 orphan detection
/** @param {string} id @returns {boolean} */
function isOrphan(id) {
    return getEdges(id).length === 0 && getBacklinks(id).length === 0;
}

// Diagnostic utility — output panel + future dashboard
/** @returns {{ nodes: number, totalEdges: number, totalBacklinks: number }} */
function getGraphStats() {
    let totalEdges = 0;
    for (const edges of outboundEdges.values()) totalEdges += edges.length;
    return {
        nodes: outboundEdges.size,
        totalEdges,
        totalBacklinks: inboundEdges.size
    };
}

/** @param {number} value @returns {number} */
function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * @param {string} label
 * @param {{ reciprocal?: boolean, sourceType?: string, targetType?: string }} [options]
 * @returns {number}
 */
function computeGraphEdgeWeight(label, options = {}) {
    const isMention = label === 'mention';
    const reciprocalBonus = options.reciprocal ? 0.65 : 0;
    const semanticBonus = options.sourceType && options.targetType && options.sourceType !== options.targetType ? 0.2 : 0;
    const base = isMention ? 0.85 : 2.55;
    return round2(base + reciprocalBonus + semanticBonus);
}

/** @param {string} label @param {number} weight @returns {'weak'|'medium'|'strong'} */
function classifyGraphEdgeStrength(label, weight) {
    if (label === 'mention') return 'weak';
    if (weight >= 3.2) return 'strong';
    return 'medium';
}

/**
 * @param {{ weightedDegree: number, relationKinds: number, connectedTypes: number, strongEdges: number, tagCount: number }} parts
 * @returns {number}
 */
function computeHubScore({ weightedDegree, relationKinds, connectedTypes, strongEdges, tagCount }) {
    return round2(
        (weightedDegree * 2.2) +
        (relationKinds * 1.4) +
        (connectedTypes * 1.1) +
        (strongEdges * 0.75) +
        (Math.min(tagCount, 4) * 0.25)
    );
}

/** @param {Record<string, any>} fields @returns {string[]} */
function getGraphNodeTags(fields = {}) {
    const raw = String(fields.__yamlink_tags || '').trim();
    if (!raw) return [];
    return [...new Set(raw.split(',').map((tag) => String(tag || '').trim()).filter(Boolean))];
}

/** @param {string} id @returns {number} */
function computeNodeWeightedDegree(id) {
    const outgoing = (getEdges(id) || []).map((edge) => computeGraphEdgeWeight(edge.field === 'body' ? 'mention' : edge.field, {
        reciprocal: (getEdges(edge.targetId) || []).some((candidate) => candidate && candidate.targetId === id)
    }));
    const incoming = (getBacklinks(id) || []).map((edge) => computeGraphEdgeWeight(edge.field === 'body' ? 'mention' : edge.field, {
        reciprocal: (getEdges(edge.sourceId) || []).some((candidate) => candidate && candidate.targetId === id)
    }));
    return round2([...outgoing, ...incoming].reduce((sum, weight) => sum + weight, 0));
}

/**
 * @param {string} id
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {number}
 */
function computeNodeExplorerScore(id, fieldsCache) {
    const relatedTypes = new Set();
    const relationFields = new Set();
    const tags = getGraphNodeTags(fieldsCache.get(id) || {});
    let strongEdges = 0;

    for (const edge of getEdges(id) || []) {
        const label = edge.field === 'body' ? 'mention' : edge.field;
        const targetFields = fieldsCache.get(edge.targetId) || {};
        relationFields.add(label);
        relatedTypes.add(String(targetFields.type || 'unknown'));
        if (classifyGraphEdgeStrength(label, computeGraphEdgeWeight(label)) !== 'weak') strongEdges += 1;
    }
    for (const edge of getBacklinks(id) || []) {
        const label = edge.field === 'body' ? 'mention' : edge.field;
        const sourceFields = fieldsCache.get(edge.sourceId) || {};
        relationFields.add(label);
        relatedTypes.add(String(sourceFields.type || 'unknown'));
        if (classifyGraphEdgeStrength(label, computeGraphEdgeWeight(label)) !== 'weak') strongEdges += 1;
    }

    return computeHubScore({
        weightedDegree: computeNodeWeightedDegree(id),
        relationKinds: relationFields.size,
        connectedTypes: [...relatedTypes].filter(Boolean).length,
        strongEdges,
        tagCount: tags.length
    });
}

module.exports = {
    clearGraph,
    registerEdges,
    removeEdgesForSource,
    getEdges,
    getBacklinks,
    getGraphStats,
    computeGraphEdgeWeight,
    classifyGraphEdgeStrength,
    computeHubScore,
    computeNodeWeightedDegree,
    computeNodeExplorerScore,
    isOrphan
};
