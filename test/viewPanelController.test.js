'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

let createdPanel = null;
const infoMessages = [];

const mockVscode = {
    window: {
        createWebviewPanel(_id, _title, _column, options) {
            let messageHandler = null;
            let disposeHandler = null;
            let viewStateHandler = null;
            createdPanel = {
                visible: true,
                webview: {
                    options,
                    posts: [],
                    onDidReceiveMessage(handler) {
                        messageHandler = handler;
                        return { dispose() {} };
                    },
                    postMessage(msg) {
                        this.posts.push(msg);
                    }
                },
                onDidDispose(handler) {
                    disposeHandler = handler;
                    return { dispose() {} };
                },
                onDidChangeViewState(handler) {
                    viewStateHandler = handler;
                    return { dispose() {} };
                },
                async emitMessage(msg) {
                    return messageHandler ? messageHandler(msg) : undefined;
                },
                emitVisible() {
                    if (viewStateHandler) viewStateHandler({ webviewPanel: createdPanel });
                },
                dispose() {
                    if (disposeHandler) disposeHandler();
                }
            };
            return createdPanel;
        },
        showInformationMessage(message) {
            infoMessages.push(message);
            return Promise.resolve(undefined);
        }
    },
    Uri: {
        joinPath() { return { fsPath: 'C:\\vault\\src\\features' }; }
    },
    ViewColumn: { Beside: 2 }
};

require.cache.__vpc_vscode__ = {
    id: '__vpc_vscode__',
    filename: '__vpc_vscode__',
    loaded: true,
    exports: mockVscode
};

require.cache.__vpc_perf__ = {
    id: '__vpc_perf__',
    filename: '__vpc_perf__',
    loaded: true,
    exports: {
        perfTracker: {
            measureSync(_name, _meta, fn) {
                return fn();
            }
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__vpc_vscode__';
    if (request === '../../runtime/performanceTracker') return '__vpc_perf__';
    return originalResolve(request, parent, ...rest);
};

const { createViewPanelController } = require('../src/features/view/viewPanelController');

let services;
let renderCalls;
let syncCalls;
let openNodeCalls;
let openReportCalls;
let exportCalls;
let refineCalls;
let onCompleteCount;
let stateChanges;
let editCellCalls;

beforeEach(() => {
    createdPanel = null;
    infoMessages.length = 0;
    renderCalls = [];
    syncCalls = [];
    openNodeCalls = [];
    openReportCalls = [];
    exportCalls = [];
    refineCalls = [];
    onCompleteCount = 0;
    stateChanges = [];
    editCellCalls = [];
    services = {
        parseAllViewQueries() { return [{ raw: '!view contact' }]; },
        extractIdFromText() { return 'johnny-rico'; },
        ensureIndexBuilt() {},
        renderPanel(payload) { renderCalls.push(payload); },
        async openNode(id) { openNodeCalls.push(id); },
        async openReport(id) { openReportCalls.push(id); },
        async toggleTaskDone(filePath, line, newDone) {
            return filePath === 'C:\\vault\\tasks.md' && line === 4 && newDone === true;
        },
        async editCell(filePath, field, value) {
            editCellCalls.push({ filePath, field, value });
            return value !== 'FAIL';
        },
        syncIndexAfterWrite(filePath) { syncCalls.push(filePath); },
        async exportQueryResult(format, lastQuery, queryIndex, visibleColumns, contextNodeId) {
            exportCalls.push({ format, lastQuery, queryIndex, visibleColumns, contextNodeId });
        },
        async refineQuery(sourceDocumentPath, queryIndex) {
            refineCalls.push({ sourceDocumentPath, queryIndex });
            return [{ raw: '!view mission' }];
        }
    };
});

after(() => {
    Module._resolveFilename = originalResolve;
});

describe('view panel controller', () => {
    test('openViewPanel creates the panel, renders, and reports open state', () => {
        const controller = createViewPanelController(services);
        controller.setViewPanelStateListener((state) => stateChanges.push(state));

        controller.openViewPanel(
            { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] },
            '---\nid: johnny-rico\n---\n!view contact\n',
            () => { onCompleteCount += 1; },
            'C:\\vault\\johnny-rico.md'
        );

        assert.ok(createdPanel);
        assert.equal(renderCalls.length, 1);
        assert.equal(renderCalls[0].contextNodeId, 'johnny-rico');
        assert.equal(controller.isViewPanelOpen(), true);
        assert.deepEqual(stateChanges.at(-1), {
            open: true,
            sourceDocumentPath: 'C:\\vault\\johnny-rico.md'
        });
    });

    test('toggleTaskDone message syncs, rerenders, and notifies completion callback', async () => {
        const controller = createViewPanelController(services);
        controller.openViewPanel(
            { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] },
            '---\nid: johnny-rico\n---\n!view contact\n',
            () => { onCompleteCount += 1; },
            'C:\\vault\\johnny-rico.md'
        );
        renderCalls.length = 0;

        await createdPanel.emitMessage({
            command: 'toggleTaskDone',
            filePath: 'C:\\vault\\tasks.md',
            line: 4,
            newDone: true
        });

        assert.deepEqual(syncCalls, ['C:\\vault\\tasks.md']);
        assert.equal(onCompleteCount, 1);
        assert.equal(renderCalls.length, 1);
    });

    test('editCell posts the result, syncs writes, and rerenders on success', async () => {
        const controller = createViewPanelController(services);
        controller.openViewPanel(
            { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] },
            '---\nid: johnny-rico\n---\n!view contact\n',
            () => { onCompleteCount += 1; },
            'C:\\vault\\johnny-rico.md'
        );
        renderCalls.length = 0;

        await createdPanel.emitMessage({
            command: 'editCell',
            filePath: 'C:\\vault\\johnny-rico.md',
            field: 'status',
            value: 'active',
            requestId: 'req-1'
        });

        assert.deepEqual(editCellCalls, [{
            filePath: 'C:\\vault\\johnny-rico.md',
            field: 'status',
            value: 'active'
        }]);
        assert.deepEqual(createdPanel.webview.posts.at(-1), { command: 'editResult', ok: true, requestId: 'req-1' });
        assert.deepEqual(syncCalls, ['C:\\vault\\johnny-rico.md']);
        assert.equal(onCompleteCount, 1);
        assert.equal(renderCalls.length, 1);
    });

    test('editCellsBulk reports per-edit results and rerenders only when something succeeded', async () => {
        const controller = createViewPanelController(services);
        controller.openViewPanel(
            { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] },
            '---\nid: johnny-rico\n---\n!view contact\n',
            () => { onCompleteCount += 1; },
            'C:\\vault\\johnny-rico.md'
        );
        renderCalls.length = 0;

        await createdPanel.emitMessage({
            command: 'editCellsBulk',
            source: 'grid',
            edits: [
                { filePath: 'C:\\vault\\johnny-rico.md', field: 'status', value: 'active', requestId: 'ok-1' },
                { filePath: 'C:\\vault\\johnny-rico.md', field: 'owner', value: 'FAIL', requestId: 'bad-1' }
            ]
        });

        assert.deepEqual(createdPanel.webview.posts.at(-1), {
            command: 'bulkEditResult',
            results: [
                { requestId: 'ok-1', ok: true },
                { requestId: 'bad-1', ok: false }
            ],
            source: 'grid'
        });
        assert.deepEqual(syncCalls, ['C:\\vault\\johnny-rico.md']);
        assert.equal(onCompleteCount, 1);
        assert.equal(renderCalls.length, 1);
    });

    test('saveState persists panel state and refreshViewPanel reuses it on rerender', async () => {
        const controller = createViewPanelController(services);
        controller.openViewPanel(
            { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] },
            '---\nid: johnny-rico\n---\n!view contact\n',
            null,
            'C:\\vault\\johnny-rico.md'
        );
        renderCalls.length = 0;

        await createdPanel.emitMessage({ command: 'saveState', state: { tab: 2, filters: { status: ['open'] } } });
        controller.refreshViewPanel();

        assert.equal(renderCalls.length, 1);
        assert.deepEqual(renderCalls[0].panelState, { tab: 2, filters: { status: ['open'] } });
    });

    test('refineQuery message rerenders with updated queries', async () => {
        const controller = createViewPanelController(services);
        controller.openViewPanel(
            { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] },
            '---\nid: johnny-rico\n---\n!view contact\n',
            null,
            'C:\\vault\\johnny-rico.md'
        );
        renderCalls.length = 0;

        await createdPanel.emitMessage({ command: 'refineQuery', queryIndex: 0 });

        assert.deepEqual(refineCalls, [{ sourceDocumentPath: 'C:\\vault\\johnny-rico.md', queryIndex: 0 }]);
        assert.equal(renderCalls.length, 1);
        assert.equal(renderCalls[0].queries[0].raw, '!view mission');
    });

    test('refineQuery without source document shows a helpful info message', async () => {
        const controller = createViewPanelController(services);
        controller.openViewPanel(
            { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] },
            '---\nid: johnny-rico\n---\n!view contact\n',
            null,
            null
        );

        await createdPanel.emitMessage({ command: 'refineQuery', queryIndex: 0 });

        assert.ok(infoMessages.some((message) => message.includes('was not opened from a note')));
    });

    test('openNode, openReport, export, and close behave through the public controller', async () => {
        const controller = createViewPanelController(services);
        controller.setViewPanelStateListener((state) => stateChanges.push(state));
        controller.openViewPanel(
            { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] },
            '---\nid: johnny-rico\n---\n!view contact\n',
            null,
            'C:\\vault\\johnny-rico.md'
        );

        await createdPanel.emitMessage({ command: 'openNode', id: 'roughnecks' });
        await createdPanel.emitMessage({ command: 'openReport', id: 'roughnecks' });
        await createdPanel.emitMessage({
            command: 'export',
            format: 'csv',
            queryIndex: 0,
            visibleColumns: ['name']
        });

        createdPanel.dispose();

        assert.deepEqual(openNodeCalls, ['roughnecks']);
        assert.deepEqual(openReportCalls, ['roughnecks']);
        assert.equal(exportCalls.length, 1);
        assert.equal(exportCalls[0].contextNodeId, 'johnny-rico');
        assert.equal(controller.isViewPanelOpen(), false);
        assert.deepEqual(stateChanges.at(-1), { open: false, sourceDocumentPath: null });
    });

    test('closeViewPanel disposes the panel and getOpenViewDocumentPath tracks the source note', () => {
        const controller = createViewPanelController(services);
        controller.openViewPanel(
            { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] },
            '---\nid: johnny-rico\n---\n!view contact\n',
            null,
            'C:\\vault\\johnny-rico.md'
        );

        assert.equal(controller.getOpenViewDocumentPath(), 'C:\\vault\\johnny-rico.md');
        controller.closeViewPanel();
        assert.equal(controller.isViewPanelOpen(), false);
        assert.equal(controller.getOpenViewDocumentPath(), null);
    });

    test('openViewPanel does nothing when query parsing returns nothing', () => {
        services.parseAllViewQueries = function parseAllViewQueries() { return null; };
        const controller = createViewPanelController(services);

        controller.openViewPanel(
            { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] },
            '# no views here\n',
            null,
            'C:\\vault\\johnny-rico.md'
        );

        assert.equal(createdPanel, null);
        assert.equal(renderCalls.length, 0);
    });
});
