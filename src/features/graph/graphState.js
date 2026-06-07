'use strict';

const MAX_GRAPH_DEPTH = 3;
const DEFAULT_DEPTH = 1;
const DEFAULT_VAULT_LIMIT = 80;

/**
 * @param {{ mode?: string, centerNodeId?: string, depth?: number, maxNodes?: number }} options
 * @param {string|null} activeNodeId
 * @param {object|null} [previousState]
 * @returns {{ mode: string, centerNodeId: string|null, selectedNodeId: string|null, depth: number, maxNodes: number, expandedNodeIds: Set<string> }}
 */
function normaliseState(options, activeNodeId, previousState = null) {
    const requestedMode = (options && options.mode === 'local') ? 'local' : 'vault';
    const previousExpanded = previousState && previousState.expandedNodeIds instanceof Set
        ? previousState.expandedNodeIds
        : new Set();

    const state = {
        mode: requestedMode,
        centerNodeId: options.centerNodeId || activeNodeId || previousState?.centerNodeId || null,
        selectedNodeId: options.centerNodeId || activeNodeId || previousState?.selectedNodeId || null,
        depth: clampDepth(options.depth || previousState?.depth || DEFAULT_DEPTH),
        maxNodes: Number.isInteger(options.maxNodes) ? options.maxNodes : (previousState?.maxNodes || DEFAULT_VAULT_LIMIT),
        expandedNodeIds: new Set(previousExpanded)
    };

    if (state.centerNodeId) {
        state.expandedNodeIds.add(state.centerNodeId);
    }

    if (requestedMode === 'vault' && !state.centerNodeId) {
        state.selectedNodeId = previousState?.selectedNodeId || null;
    }

    return state;
}

/**
 * @param {object|null} state
 * @returns {string}
 */
function getPanelTitle(state) {
    if (!state) return 'Graph';
    if (state.mode === 'vault') return 'Graph · Explorer';
    return 'Graph · Local';
}

/**
 * @param {number} value
 * @returns {number}
 */
function clampDepth(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return DEFAULT_DEPTH;
    return Math.max(1, Math.min(MAX_GRAPH_DEPTH, Math.round(next)));
}

module.exports = {
    DEFAULT_DEPTH,
    DEFAULT_VAULT_LIMIT,
    MAX_GRAPH_DEPTH,
    normaliseState,
    getPanelTitle,
    clampDepth
};
