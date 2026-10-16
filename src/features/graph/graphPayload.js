'use strict';

const { getPathIndex, getIndex, getFieldsCache, getVaultGeneration } = require('../../core/indexService');
const { getBacklinks, getGraphStats } = require('../../core/graph');
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

// A real, non-empty `type:` that ISN'T one of the 11 curated literal names
// above used to collapse straight to the same default gray as a note with no
// type at all — found via a real user's own vault, mostly `company`/
// `product`/`tool`-style business notes, rendering almost entirely gray. A
// closed, hardcoded 6-color vocabulary is exactly the kind of "global
// archetype" CLAUDE.md's Intelligence section says Yamlink should never rely
// on, so a real, unrecognized type now gets a genuine, stable color instead.
// A note with NO type at all still renders gray — there is genuinely no
// information to color by there, which is the honest, correct default, not
// a bug.
//
// Assigned by SORTED POSITION among the vault's own distinct non-curated
// types, not a hash of the string — measured directly before choosing this:
// hashing even a small, realistic set of business-vault type names
// (`company`/`product`/`tool`/`strategy`/`service`/...) produced real
// collisions immediately (4 different types landing on the identical color)
// while 3 of 8 palette slots went completely unused, because a short
// English word hashed through a small modulus skews rather than spreading
// evenly. Sorting the vault's actual distinct types and cycling through the
// palette in that order guarantees every slot is used round-robin before
// any repeat — collisions only become unavoidable once there are genuinely
// more distinct types than palette colors (true pigeonhole, not an
// avoidable skew). Cached per vault generation (this file already computes
// `getVaultGeneration()` in `buildXGraphData`), consistent with every other
// generation-keyed cache in this codebase — colors are stable across
// reloads, panel scopes, and time-lapse frames within one vault generation,
// and only shift if the vault's own set of distinct types actually changes.
const _XG_TYPE_PALETTE = ['#7986cb', '#4dd0e1', '#81c784', '#ba68c8', '#4fc3f7', '#a1887f', '#dce775', '#f06292'];

let _cachedTypeColorGeneration = -1;
let _cachedTypeColorMap = null;

function _getDistinctTypeColorMap() {
    // Same defensive try/catch buildXGraphData() already uses around its own
    // getVaultGeneration() call just below — some lightweight test stubs of
    // core/indexService (e.g. test/graph2Payload.test.js's hand-rolled stub)
    // only implement getIndex()/getFieldsCache(), not every export. Falling
    // back to a constant just means this cache never invalidates in that
    // degraded scenario, which is harmless — it's a performance cache key,
    // not something correctness depends on.
    let generation = 0;
    try { generation = getVaultGeneration(); } catch (_) { /* see comment above */ }
    if (generation === _cachedTypeColorGeneration && _cachedTypeColorMap) return _cachedTypeColorMap;
    const distinctTypes = new Set();
    for (const fields of getFieldsCache().values()) {
        const type = String(fields?.type || '').trim().toLowerCase();
        if (!type || _XG_TYPE_KIND[type]) continue;
        distinctTypes.add(type);
    }
    const sorted = [...distinctTypes].sort();
    const map = new Map(sorted.map((type, i) => [type, _XG_TYPE_PALETTE[i % _XG_TYPE_PALETTE.length]]));
    _cachedTypeColorMap = map;
    _cachedTypeColorGeneration = generation;
    return map;
}

/** Test-only: clears the generation-keyed type→color cache. @returns {void} */
function resetTypeColorCache() {
    _cachedTypeColorGeneration = -1;
    _cachedTypeColorMap = null;
}

function _xgWeight(hubScore, weightedDegree) {
    return Math.min(1, hubScore) * _XG_HUB_W + Math.min(1, weightedDegree / _XG_DEG_SCALE) * _XG_DEG_W;
}

function _xgKind(type) {
    if (!type) return 'default';
    return _XG_TYPE_KIND[type.toLowerCase()] ?? 'default';
}

// Resolves a real display color for `type`, beyond the 6 curated semantic
// roles `_xgKind` maps to `KIND_COLORS` in the renderer. Returns `null` when
// there's nothing new to add — a curated type already resolves correctly
// through the existing `kind` field, and no type at all has no information
// to color by — so the renderer's existing `KIND_COLORS[node.kind] ??
// KIND_COLORS.default` fallback chain is untouched for both of those cases;
// this only ever supplies a color for a real, non-curated type.
function _xgColor(type) {
    if (!type) return null;
    const lower = type.toLowerCase();
    if (_XG_TYPE_KIND[lower]) return null;
    return _getDistinctTypeColorMap().get(lower) ?? null;
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
                color:          _xgColor(d.type),
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

    // The real, uncapped vault totals — same fix, same reasoning, as
    // graph2Payload.js's own vaultTotals (see that file's comment): this
    // panel's own vault mode caps at Math.min(state.maxNodes, 50) above,
    // and its status line previously showed that capped count with nothing
    // indicating it wasn't the vault's true size.
    const vaultTotals = { nodeCount: getIndex().size, edgeCount: getGraphStats().totalEdges };

    return {
        mode: state.mode,
        depth: state.depth,
        centerNodeId: centerNodeId || null,
        selectedNodeId,
        selectedNode,
        model,
        graphData: buildXGraphData(model),
        forceLayout,
        noCenter: state.mode === 'local' && !centerNodeId,
        vaultTotals
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
    getActiveMarkdownNodeId,
    xgKind: _xgKind,
    xgColor: _xgColor,
    resetTypeColorCache
};
