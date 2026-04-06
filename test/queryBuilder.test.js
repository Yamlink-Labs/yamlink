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
        getBacklinks() { return []; }
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
    exports: { parseSingleViewBlock() { return null; } }
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

const { buildTypeViewQuery, buildIncomingViewQuery } = require('../src/actions/codeActions');

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
});

Module._resolveFilename = originalResolve;
