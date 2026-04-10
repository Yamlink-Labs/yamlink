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
        computeSuggestionsForNode() { return []; },
        QUERY_SUGGESTION_THRESHOLD: 2
    }
};

require.cache.__qb_query__ = {
    id: '__qb_query__',
    filename: '__qb_query__',
    loaded: true,
    exports: {
        parseSingleViewBlock() { return null; },
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
            if (query.sort) text += `\nsort ${query.sort.field}${query.sort.desc ? ' desc' : ''}`;
            if (query.limit) text += `\nlimit ${query.limit}`;
            return text;
        }
    }
};

require.cache.__qb_index__ = {
    id: '__qb_index__',
    filename: '__qb_index__',
    loaded: true,
    exports: {
        getFieldsCache() { return new Map(); },
        getPathIndex() { return new Map(); },
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
    if (request === '../engine/query') return '__qb_query__';
    if (request === '../core/index') return '__qb_index__';
    if (request === '../core/workspace') return '__qb_workspace__';
    return originalResolve(request, parent, ...rest);
};

const {
    buildTypeViewQuery,
    buildIncomingViewQuery,
    appendQueryOptions,
    getAvailableFieldsForType,
    runGuidedViewBuilder,
    refineParsedQuery,
    buildRefinedBlockText
} = require('../src/actions/codeActions');

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
