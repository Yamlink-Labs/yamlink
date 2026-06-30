'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const { createVault } = require('./lib/vaultSim');
const { buildTaskBlockId } = require('../src/core/bodyBlocks');

const BIN = path.resolve('bin/yamlink.js');

// ── LSP frame helpers ────────────────────────────────────────────────────────

function frame(obj) {
    const json = JSON.stringify(obj);
    return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
}

function parseFrames(buf) {
    const SEP = Buffer.from('\r\n\r\n', 'ascii');
    const messages = [];
    let pos = 0;
    while (pos < buf.length) {
        const headerEnd = buf.indexOf(SEP, pos);
        if (headerEnd === -1) break;
        const header = buf.slice(pos, headerEnd).toString('ascii');
        const match  = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) break;
        const len       = parseInt(match[1], 10);
        const bodyStart = headerEnd + 4;
        const bodyEnd   = bodyStart + len;
        if (bodyEnd > buf.length) break;
        try { messages.push(JSON.parse(buf.slice(bodyStart, bodyEnd).toString('utf8'))); } catch (_) {}
        pos = bodyEnd;
    }
    return messages;
}

function decodeSemanticTokens(data, legend) {
    const tokens = [];
    let line = 0;
    let start = 0;
    for (let i = 0; i < data.length; i += 5) {
        const deltaLine = data[i];
        const deltaStart = data[i + 1];
        const length = data[i + 2];
        const tokenType = data[i + 3];
        const tokenModifiers = data[i + 4];
        line += deltaLine;
        start = deltaLine === 0 ? start + deltaStart : deltaStart;
        const modifiers = [];
        for (let bit = 0; bit < legend.tokenModifiers.length; bit++) {
            if (tokenModifiers & (1 << bit)) modifiers.push(legend.tokenModifiers[bit]);
        }
        tokens.push({
            line,
            start,
            length,
            type: legend.tokenTypes[tokenType],
            modifiers
        });
    }
    return tokens;
}

function applyTextEdits(text, edits) {
    const lines = String(text || '').split('\n');
    const ordered = [...(edits || [])].sort((a, b) => {
        const aStart = a.range?.start || { line: 0, character: 0 };
        const bStart = b.range?.start || { line: 0, character: 0 };
        return bStart.line - aStart.line || bStart.character - aStart.character;
    });

    for (const edit of ordered) {
        const start = edit.range?.start || { line: 0, character: 0 };
        const end = edit.range?.end || start;
        const before = lines[start.line]?.slice(0, start.character) || '';
        const after = lines[end.line]?.slice(end.character) || '';
        const replacement = String(edit.newText || '').split('\n');
        const next = [
            ...lines.slice(0, start.line),
            ...replacement,
            ...lines.slice(end.line + 1)
        ];
        const replacementStart = start.line;
        next[replacementStart] = before + (next[replacementStart] || '');
        const replacementEnd = replacementStart + replacement.length - 1;
        next[replacementEnd] = (next[replacementEnd] || '') + after;
        lines.splice(0, lines.length, ...next);
    }

    return lines.join('\n');
}

/** Run the LSP server with a pre-built frame sequence, return { messages, status }. */
function lsp(vaultDir, frames) {
    const input = Buffer.from(frames.join(''), 'utf8');
    const result = spawnSync('node', [BIN, 'serve', '--lsp', '--vault', vaultDir], {
        input, timeout: 10000
    });
    return {
        messages: parseFrames(result.stdout || Buffer.alloc(0)),
        status:   result.status
    };
}

function rootUri(dir) {
    return 'file:///' + dir.split(path.sep).join('/');
}

// ── Fixture ──────────────────────────────────────────────────────────────────

const FIXTURE = {
    'rico.md': [
        '---', 'id: rico', 'type: contact',
        'name: Juan Rico', 'status: active', 'unit: "[[roughnecks]]"',
        '---', '', 'Career trooper.',
    ].join('\n'),
    'roughnecks.md': [
        '---', 'id: roughnecks', 'type: unit', 'name: Mobile Infantry Roughnecks', '---',
    ].join('\n'),
    'mission-klendathu.md': [
        '---', 'id: mission-klendathu', 'type: mission',
        'name: Klendathu Drop', 'participants: "[[rico]]"',
        '---',
    ].join('\n'),
};

let vault;
let vaultDir;
let uri;

before(() => {
    vault    = createVault(FIXTURE);
    vaultDir = vault.dir;
    uri      = rootUri(vaultDir);
});

after(() => {
    vault.destroy();
});

// ── Transport tests ──────────────────────────────────────────────────────────

test('LSP initialize returns capabilities and serverInfo', () => {
    const { messages, status } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    assert.equal(status, 0);
    const init = messages.find(m => m.id === 1);
    assert.ok(init, 'initialize response present');
    assert.ok(init.result.capabilities.completionProvider, 'completionProvider capability');
    assert.equal(init.result.capabilities.completionProvider.resolveProvider, true);
    assert.ok(init.result.capabilities.hoverProvider, 'hoverProvider capability');
    assert.equal(init.result.capabilities.inlayHintProvider, true);
    assert.ok(init.result.capabilities.semanticTokensProvider, 'semanticTokensProvider capability');
    assert.ok(init.result.capabilities.semanticTokensProvider.legend.tokenTypes.includes('class'));
    assert.ok(init.result.capabilities.documentLinkProvider, 'documentLinkProvider capability');
    assert.equal(init.result.capabilities.documentHighlightProvider, true);
    assert.equal(init.result.capabilities.documentFormattingProvider, true);
    assert.ok(init.result.capabilities.definitionProvider, 'definitionProvider capability');
    assert.ok(init.result.capabilities.executeCommandProvider, 'executeCommandProvider capability');
    assert.ok(init.result.capabilities.executeCommandProvider.commands.includes('yamlink.noteIntelligence'));
    assert.ok(init.result.capabilities.executeCommandProvider.commands.includes('yamlink.addMissingFields'));
    assert.equal(init.result.capabilities.diagnosticProvider.workspaceDiagnostics, true);
    assert.equal(init.result.capabilities.textDocumentSync, 2, 'incremental sync advertised');
    assert.equal(init.result.serverInfo.name, 'yamlink-lsp');
    assert.equal(init.result.serverInfo.version, require('../package.json').version);
});

test('LSP exit without shutdown returns status 1', () => {
    const { status } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    assert.equal(status, 1, 'exit without shutdown should return code 1');
});

test('LSP unknown method returns method-not-found error', () => {
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', id: 99, method: 'workspace/nonexistent', params: {} }),
        frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const err = messages.find(m => m.id === 99);
    assert.ok(err, 'error response present');
    assert.equal(err.error.code, -32601, 'method-not-found code');
    assert.match(err.error.message, /method not found/i);
});

test('LSP invalid vault path exits non-zero without sending responses', () => {
    // The CLI validates the vault path before starting the LSP server and exits 1
    // with a console.error, so no JSON-RPC messages are sent.
    const { messages, status } = lsp('/nonexistent/vault/xyz', [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: 'file:///nonexistent/vault/xyz', capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    assert.equal(status, 1, 'exits 1 for missing vault');
    assert.equal(messages.length, 0, 'no JSON-RPC messages emitted');
});

// ── Completion tests ─────────────────────────────────────────────────────────

test('LSP completion returns items matching partial wikilink', () => {
    const docUri  = uri + '/new-note.md';
    const docText = '---\nid: new\ntype: contact\n---\n\nLinked to [[ri';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/completion', params: {
            textDocument: { uri: docUri },
            position: { line: 5, character: 14 }, // cursor after "[[ri"
            context: { triggerKind: 1 }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const comp = messages.find(m => m.id === 2);
    assert.ok(comp, 'completion response present');
    assert.ok(Array.isArray(comp.result), 'result is array');
    assert.ok(comp.result.length > 0, 'at least one completion item');
    const ids = comp.result.map(i => i.data && i.data.id);
    assert.ok(ids.includes('rico'), 'rico is in completion items');
});

test('LSP completion returns empty array when not inside [[', () => {
    const docUri  = uri + '/plain.md';
    const docText = '---\nid: plain\n---\n\nHello world';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/completion', params: {
            textDocument: { uri: docUri },
            position: { line: 4, character: 5 }, // cursor in plain text
            context: { triggerKind: 1 }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const comp = messages.find(m => m.id === 2);
    assert.ok(comp, 'completion response present');
    assert.deepEqual(comp.result, [], 'empty result outside [[');
});

test('LSP completion with no partial returns all vault notes (≤50)', () => {
    const docUri  = uri + '/empty-wikilink.md';
    const docText = 'See [[';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/completion', params: {
            textDocument: { uri: docUri },
            position: { line: 0, character: 6 },
            context: { triggerKind: 2 }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const comp = messages.find(m => m.id === 2);
    assert.ok(comp, 'completion response present');
    assert.ok(Array.isArray(comp.result), 'result is array');
    // Vault has 3 notes
    assert.equal(comp.result.length, 3, 'all 3 vault notes returned');
    // Items have required LSP fields
    for (const item of comp.result) {
        assert.ok(item.label,      'item has label');
        assert.ok(item.insertText, 'item has insertText');
        assert.ok(item.insertText.endsWith(']]'), 'insertText ends with ]]');
    }
});

test('LSP completion insertText uses ID, not display name', () => {
    const docUri  = uri + '/insert-check.md';
    const docText = '[[';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/completion', params: {
            textDocument: { uri: docUri },
            position: { line: 0, character: 2 },
            context: { triggerKind: 2 }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const comp = messages.find(m => m.id === 2);
    assert.ok(comp);
    const rico = comp.result.find(i => i.data && i.data.id === 'rico');
    assert.ok(rico, 'rico item found');
    assert.equal(rico.insertText, 'rico]]', 'insertText is ID-based');
    assert.equal(rico.label, 'Juan Rico', 'label is display name');
});

test('LSP completion matches vault aliases and still inserts the canonical id', () => {
    const aliasVault = createVault({
        'rico.md': ['---', 'id: rico', 'type: contact', 'name: Johnny Rico', 'aliases: Juan Rico', '---'].join('\n')
    });
    const aliasUri = rootUri(aliasVault.dir);
    const docUri = aliasUri + '/alias-completion.md';
    const docText = '[[Jua';
    try {
        const { messages } = lsp(aliasVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: aliasUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/completion', params: {
                textDocument: { uri: docUri },
                position: { line: 0, character: docText.length },
                context: { triggerKind: 1 }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const comp = messages.find((m) => m.id === 2);
        assert.ok(comp, 'completion response present');
        const rico = comp.result.find((item) => item.data && item.data.id === 'rico');
        assert.ok(rico, 'canonical note returned for alias query');
        assert.equal(rico.insertText, 'rico]]', 'insert text stays canonical');
    } finally {
        aliasVault.destroy();
    }
});

test('LSP completionItem/resolve returns richer documentation for note completions', () => {
    const docUri  = uri + '/resolve-check.md';
    const docText = '[[';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'completionItem/resolve', params: {
            label: 'Juan Rico',
            kind: 17,
            detail: 'contact · active',
            insertText: 'rico]]',
            data: { id: 'rico' }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);

    const resolved = messages.find(m => m.id === 2);
    assert.ok(resolved, 'resolve response present');
    assert.ok(resolved.result.documentation, 'documentation present');
    assert.equal(resolved.result.documentation.kind, 'markdown');
    assert.match(resolved.result.documentation.value, /\*\*Juan Rico\*\*/);
    assert.match(resolved.result.documentation.value, /- inbound:/);
    assert.match(resolved.result.documentation.value, /- outbound:/);
    assert.match(resolved.result.detail, /contact/);
});

test('LSP formatting normalizes frontmatter order and date values without rewriting the body', () => {
    const docUri = uri + '/formatting.md';
    const docText = [
        '---',
        'updated: March 4 2026',
        'status: active',
        'type: contact',
        'id: rico',
        'name: Juan Rico',
        'created: 2026/03/01',
        '---',
        '',
        'Body paragraph stays here.'
    ].join('\n');
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/formatting', params: {
            textDocument: { uri: docUri },
            options: { tabSize: 2, insertSpaces: true }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const result = messages.find((m) => m.id === 2);
    assert.ok(result, 'formatting response present');
    assert.ok(Array.isArray(result.result), 'formatting returns text edits');
    assert.equal(result.result.length, 1, 'single full-document edit');
    assert.match(result.result[0].newText, /^---\nid: rico\ntype: contact\n/m);
    assert.match(result.result[0].newText, /created: '2026-03-01'/);
    assert.match(result.result[0].newText, /updated: '2026-03-04'/);
    assert.match(result.result[0].newText, /Body paragraph stays here\./);
});

test('LSP formatting applies edits into ordered frontmatter and leaves clean notes untouched', () => {
    const formatVault = createVault({});
    try {
        const formatUri = rootUri(formatVault.dir);
        const messyUri = formatUri + '/messy.md';
        const messyText = [
            '---',
            'type: contact',
            '',
            'name: Dizzy Flores',
            'id: dizzy-flores',
            'status: active',
            '---',
            'Body line.'
        ].join('\n');

        const cleanUri = formatUri + '/clean.md';
        const cleanText = [
            '---',
            'id: clean-note',
            'type: contact',
            'name: Clean Note',
            'status: active',
            '---',
            '',
            'Body line.'
        ].join('\n');

        const { messages } = lsp(formatVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: formatUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: messyUri, languageId: 'markdown', version: 1, text: messyText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/formatting', params: {
                textDocument: { uri: messyUri },
                options: { tabSize: 2, insertSpaces: true }
            }}),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: cleanUri, languageId: 'markdown', version: 1, text: cleanText }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'textDocument/formatting', params: {
                textDocument: { uri: cleanUri },
                options: { tabSize: 2, insertSpaces: true }
            }}),
            frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);

        const messyResult = messages.find((m) => m.id === 2);
        assert.ok(messyResult, 'formatting response present for messy note');
        assert.ok(Array.isArray(messyResult.result), 'formatting returns edits for messy note');
        const applied = applyTextEdits(messyText, messyResult.result);
        assert.match(applied, /^---\nid: dizzy-flores\ntype: contact\nname: Dizzy Flores\nstatus: active\n---\n\nBody line\.$/);

        const cleanResult = messages.find((m) => m.id === 3);
        assert.ok(cleanResult, 'formatting response present for clean note');
        assert.deepEqual(cleanResult.result, [], 'clean note returns no edits');
    } finally {
        formatVault.destroy();
    }
});

test('LSP formatting returns content-modified for stale document versions', () => {
    const docUri = uri + '/formatting-stale.md';
    const docText = ['---', 'type: contact', 'id: rico', '---'].join('\n');
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
            textDocument: { uri: docUri, version: 2 },
            contentChanges: [{ text: docText + '\nname: Rico' }]
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/formatting', params: {
            textDocument: { uri: docUri, version: 1 },
            options: { tabSize: 2, insertSpaces: true }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const result = messages.find((m) => m.id === 2);
    assert.ok(result?.error, 'formatting stale error present');
    assert.equal(result.error.code, -32801);
});

test('LSP documentLink returns clickable targets for resolved wikilinks and skips unresolved ones', () => {
    const docUri = uri + '/document-links.md';
    const docText = [
        'See [[rico]] and [[ghost-note]].',
        'Mission link: [[mission-klendathu]].'
    ].join('\n');
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/documentLink', params: {
            textDocument: { uri: docUri }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);

    const links = messages.find((m) => m.id === 2);
    assert.ok(links, 'documentLink response present');
    assert.ok(Array.isArray(links.result), 'documentLink result is array');
    assert.equal(links.result.length, 2, 'only resolved links are returned');
    assert.ok(links.result.some((link) => /rico\.md$/.test(link.target)), 'rico target present');
    assert.ok(links.result.some((link) => /mission-klendathu\.md$/.test(link.target)), 'mission target present');
    assert.ok(links.result.every((link) => link.tooltip), 'tooltips present');
});

test('LSP documentLink preserves heading anchors when a matching heading exists', () => {
    const anchorVault = createVault({
        'rico.md': [
            '---',
            'id: rico',
            'type: contact',
            'name: Juan Rico',
            '---',
            '',
            '## Combat Record',
            '',
            'More detail.'
        ].join('\n'),
        'links.md': 'See [[rico#Combat Record]].\n'
    });

    try {
        const anchorUri = rootUri(anchorVault.dir);
        const docUri = anchorUri + '/links.md';
        const { messages } = lsp(anchorVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: anchorUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: {
                    uri: docUri,
                    languageId: 'markdown',
                    version: 1,
                    text: 'See [[rico#Combat Record]].\n'
                }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/documentLink', params: {
                textDocument: { uri: docUri }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);

        const links = messages.find((m) => m.id === 2);
        assert.ok(links, 'documentLink response present');
        assert.equal(links.result.length, 1, 'one anchor link returned');
        assert.match(links.result[0].target, /rico\.md#L7$/, 'target preserves resolved heading anchor');
    } finally {
        anchorVault.destroy();
    }
});

test('LSP documentLink preserves block references when a matching body block exists', () => {
    const blockId = buildTaskBlockId(1, 'Review recon logs');
    const blockVault = createVault({
        'rico.md': [
            '---',
            'id: rico',
            'type: contact',
            'name: Juan Rico',
            '---',
            '',
            '- [ ] Review recon logs'
        ].join('\n'),
        'links.md': `See [[rico^${blockId}]].\n`
    });

    try {
        const blockUri = rootUri(blockVault.dir);
        const docUri = blockUri + '/links.md';
        const { messages } = lsp(blockVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: blockUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: {
                    uri: docUri,
                    languageId: 'markdown',
                    version: 1,
                    text: `See [[rico^${blockId}]].\n`
                }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/documentLink', params: {
                textDocument: { uri: docUri }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);

        const links = messages.find((m) => m.id === 2);
        assert.ok(links, 'documentLink response present');
        assert.equal(links.result.length, 1, 'one block-ref link returned');
        assert.match(links.result[0].target, /rico\.md#L7$/, 'target preserves resolved block line');
    } finally {
        blockVault.destroy();
    }
});

test('LSP documentLink can read from disk when the document is not open', () => {
    const linksVault = createVault({
        'rico.md': ['---', 'id: rico', 'type: contact', '---'].join('\n'),
        'source.md': 'See [[rico]].\n'
    });
    try {
        const linksUri = rootUri(linksVault.dir);
        const docUri = linksUri + '/source.md';
        const { messages } = lsp(linksVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: linksUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/documentLink', params: {
                textDocument: { uri: docUri }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const links = messages.find((m) => m.id === 2);
        assert.ok(links, 'documentLink response present');
        assert.equal(links.result.length, 1, 'disk-backed document link returned');
    } finally {
        linksVault.destroy();
    }
});

test('LSP documentHighlight highlights local id and same-note wikilink references', () => {
    const docUri = uri + '/document-highlight.md';
    const docText = [
        '---',
        'id: rico',
        'type: contact',
        '---',
        '',
        'See [[rico]] and [[rico]].'
    ].join('\n');
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/documentHighlight', params: {
            textDocument: { uri: docUri },
            position: { line: 5, character: 7 }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);

    const highlights = messages.find((m) => m.id === 2);
    assert.ok(highlights, 'documentHighlight response present');
    assert.ok(Array.isArray(highlights.result), 'documentHighlight result is array');
    assert.equal(highlights.result.length, 3, 'id declaration and two wikilinks are highlighted');
    assert.ok(highlights.result.some((entry) => entry.kind === 1), 'text highlight for id declaration present');
    assert.equal(highlights.result.filter((entry) => entry.kind === 2).length, 2, 'read highlights for wikilinks present');
});

test('LSP documentHighlight returns empty array away from note ids and wikilinks', () => {
    const docUri = uri + '/document-highlight-empty.md';
    const docText = 'Plain body text with no Yamlink reference at the cursor.';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/documentHighlight', params: {
            textDocument: { uri: docUri },
            position: { line: 0, character: 5 }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);

    const highlights = messages.find((m) => m.id === 2);
    assert.ok(highlights, 'documentHighlight response present');
    assert.deepEqual(highlights.result, [], 'no highlights outside Yamlink ids or links');
});

test('LSP documentHighlight groups canonical and alias wikilinks to the same note', () => {
    const aliasVault = createVault({
        'rico.md': ['---', 'id: rico', 'type: contact', 'aliases: Johnny Rico', '---'].join('\n')
    });
    const aliasUri = rootUri(aliasVault.dir);
    const docUri = aliasUri + '/highlight.md';
    const docText = 'See [[Johnny Rico]].\nSee [[rico|Rico]].\nSee [[rico]].\n';
    try {
        const { messages } = lsp(aliasVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: aliasUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/documentHighlight', params: {
                textDocument: { uri: docUri },
                position: { line: 0, character: 8 }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const highlights = messages.find((m) => m.id === 2);
        assert.ok(highlights, 'documentHighlight response present');
        assert.equal(highlights.result.length, 3, 'all local alias/canonical refs highlighted');
    } finally {
        aliasVault.destroy();
    }
});

test('LSP inlay hints surface relation, workflow, and likely-missing-field guidance in frontmatter', () => {
    const hintVault = createVault({
        'contact-a.md': [
            '---',
            'id: contact-a',
            'type: contact',
            'name: Ace Levy',
            'status: active',
            'unit: [[alpha]]',
            'homeworld: Buenos Aires',
            '---'
        ].join('\n'),
        'contact-b.md': [
            '---',
            'id: contact-b',
            'type: contact',
            'name: Carmen Ibanez',
            'status: reserve',
            'unit: [[alpha]]',
            'homeworld: Luna',
            '---'
        ].join('\n'),
        'alpha.md': [
            '---',
            'id: alpha',
            'type: unit',
            'name: Alpha Squad',
            '---'
        ].join('\n')
    });

    try {
        const hintUri = rootUri(hintVault.dir);
        const docUri = hintUri + '/draft-contact.md';
        const docText = [
            '---',
            'id: draft-contact',
            'type: contact',
            'status: active',
            'unit: [[alpha]]',
            '---',
            '',
            'Body text only.'
        ].join('\n');

        const { messages } = lsp(hintVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: hintUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/inlayHint', params: {
                textDocument: { uri: docUri },
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 6, character: 0 }
                }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);

        const result = messages.find(m => m.id === 2);
        assert.ok(result, 'inlayHint response present');
        assert.ok(Array.isArray(result.result), 'inlayHint result is array');

        const labels = result.result.map((hint) => String(hint.label));
        assert.ok(labels.some((label) => /workflow values:|workflow field/i.test(label)), 'workflow hint present');
        assert.ok(labels.some((label) => /links to .* notes|relation field/i.test(label)), 'relation hint present');
        assert.ok(labels.some((label) => /likely missing fields:/i.test(label)), 'arc hint present');
    } finally {
        hintVault.destroy();
    }
});

test('LSP inlay hints stay quiet outside frontmatter', () => {
    const docUri = uri + '/body-only.md';
    const docText = [
        '---',
        'id: body-only',
        'type: contact',
        'status: active',
        '---',
        '',
        'This body line should not get Yamlink inlay hints.'
    ].join('\n');
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/inlayHint', params: {
            textDocument: { uri: docUri },
            range: {
                start: { line: 6, character: 0 },
                end: { line: 6, character: 48 }
            }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);

    const result = messages.find(m => m.id === 2);
    assert.ok(result, 'inlayHint response present');
    assert.deepEqual(result.result, [], 'body-only range returns no hints');
});

test('LSP inlay hints include positioned labels for relation frontmatter and stay empty without frontmatter', () => {
    const hintVault = createVault({
        'target.md': [
            '---',
            'id: target-note',
            'type: unit',
            'name: Target Note',
            '---'
        ].join('\n')
    });

    try {
        const hintUri = rootUri(hintVault.dir);
        const relationUri = hintUri + '/relation.md';
        const relationText = [
            '---',
            'id: relation-note',
            'type: contact',
            'unit: [[target-note]]',
            '---'
        ].join('\n');
        const plainUri = hintUri + '/plain.md';
        const plainText = 'No frontmatter here.';

        const { messages } = lsp(hintVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: hintUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: relationUri, languageId: 'markdown', version: 1, text: relationText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/inlayHint', params: {
                textDocument: { uri: relationUri },
                range: { start: { line: 0, character: 0 }, end: { line: 4, character: 0 } }
            }}),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: plainUri, languageId: 'markdown', version: 1, text: plainText }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'textDocument/inlayHint', params: {
                textDocument: { uri: plainUri },
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: plainText.length } }
            }}),
            frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);

        const relationResult = messages.find((m) => m.id === 2);
        assert.ok(relationResult, 'relation inlayHint response present');
        assert.ok(Array.isArray(relationResult.result), 'relation inlayHint result is array');
        const hint = relationResult.result.find((entry) => typeof entry.label === 'string' && entry.position);
        assert.ok(hint, 'positioned label hint present');

        const plainResult = messages.find((m) => m.id === 3);
        assert.ok(plainResult, 'plain note inlayHint response present');
        assert.deepEqual(plainResult.result, [], 'note without frontmatter returns no hints');
    } finally {
        hintVault.destroy();
    }
});

test('LSP semantic tokens classify frontmatter keys, workflow values, and wikilinks', () => {
    const docUri = uri + '/semantic-tokens.md';
    const docText = [
        '---',
        'id: semantic-note',
        'type: contact',
        'status: active',
        'unit: [[roughnecks]]',
        '---',
        '',
        'See [[rico]] and [[ghost-note]].'
    ].join('\n');
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/semanticTokens/full', params: {
            textDocument: { uri: docUri }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);

    const init = messages.find(m => m.id === 1);
    const result = messages.find(m => m.id === 2);
    assert.ok(init && result, 'initialize and semantic token responses present');
    assert.ok(Array.isArray(result.result.data), 'semantic token data is an array');

    const decoded = decodeSemanticTokens(
        result.result.data,
        init.result.capabilities.semanticTokensProvider.legend
    );

    assert.ok(decoded.some(token => token.line === 2 && token.type === 'property'), 'frontmatter key token present');
    assert.ok(decoded.some(token => token.line === 2 && token.type === 'type'), 'type value token present');
    assert.ok(decoded.some(token => token.line === 3 && token.type === 'enumMember'), 'workflow value token present');
    assert.ok(decoded.some(token => token.line === 4 && token.type === 'class'), 'resolved frontmatter wikilink token present');
    assert.ok(decoded.some(token => token.line === 7 && token.type === 'class'), 'resolved body wikilink token present');
    assert.ok(decoded.some(token => token.line === 7 && token.type === 'string' && token.modifiers.includes('deprecated')), 'unresolved wikilink token marked deprecated');
    assert.ok(decoded.some(token => token.type === 'operator'), 'wikilink bracket operator tokens present');
});

test('LSP semantic tokens return flat token data and stay empty for plain documents', () => {
    const semanticVault = createVault({});
    try {
        const semanticUri = rootUri(semanticVault.dir);
        const linkedUri = semanticUri + '/linked.md';
        const linkedText = 'Body with [[linked-note]].';
        const plainUri = semanticUri + '/plain.md';
        const plainText = 'Just plain text.';

        const { messages } = lsp(semanticVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: semanticUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: linkedUri, languageId: 'markdown', version: 1, text: linkedText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/semanticTokens/full', params: {
                textDocument: { uri: linkedUri }
            }}),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: plainUri, languageId: 'markdown', version: 1, text: plainText }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'textDocument/semanticTokens/full', params: {
                textDocument: { uri: plainUri }
            }}),
            frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);

        const linkedResult = messages.find((m) => m.id === 2);
        assert.ok(linkedResult, 'semanticTokens response present for linked doc');
        assert.ok(Array.isArray(linkedResult.result.data), 'semantic token data is an array');
        assert.equal(linkedResult.result.data.length % 5, 0, 'token stream stays five-wide');
        assert.ok(linkedResult.result.data.every(Number.isInteger), 'token stream is integer-only');

        const plainResult = messages.find((m) => m.id === 3);
        assert.ok(plainResult, 'semanticTokens response present for plain doc');
        assert.deepEqual(plainResult.result, { data: [] }, 'plain doc returns empty token stream');
    } finally {
        semanticVault.destroy();
    }
});

// ── Hover tests ───────────────────────────────────────────────────────────────

test('LSP hover on valid wikilink returns note preview', () => {
    const docUri  = uri + '/hover-test.md';
    const docText = '---\nid: hover-test\n---\n\nLinked to [[rico]]';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: {
            textDocument: { uri: docUri },
            position: { line: 4, character: 14 } // inside [[rico]]
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const hover = messages.find(m => m.id === 2);
    assert.ok(hover, 'hover response present');
    assert.ok(hover.result, 'non-null result');
    assert.equal(hover.result.contents.kind, 'markdown');
    assert.match(hover.result.contents.value, /Juan Rico/);
    assert.match(hover.result.contents.value, /contact/);
    assert.match(hover.result.contents.value, /inbound/);
});

test('LSP hover returns null when cursor not on wikilink', () => {
    const docUri  = uri + '/hover-miss.md';
    const docText = '---\nid: hover-miss\n---\n\nPlain text here';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: {
            textDocument: { uri: docUri },
            position: { line: 4, character: 3 }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const hover = messages.find(m => m.id === 2);
    assert.ok(hover, 'hover response present');
    assert.equal(hover.result, null, 'null for non-wikilink position');
});

test('LSP hover returns null for unknown ID', () => {
    const docUri  = uri + '/hover-unknown.md';
    const docText = 'See [[no-such-note]]';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: {
            textDocument: { uri: docUri },
            position: { line: 0, character: 10 }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const hover = messages.find(m => m.id === 2);
    assert.ok(hover, 'hover response present');
    assert.equal(hover.result, null, 'null for unknown ID');
});

test('LSP hover resolves alias and piped wikilinks to the canonical note preview', () => {
    const aliasVault = createVault({
        'rico.md': [
            '---',
            'id: rico',
            'type: contact',
            'name: Johnny Rico',
            'aliases: Juan Rico',
            'summary: Mobile Infantry officer.',
            '---'
        ].join('\n')
    });
    const aliasUri = rootUri(aliasVault.dir);
    const docUri = aliasUri + '/hover-alias.md';
    const docText = 'See [[Juan Rico|Rico]].';
    try {
        const { messages } = lsp(aliasVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: aliasUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: {
                textDocument: { uri: docUri },
                position: { line: 0, character: 8 }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const hover = messages.find((m) => m.id === 2);
        assert.ok(hover, 'hover response present');
        assert.match(hover.result.contents.value, /\*\*Johnny Rico\*\*/);
        assert.match(hover.result.contents.value, /Mobile Infantry officer/);
    } finally {
        aliasVault.destroy();
    }
});

test('LSP hover preserves scoped context for heading and block wikilinks', () => {
    const blockId = buildTaskBlockId(1, 'Review recon logs');
    const scopedVault = createVault({
        'rico.md': [
            '---',
            'id: rico',
            'type: contact',
            'name: Johnny Rico',
            '---',
            '',
            '## Deployment',
            '',
            '- [ ] Review recon logs'
        ].join('\n')
    });
    const scopedUri = rootUri(scopedVault.dir);
    const docUri = scopedUri + '/hover-scoped.md';
    const docText = `Head [[rico#Deployment]]\nBlock [[rico^${blockId}]]\n`;
    try {
        const { messages } = lsp(scopedVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: scopedUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: {
                textDocument: { uri: docUri },
                position: { line: 0, character: 8 }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'textDocument/hover', params: {
                textDocument: { uri: docUri },
                position: { line: 1, character: 9 }
            }}),
            frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const headingHover = messages.find((m) => m.id === 2);
        const blockHover = messages.find((m) => m.id === 3);
        assert.ok(headingHover, 'heading hover response present');
        assert.ok(blockHover, 'block hover response present');
        assert.match(headingHover.result.contents.value, /section: Deployment/);
        assert.match(blockHover.result.contents.value, new RegExp(`block: \\^${blockId}`));
    } finally {
        scopedVault.destroy();
    }
});

test('LSP hover can resolve wikilinks from disk when the document is not open', () => {
    const hoverVault = createVault({
        'rico.md': [
            '---',
            'id: rico',
            'type: contact',
            'name: Johnny Rico',
            'summary: Mobile Infantry officer.',
            '---'
        ].join('\n'),
        'source.md': 'See [[rico]].\n'
    });
    try {
        const hoverUri = rootUri(hoverVault.dir);
        const docUri = hoverUri + '/source.md';
        const { messages } = lsp(hoverVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: hoverUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: {
                textDocument: { uri: docUri },
                position: { line: 0, character: 8 }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const hover = messages.find((m) => m.id === 2);
        assert.ok(hover, 'hover response present');
        assert.match(hover.result.contents.value, /\*\*Johnny Rico\*\*/);
    } finally {
        hoverVault.destroy();
    }
});

// ── Definition tests ──────────────────────────────────────────────────────────

test('LSP definition resolves [[id]] to file URI', () => {
    const docUri  = uri + '/def-test.md';
    const docText = 'See [[roughnecks]] here';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/definition', params: {
            textDocument: { uri: docUri },
            position: { line: 0, character: 8 } // inside [[roughnecks]]
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const def = messages.find(m => m.id === 2);
    assert.ok(def, 'definition response present');
    assert.ok(def.result, 'non-null result');
    assert.match(def.result.uri, /file:\/\/\//);
    assert.match(def.result.uri, /roughnecks\.md$/);
    assert.deepEqual(def.result.range.start, { line: 0, character: 0 });
});

test('LSP definition resolves heading anchors to the matching heading line', () => {
    const anchorVault = createVault({
        'rico.md': [
            '---',
            'id: rico',
            'type: contact',
            '---',
            '',
            '## Combat Record',
            'Drop veteran.'
        ].join('\n'),
        'source.md': 'See [[rico#Combat Record]].\n'
    });

    try {
        const anchorUri = rootUri(anchorVault.dir);
        const docUri = anchorUri + '/source.md';
        const { messages } = lsp(anchorVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: anchorUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: 'See [[rico#Combat Record]].\n' }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/definition', params: {
                textDocument: { uri: docUri },
                position: { line: 0, character: 8 }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const def = messages.find((m) => m.id === 2);
        assert.ok(def, 'definition response present');
        assert.ok(def.result, 'non-null result');
        assert.match(def.result.uri, /rico\.md$/);
        assert.deepEqual(def.result.range.start, { line: 5, character: 0 });
    } finally {
        anchorVault.destroy();
    }
});

test('LSP definition resolves block refs to the matching body block line', () => {
    const blockId = buildTaskBlockId(1, 'Review recon logs');
    const blockVault = createVault({
        'rico.md': [
            '---',
            'id: rico',
            'type: contact',
            '---',
            '',
            '- [ ] Review recon logs'
        ].join('\n'),
        'source.md': `See [[rico^${blockId}]].\n`
    });

    try {
        const blockUri = rootUri(blockVault.dir);
        const docUri = blockUri + '/source.md';
        const { messages } = lsp(blockVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: blockUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: `See [[rico^${blockId}]].\n` }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/definition', params: {
                textDocument: { uri: docUri },
                position: { line: 0, character: 8 }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const def = messages.find((m) => m.id === 2);
        assert.ok(def, 'definition response present');
        assert.ok(def.result, 'non-null result');
        assert.match(def.result.uri, /rico\.md$/);
        assert.deepEqual(def.result.range.start, { line: 5, character: 0 });
    } finally {
        blockVault.destroy();
    }
});

test('LSP definition returns null for unknown wikilink', () => {
    const docUri  = uri + '/def-miss.md';
    const docText = 'See [[ghost-note]] here';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/definition', params: {
            textDocument: { uri: docUri },
            position: { line: 0, character: 8 }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const def = messages.find(m => m.id === 2);
    assert.ok(def, 'definition response present');
    assert.equal(def.result, null, 'null for unknown ID');
});

// ── Document sync tests ───────────────────────────────────────────────────────

test('LSP didChange updates open document content used for hover', () => {
    const docUri  = uri + '/change-test.md';
    const docText = 'See [[rico]]';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        // Change document to point at roughnecks
        frame({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
            textDocument: { uri: docUri, version: 2 },
            contentChanges: [{ text: 'See [[roughnecks]]' }]
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: {
            textDocument: { uri: docUri },
            position: { line: 0, character: 8 }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const hover = messages.find(m => m.id === 2);
    assert.ok(hover, 'hover response present');
    assert.ok(hover.result, 'non-null result after didChange');
    assert.match(hover.result.contents.value, /Roughnecks/i, 'hover reflects updated document');
});

test('LSP didChange applies incremental range edits to open document text', () => {
    const docUri  = uri + '/change-incremental.md';
    const docText = 'See [[rico]]';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
            textDocument: { uri: docUri, version: 2 },
            contentChanges: [{
                range: {
                    start: { line: 0, character: 6 },
                    end: { line: 0, character: 10 }
                },
                text: 'roughnecks'
            }]
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: {
            textDocument: { uri: docUri },
            position: { line: 0, character: 8 }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const hover = messages.find(m => m.id === 2);
    assert.ok(hover, 'hover response present');
    assert.ok(hover.result, 'non-null result after incremental didChange');
    assert.match(hover.result.contents.value, /Roughnecks/i, 'incremental edit updates in-memory document');
});

test('LSP didChange ignores stale document versions and keeps the newest in-memory text', () => {
    const docUri  = uri + '/change-stale-version.md';
    const docText = 'See [[rico]]';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
            textDocument: { uri: docUri, version: 3 },
            contentChanges: [{ text: 'See [[roughnecks]]' }]
        }}),
        frame({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
            textDocument: { uri: docUri, version: 2 },
            contentChanges: [{ text: 'See [[ghost-note]]' }]
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: {
            textDocument: { uri: docUri },
            position: { line: 0, character: 8 }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const hover = messages.find(m => m.id === 2);
    assert.ok(hover, 'hover response present');
    assert.ok(hover.result, 'non-null result after stale didChange');
    assert.match(hover.result.contents.value, /Roughnecks/i, 'latest version wins over stale didChange');

    const diags = messages.filter(m => m.method === 'textDocument/publishDiagnostics' && m.params && m.params.uri === docUri);
    const latest = diags[diags.length - 1];
    assert.ok(latest, 'latest diagnostics notification present');
    assert.ok(
        !latest.params.diagnostics.some(d => d.message && d.message.includes('ghost-note')),
        'stale broken-link diagnostics were not published'
    );
});

test('LSP didChange publishes diagnostics immediately for unsaved broken links', () => {
    const docUri  = uri + '/change-diagnostics.md';
    const docText = 'See [[rico]]';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
            textDocument: { uri: docUri, version: 2 },
            contentChanges: [{ text: 'See [[ghost-note]]' }]
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const diags = messages.filter(m => m.method === 'textDocument/publishDiagnostics' && m.params && m.params.uri === docUri);
    assert.ok(diags.length >= 2, 'diagnostics published for both open and unsaved change');
    const latest = diags[diags.length - 1];
    const broken = latest.params.diagnostics.find(d => d.message && d.message.includes('ghost-note'));
    assert.ok(broken, 'broken link diagnostic present after didChange');
    assert.equal(broken.severity, 2, 'severity is Warning (2)');
});

test('LSP didChange clears diagnostics immediately when an unsaved broken link is fixed', () => {
    const docUri  = uri + '/change-diagnostics-clear.md';
    const docText = 'See [[ghost-note]]';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
            textDocument: { uri: docUri, version: 2 },
            contentChanges: [{ text: 'See [[rico]]' }]
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const diags = messages.filter(m => m.method === 'textDocument/publishDiagnostics' && m.params && m.params.uri === docUri);
    assert.ok(diags.length >= 2, 'diagnostics published for both open and fixed change');
    const first = diags[0];
    const latest = diags[diags.length - 1];
    assert.ok(first.params.diagnostics.some(d => d.message && d.message.includes('ghost-note')), 'initial broken link reported');
    assert.ok(
        !latest.params.diagnostics.some(d => d.message && d.message.includes('ghost-note')),
        'broken link diagnostic cleared after didChange fix'
    );
});

test('LSP diagnostics published after initialize contain broken-link warnings', () => {
    const docUri  = uri + '/broken-link.md';
    const docText = 'See [[rico]] and [[no-such-note]]';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        // Trigger rebuild to get diagnostics pushed
        frame({ jsonrpc: '2.0', method: 'workspace/didChangeWatchedFiles', params: {
            changes: [{ uri: docUri, type: 1 }]
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const diags = messages.filter(m => m.method === 'textDocument/publishDiagnostics');
    assert.ok(diags.length > 0, 'at least one publishDiagnostics notification');
    const forDoc = diags.find(m => m.params && m.params.uri === docUri);
    assert.ok(forDoc, 'diagnostics published for the open doc');
    const broken = forDoc.params.diagnostics.find(d => d.message && d.message.includes('no-such-note'));
    assert.ok(broken, 'broken link diagnostic present');
    assert.equal(broken.severity, 2, 'severity is Warning (2)');
});

// ── Capabilities tests ────────────────────────────────────────────────────────

test('LSP initialize capabilities include renameProvider and codeActionProvider', () => {
    const { messages, status } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    assert.equal(status, 0);
    const init = messages.find(m => m.id === 1);
    assert.ok(init, 'initialize response present');
    // renameProvider is now an object with prepareProvider: true (not a bare boolean)
    assert.ok(init.result.capabilities.renameProvider, 'renameProvider capability');
    assert.equal(init.result.capabilities.renameProvider.prepareProvider, true, 'prepareProvider advertised');
    assert.ok(init.result.capabilities.codeActionProvider, 'codeActionProvider capability');
    assert.ok(
        init.result.capabilities.codeActionProvider.codeActionKinds.includes('quickfix'),
        'quickfix kind registered'
    );
    assert.ok(
        init.result.capabilities.codeActionProvider.codeActionKinds.includes('refactor.rewrite'),
        'refactor.rewrite kind registered'
    );
});

test('LSP initialize capabilities include references, documentSymbols, workspaceSymbol', () => {
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const init = messages.find(m => m.id === 1);
    assert.ok(init.result.capabilities.referencesProvider, 'referencesProvider');
    assert.ok(init.result.capabilities.documentSymbolProvider, 'documentSymbolProvider');
    assert.ok(init.result.capabilities.selectionRangeProvider, 'selectionRangeProvider');
    assert.ok(init.result.capabilities.foldingRangeProvider, 'foldingRangeProvider');
    assert.ok(init.result.capabilities.workspaceSymbolProvider, 'workspaceSymbolProvider');
    assert.ok(init.result.capabilities.callHierarchyProvider, 'callHierarchyProvider');
    assert.equal(init.result.capabilities.experimental.workspaceCodeActionProvider, true, 'workspaceCodeActionProvider');
});

test('LSP initialized notification triggers client/registerCapability for md watcher', () => {
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const reg = messages.find(m => m.method === 'client/registerCapability');
    assert.ok(reg, 'client/registerCapability notification sent');
    const watchers = reg.params.registrations[0].registerOptions.watchers;
    assert.ok(watchers.some(w => w.globPattern === '**/*.md'), '**/*.md watcher registered');
});

// ── Rename tests ──────────────────────────────────────────────────────────────

test('LSP rename returns WorkspaceEdit with text edits and backing file rename for canonical note files', () => {
    // mission-klendathu.md line 4: participants: "[[rico]]"
    // "[[" starts at char 16, "rico" at chars 18-21
    const docUri  = uri + '/mission-klendathu.md';
    const docText = FIXTURE['mission-klendathu.md'];
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/rename', params: {
            textDocument: { uri: docUri },
            position: { line: 4, character: 19 }, // inside [[rico]]
            newName: 'juan-rico'
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const ren = messages.find(m => m.id === 2);
    assert.ok(ren, 'rename response present');
    assert.ok(ren.result, 'non-null WorkspaceEdit result');
    assert.ok(Array.isArray(ren.result.documentChanges), 'result has documentChanges');
    const renameOp = ren.result.documentChanges.find((entry) => entry.kind === 'rename');
    assert.ok(renameOp, 'rename operation present');
    assert.ok(renameOp.oldUri.endsWith('rico.md'), 'old note file renamed from rico.md');
    assert.ok(renameOp.newUri.endsWith('juan-rico.md'), 'new note file renamed to juan-rico.md');

    const sourceEdit = ren.result.documentChanges.find((entry) =>
        entry.textDocument
        && entry.textDocument.uri.endsWith('juan-rico.md')
    );
    assert.ok(sourceEdit, 'source note edits follow renamed file URI');
    assert.ok(sourceEdit.edits.some((edit) => edit.newText === 'juan-rico'), 'source id field updated');

    assert.ok(ren.result.changes, 'cross-file changes map still present');
    const allUris = Object.keys(ren.result.changes);
    // mission-klendathu.md must have a [[rico]] → [[juan-rico]] update
    const missionUri = allUris.find(u => u.endsWith('mission-klendathu.md'));
    assert.ok(missionUri, 'mission-klendathu.md included in changes');
    const missionEdits = ren.result.changes[missionUri];
    assert.ok(missionEdits.some(e => e.newText === 'juan-rico'), 'wikilink updated to new ID');
});

test('LSP rename preserves custom source filenames while still updating ids and references', () => {
    const customVault = createVault({
        'Juan Rico Profile.md': [
            '---',
            'id: rico',
            'type: contact',
            'name: Juan Rico',
            '---'
        ].join('\n'),
        'mission.md': 'See [[rico]] here\n'
    });
    const customUri = rootUri(customVault.dir);
    const docUri = customUri + '/mission.md';
    try {
        const { messages } = lsp(customVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: customUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: 'See [[rico]] here\n' }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/rename', params: {
                textDocument: { uri: docUri },
                position: { line: 0, character: 8 },
                newName: 'juan-rico'
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const ren = messages.find((m) => m.id === 2);
        assert.ok(ren?.result, 'rename response present');
        assert.ok(!Array.isArray(ren.result.documentChanges) || !ren.result.documentChanges.some((entry) => entry.kind === 'rename'), 'custom file name not auto-renamed');
        assert.ok(ren.result.changes, 'changes map still returned');
        const sourceUri = Object.keys(ren.result.changes).find((entry) => entry.endsWith('Juan%20Rico%20Profile.md') || entry.endsWith('Juan Rico Profile.md'));
        assert.ok(sourceUri, 'custom source note still edited in place');
        assert.ok(ren.result.changes[sourceUri].some((edit) => edit.newText === 'juan-rico'), 'source id updated in place');
    } finally {
        customVault.destroy();
    }
});

test('LSP rename returns error for unknown ID', () => {
    const docUri  = uri + '/unknown-ref.md';
    const docText = 'See [[ghost-note]] here';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/rename', params: {
            textDocument: { uri: docUri },
            position: { line: 0, character: 10 }, // inside [[ghost-note]]
            newName: 'new-name'
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const ren = messages.find(m => m.id === 2);
    assert.ok(ren, 'rename response present');
    assert.ok(ren.error, 'error response for unknown ID');
    assert.match(ren.error.message, /ghost-note/);
});

test('LSP rename returns content-modified for stale document versions', () => {
    const docUri  = uri + '/rename-stale.md';
    const docText = 'See [[rico]] here';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
            textDocument: { uri: docUri, version: 2 },
            contentChanges: [{ text: 'See [[roughnecks]] here' }]
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/rename', params: {
            textDocument: { uri: docUri, version: 1 },
            position: { line: 0, character: 8 },
            newName: 'juan-rico'
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const ren = messages.find(m => m.id === 2);
    assert.ok(ren?.error, 'rename stale error present');
    assert.equal(ren.error.code, -32801);
});

// ── Code action tests ─────────────────────────────────────────────────────────

test('LSP codeAction returns quickfix for broken-link diagnostic', () => {
    const docUri  = uri + '/needs-fix.md';
    const docText = 'See [[phantom-note]] here';
    const brokenDiag = {
        range:    { start: { line: 0, character: 4 }, end: { line: 0, character: 20 } },
        severity: 2,
        source:   'yamlink',
        message:  'Broken link: [[phantom-note]] — no note with this ID exists in the vault'
    };
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/codeAction', params: {
            textDocument: { uri: docUri },
            range:   { start: { line: 0, character: 4 }, end: { line: 0, character: 20 } },
            context: { diagnostics: [brokenDiag], only: ['quickfix'] }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const ca = messages.find(m => m.id === 2);
    assert.ok(ca, 'codeAction response present');
    assert.ok(Array.isArray(ca.result), 'result is array');
    assert.ok(ca.result.length > 0, 'at least one action returned');
    const fix = ca.result[0];
    assert.equal(fix.kind, 'quickfix', 'action kind is quickfix');
    assert.match(fix.title, /phantom-note/, 'action title mentions the broken ID');
    assert.ok(fix.edit.documentChanges, 'edit has documentChanges');
    const createOp = fix.edit.documentChanges.find(c => c.kind === 'create');
    assert.ok(createOp, 'create operation present');
    assert.match(createOp.uri, /phantom-note\.md$/, 'create targets correct file');
});

test('LSP codeAction returns empty array when no yamlink diagnostics', () => {
    const docUri  = uri + '/clean-doc.md';
    const docText = 'See [[rico]] here';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/codeAction', params: {
            textDocument: { uri: docUri },
            range:   { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            context: { diagnostics: [] }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const ca = messages.find(m => m.id === 2);
    assert.ok(ca, 'codeAction response present');
    assert.deepEqual(ca.result, [], 'empty array for no diagnostics');
});

test('LSP codeAction returns content-modified for stale document versions', () => {
    const docUri  = uri + '/code-action-stale.md';
    const docText = 'See [[phantom-note]] here';
    const brokenDiag = {
        range: { start: { line: 0, character: 4 }, end: { line: 0, character: 20 } },
        severity: 2,
        source: 'yamlink',
        code: 'yamlink.brokenLink',
        message: 'Broken link: [[phantom-note]] — no note with this ID exists in the vault'
    };
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
            textDocument: { uri: docUri, version: 2 },
            contentChanges: [{ text: 'See [[rico]] here' }]
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/codeAction', params: {
            textDocument: { uri: docUri, version: 1 },
            range: { start: { line: 0, character: 4 }, end: { line: 0, character: 20 } },
            context: { diagnostics: [brokenDiag], only: ['quickfix'] }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const ca = messages.find(m => m.id === 2);
    assert.ok(ca?.error, 'codeAction stale error present');
    assert.equal(ca.error.code, -32801);
});

// ── prepareRename tests ───────────────────────────────────────────────────────

test('LSP prepareRename returns range+placeholder for wikilink at cursor', () => {
    // mission-klendathu.md line 4: participants: "[[rico]]"
    const docUri  = uri + '/mission-klendathu.md';
    const docText = FIXTURE['mission-klendathu.md'];
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/prepareRename', params: {
            textDocument: { uri: docUri },
            position: { line: 4, character: 19 } // inside [[rico]]
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const pr = messages.find(m => m.id === 2);
    assert.ok(pr, 'prepareRename response present');
    assert.ok(pr.result, 'non-null result');
    assert.equal(pr.result.placeholder, 'rico', 'placeholder is the ID');
    assert.ok(pr.result.range, 'range present');
    assert.equal(pr.result.range.start.line, 4, 'range on correct line');
});

test('LSP prepareRename returns null for cursor not on wikilink or id: field', () => {
    const docUri  = uri + '/plain-text.md';
    const docText = '---\nid: plain\n---\n\nJust some text here.';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/prepareRename', params: {
            textDocument: { uri: docUri },
            position: { line: 4, character: 5 } // cursor in plain text
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const pr = messages.find(m => m.id === 2);
    assert.ok(pr, 'prepareRename response present');
    assert.equal(pr.result, null, 'null for non-renameable position');
});

test('LSP prepareRename returns null for unknown ID wikilink', () => {
    const docUri  = uri + '/broken-link.md';
    const docText = 'See [[no-such-note]] here';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/prepareRename', params: {
            textDocument: { uri: docUri },
            position: { line: 0, character: 10 } // inside [[no-such-note]]
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const pr = messages.find(m => m.id === 2);
    assert.ok(pr, 'prepareRename response present');
    assert.equal(pr.result, null, 'null for unknown ID');
});

test('LSP prepareRename resolves alias and piped wikilinks to the canonical note id', () => {
    const aliasVault = createVault({
        'rico.md': ['---', 'id: rico', 'type: contact', 'aliases: Johnny Rico', '---'].join('\n')
    });
    const aliasUri = rootUri(aliasVault.dir);
    const docUri  = aliasUri + '/alias.md';
    const docText = 'See [[Johnny Rico|Rico]].';
    try {
        const { messages } = lsp(aliasVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: aliasUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/prepareRename', params: {
                textDocument: { uri: docUri },
                position: { line: 0, character: 8 }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const pr = messages.find((m) => m.id === 2);
        assert.ok(pr, 'prepareRename response present');
        assert.equal(pr.result.placeholder, 'rico', 'placeholder is the canonical id');
    } finally {
        aliasVault.destroy();
    }
});

// ── References tests ──────────────────────────────────────────────────────────

test('LSP references finds all [[rico]] wikilinks across the vault', () => {
    // rico is referenced in mission-klendathu.md as [[rico]]
    const docUri  = uri + '/rico.md';
    const docText = FIXTURE['rico.md'];
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/references', params: {
            textDocument: { uri: docUri },
            position: { line: 1, character: 5 }, // cursor on id: rico line
            context: { includeDeclaration: false }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const ref = messages.find(m => m.id === 2);
    assert.ok(ref, 'references response present');
    assert.ok(Array.isArray(ref.result), 'result is array');
    // mission-klendathu.md has [[rico]]
    const missionRef = ref.result.find(l => l.uri && l.uri.endsWith('mission-klendathu.md'));
    assert.ok(missionRef, 'reference in mission-klendathu.md found');
    assert.ok(missionRef.range, 'reference has range');
});

test('LSP references returns empty array for unknown ID', () => {
    const docUri  = uri + '/no-links.md';
    const docText = 'See [[ghost-note]] here';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/references', params: {
            textDocument: { uri: docUri },
            position: { line: 0, character: 10 }, // inside [[ghost-note]]
            context: { includeDeclaration: false }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const ref = messages.find(m => m.id === 2);
    assert.ok(ref, 'references response present');
    assert.deepEqual(ref.result, [], 'empty for unknown ID');
});

test('LSP references with includeDeclaration includes the id: field', () => {
    const docUri  = uri + '/rico.md';
    const docText = FIXTURE['rico.md'];
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/references', params: {
            textDocument: { uri: docUri },
            position: { line: 1, character: 5 }, // id: rico
            context: { includeDeclaration: true }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const ref = messages.find(m => m.id === 2);
    assert.ok(ref, 'references response present');
    assert.ok(Array.isArray(ref.result), 'result is array');
    const decl = ref.result.find(l => l.uri && l.uri.endsWith('rico.md'));
    assert.ok(decl, 'declaration in rico.md included');
});

test('LSP references for a block ref match the exact scoped target only', () => {
    const blockId = buildTaskBlockId(1, 'Review recon logs');
    const refsVault = createVault({
        'rico.md': [
            '---',
            'id: rico',
            'type: contact',
            '---',
            '',
            '- [ ] Review recon logs'
        ].join('\n'),
        'source-a.md': `See [[rico^${blockId}]].\n`,
        'source-b.md': 'See [[rico]].\n'
    });

    try {
        const refsUri = rootUri(refsVault.dir);
        const docUri = refsUri + '/source-a.md';
        const docText = `See [[rico^${blockId}]].\n`;
        const { messages } = lsp(refsVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: refsUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/references', params: {
                textDocument: { uri: docUri },
                position: { line: 0, character: 8 },
                context: { includeDeclaration: false }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const ref = messages.find((m) => m.id === 2);
        assert.ok(ref, 'references response present');
        assert.ok(Array.isArray(ref.result), 'result is array');
        assert.equal(ref.result.length, 1, 'only the scoped block ref is returned');
        assert.match(ref.result[0].uri, /source-a\.md$/);
    } finally {
        refsVault.destroy();
    }
});

test('LSP references from an alias wikilink include canonical and aliased references to the same note', () => {
    const aliasVault = createVault({
        'rico.md': ['---', 'id: rico', 'type: contact', 'aliases: Johnny Rico', '---'].join('\n'),
        'a.md': 'See [[Johnny Rico]].\n',
        'b.md': 'See [[rico|Rico]].\n',
        'c.md': 'See [[rico]].\n'
    });
    try {
        const aliasUri = rootUri(aliasVault.dir);
        const { messages } = lsp(aliasVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: aliasUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: aliasUri + '/a.md', languageId: 'markdown', version: 1, text: 'See [[Johnny Rico]].\n' }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/references', params: {
                textDocument: { uri: aliasUri + '/a.md' },
                position: { line: 0, character: 8 },
                context: { includeDeclaration: false }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const ref = messages.find((m) => m.id === 2);
        assert.ok(ref, 'references response present');
        assert.equal(ref.result.length, 3, 'all canonical and alias references are returned');
        assert.ok(ref.result.some((entry) => entry.uri.endsWith('/a.md')));
        assert.ok(ref.result.some((entry) => entry.uri.endsWith('/b.md')));
        assert.ok(ref.result.some((entry) => entry.uri.endsWith('/c.md')));
    } finally {
        aliasVault.destroy();
    }
});

// ── Document symbols tests ────────────────────────────────────────────────────

test('LSP documentSymbols returns frontmatter fields and body headings', () => {
    const docUri = uri + '/sym-test.md';
    const docText = [
        '---',
        'id: sym-test',
        'type: contact',
        'name: Sym Test',
        '---',
        '',
        '## Overview',
        '',
        'Some text.',
        '',
        '### Details',
    ].join('\n');
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/documentSymbols', params: {
            textDocument: { uri: docUri }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const sym = messages.find(m => m.id === 2);
    assert.ok(sym, 'documentSymbols response present');
    assert.ok(Array.isArray(sym.result), 'result is array');
    assert.equal(sym.result.length, 1, 'hierarchical note root returned');
    const root = sym.result[0];
    assert.equal(root.name, 'Sym Test');
    assert.equal(root.detail, 'contact');
    assert.ok(Array.isArray(root.children), 'root has children');
    const frontmatter = root.children.find((child) => child.name === 'Frontmatter');
    assert.ok(frontmatter, 'frontmatter section present');
    assert.ok(frontmatter.children.some((child) => child.name === 'id'), 'id field present');
    const overview = root.children.find((child) => child.name === 'Overview');
    assert.ok(overview, 'Overview heading present');
    assert.equal(overview.kind, 15, 'heading kind = 15');
    assert.ok(overview.children.some((child) => child.name === 'Details'), 'nested subheading present');
});

test('LSP documentSymbols returns empty array for document with no frontmatter or headings', () => {
    const docUri  = uri + '/no-structure.md';
    const docText = 'Just plain prose with no structure.';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/documentSymbols', params: {
            textDocument: { uri: docUri }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const sym = messages.find(m => m.id === 2);
    assert.ok(sym, 'documentSymbols response present');
    assert.equal(sym.result.length, 1, 'root symbol still returned for flat prose');
    assert.equal(sym.result[0].name, 'no-structure');
    assert.deepEqual(sym.result[0].children, [], 'flat prose has no child structure');
});

test('LSP documentSymbols can read from disk when the document is not open', () => {
    const symbolVault = createVault({
        'symbol-note.md': [
            '---',
            'id: symbol-note',
            'type: contact',
            'name: Symbol Note',
            '---',
            '',
            '## Overview'
        ].join('\n')
    });
    try {
        const symbolUri = rootUri(symbolVault.dir);
        const docUri = symbolUri + '/symbol-note.md';
        const { messages } = lsp(symbolVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: symbolUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/documentSymbols', params: {
                textDocument: { uri: docUri }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const sym = messages.find((m) => m.id === 2);
        assert.ok(sym, 'documentSymbols response present');
        assert.equal(sym.result.length, 1, 'single root symbol returned');
        const root = sym.result[0];
        assert.equal(root.name, 'Symbol Note');
        const frontmatterGroup = root.children.find((entry) => entry.name === 'Frontmatter');
        assert.ok(frontmatterGroup, 'frontmatter group loaded from disk');
        assert.ok(frontmatterGroup.children.some((entry) => entry.name === 'id'), 'frontmatter field loaded from disk');
        assert.ok(root.children.some((entry) => entry.name === 'Overview'), 'heading loaded from disk');
    } finally {
        symbolVault.destroy();
    }
});

test('LSP selectionRange returns nested frontmatter and section scopes', () => {
    const selectionVault = createVault({
        'selection-note.md': [
            '---',
            'id: selection-note',
            'type: note',
            '---',
            '',
            '## Overview',
            'Body line',
            '',
            '### Details',
            'More body'
        ].join('\n')
    });
    try {
        const selectionUri = rootUri(selectionVault.dir);
        const docUri = selectionUri + '/selection-note.md';
        const docText = [
            '---',
            'id: selection-note',
            'type: note',
            '---',
            '',
            '## Overview',
            'Body line',
            '',
            '### Details',
            'More body'
        ].join('\n');
        const { messages } = lsp(selectionVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: selectionUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/selectionRange', params: {
                textDocument: { uri: docUri },
                positions: [
                    { line: 1, character: 2 },
                    { line: 9, character: 3 }
                ]
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const result = messages.find((m) => m.id === 2);
        assert.ok(result, 'selectionRange response present');
        assert.equal(result.result.length, 2);

        const frontmatterChain = result.result[0];
        assert.equal(frontmatterChain.range.start.line, 1, 'field line starts on id field');
        assert.equal(frontmatterChain.parent.range.start.line, 0, 'frontmatter parent starts at document frontmatter');
        assert.equal(frontmatterChain.parent.parent.range.start.line, 0, 'root parent covers whole note');

        const bodyChain = result.result[1];
        assert.equal(bodyChain.range.start.line, 9, 'base selection starts on body line');
        assert.equal(bodyChain.parent.range.start.line, 8, 'innermost section is Details');
        assert.equal(bodyChain.parent.parent.range.start.line, 5, 'outer section is Overview');
        assert.ok(bodyChain.parent.parent.parent, 'root parent exists for body selection');
    } finally {
        selectionVault.destroy();
    }
});

test('LSP foldingRange returns frontmatter and heading sections from disk', () => {
    const symbolVault = createVault({
        'folding-note.md': [
            '---',
            'id: folding-note',
            'type: note',
            '---',
            '',
            '## Overview',
            'Body line',
            '',
            '### Details',
            'More body'
        ].join('\n')
    });
    try {
        const symbolUri = rootUri(symbolVault.dir);
        const docUri = symbolUri + '/folding-note.md';
        const { messages } = lsp(symbolVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: symbolUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/foldingRange', params: {
                textDocument: { uri: docUri }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const folding = messages.find((m) => m.id === 2);
        assert.ok(folding, 'foldingRange response present');
        assert.ok(folding.result.some((entry) => entry.startLine === 0 && entry.endLine === 3), 'frontmatter fold returned');
        assert.ok(folding.result.some((entry) => entry.startLine === 5 && entry.endLine >= 6), 'overview section fold returned');
        assert.ok(folding.result.some((entry) => entry.startLine === 8 && entry.endLine === 9), 'nested section fold returned');
    } finally {
        symbolVault.destroy();
    }
});

// ── workspace/symbol tests ────────────────────────────────────────────────────

test('LSP workspace/symbol returns all vault notes when query is empty', () => {
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: '' } }),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const ws = messages.find(m => m.id === 2);
    assert.ok(ws, 'workspace/symbol response present');
    assert.ok(Array.isArray(ws.result), 'result is array');
    assert.equal(ws.result.length, 3, 'all 3 vault notes returned');
    for (const s of ws.result) {
        assert.ok(s.name, 'symbol has name');
        assert.ok(s.location && s.location.uri, 'symbol has location.uri');
        assert.equal(s.kind, 5, 'symbol kind = 5 (Class)');
    }
});

test('LSP workspace/symbol filters by query string', () => {
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'rico' } }),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const ws = messages.find(m => m.id === 2);
    assert.ok(ws, 'workspace/symbol response present');
    assert.ok(Array.isArray(ws.result), 'result is array');
    assert.ok(ws.result.length >= 1, 'at least one result for "rico"');
    assert.ok(ws.result.some(s => s.location.uri.endsWith('rico.md')), 'rico.md in results');
});

test('LSP workspace/symbol returns empty array for non-matching query', () => {
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', id: 2, method: 'workspace/symbol', params: { query: 'zzzznotexist' } }),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const ws = messages.find(m => m.id === 2);
    assert.ok(ws, 'workspace/symbol response present');
    assert.deepEqual(ws.result, [], 'empty for non-matching query');
});

// ── Frontmatter completion tests ──────────────────────────────────────────────

test('LSP completion returns field key suggestions inside frontmatter', () => {
    const docUri  = uri + '/new-contact.md';
    const docText = '---\nid: new-contact\ntype: contact\nst';
    // cursor at end of 'st' on line 3 — frontmatter key context
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/completion', params: {
            textDocument: { uri: docUri },
            position: { line: 3, character: 2 }, // after 'st'
            context: { triggerKind: 1 }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const comp = messages.find(m => m.id === 2);
    assert.ok(comp, 'completion response present');
    assert.ok(Array.isArray(comp.result), 'result is array');
    // 'status' starts with 'st'
    const statusItem = comp.result.find(i => i.label === 'status');
    assert.ok(statusItem, 'status field key suggested');
    assert.equal(statusItem.kind, 10, 'kind = Property (10)');
    assert.ok(statusItem.insertText.includes(':'), 'insertText includes colon separator');
});

test('LSP completion returns type value suggestions for type: field in frontmatter', () => {
    const docUri  = uri + '/type-complete.md';
    // cursor after 'type: ' on line 1
    const docText = '---\ntype: ';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/completion', params: {
            textDocument: { uri: docUri },
            position: { line: 1, character: 6 }, // after 'type: '
            context: { triggerKind: 2, triggerCharacter: ':' }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const comp = messages.find(m => m.id === 2);
    assert.ok(comp, 'completion response present');
    assert.ok(Array.isArray(comp.result), 'result is array');
    // vault has contact, unit, mission types
    const labels = comp.result.map(i => i.label);
    assert.ok(labels.includes('contact'), 'contact type suggested');
    assert.ok(labels.includes('unit'), 'unit type suggested');
    assert.ok(labels.includes('mission'), 'mission type suggested');
    for (const item of comp.result) {
        assert.equal(item.kind, 12, 'kind = Value (12)');
    }
});

test('LSP $/cancelRequest is handled without error response', () => {
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        // Cancel a request that doesn't exist — should be silently ignored
        frame({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 999 } }),
        frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    // No error response for the cancel notification
    const cancelError = messages.find(m => m.error && m.id === null);
    assert.equal(cancelError, undefined, 'no error for $/cancelRequest notification');
    // Shutdown still worked
    const shutdown = messages.find(m => m.id === 2);
    assert.ok(shutdown, 'shutdown response present after cancel');
});

test('LSP $/cancelRequest suppresses a cancelled request response', () => {
    const docUri  = uri + '/cancel-hover.md';
    const docText = 'See [[rico]]';
    const { messages, status } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: {
            textDocument: { uri: docUri },
            position: { line: 0, character: 8 }
        }}),
        frame({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 2 } }),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    assert.equal(status, 0);
    const hover = messages.find(m => m.id === 2);
    assert.equal(hover, undefined, 'cancelled hover response is suppressed');
    const shutdown = messages.find(m => m.id === 3);
    assert.ok(shutdown, 'shutdown response still present after cancellation');
});

test('LSP $/cancelRequest can abort long-running workspace diagnostics', () => {
    const files = {};
    for (let i = 0; i < 2500; i++) {
        files[`note-${i}.md`] = `See [[missing-${i}]]\n`;
    }
    const cancelVault = createVault(files);
    const cancelUri = rootUri(cancelVault.dir);
    try {
        const startedAt = Date.now();
        const { messages, status } = lsp(cancelVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: cancelUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', id: 2, method: 'workspace/diagnostic', params: {} }),
            frame({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 2 } }),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const elapsed = Date.now() - startedAt;
        assert.equal(status, 0);
        assert.equal(messages.find((m) => m.id === 2), undefined, 'cancelled workspace diagnostic response is suppressed');
        assert.ok(messages.find((m) => m.id === 3), 'shutdown response still present');
        assert.ok(elapsed < 10000, 'cancelled long-running request exits promptly');
    } finally {
        cancelVault.destroy();
    }
});

test('LSP callHierarchy returns incoming and outgoing linked notes', () => {
    const ricoDocText = [
        '---',
        'id: rico',
        'type: contact',
        'name: Juan Rico',
        '---',
        '',
        'See [[roughnecks]] and [[carmen]].'
    ].join('\n');
    const hierarchyVault = createVault({
        'rico.md': ricoDocText,
        'roughnecks.md': [
            '---',
            'id: roughnecks',
            'type: unit',
            'name: Roughnecks',
            '---',
            '',
            'Unit note.'
        ].join('\n'),
        'carmen.md': [
            '---',
            'id: carmen',
            'type: contact',
            'name: Carmen',
            '---'
        ].join('\n'),
        'mission.md': [
            '---',
            'id: mission',
            'type: mission',
            '---',
            '',
            'Participants: [[rico]]'
        ].join('\n')
    });
    const hierarchyUri = rootUri(hierarchyVault.dir);
    const docUri = hierarchyUri + '/rico.md';
    try {
        const { messages } = lsp(hierarchyVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: hierarchyUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: {
                    uri: docUri,
                    languageId: 'markdown',
                    version: 1,
                    text: ricoDocText
                }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/prepareCallHierarchy', params: {
                textDocument: { uri: docUri },
                position: { line: 1, character: 5 }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'callHierarchy/outgoingCalls', params: {
                item: {
                    name: 'Juan Rico',
                    kind: 5,
                    uri: docUri,
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    data: { id: 'rico' }
                }
            }}),
            frame({ jsonrpc: '2.0', id: 4, method: 'callHierarchy/incomingCalls', params: {
                item: {
                    name: 'Juan Rico',
                    kind: 5,
                    uri: docUri,
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    data: { id: 'rico' }
                }
            }}),
            frame({ jsonrpc: '2.0', id: 5, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const prepared = messages.find((m) => m.id === 2);
        assert.ok(prepared, 'prepareCallHierarchy response present');
        assert.equal(prepared.result[0].data.id, 'rico');

        const outgoing = messages.find((m) => m.id === 3);
        assert.ok(outgoing, 'outgoingCalls response present');
        assert.ok(outgoing.result.some((entry) => entry.to.data.id === 'roughnecks'), 'roughnecks in outgoing calls');
        assert.ok(outgoing.result.some((entry) => entry.to.data.id === 'carmen'), 'carmen in outgoing calls');

        const incoming = messages.find((m) => m.id === 4);
        assert.ok(incoming, 'incomingCalls response present');
        assert.ok(incoming.result.some((entry) => entry.from.data.id === 'mission'), 'mission in incoming calls');
    } finally {
        hierarchyVault.destroy();
    }
});

test('LSP workspace/executeCommand returns note intelligence snapshot', () => {
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', id: 2, method: 'workspace/executeCommand', params: {
            command: 'yamlink.noteIntelligence',
            arguments: [{ id: 'rico' }]
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const cmd = messages.find(m => m.id === 2);
    assert.ok(cmd, 'executeCommand response present');
    assert.equal(cmd.result.id, 'rico');
    assert.equal(typeof cmd.result.lifecycle, 'object');
    assert.equal(typeof cmd.result.drift, 'object');
    assert.equal(typeof cmd.result.arc, 'object');
});

test('LSP workspace/executeCommand returns note arc snapshot', () => {
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', id: 2, method: 'workspace/executeCommand', params: {
            command: 'yamlink.noteArc',
            arguments: [{ id: 'rico' }]
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const cmd = messages.find(m => m.id === 2);
    assert.ok(cmd, 'executeCommand response present');
    assert.equal(cmd.result.id, 'rico');
    assert.ok(Array.isArray(cmd.result.missingFields));
});

test('LSP workspace/executeCommand returns field category snapshot', () => {
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', id: 2, method: 'workspace/executeCommand', params: {
            command: 'yamlink.fieldCategory',
            arguments: [{ id: 'rico', field: 'unit' }]
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const cmd = messages.find(m => m.id === 2);
    assert.ok(cmd, 'executeCommand response present');
    assert.equal(cmd.result.id, 'rico');
    assert.equal(cmd.result.field, 'unit');
    assert.ok(cmd.result.category);
    assert.ok(Array.isArray(cmd.result.expectedTypes));
    assert.ok(cmd.result.expectedTypes.includes('unit'));
    assert.equal(typeof cmd.result.surfaces, 'object');
    assert.equal(typeof cmd.result.surfaces.lightbulb?.level, 'number');
    assert.equal(typeof cmd.result.surfaces.completion?.level, 'number');
});

test('LSP workspace/executeCommand returns an edit plan for missing fields', () => {
    const cmdVault = createVault({
        'contact-1.md': ['---', 'id: contact-1', 'type: contact', 'name: Ace', 'status: active', 'unit: [[squad-alpha]]', '---'].join('\n'),
        'contact-2.md': ['---', 'id: contact-2', 'type: contact', 'name: Carmen', 'status: active', 'homeworld: Luna', 'unit: [[squad-alpha]]', '---'].join('\n'),
        'contact-3.md': ['---', 'id: contact-3', 'type: contact', 'name: Dizzy', 'status: reserve', 'homeworld: Buenos Aires', 'unit: [[squad-alpha]]', '---'].join('\n'),
        'draft.md': ['---', 'id: draft', 'type: contact', 'name: Draft Contact', '---'].join('\n'),
        'squad-alpha.md': ['---', 'id: squad-alpha', 'type: unit', 'name: Alpha Squad', '---'].join('\n')
    });
    const cmdUri = rootUri(cmdVault.dir);
    try {
        const { messages } = lsp(cmdVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: cmdUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', id: 2, method: 'workspace/executeCommand', params: {
                command: 'yamlink.addMissingFields',
                arguments: [{ id: 'draft' }]
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const cmd = messages.find((m) => m.id === 2);
        assert.ok(cmd, 'executeCommand response present');
        assert.equal(cmd.result.ok, true);
        assert.ok(Array.isArray(cmd.result.missingFields));
        assert.ok(cmd.result.missingFields.includes('unit') || cmd.result.missingFields.includes('homeworld'));
        assert.ok(cmd.result.edit, 'workspace edit returned');
    } finally {
        cmdVault.destroy();
    }
});

test('LSP workspace/executeCommand addMissingFields returns content-modified for stale document versions', () => {
    const cmdVault = createVault({
        'contact-1.md': ['---', 'id: contact-1', 'type: contact', 'name: Ace', 'status: active', 'unit: [[squad-alpha]]', '---'].join('\n'),
        'draft.md': ['---', 'id: draft', 'type: contact', 'name: Draft Contact', '---'].join('\n'),
        'squad-alpha.md': ['---', 'id: squad-alpha', 'type: unit', 'name: Alpha Squad', '---'].join('\n')
    });
    const cmdUri = rootUri(cmdVault.dir);
    const draftUri = cmdUri + '/draft.md';
    const draftText = ['---', 'id: draft', 'type: contact', 'name: Draft Contact', '---'].join('\n');
    try {
        const { messages } = lsp(cmdVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: cmdUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: draftUri, languageId: 'markdown', version: 1, text: draftText }
            }}),
            frame({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
                textDocument: { uri: draftUri, version: 2 },
                contentChanges: [{ text: draftText + '\nstatus: active' }]
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'workspace/executeCommand', params: {
                command: 'yamlink.addMissingFields',
                arguments: [{ id: 'draft', version: 1 }]
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const cmd = messages.find((m) => m.id === 2);
        assert.ok(cmd?.error, 'stale addMissingFields error present');
        assert.equal(cmd.error.code, -32801);
    } finally {
        cmdVault.destroy();
    }
});

test('LSP workspace/executeCommand scaffolds missing identity for an open document', () => {
    const docUri = uri + '/draft-no-frontmatter.md';
    const docText = 'Body only draft.';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'workspace/executeCommand', params: {
            command: 'yamlink.scaffoldIdentity',
            arguments: [{ uri: docUri }]
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const cmd = messages.find((m) => m.id === 2);
    assert.ok(cmd, 'executeCommand response present');
    assert.equal(cmd.result.ok, true);
    assert.match(cmd.result.id, /draft-no-frontmatter/);
    assert.ok(cmd.result.edit, 'workspace edit returned');
});

test('LSP workspace/executeCommand scaffoldIdentity returns content-modified for stale document versions', () => {
    const docUri = uri + '/draft-stale-frontmatter.md';
    const docText = 'Body only draft.';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
            textDocument: { uri: docUri, version: 2 },
            contentChanges: [{ text: 'Changed body.' }]
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'workspace/executeCommand', params: {
            command: 'yamlink.scaffoldIdentity',
            arguments: [{ uri: docUri, version: 1 }]
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const cmd = messages.find((m) => m.id === 2);
    assert.ok(cmd?.error, 'stale scaffoldIdentity error present');
    assert.equal(cmd.error.code, -32801);
});

test('LSP workspace/executeCommand returns invalid-params for missing arguments', () => {
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', id: 2, method: 'workspace/executeCommand', params: {
            command: 'yamlink.fieldCategory',
            arguments: [{ id: 'rico' }]
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const cmd = messages.find(m => m.id === 2);
    assert.ok(cmd, 'executeCommand error response present');
    assert.equal(cmd.error.code, -32602);
    assert.match(cmd.error.message, /Missing param: field/);
});

test('LSP textDocument/diagnostic returns broken-link diagnostics on demand', () => {
    const docUri  = uri + '/diag-pull.md';
    const docText = 'See [[rico]] and [[ghost-note]]';
    const { messages } = lsp(vaultDir, [
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: uri, capabilities: {} } }),
        frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
        frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: docUri, languageId: 'markdown', version: 1, text: docText }
        }}),
        frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/diagnostic', params: {
            textDocument: { uri: docUri }
        }}),
        frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
        frame({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const diag = messages.find(m => m.id === 2);
    assert.ok(diag, 'diagnostic response present');
    assert.equal(diag.result.kind, 'full');
    assert.ok(Array.isArray(diag.result.items));
    assert.ok(diag.result.items.some((item) => /ghost-note/.test(item.message)));
});

test('LSP textDocument/diagnostic surfaces identity, drift, and schema-style diagnostics', () => {
    const richVault = createVault({
        'contact-1.md': ['---', 'id: contact-1', 'type: contact', 'name: Ace', 'status: active', 'homeworld: Luna', 'unit: [[alpha]]', '---'].join('\n'),
        'contact-2.md': ['---', 'id: contact-2', 'type: contact', 'name: Carmen', 'status: active', 'homeworld: Luna', 'unit: [[alpha]]', '---'].join('\n'),
        'contact-3.md': ['---', 'id: contact-3', 'type: contact', 'name: Dizzy', 'status: reserve', 'homeworld: Buenos Aires', 'unit: [[alpha]]', '---'].join('\n'),
        'alpha.md': ['---', 'id: alpha', 'type: unit', 'name: Alpha Squad', '---'].join('\n'),
        '_templates/contact.md': ['---', 'type: contact', 'name:', 'homeworld:', 'unit:', '---'].join('\n'),
        'draft.md': ['---', 'id: draft', 'type: contact', 'name: Draft Contact', '---'].join('\n')
    });
    const richUri = rootUri(richVault.dir);
    try {
        const { messages } = lsp(richVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: richUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/diagnostic', params: {
                textDocument: { uri: richUri + '/draft.md' }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const diag = messages.find((m) => m.id === 2);
        assert.ok(diag, 'diagnostic response present');
        assert.ok(diag.result.items.some((item) => item.code === 'yamlink.templateDrift' || item.code === 'yamlink.noteDrift'));
    } finally {
        richVault.destroy();
    }
});

test('LSP textDocument/diagnostic reports missing id and stays clean for valid note identity', () => {
    const diagnosticVault = createVault({});
    try {
        const diagnosticUri = rootUri(diagnosticVault.dir);
        const missingUri = diagnosticUri + '/missing-id.md';
        const missingText = [
            '---',
            'type: contact',
            '---',
            '',
            'No id here.'
        ].join('\n');
        const validUri = diagnosticUri + '/valid.md';
        const validText = [
            '---',
            'id: valid-note',
            'type: contact',
            '---',
            '',
            'All good.'
        ].join('\n');

        const { messages } = lsp(diagnosticVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: diagnosticUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: missingUri, languageId: 'markdown', version: 1, text: missingText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/diagnostic', params: {
                textDocument: { uri: missingUri }
            }}),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: validUri, languageId: 'markdown', version: 1, text: validText }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'textDocument/diagnostic', params: {
                textDocument: { uri: validUri }
            }}),
            frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);

        const missingDiag = messages.find((m) => m.id === 2);
        assert.ok(missingDiag, 'missing-id diagnostic response present');
        assert.ok(Array.isArray(missingDiag.result.items), 'diagnostic items are an array');
        assert.ok(missingDiag.result.items.some((item) => item.code === 'yamlink.missingId'), 'missing id diagnostic present');

        const validDiag = messages.find((m) => m.id === 3);
        assert.ok(validDiag, 'valid diagnostic response present');
        assert.deepEqual(validDiag.result.items, [], 'valid note returns no diagnostics');
    } finally {
        diagnosticVault.destroy();
    }
});

test('LSP formatting returns structured edits for disordered frontmatter and [] for clean notes', () => {
    const formattingVault = createVault({});
    try {
        const formattingUri = rootUri(formattingVault.dir);
        const messyUri = formattingUri + '/messy.md';
        const messyText = [
            '---',
            'type: contact',
            '',
            'id: rico',
            'status: active',
            '---',
            '',
            'Body.'
        ].join('\n');
        const cleanUri = formattingUri + '/clean.md';
        const cleanText = [
            '---',
            'id: clean-note',
            'type: contact',
            'status: active',
            '---',
            '',
            'Body.'
        ].join('\n');

        const { messages } = lsp(formattingVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: formattingUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: messyUri, languageId: 'markdown', version: 1, text: messyText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/formatting', params: {
                textDocument: { uri: messyUri },
                options: { tabSize: 2, insertSpaces: true }
            }}),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: cleanUri, languageId: 'markdown', version: 1, text: cleanText }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'textDocument/formatting', params: {
                textDocument: { uri: cleanUri },
                options: { tabSize: 2, insertSpaces: true }
            }}),
            frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);

        const messyResult = messages.find((m) => m.id === 2);
        assert.ok(messyResult);
        assert.ok(Array.isArray(messyResult.result));
        assert.ok(messyResult.result.length > 0);
        for (const edit of messyResult.result) {
            assert.equal(typeof edit, 'object');
            assert.equal(typeof edit.newText, 'string');
            assert.equal(typeof edit.range, 'object');
        }

        const cleanResult = messages.find((m) => m.id === 3);
        assert.ok(cleanResult);
        assert.deepEqual(cleanResult.result, []);
    } finally {
        formattingVault.destroy();
    }
});

test('LSP inlay hints return positioned relation hints and [] for notes without frontmatter', () => {
    const hintVault = createVault({
        'rico.md': ['---', 'id: rico', 'type: contact', 'name: Rico', '---'].join('\n')
    });
    try {
        const hintUri = rootUri(hintVault.dir);
        const relationUri = hintUri + '/relation.md';
        const relationText = [
            '---',
            'id: dizzy',
            'type: contact',
            'friend: "[[rico]]"',
            '---'
        ].join('\n');
        const plainUri = hintUri + '/plain.md';
        const plainText = 'No frontmatter here.';

        const { messages } = lsp(hintVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: hintUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: relationUri, languageId: 'markdown', version: 1, text: relationText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/inlayHint', params: {
                textDocument: { uri: relationUri },
                range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } }
            }}),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: plainUri, languageId: 'markdown', version: 1, text: plainText }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'textDocument/inlayHint', params: {
                textDocument: { uri: plainUri },
                range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } }
            }}),
            frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);

        const relationResult = messages.find((m) => m.id === 2);
        assert.ok(relationResult);
        assert.ok(Array.isArray(relationResult.result));
        assert.ok(relationResult.result.some((item) => (typeof item.label === 'string' || Array.isArray(item.label)) && item.position));

        const plainResult = messages.find((m) => m.id === 3);
        assert.ok(plainResult);
        assert.deepEqual(plainResult.result, []);
    } finally {
        hintVault.destroy();
    }
});

test('LSP semantic tokens/full returns encoded token arrays and [] for documents without wikilinks', () => {
    const semanticVault = createVault({});
    try {
        const semanticUri = rootUri(semanticVault.dir);
        const linkedUri = semanticUri + '/linked.md';
        const linkedText = 'See [[some-id]] in the body.';
        const plainUri = semanticUri + '/plain.md';
        const plainText = 'No links here.';

        const { messages } = lsp(semanticVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: semanticUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: linkedUri, languageId: 'markdown', version: 1, text: linkedText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/semanticTokens/full', params: {
                textDocument: { uri: linkedUri }
            }}),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: plainUri, languageId: 'markdown', version: 1, text: plainText }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'textDocument/semanticTokens/full', params: {
                textDocument: { uri: plainUri }
            }}),
            frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);

        const linkedResult = messages.find((m) => m.id === 2);
        assert.ok(linkedResult);
        assert.ok(linkedResult.result);
        assert.ok(Array.isArray(linkedResult.result.data));
        assert.equal(linkedResult.result.data.length % 5, 0);

        const plainResult = messages.find((m) => m.id === 3);
        assert.ok(plainResult);
        assert.deepEqual(plainResult.result, { data: [] });
    } finally {
        semanticVault.destroy();
    }
});

test('LSP diagnostic returns missingId items and [] for valid identity notes', () => {
    const diagnosticVault = createVault({});
    try {
        const diagnosticUri = rootUri(diagnosticVault.dir);
        const missingUri = diagnosticUri + '/missing.md';
        const missingText = ['---', 'type: contact', '---', '', 'Missing id.'].join('\n');
        const validUri = diagnosticUri + '/valid.md';
        const validText = ['---', 'id: valid-note', 'type: contact', '---', '', 'Valid note.'].join('\n');

        const { messages } = lsp(diagnosticVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: diagnosticUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: missingUri, languageId: 'markdown', version: 1, text: missingText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/diagnostic', params: {
                textDocument: { uri: missingUri }
            }}),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: validUri, languageId: 'markdown', version: 1, text: validText }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'textDocument/diagnostic', params: {
                textDocument: { uri: validUri }
            }}),
            frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);

        const missingResult = messages.find((m) => m.id === 2);
        assert.ok(missingResult);
        assert.ok(Array.isArray(missingResult.result.items));
        assert.ok(missingResult.result.items.some((item) => item.code === 'yamlink.missingId'));

        const validResult = messages.find((m) => m.id === 3);
        assert.ok(validResult);
        assert.deepEqual(validResult.result, { kind: 'full', items: [] });
    } finally {
        diagnosticVault.destroy();
    }
});

test('LSP codeAction offers scaffold and missing-field quickfixes for Yamlink diagnostics', () => {
    const actionsVault = createVault({
        '_templates/contact.md': ['---', 'type: contact', 'name:', 'homeworld:', '---'].join('\n')
    });
    const actionsUri = rootUri(actionsVault.dir);
    const draftUri = actionsUri + '/draft.md';
    try {
        const { messages } = lsp(actionsVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: actionsUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: draftUri, languageId: 'markdown', version: 1, text: 'Body only note.' }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/codeAction', params: {
                textDocument: { uri: draftUri },
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                context: {
                    diagnostics: [{
                        source: 'yamlink',
                        code: 'yamlink.missingId',
                        message: 'Yamlink: This file has no id field and will not be indexed as a note.',
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                        data: { action: 'scaffoldIdentity' }
                    }]
                }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const actions = messages.find((m) => m.id === 2);
        assert.ok(actions, 'codeAction response present');
        assert.ok(Array.isArray(actions.result));
        assert.ok(actions.result.some((action) => /Scaffold Yamlink identity/.test(action.title)));
    } finally {
        actionsVault.destroy();
    }
});

test('LSP codeAction offers duplicate-id and schema repair quickfixes for Yamlink diagnostics', () => {
    const actionsVault = createVault({
        'shared.md': ['---', 'id: shared', 'type: note', '---'].join('\n'),
        'other.md': ['---', 'id: shared', 'type: note', '---'].join('\n'),
        'contact-schema.md': ['---', 'id: contact-schema', 'type: schema', '---'].join('\n'),
        'mission-schema.md': ['---', 'id: mission-schema', 'type: schema', 'target: contact', '---'].join('\n'),
        'contact-canonical.md': ['---', 'id: contact-canonical', 'type: schema', 'target: contact', '---'].join('\n')
    });
    const actionsUri = rootUri(actionsVault.dir);
    const duplicateUri = actionsUri + '/other.md';
    const malformedUri = actionsUri + '/contact-schema.md';
    const duplicateSchemaUri = actionsUri + '/mission-schema.md';
    try {
        const { messages } = lsp(actionsVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: actionsUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: duplicateUri, languageId: 'markdown', version: 1, text: '---\nid: shared\ntype: note\n---' }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/codeAction', params: {
                textDocument: { uri: duplicateUri },
                range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
                context: {
                    diagnostics: [{
                        source: 'yamlink',
                        code: 'yamlink.duplicateId',
                        message: 'Yamlink: id "shared" is declared in multiple files.',
                        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
                        data: { id: 'shared' }
                    }]
                }
            }}),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: malformedUri, languageId: 'markdown', version: 1, text: '---\nid: contact-schema\ntype: schema\n---' }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'textDocument/codeAction', params: {
                textDocument: { uri: malformedUri },
                range: { start: { line: 2, character: 0 }, end: { line: 2, character: 12 } },
                context: {
                    diagnostics: [{
                        source: 'yamlink',
                        code: 'yamlink.malformedSchema',
                        message: 'Yamlink: Schema note is missing a target: field.',
                        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 12 } }
                    }]
                }
            }}),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: duplicateSchemaUri, languageId: 'markdown', version: 1, text: '---\nid: mission-schema\ntype: schema\ntarget: contact\n---' }
            }}),
            frame({ jsonrpc: '2.0', id: 4, method: 'textDocument/codeAction', params: {
                textDocument: { uri: duplicateSchemaUri },
                range: { start: { line: 3, character: 0 }, end: { line: 3, character: 15 } },
                context: {
                    diagnostics: [{
                        source: 'yamlink',
                        code: 'yamlink.duplicateSchema',
                        message: 'Yamlink: A schema for "contact" already exists.',
                        range: { start: { line: 3, character: 0 }, end: { line: 3, character: 15 } }
                    }]
                }
            }}),
            frame({ jsonrpc: '2.0', id: 5, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);

        const duplicateActions = messages.find((m) => m.id === 2);
        assert.ok(duplicateActions, 'duplicate-id codeAction response present');
        assert.ok(duplicateActions.result.some((action) => /Change id to/.test(action.title)));

        const malformedActions = messages.find((m) => m.id === 3);
        assert.ok(malformedActions, 'malformed-schema codeAction response present');
        assert.ok(malformedActions.result.some((action) => /Add schema target: contact/.test(action.title)));

        const duplicateSchemaActions = messages.find((m) => m.id === 4);
        assert.ok(duplicateSchemaActions, 'duplicate-schema codeAction response present');
        assert.ok(duplicateSchemaActions.result.some((action) => /Retarget schema to "mission"/.test(action.title)));
    } finally {
        actionsVault.destroy();
    }
});

test('LSP codeAction offers refactor.rewrite actions for frontmatter normalization and relation wikilinks', () => {
    const refactorVault = createVault({
        'roughnecks.md': ['---', 'id: roughnecks', 'type: unit', 'name: Roughnecks', '---'].join('\n'),
        'rico.md': ['---', 'id: rico', 'type: contact', 'unit: "[[roughnecks]]"', '---'].join('\n')
    });
    const refactorUri = rootUri(refactorVault.dir);
    const draftUri = refactorUri + '/draft.md';
    const draftText = [
        '---',
        'unit: roughnecks',
        'type: contact',
        'id: dizzy',
        '---',
        '',
        'Draft body.'
    ].join('\n');
    try {
        const { messages } = lsp(refactorVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: refactorUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
                textDocument: { uri: draftUri, languageId: 'markdown', version: 1, text: draftText }
            }}),
            frame({ jsonrpc: '2.0', id: 2, method: 'textDocument/codeAction', params: {
                textDocument: { uri: draftUri },
                range: { start: { line: 0, character: 0 }, end: { line: 6, character: 0 } },
                context: {
                    only: ['refactor.rewrite'],
                    diagnostics: []
                }
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const actions = messages.find((m) => m.id === 2);
        assert.ok(actions, 'refactor codeAction response present');
        assert.ok(Array.isArray(actions.result));

        const normalize = actions.result.find((action) => action.title === 'Normalize Yamlink frontmatter');
        assert.ok(normalize, 'normalization refactor present');
        assert.equal(normalize.kind, 'refactor.rewrite');

        const convert = actions.result.find((action) => action.title === 'Convert relation fields to wikilinks');
        assert.ok(convert, 'relation conversion refactor present');
        assert.equal(convert.kind, 'refactor.rewrite');
        assert.equal(convert.edit.changes[draftUri][0].newText, '"[[roughnecks]]"');
    } finally {
        refactorVault.destroy();
    }
});

test('LSP workspace/diagnostic returns vault-wide diagnostic report items', () => {
    const brokenVault = createVault({
        'ghost.md': 'See [[ghost-target]]\n',
        'known.md': '---\nid: known\ntype: note\n---\n'
    });
    const brokenUri = rootUri(brokenVault.dir);
    try {
        const { messages } = lsp(brokenVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: brokenUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', id: 2, method: 'workspace/diagnostic', params: {} }),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const diag = messages.find(m => m.id === 2);
        assert.ok(diag, 'workspace diagnostic response present');
        assert.ok(Array.isArray(diag.result.items));
        assert.ok(diag.result.items.some((entry) =>
            entry.uri.endsWith('ghost.md')
            && Array.isArray(entry.items)
            && entry.items.some((item) => /ghost-target/.test(item.message))
        ));
    } finally {
        brokenVault.destroy();
    }
});

test('LSP workspace/codeAction returns vault-wide quickfixes for diagnostic report items', () => {
    const brokenVault = createVault({
        'ghost.md': 'See [[ghost-target]]\n',
        'untitled.md': 'Plain body only\n'
    });
    const brokenUri = rootUri(brokenVault.dir);
    try {
        const { messages } = lsp(brokenVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: brokenUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', id: 2, method: 'workspace/diagnostic', params: {} }),
            frame({ jsonrpc: '2.0', id: 3, method: 'workspace/codeAction', params: {
                context: {
                    items: []
                }
            }}),
            frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const diag = messages.find((m) => m.id === 2);
        assert.ok(diag, 'workspace diagnostic response present');

        const actionRequest = {
            jsonrpc: '2.0',
            id: 3,
            method: 'workspace/codeAction',
            params: {
                context: {
                    items: diag.result.items
                }
            }
        };
        const rerun = lsp(brokenVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: brokenUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame(actionRequest),
            frame({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const actions = rerun.messages.find((m) => m.id === 3);
        assert.ok(actions, 'workspace codeAction response present');
        assert.ok(actions.result.some((action) => action.title === 'Scaffold Yamlink identity frontmatter'), 'missing-id fix present');
        assert.ok(actions.result.some((action) => /Create note "ghost-target"/.test(action.title)), 'broken-link fix present');
    } finally {
        brokenVault.destroy();
    }
});

test('LSP workspace/diagnostic skips _templates and .yamlinkignore paths', () => {
    const scopedVault = createVault({
        '.yamlinkignore': 'ignored/\nignored-note.md\n',
        'ghost.md': 'See [[ghost-target]]\n',
        '_templates/template.md': 'See [[template-ghost]]\n',
        'ignored/nested.md': 'See [[nested-ghost]]\n',
        'ignored-note.md': 'See [[ignored-ghost]]\n'
    });
    const scopedUri = rootUri(scopedVault.dir);
    try {
        const { messages } = lsp(scopedVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: scopedUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', id: 2, method: 'workspace/diagnostic', params: {} }),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        const diag = messages.find((m) => m.id === 2);
        assert.ok(diag, 'workspace diagnostic response present');
        assert.ok(Array.isArray(diag.result.items));

        const uris = diag.result.items.map((entry) => entry.uri);
        assert.ok(uris.some((entry) => entry.endsWith('ghost.md')), 'real indexed workspace note included');
        assert.ok(!uris.some((entry) => entry.includes('_templates/template.md')), '_templates note excluded');
        assert.ok(!uris.some((entry) => entry.includes('ignored/nested.md')), 'ignored directory note excluded');
        assert.ok(!uris.some((entry) => entry.endsWith('ignored-note.md')), 'ignored file excluded');
    } finally {
        scopedVault.destroy();
    }
});

test('LSP workspace/diagnostic streams work-done and partial-result progress notifications', () => {
    const files = {};
    for (let i = 0; i < 80; i++) {
        files[`note-${i}.md`] = `See [[missing-${i}]]\n`;
    }
    const progressVault = createVault(files);
    const progressUri = rootUri(progressVault.dir);
    try {
        const { messages, status } = lsp(progressVault.dir, [
            frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: progressUri, capabilities: {} } }),
            frame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
            frame({ jsonrpc: '2.0', id: 2, method: 'workspace/diagnostic', params: {
                workDoneToken: 'wd-1',
                partialResultToken: 'part-1'
            }}),
            frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
            frame({ jsonrpc: '2.0', method: 'exit' }),
        ]);
        assert.equal(status, 0);

        const progress = messages.filter((m) => m.method === '$/progress');
        assert.ok(progress.some((m) => m.params?.token === 'wd-1' && m.params?.value?.kind === 'begin'), 'work-done begin sent');
        assert.ok(progress.some((m) => m.params?.token === 'wd-1' && m.params?.value?.kind === 'report'), 'work-done report sent');

        const partials = progress.filter((m) => m.params?.token === 'part-1');
        assert.ok(partials.length >= 1, 'partial result batches streamed');
        assert.ok(partials.every((m) => Array.isArray(m.params?.value?.items)), 'partial batches contain diagnostic items');

    } finally {
        progressVault.destroy();
    }
});
