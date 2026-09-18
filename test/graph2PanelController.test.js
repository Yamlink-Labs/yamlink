'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

// Regression note: this file previously imported `createGraph2PanelController`
// from `src/features/graph2/graph2PanelController.js`, a file that no longer
// exists — it was renamed/consolidated into `graph2SidebarController.js`
// (`createGraph2SidebarController`) as part of moving the graph2 experience
// from a floating panel to a sidebar view. The import failure meant every
// test in this file failed outright, and since it was never added to
// `package.json`'s test file list, `npm test` silently never ran it at all —
// zero real coverage for the graph2 sidebar's message handling, invisibly.
//
// The old tests also tested message types (`setCenter`, `resetFilters`) that
// don't exist in the real controller's `handleMessage()` switch at all — the
// real, current message types are `graph2:ready`, `openNode`, `setScope`,
// `focusCurrent`, `requestTimelapse`, `exploreNode` (confirmed by reading
// `src/features/graph2/graph2SidebarController.js` directly, not assumed).
// Rewritten below against the real API rather than patching the import path
// on top of a test suite for functionality that no longer exists.

let activeEditor = null;
const postedMessages = [];

const mockWindow = {
    get activeTextEditor() {
        return activeEditor;
    },
    get visibleTextEditors() {
        return activeEditor ? [activeEditor] : [];
    },
    onDidChangeActiveTextEditor(handler) {
        mockWindow._activeEditorChangeHandler = handler;
        return { dispose() {} };
    },
    registerWebviewViewProvider(_viewId, provider, _options) {
        mockWindow._lastProvider = provider;
        return { dispose() {} };
    },
    async showTextDocument() {},
    ViewColumn: { One: 1 }
};

require.cache.__g2sc_vscode__ = {
    id: '__g2sc_vscode__',
    filename: '__g2sc_vscode__',
    loaded: true,
    exports: {
        window: mockWindow,
        ViewColumn: { One: 1 },
        Uri: {
            joinPath(...parts) {
                return { fsPath: parts.map((part) => (part && part.fsPath ? part.fsPath : String(part || ''))).join('\\') };
            }
        },
        workspace: {
            async openTextDocument(fsPath) {
                return { uri: { fsPath } };
            }
        }
    }
};

require.cache.__g2sc_indexService__ = {
    id: '__g2sc_indexService__',
    filename: '__g2sc_indexService__',
    loaded: true,
    exports: {
        getPathIndex() {
            return new Map([
                ['C:\\vault\\current.md', 'current-note'],
                ['C:\\vault\\other.md', 'other-note']
            ]);
        },
        getIndex() {
            return new Map([
                ['current-note', 'C:\\vault\\current.md'],
                ['other-note', 'C:\\vault\\other.md']
            ]);
        }
    }
};

require.cache.__g2sc_perf__ = {
    id: '__g2sc_perf__',
    filename: '__g2sc_perf__',
    loaded: true,
    exports: {
        perfTracker: {
            measureSync(_label, _meta, fn) {
                return fn();
            }
        }
    }
};

require.cache.__g2sc_payload__ = {
    id: '__g2sc_payload__',
    filename: '__g2sc_payload__',
    loaded: true,
    exports: {
        // Real signature: buildGraph2Payload(state, getActiveNodeId) — the
        // second argument is a function, confirmed by reading
        // graph2Payload.js and its real call site in graph2SidebarController.js.
        buildGraph2Payload(state, getActiveNodeId) {
            return {
                scope: state.scope,
                source: state.source,
                centerNodeId: state.centerNodeId,
                selectedNodeId: state.selectedNodeId,
                filters: state.filters,
                activeNodeId: typeof getActiveNodeId === 'function' ? getActiveNodeId() : null,
                model: { elements: [], summary: { nodeCount: 0, edgeCount: 0, typeCount: 0 } }
            };
        }
    }
};

require.cache.__g2sc_boothtml__ = {
    id: '__g2sc_boothtml__',
    filename: '__g2sc_boothtml__',
    loaded: true,
    exports: {
        buildGraph2SidebarBootHtml() {
            return '<html></html>';
        }
    }
};

require.cache.__g2sc_timelapse__ = {
    id: '__g2sc_timelapse__',
    filename: '__g2sc_timelapse__',
    loaded: true,
    exports: {
        buildTimelapseSequence() {
            return { frames: [] };
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__g2sc_vscode__';
    if (request === '../../core/indexService') return '__g2sc_indexService__';
    if (request === '../../runtime/performanceTracker') return '__g2sc_perf__';
    if (request === './graph2Payload') return '__g2sc_payload__';
    if (request === './graph2SidebarBootHtml') return '__g2sc_boothtml__';
    if (request === '../graph/graphTimelapse') return '__g2sc_timelapse__';
    // graph2State.js is intentionally NOT mocked — it's a real, pure state
    // module (confirmed no non-pure dependencies), so testing against its
    // actual normalization logic gives real coverage instead of re-inventing
    // a parallel model that can silently drift from reality, which is
    // exactly what happened to the previous version of this test file.
    return originalResolve(request, parent, ...rest);
};

const { createGraph2SidebarController } = require('../src/features/graph2/graph2SidebarController');

function createMockWebviewView() {
    let messageHandler = null;
    let visibilityHandler = null;
    const view = {
        visible: true,
        webview: {
            options: null,
            html: '',
            asWebviewUri(uri) {
                return { toString: () => `webview://${uri.fsPath}` };
            },
            postMessage(message) {
                postedMessages.push(message);
                return Promise.resolve(true);
            },
            onDidReceiveMessage(handler) {
                messageHandler = handler;
                return { dispose() {} };
            }
        },
        onDidChangeVisibility(handler) {
            visibilityHandler = handler;
            return { dispose() {} };
        },
        async emitMessage(message) {
            return messageHandler ? messageHandler(message) : undefined;
        },
        setVisible(value) {
            view.visible = value;
            if (visibilityHandler) visibilityHandler();
        }
    };
    return view;
}

beforeEach(() => {
    activeEditor = {
        document: { languageId: 'markdown', uri: { fsPath: 'C:\\vault\\current.md' } }
    };
    postedMessages.length = 0;
    mockWindow._lastProvider = null;
});

after(() => {
    Module._resolveFilename = originalResolve;
});

function registerAndResolve(context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] }) {
    const controller = createGraph2SidebarController();
    controller.registerGraphView(context);
    const webviewView = createMockWebviewView();
    mockWindow._lastProvider.resolveWebviewView(webviewView);
    return { controller, webviewView };
}

describe('graph2 sidebar controller', () => {
    test('registerGraphView registers a webview view provider for yamlink.graph', () => {
        const context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] };
        const controller = createGraph2SidebarController();
        controller.registerGraphView(context);
        assert.ok(mockWindow._lastProvider, 'expected registerWebviewViewProvider to have been called');
        assert.equal(typeof mockWindow._lastProvider.resolveWebviewView, 'function');
    });

    test('graph2:ready triggers an initial graph2:update with the current state', async () => {
        const { webviewView } = registerAndResolve();
        await webviewView.emitMessage({ type: 'graph2:ready' });
        const update = postedMessages.find((message) => message.type === 'graph2:update');
        assert.ok(update, 'expected a graph2:update after graph2:ready');
        assert.equal(update.payload.scope, 'vault');
    });

    test('focusCurrent centers the graph on the active editor\'s note with neighborhood scope', async () => {
        const { webviewView } = registerAndResolve();
        await webviewView.emitMessage({ type: 'graph2:ready' });
        postedMessages.length = 0;

        await webviewView.emitMessage({ type: 'focusCurrent' });

        const update = postedMessages.find((message) => message.type === 'graph2:update');
        assert.ok(update, 'expected a graph2:update after focusCurrent');
        assert.equal(update.payload.scope, 'neighborhood');
        assert.equal(update.payload.centerNodeId, 'current-note');
        assert.equal(update.payload.selectedNodeId, 'current-note');
    });

    test('exploreNode centers the graph on the given node with local scope', async () => {
        const { webviewView } = registerAndResolve();
        await webviewView.emitMessage({ type: 'graph2:ready' });
        postedMessages.length = 0;

        await webviewView.emitMessage({ type: 'exploreNode', id: 'other-note' });

        const update = postedMessages.find((message) => message.type === 'graph2:update');
        assert.ok(update, 'expected a graph2:update after exploreNode');
        assert.equal(update.payload.scope, 'local');
        assert.equal(update.payload.centerNodeId, 'other-note');
        assert.equal(update.payload.selectedNodeId, 'other-note');
    });

    test('setScope to vault clears the center and selected node', async () => {
        const { webviewView } = registerAndResolve();
        await webviewView.emitMessage({ type: 'graph2:ready' });
        await webviewView.emitMessage({ type: 'exploreNode', id: 'other-note' });
        postedMessages.length = 0;

        await webviewView.emitMessage({ type: 'setScope', scope: 'vault' });

        const update = postedMessages.find((message) => message.type === 'graph2:update');
        assert.ok(update, 'expected a graph2:update after setScope');
        assert.equal(update.payload.scope, 'vault');
        assert.equal(update.payload.centerNodeId, null);
        assert.equal(update.payload.selectedNodeId, null);
    });

    test('openNode opens the resolved note in the editor', async () => {
        const openedDocs = [];
        const originalOpenTextDocument = require('vscode').workspace.openTextDocument;
        require('vscode').workspace.openTextDocument = async (fsPath) => {
            openedDocs.push(fsPath);
            return { uri: { fsPath } };
        };
        try {
            const { webviewView } = registerAndResolve();
            await webviewView.emitMessage({ type: 'graph2:ready' });
            await webviewView.emitMessage({ type: 'openNode', id: 'other-note' });
            assert.deepEqual(openedDocs, ['C:\\vault\\other.md']);
        } finally {
            require('vscode').workspace.openTextDocument = originalOpenTextDocument;
        }
    });

    test('refreshGraphSidebarView pushes an update when the view is already resolved', async () => {
        const { controller, webviewView } = registerAndResolve();
        await webviewView.emitMessage({ type: 'graph2:ready' });
        postedMessages.length = 0;

        controller.refreshGraphSidebarView();

        const update = postedMessages.find((message) => message.type === 'graph2:update');
        assert.ok(update, 'expected refreshGraphSidebarView to push a graph2:update');
    });
});
