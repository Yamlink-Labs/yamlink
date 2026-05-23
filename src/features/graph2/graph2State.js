'use strict';

const GRAPH2_SOURCES = Object.freeze({
    CURRENT: 'current',
    QUERY: 'query',
    CUSTOM: 'custom'
});

const GRAPH2_SCOPES = Object.freeze({
    LOCAL: 'local',
    NEIGHBORHOOD: 'neighborhood',
    DOMAIN: 'domain',
    VAULT: 'vault',
    CUSTOM: 'custom'
});

const MAX_GRAPH2_DEPTH = 4;
const DEFAULT_GRAPH2_DEPTH = 2;
const DEFAULT_GRAPH2_NODE_CAP = 128;
const MIN_GRAPH2_NODE_CAP = 20;
const MAX_GRAPH2_NODE_CAP = 2000;
const DEFAULT_WORKSPACE_FOCUS_CAP = 5;
const MIN_WORKSPACE_FOCUS_CAP = 1;
const MAX_WORKSPACE_FOCUS_CAP = 32;

function normalizeGraph2State(options = {}, activeNodeId = null, previousState = null) {
    const source = normalizeSource(options.source || previousState?.source);
    const scope = normalizeScope(options.scope || previousState?.scope);
    const isBroadScope = scope === GRAPH2_SCOPES.VAULT || scope === GRAPH2_SCOPES.DOMAIN;
    const centerNodeId = hasOwn(options, 'centerNodeId')
        ? normalizeOptionalId(options.centerNodeId)
        : (isBroadScope ? null : firstNonEmpty(activeNodeId, previousState?.centerNodeId, null));
    const selectedNodeId = hasOwn(options, 'selectedNodeId')
        ? normalizeOptionalId(options.selectedNodeId)
        : (isBroadScope ? null : firstNonEmpty(centerNodeId, previousState?.selectedNodeId, null));

    return {
        version: 2,
        source,
        scope,
        centerNodeId,
        selectedNodeId,
        pinnedCenter: hasOwn(options, 'pinnedCenter') ? !!options.pinnedCenter : !!(previousState?.pinnedCenter),
        depth: clampGraph2Depth(options.depth ?? previousState?.depth ?? DEFAULT_GRAPH2_DEPTH),
        nodeCap: clampGraph2NodeCap(options.nodeCap ?? previousState?.nodeCap ?? DEFAULT_GRAPH2_NODE_CAP),
        queryText: String(options.queryText ?? previousState?.queryText ?? '').trim(),
        queryNodeIds: normalizeIdList(options.queryNodeIds ?? previousState?.queryNodeIds),
        customNodeIds: normalizeIdList(options.customNodeIds ?? previousState?.customNodeIds),
        expandedNodeIds: new Set(normalizeIdList(options.expandedNodeIds ?? previousState?.expandedNodeIds)),
        workspaceFocusCap: clampWorkspaceFocusCap(options.workspaceFocusCap ?? previousState?.workspaceFocusCap ?? DEFAULT_WORKSPACE_FOCUS_CAP),
        filters: normalizeFilters(options.filters || previousState?.filters)
    };
}

function normalizeSource(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === GRAPH2_SOURCES.QUERY) return GRAPH2_SOURCES.QUERY;
    if (raw === GRAPH2_SOURCES.CUSTOM) return GRAPH2_SOURCES.CUSTOM;
    return GRAPH2_SOURCES.CURRENT;
}

function normalizeScope(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (Object.values(GRAPH2_SCOPES).includes(raw)) return raw;
    return GRAPH2_SCOPES.NEIGHBORHOOD;
}

function normalizeFilters(filters = {}) {
    return {
        types: normalizeStringList(filters.types),
        relationTypes: normalizeStringList(filters.relationTypes),
        tags: normalizeStringList(filters.tags),
        hideArchived: filters.hideArchived !== false,
        hideOrphans: !!filters.hideOrphans,
        hideWeakMentions: !!filters.hideWeakMentions
    };
}

function normalizeIdList(value) {
    const items = value instanceof Set
        ? [...value]
        : (Array.isArray(value) ? value : (value ? [value] : []));
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const next = String(item || '').trim();
        if (!next || seen.has(next)) continue;
        seen.add(next);
        result.push(next);
    }
    return result;
}

function normalizeStringList(value) {
    const items = Array.isArray(value) ? value : (value ? [value] : []);
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const next = String(item || '').trim();
        if (!next) continue;
        const key = next.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(next);
    }
    return result;
}

function clampGraph2Depth(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return DEFAULT_GRAPH2_DEPTH;
    return Math.max(1, Math.min(MAX_GRAPH2_DEPTH, Math.round(next)));
}

function clampGraph2NodeCap(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return DEFAULT_GRAPH2_NODE_CAP;
    return Math.max(MIN_GRAPH2_NODE_CAP, Math.min(MAX_GRAPH2_NODE_CAP, Math.round(next)));
}

function clampWorkspaceFocusCap(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return DEFAULT_WORKSPACE_FOCUS_CAP;
    return Math.max(MIN_WORKSPACE_FOCUS_CAP, Math.min(MAX_WORKSPACE_FOCUS_CAP, Math.round(next)));
}

function firstNonEmpty(...values) {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        const next = String(value).trim();
        if (next) return next;
    }
    return null;
}

function normalizeOptionalId(value) {
    if (value === null || value === undefined) return null;
    const next = String(value).trim();
    return next || null;
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

module.exports = {
    GRAPH2_SOURCES,
    GRAPH2_SCOPES,
    MAX_GRAPH2_DEPTH,
    DEFAULT_GRAPH2_DEPTH,
    DEFAULT_GRAPH2_NODE_CAP,
    DEFAULT_WORKSPACE_FOCUS_CAP,
    normalizeGraph2State,
    normalizeFilters,
    clampGraph2Depth,
    clampGraph2NodeCap,
    clampWorkspaceFocusCap
};
