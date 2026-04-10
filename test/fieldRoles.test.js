'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

const REGISTRY = new Map([
    ['account', new Set(['acme-inc', 'globex'])],
    ['contact', new Set(['alice-smith'])],
    ['partner', new Set(['cloudlabs-solutions'])],
    ['product', new Set(['taskalfa-15000c'])]
]);

const FIELDS = new Map([
    ['alice-smith', { type: 'contact', account: '[[acme-inc]]', status: 'active', followup: '2026-04-10' }],
    ['bob-jones', { type: 'contact', account: '[[globex]]', status: 'pending', followup: 'April 11, 2026' }],
    ['cloudlabs-solutions', { type: 'partner' }],
    ['taskalfa-15000c', { type: 'product', concepts: '[[inkjet-printing]], [[high-speed-print]]' }]
]);

const INDEX = new Map([
    ['alice-smith', '/vault/alice-smith.md'],
    ['bob-jones', '/vault/bob-jones.md'],
    ['acme-inc', '/vault/acme-inc.md'],
    ['globex', '/vault/globex.md'],
    ['taskalfa-15000c', '/vault/taskalfa-15000c.md']
]);

require.cache.__field_roles_type_registry_stub__ = {
    id: '__field_roles_type_registry_stub__',
    filename: '__field_roles_type_registry_stub__',
    loaded: true,
    exports: {
        getTypes: () => new Set(['account', 'contact', 'partner', 'product']),
        getRegistry: () => REGISTRY
    }
};

require.cache.__field_roles_schema_registry_stub__ = {
    id: '__field_roles_schema_registry_stub__',
    filename: '__field_roles_schema_registry_stub__',
    loaded: true,
    exports: {
        getSchema: (type) => type === 'contact'
            ? {
                fields: {
                    account: { type: 'relation', target: 'account' },
                    followup: { type: 'string' },
                    status: { type: 'string' }
                }
            }
            : null
    }
};

require.cache.__field_roles_graph_stub__ = {
    id: '__field_roles_graph_stub__',
    filename: '__field_roles_graph_stub__',
    loaded: true,
    exports: {
        getEdges(sourceId) {
            if (sourceId === 'alice-smith') return [{ field: 'account', targetId: 'acme-inc' }];
            if (sourceId === 'bob-jones') return [{ field: 'account', targetId: 'globex' }];
            return [];
        }
    }
};

require.cache.__field_roles_index_stub__ = {
    id: '__field_roles_index_stub__',
    filename: '__field_roles_index_stub__',
    loaded: true,
    exports: {
        getFieldsCache: () => FIELDS
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === '../registries/typeRegistry') return '__field_roles_type_registry_stub__';
    if (request === '../registries/schemaRegistry') return '__field_roles_schema_registry_stub__';
    if (request === '../core/graph') return '__field_roles_graph_stub__';
    if (request === '../core/index') return '__field_roles_index_stub__';
    return originalResolve(request, parent, ...rest);
};

const { inferFieldRole, inferTargetTypeFromFieldName } = require('../src/intelligence/fieldRoles');
const { normalizeLinkTarget, extractLinkTargets } = require('../src/intelligence/fieldRolesCore');

describe('field-role intelligence', () => {
    test('normalizes link targets and strips aliases anchors and block refs', () => {
        assert.equal(normalizeLinkTarget('[[CloudLabs Solutions|CloudLabs]]'), 'cloudlabs solutions');
        assert.equal(normalizeLinkTarget('[[cloudlabs-solutions#contacts]]'), 'cloudlabs-solutions');
        assert.equal(normalizeLinkTarget('[[call-matt^task-1]]'), 'call-matt');
    });

    test('extracts multiple normalized link targets from one value', () => {
        assert.deepEqual(
            extractLinkTargets('[[Inkjet Printing]] and [[High-Speed Print#details]] and [[Inkjet Printing|Inkjet]]'),
            ['inkjet printing', 'high-speed print']
        );
    });

    test('schema relation fields get full-confidence relation inference', () => {
        const role = inferFieldRole('account', { documentType: 'contact', idIndex: INDEX });
        assert.equal(role.relational, true);
        assert.equal(role.targetType, 'account');
        assert.equal(role.relationConfidence, 1);
        assert.ok(role.reasons.some(reason => reason.includes('schema marks "account" as a relation')));
    });

    test('observed date values produce adaptive date-like semantics', () => {
        const role = inferFieldRole('followup', { documentType: 'contact', idIndex: INDEX });
        assert.equal(role.semanticRole, 'date');
        assert.ok(role.semanticConfidence >= 0.84);
    });

    test('status-like values are inferred without hardcoding one exact field shape', () => {
        const role = inferFieldRole('status', { documentType: 'contact', idIndex: INDEX });
        assert.equal(role.semanticRole, 'status');
        assert.ok(role.reasons.some(reason => reason.includes('workflow states')));
    });

    test('wikilink-heavy fields become relational even without schema', () => {
        const role = inferFieldRole('concepts', { documentType: 'product', idIndex: INDEX });
        assert.equal(role.relational, true);
        assert.equal(role.semanticRole, 'topic');
        assert.ok(role.reasons.some(reason => reason.includes('wikilink value')));
    });

    test('field-name variants still seed target-type inference softly', () => {
        assert.equal(inferTargetTypeFromFieldName('account_id'), 'account');
    });
});

Module._resolveFilename = originalResolve;
