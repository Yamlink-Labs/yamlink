'use strict';

const { URL } = require('url');

const { CORS_HEADERS, notFound, errorJson } = require('./http');

/**
 * Opt-in shared-secret auth: set YAMLINK_API_TOKEN before running
 * `yamlink serve` to require every request to carry a matching
 * `X-Yamlink-Token` header. Off by default — the API has no auth at all
 * otherwise, same as before this existed. This exists because CORS is
 * intentionally wide open (`Access-Control-Allow-Origin: *`, needed so
 * browser-based local tools on a different origin/port can talk to the
 * server) — without a token, any webpage open in the same browser could
 * read or write the vault through it. Checked here, not per-handler, so it
 * can never be forgotten on a new route.
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
function isAuthorized(req) {
    const requiredToken = process.env.YAMLINK_API_TOKEN;
    if (!requiredToken) return true;
    const providedToken = req.headers['x-yamlink-token'];
    return providedToken === requiredToken;
}
const { createEventBus } = require('./eventsBus');
const { VaultService } = require('../core/vaultService');
const { buildIndex } = require('../core/index');
const nodes = require('./handlers/nodes');
const { handleQuery } = require('./handlers/query');
const { handleGraph } = require('./handlers/graph');
const { handleTypes } = require('./handlers/types');
const { handleHealth } = require('./handlers/health');
const { handleTasks } = require('./handlers/tasks');
const { handleMutations } = require('./handlers/mutations');
const { handleEvents } = require('./handlers/events');
const { handleArc, handleFieldCategory, handleNoteIntelligence, handleClusters, handleTrends } = require('./handlers/intelligence');
const { handleOutbound, handleInbound, handleNeighborhood } = require('./handlers/graph-traversal');
const { handleNodeHistory, handleNodeEvolution, handleNodeArchaeology, handleVaultLenses, handleSessionSummary } = require('./handlers/history');
const { handleSchema } = require('./handlers/schema');
const { handleSearch } = require('./handlers/search');
const { handleDiff } = require('./handlers/diff');
const { handleGlossary } = require('./handlers/glossary');

/**
 * Declarative route table. Each entry is tried in order; the first entry whose
 * path pattern AND method match wins. `method: 'ANY'` means the router doesn't
 * gate on method at all — the handler itself checks `req.method` and answers
 * 405 (this is the convention nearly every handler in `./handlers/` already
 * follows). Entries with an explicit method are for paths that dispatch to a
 * *different handler function* per method (e.g. GET/PATCH/DELETE on the same
 * `/api/nodes/:id`) — order among same-path entries doesn't matter since each
 * only matches its own method, but more specific *paths* (`/api/nodes/bulk`)
 * must still be listed before more general ones (`/api/nodes/:id`) that would
 * otherwise also match them.
 *
 * @typedef {{ method: string, path: string, handler: (req: import('http').IncomingMessage, res: import('http').ServerResponse, params: Record<string,string>, url: URL, context: object) => any }} RouteDef
 * @type {RouteDef[]}
 */
const routeDefs = [
    { method: 'ANY', path: '/api/events', handler: (req, res, _p, _url, context) => handleEvents(req, res, context) },

    { method: 'POST', path: '/api/nodes/bulk', handler: (req, res, _p, _url, context) => nodes.bulkCreate(req, res, context) },
    { method: 'PATCH', path: '/api/nodes/bulk', handler: (req, res, _p, _url, context) => nodes.bulkUpdate(req, res, context) },

    { method: 'GET', path: '/api/nodes', handler: (req, res, _p, url) => nodes.listNodes(req, res, url) },
    { method: 'POST', path: '/api/nodes', handler: (req, res, _p, _url, context) => nodes.createNode(req, res, context) },

    { method: 'GET', path: '/api/nodes/:id', handler: (req, res, p, url, context) => nodes.getNode(req, res, p.id, url, context) },
    { method: 'PATCH', path: '/api/nodes/:id', handler: (req, res, p, _url, context) => nodes.updateNode(req, res, p.id, context) },
    { method: 'DELETE', path: '/api/nodes/:id', handler: (req, res, p, _url, context) => nodes.deleteNode(req, res, p.id, context) },

    { method: 'ANY', path: '/api/nodes/:id/outbound', handler: (req, res, p) => handleOutbound(req, res, p.id) },
    { method: 'ANY', path: '/api/nodes/:id/inbound', handler: (req, res, p) => handleInbound(req, res, p.id) },
    { method: 'ANY', path: '/api/nodes/:id/neighborhood', handler: (req, res, p, url) => handleNeighborhood(req, res, p.id, url) },
    { method: 'ANY', path: '/api/nodes/:id/history', handler: (req, res, p) => handleNodeHistory(req, res, p.id) },
    { method: 'ANY', path: '/api/nodes/:id/evolution', handler: (req, res, p) => handleNodeEvolution(req, res, p.id) },
    { method: 'ANY', path: '/api/nodes/:id/archaeology', handler: (req, res, p, url) => handleNodeArchaeology(req, res, p.id, url) },

    { method: 'ANY', path: '/api/search', handler: (req, res, _p, url) => handleSearch(req, res, url) },
    { method: 'ANY', path: '/api/schema', handler: (req, res, _p, url) => handleSchema(req, res, url) },
    { method: 'ANY', path: '/api/session/summary', handler: (req, res, _p, url) => handleSessionSummary(req, res, url) },
    { method: 'ANY', path: '/api/diff', handler: (req, res, _p, url) => handleDiff(req, res, url) },
    { method: 'ANY', path: '/api/query', handler: (req, res, _p, url) => handleQuery(req, res, url) },
    { method: 'ANY', path: '/api/graph', handler: (req, res, _p, url) => handleGraph(req, res, url) },
    { method: 'ANY', path: '/api/types', handler: (req, res) => handleTypes(req, res) },
    { method: 'ANY', path: '/api/tasks', handler: (req, res, _p, url, context) => handleTasks(req, res, url, context) },
    { method: 'ANY', path: '/api/mutations', handler: (req, res, _p, url, context) => handleMutations(req, res, url, context) },
    { method: 'ANY', path: '/api/health', handler: (req, res, _p, _url, context) => handleHealth(req, res, context) },
    { method: 'ANY', path: '/api/intelligence/arc', handler: (req, res, _p, url) => handleArc(req, res, url) },
    { method: 'ANY', path: '/api/intelligence/fieldCategory', handler: (req, res, _p, url) => handleFieldCategory(req, res, url) },
    { method: 'ANY', path: '/api/intelligence/note', handler: (req, res, _p, url) => handleNoteIntelligence(req, res, url) },
    { method: 'ANY', path: '/api/intelligence/clusters', handler: (req, res) => handleClusters(req, res) },
    { method: 'ANY', path: '/api/intelligence/trends', handler: (req, res) => handleTrends(req, res) },
    { method: 'ANY', path: '/api/intelligence/lenses', handler: (req, res) => handleVaultLenses(req, res) },
    { method: 'ANY', path: '/api/glossary', handler: (req, res, _p, url) => handleGlossary(req, res, url) },
];

/**
 * Compiles a `/api/nodes/:id/outbound`-style path into a matching regex plus
 * the ordered list of named params it captures.
 * @param {string} path
 * @returns {{ regex: RegExp, paramNames: string[] }}
 */
function compilePath(path) {
    const paramNames = [];
    const pattern = path
        .split('/')
        .map((segment) => {
            if (segment.startsWith(':')) {
                paramNames.push(segment.slice(1));
                return '([^/]+)';
            }
            return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/');
    return { regex: new RegExp('^' + pattern + '$'), paramNames };
}

const compiledRoutes = routeDefs.map((route) => ({ ...route, ...compilePath(route.path) }));

function createRouter(vaultPath, workspaceFolders, _buildIndex = buildIndex, existingVaultService) {
    const vaultService = existingVaultService || new VaultService({
        buildIndex: _buildIndex,
        workspaceFolders
    });
    const ready = vaultService.initialize(vaultPath);
    const eventBus = createEventBus();
    vaultService.onRebuild((generation) => {
        eventBus.emitRebuild(generation);
    });
    const context = { vaultPath, workspaceFolders, eventBus, vaultService, ready };

    const handleRequest = async function(req, res) {
        await ready;
        const url = new URL(req.url, 'http://localhost');
        const pathname = url.pathname;

        if (req.method === 'OPTIONS') {
            res.writeHead(204, CORS_HEADERS);
            res.end();
            return;
        }

        if (!isAuthorized(req)) {
            errorJson(res, 'UNAUTHORIZED', 'Missing or invalid X-Yamlink-Token');
            return;
        }

        for (const route of compiledRoutes) {
            const match = pathname.match(route.regex);
            if (!match) continue;
            if (route.method !== 'ANY' && route.method !== req.method) continue;

            /** @type {Record<string, string>} */
            const params = {};
            route.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
            return route.handler(req, res, params, url, context);
        }

        notFound(res, 'Unknown endpoint: ' + pathname);
    };

    handleRequest.eventBus = eventBus;
    handleRequest.vaultService = vaultService;
    handleRequest.ready = ready;
    return handleRequest;
}

module.exports = { createRouter, compilePath, routeDefs };
