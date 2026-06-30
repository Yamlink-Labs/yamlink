'use strict';

const http = require('http');
const fs = require('fs');

const fmt = require('../format');
const { emitJson, emitCliError } = require('../io');
const { createRouter } = require('../../api/router');
const { writeFieldSync } = require('../../api/write');
const { errorJson } = require('../../api/http');
const { VaultService } = require('../../core/vaultService');
const { setDefaultMutationContextProvider } = require('../../runtime/mutationEventLog');

function buildServerSessionId() {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const nonce = Math.random().toString(36).slice(2, 8);
    return `srv-${stamp}-${nonce}`;
}

function buildEndpointSummary() {
    return {
        read: [
            '/api/nodes',
            '/api/nodes/:id',
            '/api/nodes/:id/outbound',
            '/api/nodes/:id/inbound',
            '/api/nodes/:id/neighborhood',
            '/api/nodes/:id/history',
            '/api/search',
            '/api/schema',
            '/api/diff',
            '/api/tasks',
            '/api/mutations',
            '/api/query',
            '/api/graph',
            '/api/types',
            '/api/health',
            '/api/intelligence/note',
            '/api/intelligence/arc',
            '/api/intelligence/fieldCategory',
            '/api/events'
        ],
        write: [
            '/api/nodes',
            '/api/nodes/bulk',
            '/api/nodes/:id',
            '/api/nodes/bulk',
            '/api/nodes/:id'
        ]
    };
}

async function run({ port, vaultPath, workspaceFolders, vaultService: existingVaultService, json, quiet }) {
    const vaultService = existingVaultService || new VaultService({ workspaceFolders });
    await vaultService.initialize(vaultPath);
    const handleRequest = createRouter(vaultPath, workspaceFolders, undefined, vaultService);
    const host = '127.0.0.1';

    // Inject a server-scoped session ID so all API-originated mutations are grouped
    // by serve instance. The VS Code extension overrides this with its own provider
    // when running in-process; this only fires for standalone `yamlink serve`.
    const serverSessionId = buildServerSessionId();
    setDefaultMutationContextProvider(() => ({ sessionId: serverSessionId, source: 'api' }));

    const server = http.createServer((req, res) => {
        Promise.resolve(handleRequest(req, res)).catch((error) => {
            try {
                errorJson(res, 'INTERNAL_ERROR', 'Internal server error', { detail: error.message });
            } catch (_) {}
        });
    });

    server.on('error', (error) => {
        emitCliError({
            json,
            error: 'Serve failed: ' + error.message,
            code: 'INTERNAL_ERROR',
            exitCode: 2,
            details: { host, port, vaultPath }
        });
    });

    server.listen(port, host, () => {
        const address = server.address();
        const actualPort = address && typeof address === 'object' ? address.port : port;
        if (json) {
            emitJson({
                ok: true,
                command: 'serve',
                host,
                port: actualPort,
                vaultPath,
                pid: process.pid,
                endpoints: buildEndpointSummary()
            });
            return;
        }

        if (quiet) return;

        fmt.header('Yamlink serve');
        fmt.row('Vault', vaultPath);
        fmt.row('Address', `http://${host}:${actualPort}`);
        fmt.blank();
        console.log('Read endpoints:');
        console.log('  GET    /api/nodes            ?type=&page=&limit=');
        console.log('  GET    /api/nodes/:id');
        console.log('  GET    /api/nodes/:id/outbound');
        console.log('  GET    /api/nodes/:id/inbound');
        console.log('  GET    /api/nodes/:id/neighborhood ?depth=');
        console.log('  GET    /api/nodes/:id/history');
        console.log('  GET    /api/search           ?q=&type=&field=&page=&limit=');
        console.log('  GET    /api/schema           ?type=&page=&limit=');
        console.log('  GET    /api/diff             ?from=<id>&to=<id> | ?since=<iso-date>');
        console.log('  GET    /api/tasks            ?done=&overdue=&today=&note=&limit=');
        console.log('  GET    /api/mutations        ?limit=&since=&type=');
        console.log('  GET    /api/query            ?q=<query>');
        console.log('  GET    /api/graph');
        console.log('  GET    /api/types');
        console.log('  GET    /api/health');
        console.log('  GET    /api/intelligence/note          ?id=<noteId>');
        console.log('  GET    /api/intelligence/arc           ?id=<noteId> | ?type=<noteType>');
        console.log('  GET    /api/intelligence/fieldCategory ?id=<noteId>&field=<field>');
        console.log('  GET    /api/events           SSE — live mutation + rebuild stream');
        fmt.blank();
        console.log('Write endpoints:');
        console.log('  POST   /api/nodes            { type, fields? }');
        console.log('  POST   /api/nodes/bulk       { notes: [{ type, fields? }, ...] }');
        console.log('  PATCH  /api/nodes/:id        { field, value } | { fields: { ... } }');
        console.log('  PATCH  /api/nodes/bulk       { updates: [{ id, fields }, ...] }');
        console.log('  DELETE /api/nodes/:id');
        fmt.blank();
        console.log('Press Ctrl+C to stop.');
        fmt.blank();
    });

    let watcher = null;
    try {
        watcher = fs.watch(vaultPath, { recursive: true }, (_eventType, filename) => {
            if (!filename || !filename.endsWith('.md')) return;
            vaultService.notifyFileChange();
        });
    } catch (_) {}

    process.on('SIGINT', () => {
        if (watcher && typeof watcher.close === 'function') watcher.close();
        server.close(() => process.exit(0));
    });
}

/**
 * Start the API server programmatically and return a close handle.
 * Used by `yamlink` (no-args) / `yamlink conduit` when no server is already running.
 * Does not print anything and does not register SIGINT — caller owns teardown.
 *
 * @param {{ port: number, vaultPath: string, workspaceFolders: object[] }} opts
 * @returns {Promise<{ host: string, port: number, close(): Promise<void> }>}
 */
async function startServer({ port, vaultPath, workspaceFolders }) {
    const vaultSvc = new VaultService({ workspaceFolders });
    await vaultSvc.initialize(vaultPath);
    const handleRequest = createRouter(vaultPath, workspaceFolders, undefined, vaultSvc);
    const host = '127.0.0.1';

    const serverSessionId = buildServerSessionId();
    setDefaultMutationContextProvider(() => ({ sessionId: serverSessionId, source: 'api' }));

    const server = http.createServer((req, res) => {
        Promise.resolve(handleRequest(req, res)).catch((error) => {
            try {
                errorJson(res, 'INTERNAL_ERROR', 'Internal server error', { detail: error.message });
            } catch (_) {}
        });
    });

    let watcher = null;
    try {
        watcher = fs.watch(vaultPath, { recursive: true }, (_eventType, filename) => {
            if (!filename || !filename.endsWith('.md')) return;
            vaultSvc.notifyFileChange();
        });
    } catch (_) {}

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
    });

    const address = server.address();
    const actualPort = address && typeof address === 'object' ? address.port : port;

    return {
        host,
        port: actualPort,
        close() {
            if (watcher && typeof watcher.close === 'function') watcher.close();
            return new Promise((resolve) => server.close(resolve));
        }
    };
}

module.exports = { run, startServer, createRouter, writeFieldSync };
