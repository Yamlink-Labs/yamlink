'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { performance } = require('perf_hooks');

const BIN = path.resolve(__dirname, '..', 'bin', 'yamlink.js');

function parseArgs(argv) {
    const options = {
        notes: 5000,
        maxInitMs: 15000,
        maxCompletionMs: 750,
        maxHoverMs: 250,
        maxReferencesMs: 2500,
        maxDiagnosticMs: 1500,
        maxWorkspaceSymbolMs: 1000,
        maxFormattingMs: 500,
        maxCodeActionMs: 300,
        maxRenameMs: 2500,
        timeoutMs: 30000
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];
        if (arg === '--notes' && next) options.notes = Number(next);
        if (arg === '--max-init-ms' && next) options.maxInitMs = Number(next);
        if (arg === '--max-completion-ms' && next) options.maxCompletionMs = Number(next);
        if (arg === '--max-hover-ms' && next) options.maxHoverMs = Number(next);
        if (arg === '--max-references-ms' && next) options.maxReferencesMs = Number(next);
        if (arg === '--max-diagnostic-ms' && next) options.maxDiagnosticMs = Number(next);
        if (arg === '--max-workspace-symbol-ms' && next) options.maxWorkspaceSymbolMs = Number(next);
        if (arg === '--max-formatting-ms' && next) options.maxFormattingMs = Number(next);
        if (arg === '--max-code-action-ms' && next) options.maxCodeActionMs = Number(next);
        if (arg === '--max-rename-ms' && next) options.maxRenameMs = Number(next);
        if (arg === '--timeout-ms' && next) options.timeoutMs = Number(next);
    }

    return options;
}

function assertFinitePositive(value, label) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid ${label}: ${value}`);
    }
}

function frame(message) {
    const json = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
}

function createVaultDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-lsp-scale-'));
}

function writeSyntheticVault(vaultDir, noteCount) {
    const hubId = 'hub-central';
    const sectionCount = 25;
    for (let i = 0; i < noteCount; i++) {
        const id = `note-${String(i).padStart(4, '0')}`;
        const nextId = `note-${String((i + 1) % noteCount).padStart(4, '0')}`;
        const prevId = `note-${String((i - 1 + noteCount) % noteCount).padStart(4, '0')}`;
        const sectionId = `section-${String(i % sectionCount).padStart(2, '0')}`;
        const type = i % 5 === 0 ? 'project' : i % 2 === 0 ? 'contact' : 'note';
        const status = i % 3 === 0 ? 'active' : i % 3 === 1 ? 'draft' : 'archived';
        const tags = `[scale-${i % 10}, batch-${Math.floor(i / 250)}]`;
        const outbound = [
            `[[${hubId}]]`,
            `[[${nextId}]]`,
            `[[${prevId}]]`,
            `[[${sectionId}]]`
        ];
        const content = [
            '---',
            `id: ${id}`,
            `type: ${type}`,
            `name: Synthetic Note ${i}`,
            `status: ${status}`,
            `owner: "[[${hubId}]]"`,
            `section: "[[${sectionId}]]"`,
            `tags: ${tags}`,
            '---',
            '',
            `Synthetic body for ${id}.`,
            '',
            `Links: ${outbound.join(' · ')}`,
            '',
            `This vault exists to test LSP scale on ${noteCount} notes.`
        ].join('\n');
        fs.writeFileSync(path.join(vaultDir, `${id}.md`), content, 'utf8');
    }

    for (let i = 0; i < sectionCount; i++) {
        const id = `section-${String(i).padStart(2, '0')}`;
        fs.writeFileSync(path.join(vaultDir, `${id}.md`), [
            '---',
            `id: ${id}`,
            'type: section',
            `name: Section ${i}`,
            '---',
            '',
            `Grouping node for synthetic notes in section ${i}.`
        ].join('\n'), 'utf8');
    }

    fs.writeFileSync(path.join(vaultDir, `${hubId}.md`), [
        '---',
        `id: ${hubId}`,
        'type: hub',
        'name: Central Hub',
        'status: active',
        '---',
        '',
        'Shared anchor note referenced by the entire synthetic vault.'
    ].join('\n'), 'utf8');
}

function rootUri(vaultDir) {
    return 'file:///' + vaultDir.split(path.sep).join('/');
}

function createLspClient(vaultDir, timeoutMs) {
    const child = spawn('node', [BIN, 'serve', '--lsp', '--vault', vaultDir], {
        stdio: ['pipe', 'pipe', 'pipe']
    });

    let nextId = 1;
    let stdoutBuffer = Buffer.alloc(0);
    let stderrBuffer = '';
    let exited = false;
    let exitCode = null;
    const pending = new Map();

    child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk.toString('utf8');
    });

    child.on('exit', (code) => {
        exited = true;
        exitCode = code;
        for (const { reject, timer } of pending.values()) {
            clearTimeout(timer);
            reject(new Error(`LSP server exited early with code ${code}\n${stderrBuffer}`));
        }
        pending.clear();
    });

    child.stdout.on('data', (chunk) => {
        stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
        while (true) {
            const headerEnd = stdoutBuffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) break;
            const header = stdoutBuffer.slice(0, headerEnd).toString('ascii');
            const match = /Content-Length:\s*(\d+)/i.exec(header);
            if (!match) {
                stdoutBuffer = stdoutBuffer.slice(headerEnd + 4);
                continue;
            }
            const length = parseInt(match[1], 10);
            const bodyStart = headerEnd + 4;
            const bodyEnd = bodyStart + length;
            if (stdoutBuffer.length < bodyEnd) break;
            const body = stdoutBuffer.slice(bodyStart, bodyEnd).toString('utf8');
            stdoutBuffer = stdoutBuffer.slice(bodyEnd);
            let message;
            try {
                message = JSON.parse(body);
            } catch (_) {
                continue;
            }
            if (message && message.id != null && pending.has(message.id)) {
                const { resolve, timer } = pending.get(message.id);
                clearTimeout(timer);
                pending.delete(message.id);
                resolve(message);
            }
        }
    });

    function notify(method, params) {
        if (exited) throw new Error(`Cannot send ${method}; LSP server already exited with code ${exitCode}`);
        child.stdin.write(frame({ jsonrpc: '2.0', method, params }));
    }

    function request(method, params) {
        if (exited) return Promise.reject(new Error(`Cannot send ${method}; LSP server already exited with code ${exitCode}`));
        const id = nextId++;
        const startedAt = performance.now();
        const promise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`Timed out waiting for ${method} after ${timeoutMs}ms`));
            }, timeoutMs);
            pending.set(id, { resolve, reject, timer, method, startedAt });
        });
        child.stdin.write(frame({ jsonrpc: '2.0', id, method, params }));
        return promise.then((message) => ({
            message,
            durationMs: performance.now() - startedAt
        }));
    }

    async function close() {
        if (exited) return;
        try {
            await request('shutdown');
        } finally {
            notify('exit');
            await new Promise((resolve) => child.once('exit', resolve));
        }
    }

    return { request, notify, close, stderr: () => stderrBuffer };
}

function ms(value) {
    return Math.round(value * 10) / 10;
}

function printMetric(label, durationMs, budgetMs) {
    const status = durationMs <= budgetMs ? 'PASS' : 'FAIL';
    console.log(`${status} ${label.padEnd(18)} ${String(ms(durationMs)).padStart(7)}ms  (budget ${budgetMs}ms)`);
    return durationMs <= budgetMs;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    for (const [key, value] of Object.entries(options)) {
        assertFinitePositive(value, key);
    }

    const vaultDir = createVaultDir();
    let client = null;

    try {
        console.log(`Creating synthetic vault with ${options.notes} notes...`);
        writeSyntheticVault(vaultDir, options.notes);

        const uri = rootUri(vaultDir);
        const probeUri = `${uri}/probe.md`;
        const probeText = [
            '---',
            'id: probe',
            'type: note',
            'owner: "[[hub-central]]"',
            '---',
            '',
            'Probe note for LSP scale.',
            '',
            'See [[note-249',
            'Hover [[hub-central]]',
            'Broken [[ghost-note]]'
        ].join('\n');
        const formattingUri = `${uri}/formatting-probe.md`;
        const formattingText = [
            '---',
            'updated: March 4 2026',
            'status: active',
            'type: note',
            'id: formatting-probe',
            'name: Formatting Probe',
            'created: 2026/03/01',
            '---',
            '',
            'Formatting benchmark note.'
        ].join('\n');
        const renameUri = `${uri}/note-2499.md`;
        const renameText = [
            '---',
            'id: note-2499',
            'type: note',
            'name: Synthetic Note 2499',
            'status: active',
            'owner: "[[hub-central]]"',
            'section: "[[section-24]]"',
            '---',
            '',
            'Synthetic body for note-2499.',
            '',
            'Links: [[hub-central]] · [[note-2500]] · [[note-2498]] · [[section-24]]'
        ].join('\n');

        client = createLspClient(vaultDir, options.timeoutMs);

        const initialize = await client.request('initialize', { rootUri: uri, capabilities: {} });
        client.notify('initialized', {});
        client.notify('textDocument/didOpen', {
            textDocument: {
                uri: probeUri,
                languageId: 'markdown',
                version: 1,
                text: probeText
            }
        });
        client.notify('textDocument/didOpen', {
            textDocument: {
                uri: formattingUri,
                languageId: 'markdown',
                version: 1,
                text: formattingText
            }
        });
        client.notify('textDocument/didOpen', {
            textDocument: {
                uri: renameUri,
                languageId: 'markdown',
                version: 1,
                text: renameText
            }
        });

        const completion = await client.request('textDocument/completion', {
            textDocument: { uri: probeUri },
            position: { line: 8, character: 'See [[note-249'.length },
            context: { triggerKind: 1 }
        });

        const hover = await client.request('textDocument/hover', {
            textDocument: { uri: probeUri },
            position: { line: 9, character: 'Hover [[hub-central'.length }
        });

        const references = await client.request('textDocument/references', {
            textDocument: { uri: probeUri },
            position: { line: 9, character: 'Hover [[hub-central'.length },
            context: { includeDeclaration: true }
        });

        const diagnostic = await client.request('textDocument/diagnostic', {
            textDocument: { uri: probeUri }
        });

        const workspaceSymbol = await client.request('workspace/symbol', {
            query: 'note-249'
        });
        const formatting = await client.request('textDocument/formatting', {
            textDocument: { uri: formattingUri, version: 1 },
            options: { tabSize: 2, insertSpaces: true }
        });
        const codeAction = await client.request('textDocument/codeAction', {
            textDocument: { uri: probeUri, version: 1 },
            range: { start: { line: 10, character: 0 }, end: { line: 10, character: 22 } },
            context: {
                only: ['quickfix'],
                diagnostics: [{
                    range: { start: { line: 10, character: 7 }, end: { line: 10, character: 21 } },
                    severity: 2,
                    source: 'yamlink',
                    code: 'yamlink.brokenLink',
                    message: 'Broken link: [[ghost-note]] — no note with this ID exists in the vault',
                    data: { targetId: 'ghost-note', relation: false, line: 10 }
                }]
            }
        });
        const rename = await client.request('textDocument/rename', {
            textDocument: { uri: renameUri, version: 1 },
            position: { line: 11, character: 35 },
            newName: 'note-2499-renamed'
        });

        const results = [
            ['initialize', initialize.durationMs, options.maxInitMs],
            ['completion', completion.durationMs, options.maxCompletionMs],
            ['hover', hover.durationMs, options.maxHoverMs],
            ['references', references.durationMs, options.maxReferencesMs],
            ['diagnostic', diagnostic.durationMs, options.maxDiagnosticMs],
            ['workspaceSymbol', workspaceSymbol.durationMs, options.maxWorkspaceSymbolMs],
            ['formatting', formatting.durationMs, options.maxFormattingMs],
            ['codeAction', codeAction.durationMs, options.maxCodeActionMs],
            ['rename', rename.durationMs, options.maxRenameMs]
        ];

        console.log('');
        console.log(`Yamlink LSP scale check (${options.notes} notes)`);
        console.log(`Vault: ${vaultDir}`);
        console.log('');

        let ok = true;
        for (const [label, duration, budget] of results) {
            ok = printMetric(label, duration, budget) && ok;
        }

        const completionItems = Array.isArray(completion.message.result) ? completion.message.result.length : 0;
        const hoverOk = !!hover.message.result;
        const referenceCount = Array.isArray(references.message.result) ? references.message.result.length : 0;
        const diagnosticCount = Array.isArray(diagnostic.message.result?.items) ? diagnostic.message.result.items.length : 0;
        const symbolCount = Array.isArray(workspaceSymbol.message.result) ? workspaceSymbol.message.result.length : 0;
        const formattingEditCount = Array.isArray(formatting.message.result) ? formatting.message.result.length : 0;
        const codeActionCount = Array.isArray(codeAction.message.result) ? codeAction.message.result.length : 0;
        const renameChangeCount = rename.message.result?.changes ? Object.keys(rename.message.result.changes).length : 0;

        console.log('');
        console.log(`Completion items: ${completionItems}`);
        console.log(`Hover returned:   ${hoverOk ? 'yes' : 'no'}`);
        console.log(`References:       ${referenceCount}`);
        console.log(`Diagnostics:      ${diagnosticCount}`);
        console.log(`Workspace symbol: ${symbolCount}`);
        console.log(`Formatting edits: ${formattingEditCount}`);
        console.log(`Code actions:     ${codeActionCount}`);
        console.log(`Rename files:     ${renameChangeCount}`);

        if (
            completionItems === 0
            || !hoverOk
            || referenceCount === 0
            || diagnosticCount === 0
            || symbolCount === 0
            || formattingEditCount === 0
            || codeActionCount === 0
            || renameChangeCount === 0
        ) {
            ok = false;
            console.log('');
            console.log('FAIL semantic correctness check failed on at least one LSP surface.');
        }

        await client.close();
        client = null;

        process.exit(ok ? 0 : 1);
    } finally {
        if (client) {
            try { await client.close(); } catch (_) {}
        }
        fs.rmSync(vaultDir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
});
