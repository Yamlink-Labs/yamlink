'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

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
        getFieldsCache() { return new Map(); }
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
        computeSuggestionsForNode() { return []; },
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
    if (request === '../core/tasks') return '__ehr_tasks__';
    if (request === '../core/date') return '__ehr_date__';
    if (request === '../engine/suggestions') return '__ehr_suggestions__';
    if (request === '../actions/codeActions') return '__ehr_codeActions__';
    return originalResolve(request, parent, ...rest);
};

const {
    buildContextualQueryRecipes,
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

        assert.deepEqual(columns, ['id', 'status', 'type']);
    });

    test('task tables omit empty columns while keeping useful ones', () => {
        const columns = getVisibleTaskColumns([
            { id: 'a', date: '', done: 'false', file: 'note-a', text: 'Follow up' },
            { id: 'b', date: '', done: 'true', file: 'note-b', text: 'Reply' }
        ]);

        assert.deepEqual(columns, ['id', 'done', 'file', 'text']);
    });
});

Module._resolveFilename = originalResolve;
