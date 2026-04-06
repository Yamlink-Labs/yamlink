'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

class WorkspaceEdit {
    replace() {}
}

require.cache['__ace_vscode__'] = {
    id: '__ace_vscode__',
    filename: '__ace_vscode__',
    loaded: true,
    exports: {
        Uri: { file: (filePath) => ({ fsPath: filePath }) },
        workspace: {
            textDocuments: [],
            applyEdit: async () => true
        },
        Range: class Range {
            constructor(start, end) {
                this.start = start;
                this.end = end;
            }
        },
        WorkspaceEdit
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__ace_vscode__';
    return originalResolve(request, parent, ...rest);
};

const { buildIndex, getIndex, getFieldsCache } = require('../src/core/index');
const { getSchema } = require('../src/registries/schemaRegistry');
const { getWorkspaceRootForFile } = require('../src/core/workspace');
const { writeFieldValue } = require('../src/core/writeField');
const { normaliseDateInput } = require('../src/core/date');
const { parseSingleViewLine, runQuery } = require('../src/engine/query');

function withTempDir(run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-ace-'));
    try {
        run(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function writeFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

async function main() {
    withTempDir((root) => {
        const rootA = path.join(root, 'vault-a');
        const rootB = path.join(root, 'vault-b');

        writeFile(path.join(rootA, 'alpha.md'), '---\nid: alpha\ntype: character\n---\n');
        writeFile(path.join(rootB, 'beta.md'), '---\nid: beta\ntype: mission\ncommander: [[alpha]]\n---\n');
        writeFile(path.join(rootB, 'schema-task.md'), [
            '---',
            'id: schema-task',
            'type: schema',
            'target: task',
            'fields:',
            '  status:',
            '    type: string',
            '    required: false',
            '    options:',
            '      - todo',
            '      - doing',
            '      - done',
            '---',
            ''
        ].join('\n'));

        buildIndex([
            { uri: { fsPath: rootA } },
            { uri: { fsPath: rootB } }
        ]);

        assert.equal(getIndex().has('alpha'), true, 'indexes markdown nodes from the first root');
        assert.equal(getIndex().has('beta'), true, 'indexes markdown nodes from the second root');
        assert.equal(getFieldsCache().get('beta').commander, 'alpha', 'preserves relation fields across roots');

        const schema = getSchema('task');
        assert.ok(schema, 'registers schemas while indexing');
        assert.deepEqual(schema.fields.status.options, ['todo', 'doing', 'done'], 'preserves schema dropdown options');

        assert.equal(
            getWorkspaceRootForFile(
                [{ uri: { fsPath: rootA } }, { uri: { fsPath: rootB } }],
                path.join(rootB, 'nested', 'note.md')
            ),
            rootB,
            'resolves file paths to the deepest matching workspace root'
        );

        assert.equal(normaliseDateInput('26 March 2026'), '2026-03-26', 'normalises wider date formats');
        const typoResult = runQuery(parseSingleViewLine('!view charactrer'));
        assert.ok(typoResult.warnings.some(w => w.includes('Did you mean "character"')), 'suggests close query types on empty results');
        const calendarResult = runQuery(parseSingleViewLine('!view calendar'));
        assert.equal(calendarResult.success, true, 'supports calendar shorthand queries');
    });

    await withTempWriter();
    await withActiveViewRuntime();
    console.log('Ace local tests passed.');
}

async function withTempWriter() {
    await withTempDirAsync(async (root) => {
        const note = path.join(root, 'note.md');
        writeFile(note, [
            '---',
            'id: note',
            'active: true',
            'points: 7',
            'tags:',
            '  - alpha',
            '  - beta',
            '---',
            'Body'
        ].join('\n'));

        assert.equal(await writeFieldValue(note, 'active', 'false'), true, 'writes boolean values');
        assert.equal(await writeFieldValue(note, 'points', '11'), true, 'writes numeric values');
        assert.equal(await writeFieldValue(note, 'tags', 'gamma, delta'), true, 'round-trips list fields');
        assert.equal(await writeFieldValue(note, 'status', 'doing'), true, 'adds missing fields safely');

        const next = fs.readFileSync(note, 'utf8');
        assert.match(next, /active: false/, 'serializes booleans without quotes');
        assert.match(next, /points: 11/, 'serializes numbers without quotes');
        assert.match(next, /tags:\n  - gamma\n  - delta/, 'keeps array fields as YAML lists');
        assert.match(next, /status: doing/, 'appends new fields safely');
    });
}

function withTempDirAsync(run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-ace-'));
    return Promise.resolve()
        .then(() => run(dir))
        .finally(() => {
            fs.rmSync(dir, { recursive: true, force: true });
        });
}

async function withActiveViewRuntime() {
    const runtimeResolve = Module._resolveFilename.bind(Module);
    const listeners = {
        changeEditor: [],
        changeText: []
    };

    const runtimeWindow = {
        activeTextEditor: null,
        onDidChangeActiveTextEditor(handler) {
            listeners.changeEditor.push(handler);
            return { dispose() {} };
        }
    };

    const runtimeWorkspace = {
        onDidChangeTextDocument(handler) {
            listeners.changeText.push(handler);
            return { dispose() {} };
        }
    };

    require.cache['__ace_runtime_vscode__'] = {
        id: '__ace_runtime_vscode__',
        filename: '__ace_runtime_vscode__',
        loaded: true,
        exports: {
            window: runtimeWindow,
            workspace: runtimeWorkspace
        }
    };

    Module._resolveFilename = function (request, parent, ...rest) {
        if (request === 'vscode') return '__ace_runtime_vscode__';
        return runtimeResolve(request, parent, ...rest);
    };

    delete require.cache[require.resolve('../src/runtime/activeViewRuntime')];
    const { registerActiveViewRuntime } = require('../src/runtime/activeViewRuntime');

    const context = { subscriptions: [] };
    const calls = { status: 0, suggestions: 0, open: 0 };
    runtimeWindow.activeTextEditor = {
        document: {
            languageId: 'markdown',
            version: 1,
            uri: {
                fsPath: 'C:\\vault\\note.md',
                toString() {
                    return this.fsPath;
                }
            },
            getText() {
                return '!view mission\nselect status';
            }
        }
    };

    registerActiveViewRuntime(context, {
        updateStatusBar() {
            calls.status += 1;
        },
        refreshSuggestionBar() {
            calls.suggestions += 1;
        },
        openActiveViews() {
            calls.open += 1;
        }
    });

    listeners.changeEditor[0](runtimeWindow.activeTextEditor);
    await new Promise((resolve) => setTimeout(resolve, 220));

    assert.equal(calls.status, 1, 'active view runtime updates status affordances');
    assert.equal(calls.suggestions, 1, 'active view runtime refreshes suggestions');
    assert.equal(calls.open, 0, 'active view runtime does not auto-open tables');

    Module._resolveFilename = runtimeResolve;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    Module._resolveFilename = originalResolve;
});
