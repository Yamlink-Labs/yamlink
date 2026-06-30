'use strict';

const { URL } = require('url');

const { CORS_HEADERS, notFound } = require('./http');
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
const { handleArc, handleFieldCategory, handleNoteIntelligence, handleClusters } = require('./handlers/intelligence');
const { handleOutbound, handleInbound, handleNeighborhood } = require('./handlers/graph-traversal');
const { handleNodeHistory, handleNodeEvolution, handleNodeArchaeology, handleVaultLenses, handleSessionSummary } = require('./handlers/history');
const { handleSchema } = require('./handlers/schema');
const { handleSearch } = require('./handlers/search');
const { handleDiff } = require('./handlers/diff');

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

        if (pathname === '/api/events') return handleEvents(req, res, context);
        if (pathname === '/api/nodes/bulk' && req.method === 'POST') return nodes.bulkCreate(req, res, context);
        if (pathname === '/api/nodes/bulk' && req.method === 'PATCH') return nodes.bulkUpdate(req, res, context);
        if (pathname === '/api/nodes') {
            if (req.method === 'GET') return nodes.listNodes(req, res, url);
            if (req.method === 'POST') return nodes.createNode(req, res, context);
        }

        const nodeMatch = pathname.match(/^\/api\/nodes\/([^/]+)$/);
        if (nodeMatch) {
            const id = decodeURIComponent(nodeMatch[1]);
            if (req.method === 'GET') return nodes.getNode(req, res, id, url, context);
            if (req.method === 'PATCH') return nodes.updateNode(req, res, id, context);
            if (req.method === 'DELETE') return nodes.deleteNode(req, res, id, context);
        }

        const nodeOutboundMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/outbound$/);
        if (nodeOutboundMatch) {
            return handleOutbound(req, res, decodeURIComponent(nodeOutboundMatch[1]));
        }

        const nodeInboundMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/inbound$/);
        if (nodeInboundMatch) {
            return handleInbound(req, res, decodeURIComponent(nodeInboundMatch[1]));
        }

        const nodeNeighborhoodMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/neighborhood$/);
        if (nodeNeighborhoodMatch) {
            return handleNeighborhood(req, res, decodeURIComponent(nodeNeighborhoodMatch[1]), url);
        }

        const nodeHistoryMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/history$/);
        if (nodeHistoryMatch) {
            return handleNodeHistory(req, res, decodeURIComponent(nodeHistoryMatch[1]));
        }

        const nodeEvolutionMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/evolution$/);
        if (nodeEvolutionMatch) {
            return handleNodeEvolution(req, res, decodeURIComponent(nodeEvolutionMatch[1]));
        }

        const nodeArchaeologyMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/archaeology$/);
        if (nodeArchaeologyMatch) {
            return handleNodeArchaeology(req, res, decodeURIComponent(nodeArchaeologyMatch[1]), url);
        }

        if (pathname === '/api/search') return handleSearch(req, res, url);
        if (pathname === '/api/schema') return handleSchema(req, res, url);
        if (pathname === '/api/session/summary') return handleSessionSummary(req, res, url);
        if (pathname === '/api/diff') return handleDiff(req, res, url);
        if (pathname === '/api/query') return handleQuery(req, res, url);
        if (pathname === '/api/graph') return handleGraph(req, res);
        if (pathname === '/api/types') return handleTypes(req, res);
        if (pathname === '/api/tasks') return handleTasks(req, res, url);
        if (pathname === '/api/mutations') return handleMutations(req, res, url, context);
        if (pathname === '/api/health') return handleHealth(req, res);
        if (pathname === '/api/intelligence/arc') return handleArc(req, res, url);
        if (pathname === '/api/intelligence/fieldCategory') return handleFieldCategory(req, res, url);
        if (pathname === '/api/intelligence/note') return handleNoteIntelligence(req, res, url);
        if (pathname === '/api/intelligence/clusters') return handleClusters(req, res);
        if (pathname === '/api/intelligence/lenses') return handleVaultLenses(req, res);

        notFound(res, 'Unknown endpoint: ' + pathname);
    };

    handleRequest.eventBus = eventBus;
    handleRequest.vaultService = vaultService;
    handleRequest.ready = ready;
    return handleRequest;
}

module.exports = { createRouter };
