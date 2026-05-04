'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

const createdItems = [];
const mockWindow = {
    activeTextEditor: null,
    createStatusBarItem(alignment, priority) {
        const item = {
            alignment,
            priority,
            text: '',
            tooltip: '',
            color: undefined,
            backgroundColor: undefined,
            command: undefined,
            visible: false,
            show() { this.visible = true; },
            hide() { this.visible = false; }
        };
        createdItems.push(item);
        return item;
    }
};

require.cache.__status_vscode__ = {
    id: '__status_vscode__',
    filename: '__status_vscode__',
    loaded: true,
    exports: {
        window: mockWindow,
        StatusBarAlignment: { Left: 1, Right: 2 }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__status_vscode__';
    return originalResolve(request, parent, ...rest);
};

const { createStatusRuntime } = require('../src/runtime/statusRuntime');

function createContext() {
    return { subscriptions: [] };
}

afterEach(() => {
    createdItems.length = 0;
    mockWindow.activeTextEditor = null;
});

describe('status runtime', () => {
    test('shows body word and character counts for markdown notes', () => {
        mockWindow.activeTextEditor = {
            document: {
                languageId: 'markdown',
                uri: { fsPath: 'C:\\vault\\note.md' },
                getText() {
                    return [
                        '---',
                        'id: note',
                        'type: note',
                        '---',
                        '',
                        'Hello world.',
                        'This is a test.'
                    ].join('\n');
                }
            }
        };

        const runtime = createStatusRuntime(createContext(), {
            getIndex() { return new Map(); },
            getPathIndex() { return new Map(); },
            getBrokenCount() { return 0; },
            computeSuggestionsForNode() { return []; }
        });

        runtime.updateStatusBar();

        const writingBar = createdItems.find(item => item.name === 'Yamlink Writing');
        assert.equal(writingBar.visible, true);
        assert.match(writingBar.text, /\$\(pencil\) 6w · 28c/);
    });

    test('hides writing metrics for non-markdown editors', () => {
        mockWindow.activeTextEditor = {
            document: {
                languageId: 'javascript',
                uri: { fsPath: 'C:\\vault\\note.js' },
                getText() { return 'const x = 1;'; }
            }
        };

        const runtime = createStatusRuntime(createContext(), {
            getIndex() { return new Map(); },
            getPathIndex() { return new Map(); },
            getBrokenCount() { return 0; },
            computeSuggestionsForNode() { return []; }
        });

        runtime.updateStatusBar();

        const writingBar = createdItems.find(item => item.name === 'Yamlink Writing');
        assert.equal(writingBar.visible, false);
    });
});

Module._resolveFilename = originalResolve;
