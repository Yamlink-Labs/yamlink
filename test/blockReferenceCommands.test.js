'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);
const commandMap = new Map();
const infoMessages = [];
const warningMessages = [];
const statusMessages = [];
const clipboardWrites = [];
let quickPickResponse = null;

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

const vscodeStub = {
    commands: {
        registerCommand(id, handler) {
            commandMap.set(id, handler);
            return { dispose() { commandMap.delete(id); } };
        }
    },
    env: {
        clipboard: {
            async writeText(value) {
                clipboardWrites.push(String(value || ''));
            }
        }
    },
    window: {
        activeTextEditor: null,
        async showQuickPick(items) {
            if (typeof quickPickResponse === 'function') return quickPickResponse(items);
            return quickPickResponse;
        },
        showInformationMessage(message) {
            infoMessages.push(message);
            return Promise.resolve(undefined);
        },
        showWarningMessage(message) {
            warningMessages.push(message);
            return Promise.resolve(undefined);
        },
        setStatusBarMessage(message) {
            statusMessages.push(message);
            return { dispose() {} };
        }
    }
};

require.cache.__blockref_vscode__ = {
    id: '__blockref_vscode__',
    filename: '__blockref_vscode__',
    loaded: true,
    exports: vscodeStub
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__blockref_vscode__';
    return originalResolve(request, parent, ...rest);
};

const {
    registerBlockReferenceCommands,
    buildBlockQuickPickItems
} = require('../src/actions/blockReferenceCommands');
const {
    initMutationLog,
    clearMutationEvents,
    getMutationEvents
} = require('../src/runtime/mutationEventLog');
const {
    extractMeaningfulBodyBlocks,
    buildTaskBlockId
} = require('../src/core/bodyBlocks');

function makeEditor(text, fsPath, selectionStartLine, selectionEndLine = selectionStartLine) {
    const doc = {
        languageId: 'markdown',
        uri: { fsPath },
        getText() {
            return text;
        }
    };
    const selection = new Range(
        new Position(selectionStartLine, 0),
        new Position(selectionEndLine, 0)
    );
    return {
        document: doc,
        selection,
        edits: [],
        async edit(callback) {
            const self = this;
            callback({
                replace(range, replacement) {
                    self.edits.push({ range, replacement });
                }
            });
            return true;
        }
    };
}

describe('block reference commands', () => {
    beforeEach(() => {
        commandMap.clear();
        infoMessages.length = 0;
        warningMessages.length = 0;
        statusMessages.length = 0;
        clipboardWrites.length = 0;
        quickPickResponse = null;
        vscodeStub.window.activeTextEditor = null;
        initMutationLog(null);
        clearMutationEvents();
    });

    after(() => {
        Module._resolveFilename = originalResolve;
    });

    test('copies a heading reference when cursor is on a heading', async () => {
        const context = { subscriptions: { push() {} } };
        const fsPath = 'C:\\vault\\report.md';
        registerBlockReferenceCommands(context, () => new Map([[fsPath, 'report']]));

        vscodeStub.window.activeTextEditor = makeEditor([
            '---',
            'id: report',
            '---',
            '# Overview',
            'Body'
        ].join('\n'), fsPath, 3);

        await commandMap.get('yamlink.copySectionReference')();

        assert.deepEqual(clipboardWrites, ['[[report#Overview]]']);
        assert.match(statusMessages[0], /Copied \[\[report#Overview\]\]/);
    });

    test('copies a task block reference when cursor is on a task', async () => {
        const context = { subscriptions: { push() {} } };
        const fsPath = 'C:\\vault\\tasks.md';
        registerBlockReferenceCommands(context, () => new Map([[fsPath, 'tasks']]));
        const text = [
            '---',
            'id: tasks',
            '---',
            '- [ ] Review recon logs'
        ].join('\n');
        vscodeStub.window.activeTextEditor = makeEditor(text, fsPath, 3);

        await commandMap.get('yamlink.copyBlockReference')();

        const expected = `[[tasks^${buildTaskBlockId(1, 'Review recon logs')}]]`;
        assert.deepEqual(clipboardWrites, [expected]);
    });

    test('inserts a picked block reference when cursor is not already on a block', async () => {
        const context = { subscriptions: { push() {} } };
        const fsPath = 'C:\\vault\\report.md';
        registerBlockReferenceCommands(context, () => new Map([[fsPath, 'report']]));
        const text = [
            '---',
            'id: report',
            '---',
            '# Overview',
            '',
            '> Quote line',
            '',
            'Body paragraph'
        ].join('\n');
        const editor = makeEditor(text, fsPath, 7);
        vscodeStub.window.activeTextEditor = editor;

        const blocks = extractMeaningfulBodyBlocks(text);
        const picks = buildBlockQuickPickItems('report', blocks);
        quickPickResponse = picks.find((item) => item.block.type === 'quote');

        await commandMap.get('yamlink.insertBlockReference')();

        assert.equal(editor.edits.length, 1);
        assert.match(editor.edits[0].replacement, /^\[\[report\^q1-/);
        assert.match(statusMessages[0], /Inserted \[\[report\^q1-/);
        const events = getMutationEvents({ noteId: 'report', type: 'block_reference_created' });
        assert.equal(events.length, 1);
        assert.equal(events[0].field, 'block_reference');
        assert.match(String(events[0].newValue || ''), /^\[\[report\^q1-/);
    });

    test('copies a section reference from an outline node argument', async () => {
        const context = { subscriptions: { push() {} } };
        const fsPath = 'C:\\vault\\report.md';
        registerBlockReferenceCommands(context, () => new Map([[fsPath, 'report']]));
        vscodeStub.window.activeTextEditor = makeEditor([
            '---',
            'id: report',
            '---',
            '# Overview',
            'Body',
            '## Evidence',
            'Proof'
        ].join('\n'), fsPath, 3);

        await commandMap.get('yamlink.copySectionReference')({
            heading: {
                line: 5,
                text: 'Evidence'
            }
        });

        assert.deepEqual(clipboardWrites, ['[[report#Evidence]]']);
    });

    test('copy block reference ignores headings and prompts for non-heading blocks only', async () => {
        const context = { subscriptions: { push() {} } };
        const fsPath = 'C:\\vault\\report.md';
        registerBlockReferenceCommands(context, () => new Map([[fsPath, 'report']]));
        const text = [
            '---',
            'id: report',
            '---',
            '# Overview',
            '',
            '> Quote line'
        ].join('\n');
        vscodeStub.window.activeTextEditor = makeEditor(text, fsPath, 3);

        const blocks = extractMeaningfulBodyBlocks(text);
        const picks = buildBlockQuickPickItems('report', blocks.filter((block) => block.type !== 'heading'));
        quickPickResponse = picks.find((item) => item.block.type === 'quote');

        await commandMap.get('yamlink.copyBlockReference')();

        assert.equal(clipboardWrites.length, 1);
        assert.match(clipboardWrites[0], /^\[\[report\^q1-/);
    });

    test('copy scoped reference uses a heading automatically when cursor is on a heading', async () => {
        const context = { subscriptions: { push() {} } };
        const fsPath = 'C:\\vault\\report.md';
        registerBlockReferenceCommands(context, () => new Map([[fsPath, 'report']]));
        vscodeStub.window.activeTextEditor = makeEditor([
            '---',
            'id: report',
            '---',
            '# Related Notes',
            'Body'
        ].join('\n'), fsPath, 3);

        await commandMap.get('yamlink.copyScopedReference')();

        assert.deepEqual(clipboardWrites, ['[[report#Related Notes]]']);
    });

    test('copy scoped reference uses a task block automatically when cursor is on a task', async () => {
        const context = { subscriptions: { push() {} } };
        const fsPath = 'C:\\vault\\tasks.md';
        registerBlockReferenceCommands(context, () => new Map([[fsPath, 'tasks']]));
        const text = [
            '---',
            'id: tasks',
            '---',
            '- [ ] Review recon logs'
        ].join('\n');
        vscodeStub.window.activeTextEditor = makeEditor(text, fsPath, 3);

        await commandMap.get('yamlink.copyScopedReference')();

        const expected = `[[tasks^${buildTaskBlockId(1, 'Review recon logs')}]]`;
        assert.deepEqual(clipboardWrites, [expected]);
    });

    test('insert scoped reference falls back to mixed picker when cursor is not on an addressable block', async () => {
        const context = { subscriptions: { push() {} } };
        const fsPath = 'C:\\vault\\report.md';
        registerBlockReferenceCommands(context, () => new Map([[fsPath, 'report']]));
        const text = [
            '---',
            'id: report',
            '---',
            '# Overview',
            '',
            '> Quote line',
            '',
            'Body paragraph'
        ].join('\n');
        const editor = makeEditor(text, fsPath, 7);
        vscodeStub.window.activeTextEditor = editor;

        const blocks = extractMeaningfulBodyBlocks(text);
        const picks = buildBlockQuickPickItems('report', blocks);
        quickPickResponse = picks.find((item) => item.block.type === 'heading');

        await commandMap.get('yamlink.insertScopedReference')();

        assert.equal(editor.edits.length, 1);
        assert.equal(editor.edits[0].replacement, '[[report#Overview]]');
    });
});
