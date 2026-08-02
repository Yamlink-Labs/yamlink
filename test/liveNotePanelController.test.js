'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
    createVault,
    requireWithVscodeStub,
    resetVscodeStubState
} = require('./lib/vaultSim');

const vscode = requireWithVscodeStub('vscode');
const { createLiveNotePanelController } = requireWithVscodeStub('../src/features/preview/liveNotePanelController', require);

let liveNotePreviewUrl = '';
let activeConfigListener = null;
let panels = [];

function installVscodePanelStub() {
    liveNotePreviewUrl = '';
    activeConfigListener = null;
    panels = [];

    vscode.ViewColumn = { One: 1, Beside: 2 };
    vscode.workspace.getConfiguration = (section) => ({
        get(key) {
            if (section === 'yamlink' && key === 'liveNotePreviewUrl') return liveNotePreviewUrl;
            return undefined;
        }
    });
    vscode.workspace.onDidChangeConfiguration = (listener) => {
        activeConfigListener = listener;
        return { dispose: () => { activeConfigListener = null; } };
    };
    vscode.window.activeTextEditor = null;
    vscode.window.createWebviewPanel = (viewType, title, column, options) => {
        const messages = [];
        const panel = {
            viewType,
            title,
            column,
            options,
            revealCalls: [],
            _disposeHandler: null,
            reveal(targetColumn, preserveFocus) {
                this.revealCalls.push({ targetColumn, preserveFocus });
            },
            onDidDispose(handler) {
                this._disposeHandler = handler;
                return { dispose: () => {} };
            },
            dispose() {
                if (this._disposeHandler) this._disposeHandler();
            },
            webview: {
                cspSource: 'vscode-resource:',
                html: '',
                messages,
                asWebviewUri(uri) {
                    return { toString: () => `vscode-resource:${uri.fsPath}` };
                },
                postMessage(message) {
                    messages.push(message);
                    return true;
                },
                onDidReceiveMessage() {
                    return { dispose: () => {} };
                }
            }
        };
        panels.push(panel);
        return panel;
    };
}

async function openMarkdownEditor(vault, filename) {
    const document = await vault.openDocument(filename);
    document.languageId = 'markdown';
    vscode.window.activeTextEditor = { document };
    return document;
}

afterEach(() => {
    resetVscodeStubState();
    liveNotePreviewUrl = '';
    activeConfigListener = null;
    panels = [];
});

describe('live note panel controller — preview target URL', () => {
    test('setting unset uses the normal rendered preview path', async () => {
        installVscodePanelStub();
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: character\nname: Johnny Rico\n---\n\n# Notes\n'
        });
        try {
            await openMarkdownEditor(vault, 'rico.md');
            const controller = createLiveNotePanelController();
            controller.openLiveNotePanel({ subscriptions: [] });

            assert.equal(panels.length, 1);
            assert.match(panels[0].webview.html, /Rendered while you keep editing the source note/);
            assert.doesNotMatch(panels[0].webview.html, /<iframe/);
        } finally {
            vault.destroy();
        }
    });

    test('setting set boots an iframe with the current note slug', async () => {
        installVscodePanelStub();
        liveNotePreviewUrl = 'http://localhost:4321/notes/{slug}';
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: character\nname: Johnny Rico\n---\n'
        });
        try {
            await openMarkdownEditor(vault, 'rico.md');
            const controller = createLiveNotePanelController();
            controller.openLiveNotePanel({ subscriptions: [] });

            assert.equal(panels.length, 1);
            assert.match(panels[0].webview.html, /<iframe/);
            assert.match(panels[0].webview.html, /src="http:\/\/localhost:4321\/notes\/johnny-rico"/);
            assert.match(panels[0].webview.html, /frame-src http:\/\/localhost:\* https:/);
            assert.doesNotMatch(panels[0].webview.html, /Rendered while you keep editing/);
        } finally {
            vault.destroy();
        }
    });

    test('active note changes update the iframe src by message instead of replacing the webview shell', async () => {
        installVscodePanelStub();
        liveNotePreviewUrl = 'http://localhost:4321/{slug}';
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: character\n---\n',
            'jenkins.md': '---\nid: carl-jenkins\ntype: character\n---\n'
        });
        try {
            const firstDocument = await openMarkdownEditor(vault, 'rico.md');
            const controller = createLiveNotePanelController();
            controller.openLiveNotePanel({ subscriptions: [] });
            const originalHtml = panels[0].webview.html;

            const secondDocument = await openMarkdownEditor(vault, 'jenkins.md');
            controller.refreshLiveNotePanelForDocument(secondDocument);

            assert.equal(panels[0].webview.html, originalHtml);
            assert.deepEqual(panels[0].webview.messages.at(-1), {
                type: 'live:updatePreviewUrl',
                url: 'http://localhost:4321/carl-jenkins'
            });

            vscode.window.activeTextEditor = { document: firstDocument };
        } finally {
            vault.destroy();
        }
    });

    test('document with no indexed id falls back to the normal rendered preview, not the empty state', async () => {
        // A real markdown document is open here — it just has no `id:` for
        // the preview URL template to target. Falling back to "Open a
        // Markdown note to use Live Note mode" would be factually wrong
        // (a note IS open); the correct fallback is the same normal
        // rendered preview this note would get if no preview template were
        // configured at all.
        installVscodePanelStub();
        liveNotePreviewUrl = 'http://localhost:4321/{slug}';
        const vault = createVault({
            'scratch.md': '# Scratch only\n'
        });
        try {
            await openMarkdownEditor(vault, 'scratch.md');
            const controller = createLiveNotePanelController();
            controller.openLiveNotePanel({ subscriptions: [] });

            assert.doesNotMatch(panels[0].webview.html, /<iframe/);
            assert.doesNotMatch(panels[0].webview.html, /Open a Markdown note to use Live Note mode/);
            assert.match(panels[0].webview.html, /Rendered while you keep editing the source note/);
            assert.match(panels[0].webview.html, /Scratch only/);
        } finally {
            vault.destroy();
        }
    });

    test('changing yamlink.liveNotePreviewUrl refreshes an already-open panel into preview mode', async () => {
        installVscodePanelStub();
        const subscriptions = [];
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: character\n---\n'
        });
        try {
            await openMarkdownEditor(vault, 'rico.md');
            const controller = createLiveNotePanelController();
            controller.openLiveNotePanel({ subscriptions });
            assert.doesNotMatch(panels[0].webview.html, /<iframe/);

            liveNotePreviewUrl = 'http://localhost:4321/{slug}';
            assert.equal(typeof activeConfigListener, 'function');
            activeConfigListener({ affectsConfiguration: (key) => key === 'yamlink.liveNotePreviewUrl' });

            assert.match(panels[0].webview.html, /<iframe/);
            assert.match(panels[0].webview.html, /http:\/\/localhost:4321\/johnny-rico/);
        } finally {
            vault.destroy();
        }
    });
});
