'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

// Mutable so individual tests can control the returned set
let mockVaultTypes = new Set();
let mockSchemaTargets = new Set();

require.cache.__cc_type_registry__ = {
    id: '__cc_type_registry__',
    filename: '__cc_type_registry__',
    loaded: true,
    exports: { getTypes: () => mockVaultTypes }
};
require.cache.__cc_vault_priors__ = {
    id: '__cc_vault_priors__',
    filename: '__cc_vault_priors__',
    loaded: true,
    exports: {
        getCachedPriors: (_cache, _gen) => ({
            fieldTargetTypes: new Map(),
            typeFieldBundles: new Map(),
            fieldAmbiguity: new Map(),
            noteRoleTypePriors: new Map()
        })
    }
};
require.cache.__cc_schema_registry__ = {
    id: '__cc_schema_registry__',
    filename: '__cc_schema_registry__',
    loaded: true,
    exports: { getSchemaTargets: () => mockSchemaTargets }
};
require.cache.__cc_index_service__ = {
    id: '__cc_index_service__',
    filename: '__cc_index_service__',
    loaded: true,
    exports: { getVaultGeneration: () => 0 }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === '../registries/typeRegistry') return '__cc_type_registry__';
    if (request === '../registries/schemaRegistry') return '__cc_schema_registry__';
    if (request === '../intelligence/vaultPriors') return '__cc_vault_priors__';
    if (request === '../core/indexService') return '__cc_index_service__';
    return originalResolve(request, parent, ...rest);
};

const { getKnownTypeCandidates, buildClassificationSignals } = require('../src/features/completionCore');

Module._resolveFilename = originalResolve;

// ---------------------------------------------------------------------------

describe('getKnownTypeCandidates', () => {
    test('returns vault types sorted when vault has types', () => {
        mockVaultTypes = new Set(['contact', 'account', 'mission']);
        mockSchemaTargets = new Set(['schema-contact']);
        try {
            const result = getKnownTypeCandidates();
            assert.deepEqual(result, ['account', 'contact', 'mission']);
        } finally {
            mockVaultTypes = new Set();
            mockSchemaTargets = new Set();
        }
    });

    test('falls back to schema targets when vault has no observed types', () => {
        mockVaultTypes = new Set();
        mockSchemaTargets = new Set(['contact', 'task', 'mission']);
        const result = getKnownTypeCandidates();
        assert.ok(Array.isArray(result));
        assert.ok(result.length > 0);
        assert.ok(result.includes('contact'));
        assert.ok(result.includes('task'));
        const sorted = [...result].sort();
        assert.deepEqual(result, sorted);
        mockSchemaTargets = new Set();
    });

    test('returns empty when neither vault nor schema teaches any types', () => {
        mockVaultTypes = new Set();
        mockSchemaTargets = new Set();
        const result = getKnownTypeCandidates();
        assert.deepEqual(result, []);
    });

    test('returns sorted list even with unsorted vault types', () => {
        mockVaultTypes = new Set(['zzz', 'aaa', 'mmm']);
        try {
            const result = getKnownTypeCandidates();
            assert.deepEqual(result, ['aaa', 'mmm', 'zzz']);
        } finally {
            mockVaultTypes = new Set();
        }
    });
});

describe('buildClassificationSignals', () => {
    test('returns null priors when fieldsCache is null', () => {
        const result = buildClassificationSignals('contact', null);
        assert.equal(result.noteType, 'contact');
        assert.equal(result.fieldTargetTypes, null);
        assert.equal(result.typeFieldBundles, null);
        assert.equal(result.fieldAmbiguity, null);
    });

    test('returns null priors when fieldsCache is empty', () => {
        const result = buildClassificationSignals('contact', new Map());
        assert.equal(result.fieldTargetTypes, null);
        assert.equal(result.typeFieldBundles, null);
        assert.equal(result.fieldAmbiguity, null);
    });

    test('spreads priors when fieldsCache has entries', () => {
        const cache = new Map([['note-a', { type: 'contact' }]]);
        const result = buildClassificationSignals('contact', cache);
        assert.equal(result.noteType, 'contact');
        assert.equal(result.fieldsCache, cache);
        assert.ok('fieldTargetTypes' in result);
        assert.ok('typeFieldBundles' in result);
    });

    test('passes noteType through to result', () => {
        const result = buildClassificationSignals('mission', null);
        assert.equal(result.noteType, 'mission');
    });
});
