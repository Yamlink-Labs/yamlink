'use strict';

const http = require('http');
const React = require('react');
const { URLSearchParams } = require('url');

/**
 * @typedef {{ host: string, port: number, path: string }} ApiRequestOptions
 * @typedef {{ host?: string, port?: number, type?: string }} GetNodesOptions
 * @typedef {{ host: string, port: number, query: string }} RunQueryOptions
 * @typedef {{ host: string, port: number, id: string, at?: string }} NodeRequestOptions
 * @typedef {{ host?: string, port?: number, done?: boolean, overdue?: boolean, today?: boolean, limit?: number }} TaskRequestOptions
 * @typedef {{ host?: string, port?: number, limit?: number, since?: string, type?: string, id?: string }} MutationRequestOptions
 * @typedef {{ host: string, port: number, onEvent: (payload: any) => void, onConnect?: () => void, onDisconnect?: () => void }} EventStreamOptions
 */

/**
 * @param {ApiRequestOptions} options
 * @returns {Promise<any>}
 */
function requestJson({ host, port, path }) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host,
            port,
            path,
            method: 'GET',
            headers: { Accept: 'application/json' }
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(body || `HTTP ${res.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(body || '{}'));
                } catch (error) {
                    reject(error);
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * @param {GetNodesOptions & { at?: string }} [options]
 * @returns {Promise<any[]>}
 */
function getNodes({ host, port, type, at } = {}) {
    const params = new URLSearchParams();
    if (type && type !== 'any') params.set('type', type);
    if (at) params.set('at', at);
    const query = params.toString();
    const path = query ? `/api/nodes?${query}` : '/api/nodes';
    return requestJson({ host, port, path }).then((body) => {
        if (Array.isArray(body)) return body;
        if (Array.isArray(body?.nodes)) return body.nodes;
        return [];
    });
}

/**
 * @param {RunQueryOptions} options
 * @returns {Promise<any>}
 */
function runQuery({ host, port, query }) {
    return requestJson({ host, port, path: `/api/query?q=${encodeURIComponent(query)}` });
}

/**
 * @param {{ host: string, port: number, at?: string }} options
 * @returns {Promise<{nodes: any[], edges: any[], stats: Record<string, any>}>}
 */
function getGraph({ host, port, at }) {
    const path = at ? `/api/graph?at=${encodeURIComponent(at)}` : '/api/graph';
    return requestJson({ host, port, path }).then((body) => ({
        nodes: Array.isArray(body?.nodes) ? body.nodes : [],
        edges: Array.isArray(body?.edges) ? body.edges : [],
        stats: body?.stats || { nodes: 0, edges: 0, types: 0 }
    }));
}

/**
 * Checkpoint series for the timeline scrubber — evenly-spaced reconstructed
 * graph snapshots between `since` and `until`, built on the same Time Engine
 * primitives getGraph's `at` param uses for a single point.
 * @param {{ host: string, port: number, since: string, until?: string, points?: number }} options
 * @returns {Promise<{ since: string, until: string, points: number, snapshots: Array<{ timestamp: string, nodes: any[], edges: any[], stats: Record<string, any> }> }>}
 */
function getGraphHistory({ host, port, since, until, points }) {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    if (until) params.set('until', until);
    if (points) params.set('points', String(points));
    return requestJson({ host, port, path: `/api/graph/history?${params.toString()}` }).then((body) => ({
        since: body?.since || since,
        until: body?.until || until,
        points: body?.points || points,
        snapshots: Array.isArray(body?.snapshots) ? body.snapshots : []
    }));
}

/**
 * @param {{ host: string, port: number }} options
 * @returns {Promise<any[]>}
 */
function getTypes({ host, port }) {
    return requestJson({ host, port, path: '/api/types' }).then((body) => {
        if (Array.isArray(body)) return body;
        if (Array.isArray(body?.types)) return body.types;
        return [];
    });
}

/**
 * @param {{ host: string, port: number }} options
 * @returns {Promise<any>}
 */
function getHealth({ host, port }) {
    return requestJson({ host, port, path: '/api/health' });
}

/**
 * @param {{ host: string, port: number }} options
 * @returns {Promise<any>}
 */
function getTrends({ host, port }) {
    return requestJson({ host, port, path: '/api/intelligence/trends' });
}

/**
 * @param {TaskRequestOptions} [options]
 * @returns {Promise<any[]>}
 */
function getTasks({ host, port, done, overdue, today, limit } = {}) {
    const params = new URLSearchParams();
    if (done !== undefined) params.set('done', String(done));
    if (overdue) params.set('overdue', 'true');
    if (today) params.set('today', 'true');
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return requestJson({ host, port, path: `/api/tasks${qs ? '?' + qs : ''}` }).then((body) => {
        if (Array.isArray(body)) return body;
        if (Array.isArray(body?.tasks)) return body.tasks;
        return [];
    });
}

/**
 * @param {MutationRequestOptions} [options]
 * @returns {Promise<any[]>}
 */
function getMutations({ host, port, limit = 8, since, type, id } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (since) params.set('since', since);
    if (type) params.set('type', type);
    if (id) params.set('id', id);
    return requestJson({ host, port, path: `/api/mutations?${params.toString()}` }).then((body) => {
        if (Array.isArray(body)) return body;
        if (Array.isArray(body?.events)) return body.events;
        return [];
    });
}

/**
 * @param {{ host: string, port: number, query: string, limit?: number }} options
 * @returns {Promise<any[]>}
 */
function runSearch({ host, port, query, limit = 50 }) {
    return requestJson({ host, port, path: `/api/search?q=${encodeURIComponent(query)}&limit=${limit}` }).then((body) => {
        if (Array.isArray(body)) return body;
        if (Array.isArray(body?.results)) return body.results;
        return [];
    });
}

/**
 * @param {NodeRequestOptions & { include?: string }} options
 * @returns {Promise<any>}
 */
function getNode({ host, port, id, include, at }) {
    // Without `include`, /api/nodes/:id's `_outbound`/`_inbound` are bare
    // {field, to}/{field, from} — no `toType`/`toName` at all. Callers that
    // need real per-edge type/name info (colored graph rendering, type
    // summaries) must opt in explicitly; other callers get the exact same
    // response shape as before this parameter existed.
    const params = new URLSearchParams();
    if (include) params.set('include', include);
    if (at) params.set('at', at);
    const query = params.toString();
    return requestJson({ host, port, path: `/api/nodes/${encodeURIComponent(id)}${query ? '?' + query : ''}` });
}

/**
 * @param {NodeRequestOptions} options
 * @returns {Promise<any>}
 */
function getNoteIntelligence({ host, port, id }) {
    return requestJson({ host, port, path: `/api/intelligence/note?id=${encodeURIComponent(id)}` });
}

/**
 * @param {{ host: string, port: number, id: string, depth?: number }} options
 * @returns {Promise<{ id: string, depth: number, nodes: any[], edges: any[] }>}
 */
function getNeighborhood({ host, port, id, depth = 2 }) {
    return requestJson({ host, port, path: `/api/nodes/${encodeURIComponent(id)}/neighborhood?depth=${depth}` });
}

/**
 * @param {{ host: string, port: number }} options
 * @returns {Promise<{ clusters: any[] }>}
 */
function getClusters({ host, port }) {
    return requestJson({ host, port, path: '/api/intelligence/clusters' })
        .then((body) => ({ clusters: Array.isArray(body?.clusters) ? body.clusters : [] }));
}

/**
 * Returns null gracefully when the endpoint does not exist yet.
 * @param {{ host: string, port: number }} options
 * @returns {Promise<any|null>}
 */
function getPressure({ host, port }) {
    return requestJson({ host, port, path: '/api/intelligence/pressure' }).catch(() => null);
}

/**
 * @param {{ host?: string, port?: number, since?: string, from?: string, to?: string }} [options]
 * @returns {Promise<any>}
 */
function getDiff({ host, port, since, from, to } = {}) {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return requestJson({ host, port, path: `/api/diff?${params.toString()}` });
}

/**
 * @param {{ host: string, port: number, path: string, method: string, body: any }} options
 * @returns {Promise<any>}
 */
function requestJsonWithBody({ host, port, path, method, body }) {
    return new Promise((resolve, reject) => {
        const encoded = JSON.stringify(body);
        const req = http.request({
            host, port, path, method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(encoded),
                'X-Yamlink-Source': 'conduit'
            }
        }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(data || `HTTP ${res.statusCode}`));
                    return;
                }
                try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve({}); }
            });
        });
        req.on('error', reject);
        req.write(encoded);
        req.end();
    });
}

/**
 * @param {{ host: string, port: number, id: string, fields: Record<string, any> }} options
 * @returns {Promise<any>}
 */
function patchNode({ host, port, id, fields }) {
    return requestJsonWithBody({ host, port, path: `/api/nodes/${encodeURIComponent(id)}`, method: 'PATCH', body: fields });
}

/**
 * @param {{ host: string, port: number, updates: { id: string, fields: Record<string, any> }[] }} options
 * @returns {Promise<any>}
 */
function patchNodesBulk({ host, port, updates }) {
    return requestJsonWithBody({
        host,
        port,
        path: '/api/nodes/bulk',
        method: 'PATCH',
        body: { updates }
    });
}

/**
 * @param {{ host: string, port: number, fields: Record<string, any> }} options
 * @returns {Promise<any>}
 */
function postNode({ host, port, fields }) {
    return requestJsonWithBody({ host, port, path: '/api/nodes', method: 'POST', body: fields });
}

/**
 * @param {{ host: string, port: number, id: string, force?: boolean }} options
 * @returns {Promise<any>}
 */
function deleteNode({ host, port, id, force }) {
    return new Promise((resolve, reject) => {
        const suffix = force ? '?force=true' : '';
        const req = http.request({
            host, port,
            path: `/api/nodes/${encodeURIComponent(id)}${suffix}`,
            method: 'DELETE',
            headers: { 'X-Yamlink-Source': 'conduit' }
        }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    try {
                        const body = JSON.parse(data || '{}');
                        /** @type {Error & { code?: string, dependencies?: any }} */
                        const error = new Error(body.error || `HTTP ${res.statusCode}`);
                        error.code = body.code;
                        error.dependencies = body.dependencies;
                        reject(error);
                    } catch (_) {
                        reject(new Error(data || `HTTP ${res.statusCode}`));
                    }
                    return;
                }
                try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve({}); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

const SSE_BACKOFF_MIN = 1000;
const SSE_BACKOFF_MAX = 30000;

/**
 * @param {EventStreamOptions} options
 * @returns {void}
 */
function useEventStream({ host, port, onEvent, onConnect, onDisconnect }) {
    const onEventRef = React.useRef(onEvent);
    const onConnectRef = React.useRef(onConnect);
    const onDisconnectRef = React.useRef(onDisconnect);
    onEventRef.current = onEvent;
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;

    React.useEffect(() => {
        let disposed = false;
        let reconnectTimer = null;
        let req = null;
        let res = null;
        let buffer = '';
        let backoff = SSE_BACKOFF_MIN;
        let everConnected = false;

        const scheduleReconnect = () => {
            if (disposed) return;
            if (everConnected && onDisconnectRef.current) onDisconnectRef.current();
            reconnectTimer = setTimeout(connect, backoff);
            backoff = Math.min(backoff * 2, SSE_BACKOFF_MAX);
        };

        const flushBuffer = () => {
            const chunks = buffer.split('\n\n');
            buffer = chunks.pop() || '';
            for (const chunk of chunks) {
                const dataLines = chunk
                    .split(/\r?\n/)
                    .filter((line) => line.startsWith('data:'))
                    .map((line) => line.slice(5).trim());
                if (!dataLines.length) continue;
                try {
                    const payload = JSON.parse(dataLines.join('\n'));
                    if (onEventRef.current) onEventRef.current(payload);
                } catch (_) {
                    continue;
                }
            }
        };

        const cleanupConnection = () => {
            if (res && !res.destroyed) res.destroy();
            if (req) req.destroy();
            res = null;
            req = null;
            buffer = '';
        };

        const connect = () => {
            if (disposed) return;
            req = http.request({
                host,
                port,
                path: '/api/events',
                method: 'GET',
                headers: { Accept: 'text/event-stream' }
            }, (response) => {
                res = response;
                // Reset backoff on successful connection
                backoff = SSE_BACKOFF_MIN;
                if (!everConnected) {
                    everConnected = true;
                    if (onConnectRef.current) onConnectRef.current();
                } else {
                    if (onConnectRef.current) onConnectRef.current();
                }
                response.setEncoding('utf8');
                response.on('data', (chunk) => {
                    buffer += chunk;
                    flushBuffer();
                });
                response.on('end', () => {
                    cleanupConnection();
                    scheduleReconnect();
                });
                response.on('error', () => {
                    cleanupConnection();
                    scheduleReconnect();
                });
            });

            req.on('error', () => {
                cleanupConnection();
                scheduleReconnect();
            });
            req.end();
        };

        connect();

        return () => {
            disposed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            cleanupConnection();
        };
    }, [host, port]);
}

module.exports = {
    getNodes,
    getNode,
    runQuery,
    runSearch,
    getGraph,
    getGraphHistory,
    getTypes,
    getHealth,
    getTrends,
    getTasks,
    getMutations,
    getNoteIntelligence,
    getNeighborhood,
    getClusters,
    getPressure,
    getDiff,
    patchNode,
    patchNodesBulk,
    postNode,
    deleteNode,
    useEventStream
};
