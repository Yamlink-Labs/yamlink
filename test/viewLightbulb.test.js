'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);
let registeredProvider = null;
const commandMap = new Map();

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

    replace(uri, range, text) {
        this.operations.push({ uri, range, text, kind: 'replace' });
    }
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

require.cache.__viewlight_vscode_stub__ = {
    id: '__viewlight_vscode_stub__',
    filename: '__viewlight_vscode_stub__',
    loaded: true,
    exports: {
        CodeAction,
        WorkspaceEdit,
        Position,
        Range,
        CodeActionKind: {
            QuickFix: 'QuickFix',
            RefactorRewrite: 'RefactorRewrite'
        },
        Selection: class Selection extends Range {},
        languages: {
            registerCodeActionsProvider(_lang, provider) {
                registeredProvider = provider;
                return { dispose() {} };
            }
        },
        commands: {
            registerCommand(id, handler) {
                commandMap.set(id, handler);
                return { dispose() { commandMap.delete(id); } };
            },
            async executeCommand() {
                return undefined;
            }
        },
        window: {
            activeTextEditor: null
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
                ['johnny-rico', { type: 'character', name: 'Johnny Rico', unit: '[[roughnecks]]', rank: 'lieutenant' }],
                ['carmen-ibanez', { type: 'character', name: 'Carmen Ibanez', unit: '[[roughnecks]]', rank: 'captain' }],
                ['lt-rasczak', { type: 'character', name: 'Lieutenant Rasczak', unit: '[[roughnecks]]', rank: 'lieutenant' }],
                ['roughnecks', { type: 'unit', name: 'Roughnecks' }],
                ['acme', { type: 'account', name: 'Acme' }],
                ['globex', { type: 'account', name: 'Globex' }],
                ['mission-klendathu', { type: 'mission', name: 'Klendathu', unit: '[[roughnecks]]' }]
            ]);
        },
        getPathIndex() {
            return new Map();
        },
        getIndex() {
            const ids = [
                'fix-graph-selection', 'review-hover-card', 'yamlink', 'alice-smith',
                'contact-andreas', 'contact-brenda', 'johnny-rico', 'carmen-ibanez',
                'lt-rasczak', 'roughnecks', 'acme', 'globex', 'mission-klendathu'
            ];
            return new Map(ids.map((id) => [id, `/vault/${id}.md`]));
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
        },
        getTodayIsoLocal() {
            return '2026-05-30';
        }
    }
};

require.cache.__viewlight_schema_stub__ = {
    id: '__viewlight_schema_stub__',
    filename: '__viewlight_schema_stub__',
    loaded: true,
    exports: {
        getSchema(type) {
            const normalized = String(type || '').trim().toLowerCase();
            if (normalized === 'character') {
                return {
                    fields: {
                        unit: { type: 'relation', targetTypes: ['unit'] },
                        rank: { type: 'text' },
                        homeworld: { type: 'relation', targetTypes: ['world'] }
                    }
                };
            }
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
    test('keeps !view lightbulbs focused on run, adjust, and insert actions', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            getText() { return '!view mission'; },
            lineAt() { return { text: '!view mission' }; }
        };
        const range = { start: { line: 0 } };

        const actions = registeredProvider.provideCodeActions(document, range);
        assert.equal(actions.length, 3);
        assert.equal(actions[0].command.command, 'yamlink.runViews');
        assert.equal(actions[0].title, 'Run this view');
        assert.equal(actions[1].command.command, 'yamlink.refineViewBlock');
        assert.equal(actions[1].title, 'Adjust this view?');
        assert.equal(actions[2].command.command, 'yamlink.insertViewBlock');
        assert.equal(actions[2].title, 'Insert another view?');
    });

    test('stays quiet when the editor selection spans more than the cursor line', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            getText() { return '!view mission'; },
            lineAt() { return { text: '!view mission' }; }
        };
        const range = {
            start: { line: 0, character: 0 },
            end: { line: 1, character: 0 }
        };

        const actions = registeredProvider.provideCodeActions(document, range);
        assert.equal(actions, undefined);
    });

    test('suggests likely note types for empty type fields from vault bundles', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/carl-jenkins.md' },
            getText() {
                return [
                    '---',
                    'id: carl-jenkins',
                    'type:',
                    'name: Carl Jenkins',
                    'unit: [[roughnecks]]',
                    '---',
                    '# Carl Jenkins'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };
        const range = { start: { line: 2 } };

        const actions = registeredProvider.provideCodeActions(document, range);
        assert.ok(actions);
        assert.ok(actions.some((action) => /character/i.test(action.title)));
        assert.equal(actions[0].edit.operations[0].kind, 'replace');
        assert.equal(actions[0].edit.operations[0].text, ' character');
    });

    test('replaces existing padding after a field colon instead of adding an extra space', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/carl-jenkins.md' },
            getText() {
                return [
                    '---',
                    'id: carl-jenkins',
                    'type:   ',
                    'name: Carl Jenkins',
                    'unit: [[roughnecks]]',
                    '---',
                    '# Carl Jenkins'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };
        const range = { start: { line: 2 } };

        const actions = registeredProvider.provideCodeActions(document, range);
        assert.ok(actions);
        assert.equal(actions[0].edit.operations[0].kind, 'replace');
        assert.equal(actions[0].edit.operations[0].text, ' character');
        assert.equal(actions[0].edit.operations[0].range.start.character, 5);
    });

    test('uses inferred note family to suggest blank-line setup even without explicit type', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/carl-jenkins.md' },
            getText() {
                return [
                    '---',
                    'id: carl-jenkins',
                    'name: Carl Jenkins',
                    'unit: [[roughnecks]]',
                    '',
                    '---',
                    '# Carl Jenkins'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };
        const range = { start: { line: 4 } };

        const actions = registeredProvider.provideCodeActions(document, range);
        assert.ok(actions);
        assert.ok(actions.some((action) => /Set type to character\?/i.test(action.title)));
        assert.ok(actions.some((action) => /Add the usual character fields\?/i.test(action.title)));
        const bundleAction = actions.find((action) => /Add the usual character fields\?/i.test(action.title));
        assert.ok(bundleAction);
        assert.match(bundleAction.edit.operations[0].text, /rank:/);
    });

    test('offers broader likely setup actions only from a blank frontmatter line', () => {
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
                    '',
                    '---',
                    '# Contact prospect'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };
        const range = { start: { line: 5 } };

        const actions = registeredProvider.provideCodeActions(document, range);
        const setupAction = actions.find(action => action.title.includes('Fill in the usual fields?') || action.title.includes('Add account and'));
        assert.ok(setupAction);
        assert.match(setupAction.edit.operations[0].text, /account: \[\[/);
    });

    test('offers broader setup actions from a blank frontmatter line in a structured note', () => {
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
                    '',
                    '---',
                    '# Fix graph selection'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };
        const range = { start: { line: 6 } };

        const actions = registeredProvider.provideCodeActions(document, range);
        assert.ok(actions.some(action => action.title.includes('Add project -> yamlink here?')));
        const flowAction = actions.find(action => action.title.includes('Use the usual fields for notes like this?'));
        assert.ok(flowAction);
        assert.match(flowAction.edit.operations[0].text, /project: \[\[yamlink\]\]/);
        assert.ok(actions.length <= 8);
    });

    test('stays quiet on already-filled identity and relation frontmatter lines', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/note-report.md' },
            getText() {
                return [
                    '---',
                    'id: note-report',
                    'type: dossier',
                    'title: Note Report Test',
                    'subject: [[johnny-rico]]',
                    'mission: [[mission-klendathu]]',
                    'status: drafting',
                    'date: 2026-04-02',
                    '---'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };

        assert.equal(registeredProvider.provideCodeActions(document, { start: { line: 1 } }), undefined);
        assert.equal(registeredProvider.provideCodeActions(document, { start: { line: 4 } }), undefined);
    });

    test('uses populated type lines as an entry point for whole-note setup intelligence', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/carl-jenkins.md' },
            getText() {
                return [
                    '---',
                    'id: carl-jenkins',
                    'type: character',
                    'name: Carl Jenkins',
                    'unit: [[roughnecks]]',
                    '---',
                    '# Carl Jenkins'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };

        const actions = registeredProvider.provideCodeActions(document, { start: { line: 2 } });
        assert.ok(actions);
        assert.ok(actions.length <= 3);
        assert.ok(actions.some((action) =>
            action.title.includes('Use the character schema from Smart Templates')
            || action.title.includes('Use the character schema here?')
            || /rank|homeworld/i.test(action.title)
        ));
        assert.ok(actions.every((action) =>
            !/Add unit ->|Should unit link to|Should this note link to|Add name here\?/i.test(action.title)
        ));
    });

    test('dedupes overlapping field inserts inside smart-template schema fill', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/test.md' },
            getText() {
                return [
                    '---',
                    'id: test',
                    'type: character',
                    '---',
                    '# Test'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };

        const actions = registeredProvider.provideCodeActions(document, { start: { line: 2 } });
        assert.ok(actions);
        const fillAction = actions.find((action) => action.title === 'Use the character schema from Smart Templates');
        assert.ok(fillAction);
        const insertText = fillAction.edit.operations[0].text;
        const unitCount = (insertText.match(/^unit:/gm) || []).length;
        assert.equal(unitCount, 1);
        assert.ok(!insertText.includes('[[roughnecks]]'));
        assert.ok(!/^unit:\s+\[\[/m.test(insertText));
    });

    test('type-line smart-template action is singular and does not compete with generic schema actions', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/test.md' },
            getText() {
                return [
                    '---',
                    'id: test',
                    'type: character',
                    '---',
                    '# Test'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };

        const actions = registeredProvider.provideCodeActions(document, { start: { line: 2 } });
        assert.ok(actions);
        assert.equal(actions.filter((action) => /schema/i.test(action.title)).length, 1);
        assert.ok(actions.some((action) => action.title === 'Use the character schema from Smart Templates'));
        assert.ok(actions.every((action) => !action.title.includes('Use the usual schema for notes like this?')));
    });

    test('keeps empty field lightbulbs field-scoped instead of falling back to whole-note setup', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/carl-jenkins.md' },
            getText() {
                return [
                    '---',
                    'id: carl-jenkins',
                    'type: character',
                    'name: Carl Jenkins',
                    'unit:',
                    '---',
                    '',
                    'Federal Intelligence officer. Was in the same graduating class as [[johnny-rico]] and [[carmen-ibanez]] before the Bug War.',
                    '',
                    'Psychic. Ran telepath operations on the Skinnies campaign.'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };

        const actions = registeredProvider.provideCodeActions(document, { start: { line: 4 } });
        assert.ok(actions);
        assert.ok(actions.some(action => action.title.includes('unit')));
        assert.ok(actions.every(action => !action.title.includes('Fill in the usual fields?')));
        assert.equal(actions.length, 1);
        const unitAction = actions[0];
        assert.match(unitAction.title, /roughnecks/i);
        assert.equal(unitAction.edit.operations[0].kind, 'replace');
        assert.equal(unitAction.edit.operations[0].text, ' [[roughnecks]]');
    });

    test('infers a relation fallback from real vault usage even when no schema declares the field (zero-schema vault)', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/mission-planet-p.md' },
            getText() {
                return [
                    '---',
                    'id: mission-planet-p',
                    'type: mission',
                    'name: Operation Planet P',
                    'unit:',
                    '---',
                    '',
                    'Bug hunt.'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };

        const actions = registeredProvider.provideCodeActions(document, { start: { line: 4 } });
        assert.ok(actions);
        assert.ok(actions.length > 0);
        // getSchema() returns null for the 'mission' type — there is no
        // schema note declaring `unit` as a relation. Without falling back
        // to real usage-based relation inference in buildTypedEmptyFieldFallbackActions,
        // this used to fall through to plain scalar-value ranking, which
        // happily accepts any string (including bogus non-id values) as a
        // "common value". Depending on classification confidence this can
        // surface either through that fallback ("Use roughnecks for unit?")
        // or through the adaptive field-hint path ("Should unit link to
        // roughnecks?") — both are legitimate, evidence-backed outcomes, so
        // this only pins the one thing that matters: it must be the vault's
        // real, most-referenced unit, never a bogus non-existent id.
        assert.match(actions[0].title, /roughnecks/i);
        const editText = actions[0].edit.operations.map((op) => op.text).join('');
        assert.match(editText, /\[\[roughnecks\]\]/);
    });

    test('keeps typed empty descriptive fields alive with ranked value suggestions', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/carl-jenkins.md' },
            getText() {
                return [
                    '---',
                    'id: carl-jenkins',
                    'type: character',
                    'name: Carl Jenkins',
                    'rank:',
                    '---',
                    '',
                    'Federal Intelligence officer.'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };

        const actions = registeredProvider.provideCodeActions(document, { start: { line: 4 } });
        assert.ok(actions);
        assert.ok(actions.some((action) => /Use .* for rank\?/i.test(action.title)));
        assert.equal(actions[0].title, 'Use lieutenant for rank?');
    });

    test('stays quiet when frontmatter evidence is too weak', () => {
        const context = { subscriptions: [] };
        registerViewLightbulb(context);

        const document = {
            languageId: 'markdown',
            uri: { fsPath: '/vault/plain-note.md' },
            getText() {
                return [
                    '---',
                    'id: plain-note',
                    'status: draft',
                    '---',
                    '# Plain note',
                    '',
                    'Short body.'
                ].join('\n');
            },
            lineAt(line) {
                const lines = this.getText().split('\n');
                return { text: lines[line] };
            }
        };
        const range = { start: { line: 2 } };

        const actions = registeredProvider.provideCodeActions(document, range);
        assert.equal(actions, undefined);
    });
});

Module._resolveFilename = originalResolve;
