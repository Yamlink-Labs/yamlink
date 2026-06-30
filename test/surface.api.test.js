'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildIndex } = require('../src/core/index');
const { createRouter } = require('../src/cli/commands/serve');
const { initMutationLog } = require('../src/runtime/mutationEventLog');
const { createVault } = require('./lib/vaultSim');

const FIXTURE = {
    'johnny-rico.md': [
        '---',
        'id: johnny-rico',
        'type: contact',
        'name: Johnny Rico',
        'unit: "[[roughnecks]]"',
        'status: active',
        '---',
        '',
        '- [ ] Submit mission report',
        '- [x] File debrief paperwork',
        '- [ ] Review roster',
    ].join('\n'),

    'carl-jenkins.md': [
        '---',
        'id: carl-jenkins',
        'type: contact',
        'name: Carl Jenkins',
        'unit: "[[roughnecks]]"',
        '---',
    ].join('\n'),

    'roughnecks.md': [
        '---',
        'id: roughnecks',
        'type: unit',
        'name: Roughnecks',
        '---',
    ].join('\n'),

    'broken-link.md': [
        '---',
        'id: broken-link',
        'type: contact',
        'name: Ghost Contact',
        'unit: "[[nonexistent-unit]]"',
        '---',
    ].join('\n'),
};

let vault;
let server;
let port;
let handler;

before(async () => {
    vault = createVault(FIXTURE);
    const vaultPath = vault.dir;
    fs.mkdirSync(path.join(vaultPath, '.yamlink'), { recursive: true });
    initMutationLog(path.join(vaultPath, '.yamlink', 'mutation-log.ndjson'));
    const workspaceFolders = [{ uri: { fsPath: vaultPath }, name: 'fixture' }];
    handler = createRouter(vaultPath, workspaceFolders, buildIndex);
    server = http.createServer((req, res) => {
        Promise.resolve(handler(req, res)).catch((error) => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
    vault.destroy();
});

function get(urlPath) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: urlPath, headers: { Accept: 'application/json' } }, (res) => {
            let raw = '';
            res.on('data', (chunk) => { raw += chunk; });
            res.on('end', () => {
                let body;
                try { body = JSON.parse(raw); } catch (_) { body = raw; }
                resolve({ status: res.statusCode, headers: res.headers, body });
            });
        }).on('error', reject);
    });
}

function request(method, urlPath, bodyObj, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = bodyObj ? JSON.stringify(bodyObj) : '';
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: urlPath,
            method,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers }
        }, (res) => {
            let raw = '';
            res.on('data', (chunk) => { raw += chunk; });
            res.on('end', () => {
                let body;
                try { body = JSON.parse(raw); } catch (_) { body = raw; }
                resolve({ status: res.statusCode, headers: res.headers, body });
            });
        });
        req.on('error', reject);
        req.end(payload);
    });
}

function requestRaw(method, urlPath, payload, headers = {}) {
    return new Promise((resolve, reject) => {
        const body = String(payload || '');
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: urlPath,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                ...headers
            }
        }, (res) => {
            let raw = '';
            res.on('data', (chunk) => { raw += chunk; });
            res.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(raw); } catch (_) { parsed = raw; }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });
        req.on('error', reject);
        req.end(body);
    });
}

function collectSseEvents(urlPath, onConnected, durationMs = 500) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: urlPath,
            method: 'GET',
            headers: { Accept: 'text/event-stream' }
        }, (res) => {
            const events = [];
            let buffer = '';
            let started = false;
            let settled = false;
            const timer = setTimeout(() => {
                settled = true;
                res.destroy();
                resolve(events);
            }, durationMs);

            res.on('data', (chunk) => {
                buffer += String(chunk);
                const messages = buffer.split('\n\n');
                buffer = messages.pop() || '';
                for (const message of messages) {
                    const match = message.match(/data:\s*(.+)$/m);
                    if (!match) continue;
                    let payload = null;
                    try { payload = JSON.parse(match[1]); } catch (_) { continue; }
                    events.push(payload);
                    if (payload.type === 'connected' && !started) {
                        started = true;
                        Promise.resolve(onConnected ? onConnected() : null).catch((error) => {
                            if (settled) return;
                            clearTimeout(timer);
                            settled = true;
                            res.destroy();
                            reject(error);
                        });
                    }
                }
            });

            res.on('close', () => {
                if (settled) return;
                clearTimeout(timer);
                settled = true;
                resolve(events);
            });
        });
        req.on('error', reject);
        req.end();
    });
}

test('GET /api/nodes — list shape', async () => {
    const response = await get('/api/nodes');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.nodes));
    assert.equal(response.body.nodes.length, 4);
    assert.equal(response.body.meta.total, 4);
    assert.equal(response.body.meta.page, 1);
    assert.equal(response.body.meta.limit, 100);
    for (const entry of response.body.nodes) {
        assert.equal(typeof entry.id, 'string');
        assert.equal(typeof entry._filePath, 'string');
        assert.equal(path.extname(entry._filePath), '.md');
        assert.equal(Object.keys(entry).some((key) => key.startsWith('__')), false);
    }
    assert.match(response.headers['x-yamlink-generation'] || '', /^\d+$/);
});

test('GET /api/nodes?limit=2 — paginated shape', async () => {
    const response = await get('/api/nodes?limit=2');
    assert.equal(response.status, 200);
    assert.equal(Array.isArray(response.body.nodes), true);
    assert.equal(response.body.nodes.length, 2);
    assert.equal(response.body.meta.total, 4);
    assert.equal(response.body.meta.page, 1);
    assert.equal(response.body.meta.limit, 2);
    assert.equal(response.body.meta.pages, 2);
});

test('GET /api/nodes?limit=2&page=2 — second page', async () => {
    const response = await get('/api/nodes?limit=2&page=2');
    assert.equal(response.status, 200);
    assert.equal(Array.isArray(response.body.nodes), true);
    assert.equal(response.body.nodes.length, 2);
    assert.equal(response.body.meta.page, 2);
    assert.equal(response.body.meta.limit, 2);
});

test('GET /api/nodes without limit still returns paginated meta', async () => {
    const response = await get('/api/nodes');
    assert.equal(response.status, 200);
    assert.equal(Array.isArray(response.body.nodes), true);
    assert.equal(typeof response.body.meta, 'object');
});

test('GET /api/nodes?type=contact — type filter', async () => {
    const response = await get('/api/nodes?type=contact');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.nodes));
    assert.equal(response.body.nodes.length, 3);
    for (const entry of response.body.nodes) {
        assert.equal(entry.type, 'contact');
    }
});

test('GET /api/nodes/johnny-rico — single node detail', async () => {
    const response = await get('/api/nodes/johnny-rico');
    assert.equal(response.status, 200);
    assert.equal(response.body.id, 'johnny-rico');
    assert.equal(typeof response.body._filePath, 'string');
    assert.equal(path.extname(response.body._filePath), '.md');
    assert.ok(Array.isArray(response.body._outbound));
    assert.ok(response.body._outbound.some((entry) => entry.field === 'unit' && entry.to === 'roughnecks'));
    assert.ok(Array.isArray(response.body._inbound));
    assert.equal(Object.keys(response.body).some((key) => key.startsWith('__')), false);
});

test('GET /api/nodes/johnny-rico?minGeneration=0 resolves immediately', async () => {
    const started = Date.now();
    const response = await get('/api/nodes/johnny-rico?minGeneration=0');
    const elapsed = Date.now() - started;
    assert.equal(response.status, 200);
    assert.equal(response.body.id, 'johnny-rico');
    assert.ok(elapsed < 500);
});

test('GET /api/nodes/johnny-rico?minGeneration=<future> times out with current state', async () => {
    const currentGeneration = Number((await get('/api/nodes')).headers['x-yamlink-generation']);
    const started = Date.now();
    const response = await get(`/api/nodes/johnny-rico?minGeneration=${currentGeneration + 999}`);
    const elapsed = Date.now() - started;
    assert.equal(response.status, 200);
    assert.equal(response.body.id, 'johnny-rico');
    assert.ok(elapsed < 3500);
});

test('GET /api/nodes/johnny-rico?include=outbound,intelligence returns composite note payload', async () => {
    const response = await get('/api/nodes/johnny-rico?include=outbound,intelligence');
    assert.equal(response.status, 200);
    assert.equal(response.body.id, 'johnny-rico');
    assert.ok(Array.isArray(response.body._outbound));
    assert.ok(response.body._outbound.some((edge) => edge.field === 'unit' && edge.to === 'roughnecks' && edge.toType === 'unit'));
    assert.equal(typeof response.body._intelligence, 'object');
    assert.equal(response.body._intelligence.id, 'johnny-rico');
    assert.equal('_inbound' in response.body, false);
});

test('GET /api/nodes/johnny-rico?include=inbound,history returns filtered composite sections', async () => {
    await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'inactive' });
    const response = await get('/api/nodes/johnny-rico?include=inbound,history');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body._inbound));
    assert.ok(Array.isArray(response.body._history));
    assert.ok(response.body._inbound.every((edge) => typeof edge.field === 'string' && typeof edge.from === 'string'));
    assert.ok(Array.isArray(response.body._history));
    assert.ok(response.body._history.some((event) => event.type === 'field_changed' && event.noteId === 'johnny-rico'));
    assert.equal('_outbound' in response.body, false);
});

test('PATCH /api/nodes stamps sessionId from request header into mutation log', async () => {
    const response = await request(
        'PATCH',
        '/api/nodes/johnny-rico',
        { field: 'status', value: 'session-header-state' },
        { 'X-Yamlink-Session-Id': 'test-session-123', 'X-Yamlink-Source': 'conduit' }
    );
    assert.equal(response.status, 200);

    const history = await get('/api/nodes/johnny-rico/history');
    assert.equal(history.status, 200);
    assert.ok(history.body.events.some((event) => event.field === 'status' && event.sessionId === 'test-session-123' && event.source === 'conduit'));
});

test('GET /api/session/summary returns recent summary payload', async () => {
    await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'session-summary-recent' });
    const response = await get('/api/session/summary');
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.summary, 'object');
    assert.ok(Array.isArray(response.body.bursts));
    assert.ok(Array.isArray(response.body.events));
});

test('GET /api/nodes/:id/evolution returns note evolution summary', async () => {
    await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'evolution-a' });
    await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'evolution-b' });
    await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'evolution-c' });
    const response = await get('/api/nodes/johnny-rico/evolution');
    assert.equal(response.status, 200);
    assert.equal(response.body.noteId, 'johnny-rico');
    assert.ok(Array.isArray(response.body.unstableFields));
    assert.equal(typeof response.body.totalEdits, 'number');
});

test('GET /api/nodes/:id/archaeology?field=unit returns relation timeline', async () => {
    await request('PATCH', '/api/nodes/johnny-rico', { field: 'unit', value: '[[roughnecks]]' });
    await request('PATCH', '/api/nodes/johnny-rico', { field: 'unit', value: '[[nonexistent-unit]]' });
    const response = await get('/api/nodes/johnny-rico/archaeology?field=unit');
    assert.equal(response.status, 200);
    assert.equal(response.body.noteId, 'johnny-rico');
    assert.equal(response.body.field, 'unit');
    assert.ok(Array.isArray(response.body.targets));
    await request('PATCH', '/api/nodes/johnny-rico', { field: 'unit', value: '[[roughnecks]]' });
});

test('GET /api/intelligence/lenses returns vault-level change lenses', async () => {
    const response = await get('/api/intelligence/lenses');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.mostEdited));
    assert.ok(Array.isArray(response.body.fastestGrowingTypes));
    assert.ok(Array.isArray(response.body.unstableFields));
    assert.ok(Array.isArray(response.body.recurringPatterns));
});

test('GET /api/nodes/nonexistent-id — 404', async () => {
    const response = await get('/api/nodes/nonexistent-id');
    assert.equal(response.status, 404);
    assert.equal(typeof response.body.error, 'string');
    assert.equal(response.body.code, 'NOT_FOUND');
});

test('GET /api/graph — shape', async () => {
    const response = await get('/api/graph');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.nodes));
    assert.ok(Array.isArray(response.body.edges));
    assert.equal(typeof response.body.stats, 'object');
    assert.ok(response.body.nodes.length >= 4);
    assert.ok(response.body.edges.some((edge) => edge.from === 'johnny-rico' && edge.to === 'roughnecks'));
});

test('GET /api/nodes/johnny-rico/outbound — returns outbound traversal shape', async () => {
    const response = await get('/api/nodes/johnny-rico/outbound');
    assert.equal(response.status, 200);
    assert.equal(response.body.id, 'johnny-rico');
    assert.ok(Array.isArray(response.body.edges));
    assert.ok(response.body.edges.some((edge) => edge.field === 'unit' && edge.to === 'roughnecks' && edge.toType === 'unit' && edge.toName === 'Roughnecks'));
});

test('GET /api/nodes/roughnecks/inbound — returns inbound traversal shape', async () => {
    const response = await get('/api/nodes/roughnecks/inbound');
    assert.equal(response.status, 200);
    assert.equal(response.body.id, 'roughnecks');
    assert.ok(Array.isArray(response.body.edges));
    assert.ok(response.body.edges.some((edge) => edge.field === 'unit' && edge.from === 'johnny-rico' && edge.fromType === 'contact' && edge.fromName === 'Johnny Rico'));
});

test('GET /api/nodes/johnny-rico/neighborhood default depth 1 — returns subgraph', async () => {
    const response = await get('/api/nodes/johnny-rico/neighborhood');
    assert.equal(response.status, 200);
    assert.equal(response.body.id, 'johnny-rico');
    assert.equal(response.body.depth, 1);
    assert.ok(Array.isArray(response.body.nodes));
    assert.ok(Array.isArray(response.body.edges));
    assert.ok(response.body.nodes.some((node) => node.id === 'johnny-rico'));
    assert.ok(response.body.edges.some((edge) => edge.from === 'johnny-rico' && edge.to === 'roughnecks'));
});

test('GET /api/nodes/johnny-rico/neighborhood?depth=2 — reaches second hop neighbors', async () => {
    const response = await get('/api/nodes/johnny-rico/neighborhood?depth=2');
    assert.equal(response.status, 200);
    assert.equal(response.body.depth, 2);
    assert.ok(response.body.nodes.some((node) => node.id === 'carl-jenkins'));
});

test('GET /api/nodes/unknown-id/outbound — 404', async () => {
    const response = await get('/api/nodes/unknown-id/outbound');
    assert.equal(response.status, 404);
    assert.equal(response.body.code, 'NOT_FOUND');
});

test('GET /api/types — shape and sort', async () => {
    const response = await get('/api/types');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.types));
    response.body.types.forEach((entry) => {
        assert.equal(typeof entry.type, 'string');
        assert.equal(typeof entry.count, 'number');
    });
    const contact = response.body.types.find((entry) => entry.type === 'contact');
    assert.ok(contact);
    assert.equal(contact.count, 3);
    assert.ok(response.body.types.length < 2 || response.body.types[0].count >= response.body.types[1].count);
});

test('GET /api/search?q=rico — finds johnny-rico', async () => {
    const response = await get('/api/search?q=rico');
    assert.equal(response.status, 200);
    assert.equal(Array.isArray(response.body.results), true);
    assert.equal(typeof response.body.meta, 'object');
    assert.ok(response.body.results.some((entry) => entry.id === 'johnny-rico'));
    assert.ok(response.body.results.every((entry) => !('_outbound' in entry) && !('_inbound' in entry)));
});

test('GET /api/search?q=roughnecks&type=unit — type filter', async () => {
    const response = await get('/api/search?q=roughnecks&type=unit');
    assert.equal(response.status, 200);
    assert.equal(response.body.results.length, 1);
    assert.equal(response.body.results[0].id, 'roughnecks');
});

test('GET /api/search?q=o&page=2&limit=1 — paginated meta', async () => {
    const response = await get('/api/search?q=o&page=2&limit=1');
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.meta, 'object');
    assert.equal(response.body.meta.page, 2);
    assert.equal(response.body.meta.limit, 1);
    assert.ok(response.body.meta.total >= 2);
});

test('GET /api/search?q=o&limit=999 — enforces limit cap', async () => {
    const response = await get('/api/search?q=o&limit=999');
    assert.equal(response.status, 200);
    assert.equal(response.body.meta.limit, 200);
});

test('GET /api/search without q — 400', async () => {
    const response = await get('/api/search');
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'MISSING_PARAM');
});

test('GET /api/schema — returns paginated shape', async () => {
    const response = await get('/api/schema');
    assert.equal(response.status, 200);
    assert.equal(Array.isArray(response.body.schemas), true);
    assert.equal(typeof response.body.meta, 'object');
    for (const entry of response.body.schemas) {
        assert.equal(typeof entry.targetType, 'string');
        assert.ok(entry.schemaId === null || typeof entry.schemaId === 'string');
        assert.equal(typeof entry.fields, 'object');
    }
});

test('GET /api/schema?limit=999 — enforces limit cap', async () => {
    const response = await get('/api/schema?limit=999');
    assert.equal(response.status, 200);
    assert.equal(response.body.meta.limit, 100);
});

test('GET /api/diff?from=johnny-rico&to=carl-jenkins — returns field diff', async () => {
    const response = await get('/api/diff?from=johnny-rico&to=carl-jenkins');
    assert.equal(response.status, 200);
    assert.equal(response.body.from, 'johnny-rico');
    assert.equal(response.body.to, 'carl-jenkins');
    assert.equal(typeof response.body.added, 'object');
    assert.ok(Array.isArray(response.body.removed));
    assert.ok(Array.isArray(response.body.changed));
    assert.ok(response.body.removed.includes('status'));
});

test('GET /api/diff missing params returns 400', async () => {
    const response = await get('/api/diff?from=johnny-rico');
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'MISSING_PARAM');
});

test('GET /api/diff?since=<iso-date> returns field changes after the given time', async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const patched = await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'diff-since-active' });
    assert.equal(patched.status, 200);

    const response = await get(`/api/diff?since=${encodeURIComponent(since)}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.since, since);
    assert.equal(typeof response.body.count, 'number');
    assert.ok(Array.isArray(response.body.changes));
    const johnny = response.body.changes.find((entry) => entry.id === 'johnny-rico');
    assert.ok(johnny);
    assert.equal(johnny.type, 'contact');
    assert.equal(johnny.fields.status.to, 'diff-since-active');
});

test('GET /api/diff?since=<iso-date> can return an empty change set', async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    const response = await get(`/api/diff?since=${encodeURIComponent(future)}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.count, 0);
    assert.deepEqual(response.body.changes, []);
});

test('GET /api/health — shape', async () => {
    const response = await get('/api/health');
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.notes, 'number');
    assert.ok(response.body.notes >= 4);
    assert.equal(typeof response.body.brokenLinks, 'number');
    assert.ok(response.body.brokenLinks >= 1);
    assert.equal(typeof response.body.schemaIntelligence, 'object');
});

test('GET /api/tasks — all tasks', async () => {
    const response = await get('/api/tasks');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.tasks));
    assert.equal(typeof response.body.meta, 'object');
    assert.equal(response.body.tasks.filter((entry) => entry.noteId === 'johnny-rico' && entry.done === false).length, 2);
    assert.equal(response.body.tasks.filter((entry) => entry.noteId === 'johnny-rico' && entry.done === true).length, 1);
    for (const entry of response.body.tasks) {
        assert.equal(typeof entry.id, 'string');
        assert.equal(typeof entry.noteId, 'string');
        assert.equal(typeof entry.text, 'string');
        assert.equal(typeof entry.done, 'boolean');
        assert.equal(typeof entry.overdue, 'boolean');
        assert.equal(typeof entry.dueToday, 'boolean');
    }
});

test('GET /api/tasks?done=false — pending filter', async () => {
    const response = await get('/api/tasks?done=false');
    assert.equal(response.status, 200);
    assert.ok(response.body.tasks.every((entry) => entry.done === false));
});

test('GET /api/tasks?done=true — done filter', async () => {
    const response = await get('/api/tasks?done=true');
    assert.equal(response.status, 200);
    assert.ok(response.body.tasks.every((entry) => entry.done === true));
    assert.ok(response.body.tasks.length >= 1);
});

test('GET /api/tasks?note=johnny-rico — per-note filter', async () => {
    const response = await get('/api/tasks?note=johnny-rico');
    assert.equal(response.status, 200);
    assert.ok(response.body.tasks.every((entry) => entry.noteId === 'johnny-rico'));
});

test('GET /api/tasks?limit=1 — limit', async () => {
    const response = await get('/api/tasks?limit=1');
    assert.equal(response.status, 200);
    assert.equal(response.body.tasks.length, 1);
    assert.equal(response.body.meta.limit, 1);
});

test('GET /api/mutations — shape', async () => {
    const response = await get('/api/mutations');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.events));
    assert.equal(typeof response.body.meta, 'object');
    for (const entry of response.body.events) {
        assert.equal(typeof entry.type, 'string');
        assert.equal(typeof entry.timestamp, 'string');
    }
});

test('GET /api/mutations?limit=1', async () => {
    const response = await get('/api/mutations?limit=1');
    assert.equal(response.status, 200);
    assert.ok(response.body.events.length <= 1);
    assert.equal(response.body.meta.limit, 1);
});

test('GET /api/mutations?id=johnny-rico filters by note id', async () => {
    const response = await get('/api/mutations?id=johnny-rico');
    assert.equal(response.status, 200);
    assert.ok(response.body.events.every((event) => event.noteId === 'johnny-rico'));
});

test('GET /api/nodes/:id/history returns note-scoped mutation events', async () => {
    const patched = await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'history-check' });
    assert.equal(patched.status, 200);

    const response = await get('/api/nodes/johnny-rico/history');
    assert.equal(response.status, 200);
    assert.equal(response.body.id, 'johnny-rico');
    assert.ok(Array.isArray(response.body.events));
    assert.ok(response.body.events.some((event) => event.type === 'field_changed' && event.field === 'status'));
});

test('GET /api/nodes/:id/history returns 404 for unknown note', async () => {
    const response = await get('/api/nodes/no-such-note/history');
    assert.equal(response.status, 404);
    assert.equal(response.body.code, 'NOT_FOUND');
});

test('GET /api/query?q=where+type+%3D+contact+sort+name — query shape', async () => {
    const response = await get('/api/query?q=where+type+%3D+contact+sort+name');
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.query, 'string');
    assert.equal(typeof response.body.count, 'number');
    assert.equal(response.body.count, 3);
    assert.ok(Array.isArray(response.body.columns));
    assert.ok(Array.isArray(response.body.rows));
    assert.equal(response.body.rows.length, 3);
    for (const row of response.body.rows) {
        assert.equal(typeof row.id, 'string');
        assert.equal(typeof row.fields, 'object');
    }
});

test('GET /api/query?q=nonexistent+garbage — bad query', async () => {
    const response = await get('/api/query?q=nonexistent+garbage');
    assert.ok(response.status === 400 || response.status === 200);
    assert.equal(typeof response.body, 'object');
});

test('GET /api/events — SSE connect', async () => {
    await new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: '/api/events',
            method: 'GET',
            headers: { Accept: 'text/event-stream' }
        }, (res) => {
            assert.equal(res.statusCode, 200);
            assert.match(String(res.headers['content-type'] || ''), /text\/event-stream/);
            assert.equal(res.headers['x-yamlink-api-version'], '1');
            assert.match(String(res.headers['x-yamlink-generation'] || ''), /^\d+$/);
            res.once('data', (chunk) => {
                const text = String(chunk);
                assert.match(text, /"type":"connected"/);
                res.destroy();
                resolve();
            });
        });
        req.on('error', reject);
        req.end();
    });
});

test('GET /api/events + POST /api/nodes — emits note_created before rebuild flow', async () => {
    await new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: '/api/events',
            method: 'GET',
            headers: { Accept: 'text/event-stream' }
        }, (res) => {
            assert.equal(res.statusCode, 200);
            let buffer = '';
            let triggered = false;
            const timeout = setTimeout(() => {
                res.destroy();
                reject(new Error('Timed out waiting for note_created event'));
            }, 2000);

            res.on('data', (chunk) => {
                buffer += String(chunk);
                const messages = buffer.split('\n\n');
                buffer = messages.pop() || '';
                for (const message of messages) {
                    const match = message.match(/data:\s*(.+)$/m);
                    if (!match) continue;
                    let payload = null;
                    try { payload = JSON.parse(match[1]); } catch (_) { continue; }

                    if (payload.type === 'connected' && !triggered) {
                        triggered = true;
                        request('POST', '/api/nodes', { type: 'contact', fields: { name: 'Sse Probe' } }).catch(reject);
                    }

                    if (payload.type === 'note_created' && payload.id === 'sse-probe') {
                        clearTimeout(timeout);
                        res.destroy();
                        resolve();
                    }
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
});

test('POST /api/nodes — create note', async () => {
    const response = await request('POST', '/api/nodes', { type: 'unit', fields: { name: 'Delta Team' } });
    assert.equal(response.status, 201);
    assert.equal(response.body.ok, true);
    assert.equal(typeof response.body.id, 'string');
    assert.equal(typeof response.body.filePath, 'string');
    assert.equal(typeof response.body._generation, 'number');
    assert.ok(response.body._generation > 0);
    assert.equal(response.body.id, 'delta-team');
    const created = await get('/api/nodes/delta-team');
    assert.equal(created.status, 200);
});

test('POST /api/nodes — conflict', async () => {
    const response = await request('POST', '/api/nodes', { type: 'contact', fields: { name: 'Johnny Rico' } });
    assert.equal(response.status, 409);
    assert.equal(typeof response.body.error, 'string');
    assert.equal(response.body.code, 'CONFLICT');
});

test('POST /api/nodes with missing type returns 400 MISSING_PARAM', async () => {
    const response = await request('POST', '/api/nodes', { fields: { name: 'No Type' } });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'MISSING_PARAM');
});

test('POST /api/nodes with malformed JSON returns 400 INVALID_JSON', async () => {
    const response = await requestRaw('POST', '/api/nodes', '{"type":"contact","fields":');
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'INVALID_JSON');
});

test('POST /api/nodes duplicate id returns 409 CONFLICT', async () => {
    const first = await request('POST', '/api/nodes', {
        type: 'contact',
        fields: { id: 'duplicate-api-note', name: 'Duplicate API Note' }
    });
    assert.equal(first.status, 201);

    const second = await request('POST', '/api/nodes', {
        type: 'contact',
        fields: { id: 'duplicate-api-note', name: 'Duplicate API Note' }
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'CONFLICT');
});

test('POST /api/nodes writes note_created to mutation log with noteId', async () => {
    const response = await request('POST', '/api/nodes', {
        type: 'contact',
        fields: { id: 'mutation-created-note', name: 'Mutation Created Note' }
    });
    assert.equal(response.status, 201);

    const logPath = path.join(vault.dir, '.yamlink', 'mutation-log.ndjson');
    const content = fs.readFileSync(logPath, 'utf8');
    assert.match(content, /"type":"note_created"/);
    assert.match(content, /"noteId":"mutation-created-note"/);
    assert.match(content, /"source":"api"/);
    assert.match(content, /"cause":"api_create_node"/);
});

test('POST /api/nodes returns X-Yamlink-Generation header on 201', async () => {
    const response = await request('POST', '/api/nodes', {
        type: 'contact',
        fields: { id: 'header-created-note', name: 'Header Created Note' }
    });
    assert.equal(response.status, 201);
    assert.match(response.headers['x-yamlink-generation'] || '', /^\d+$/);
});

test('POST /api/nodes/bulk — creates 2 notes', async () => {
    const response = await request('POST', '/api/nodes/bulk', {
        notes: [
            { type: 'contact', fields: { name: 'Dizzy Flores' } },
            { type: 'contact', fields: { name: 'Carmen Ibanez' } }
        ]
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.created.length, 2);
    assert.equal(response.body.errors.length, 0);
    assert.equal(response.body.created.every((entry) => entry.ok === true), true);
});

test('POST /api/nodes/bulk — one conflict, one success', async () => {
    const response = await request('POST', '/api/nodes/bulk', {
        notes: [
            { type: 'contact', fields: { name: 'Johnny Rico' } },
            { type: 'contact', fields: { name: 'Zim Commander' } }
        ]
    });
    assert.equal(response.status, 207);
    assert.equal(response.body.created.length, 1);
    assert.equal(response.body.errors.length, 1);
});

test('PATCH /api/nodes/carl-jenkins — update field', async () => {
    const response = await request('PATCH', '/api/nodes/carl-jenkins', { field: 'status', value: 'inactive' });
    assert.equal(response.status, 200);
    assert.equal(response.body.id, 'carl-jenkins');
    assert.equal(response.body.status, 'inactive');
    assert.equal(typeof response.body._generation, 'number');
    assert.ok(response.body._generation > 0);
    const updated = await get('/api/nodes/carl-jenkins');
    assert.equal(updated.status, 200);
    assert.equal(updated.body.status, 'inactive');
});

test('PATCH /api/nodes/:id with no field or fields returns 400', async () => {
    const response = await request('PATCH', '/api/nodes/johnny-rico', { value: 'inactive' });
    assert.equal(response.status, 400);
});

test('PATCH /api/nodes/:id with malformed JSON returns 400 INVALID_JSON', async () => {
    const response = await requestRaw('PATCH', '/api/nodes/johnny-rico', '{"field":"status","value":');
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'INVALID_JSON');
});

test('PATCH /api/nodes/:id with missing note returns 404 NOT_FOUND', async () => {
    const response = await request('PATCH', '/api/nodes/no-such-note', { field: 'status', value: 'inactive' });
    assert.equal(response.status, 404);
    assert.equal(response.body.code, 'NOT_FOUND');
});

test('PATCH /api/nodes writes field_changed to mutation log with note id', async () => {
    const response = await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'field-log-state' });
    assert.equal(response.status, 200);

    const logPath = path.join(vault.dir, '.yamlink', 'mutation-log.ndjson');
    const content = fs.readFileSync(logPath, 'utf8');
    assert.match(content, /"type":"field_changed"/);
    assert.match(content, /"noteId":"johnny-rico"/);
    assert.match(content, /"field":"status"/);
});

test('PATCH /api/nodes multi-field update writes each event exactly once (no double-write)', async () => {
    const logPath = path.join(vault.dir, '.yamlink', 'mutation-log.ndjson');
    const before = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';

    const response = await request('PATCH', '/api/nodes/johnny-rico', {
        fields: { status: 'double-check-a', priority: 'double-check-b' }
    });
    assert.equal(response.status, 200);

    const after = fs.readFileSync(logPath, 'utf8');
    const newLines = after.slice(before.length).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

    const statusEvents = newLines.filter(e => e.noteId === 'johnny-rico' && e.field === 'status');
    const priorityEvents = newLines.filter(e => e.noteId === 'johnny-rico' && e.field === 'priority');
    assert.equal(statusEvents.length, 1, 'status field_changed should appear exactly once');
    assert.equal(priorityEvents.length, 1, 'priority field_changed should appear exactly once');
});

test('PATCH /api/nodes returns X-Yamlink-Generation header', async () => {
    const response = await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'header-patched-state' });
    assert.equal(response.status, 200);
    assert.match(response.headers['x-yamlink-generation'] || '', /^\d+$/);
});

test('GET /api/events + PATCH /api/nodes — emits field_changed event payload', async () => {
    const primed = await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'event-before' });
    assert.equal(primed.status, 200);

    await new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: '/api/events',
            method: 'GET',
            headers: { Accept: 'text/event-stream' }
        }, (res) => {
            let buffer = '';
            let triggered = false;
            const timeout = setTimeout(() => {
                res.destroy();
                reject(new Error('Timed out waiting for field_changed event'));
            }, 2000);

            res.on('data', (chunk) => {
                buffer += String(chunk);
                const messages = buffer.split('\n\n');
                buffer = messages.pop() || '';
                for (const message of messages) {
                    const match = message.match(/data:\s*(.+)$/m);
                    if (!match) continue;
                    let payload = null;
                    try { payload = JSON.parse(match[1]); } catch (_) { continue; }

                    if (payload.type === 'connected' && !triggered) {
                        triggered = true;
                        request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'event-after' }).catch(reject);
                    }

                    if (payload.type === 'field_changed' && payload.id === 'johnny-rico' && payload.field === 'status') {
                        assert.equal(payload.from, 'event-before');
                        assert.equal(payload.to, 'event-after');
                        assert.equal(payload.source, 'api');
                        assert.equal(payload.cause, 'api_update_node');
                        clearTimeout(timeout);
                        res.destroy();
                        resolve();
                    }
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
});

test('GET /api/events?note=johnny-rico filters note events to the selected note', async () => {
    const events = await collectSseEvents('/api/events?note=johnny-rico', async () => {
        const first = await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'filtered-rico' });
        assert.equal(first.status, 200);
        const second = await request('PATCH', '/api/nodes/carl-jenkins', { field: 'status', value: 'filtered-carl' });
        assert.equal(second.status, 200);
    }, 700);

    const noteEvents = events.filter((event) => !['connected', 'rebuild'].includes(event.type));
    assert.ok(noteEvents.length >= 1);
    assert.ok(noteEvents.every((event) => {
        if (event.type === 'intelligence_changed') return event.changedId === 'johnny-rico' || event.changedId === null;
        return event.id === 'johnny-rico';
    }));
    assert.ok(noteEvents.some((event) => event.type === 'field_changed' && event.field === 'status'));
});

test('GET /api/events?type=field_changed filters event types', async () => {
    const events = await collectSseEvents('/api/events?type=field_changed', async () => {
        const created = await request('POST', '/api/nodes', { type: 'contact', fields: { name: 'Filtered Created Event' } });
        assert.equal(created.status, 201);
        const updated = await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'filtered-type-event' });
        assert.equal(updated.status, 200);
    }, 700);

    const userEvents = events.filter((event) => !['connected', 'rebuild'].includes(event.type));
    assert.ok(userEvents.length >= 1);
    assert.ok(userEvents.every((event) => event.type === 'field_changed'));
});

test('GET /api/events receives intelligence_changed after note mutation', async () => {
    const events = await collectSseEvents('/api/events', async () => {
        const updated = await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'intelligence-live-event' });
        assert.equal(updated.status, 200);
    }, 900);

    const intelEvents = events.filter((event) => event.type === 'intelligence_changed');
    assert.ok(intelEvents.length >= 1);
    assert.ok(intelEvents.some((event) => event.changedId === 'johnny-rico'));
});

test('GET /api/events?type=intelligence_changed filters for intelligence updates', async () => {
    const events = await collectSseEvents('/api/events?type=intelligence_changed', async () => {
        const updated = await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'intelligence-type-filter' });
        assert.equal(updated.status, 200);
    }, 900);

    const intelEvents = events.filter((event) => event.type === 'intelligence_changed');
    assert.ok(intelEvents.length >= 1);
    assert.ok(intelEvents.every((event) => event.type === 'intelligence_changed'));
});

test('GET /api/events?note=johnny-rico receives intelligence_changed when changedId matches', async () => {
    const events = await collectSseEvents('/api/events?note=johnny-rico', async () => {
        const updated = await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'intelligence-note-filter-hit' });
        assert.equal(updated.status, 200);
    }, 900);

    const intelEvents = events.filter((event) => event.type === 'intelligence_changed');
    assert.ok(intelEvents.some((event) => event.changedId === 'johnny-rico'));
});

test('GET /api/events?note=roughnecks ignores mismatched intelligence_changed but passes null full rebuild', async () => {
    const mismatchEvents = await collectSseEvents('/api/events?note=roughnecks', async () => {
        const updated = await request('PATCH', '/api/nodes/johnny-rico', { field: 'status', value: 'intelligence-note-filter-miss' });
        assert.equal(updated.status, 200);
    }, 900);
    const mismatchIntel = mismatchEvents.filter((event) => event.type === 'intelligence_changed');
    assert.equal(mismatchIntel.length, 0);

    const filePath = path.join(vault.dir, 'johnny-rico.md');
    const before = fs.readFileSync(filePath, 'utf8');
    const rebuildEvents = await collectSseEvents('/api/events?note=roughnecks', async () => {
        fs.writeFileSync(filePath, before + '\n', 'utf8');
        await handler.vaultService.notifyFileChange();
    }, 1200);
    const rebuildIntel = rebuildEvents.filter((event) => event.type === 'intelligence_changed');
    assert.ok(rebuildIntel.some((event) => event.changedId === null));
});

test('GET /api/events passes rebuild events through even when note filter is active', async () => {
    const events = await collectSseEvents('/api/events?note=johnny-rico', async () => {
        const updated = await request('PATCH', '/api/nodes/carl-jenkins', { field: 'status', value: 'rebuild-pass-through' });
        assert.equal(updated.status, 200);
    }, 700);

    assert.ok(events.some((event) => event.type === 'rebuild'));
    const userEvents = events.filter((event) => !['connected', 'rebuild'].includes(event.type));
    assert.equal(userEvents.length, 0);
});

test('PATCH /api/nodes/nonexistent — 404', async () => {
    const response = await request('PATCH', '/api/nodes/nonexistent', { field: 'status', value: 'inactive' });
    assert.equal(response.status, 404);
    assert.equal(response.body.code, 'NOT_FOUND');
});

test('PATCH /api/nodes/bulk — updates 2 different notes', async () => {
    const response = await request('PATCH', '/api/nodes/bulk', {
        updates: [
            { id: 'johnny-rico', fields: { status: 'ready' } },
            { id: 'roughnecks', fields: { name: 'Rasczak Roughnecks' } }
        ]
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.updated.length, 2);
    assert.equal(response.body.errors.length, 0);
});

test('DELETE /api/nodes/delta-team — delete note created in test 18', async () => {
    const response = await request('DELETE', '/api/nodes/delta-team');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.id, 'delta-team');
    const deleted = await get('/api/nodes/delta-team');
    assert.equal(deleted.status, 404);
});

test('DELETE /api/nodes/:id with missing note returns 404', async () => {
    const response = await request('DELETE', '/api/nodes/not-a-real-note');
    assert.equal(response.status, 404);
});

test('DELETE /api/nodes writes note_deleted to mutation log with noteId', async () => {
    const created = await request('POST', '/api/nodes', {
        type: 'contact',
        fields: { id: 'mutation-deleted-note', name: 'Mutation Deleted Note' }
    });
    assert.equal(created.status, 201);

    const deleted = await request('DELETE', '/api/nodes/mutation-deleted-note');
    assert.equal(deleted.status, 200);

    const logPath = path.join(vault.dir, '.yamlink', 'mutation-log.ndjson');
    const content = fs.readFileSync(logPath, 'utf8');
    assert.match(content, /"type":"note_deleted"/);
    assert.match(content, /"noteId":"mutation-deleted-note"/);
});

test('X-Yamlink-Generation header contract', async () => {
    const a = await get('/api/nodes');
    const b = await get('/api/nodes');
    assert.match(a.headers['x-yamlink-generation'] || '', /^\d+$/);
    assert.match(b.headers['x-yamlink-generation'] || '', /^\d+$/);
    assert.equal(Number.parseInt(a.headers['x-yamlink-generation'], 10), Number.parseInt(b.headers['x-yamlink-generation'], 10));
});

test('CORS headers', async () => {
    const response = await get('/api/nodes');
    assert.equal(response.headers['access-control-allow-origin'], '*');
    const preflight = await request('OPTIONS', '/api/nodes');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], '*');
    assert.match(String(preflight.headers['access-control-allow-methods'] || ''), /GET/);
});

test('X-Yamlink-Api-Version header present on all responses', async () => {
    const endpoints = ['/api/nodes', '/api/types', '/api/health', '/api/graph'];
    for (const ep of endpoints) {
        const res = await get(ep);
        assert.equal(res.headers['x-yamlink-api-version'], '1', `${ep} missing X-Yamlink-Api-Version: 1`);
    }
});

test('GET /api/intelligence/arc — returns arc for known note', async () => {
    const res = await get('/api/intelligence/arc?id=johnny-rico');
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'johnny-rico');
    assert.ok('missingFields' in res.body, 'missingFields array present');
    assert.ok(Array.isArray(res.body.missingFields), 'missingFields is array');
    assert.equal(res.headers['x-yamlink-api-version'], '1', 'API version header present');
});

test('GET /api/intelligence/arc?type=contact — returns type-level arc', async () => {
    const res = await get('/api/intelligence/arc?type=contact');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.id, null);
    assert.equal(res.body.type, 'contact');
    assert.equal(res.body.inferredType, 'contact');
    assert.ok(Array.isArray(res.body.missingFields));
    if (res.body.missingFields.length) {
        assert.equal(typeof res.body.missingFields[0].confidence, 'number');
        assert.equal(typeof res.body.missingFields[0].reason, 'string');
    }
});

test('GET /api/intelligence/arc?type=unknown-type-xyz — returns cold-start empty arc', async () => {
    const res = await get('/api/intelligence/arc?type=unknown-type-xyz');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.id, null);
    assert.equal(res.body.type, 'unknown-type-xyz');
    assert.equal(res.body.coldStart, true);
    assert.deepEqual(res.body.missingFields, []);
});

test('GET /api/intelligence/arc — 404 for unknown note', async () => {
    const res = await get('/api/intelligence/arc?id=nobody');
    assert.equal(res.status, 404);
    assert.ok(res.body.error, 'error field present');
});

test('GET /api/intelligence/arc — 400 when id param missing', async () => {
    const res = await get('/api/intelligence/arc');
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'MISSING_PARAM');
});

test('GET /api/intelligence/fieldCategory — returns classification for known field', async () => {
    const res = await get('/api/intelligence/fieldCategory?id=johnny-rico&field=unit');
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'johnny-rico');
    assert.equal(res.body.field, 'unit');
    assert.ok(res.body.category, 'category present');
    assert.ok(typeof res.body.confidence === 'number', 'confidence is number');
    assert.ok(res.body.source, 'source present');
    assert.ok(Array.isArray(res.body.expectedTypes), 'expectedTypes present');
    assert.ok(res.body.expectedTypes.includes('unit'));
    assert.equal(typeof res.body.surfaces, 'object');
    assert.equal(typeof res.body.surfaces.lightbulb?.level, 'number');
    assert.equal(typeof res.body.surfaces.completion?.level, 'number');
    assert.equal(res.headers['x-yamlink-api-version'], '1', 'API version header present');
});

test('GET /api/intelligence/note — returns lifecycle, drift, and arc for an existing note', async () => {
    const res = await get('/api/intelligence/note?id=johnny-rico');
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'johnny-rico');
    assert.equal(typeof res.body.lifecycle, 'object');
    assert.equal(typeof res.body.drift, 'object');
    assert.equal(typeof res.body.arc, 'object');
});

test('GET /api/intelligence/note — 404 for unknown note', async () => {
    const res = await get('/api/intelligence/note?id=nobody');
    assert.equal(res.status, 404);
    assert.ok(res.body.error);
});

test('GET /api/intelligence/note — 400 when id param missing', async () => {
    const res = await get('/api/intelligence/note');
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'MISSING_PARAM');
});

test('GET /api/intelligence/fieldCategory — 400 when field param missing', async () => {
    const res = await get('/api/intelligence/fieldCategory?id=johnny-rico');
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'MISSING_PARAM');
});

test('GET /api/intelligence/fieldCategory — 404 for unknown note', async () => {
    const res = await get('/api/intelligence/fieldCategory?id=nobody&field=status');
    assert.equal(res.status, 404);
});
