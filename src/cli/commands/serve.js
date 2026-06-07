'use strict';

const http    = require('http');
const { URL } = require('url');
const fs      = require('fs');

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getEdges, getBacklinks }   = require('../../core/graph');
const { getRegistry }              = require('../../registries/typeRegistry');
const { parseViewQuery, runQuery } = require('../../engine/query');
const fmt = require('../format');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function json(res, data, status = 200) {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(body);
}

function notFound(res, msg) {
    json(res, { error: msg }, 404);
}

function badRequest(res, msg) {
    json(res, { error: msg }, 400);
}

/** @returns {Array<{id: string, type?: string, [key: string]: any}>} */
function allNodes() {
    const idIndex    = getIndex();
    const fieldsCache = getFieldsCache();
    const nodes = [];
    for (const [id] of idIndex) {
        const fields = fieldsCache.get(id) || {};
        nodes.push({ id, ...Object.fromEntries(Object.entries(fields).filter(([k]) => !k.startsWith('__'))) });
    }
    return nodes;
}

function handleRequest(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    if (req.method !== 'GET') {
        json(res, { error: 'Method not allowed' }, 405);
        return;
    }

    // GET /api/nodes
    if (pathname === '/api/nodes') {
        const type = url.searchParams.get('type');
        let nodes = allNodes();
        if (type) nodes = nodes.filter(n => (n.type || '').toLowerCase() === type.toLowerCase());
        json(res, nodes);
        return;
    }

    // GET /api/nodes/:id
    const nodeMatch = pathname.match(/^\/api\/nodes\/([^/]+)$/);
    if (nodeMatch) {
        const id = decodeURIComponent(nodeMatch[1]);
        const idIndex    = getIndex();
        const fieldsCache = getFieldsCache();
        if (!idIndex.has(id)) { notFound(res, 'Note not found: ' + id); return; }
        const fields = fieldsCache.get(id) || {};
        const outbound = (getEdges(id) || []).map(e => ({ field: e.field, to: e.targetId }));
        const inbound  = (getBacklinks(id) || []).map(e => ({ field: e.field, from: e.sourceId }));
        json(res, {
            id,
            ...Object.fromEntries(Object.entries(fields).filter(([k]) => !k.startsWith('__'))),
            _outbound: outbound,
            _inbound:  inbound,
        });
        return;
    }

    // GET /api/query?q=<query>
    if (pathname === '/api/query') {
        const q = url.searchParams.get('q');
        if (!q) { badRequest(res, 'Missing query parameter: q'); return; }
        let text = q.trim();
        if (!text.startsWith('!view ')) text = '!view * ' + text;
        const parsed = parseViewQuery(text);
        if (!parsed) { badRequest(res, 'Could not parse query: ' + q); return; }
        const result = runQuery(parsed, new Date().toISOString().slice(0, 10));
        if (!result?.success) { badRequest(res, 'Query failed'); return; }
        json(res, { query: q, count: result.rows.length, rows: result.rows, columns: result.columns });
        return;
    }

    // GET /api/graph
    if (pathname === '/api/graph') {
        const idIndex = getIndex();
        const fieldsCache = getFieldsCache();
        const nodes = [];
        const edges = [];
        for (const [id] of idIndex) {
            const fields = fieldsCache.get(id) || {};
            nodes.push({ id, type: fields.type || null });
            for (const e of getEdges(id) || []) {
                edges.push({ from: id, to: e.targetId, field: e.field });
            }
        }
        json(res, { nodes, edges });
        return;
    }

    // GET /api/types
    if (pathname === '/api/types') {
        const reg = getRegistry();
        const types = [];
        for (const [type, ids] of reg) {
            types.push({ type, count: ids.size });
        }
        json(res, types.sort((a, b) => b.count - a.count));
        return;
    }

    // GET /api/health
    if (pathname === '/api/health') {
        const idIndex    = getIndex();
        const fieldsCache = getFieldsCache();
        const reg        = getRegistry();
        const { buildSchemaIntelligence } = require('../../features/health/healthStats');
        const intel = buildSchemaIntelligence(idIndex, fieldsCache, reg);
        let brokenLinks = 0;
        for (const [id] of idIndex) {
            for (const edge of getEdges(id) || []) {
                if (!idIndex.has(edge.targetId)) brokenLinks++;
            }
        }
        json(res, { notes: idIndex.size, brokenLinks, schemaIntelligence: intel });
        return;
    }

    notFound(res, 'Unknown endpoint: ' + pathname);
}

function run({ port, vaultPath, workspaceFolders }) {
    const server = http.createServer(handleRequest);
    server.listen(port, '127.0.0.1', () => {
        fmt.header('Yamlink serve');
        fmt.row('Vault',   vaultPath);
        fmt.row('Address', 'http://127.0.0.1:' + port);
        fmt.blank();
        console.log('Endpoints:');
        console.log('  GET /api/nodes');
        console.log('  GET /api/nodes/:id');
        console.log('  GET /api/query?q=<query>');
        console.log('  GET /api/graph');
        console.log('  GET /api/types');
        console.log('  GET /api/health');
        fmt.blank();
        console.log('Press Ctrl+C to stop.');
        fmt.blank();
    });

    // File watch — rebuild index on .md changes
    let rebuildTimer = null;
    const { buildIndex } = require('../../core/index');
    try {
        fs.watch(vaultPath, { recursive: true }, (eventType, filename) => {
            if (!filename || !filename.endsWith('.md')) return;
            clearTimeout(rebuildTimer);
            rebuildTimer = setTimeout(() => {
                try {
                    buildIndex(workspaceFolders);
                    process.stderr.write('[yamlink] Index rebuilt\n');
                } catch (_) {}
            }, 400);
        });
    } catch (_) {}
}

module.exports = { run };
