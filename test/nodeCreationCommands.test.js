'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

const originalResolve = Module._resolveFilename.bind(Module);

const commandMap = new Map();
const infoMessages = [];
const warningMessages = [];
const errorMessages = [];
const shownDocs = [];
const writeFieldCalls = [];
const writeFiles = new Map();
const openDocs = new Map();
let inputQueue = [];
let pickQueue = [];
let _buildIndexCalls = 0;
let invalidateCalls = [];
let updateCalls = [];
let updateSingleFileResult = { changed: true, needsFull: false };
let templateDirExists = false;
let templateFiles = [];
let createdDirectories = [];
let schemaTargets = new Set(['contact', 'mission']);
const VAULT_ROOT = 'C:\\vault';

function vaultPath(...parts) {
    return path.join(VAULT_ROOT, ...parts);
}

function normalizeFsPath(value) {
    return String(value || '').replace(/\//g, '\\');
}

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
}

function createDocument(text, fsPath) {
    return {
        _text: text,
        uri: { fsPath },
        getText() {
            return this._text;
        },
        lineAt(line) {
            return { text: String(this._text).split('\n')[line] || '' };
        }
    };
}

const mockWindow = {
    async showInputBox() {
        return inputQueue.shift() ?? '';
    },
    async showQuickPick(items) {
        const next = pickQueue.shift();
        if (typeof next === 'function') return next(items);
        if (next !== undefined) return next;
        return items[0] || null;
    },
    showInformationMessage(message, ...actions) {
        infoMessages.push(message);
        return Promise.resolve(actions[0] || undefined);
    },
    showWarningMessage(message) {
        warningMessages.push(message);
        return Promise.resolve(undefined);
    },
    showErrorMessage(message) {
        errorMessages.push(message);
        return Promise.resolve(undefined);
    },
    async showTextDocument(document) {
        shownDocs.push(document.uri.fsPath);
        return {
            document,
            selection: null,
            revealRange() {}
        };
    }
};

const mockWorkspace = {
    workspaceFolders: [{ uri: { fsPath: VAULT_ROOT } }],
    async openTextDocument(arg) {
        if (typeof arg === 'string') {
            const key = normalizeFsPath(arg);
            const content = writeFiles.get(key) || '';
            const doc = createDocument(content, key);
            openDocs.set(key, doc);
            return doc;
        }
        if (arg && arg.fsPath) {
            const key = normalizeFsPath(arg.fsPath);
            const content = writeFiles.get(key) || '';
            const doc = createDocument(content, key);
            openDocs.set(key, doc);
            return doc;
        }
        return createDocument('', vaultPath('untitled.md'));
    },
    async applyEdit(edit) {
        for (const op of edit.ops) {
            const fsPath = normalizeFsPath(op.uri?.fsPath || op.uri);
            const doc = openDocs.get(fsPath);
            if (!doc || op.type !== 'insert') continue;
            const lines = doc._text.split('\n');
            lines.splice(op.position.line, 0, op.text);
            doc._text = lines.join('\n');
        }
        return true;
    }
};

const mockCommands = {
    registerCommand(id, handler) {
        commandMap.set(id, handler);
        return { dispose() { commandMap.delete(id); } };
    },
    async executeCommand(id, ...args) {
        const handler = commandMap.get(id);
        if (!handler) return undefined;
        return handler(...args);
    }
};

require.cache.__ncc_vscode__ = {
    id: '__ncc_vscode__',
    filename: '__ncc_vscode__',
    loaded: true,
    exports: {
        window: mockWindow,
        workspace: mockWorkspace,
        commands: mockCommands,
        Position,
        Range,
        Selection,
        WorkspaceEdit,
        Uri: { file(fsPath) { return { fsPath }; } },
        ViewColumn: { One: 1 }
    }
};

require.cache.__ncc_diagnostics__ = {
    id: '__ncc_diagnostics__',
    filename: '__ncc_diagnostics__',
    loaded: true,
    exports: { validateAll() {} }
};

require.cache.__ncc_index__ = {
    id: '__ncc_index__',
    filename: '__ncc_index__',
    loaded: true,
    exports: {
        buildIndex() { _buildIndexCalls += 1; },
        updateSingleFile(filePath) {
            updateCalls.push(filePath);
            return updateSingleFileResult;
        },
        invalidateFileCache(filePath) { invalidateCalls.push(filePath); }
    }
};

require.cache.__ncc_indexService__ = {
    id: '__ncc_indexService__',
    filename: '__ncc_indexService__',
    loaded: true,
    exports: {
        getFieldsCache() {
            return new Map([
                ['source-note', { id: 'source-note', type: 'contact', account: '[[existing-account]]' }],
                ['existing-account', { id: 'existing-account', type: 'account', name: 'Existing Account' }],
                ['roughnecks', { id: 'roughnecks', type: 'unit', name: 'Roughnecks' }],
                ['other-account', { id: 'other-account', type: 'account', owner: '[[source-note]]' }],
                ['target-account', { id: 'target-account', type: 'account', owner: '[[source-note]]' }]
            ]);
        }
    }
};

require.cache.__ncc_id__ = {
    id: '__ncc_id__',
    filename: '__ncc_id__',
    loaded: true,
    exports: {
        canonicalizeId(value) {
            return String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
        }
    }
};

require.cache.__ncc_workspace__ = {
    id: '__ncc_workspace__',
    filename: '__ncc_workspace__',
    loaded: true,
    exports: {
        getPrimaryWorkspaceRoot() { return 'C:\\vault'; },
        getWorkspaceRootForFile() { return 'C:\\vault'; }
    }
};

require.cache.__ncc_writeField__ = {
    id: '__ncc_writeField__',
    filename: '__ncc_writeField__',
    loaded: true,
    exports: {
        async writeFieldValue(filePath, field, value) {
            writeFieldCalls.push({ filePath, field, value });
            return true;
        }
    }
};

require.cache.__ncc_frontmatter__ = {
    id: '__ncc_frontmatter__',
    filename: '__ncc_frontmatter__',
    loaded: true,
    exports: {
        parseFrontmatterDocument(content) {
            const lines = String(content).split('\n');
            const data = {};
            for (const line of lines) {
                const match = line.match(/^([\w-]+):\s*(.+)?$/);
                if (match) data[match[1]] = (match[2] || '').trim();
            }
            return { hasFrontmatter: true, data };
        }
    }
};

require.cache.__ncc_schemaRegistry__ = {
    id: '__ncc_schemaRegistry__',
    filename: '__ncc_schemaRegistry__',
    loaded: true,
    exports: {
        getSchema(type) {
            if (type === 'contact') {
                return {
                    fields: {
                        name: { type: 'string', required: true },
                        account: { type: 'relation', required: false },
                        email: { type: 'string', required: false }
                    }
                };
            }
            return null;
        },
        getSchemaTargets() {
            return new Set(schemaTargets);
        }
    }
};

const realFs = require('fs');
const realExistsSync = realFs.existsSync;
const realReaddirSync = realFs.readdirSync;
const realReadFileSync = realFs.readFileSync;
const realWriteFileSync = realFs.writeFileSync;
const realMkdirSync = realFs.mkdirSync;

realFs.existsSync = function (targetPath) {
    const key = normalizeFsPath(targetPath);
    if (writeFiles.has(key)) return true;
    if (key.endsWith('\\_templates')) return templateDirExists;
    return false;
};
realFs.readdirSync = function (targetPath) {
    if (normalizeFsPath(targetPath).includes('\\_templates')) return templateFiles.slice();
    return [];
};
realFs.readFileSync = function (targetPath) {
    const key = normalizeFsPath(targetPath);
    if (!key.startsWith(`${VAULT_ROOT}\\`)) {
        return realReadFileSync.apply(this, arguments);
    }
    if (writeFiles.has(key)) return writeFiles.get(key);
    throw new Error(`ENOENT: ${key}`);
};
realFs.writeFileSync = function (targetPath, content) {
    writeFiles.set(normalizeFsPath(targetPath), String(content));
};
realFs.mkdirSync = function (targetPath) {
    const key = normalizeFsPath(targetPath);
    createdDirectories.push(key);
    if (key.includes('\\_templates')) templateDirExists = true;
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__ncc_vscode__';
    if (request === '../diagnostics/diagnostics') return '__ncc_diagnostics__';
    if (request === '../core/index') return '__ncc_index__';
    if (request === '../core/indexService') return '__ncc_indexService__';
    if (request === '../core/id') return '__ncc_id__';
    if (request === '../core/workspace') return '__ncc_workspace__';
    if (request === '../core/writeField') return '__ncc_writeField__';
    if (request === '../core/frontmatter') return '__ncc_frontmatter__';
    if (request === '../registries/schemaRegistry') return '__ncc_schemaRegistry__';
    return originalResolve(request, parent, ...rest);
};

const { registerNodeCreationCommands } = require('../src/actions/codeActionsNodeCreationCommands');

beforeEach(() => {
    commandMap.clear();
    infoMessages.length = 0;
    warningMessages.length = 0;
    errorMessages.length = 0;
    shownDocs.length = 0;
    writeFieldCalls.length = 0;
    writeFiles.clear();
    openDocs.clear();
    inputQueue = [];
    pickQueue = [];
    _buildIndexCalls = 0;
    invalidateCalls = [];
    updateCalls = [];
    updateSingleFileResult = { changed: true, needsFull: false };
    templateDirExists = false;
    templateFiles = [];
    createdDirectories = [];
    schemaTargets = new Set(['contact', 'mission']);
});

after(() => {
    Module._resolveFilename = originalResolve;
    realFs.existsSync = realExistsSync;
    realFs.readdirSync = realReaddirSync;
    realFs.readFileSync = realReadFileSync;
    realFs.writeFileSync = realWriteFileSync;
    realFs.mkdirSync = realMkdirSync;
});

describe('node creation commands', () => {
    test('createNote warns when the target file already exists', async () => {
        const context = { subscriptions: [] };
        registerNodeCreationCommands(context, () => new Map(), () => new Set(['contact']));

        writeFiles.set(vaultPath('existing-note.md'), '---\nid: existing-note\n---\n');

        const result = await commandMap.get('yamlink.createNote')('existing-note', 'contact');

        assert.equal(result, null);
        assert.ok(warningMessages.some((message) => message.includes('already exists')));
    });

    test('createNote uses schema frontmatter when a schema exists for the chosen type', async () => {
        const context = { subscriptions: [] };
        registerNodeCreationCommands(context, () => new Map(), () => new Set(['contact']));

        await commandMap.get('yamlink.createNote')('carmen-ibanez', 'contact');

        const created = writeFiles.get(vaultPath('carmen-ibanez.md'));
        assert.match(created, /type: contact/);
        assert.match(created, /name:/);
        assert.match(created, /account: \[\[\]\]/);
        assert.match(created, /email:/);
    });

    test('createNote falls back to minimal frontmatter when no schema or matching notes exist', async () => {
        const context = { subscriptions: [] };
        registerNodeCreationCommands(context, () => new Map(), () => new Set(['briefing']));

        await commandMap.get('yamlink.createNote')('new-briefing', 'briefing');

        const created = writeFiles.get(vaultPath('new-briefing.md'));
        assert.match(created, /id: new-briefing/);
        assert.match(created, /type: briefing/);
        assert.match(created, /created: \d{4}-\d{2}-\d{2}/);
    });

    test('createRelatedNote creates the note and backfills the source relation field', async () => {
        const context = { subscriptions: [] };
        registerNodeCreationCommands(context, () => new Map(), () => new Set(['contact', 'account']));

        writeFiles.set(vaultPath('source-note.md'), [
            '---',
            'id: source-note',
            'type: contact',
            'account: [[existing-account]]',
            '---',
            ''
        ].join('\n'));
        inputQueue.push('target-account');

        await commandMap.get('yamlink.createRelatedNote')({
            targetType: 'account',
            fieldName: 'account',
            sourceId: 'source-note',
            sourceFilePath: vaultPath('source-note.md'),
            sourceType: 'contact'
        });

        assert.ok(writeFiles.has(vaultPath('target-account.md')));
        assert.ok(writeFieldCalls.some((call) =>
            normalizeFsPath(call.filePath) === vaultPath('source-note.md') &&
            call.field === 'account' &&
            call.value.includes('[[existing-account]]') &&
            call.value.includes('[[target-account]]')
        ));
    });

    test('createRelatedNote stops cleanly when the id prompt is cancelled', async () => {
        const context = { subscriptions: [] };
        registerNodeCreationCommands(context, () => new Map(), () => new Set(['contact', 'account']));

        inputQueue.push('');

        await commandMap.get('yamlink.createRelatedNote')({
            targetType: 'account',
            fieldName: 'account',
            sourceId: 'source-note',
            sourceFilePath: vaultPath('source-note.md'),
            sourceType: 'contact'
        });

        assert.equal(writeFieldCalls.length, 0);
        assert.equal(writeFiles.has(vaultPath('target-account.md')), false);
    });

    test('newNodeFromTemplate scaffolds _templates with a starter template when empty', async () => {
        const context = { subscriptions: [] };
        registerNodeCreationCommands(context, () => new Map(), () => new Set(['contact']));

        await commandMap.get('yamlink.newNodeFromTemplate')();

        assert.ok(createdDirectories.includes(vaultPath('_templates')));
        assert.ok(writeFiles.has(vaultPath('_templates', 'contact.md')));
        assert.ok(shownDocs.includes(vaultPath('_templates', 'contact.md')));
        assert.ok(infoMessages.some((message) => message.includes('_templates/ created')));
    });

    test('newNodeFromTemplate creates a note from the selected template', async () => {
        const context = { subscriptions: [] };
        registerNodeCreationCommands(context, () => new Map(), () => new Set(['contact']));

        templateDirExists = true;
        templateFiles = ['contact.md'];
        writeFiles.set(vaultPath('_templates', 'contact.md'), [
            '---',
            'id:',
            'type: contact',
            'name:',
            'created:',
            '---',
            ''
        ].join('\n'));
        inputQueue.push('ace-levy');

        await commandMap.get('yamlink.newNodeFromTemplate')();

        const created = writeFiles.get(vaultPath('ace-levy.md'));
        assert.match(created, /id: ace-levy/);
        assert.match(created, /type: contact/);
        assert.ok(shownDocs.includes(vaultPath('ace-levy.md')));
    });

    test('newNodeFromTemplate warns when the generated file already exists', async () => {
        const context = { subscriptions: [] };
        registerNodeCreationCommands(context, () => new Map(), () => new Set(['contact']));

        templateDirExists = true;
        templateFiles = ['contact.md'];
        writeFiles.set(vaultPath('_templates', 'contact.md'), [
            '---',
            'id:',
            'type: contact',
            'name:',
            'created:',
            '---',
            ''
        ].join('\n'));
        writeFiles.set(vaultPath('ace-levy.md'), '---\nid: ace-levy\n---\n');
        inputQueue.push('ace-levy');

        await commandMap.get('yamlink.newNodeFromTemplate')();

        assert.ok(warningMessages.some((message) => message.includes('already exists')));
    });

    test('newNoteFromSchema creates a note with schema fields and relation placeholders', async () => {
        const context = { subscriptions: [] };
        registerNodeCreationCommands(context, () => new Map(), () => new Set(['contact', 'mission']));

        inputQueue.push('carmen-ibanez');

        await commandMap.get('yamlink.newNoteFromSchema')();

        const created = writeFiles.get(vaultPath('carmen-ibanez.md'));
        assert.match(created, /id: carmen-ibanez/);
        assert.match(created, /type: contact/);
        assert.match(created, /name:/);
        assert.match(created, /account: \[\[\]\]/);
        assert.match(created, /email:/);
    });

    test('newNoteFromSchema explains the missing-schema case cleanly', async () => {
        const context = { subscriptions: [] };
        registerNodeCreationCommands(context, () => new Map(), () => new Set(['contact', 'mission']));

        schemaTargets = new Set();

        await commandMap.get('yamlink.newNoteFromSchema')();

        assert.ok(infoMessages.some((message) => message.includes('No schemas found')));
    });

    test('addFrontmatter inserts a starter block into notes without frontmatter', async () => {
        const context = { subscriptions: [] };
        registerNodeCreationCommands(context, () => new Map(), () => new Set(['contact', 'mission']));

        const document = createDocument('# Draft note\n', vaultPath('draft.md'));
        document.save = async function save() { return true; };
        const edits = [];
        mockWorkspace.applyEdit = async function applyEdit(edit) {
            edits.push(...edit.ops);
            return true;
        };

        await commandMap.get('yamlink.addFrontmatter')(document, 'draft-note');

        assert.equal(edits.length, 1);
        assert.match(edits[0].text, /id: draft-note/);
        assert.ok(infoMessages.some((message) => message.includes('is now a Yamlink node')));
    });
});
