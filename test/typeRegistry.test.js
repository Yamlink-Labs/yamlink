'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
    clearRegistry,
    registerType,
    unregisterType,
    getRegistry,
    getTypes,
    isKnownType,
    isSingleton,
    getRegistryStats
} = require('../src/registries/typeRegistry');

describe('typeRegistry', () => {
    beforeEach(() => clearRegistry());

    test('empty registry has zero stats', () => {
        const stats = getRegistryStats();
        assert.equal(stats.uniqueTypes, 0);
        assert.equal(stats.totalTyped, 0);
        assert.deepEqual(stats.singletons, []);
    });

    test('registerType adds a new type bucket', () => {
        registerType('character', 'rico');
        assert.equal(isKnownType('character'), true);
    });

    test('type lookup is case-insensitive', () => {
        registerType('Character', 'rico');
        assert.equal(isKnownType('character'), true);
        assert.equal(isKnownType('CHARACTER'), true);
    });

    test('registerType accumulates multiple nodes under same type', () => {
        registerType('character', 'rico');
        registerType('character', 'carmen');
        const stats = getRegistryStats();
        assert.equal(stats.uniqueTypes, 1);
        assert.equal(stats.totalTyped, 2);
    });

    test('isKnownType returns false for unregistered type', () => {
        assert.equal(isKnownType('mission'), false);
    });

    test('isSingleton returns true when only one node has that type', () => {
        registerType('schema', 'schema-character');
        assert.equal(isSingleton('schema'), true);
    });

    test('isSingleton returns false when multiple nodes share a type', () => {
        registerType('character', 'rico');
        registerType('character', 'carmen');
        assert.equal(isSingleton('character'), false);
    });

    test('getTypes returns a Set of all known type strings', () => {
        registerType('character', 'rico');
        registerType('mission', 'klendathu');
        const types = getTypes();
        assert.ok(types.has('character'));
        assert.ok(types.has('mission'));
        assert.equal(types.size, 2);
    });

    test('getRegistry returns full type→Set map', () => {
        registerType('character', 'rico');
        registerType('character', 'carmen');
        const registry = getRegistry();
        assert.equal(registry.get('character')?.size, 2);
    });

    test('unregisterType removes a node from its type bucket', () => {
        registerType('character', 'rico');
        registerType('character', 'carmen');
        unregisterType('character', 'rico');
        assert.equal(isKnownType('character'), true);
        assert.equal(getRegistry().get('character')?.has('rico'), false);
    });

    test('unregisterType deletes the bucket when last node is removed', () => {
        registerType('character', 'rico');
        unregisterType('character', 'rico');
        assert.equal(isKnownType('character'), false);
    });

    test('unregisterType on unknown type is a no-op', () => {
        assert.doesNotThrow(() => unregisterType('ghost', 'nobody'));
    });

    test('singletons list only includes types with exactly one node', () => {
        registerType('character', 'rico');
        registerType('character', 'carmen');
        registerType('schema', 'schema-character');
        const stats = getRegistryStats();
        assert.ok(stats.singletons.includes('schema'));
        assert.ok(!stats.singletons.includes('character'));
    });

    test('registerType ignores null or empty values', () => {
        registerType('', 'rico');
        registerType(null, 'rico');
        registerType('character', '');
        registerType('character', null);
        assert.equal(getRegistryStats().uniqueTypes, 0);
    });

    test('clearRegistry removes all type data', () => {
        registerType('character', 'rico');
        registerType('mission', 'klendathu');
        clearRegistry();
        assert.equal(isKnownType('character'), false);
        assert.equal(getRegistryStats().uniqueTypes, 0);
    });
});
