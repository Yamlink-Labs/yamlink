'use strict';

const { getPathIndex, getIndex, getFieldsCache, getVaultGeneration } = require('../../core/indexService');
const { getBacklinks } = require('../../core/graph');
const { inferLifecycleState } = require('../../intelligence/lifecycleState');
const { computeNoteDrift } = require('../../intelligence/driftDetector');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const {
    buildGraphModel,
    collectNeighborhood,
    getTopVaultNodes,
    getNodeSnapshot
} = require('./graphModel');

// ─── x-graph adapter (CommonJS mirror of graph/adapter-yamlink/index.js) ─────

const _XG_HUB_W    = 0.6;
const _XG_DEG_W    = 0.4;
const _XG_DEG_SCALE = 20;

const _XG_TYPE_KIND = {
    person: 'person', contact: 'person', character: 'person',
    mission: 'event',  event:   'event',  session:   'event',
    note: 'artifact',  source:  'artifact', document: 'artifact',
    schema: 'schema',  task:    'task',
    project: 'container', unit: 'container',
};

function _xgWeight(hubScore, weightedDegree) {
    return Math.min(1, hubScore) * _XG_HUB_W + Math.min(1, weightedDegree / _XG_DEG_SCALE) * _XG_DEG_W;
}

function _xgKind(type) {
    if (!type) return 'default';
    return _XG_TYPE_KIND[type.toLowerCase()] ?? 'default';
}

/** @param {Record<string,any>} model @returns {{ nodes: Array<Record<string,any>>, edges: Array<Record<string,any>> }} */
function buildXGraphData(model) {
    const fieldsCache = getFieldsCache();
    const idIndex     = getIndex();
    let priors = null;
    try { priors = getCachedPriors(fieldsCache, getVaultGeneration()); } catch (_) {}

    // avgInbound — used by lifecycle hub threshold
    const nodeIds = [];
    for (const el of model.elements) {
        if (el.data.source === undefined) nodeIds.push(el.data.id);
    }
    let totalInbound = 0;
    for (const id of nodeIds) totalInbound += (getBacklinks(id) || []).length;
    const avgInbound = nodeIds.length > 0 ? totalInbound / nodeIds.length : 0;

    const nodes = [];
    const edges = [];

    for (const el of model.elements) {
        const d = el.data;
        if (d.source !== undefined) {
            edges.push({
                id:       d.id ?? (d.source + '->' + d.target),
                source:   d.source,
                target:   d.target,
                field:    d.label ?? d.field ?? null,
                weight:   d.weight ?? 0.5,
                strength: d.strength ?? 'medium',
                directed: true,
            });
        } else {
            const noteFields   = fieldsCache.get(d.id) || {};
            const inboundCount = (getBacklinks(d.id) || []).length;

            let lifecycleState = null;
            let driftState     = null;

            try {
                const lc = inferLifecycleState(d.id, noteFields, {
                    fieldsCache, idIndex,
                    typeFieldBundles:   priors?.typeFieldBundles   || new Map(),
                    noteRoleTypePriors: priors?.noteRoleTypePriors || new Map(),
                    inboundCount, avgInbound,
                });
                lifecycleState = lc?.label || null;
            } catch (_) {}

            try {
                if (priors) {
                    const drift = computeNoteDrift(d.id, noteFields, fieldsCache, priors);
                    if (drift && !drift.insufficientData && drift.driftLabel && drift.driftLabel !== 'on-track') {
                        driftState = drift.driftLabel;
                    }
                }
            } catch (_) {}

            nodes.push({
                id:             d.id,
                label:          d.label ?? d.id,
                kind:           _xgKind(d.type),
                group:          d.type ?? 'default',
                type:           d.type ?? null,
                weight:         _xgWeight(d.hubScore ?? 0, d.weightedDegree ?? 0),
                isOrphan:       false,
                lifecycleState,
                driftState,
                edges:          [],
            });
        }
    }

    const nodeById = new Map(nodes.map(n => [n.id, n]));
    for (const e of edges) {
        nodeById.get(e.source)?.edges.push({ source: e.source, target: e.target });
        nodeById.get(e.target)?.edges.push({ source: e.source, target: e.target });
    }

    return { nodes, edges };
}

/** @param {Record<string,any>} state @param {() => string|null} [getActiveNodeId] @returns {Record<string,any>} */
/**
 * @param {object} state Graph panel state (mode, centerNodeId, depth, etc.)
 * @param {() => string|null} [getActiveNodeId]
 * @returns {object}
 */
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
        graphData: buildXGraphData(model),
        forceLayout,
        noCenter: state.mode === 'local' && !centerNodeId
    };
}

/** @returns {string|null} */
function getActiveMarkdownNodeId() {
    const editor = require('vscode').window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') return null;
    return getPathIndex().get(editor.document.uri.fsPath) || null;
}

module.exports = {
    buildPanelPayload,
    buildXGraphData,
    getActiveMarkdownNodeId
};
