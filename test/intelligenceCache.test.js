'use strict';
/**
 * intelligenceCache.test.js
 *
 * Unit tests for the vault-wide intelligence pattern cache.
 * Tests cache hit/miss behaviour, invalidation on generation and
 * fieldsCache reference change, and explicit cache clear semantics.
 * All tests use plain Map objects — no VS Code stub required.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { getVaultPatterns, clearIntelligenceCache } = require('../src/intelligence/intelligenceCache');
const { resetObservedNoteIndexCache }              = require('../src/intelligence/suggestionCore');
const { resetVaultPriorsCache }                    = require('../src/intelligence/vaultPriors');

function makeCache(entries = []) {
    return new Map(entries);
}

function resetAll() {
    clearIntelligenceCache();
    resetObservedNoteIndexCache();
    resetVaultPriorsCache();
}

// ── getVaultPatterns — return shape ───────────────────────────────────────────

describe('intelligenceCache — return shape', () => {
    beforeEach(resetAll);

    test('returns an object with observedFields and observedIndex', () => {
        const fc = makeCache([
            ['rico', { type: 'contact', name: 'Rico', email: 'r@mi.gov' }]
        ]);
        const result = getVaultPatterns(fc, 1);
        assert.ok(result, 'should return a result');
        assert.ok(Array.isArray(result.observedFields),
            'observedFields should be an array');
        assert.ok(result.observedIndex && typeof result.observedIndex === 'object',
            'observedIndex should be an object');
    });

    test('observedFields includes an entry for the contact type', () => {
        const fc = makeCache([
            ['rico',   { type: 'contact', email: 'r@mi.gov',   account: '[[mi]]' }],
            ['carmen', { type: 'contact', email: 'c@fleet.gov', account: '[[navajo]]' }],
            ['mi',     { type: 'account', name:  'Mobile Infantry' }]
        ]);
        const result = getVaultPatterns(fc, 2);
        assert.ok(Array.isArray(result.observedFields), 'observedFields should be an array');
        assert.ok(result.observedFields.some(e => e.type === 'contact'),
            'observedFields should contain an entry for the contact type');
    });

    test('observedIndex has knownIds covering vault notes', () => {
        const fc = makeCache([
            ['rico', { type: 'contact', name: 'Rico' }],
            ['mi',   { type: 'account', name: 'MI' }]
        ]);
        const result = getVaultPatterns(fc, 3);
        const { knownIds } = result.observedIndex;
        assert.ok(knownIds instanceof Set, 'observedIndex.knownIds should be a Set');
        assert.ok(knownIds.has('rico'), 'knownIds should include rico');
        assert.ok(knownIds.has('mi'),   'knownIds should include mi');
    });
});

// ── getVaultPatterns — cache hit ──────────────────────────────────────────────

describe('intelligenceCache — cache hit', () => {
    beforeEach(resetAll);

    test('second call with same generation and fieldsCache returns cached reference', () => {
        const fc = makeCache([
            ['rico', { type: 'contact', email: 'r@mi.gov' }]
        ]);
        const first  = getVaultPatterns(fc, 10);
        const second = getVaultPatterns(fc, 10);
        assert.equal(first, second,
            'should return the same object reference on cache hit');
    });

    test('cache hit preserves observedFields array reference', () => {
        const fc = makeCache([
            ['rico', { type: 'contact' }]
        ]);
        const first  = getVaultPatterns(fc, 20);
        const second = getVaultPatterns(fc, 20);
        assert.equal(first.observedFields, second.observedFields,
            'observedFields should be the exact same array reference on cache hit');
    });
});

// ── getVaultPatterns — cache miss ─────────────────────────────────────────────

describe('intelligenceCache — cache miss', () => {
    beforeEach(resetAll);

    test('incremented vaultGeneration forces a rebuild', () => {
        const fc = makeCache([
            ['rico', { type: 'contact', email: 'r@mi.gov' }]
        ]);
        const first  = getVaultPatterns(fc, 100);
        const second = getVaultPatterns(fc, 101);
        assert.notEqual(first, second,
            'different generation should produce a new result object');
    });

    test('different fieldsCache reference forces a rebuild', () => {
        const fc1 = makeCache([['rico', { type: 'contact' }]]);
        const fc2 = makeCache([['rico', { type: 'contact' }]]);
        const first  = getVaultPatterns(fc1, 50);
        const second = getVaultPatterns(fc2, 50);
        assert.notEqual(first, second,
            'different fieldsCache reference should produce a new result object');
    });

    test('empty cache always rebuilds', () => {
        const fc = makeCache([['a', { type: 'note' }]]);
        // first call when _cached is null
        const result = getVaultPatterns(fc, 999);
        assert.ok(result, 'should produce a result on fresh call');
    });
});

// ── clearIntelligenceCache ────────────────────────────────────────────────────

describe('intelligenceCache — clearIntelligenceCache', () => {
    beforeEach(resetAll);

    test('forces rebuild on next call with the same arguments', () => {
        const fc = makeCache([
            ['rico', { type: 'contact', email: 'r@mi.gov' }]
        ]);
        const first = getVaultPatterns(fc, 200);
        clearIntelligenceCache();
        const second = getVaultPatterns(fc, 200);
        assert.notEqual(first, second,
            'should rebuild after explicit cache clear');
    });

    test('does not throw when cache is already empty', () => {
        assert.doesNotThrow(() => clearIntelligenceCache(),
            'clearIntelligenceCache should be safe to call on an empty cache');
    });

    test('after clear, subsequent calls still return valid patterns', () => {
        const fc = makeCache([
            ['a', { type: 'note', title: 'Hello' }]
        ]);
        getVaultPatterns(fc, 300);
        clearIntelligenceCache();
        const result = getVaultPatterns(fc, 300);
        assert.ok(Array.isArray(result.observedFields),
            'should return valid observedFields array after clear+rebuild');
        assert.ok(result.observedIndex && typeof result.observedIndex === 'object',
            'should return valid observedIndex object after clear+rebuild');
    });

    test('multiple clears without rebuild do not throw', () => {
        assert.doesNotThrow(() => {
            clearIntelligenceCache();
            clearIntelligenceCache();
            clearIntelligenceCache();
        });
    });
});
