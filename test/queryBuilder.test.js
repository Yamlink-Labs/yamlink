'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

require.cache.__qb_vscode__ = {
    id: '__qb_vscode__',
    filename: '__qb_vscode__',
    loaded: true,
    exports: {}
};

require.cache.__qb_diagnostics__ = {
    id: '__qb_diagnostics__',
    filename: '__qb_diagnostics__',
    loaded: true,
    exports: { validateAll() {} }
};

require.cache.__qb_typeRegistry__ = {
    id: '__qb_typeRegistry__',
    filename: '__qb_typeRegistry__',
    loaded: true,
    exports: { getTypes() { return new Set(['contact']); } }
};

require.cache.__qb_schemaRegistry__ = {
    id: '__qb_schemaRegistry__',
    filename: '__qb_schemaRegistry__',
    loaded: true,
    exports: {
        getSchema(type) {
            if (type !== 'contact') return null;
            return {
                fields: {
                    id: {},
                    type: {},
                    created: {},
                    name: {},
                    company: {},
                    status: {}
                }
            };
        }
    }
};

require.cache.__qb_graph__ = {
    id: '__qb_graph__',
    filename: '__qb_graph__',
    loaded: true,
    exports: {
        isOrphan() { return false; },
        getBacklinks() { return [{ field: 'owner', sourceId: 'contact-1' }]; }
    }
};

require.cache.__qb_suggestions__ = {
    id: '__qb_suggestions__',
    filename: '__qb_suggestions__',
    loaded: true,
    exports: {
        computeSuggestionsForNode() {
            return [{
                title: 'Related contacts',
                description: 'Contacts already connected to this note pattern',
                queryText: '!view contact\nwhere account = [[account-1]]'
            }];
        },
        QUERY_SUGGESTION_THRESHOLD: 2
    }
};

require.cache.__qb_entityHub__ = {
    id: '__qb_entityHub__',
    filename: '__qb_entityHub__',
    loaded: true,
    exports: {
        buildEntityHubModel() {
            return {
                nodeFields: { type: 'contact' },
                recipes: [{
                    title: 'Latest related meetings',
                    description: 'Recent meetings around this note',
                    queryText: '!view meeting\nwhere account = [[account-1]]\nsort created desc',
                    inserted: false
                }]
            };
        }
    }
};

require.cache.__qb_query__ = {
    id: '__qb_query__',
    filename: '__qb_query__',
    loaded: true,
    exports: {
        parseSingleViewBlock(lines) {
            const block = Array.isArray(lines) ? lines : [String(lines || '')];
            const head = String(block[0] || '').trim();
            if (!head.startsWith('!view ')) return null;
            const first = head.slice(6).trim();
            const [typePart, labelPart] = first.split('|').map(part => part.trim());
            const incomingMatch = typePart.match(/^incoming\s+(.+)$/i);
            const incoming = Boolean(incomingMatch);
            const resolvedType = incoming ? incomingMatch[1].trim() : typePart;
            const wheres = [];
            let sort = null;
            let via = null;
            let limit = null;
            let groupBy = null;
            for (const line of block.slice(1)) {
                const trimmed = String(line || '').trim();
                const viaMatch = trimmed.match(/^via\s+([\w-]+)$/i);
                if (viaMatch) {
                    via = viaMatch[1].toLowerCase();
                    continue;
                }
                const whereMatch = trimmed.match(/^where\s+([\w.-]+)\s*=\s*(.+)$/i);
                if (whereMatch) {
                    wheres.push({
                        field: whereMatch[1].toLowerCase(),
                        op: '=',
                        value: whereMatch[2].trim().replace(/^\[\[|\]\]$/g, ''),
                        valueKind: whereMatch[2].includes('[[') ? 'relation' : 'string'
                    });
                }
                const sortMatch = trimmed.match(/^sort\s+([\w.-]+)(\s+desc)?$/i);
                if (sortMatch) {
                    sort = { field: sortMatch[1].toLowerCase(), desc: Boolean(sortMatch[2]) };
                }
                const limitMatch = trimmed.match(/^limit\s+(\d+)$/i);
                if (limitMatch) {
                    limit = Number(limitMatch[1]);
                }
                const groupMatch = trimmed.match(/^group\s+by\s+([\w-]+)$/i);
                if (groupMatch) {
                    groupBy = groupMatch[1].toLowerCase();
                }
            }
            return {
                type: resolvedType.toLowerCase(),
                incoming,
                label: labelPart || null,
                select: null,
                wheres,
                where: wheres[0] || null,
                sort,
                limit: limit || null,
                via,
                groupBy: groupBy || null
            };
        },
        buildQueryString(query) {
            let text = `!view ${query.incoming ? `incoming ${query.type}` : query.type}`;
            if (query.label) text += ` | ${query.label}`;
            if (query.via) text += ` via ${query.via}`;
            if (query.select && query.select.length) text += `\nselect ${query.select.join(', ')}`;
            if (query.wheres && query.wheres.length) {
                for (const where of query.wheres) {
                    if (where.valueKind === 'relation') {
                        text += `\nwhere ${where.field} = [[${where.value}]]`;
                    } else {
                        text += `\nwhere ${where.field} = ${where.value}`;
                    }
                }
            }
            if (query.groupBy) text += `\ngroup by ${query.groupBy}`;
            if (query.sort) text += `\nsort ${query.sort.field}${query.sort.desc ? ' desc' : ''}`;
            if (query.limit) text += `\nlimit ${query.limit}`;
            return text;
        },
        runQuery(query) {
            if (query.type !== 'contact') {
                return { success: true, rows: [], columns: ['id'], warnings: [], error: null };
            }
            return {
                success: true,
                rows: [
                    { id: 'contact-1', fields: { name: 'Alice', company: 'Acme', created: '2026-04-20' } },
                    { id: 'contact-2', fields: { name: 'Bob', company: 'Globex', created: '2026-04-21' } }
                ],
                columns: ['id', 'name', 'company'],
                warnings: [],
                error: null,
                groups: query.groupBy ? [{ key: 'Acme', count: 1 }, { key: 'Globex', count: 1 }] : null,
                groupBy: query.groupBy || null
            };
        }
    }
};

require.cache.__qb_index__ = {
    id: '__qb_index__',
    filename: '__qb_index__',
    loaded: true,
    exports: {
        getFieldsCache() {
            return new Map([
                ['account-1', { type: 'account', name: 'Acme', created: '2026-04-19' }],
                ['account-2', { type: 'account', name: 'Globex', created: '2026-04-18' }],
                ['contact-1', { type: 'contact', name: 'Alice', company: 'Acme', status: 'active', owner: 'account-1', created: '2026-04-20' }],
                ['contact-2', { type: 'contact', name: 'Bob', company: 'Globex', status: 'active', owner: 'account-2', created: '2026-04-21' }]
            ]);
        },
        getPathIndex() { return new Map([['/vault/account-1.md', 'account-1']]); },
        updateSingleFile() {}
    }
};

require.cache.__qb_workspace__ = {
    id: '__qb_workspace__',
    filename: '__qb_workspace__',
    loaded: true,
    exports: {
        getPrimaryWorkspaceRoot() { return null; },
        getWorkspaceRootForFile() { return null; }
    }
};

require.cache.__qb_vscode__.exports.window = {
    showQuickPick: async function () { return null; },
    showInputBox: async function () { return ''; }
};
require.cache.__qb_vscode__.exports.WorkspaceEdit = function () {};
require.cache.__qb_vscode__.exports.Position = function () {};
require.cache.__qb_vscode__.exports.Range = function () {};
require.cache.__qb_vscode__.exports.CodeAction = function () {};
require.cache.__qb_vscode__.exports.CodeActionKind = { QuickFix: 'QuickFix', Refactor: 'Refactor' };
require.cache.__qb_vscode__.exports.languages = { registerCodeActionsProvider() { return { dispose() {} }; } };
require.cache.__qb_vscode__.exports.commands = { registerCommand() { return { dispose() {} }; } };

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__qb_vscode__';
    if (request === '../diagnostics/diagnostics') return '__qb_diagnostics__';
    if (request === '../registries/typeRegistry') return '__qb_typeRegistry__';
    if (request === '../registries/schemaRegistry') return '__qb_schemaRegistry__';
    if (request === '../core/graph') return '__qb_graph__';
    if (request === '../engine/suggestions') return '__qb_suggestions__';
    if (request === '../features/entityHubModel') return '__qb_entityHub__';
    if (request === '../engine/query') return '__qb_query__';
    if (request === '../core/index') return '__qb_index__';
    if (request === '../core/indexService') return '__qb_index__';
    if (request === '../core/workspace') return '__qb_workspace__';
    return originalResolve(request, parent, ...rest);
};

const {
    buildStarterViewQuery,
    buildLikelyRepairActions,
    buildTypeViewQuery,
    buildIncomingViewQuery,
    appendQueryOptions,
    getAvailableFieldsForType,
    runGuidedViewBuilder,
    runViewRefinementBuilder,
    refineParsedQuery,
    buildRefinedBlockText
} = require('../src/actions/codeActions');
const {
    buildStateFromQuery,
    buildQueryTextFromState,
    buildPreviewFromState,
    deriveKnownTypes,
    buildBuilderOptions,
    applyQueryBuilderPreset
} = require('../src/actions/queryBuilderModel');

describe('query builder helpers', () => {
    test('buildTypeViewQuery emits smart schema-backed starter queries', () => {
        assert.equal(
            buildTypeViewQuery('contact', 'smart'),
            '!view contact\nselect name, company, status'
        );
    });

    test('buildTypeViewQuery supports wildcard and all-columns modes', () => {
        assert.equal(buildTypeViewQuery('*', 'smart'), '!view *');
        assert.equal(buildTypeViewQuery('contact', 'all'), '!view contact\nselect *');
        assert.equal(buildTypeViewQuery('contact', 'none'), '!view contact');
    });

    test('buildIncomingViewQuery emits canonical incoming queries', () => {
        assert.equal(buildIncomingViewQuery('contact', 'owner'), '!view incoming contact\nvia owner');
        assert.equal(buildIncomingViewQuery('*', '*'), '!view incoming *');
    });

    test('query builder model can round-trip a grouped table query', () => {
        const state = buildStateFromQuery({
            type: 'contact',
            incoming: false,
            label: 'Active contacts',
            select: ['name', 'company'],
            wheres: [{
                field: 'status',
                op: 'eq',
                value: 'active',
                valueSource: 'active',
                valueKind: 'string'
            }],
            where: {
                field: 'status',
                op: 'eq',
                value: 'active',
                valueSource: 'active',
                valueKind: 'string'
            },
            sort: { field: 'created', desc: true },
            limit: 10,
            groupBy: 'company'
        });
        const text = buildQueryTextFromState(state);
        assert.equal(
            text,
            '!view contact | Active contacts\nselect name, company\nwhere status = active\ngroup by company\nsort created desc\nlimit 10'
        );
    });

    test('query builder model can build incoming queries with relation field narrowing', () => {
        const text = buildQueryTextFromState({
            mode: 'incoming',
            type: 'contact',
            viaField: 'owner',
            label: 'Contact backlinks',
            sortField: 'created',
            sortDirection: 'desc',
            limit: 25
        });
        assert.equal(
            text,
            '!view incoming contact | Contact backlinks\nvia owner\nsort created desc\nlimit 25'
        );
    });

    test('query builder preview returns result summary and sample rows', () => {
        const preview = buildPreviewFromState({
            mode: 'table',
            type: 'contact',
            selectMode: 'custom',
            selectFields: ['name', 'company'],
            sortField: 'created',
            sortDirection: 'desc',
            limit: 10
        }, { contextNodeId: 'account-1' });
        assert.equal(preview.summary.ok, true);
        assert.equal(preview.summary.title, '2 rows');
        assert.deepEqual(preview.summary.columns, ['id', 'name', 'company']);
        assert.equal(preview.summary.sampleRows[0].id, 'contact-1');
    });

    test('query builder preview explains a sorted query in plain language', () => {
        const preview = buildPreviewFromState({
            mode: 'table',
            type: 'contact',
            selectMode: 'custom',
            selectFields: ['name', 'company'],
            sortField: '_hub_score',
            sortDirection: 'desc'
        });

        assert.equal(
            preview.summary.explanation,
            'This will show 2 contact notes, sorted by hub score (highest first), with name/company columns.'
        );
    });

    test('query builder preview explains an unsorted query without sort noise', () => {
        const preview = buildPreviewFromState({
            mode: 'table',
            type: 'contact',
            selectMode: 'none'
        });

        assert.equal(
            preview.summary.explanation,
            'This will show 2 contact notes, with name/company columns.'
        );
        assert.ok(!preview.summary.explanation.includes('sorted by'));
    });

    test('query builder preview names explicit selected columns', () => {
        const preview = buildPreviewFromState({
            mode: 'table',
            type: 'contact',
            selectMode: 'custom',
            selectFields: ['name', 'company']
        });

        assert.equal(preview.summary.explanation.endsWith('with name/company columns.'), true);
    });

    test('query builder presets produce canonical query text', () => {
        const base = { mode: 'table', type: 'contact', selectMode: 'none' };
        assert.equal(
            buildQueryTextFromState(applyQueryBuilderPreset(base, 'most-connected')),
            '!view contact\nsort _hub_score desc'
        );
        assert.equal(
            buildQueryTextFromState(applyQueryBuilderPreset(base, 'no-incoming-links')),
            '!view contact\nwhere _inbound_count = 0'
        );
        assert.equal(
            buildQueryTextFromState(applyQueryBuilderPreset(base, 'recently-modified')),
            '!view contact\nsort file.modified desc'
        );
        assert.equal(
            buildQueryTextFromState(applyQueryBuilderPreset(base, 'recently-created')),
            '!view contact\nsort file.created desc'
        );
    });

    test('query builder options always expose computed graph fields', () => {
        const options = buildBuilderOptions({ mode: 'table', type: 'contact' });
        for (const field of ['_inbound_count', '_outbound_count', '_hub_score']) {
            assert.ok(options.fieldCandidates.includes(field));
            assert.ok(options.groupableFields.includes(field));
            assert.match(options.fieldDescriptions[field], /Yamlink computed field/);
        }
    });

    test('query builder known types merge registry and vault types', () => {
        const types = deriveKnownTypes();
        assert.deepEqual(types, ['account', 'contact']);
    });

    test('appendQueryOptions adds label, filters, sorting, and limits', () => {
        assert.equal(
            appendQueryOptions('!view contact\nselect name, company', {
                label: 'Active contacts',
                whereField: 'status',
                whereValue: 'active',
                sortField: 'created',
                sortDirection: 'desc',
                limit: 10
            }),
            '!view contact | Active contacts\nselect name, company\nwhere status = active\nsort created desc\nlimit 10'
        );
    });

    test('buildTypeViewQuery can emit a richer starter query', () => {
        assert.equal(
            buildTypeViewQuery('contact', 'smart', {
                label: 'Latest contacts',
                whereField: 'status',
                whereValue: 'active',
                sortField: 'created',
                sortDirection: 'desc',
                limit: 25
            }),
            '!view contact | Latest contacts\nselect name, company, status\nwhere status = active\nsort created desc\nlimit 25'
        );
    });

    test('buildIncomingViewQuery can emit labeled and sorted incoming queries', () => {
        assert.equal(
            buildIncomingViewQuery('contact', 'owner', {
                label: 'Owned by this note',
                sortField: 'created',
                limit: 10
            }),
            '!view incoming contact | Owned by this note\nvia owner\nsort created\nlimit 10'
        );
    });

    test('getAvailableFieldsForType returns sorted schema fields except id', () => {
        assert.deepEqual(getAvailableFieldsForType('contact'), ['company', 'created', 'name', 'status', 'type']);
        assert.deepEqual(getAvailableFieldsForType('*'), []);
    });

    test('guided builder returns a standard table preset in a couple of picks', async () => {
        const picks = [
            { value: 'table' },
            { value: 'contact' },
            {
                query: '!view contact | Contacts\nselect name, company, status'
            }
        ];
        require.cache.__qb_vscode__.exports.window.showQuickPick = async function () {
            return picks.shift() || null;
        };

        const query = await runGuidedViewBuilder(null, null, ['contact']);
        assert.equal(query, '!view contact | Contacts\nselect name, company, status');
    });

    test('guided builder returns a latest incoming preset quickly', async () => {
        const picks = [
            { value: 'incoming' },
            { value: 'contact' },
            { value: 'owner' },
            {
                query: '!view incoming contact | Latest contacts\nvia owner\nsort created desc\nlimit 10'
            }
        ];
        require.cache.__qb_vscode__.exports.window.showQuickPick = async function () {
            return picks.shift() || null;
        };

        const query = await runGuidedViewBuilder(null, 'account-1', ['contact']);
        assert.equal(query, '!view incoming contact | Latest contacts\nvia owner\nsort created desc\nlimit 10');
    });

    test('guided builder returns an operational task preset quickly', async () => {
        const picks = [
            { value: 'tasks' },
            { query: '!view open-tasks' }
        ];
        require.cache.__qb_vscode__.exports.window.showQuickPick = async function () {
            return picks.shift() || null;
        };

        const query = await runGuidedViewBuilder(null, null, ['contact']);
        assert.equal(query, '!view open-tasks');
    });

    test('starter query picker leads with smart note-aware starters', async () => {
        let firstList = null;
        require.cache.__qb_vscode__.exports.window.showQuickPick = async function (items) {
            firstList = items;
            return items[0];
        };

        const query = await buildStarterViewQuery({
            uri: { fsPath: '/vault/account-1.md' },
            getText() { return ''; }
        });

        assert.equal(query, '!view meeting\nwhere account = [[account-1]]\nsort created desc');
        assert.ok(firstList[0].label.startsWith('Smart: '));
    });

    test('refinement can apply likely repairs in one step', async () => {
        require.cache.__qb_vscode__.exports.window.showQuickPick = async function (items) {
            return items.find(function (item) {
                return String(item.label || '').includes('Apply likely repairs');
            }) || null;
        };

        const refined = await runViewRefinementBuilder({
            getText() {
                return '!view contact\nwhere stats = active\nsort creatd desc';
            }
        }, { start: { line: 1 } });

        assert.equal(refined.nextText, '!view contact\nwhere status = active\nsort created desc');
    });

    test('likely repair actions keep incoming relation fixes relation-shaped', () => {
        const repairs = buildLikelyRepairActions({
            type: 'contact',
            incoming: true,
            label: null,
            wheres: [],
            where: null,
            sort: { field: 'creatd', desc: true },
            limit: null,
            via: 'owenr'
        }, ['created', 'name', 'status'], ['name', 'status'], require.cache.__qb_index__.exports.getFieldsCache());

        const relationRepair = repairs.find(function (item) {
            return String(item.label || '').includes('Repair relation field: use owner');
        });

        assert.ok(relationRepair);
        assert.equal(relationRepair.apply({
            type: 'contact',
            incoming: true,
            label: null,
            wheres: [],
            where: null,
            sort: { field: 'creatd', desc: true },
            limit: null,
            via: 'owenr'
        }).via, 'owner');
    });

    test('bulk likely repairs keep incoming relation fixes relation-shaped', () => {
        const repairs = buildLikelyRepairActions({
            type: 'contact',
            incoming: true,
            label: null,
            wheres: [],
            where: null,
            sort: { field: 'creatd', desc: true },
            limit: null,
            via: 'owenr'
        }, ['created', 'name', 'status'], ['name', 'status'], require.cache.__qb_index__.exports.getFieldsCache());

        const bundled = repairs.find(function (item) {
            return String(item.label || '').includes('Apply likely repairs');
        });

        assert.ok(bundled);
        const applied = bundled.apply({
            type: 'contact',
            incoming: true,
            label: null,
            wheres: [],
            where: null,
            sort: { field: 'creatd', desc: true },
            limit: null,
            via: 'owenr'
        });

        assert.equal(applied.via, 'owner');
        assert.equal(applied.sort.field, 'created');
    });

    test('refinement can edit query text directly', async () => {
        let pickCount = 0;
        require.cache.__qb_vscode__.exports.window.showQuickPick = async function (items) {
            pickCount += 1;
            return items.find(function (item) { return item.value === 'raw-edit'; });
        };
        require.cache.__qb_vscode__.exports.window.showInputBox = async function () {
            return '!view contact | Latest contacts\nsort created desc';
        };

        const refined = await runViewRefinementBuilder({
            getText() {
                return '!view contact';
            }
        }, { start: { line: 0 } });

        assert.equal(pickCount, 1);
        assert.equal(refined.nextText, '!view contact | Latest contacts\nsort created desc');
    });

    test('refineParsedQuery updates label, sort, and limit without rebuilding from scratch', () => {
        const refined = refineParsedQuery({
            type: 'contact',
            incoming: false,
            label: 'Contacts',
            select: ['name', 'company', 'status'],
            wheres: [],
            where: null,
            sort: null,
            limit: null,
            via: null
        }, {
            label: 'Latest contacts',
            sortField: 'created',
            sortDirection: 'desc',
            limit: 10
        });

        assert.equal(refined.label, 'Latest contacts');
        assert.equal(refined.sort.field, 'created');
        assert.equal(refined.sort.desc, true);
        assert.equal(refined.limit, 10);
    });

    test('buildRefinedBlockText preserves labels in query roundtrip', () => {
        const text = buildRefinedBlockText(['!view contact | Contacts'], {
            type: 'contact',
            incoming: false,
            label: 'Contacts',
            select: ['name', 'company', 'status'],
            wheres: [],
            where: null,
            sort: { field: 'created', desc: true },
            limit: 10,
            via: null
        });

        assert.equal(text, '!view contact | Contacts\nselect name, company, status\nsort created desc\nlimit 10');
    });
});

Module._resolveFilename = originalResolve;
