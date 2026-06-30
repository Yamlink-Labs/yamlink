'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

let registeredProvider = null;
let activeEditor = null;
const openedDocs = [];
const shownDocs = [];
const commandCalls = [];
const htmlStates = [];
let currentModel = null;
let currentNeighbors = [];
let currentBacklinks = [];
let modelError = null;

const mockWindow = {
    get activeTextEditor() {
        return activeEditor;
    },
    set activeTextEditor(value) {
        activeEditor = value;
    },
    registerWebviewViewProvider(_id, provider) {
        registeredProvider = provider;
        return { dispose() {} };
    },
    async showTextDocument(document) {
        shownDocs.push(document.uri.fsPath);
        return document;
    }
};

const mockWorkspace = {
    async openTextDocument(filePath) {
        openedDocs.push(filePath);
        return { uri: { fsPath: filePath } };
    }
};

const mockCommands = {
    async executeCommand(id, ...args) {
        commandCalls.push({ id, args });
        return undefined;
    }
};

require.cache.__eh_vscode__ = {
    id: '__eh_vscode__',
    filename: '__eh_vscode__',
    loaded: true,
    exports: {
        window: mockWindow,
        workspace: mockWorkspace,
        commands: mockCommands,
        ViewColumn: { One: 1 },
        Uri: {
            joinPath() { return { fsPath: 'C:\\vault\\src\\features' }; }
        }
    }
};

require.cache.__eh_indexService__ = {
    id: '__eh_indexService__',
    filename: '__eh_indexService__',
    loaded: true,
    exports: {
        getIndex() {
            return new Map([
                ['johnny-rico', 'C:\\vault\\johnny-rico.md'],
                ['roughnecks', 'C:\\vault\\roughnecks.md']
            ]);
        },
        getPathIndex() {
            return new Map([['C:\\vault\\johnny-rico.md', 'johnny-rico']]);
        },
        getFieldsCache() {
            return new Map([['johnny-rico', { type: 'character' }]]);
        }
    }
};

require.cache.__eh_graph__ = {
    id: '__eh_graph__',
    filename: '__eh_graph__',
    loaded: true,
    exports: {
        getEdges() { return currentNeighbors.map((targetId) => ({ targetId })); },
        getBacklinks() { return currentBacklinks.map((sourceId) => ({ sourceId })); }
    }
};

require.cache.__eh_entityHubModel__ = {
    id: '__eh_entityHubModel__',
    filename: '__eh_entityHubModel__',
    loaded: true,
    exports: {
        buildContextualQueryRecipes() { return []; },
        buildEntityHubModel() {
            if (modelError) throw modelError;
            return currentModel;
        },
        getVisibleRelationColumns() { return ['field', 'note']; },
        getVisibleTaskColumns() { return ['text']; }
    }
};

require.cache.__eh_entityHubHtml__ = {
    id: '__eh_entityHubHtml__',
    filename: '__eh_entityHubHtml__',
    loaded: true,
    exports: {
        buildHubHtml({ nodeId }) {
            const html = `hub:${nodeId}`;
            htmlStates.push(html);
            return html;
        },
        buildEntityHubEmptyHtml(label) {
            const html = `empty:${label}`;
            htmlStates.push(html);
            return html;
        },
        buildEntityHubErrorHtml(label) {
            const html = `error:${label}`;
            htmlStates.push(html);
            return html;
        }
    }
};

require.cache.__eh_open_target__ = {
    id: '__eh_open_target__',
    filename: '__eh_open_target__',
    loaded: true,
    exports: {
        async openNoteTarget(id) {
            const filePath = new Map([
                ['johnny-rico', 'C:\\vault\\johnny-rico.md'],
                ['roughnecks', 'C:\\vault\\roughnecks.md']
            ]).get(id);
            if (!filePath) return null;
            openedDocs.push(filePath);
            shownDocs.push(filePath);
            return { resolvedId: id, filePath, targetLine: 0, parts: { anchor: '', blockId: '' } };
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__eh_vscode__';
    if (request === '../core/indexService') return '__eh_indexService__';
    if (request === '../core/graph') return '__eh_graph__';
    if (request === './navigation/openNoteTarget') return '__eh_open_target__';
    if (request === './entityHubModel') return '__eh_entityHubModel__';
    if (request === './entity/entityHubHtml') return '__eh_entityHubHtml__';
    return originalResolve(request, parent, ...rest);
};

const entityHub = require('../src/features/entityHub');

function createHost() {
    let messageHandler = null;
    let disposedHandler = null;
    return {
        title: '',
        webview: {
            options: null,
            html: '',
            onDidReceiveMessage(handler) {
                messageHandler = handler;
                return { dispose() {} };
            }
        },
        onDidDispose(handler) {
            disposedHandler = handler;
            return { dispose() {} };
        },
        async emitMessage(msg) {
            return messageHandler ? messageHandler(msg) : undefined;
        },
        dispose() {
            if (disposedHandler) disposedHandler();
        },
        showCalled: false,
        show() {
            this.showCalled = true;
        }
    };
}

beforeEach(() => {
    registeredProvider = null;
    activeEditor = null;
    openedDocs.length = 0;
    shownDocs.length = 0;
    commandCalls.length = 0;
    htmlStates.length = 0;
    currentNeighbors = [];
    currentBacklinks = [];
    modelError = null;
    currentModel = {
        isEmpty: false,
        nodeFields: { type: 'character' },
        incomingGroups: [],
        outgoingGroups: [],
        summaryRows: [],
        taskSections: [],
        timelineRows: [],
        suggestions: [],
        suggestionExplanation: '',
        recipes: [],
        vaultPositionRows: [],
        vaultDiagnosticRows: [],
        historyGroups: [],
        historyCount: 0,
        historyArc: []
    };
});

after(() => {
    Module._resolveFilename = originalResolve;
});

describe('entity hub controller', () => {
    test('registerEntityHubView renders the current note report when an active markdown note is open', () => {
        const context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] };
        entityHub.registerEntityHubView(context);
        const host = createHost();
        activeEditor = {
            document: { languageId: 'markdown', uri: { fsPath: 'C:\\vault\\johnny-rico.md' } }
        };

        registeredProvider.resolveWebviewView(host);

        assert.equal(host.title, 'johnny-rico · report');
        assert.equal(host.webview.html, 'hub:johnny-rico');
    });

    test('syncEntityHub renders empty state for non-markdown editors', () => {
        const context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] };
        entityHub.registerEntityHubView(context);
        const host = createHost();
        registeredProvider.resolveWebviewView(host);
        activeEditor = { document: { languageId: 'plaintext', uri: { fsPath: 'C:\\vault\\note.txt' } } };

        entityHub.syncEntityHub(context, { immediate: true });

        assert.equal(host.webview.html, 'empty:-');
    });

    test('syncEntityHub renders the non-node empty state when the file is not indexed', () => {
        const context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] };
        entityHub.registerEntityHubView(context);
        const host = createHost();
        registeredProvider.resolveWebviewView(host);
        activeEditor = {
            document: { languageId: 'markdown', uri: { fsPath: 'C:\\vault\\not-indexed.md' } }
        };

        entityHub.syncEntityHub(context, { immediate: true });

        assert.equal(host.webview.html, 'empty:not a node');
    });

    test('refreshEntityHub rerenders when a neighbor changes', () => {
        const context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] };
        entityHub.registerEntityHubView(context);
        const host = createHost();
        activeEditor = {
            document: { languageId: 'markdown', uri: { fsPath: 'C:\\vault\\johnny-rico.md' } }
        };
        currentNeighbors = ['roughnecks'];

        registeredProvider.resolveWebviewView(host);
        htmlStates.length = 0;
        entityHub.refreshEntityHub('roughnecks');

        assert.ok(htmlStates.includes('hub:johnny-rico'));
    });

    test('refreshEntityHub ignores unrelated changes', () => {
        const context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] };
        entityHub.registerEntityHubView(context);
        const host = createHost();
        activeEditor = {
            document: { languageId: 'markdown', uri: { fsPath: 'C:\\vault\\johnny-rico.md' } }
        };
        currentNeighbors = ['roughnecks'];

        registeredProvider.resolveWebviewView(host);
        htmlStates.length = 0;
        entityHub.refreshEntityHub('carmen-ibanez');

        assert.equal(htmlStates.length, 0);
    });

    test('webview openNode message opens the target note', async () => {
        const context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] };
        entityHub.registerEntityHubView(context);
        const host = createHost();
        activeEditor = {
            document: { languageId: 'markdown', uri: { fsPath: 'C:\\vault\\johnny-rico.md' } }
        };
        registeredProvider.resolveWebviewView(host);

        await host.emitMessage({ command: 'openNode', id: 'roughnecks' });

        assert.deepEqual(openedDocs, ['C:\\vault\\roughnecks.md']);
        assert.deepEqual(shownDocs, ['C:\\vault\\roughnecks.md']);
    });

    test('webview insertView message delegates to insertViewBlock after opening the source note', async () => {
        const context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] };
        entityHub.registerEntityHubView(context);
        const host = createHost();
        activeEditor = {
            document: { languageId: 'markdown', uri: { fsPath: 'C:\\vault\\johnny-rico.md' } }
        };
        registeredProvider.resolveWebviewView(host);

        await host.emitMessage({
            command: 'insertView',
            id: 'johnny-rico',
            queryText: '!view mission',
            sourceType: 'mission',
            field: 'commander'
        });
        await new Promise((resolve) => setImmediate(resolve));

        assert.ok(commandCalls.some((call) =>
            call.id === 'yamlink.insertViewBlock' &&
            call.args[1] === '!view mission' &&
            call.args[2] === 'mission' &&
            call.args[3] === 'commander' &&
            call.args[4] === 'johnny-rico'
        ));
    });

    test('renderHub falls back to the empty html when the model is empty', () => {
        const context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] };
        entityHub.registerEntityHubView(context);
        const host = createHost();
        activeEditor = {
            document: { languageId: 'markdown', uri: { fsPath: 'C:\\vault\\johnny-rico.md' } }
        };
        currentModel = { isEmpty: true };

        registeredProvider.resolveWebviewView(host);

        assert.equal(host.webview.html, 'empty:johnny-rico');
    });

    test('renderHub falls back to the error html when model building throws', () => {
        const context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] };
        entityHub.registerEntityHubView(context);
        const host = createHost();
        activeEditor = {
            document: { languageId: 'markdown', uri: { fsPath: 'C:\\vault\\johnny-rico.md' } }
        };
        modelError = new Error('boom');

        registeredProvider.resolveWebviewView(host);

        assert.match(host.webview.html, /^error:Could not render report for johnny-rico$/);
    });

    test('focusEntityHub calls show on the active host', () => {
        const context = { extensionUri: { fsPath: 'C:\\vault' }, subscriptions: [] };
        entityHub.registerEntityHubView(context);
        const host = createHost();
        registeredProvider.resolveWebviewView(host);

        entityHub.focusEntityHub();

        assert.equal(host.showCalled, true);
    });
});
