'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);
let registeredProvider = null;

class CodeAction {
    constructor(title, kind) {
        this.title = title;
        this.kind = kind;
        this.command = null;
    }
}

require.cache.__viewlight_vscode_stub__ = {
    id: '__viewlight_vscode_stub__',
    filename: '__viewlight_vscode_stub__',
    loaded: true,
    exports: {
        CodeAction,
        CodeActionKind: {
            QuickFix: 'QuickFix',
            RefactorRewrite: 'RefactorRewrite'
        },
        languages: {
            registerCodeActionsProvider(_lang, provider) {
                registeredProvider = provider;
                return { dispose() {} };
            }
        }
    }
};

require.cache.__viewlight_query_stub__ = {
    id: '__viewlight_query_stub__',
    filename: '__viewlight_query_stub__',
    loaded: true,
    exports: {
        parseAllViewQueries(text) {
            return text.includes('!view ') ? [{}] : null;
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__viewlight_vscode_stub__';
    if (request === '../engine/query') return '__viewlight_query_stub__';
    return originalResolve(request, parent, ...rest);
};

const { registerViewLightbulb } = require('../src/features/viewLightbulb');

describe('view lightbulb', () => {
    test('offers query builder and refine actions alongside run and insert actions', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            getText() { return '!view mission'; },
            lineAt() { return { text: '!view mission' }; }
        };
        const range = { start: { line: 0 } };

        const actions = registeredProvider.provideCodeActions(document, range);
        assert.equal(actions.length, 4);
        assert.equal(actions[0].command.command, 'yamlink.runViews');
        assert.equal(actions[1].command.command, 'yamlink.insertViewBlock');
        assert.equal(actions[2].command.command, 'yamlink.queryBuilder');
        assert.equal(actions[3].command.command, 'yamlink.refineViewBlock');
    });
});

Module._resolveFilename = originalResolve;
