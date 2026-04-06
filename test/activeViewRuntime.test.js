'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

const listeners = {
    changeText: [],
    changeEditor: []
};

const mockWindow = {
    activeTextEditor: null,
    onDidChangeActiveTextEditor(handler) {
        listeners.changeEditor.push(handler);
        return {
            dispose() {
                const index = listeners.changeEditor.indexOf(handler);
                if (index !== -1) listeners.changeEditor.splice(index, 1);
            }
        };
    }
};

const mockWorkspace = {
    onDidChangeTextDocument(handler) {
        listeners.changeText.push(handler);
        return {
            dispose() {
                const index = listeners.changeText.indexOf(handler);
                if (index !== -1) listeners.changeText.splice(index, 1);
            }
        };
    }
};

require.cache.__runtime_vscode__ = {
    id: '__runtime_vscode__',
    filename: '__runtime_vscode__',
    loaded: true,
    exports: {
        window: mockWindow,
        workspace: mockWorkspace
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__runtime_vscode__';
    return originalResolve(request, parent, ...rest);
};

const { registerActiveViewRuntime } = require('../src/runtime/activeViewRuntime');

function createContext() {
    return { subscriptions: [] };
}

function createEditor(text, overrides = {}) {
    return {
        document: {
            languageId: 'markdown',
            version: 1,
            uri: {
                fsPath: overrides.fsPath || 'C:\\vault\\note.md',
                toString() {
                    return this.fsPath;
                }
            },
            getText() {
                return text;
            }
        }
    };
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
    listeners.changeText.length = 0;
    listeners.changeEditor.length = 0;
    mockWindow.activeTextEditor = null;
});

describe('registerActiveViewRuntime', () => {
    test('updates affordances for notes with !view blocks without auto-opening tables', async () => {
        const context = createContext();
        const calls = { status: 0, suggestions: 0, open: 0 };

        mockWindow.activeTextEditor = createEditor('!view mission\nselect status');

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

        assert.equal(listeners.changeEditor.length, 1);
        listeners.changeEditor[0](mockWindow.activeTextEditor);
        await wait(220);

        assert.equal(calls.status, 1);
        assert.equal(calls.suggestions, 1);
        assert.equal(calls.open, 0);
    });

    test('reset lets the same editor schedule a fresh refresh cycle', async () => {
        const context = createContext();
        let statusCalls = 0;

        mockWindow.activeTextEditor = createEditor('!view mission');

        const runtime = registerActiveViewRuntime(context, {
            updateStatusBar() {
                statusCalls += 1;
            }
        });

        runtime.schedule('active-editor');
        await wait(220);
        runtime.schedule('active-editor');
        await wait(220);
        assert.equal(statusCalls, 1);

        runtime.reset();
        runtime.schedule('active-editor');
        await wait(220);
        assert.equal(statusCalls, 2);
    });
});
