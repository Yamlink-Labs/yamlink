'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

class EventEmitter {
    constructor() {
        this.event = () => {};
    }
    fire() {}
}

class Range {
    constructor(startLine, startChar, endLine, endChar) {
        this.start = { line: startLine, character: startChar };
        this.end = { line: endLine, character: endChar };
    }
}

class CodeLens {
    constructor(range, command) {
        this.range = range;
        this.command = command;
    }
}

require.cache.__viewcodelens_vscode_stub__ = {
    id: '__viewcodelens_vscode_stub__',
    filename: '__viewcodelens_vscode_stub__',
    loaded: true,
    exports: {
        EventEmitter,
        Range,
        CodeLens,
        languages: {
            registerCodeLensProvider() {
                return { dispose() {} };
            }
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__viewcodelens_vscode_stub__';
    return originalResolve(request, parent, ...rest);
};

const { registerViewCodeLens } = require('../src/features/viewCodeLens');

describe('view CodeLens', () => {
    test('shows close only for the document owning the open panel', () => {
        const context = { subscriptions: [] };
        const provider = registerViewCodeLens(context, () => '/vault/a.md');

        const openDoc = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/a.md' },
            getText: () => '!view *'
        };
        const closedDoc = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/b.md' },
            getText: () => '!view *'
        };

        const openLens = provider.provideCodeLenses(openDoc);
        const closedLens = provider.provideCodeLenses(closedDoc);

        assert.equal(openLens.length, 1);
        assert.equal(openLens[0].command.title, '✕ Close view');
        assert.equal(closedLens.length, 1);
        assert.equal(closedLens[0].command.title, '▶ Run');
    });
});

Module._resolveFilename = originalResolve;
