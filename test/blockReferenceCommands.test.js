'use strict';

const { test, describe, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const originalResolve = Module._resolveFilename.bind(Module);
const commandMap = new Map();
const infoMessages = [];
const warningMessages = [];
const statusMessages = [];
const clipboardWrites = [];
const openedDocuments = [];
let quickPickResponse = null;
let inputBoxResponse = null;

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
    Position,
    Range,
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
        async showInputBox() {
            return inputBoxResponse;
        },
        showInformationMessage(message) {
            infoMessages.push(message);
            return Promise.resolve(undefined);
        },
        showWarningMessage(message) {
            warningMessages.push(message);
            return Promise.resolve(undefined);
        },
        showErrorMessage(message) {
            warningMessages.push(message);
            return Promise.resolve(undefined);
        },
        setStatusBarMessage(message) {
            statusMessages.push(message);
            return { dispose() {} };
        },
        async showTextDocument(document, options) {
            openedDocuments.push({ document, options });
            return { document };
        }
    },
    workspace: {
        workspaceFolders: [],
        async openTextDocument(uriOrPath) {
            const fsPath = typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.fsPath;
            return { uri: { fsPath }, getText: () => fs.readFileSync(fsPath, 'utf8') };
        },
        async applyEdit(edit) {
            for (const change of edit._edits) {
                const filePath = change.uri.fsPath;
                let text = fs.readFileSync(filePath, 'utf8');
                const lines = text.split('\n');
                const startLine = lines.slice(0, change.range.start.line);
                const endLine = lines.slice(change.range.end.line + 1);
                const middle = change.replacement;
                text = [...startLine, middle, ...endLine].join('\n');
                fs.writeFileSync(filePath, text, 'utf8');
            }
            return true;
        }
    },
    WorkspaceEdit: class WorkspaceEdit {
        constructor() { this._edits = []; }
        replace(uri, range, replacement) { this._edits.push({ uri, range, replacement }); }
    },
    ViewColumn: { One: 1 }
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
    buildBlockQuickPickItems,
    deriveBlockExtractTitle
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
        openedDocuments.length = 0;
        quickPickResponse = null;
        inputBoxResponse = null;
        vscodeStub.window.activeTextEditor = null;
        vscodeStub.workspace.workspaceFolders = [];
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

describe('deriveBlockExtractTitle', () => {
    test('uses the task text as the title', () => {
        assert.equal(deriveBlockExtractTitle({ type: 'task', label: 'Review recon logs' }), 'Review recon logs');
    });

    test('uses only the first line of a multi-line quote', () => {
        assert.equal(
            deriveBlockExtractTitle({ type: 'quote', label: 'First line\nSecond line' }),
            'First line'
        );
    });

    test('falls back to the block kind when there is no usable text', () => {
        assert.equal(deriveBlockExtractTitle({ type: 'footnote', label: '' }), 'Footnote');
    });
});

describe('yamlink.extractBlockToNote — body-target action, real files on a real temp dir', () => {
    let tmpDir;

    beforeEach(() => {
        commandMap.clear();
        infoMessages.length = 0;
        warningMessages.length = 0;
        statusMessages.length = 0;
        openedDocuments.length = 0;
        quickPickResponse = null;
        inputBoxResponse = null;
        vscodeStub.window.activeTextEditor = null;
        initMutationLog(null);
        clearMutationEvents();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-extract-'));
        vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: tmpDir } }];
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    after(() => {
        Module._resolveFilename = originalResolve;
    });

    function writeSourceNote(text) {
        const fsPath = path.join(tmpDir, 'report.md');
        fs.writeFileSync(fsPath, text, 'utf8');
        return fsPath;
    }

    test('moves the exact task block into a new note and replaces it with an embed', async () => {
        const context = { subscriptions: { push() {} } };
        registerBlockReferenceCommands(context, () => new Map([[path.join(tmpDir, 'report.md'), 'report']]));
        const text = [
            '---',
            'id: report',
            '---',
            '# Tasks',
            '- [ ] Review recon logs'
        ].join('\n');
        const fsPath = writeSourceNote(text);
        vscodeStub.window.activeTextEditor = makeEditor(text, fsPath, 4);
        inputBoxResponse = 'Review recon logs';

        await commandMap.get('yamlink.extractBlockToNote')();

        const newPath = path.join(tmpDir, 'review-recon-logs.md');
        assert.ok(fs.existsSync(newPath), 'expected the extracted note to be written to disk');
        const newContent = fs.readFileSync(newPath, 'utf8');
        assert.match(newContent, /^---\nid: review-recon-logs\n/);
        assert.match(newContent, /source: \[\[report\]\]/);
        assert.match(newContent, /- \[ \] Review recon logs/);

        const sourceContent = fs.readFileSync(fsPath, 'utf8');
        assert.match(sourceContent, /!\[\[review-recon-logs\]\]/);
        assert.ok(!sourceContent.includes('- [ ] Review recon logs'), 'the task line should have been replaced, not duplicated');

        assert.ok(openedDocuments.some((entry) => entry.document.uri.fsPath === newPath), 'expected the new note to be opened');

        const events = getMutationEvents({ noteId: 'report', type: 'block_reference_created' });
        assert.equal(events.length, 1);
        assert.equal(events[0].meta.targetNoteId, 'review-recon-logs');
        assert.equal(events[0].meta.blockType, 'task');
    });

    test('refuses to overwrite an existing note with the same id', async () => {
        const context = { subscriptions: { push() {} } };
        registerBlockReferenceCommands(context, () => new Map([[path.join(tmpDir, 'report.md'), 'report']]));
        const text = ['---', 'id: report', '---', '> A real quote worth its own note'].join('\n');
        const fsPath = writeSourceNote(text);
        fs.writeFileSync(path.join(tmpDir, 'a-real-quote-worth-its-own-note.md'), '---\nid: a-real-quote-worth-its-own-note\n---\nalready exists\n', 'utf8');
        vscodeStub.window.activeTextEditor = makeEditor(text, fsPath, 3);
        inputBoxResponse = 'A real quote worth its own note';

        await commandMap.get('yamlink.extractBlockToNote')();

        assert.ok(warningMessages.some((m) => /already exists/.test(m)));
        const sourceContent = fs.readFileSync(fsPath, 'utf8');
        assert.ok(sourceContent.includes('> A real quote worth its own note'), 'the source block must be left untouched when extraction is refused');
    });

    test('only offers tasks/quotes/footnotes, never headings, for extraction', async () => {
        const context = { subscriptions: { push() {} } };
        registerBlockReferenceCommands(context, () => new Map([[path.join(tmpDir, 'report.md'), 'report']]));
        const text = ['---', 'id: report', '---', '# Overview', 'Body paragraph, no other blocks'].join('\n');
        const fsPath = writeSourceNote(text);
        vscodeStub.window.activeTextEditor = makeEditor(text, fsPath, 3);

        await commandMap.get('yamlink.extractBlockToNote')();

        assert.ok(infoMessages.some((m) => /No addressable tasks, quotes, or footnotes/.test(m)));
    });
});
