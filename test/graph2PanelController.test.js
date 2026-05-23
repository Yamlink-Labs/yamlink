'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

let createdPanel = null;
let activeEditor = null;
let _receivedEditorListener = null;
const postedMessages = [];
const buildPayloadCalls = [];

const mockWindow = {
    get activeTextEditor() {
        return activeEditor;
    },
    createWebviewPanel(_id, _title, _column, _options) {
        let messageHandler = null;
        let disposeHandler = null;
        createdPanel = {
            title: '',
            webview: {
                html: '',
                postMessage(message) {
                    postedMessages.push(message);
                },
                onDidReceiveMessage(handler) {
                    messageHandler = handler;
                    return { dispose() {} };
                }
            },
            onDidDispose(handler) {
                disposeHandler = handler;
                return { dispose() {} };
            },
            reveal() {},
            async emitMessage(message) {
                return messageHandler ? messageHandler(message) : undefined;
            },
            dispose() {
                if (disposeHandler) disposeHandler();
            }
        };
        return createdPanel;
    },
    onDidChangeActiveTextEditor(handler) {
        _receivedEditorListener = handler;
        return { dispose() {} };
    }
};

require.cache.__g2pc_vscode__ = {
    id: '__g2pc_vscode__',
    filename: '__g2pc_vscode__',
    loaded: true,
    exports: {
        window: mockWindow,
        ViewColumn: { Beside: 2 },
        Uri: {
            joinPath(...parts) {
                return { fsPath: parts.map((part) => part && part.fsPath ? part.fsPath : String(part || '')).join('\\') };
            }
        }
    }
};

require.cache.__g2pc_indexService__ = {
    id: '__g2pc_indexService__',
    filename: '__g2pc_indexService__',
    loaded: true,
    exports: {
        getPathIndex() {
            return new Map([
                ['C:\\vault\\current.md', 'current-note'],
                ['C:\\vault\\other.md', 'other-note']
            ]);
        },
        getIndex() {
            return new Map();
        }
    }
};

require.cache.__g2pc_perf__ = {
    id: '__g2pc_perf__',
    filename: '__g2pc_perf__',
    loaded: true,
    exports: {
        perfTracker: {
            measureSync(_label, _meta, fn) {
                return fn();
            }
        }
    }
};

require.cache.__g2pc_state__ = {
    id: '__g2pc_state__',
    filename: '__g2pc_state__',
    loaded: true,
    exports: {
        normalizeGraph2State(options = {}, activeNodeId = null, previousState = null) {
            const next = {
                source: options.source ?? previousState?.source ?? 'current',
                scope: options.scope ?? previousState?.scope ?? 'neighborhood',
                centerNodeId: Object.prototype.hasOwnProperty.call(options, 'centerNodeId')
                    ? options.centerNodeId
                    : (activeNodeId ?? previousState?.centerNodeId ?? null),
                selectedNodeId: Object.prototype.hasOwnProperty.call(options, 'selectedNodeId')
                    ? options.selectedNodeId
                    : (activeNodeId ?? previousState?.selectedNodeId ?? null),
                filters: options.filters ?? previousState?.filters ?? {
                    types: [],
                    relationTypes: [],
                    tags: [],
                    hideArchived: true,
                    hideOrphans: false,
                    hideWeakMentions: false
                },
                queryText: options.queryText ?? previousState?.queryText ?? '',
                customNodeIds: options.customNodeIds ?? previousState?.customNodeIds ?? [],
                nodeCap: options.nodeCap ?? previousState?.nodeCap ?? 128,
                workspaceFocusCap: options.workspaceFocusCap ?? previousState?.workspaceFocusCap ?? 5,
                depth: options.depth ?? previousState?.depth ?? 2
            };
            return next;
        }
    }
};

require.cache.__g2pc_payload__ = {
    id: '__g2pc_payload__',
    filename: '__g2pc_payload__',
    loaded: true,
    exports: {
        buildGraph2Payload(state, activeNodeId) {
            buildPayloadCalls.push({ state: { ...state, filters: { ...state.filters } }, activeNodeId });
            return {
                scope: state.scope,
                source: state.source,
                centerNodeId: state.centerNodeId,
                selectedNodeId: state.selectedNodeId,
                filters: state.filters,
                nodeCap: state.nodeCap,
                queryText: state.queryText,
                model: { elements: [], summary: { nodeCount: 0, edgeCount: 0, typeCount: 0 } }
            };
        }
    }
};

require.cache.__g2pc_html__ = {
    id: '__g2pc_html__',
    filename: '__g2pc_html__',
    loaded: true,
    exports: {
        buildGraph2BootHtml() {
            return '<html></html>';
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__g2pc_vscode__';
    if (request === '../../core/indexService') return '__g2pc_indexService__';
    if (request === '../../runtime/performanceTracker') return '__g2pc_perf__';
    if (request === './graph2State') return '__g2pc_state__';
    if (request === './graph2Payload') return '__g2pc_payload__';
    if (request === './graph2BootHtml') return '__g2pc_html__';
    return originalResolve(request, parent, ...rest);
};

const { createGraph2PanelController } = require('../src/features/graph2/graph2PanelController');

beforeEach(() => {
    createdPanel = null;
    activeEditor = {
        document: { languageId: 'markdown', uri: { fsPath: 'C:\\vault\\current.md' } }
    };
    _receivedEditorListener = null;
    postedMessages.length = 0;
    buildPayloadCalls.length = 0;
});

after(() => {
    Module._resolveFilename = originalResolve;
});

describe('graph2 panel controller', () => {
    test('setCenter forces current-note source and neighborhood scope', async () => {
        const controller = createGraph2PanelController();
        const context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] };

        controller.openGraph2Panel(context, { source: 'query', scope: 'vault', queryText: 'type:mission' });
        await createdPanel.emitMessage({ type: 'graph2:ready' });
        postedMessages.length = 0;

        await createdPanel.emitMessage({ type: 'setCenter', id: 'other-note' });

        const update = postedMessages.find((message) => message.type === 'graph2:update');
        assert.ok(update);
        assert.equal(update.payload.source, 'current');
        assert.equal(update.payload.scope, 'neighborhood');
        assert.equal(update.payload.centerNodeId, 'other-note');
        assert.equal(update.payload.selectedNodeId, 'other-note');
    });

    test('focusCurrent forces current-note source and focused scope', async () => {
        const controller = createGraph2PanelController();
        const context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] };

        controller.openGraph2Panel(context, { source: 'custom', scope: 'vault', customNodeIds: ['x', 'y'] });
        await createdPanel.emitMessage({ type: 'graph2:ready' });
        postedMessages.length = 0;

        await createdPanel.emitMessage({ type: 'focusCurrent' });

        const update = postedMessages.find((message) => message.type === 'graph2:update');
        assert.ok(update);
        assert.equal(update.payload.source, 'current');
        assert.equal(update.payload.scope, 'neighborhood');
        assert.equal(update.payload.centerNodeId, 'current-note');
        assert.equal(update.payload.selectedNodeId, 'current-note');
    });

    test('resetFilters restores default dataset filters', async () => {
        const controller = createGraph2PanelController();
        const context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] };

        controller.openGraph2Panel(context, {
            filters: {
                types: ['character'],
                relationTypes: ['commander'],
                tags: ['war'],
                hideArchived: false,
                hideOrphans: true,
                hideWeakMentions: true
            }
        });
        await createdPanel.emitMessage({ type: 'graph2:ready' });
        postedMessages.length = 0;

        await createdPanel.emitMessage({ type: 'resetFilters' });

        const update = postedMessages.find((message) => message.type === 'graph2:update');
        assert.ok(update);
        assert.deepEqual(update.payload.filters, {
            types: [],
            relationTypes: [],
            tags: [],
            hideArchived: true,
            hideOrphans: false,
            hideWeakMentions: false
        });
    });
});
