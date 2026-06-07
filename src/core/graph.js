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

module.exports = {
    clearGraph,
    registerEdges,
    removeEdgesForSource,
    getEdges,
    getBacklinks,
    getGraphStats,
    isOrphan
};