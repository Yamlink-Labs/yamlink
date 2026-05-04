'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const originalResolve = Module._resolveFilename.bind(Module);

require.cache.__ehr_vscode__ = {
    id: '__ehr_vscode__',
    filename: '__ehr_vscode__',
    loaded: true,
    exports: { window: {} }
};

require.cache.__ehr_graph__ = {
    id: '__ehr_graph__',
    filename: '__ehr_graph__',
    loaded: true,
    exports: { getBacklinks() { return []; } }
};

require.cache.__ehr_index__ = {
    id: '__ehr_index__',
    filename: '__ehr_index__',
    loaded: true,
    exports: {
        getIndex() { return new Map(); },
        getPathIndex() { return new Map(); },
        getFieldsCache() { return new Map(); },
        getVaultGeneration() { return 0; }
    }
};

require.cache.__ehr_tasks__ = {
    id: '__ehr_tasks__',
    filename: '__ehr_tasks__',
    loaded: true,
    exports: { buildTaskRows() { return []; } }
};

require.cache.__ehr_date__ = {
    id: '__ehr_date__',
    filename: '__ehr_date__',
    loaded: true,
    exports: { normaliseDateInput(v) { return String(v || '').trim(); } }
};

require.cache.__ehr_suggestions__ = {
    id: '__ehr_suggestions__',
    filename: '__ehr_suggestions__',
    loaded: true,
    exports: {
        computeSuggestionsForNode(nodeId) {
            if (nodeId === 'fix-graph-selection') {
                return [{
                    title: 'Tasks for this project',
                    description: 'Other tasks already cluster around the same project context'
                }];
            }
            return [];
        },
        explainSuggestionState() {
            return { title: 'No suggested views yet', description: '', reasons: ['Nothing structured points here yet'] };
        },
        queryAlreadyExists(text, sourceType, field, nodeId) {
            const flat = String(text || '').replace(/[ \t]*\r?\n[ \t]*/g, ' ').replace(/  +/g, ' ');
            if (flat.includes(`!view incoming ${sourceType} via ${field}`)) return true;
            if (nodeId && flat.includes(`!view ${sourceType} where ${field} = [[${nodeId}]]`)) return true;
            return false;
        }
    }
};

require.cache.__ehr_codeActions__ = {
    id: '__ehr_codeActions__',
    filename: '__ehr_codeActions__',
    loaded: true,
    exports: {
        buildIncomingViewQuery(sourceType, viaField, options = {}) {
            let query = `!view incoming ${sourceType}`;
            if (viaField && viaField !== '*') query += `\nvia ${viaField}`;
            if (options.label) query = `${query} | ${options.label}`;
            if (options.sortField) query += `\nsort ${options.sortField}${options.sortDirection === 'desc' ? ' desc' : ''}`;
            if (options.limit) query += `\nlimit ${options.limit}`;
            return query;
        },
        buildTypeViewQuery(type, mode, options = {}) {
            let query = `!view ${type}`;
            if (mode === 'smart') query += '\nselect name, company, status';
            if (options.label) query = `${query} | ${options.label}`;
            if (options.sortField) query += `\nsort ${options.sortField}${options.sortDirection === 'desc' ? ' desc' : ''}`;
            if (options.limit) query += `\nlimit ${options.limit}`;
            return query;
        },
        getSchemaBackedDefaultSortField(type) {
            if (type === 'contact') return 'created';
            if (type === 'account') return 'name';
            return '';
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__ehr_vscode__';
    if (request === '../core/graph') return '__ehr_graph__';
    if (request === '../core/index') return '__ehr_index__';
    if (request === '../core/indexService') return '__ehr_index__';
    if (request === '../core/tasks') return '__ehr_tasks__';
    if (request === '../core/date') return '__ehr_date__';
    if (request === '../engine/suggestions') return '__ehr_suggestions__';
    if (request === '../actions/codeActions') return '__ehr_codeActions__';
    return originalResolve(request, parent, ...rest);
};

const {
    buildContextualQueryRecipes,
    buildEntityHubModel,
    getVisibleRelationColumns,
    getVisibleTaskColumns
} = require('../src/features/entityHub');

describe('entity hub query recipes', () => {
    test('builds contextual recipes from inbound and outbound note position', () => {
        const recipes = buildContextualQueryRecipes(
            'acme',
            { type: 'account' },
            [
                { field: 'account', rows: [{ fields: { type: 'contact' } }, { fields: { type: 'contact' } }] }
            ],
            [
                { field: 'owner', rows: [{ fields: { type: 'contact' } }] }
            ]
        );

        assert.ok(recipes.some(recipe => recipe.title === 'Backlinks to this note'));
        assert.ok(recipes.some(recipe => recipe.title === 'Incoming contact'));
        assert.ok(recipes.some(recipe => recipe.title === 'More account notes'));
        assert.ok(recipes.some(recipe => recipe.title === 'contact references'));
    });

    test('marks recipes already present in the note as inserted', () => {
        const recipes = buildContextualQueryRecipes(
            'acme',
            { type: 'account' },
            [
                { field: 'account', rows: [{ fields: { type: 'contact' } }] }
            ],
            [],
            '!view incoming * | Backlinks'
        );

        const backlinks = recipes.find(recipe => recipe.title === 'Backlinks to this note');
        assert.equal(backlinks.inserted, true);
    });

    test('relation tables omit columns that are empty across all rows', () => {
        const columns = getVisibleRelationColumns([
            { fields: { type: 'contact', company: '', status: 'active' } },
            { fields: { type: 'contact', company: '', status: 'inactive' } }
        ]);

        assert.deepEqual(columns, ['id', 'type', 'status']);
    });

    test('task tables omit empty columns while keeping useful ones', () => {
        const columns = getVisibleTaskColumns([
            { id: 'a', date: '', done: 'false', file: 'note-a', text: 'Follow up' },
            { id: 'b', date: '', done: 'true', file: 'note-b', text: 'Reply' }
        ]);

        assert.deepEqual(columns, ['id', 'done', 'file', 'text']);
    });

    test('entity hub surfaces note-role intelligence in vault position rows', () => {
        const idIndex = new Map([['fix-graph-selection', '/vault/fix-graph-selection.md']]);
        const fieldsCache = new Map([
            ['fix-graph-selection', {
                type: 'note',
                status: 'in-progress',
                deadline: '2026-04-20',
                project: '[[yamlink]]',
                reporter: '[[alice-smith]]'
            }]
        ]);

        const model = buildEntityHubModel('fix-graph-selection', idIndex, fieldsCache);
        assert.ok(model.vaultPositionRows.some(row => row.key === 'note role'));
        assert.ok(model.vaultPositionRows.some(row => row.value.includes('task')));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'next view'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('Tasks for this project')));
    });

    test('entity hub surfaces shared-context bridge notes as next-link hints', () => {
        const idIndex = new Map([['fix-graph-selection', '/vault/fix-graph-selection.md']]);
        const fieldsCache = new Map([
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
            ['yamlink', {
                type: 'project',
                name: 'Yamlink'
            }],
            ['alice-smith', {
                type: 'person',
                name: 'Alice Smith'
            }]
        ]);

        const model = buildEntityHubModel('fix-graph-selection', idIndex, fieldsCache);
        assert.ok(model.vaultPositionRows.some(row => row.key === 'related notes'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('review-hover-card also connects around yamlink')));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'next links'));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'paths'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('review-hover-card sits close through yamlink: fix-graph-selection -> yamlink -> review-hover-card')));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'related note'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('review-hover-card seems to belong in the same flow through yamlink')));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'flow'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('project -> yamlink')));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'nearby note'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('review-hover-card also connects through project -> yamlink')));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'common view'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('project around yamlink')));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'common setup'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('project around yamlink often includes task and note')));
        assert.ok(model.recipes.some(recipe => recipe.title === 'Related thread: yamlink'));
        assert.ok(model.recipes.some(recipe => recipe.queryText.includes('where project = [[yamlink]]')));
        assert.ok(model.recipes.some(recipe => recipe.title === 'Surrounding setup: yamlink'));
    });

    test('entity hub can surface likely next links from adaptive field patterns', () => {
        const idIndex = new Map([
            ['contact-prospect', '/vault/contact-prospect.md'],
            ['contact-andreas', '/vault/contact-andreas.md'],
            ['contact-brenda', '/vault/contact-brenda.md'],
            ['acme', '/vault/acme.md'],
            ['globex', '/vault/globex.md']
        ]);
        const fieldsCache = new Map([
            ['contact-prospect', {
                type: 'note',
                email: 'prospect@acme.com',
                phone: '+56 9 1111 1111'
            }],
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

        const model = buildEntityHubModel('contact-prospect', idIndex, fieldsCache);
        assert.ok(model.vaultPositionRows.some(row => row.key === 'next step'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('account')));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'why'));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'pattern'));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'setup'));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'next fields'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('account')));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'next link'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('account often points to')));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'setup fields'));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'missing'));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'useful fields'));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'context'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('account -> acme')));
    });

    test('entity hub uses repeated body links as a note report signal', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-entityhub-'));
        const notePath = path.join(tempDir, 'contact-prospect.md');
        fs.writeFileSync(notePath, [
            '---',
            'id: contact-prospect',
            'type: note',
            'email: prospect@acme.com',
            'phone: +56 9 1111 1111',
            '---',
            '',
            'Met with [[acme]] yesterday.',
            'Need to send the recap to [[acme]] tomorrow.'
        ].join('\n'));

        const idIndex = new Map([
            ['contact-prospect', notePath],
            ['contact-andreas', path.join(tempDir, 'contact-andreas.md')],
            ['contact-brenda', path.join(tempDir, 'contact-brenda.md')],
            ['acme', path.join(tempDir, 'acme.md')],
            ['globex', path.join(tempDir, 'globex.md')]
        ]);
        const fieldsCache = new Map([
            ['contact-prospect', {
                type: 'note',
                email: 'prospect@acme.com',
                phone: '+56 9 1111 1111'
            }],
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

        const model = buildEntityHubModel('contact-prospect', idIndex, fieldsCache);
        assert.ok(model.vaultPositionRows.some(row => row.key === 'body links'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('acme (2)')));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'next link'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('acme')));
    });
});

Module._resolveFilename = originalResolve;
