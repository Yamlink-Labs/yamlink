'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

const commandMap = new Map();
const infoMessages = [];
const shownDocuments = [];

class Position {
    constructor(line, character) {
        this.line = line;
        this.character = character;
    }
}

class Range {
    constructor(start, end) {
        this.start = start;
        this.end = end;
    }
}

class Selection extends Range {}

class WorkspaceEdit {
    constructor() {
        this.ops = [];
    }
    insert(uri, position, text) {
        this.ops.push({ type: 'insert', uri, position, text });
    }
    replace(uri, range, text) {
        this.ops.push({ type: 'replace', uri, range, text });
    }
}

function offsetForPosition(text, position) {
    const lines = String(text).split('\n');
    let offset = 0;
    for (let i = 0; i < position.line; i++) offset += (lines[i] || '').length + 1;
    return offset + position.character;
}

function applyWorkspaceEdit(edit) {
    for (const op of edit.ops) {
        const document = op.uri.__document;
        if (!document) continue;
        if (op.type === 'insert') {
            const offset = offsetForPosition(document._text, op.position);
            document._text = `${document._text.slice(0, offset)}${op.text}${document._text.slice(offset)}`;
            continue;
        }
        if (op.type === 'replace') {
            const start = offsetForPosition(document._text, op.range.start);
            const end = offsetForPosition(document._text, op.range.end);
            document._text = `${document._text.slice(0, start)}${op.text}${document._text.slice(end)}`;
        }
    }
    return true;
}

function createDocument(text, fsPath = 'C:\\vault\\note.md') {
    const document = {
        _text: text,
        languageId: 'markdown',
        uri: {
            fsPath,
            __document: null
        },
        getText() {
            return this._text;
        },
        lineAt(line) {
            const lines = this._text.split('\n');
            return { text: lines[line] || '' };
        },
        get lineCount() {
            return this._text.split('\n').length;
        },
        saveCalls: 0,
        async save() {
            this.saveCalls += 1;
            return true;
        }
    };
    document.uri.__document = document;
    return document;
}

const mockWindow = {
    activeTextEditor: null,
    async showTextDocument(document) {
        shownDocuments.push(document.uri.fsPath);
        return { document };
    },
    async showQuickPick(items) {
        return items[0] || null;
    },
    async showInputBox() {
        return '';
    },
    showInformationMessage(message) {
        infoMessages.push(message);
    },
    showErrorMessage(message) {
        infoMessages.push(message);
    }
};

const mockWorkspace = {
    workspaceFolders: [{ uri: { fsPath: 'C:\\vault' } }],
    textDocuments: [],
    async applyEdit(edit) {
        return applyWorkspaceEdit(edit);
    },
    async openTextDocument() {
        return createDocument('');
    }
};

const mockCommands = {
    registerCommand(id, handler) {
        commandMap.set(id, handler);
        return { dispose() { commandMap.delete(id); } };
    },
    async executeCommand(id, ...args) {
        if (id === 'yamlink.insertViewBlock') return `delegated:${id}`;
        const handler = commandMap.get(id);
        if (!handler) return undefined;
        return handler(...args);
    }
};

const defaultExecuteCommand = mockCommands.executeCommand;

require.cache.__ca_vscode__ = {
    id: '__ca_vscode__',
    filename: '__ca_vscode__',
    loaded: true,
    exports: {
        window: mockWindow,
        workspace: mockWorkspace,
        commands: mockCommands,
        languages: {
            registerCodeActionsProvider() {
                return { dispose() {} };
            }
        },
        Position,
        Range,
        Selection,
        WorkspaceEdit,
        CodeAction: class CodeAction {},
        CodeActionKind: { QuickFix: 'QuickFix', RefactorRewrite: 'RefactorRewrite' }
    }
};

require.cache.__ca_diagnostics__ = {
    id: '__ca_diagnostics__',
    filename: '__ca_diagnostics__',
    loaded: true,
    exports: { validateAll() {} }
};

require.cache.__ca_typeRegistry__ = {
    id: '__ca_typeRegistry__',
    filename: '__ca_typeRegistry__',
    loaded: true,
    exports: { getTypes() { return new Set(['contact']); } }
};

require.cache.__ca_schemaRegistry__ = {
    id: '__ca_schemaRegistry__',
    filename: '__ca_schemaRegistry__',
    loaded: true,
    exports: {
        getSchema() {
            return { fields: { name: {}, status: {} } };
        }
    }
};

require.cache.__ca_graph__ = {
    id: '__ca_graph__',
    filename: '__ca_graph__',
    loaded: true,
    exports: {
        isOrphan() { return false; },
        getBacklinks() { return []; }
    }
};

require.cache.__ca_suggestions__ = {
    id: '__ca_suggestions__',
    filename: '__ca_suggestions__',
    loaded: true,
    exports: {
        computeSuggestionsForNode() { return []; }
    }
};

require.cache.__ca_entityHub__ = {
    id: '__ca_entityHub__',
    filename: '__ca_entityHub__',
    loaded: true,
    exports: {
        buildEntityHubModel() {
            return { nodeFields: {}, recipes: [] };
        }
    }
};

require.cache.__ca_index__ = {
    id: '__ca_index__',
    filename: '__ca_index__',
    loaded: true,
    exports: {
        getFieldsCache() {
            return new Map([['contact-1', { type: 'contact', name: 'Alice', status: 'active' }]]);
        },
        getPathIndex() {
            return new Map([['C:\\vault\\note.md', 'contact-1']]);
        },
        updateSingleFile() {}
    }
};

let refinementResult = null;
let revealCalls = 0;

require.cache.__ca_viewBuilder__ = {
    id: '__ca_viewBuilder__',
    filename: '__ca_viewBuilder__',
    loaded: true,
    exports: {
        appendQueryOptions(base) { return base; },
        buildIncomingViewQuery() { return '!view incoming *'; },
        buildRefinedBlockText(_block, query) { return query?.__text || '!view contact'; },
        buildTypeViewQuery() { return '!view contact'; },
        buildLikelyRepairActions() { return []; },
        defaultSelectClauseForType() { return '\nselect name, status'; },
        getAvailableFieldsForType() { return ['name', 'status', 'created']; },
        getSchemaBackedDefaultSortField() { return 'created'; },
        getViewBlockAtRange() { return null; },
        getViewBlockByIndex() { return null; },
        refineParsedQuery(query) { return query; },
        async revealDocumentAndRunViews() { revealCalls += 1; },
        async runGuidedViewBuilder() { return '!view contact'; },
        async runViewRefinementBuilder() { return refinementResult; },
        async runViewRefinementByIndex() { return refinementResult; }
    }
};

require.cache.__ca_id__ = {
    id: '__ca_id__',
    filename: '__ca_id__',
    loaded: true,
    exports: { canonicalizeId(value) { return String(value || '').trim().toLowerCase(); } }
};

require.cache.__ca_workspace__ = {
    id: '__ca_workspace__',
    filename: '__ca_workspace__',
    loaded: true,
    exports: {
        getPrimaryWorkspaceRoot() { return 'C:\\vault'; },
        getWorkspaceRootForFile() { return 'C:\\vault'; }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__ca_vscode__';
    if (request === '../diagnostics/diagnostics') return '__ca_diagnostics__';
    if (request === '../registries/typeRegistry') return '__ca_typeRegistry__';
    if (request === '../registries/schemaRegistry') return '__ca_schemaRegistry__';
    if (request === '../core/graph') return '__ca_graph__';
    if (request === '../engine/suggestions') return '__ca_suggestions__';
    if (request === '../features/entityHubModel') return '__ca_entityHub__';
    if (request === '../core/index') return '__ca_index__';
    if (request === '../core/indexService') return '__ca_index__';
    if (request === './viewBuilder') return '__ca_viewBuilder__';
    if (request === '../core/id') return '__ca_id__';
    if (request === '../core/workspace') return '__ca_workspace__';
    return originalResolve(request, parent, ...rest);
};

const { registerCodeActions } = require('../src/actions/codeActions');

afterEach(() => {
    infoMessages.length = 0;
    shownDocuments.length = 0;
    revealCalls = 0;
    refinementResult = null;
    mockWindow.activeTextEditor = null;
    mockCommands.executeCommand = defaultExecuteCommand;
    commandMap.clear();
});

describe('code actions integration', () => {
    test('registers query commands and inserts a starter view into the active markdown document', async () => {
        const context = { subscriptions: [] };
        registerCodeActions(context, () => new Map(), null);

        assert.ok(commandMap.has('yamlink.insertViewBlock'));
        assert.ok(commandMap.has('yamlink.queryBuilder'));
        assert.ok(commandMap.has('yamlink.refineViewBlock'));

        const document = createDocument('# Dashboard\n');
        mockWindow.activeTextEditor = { document, selection: new Selection(new Position(0, 0), new Position(0, 0)) };

        await commandMap.get('yamlink.insertViewBlock')(null, '!view contact', 'contact');

        assert.match(document.getText(), /## Contacts/);
        assert.match(document.getText(), /!view contact\nselect name, status/);
        assert.equal(document.saveCalls, 1);
        assert.equal(revealCalls, 1);
        assert.ok(infoMessages.some((message) => message.includes('Inserted !view contact block')));
    });

    test('query builder command delegates to insertViewBlock', async () => {
        const context = { subscriptions: [] };
        registerCodeActions(context, () => new Map(), null);

        let delegated = false;
        mockCommands.executeCommand = async function (id) {
            if (id === 'yamlink.insertViewBlock') delegated = true;
        };

        await commandMap.get('yamlink.queryBuilder')();
        assert.equal(delegated, true);
    });

    test('refine view command replaces the current block in the active markdown document', async () => {
        const context = { subscriptions: [] };
        registerCodeActions(context, () => new Map(), null);

        const document = createDocument('!view contact\nsort name\n');
        mockWindow.activeTextEditor = {
            document,
            selection: new Selection(new Position(0, 0), new Position(0, 0))
        };
        refinementResult = {
            start: 0,
            end: 2,
            nextText: '!view contact\nsort created desc'
        };

        await commandMap.get('yamlink.refineViewBlock')();

        assert.equal(document.getText(), '!view contact\nsort created desc\n');
        assert.equal(document.saveCalls, 1);
        assert.equal(revealCalls, 1);
        assert.ok(infoMessages.some((message) => message.includes('Refined view block')));
    });

    test('refineViewBlockAtIndex command refines the nth view block by index', async () => {
        const context = { subscriptions: [] };
        registerCodeActions(context, () => new Map(), null);

        assert.ok(commandMap.has('yamlink.refineViewBlockAtIndex'));

        const document = createDocument('!view contact\nsort name\n\n!view account\n');
        mockWindow.activeTextEditor = { document, selection: new Selection(new Position(0, 0), new Position(0, 0)) };
        refinementResult = {
            start: 0,
            end: 2,
            nextText: '!view contact\nsort created desc'
        };

        await commandMap.get('yamlink.refineViewBlockAtIndex')(document, 0);

        assert.equal(document.getText(), '!view contact\nsort created desc\n\n!view account\n');
        assert.equal(document.saveCalls, 1);
        assert.equal(revealCalls, 1);
        assert.ok(infoMessages.some((message) => message.includes('Refined view block')));
    });

    test('refineViewBlockAtIndex does nothing when the result is null', async () => {
        const context = { subscriptions: [] };
        registerCodeActions(context, () => new Map(), null);

        const document = createDocument('# No views\n');
        refinementResult = null;

        await commandMap.get('yamlink.refineViewBlockAtIndex')(document, 0);

        assert.equal(document.saveCalls, 0);
        assert.equal(revealCalls, 0);
    });
});
