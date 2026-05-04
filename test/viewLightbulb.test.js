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

class WorkspaceEdit {
    constructor() {
        this.operations = [];
    }

    insert(uri, position, text) {
        this.operations.push({ uri, position, text });
    }
}

class Position {
    constructor(line, character) {
        this.line = line;
        this.character = character;
    }
}

require.cache.__viewlight_vscode_stub__ = {
    id: '__viewlight_vscode_stub__',
    filename: '__viewlight_vscode_stub__',
    loaded: true,
    exports: {
        CodeAction,
        WorkspaceEdit,
        Position,
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

require.cache.__viewlight_index_stub__ = {
    id: '__viewlight_index_stub__',
    filename: '__viewlight_index_stub__',
    loaded: true,
    exports: {
        parseFrontmatter(text) {
            const match = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (!match) return null;
            const rows = {};
            for (const line of match[1].split(/\r?\n/)) {
                const fieldMatch = line.match(/^([^:]+):\s*(.*)$/);
                if (!fieldMatch) continue;
                rows[fieldMatch[1].trim()] = fieldMatch[2].trim();
            }
            return rows;
        },
        getFieldsCache() {
            return new Map([
                ['fix-graph-selection', {
                    type: 'note',
                    status: 'in-progress',
                    project: '[[yamlink]]',
                    reporter: '[[alice-smith]]'
                }],
                ['review-hover-card', {
                    type: 'task',
                    status: 'planned',
                    project: '[[yamlink]]'
                }],
                ['yamlink', { type: 'project', name: 'Yamlink' }],
                ['alice-smith', { type: 'person', name: 'Alice Smith' }],
                ['contact-andreas', {
                    type: 'contact',
                    email: 'andreas@acme.com',
                    phone: '+56 9 2222 2222',
                    account: '[[acme]]'
                }],
                ['contact-brenda', {
                    type: 'contact',
                    email: 'brenda@globex.com',
                    phone: '+56 9 3333 3333',
                    account: '[[globex]]'
                }],
                ['acme', { type: 'account', name: 'Acme' }],
                ['globex', { type: 'account', name: 'Globex' }]
            ]);
        },
        getPathIndex() {
            return new Map();
        },
        getVaultGeneration() {
            return 0;
        }
    }
};

require.cache.__viewlight_date_stub__ = {
    id: '__viewlight_date_stub__',
    filename: '__viewlight_date_stub__',
    loaded: true,
    exports: {
        normaliseDateInput(value) {
            return String(value || '').trim() || null;
        }
    }
};

require.cache.__viewlight_schema_stub__ = {
    id: '__viewlight_schema_stub__',
    filename: '__viewlight_schema_stub__',
    loaded: true,
    exports: {
        getSchema() {
            return null;
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__viewlight_vscode_stub__';
    if (request === '../engine/query') return '__viewlight_query_stub__';
    if (request === '../core/index') return '__viewlight_index_stub__';
    if (request === '../core/indexService') return '__viewlight_index_stub__';
    if (request === '../core/date') return '__viewlight_date_stub__';
    if (request === '../registries/schemaRegistry') return '__viewlight_schema_stub__';
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

    test('offers likely next field actions inside frontmatter', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/contact-prospect.md' },
            getText() {
                return [
                    '---',
                    'id: contact-prospect',
                    'email: prospect@acme.com',
                    'phone: +56 9 1111 1111',
                    '---',
                    '# Contact prospect'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };
        const range = { start: { line: 2 } };

        const actions = registeredProvider.provideCodeActions(document, range);
        assert.ok(actions.some(action => action.title.includes('Apply smart starter: account -> acme')));
        assert.ok(actions.some(action => action.title.includes('Complete likely setup: account -> acme')));
        assert.ok(actions.some(action => action.title.includes('Add likely context: account → acme')));
        assert.ok(actions.some(action => action.title.includes('Add recommended bundle:')));
        assert.ok(actions.some(action => action.title.includes('Add likely setup: account')));
        const setupAction = actions.find(action => action.title.includes('Add likely setup: account'));
        assert.ok(setupAction.edit);
        assert.match(setupAction.edit.operations[0].text, /account: \[\[/);
        assert.ok(actions.some(action => action.title.includes('Add likely field: account')));
        const accountAction = actions.find(action => action.title.includes('Add likely field: account'));
        assert.ok(accountAction.edit);
        assert.equal(accountAction.edit.operations[0].text, 'account: [[\n');
        assert.ok(actions.some(action => action.title.includes('Add likely link: account → acme')));
        const linkAction = actions.find(action => action.title.includes('Add likely link: account → acme'));
        assert.ok(linkAction.edit);
        assert.equal(linkAction.edit.operations[0].text, 'account: [[acme]]\n');
    });

    test('offers broader likely setup actions when more than one field is learned', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/contact-prospect.md' },
            getText() {
                return [
                    '---',
                    'id: contact-prospect',
                    'name: Andreas Prospect',
                    'email: prospect@acme.com',
                    'phone: +56 9 1111 1111',
                    '---',
                    '# Contact prospect'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };
        const range = { start: { line: 2 } };

        const actions = registeredProvider.provideCodeActions(document, range);
        const setupAction = actions.find(action => action.title.includes('Add likely setup:'));
        assert.ok(setupAction);
        assert.match(setupAction.edit.operations[0].text, /account: \[\[/);
    });

    test('offers likely connection actions from shared workflow context', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/fix-graph-selection.md' },
            getText() {
                return [
                    '---',
                    'id: fix-graph-selection',
                    'type: note',
                    'status: in-progress',
                    'project: [[yamlink]]',
                    'reporter: [[alice-smith]]',
                    '---',
                    '# Fix graph selection'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };
        const range = { start: { line: 3 } };

        const actions = registeredProvider.provideCodeActions(document, range);
        assert.ok(actions.some(action => action.title.includes('Apply smart starter: project -> yamlink')));
        const connectionAction = actions.find(action => action.title.includes('Link this note to review-hover-card'));
        assert.ok(connectionAction);
        assert.equal(connectionAction.edit.operations[0].text, 'related: [[review-hover-card]]\n');
        const flowAction = actions.find(action => action.title.includes('Add usual flow:'));
        assert.ok(flowAction);
        assert.match(flowAction.title, /project -> yamlink/);
        assert.match(flowAction.edit.operations[0].text, /project: \[\[yamlink\]\]/);
        const companionAction = actions.find(action => action.title.includes('Link nearby companion: review-hover-card'));
        assert.ok(companionAction);
        assert.equal(companionAction.edit.operations[0].text, 'related: [[review-hover-card]]\n');
        const viewAction = actions.find(action => action.title.includes('Insert related view: task around yamlink'));
        assert.ok(viewAction);
        assert.match(viewAction.edit.operations[0].text, /!view task/);
        assert.match(viewAction.edit.operations[0].text, /where project = \[\[yamlink\]\]/);
        const threadAction = actions.find(action => action.title.includes('Insert usual thread: project around yamlink'));
        assert.ok(threadAction);
        assert.match(threadAction.edit.operations[0].text, /!view task/);
        const surroundingAction = actions.find(action => action.title.includes('Insert surrounding setup: project around yamlink often includes'));
        assert.ok(surroundingAction);
        assert.match(surroundingAction.edit.operations[0].text, /!view task/);
        assert.match(surroundingAction.edit.operations[0].text, /!view note/);
    });
});

Module._resolveFilename = originalResolve;
