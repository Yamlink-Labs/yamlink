'use strict';

const { getPathIndex } = require('../../core/indexService');
const {
    buildGraphModel,
    collectNeighborhood,
    getTopVaultNodes,
    getNodeSnapshot
} = require('./graphModel');

function buildPanelPayload(state, getActiveNodeId = getActiveMarkdownNodeId) {
    const forceLayout = !!state.forceLayout;
    state.forceLayout = false;
    const activeNodeId = getActiveNodeId();

    let centerNodeId = null;
    let nodeIds = [];

    if (state.mode === 'local') {
        centerNodeId = state.centerNodeId || activeNodeId;
        if (centerNodeId) {
            nodeIds = Array.from(collectNeighborhood(
                new Set([...state.expandedNodeIds, centerNodeId]),
                state.depth,
                Math.max(40, state.maxNodes)
            ));
        }
    } else {
        nodeIds = getTopVaultNodes(Math.min(state.maxNodes, 50));
        if (activeNodeId) {
            const activeSlice = Array.from(collectNeighborhood(
                new Set([activeNodeId]),
                1,
                12
            ));
            nodeIds = Array.from(new Set([...nodeIds, ...activeSlice]));
        }
    }

    const model = buildGraphModel(nodeIds, centerNodeId);
    const selectedNodeId = state.selectedNodeId && nodeIds.includes(state.selectedNodeId)
        ? state.selectedNodeId
        : (state.mode === 'vault' && activeNodeId && nodeIds.includes(activeNodeId)
            ? activeNodeId
            : (centerNodeId && nodeIds.includes(centerNodeId) ? centerNodeId : (model.topNodes[0]?.id || null)));

    const selectedNode = selectedNodeId ? getNodeSnapshot(selectedNodeId) : null;

    return {
        mode: state.mode,
        depth: state.depth,
        centerNodeId: centerNodeId || null,
        selectedNodeId,
        selectedNode,
        model,
        forceLayout,
        noCenter: state.mode === 'local' && !centerNodeId
    };
}

function getActiveMarkdownNodeId() {
    const editor = require('vscode').window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') return null;
    return getPathIndex().get(editor.document.uri.fsPath) || null;
}

module.exports = {
    buildPanelPayload,
    getActiveMarkdownNodeId
};
