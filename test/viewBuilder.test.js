'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

const SCHEMA = {
    contact: {
        fields: { name: {}, account: { type: 'relation' }, email: {}, status: {}, created: {} }
    },
    event: {
        fields: { date: {}, title: {}, account: { type: 'relation' }, created: {} }
    }
};

require.cache['__vb_vscode__'] = { id: '__vb_vscode__', filename: '__vb_vscode__', loaded: true, exports: {
    Range: class Range {
        constructor(sl, sc, el, ec) { this.start = { line: sl, character: sc }; this.end = { line: el, character: ec }; }
    }
}};
require.cache['__vb_schemaReg__'] = { id: '__vb_schemaReg__', filename: '__vb_schemaReg__', loaded: true, exports: {
    getSchema: (type) => SCHEMA[type] || null
}};
require.cache['__vb_indexService__'] = { id: '__vb_indexService__', filename: '__vb_indexService__', loaded: true, exports: {
    getFieldsCache: () => new Map(),
    getVaultGeneration: () => 0
}};
require.cache['__vb_graph__'] = { id: '__vb_graph__', filename: '__vb_graph__', loaded: true, exports: {
    getBacklinks: () => []
}};
require.cache['__vb_queryDiag__'] = { id: '__vb_queryDiag__', filename: '__vb_queryDiag__', loaded: true, exports: {
    closestFieldMatch: () => null,
    closestTypeMatch: () => null,
    collectFieldCandidates: () => [],
    collectRelationFieldCandidates: () => []
}};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode')                              return '__vb_vscode__';
    if (request === '../registries/schemaRegistry')        return '__vb_schemaReg__';
    if (request === '../core/indexService')                return '__vb_indexService__';
    if (request === '../core/graph')                       return '__vb_graph__';
    if (request === '../intelligence/queryDiagnostics')    return '__vb_queryDiag__';
    return originalResolve(request, parent, ...rest);
};

const {
    getViewBlockAtRange,
    getViewBlockByIndex,
    getSchemaBackedDefaultSortField,
    getAvailableFieldsForType,
    defaultSelectClauseForType,
    appendQueryOptions,
    buildTypeViewQuery,
    buildIncomingViewQuery,
    refineParsedQuery,
    buildRefinedBlockText
} = require('../src/actions/viewBuilder');

function doc(text) {
    return { getText() { return text; } };
}

function range(line) {
    return { start: { line }, end: { line } };
}

// ── getViewBlockAtRange ───────────────────────────────────────────────────────
describe('getViewBlockAtRange', () => {
    test('finds a simple single-line view block', () => {
        const result = getViewBlockAtRange(doc('!view contact\nwhere status = active\n'), range(0));
        assert.ok(result);
        assert.equal(result.start, 0);
        assert.equal(result.query.type, 'contact');
    });

    test('locates block when cursor is on a clause line below the header', () => {
        const text = '!view contact\nwhere status = active\nsort created desc\n';
        const result = getViewBlockAtRange(doc(text), range(2));
        assert.ok(result);
        assert.equal(result.query.type, 'contact');
        assert.ok(result.query.sort);
    });

    test('returns null when cursor is not in a view block', () => {
        const result = getViewBlockAtRange(doc('# Heading\n\nPlain text.\n'), range(0));
        assert.equal(result, null);
    });

    test('returns null for empty document', () => {
        assert.equal(getViewBlockAtRange(doc(''), range(0)), null);
    });

    test('handles multiple view blocks and targets the correct one', () => {
        const text = [
            '!view contact',
            'sort name',
            '',
            '!view account',
            'sort status'
        ].join('\n');
        const r1 = getViewBlockAtRange(doc(text), range(0));
        const r2 = getViewBlockAtRange(doc(text), range(3));
        assert.equal(r1.query.type, 'contact');
        assert.equal(r2.query.type, 'account');
    });
});

// ── getViewBlockByIndex ───────────────────────────────────────────────────────
describe('getViewBlockByIndex', () => {
    test('returns block at index 0', () => {
        const text = '!view contact\nwhere status = active\n';
        const result = getViewBlockByIndex(doc(text), 0);
        assert.ok(result);
        assert.equal(result.query.type, 'contact');
    });

    test('returns block at index 1 when two blocks exist', () => {
        const text = '!view contact\n\n!view account\nsort name\n';
        assert.equal(getViewBlockByIndex(doc(text), 0).query.type, 'contact');
        assert.equal(getViewBlockByIndex(doc(text), 1).query.type, 'account');
    });

    test('returns null for out-of-range index', () => {
        const text = '!view contact\n';
        assert.equal(getViewBlockByIndex(doc(text), 5), null);
    });

    test('returns null for negative index', () => {
        assert.equal(getViewBlockByIndex(doc('!view contact\n'), -1), null);
    });
});

// ── getSchemaBackedDefaultSortField ──────────────────────────────────────────
describe('getSchemaBackedDefaultSortField', () => {
    test('prefers created when schema has it', () => {
        assert.equal(getSchemaBackedDefaultSortField('contact'), 'created');
    });

    test('falls back to date when schema has date but not created', () => {
        // event schema has date + created → should pick created
        assert.equal(getSchemaBackedDefaultSortField('event'), 'created');
    });

    test('returns empty string for unknown type with no schema', () => {
        assert.equal(getSchemaBackedDefaultSortField('nonexistent'), '');
    });
});

// ── getAvailableFieldsForType ─────────────────────────────────────────────────
describe('getAvailableFieldsForType', () => {
    test('returns sorted schema fields excluding id', () => {
        const fields = getAvailableFieldsForType('contact');
        assert.ok(Array.isArray(fields));
        assert.ok(fields.includes('name'));
        assert.ok(!fields.includes('id'));
        assert.deepEqual(fields, [...fields].sort());
    });

    test('returns empty array for unknown type', () => {
        assert.deepEqual(getAvailableFieldsForType('ghost'), []);
    });

    test('returns empty array for wildcard type', () => {
        assert.deepEqual(getAvailableFieldsForType('*'), []);
    });
});

// ── appendQueryOptions ────────────────────────────────────────────────────────
describe('appendQueryOptions', () => {
    test('injects label into the !view line', () => {
        const q = appendQueryOptions('!view contact', { label: 'My Contacts' });
        assert.ok(q.startsWith('!view contact | My Contacts'));
    });

    test('appends where clause', () => {
        const q = appendQueryOptions('!view contact', { whereField: 'status', whereValue: 'active' });
        assert.ok(q.includes('where status = active'));
    });

    test('appends sort clause with direction', () => {
        const q = appendQueryOptions('!view contact', { sortField: 'created', sortDirection: 'desc' });
        assert.ok(q.includes('sort created desc'));
    });

    test('appends limit clause', () => {
        const q = appendQueryOptions('!view contact', { limit: 10 });
        assert.ok(q.includes('limit 10'));
    });

    test('returns empty string for empty base query', () => {
        assert.equal(appendQueryOptions('', { limit: 5 }), '');
    });
});

// ── refineParsedQuery ─────────────────────────────────────────────────────────
describe('refineParsedQuery', () => {
    const base = {
        type: 'contact',
        label: null,
        sort: null,
        limit: null,
        wheres: [],
        where: null
    };

    test('sets label', () => {
        const q = refineParsedQuery(base, { label: 'Active' });
        assert.equal(q.label, 'Active');
    });

    test('sets sort field and direction', () => {
        const q = refineParsedQuery(base, { sortField: 'created', sortDirection: 'desc' });
        assert.deepEqual(q.sort, { field: 'created', desc: true });
    });

    test('clears sort when sortField is empty', () => {
        const withSort = { ...base, sort: { field: 'name', desc: false } };
        const q = refineParsedQuery(withSort, { sortField: '' });
        assert.equal(q.sort, null);
    });

    test('sets limit', () => {
        const q = refineParsedQuery(base, { limit: 25 });
        assert.equal(q.limit, 25);
    });

    test('clears limit when value is 0', () => {
        const withLimit = { ...base, limit: 10 };
        const q = refineParsedQuery(withLimit, { limit: 0 });
        assert.equal(q.limit, null);
    });

    test('sets where clause with relation value', () => {
        const q = refineParsedQuery(base, { whereField: 'account', whereValue: '[[acme-inc]]' });
        assert.equal(q.where.field, 'account');
        assert.equal(q.where.value, 'acme-inc');
        assert.equal(q.where.valueKind, 'relation');
    });

    test('clears where when field is empty', () => {
        const withWhere = { ...base, where: { field: 'status', op: '=', value: 'active', valueKind: 'string' }, wheres: [{}] };
        const q = refineParsedQuery(withWhere, { whereField: '', whereValue: '' });
        assert.equal(q.where, null);
        assert.deepEqual(q.wheres, []);
    });

    test('returns null for null input', () => {
        assert.equal(refineParsedQuery(null, { label: 'x' }), null);
    });
});
