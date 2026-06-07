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
    exports: {
        window: {},
        Uri: {
            joinPath(...parts) {
                return { fsPath: parts.map(part => String(part && (part.fsPath || part.path || part)).replace(/[\\/]+$/g, '')).join('/') };
            }
        }
    }
};

require.cache.__ehr_graph__ = {
    id: '__ehr_graph__',
    filename: '__ehr_graph__',
    loaded: true,
    exports: {
        getBacklinks() { return []; },
        getEdges(id) {
            if (id === 'johnny-rico') {
                return [
                    { field: 'unit', targetId: 'roughnecks' },
                    { field: 'body', targetId: 'dizzy-flores' },
                    { field: 'body', targetId: 'mission-klendathu' }
                ];
            }
            return [];
        },
        getGraphStats() { return { nodes: 10, totalEdges: 30, totalBacklinks: 8 }; }
    }
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

let taskRowsFixture = [];

require.cache.__ehr_tasks__ = {
    id: '__ehr_tasks__',
    filename: '__ehr_tasks__',
    loaded: true,
    exports: { buildTaskRows() { return taskRowsFixture; } }
};

require.cache.__ehr_date__ = {
    id: '__ehr_date__',
    filename: '__ehr_date__',
    loaded: true,
    exports: {
        normaliseDateInput(v) { return String(v || '').trim(); },
        getTodayIsoLocal() { return '2026-05-30'; }
    }
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
const { buildHubHtml } = require('../src/features/entity/entityHubHtml');

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

        assert.deepEqual(columns, ['text', 'done', 'file']);
    });

    test('task tables hide the file column when all tasks come from the same note', () => {
        const columns = getVisibleTaskColumns([
            { id: 'a', date: '', done: 'false', file: 'same-note', text: 'Follow up' },
            { id: 'b', date: '2026-01-02', done: 'true', file: 'same-note', text: 'Reply' }
        ]);

        assert.deepEqual(columns, ['text', 'date', 'done']);
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
        // Facts appear first
        assert.ok(model.vaultPositionRows.some(row => row.key === 'note type'));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'structured inbound links' && String(row.value).includes('vault avg')));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'structured outbound links' && String(row.value).includes('vault avg')));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'lifecycle'));
        // Note role (intelligence row) appears after facts
        assert.ok(model.vaultPositionRows.some(row => row.key === 'note role'));
        // Next-view suggestion still surfaces
        assert.ok(model.vaultPositionRows.some(row => row.key === 'next view'));
        assert.ok(model.vaultPositionRows.some(row => String(row.value).includes('Tasks for this project')));
        // AI advice rows must not appear
        assert.ok(!model.vaultPositionRows.some(row => row.key === 'best next step'), 'AI advice rows should not appear');
        assert.ok(model.vaultDiagnosticRows.some(row => row.key === 'total inbound link rows'));
    });

    test('entity hub surfaces contextual query recipes from shared-context notes', () => {
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
        // AI advice rows must not appear
        assert.ok(!model.vaultPositionRows.some(row => row.key === 'nearby relationships'), 'AI advice rows should not appear');
        assert.ok(!model.vaultPositionRows.some(row => row.key === 'suggested links'), 'AI advice rows should not appear');
        assert.ok(!model.vaultPositionRows.some(row => row.key === 'shared path'), 'AI advice rows should not appear');
        // Contextual query recipes are still generated
        assert.ok(model.recipes.some(recipe => recipe.title === 'Related thread: yamlink'));
        assert.ok(model.recipes.some(recipe => recipe.queryText.includes('where project = [[yamlink]]')));
        assert.ok(model.recipes.some(recipe => recipe.title === 'Surrounding setup: yamlink'));
    });

    test('entity hub vault position shows inbound/outbound counts with vault averages', () => {
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
        assert.ok(model.vaultPositionRows.some(row => row.key === 'note type'));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'structured inbound links' && String(row.value).includes('vault avg')));
        assert.ok(model.vaultPositionRows.some(row => row.key === 'structured outbound links' && String(row.value).includes('vault avg')));
        assert.ok(!model.vaultPositionRows.some(row => row.key === 'best next step'), 'AI advice rows should not appear');
        assert.ok(!model.vaultPositionRows.some(row => row.key === 'likely next fields'), 'AI advice rows should not appear');
        assert.ok(!model.vaultPositionRows.some(row => row.key === 'likely next link'), 'AI advice rows should not appear');
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
        assert.ok(model.vaultDiagnosticRows.some(row => row.key === 'body evidence'));
        assert.ok(model.vaultDiagnosticRows.some(row => String(row.value).includes('acme (2)')));
        assert.ok(!model.vaultPositionRows.some(row => row.key === 'likely next link'), 'AI advice rows should not appear');
    });

    test('entity hub uses graph edges for outgoing links so body wikilinks count as outbound', () => {
        const idIndex = new Map([
            ['johnny-rico', '/vault/johnny-rico.md'],
            ['roughnecks', '/vault/roughnecks.md'],
            ['dizzy-flores', '/vault/dizzy-flores.md'],
            ['mission-klendathu', '/vault/mission-klendathu.md']
        ]);
        const fieldsCache = new Map([
            ['johnny-rico', { id: 'johnny-rico', type: 'character', unit: '[[roughnecks]]' }],
            ['roughnecks', { id: 'roughnecks', type: 'unit', name: 'Roughnecks' }],
            ['dizzy-flores', { id: 'dizzy-flores', type: 'character', name: 'Dizzy Flores' }],
            ['mission-klendathu', { id: 'mission-klendathu', type: 'mission', title: 'Battle of Klendathu' }]
        ]);

        const model = buildEntityHubModel('johnny-rico', idIndex, fieldsCache);
        const outbound = model.vaultPositionRows.find(row => row.key === 'structured outbound links');
        const linksOutVia = model.vaultDiagnosticRows.find(row => row.key === 'links out via');

        assert.equal(outbound.value, '1 (vault avg 3.0)');
        assert.ok(String(linksOutVia.value).includes('body (2)'));
        assert.ok(String(linksOutVia.value).includes('unit (1)'));
    });

    test('entity hub task sections only include tasks in the opened note', () => {
        taskRowsFixture = [
            {
                id: 'a',
                displayText: 'Task in note',
                text: 'Task in note',
                done: false,
                date: '',
                fileId: 'johnny-rico',
                line: 3,
                body: '',
                links: []
            },
            {
                id: 'b',
                displayText: 'Task linking here',
                text: 'Task linking here',
                done: false,
                date: '2026-03-30',
                fileId: 'tasks-calendar',
                line: 8,
                body: '',
                links: ['johnny-rico']
            }
        ];

        const idIndex = new Map([
            ['johnny-rico', '/vault/johnny-rico.md']
        ]);
        const fieldsCache = new Map([
            ['johnny-rico', { id: 'johnny-rico', type: 'character' }]
        ]);

        const model = buildEntityHubModel('johnny-rico', idIndex, fieldsCache);
        assert.deepEqual(model.taskSections.map(section => section.label), ['tasks in this note']);
        assert.equal(model.taskSections[0].rows.length, 1);
        assert.equal(model.timelineRows.length, 0);

        taskRowsFixture = [];
    });

    test('entity hub html separates body mentions and limits views to one suggested and one inserted card', () => {
        const html = buildHubHtml({
            host: {
                webview: {
                    asWebviewUri(uri) { return uri; },
                    cspSource: 'vscode-webview:'
                }
            },
            extensionUri: { path: '/ext' },
            nodeId: 'johnny-rico',
            incomingGroups: [
                { field: 'commander', rows: [{ sourceId: 'mission-klendathu', fields: { type: 'mission', title: 'Battle of Klendathu' } }], direction: 'incoming' },
                { field: 'body', rows: [{ sourceId: 'dizzy-flores', fields: { type: 'character', name: 'Dizzy Flores' } }], direction: 'incoming' }
            ],
            outgoingGroups: [
                { field: 'unit', rows: [{ sourceId: 'roughnecks', fields: { type: 'unit', name: 'Roughnecks' } }], direction: 'outgoing' },
                { field: 'body', rows: [{ sourceId: 'carmen-ibanez', fields: { type: 'character', name: 'Carmen Ibanez' } }], direction: 'outgoing' }
            ],
            summaryRows: [],
            taskSections: [],
            timelineRows: [],
            suggestions: [
                { title: 'First view', count: 3, sourceType: 'mission', field: 'commander', queryText: '!view incoming mission\nvia commander', inserted: false },
                { title: 'Second view', count: 2, sourceType: 'mission', field: 'unit', queryText: '!view incoming mission\nvia unit', inserted: false }
            ],
            suggestionExplanation: null,
            recipes: [
                { title: 'Backlinks to this note', description: 'See everything that links here', queryText: '!view incoming * | Backlinks', inserted: true },
                { title: 'More character notes', description: 'Browse other character notes', queryText: '!view character', inserted: true }
            ],
            vaultPositionRows: [],
            vaultDiagnosticRows: [{ key: 'body mentions to this note', value: '1' }],
            nodeFields: { type: 'character' },
            idIndex: new Map()
        });

        assert.ok(html.includes('outgoing relations'));
        assert.ok(html.includes('incoming relations'));
        assert.ok(html.includes('body mentions from this note'));
        assert.ok(html.includes('body mentions to this note'));
        assert.ok(html.includes('signal details'));
        assert.equal((html.match(/class="suggestion-row"/g) || []).length, 2);
    });
});

Module._resolveFilename = originalResolve;
