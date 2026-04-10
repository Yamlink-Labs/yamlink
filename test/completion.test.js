'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

const REGISTRY = new Map([
    ['account', new Set(['acme-inc', 'globex'])],
    ['contact', new Set(['alice-smith'])]
]);

const FIELDS = new Map([
    ['schema-contact', { type: 'schema', target: 'contact' }],
    ['alice-smith', { type: 'contact', account: '[[acme-inc]]' }],
    ['bob-jones', { type: 'contact', account: '[[globex]]' }],
    ['acme-inc', { type: 'account' }],
    ['globex', { type: 'account' }]
]);

const INDEX = new Map([
    ['alice-smith', '/vault/alice-smith.md'],
    ['bob-jones', '/vault/bob-jones.md'],
    ['acme-inc', '/vault/acme-inc.md'],
    ['globex', '/vault/globex.md']
]);

require.cache.__completion_vscode_stub__ = {
    id: '__completion_vscode_stub__',
    filename: '__completion_vscode_stub__',
    loaded: true,
    exports: {}
};
require.cache.__completion_type_registry_stub__ = {
    id: '__completion_type_registry_stub__',
    filename: '__completion_type_registry_stub__',
    loaded: true,
    exports: {
        getTypes: () => new Set(['account', 'contact']),
        getRegistry: () => REGISTRY
    }
};
require.cache.__completion_schema_registry_stub__ = {
    id: '__completion_schema_registry_stub__',
    filename: '__completion_schema_registry_stub__',
    loaded: true,
    exports: {
        getSchema: (type) => type === 'contact'
            ? {
                fields: {
                    account: { type: 'relation', target: 'account' },
                    owner: { type: 'relation' }
                }
            }
            : null
    }
};
require.cache.__completion_graph_stub__ = {
    id: '__completion_graph_stub__',
    filename: '__completion_graph_stub__',
    loaded: true,
    exports: {
        getEdges(sourceId) {
            if (sourceId === 'alice-smith') return [{ field: 'account', targetId: 'acme-inc' }];
            if (sourceId === 'bob-jones') return [{ field: 'account', targetId: 'globex' }];
            return [];
        }
    }
};
require.cache.__completion_index_stub__ = {
    id: '__completion_index_stub__',
    filename: '__completion_index_stub__',
    loaded: true,
    exports: {
        getFieldsCache: () => FIELDS
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__completion_vscode_stub__';
    if (request === '../registries/typeRegistry') return '__completion_type_registry_stub__';
    if (request === '../registries/schemaRegistry') return '__completion_schema_registry_stub__';
    if (request === '../core/graph') return '__completion_graph_stub__';
    if (request === '../core/index') return '__completion_index_stub__';
    return originalResolve(request, parent, ...rest);
};

const {
    resolveFrontmatterRelationCandidates,
    resolveQueryRelationCandidates,
    inferTargetTypeFromFieldName,
    collectObservedFrontmatterFields,
    collectArchetypeFieldSuggestions,
    rankCandidateIds,
    buildFieldInferenceDetail
} = require('../src/features/completion');

function makeDocument(text) {
    const lines = text.split('\n');
    return {
        getText: () => text,
        lineAt(line) {
            return { text: lines[line] };
        }
    };
}

describe('frontmatter relation completion', () => {
    test('infers likely target types from relation-like field names', () => {
        assert.equal(inferTargetTypeFromFieldName('account'), 'account');
        assert.equal(inferTargetTypeFromFieldName('accounts'), 'account');
        assert.equal(inferTargetTypeFromFieldName('account_id'), 'account');
    });

    test('uses schema target types as a preference, not a hard filter', () => {
        const doc = makeDocument([
            '---',
            'id: alice-smith',
            'type: contact',
            'account: ac',
            '---'
        ].join('\n'));

        const result = resolveFrontmatterRelationCandidates(doc, { line: 3, character: 'account: ac'.length }, INDEX);
        assert.ok(result);
        assert.equal(result.targetType, 'account');
        assert.deepEqual(result.preferredIds.sort(), ['acme-inc', 'globex']);
        assert.deepEqual(result.candidateIds.sort(), ['acme-inc', 'alice-smith', 'bob-jones', 'globex']);
    });

    test('falls back to all indexed notes when relation field has no target inference', () => {
        const doc = makeDocument([
            '---',
            'id: alice-smith',
            'type: contact',
            'owner: g',
            '---'
        ].join('\n'));

        const result = resolveFrontmatterRelationCandidates(doc, { line: 3, character: 'owner: g'.length }, INDEX);
        assert.ok(result);
        assert.equal(result.targetType, null);
        assert.deepEqual(result.candidateIds.sort(), ['acme-inc', 'alice-smith', 'bob-jones', 'globex']);
    });

    test('explicit [[ relation syntax still offers candidates even without inference', () => {
        const doc = makeDocument([
            '---',
            'id: alice-smith',
            'type: contact',
            'mystery: [[g',
            '---'
        ].join('\n'));

        const result = resolveFrontmatterRelationCandidates(doc, { line: 3, character: 'mystery: [[g'.length }, INDEX);
        assert.ok(result);
        assert.equal(result.hasWiki, true);
        assert.deepEqual(result.candidateIds.sort(), ['acme-inc', 'alice-smith', 'bob-jones', 'globex']);
    });

    test('collects observed fields for the current type when no schema exists', () => {
        const observed = collectObservedFrontmatterFields('contact');
        assert.deepEqual(observed.map(entry => entry.key), ['account']);
        assert.equal(observed[0].count, 2);
    });

    test('offers archetype-based field suggestions from type and title cues', () => {
        const doc = makeDocument([
            '---',
            'id: acme-inc',
            'type: account',
            '---',
            '# Account Profile'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/account-profile.md' };

        const suggestions = collectArchetypeFieldSuggestions(doc, 'account');
        assert.ok(suggestions.some(entry => entry.key === 'owner'));
        assert.ok(suggestions.some(entry => entry.key === 'status'));
        assert.ok(suggestions.some(entry => entry.key === 'contacts'));
    });

    test('ranks preferred target ids ahead of weaker non-preferred matches', () => {
        const ranked = rankCandidateIds(
            ['great-account', 'accounting', 'beta-acc'],
            'acc',
            ['great-account']
        );
        assert.deepEqual(ranked, ['great-account', 'accounting', 'beta-acc']);
    });

    test('field inference detail surfaces semantic reasoning instead of only labels', () => {
        const detail = buildFieldInferenceDetail('suggested for account notes', {
            relational: true,
            targetType: 'account',
            semanticRole: 'relation',
            reasons: ['field name strongly resembles the "account" type']
        });
        assert.match(detail, /suggested for account notes/);
        assert.match(detail, /account/);
        assert.match(detail, /field name strongly resembles/);
    });

    test('query relation candidates use the same target preference model as frontmatter', () => {
        const result = resolveQueryRelationCandidates('account', 'contact', 'ac', INDEX);
        assert.ok(result);
        assert.equal(result.targetType, 'account');
        assert.deepEqual(result.preferredIds.sort(), ['acme-inc', 'globex']);
        assert.match(result.reasonText, /account/);
    });
});

Module._resolveFilename = originalResolve;
