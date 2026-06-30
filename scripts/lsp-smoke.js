'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const BIN       = path.resolve(__dirname, '../bin/yamlink.js');
const vaultPath = path.resolve(__dirname, '../sample');
const rootUri   = 'file:///' + vaultPath.split(path.sep).join('/');

function frame(obj) {
    const json = JSON.stringify(obj);
    return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
}

const docUri    = rootUri + '/test-note.md';
const docText   = '---\nid: test\ntype: contact\n---\n\nLinked to [[j';

const input = [
    frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri, capabilities: {} } }),
    frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
    // Open a document with partial [[ content
    frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
        textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
    }}),
    // Completion — cursor at end of "[[j" on line 5, character 13
    frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/completion', params: {
        textDocument: { uri: docUri },
        position: { line: 5, character: 13 },
        context: { triggerKind: 1 }
    }}),
    // Hover — cursor over [[johnny-rico]] on a line that has a real wikilink
    frame({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
        textDocument: { uri: docUri, version: 2 },
        contentChanges: [{ text: '---\nid: test\ntype: contact\n---\n\nLinked to [[johnny-rico]]' }]
    }}),
    frame({ jsonrpc: '2.0', id: 3, method: 'textDocument/hover', params: {
        textDocument: { uri: docUri },
        position: { line: 5, character: 15 }
    }}),
    // Definition
    frame({ jsonrpc: '2.0', id: 4, method: 'textDocument/definition', params: {
        textDocument: { uri: docUri },
        position: { line: 5, character: 15 }
    }}),
    frame({ jsonrpc: '2.0', method: 'shutdown', id: 5 }),
    frame({ jsonrpc: '2.0', method: 'exit' }),
].join('');

// Receive as Buffer so byte-counted Content-Length slices correctly (no encoding → Buffer output)
const result = spawnSync('node', [BIN, 'serve', '--lsp', '--vault', vaultPath], {
    input: Buffer.from(input, 'utf8'), timeout: 10000
});

if (result.error) { console.error('spawn error:', result.error.message); process.exit(1); }

// Parse all JSON-RPC frames — operate on raw bytes (Content-Length is in bytes)
const raw = result.stdout || Buffer.alloc(0);
let pos = 0;
const messages = [];
const SEP = Buffer.from('\r\n\r\n', 'ascii');
while (pos < raw.length) {
    const headerEnd = raw.indexOf(SEP, pos);
    if (headerEnd === -1) break;
    const header = raw.slice(pos, headerEnd).toString('ascii');
    const match  = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) break;
    const len       = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd   = bodyStart + len;
    if (bodyEnd > raw.length) break;
    try { messages.push(JSON.parse(raw.slice(bodyStart, bodyEnd).toString('utf8'))); } catch (_) {}
    pos = bodyEnd;
}

console.log('Raw stdout length (bytes):', raw.length);
console.log('Messages received:', messages.length);
messages.forEach((m, i) => {
    if (m.id === 1) {
        console.log(`[${i}] initialize response — serverInfo:`, m.result && m.result.serverInfo);
        console.log(`     capabilities:`, JSON.stringify(m.result && m.result.capabilities));
    } else if (m.id === 2) {
        const items = m.result || [];
        console.log(`[${i}] completion — ${items.length} items`);
        if (items.length > 0) console.log('     first item:', items[0].label, '/', items[0].insertText);
    } else {
        console.log(`[${i}]`, JSON.stringify(m).slice(0, 120));
    }
});

if (result.stderr && result.stderr.length) console.log('stderr:', result.stderr.toString('utf8').slice(0, 400));
