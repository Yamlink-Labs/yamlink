'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { getCachedTasks, setCachedTasks, clearTaskCache } = require('../src/core/taskCache');

describe('taskCache', () => {
    beforeEach(() => clearTaskCache());

    test('returns null for unknown node', () => {
        assert.equal(getCachedTasks('rico', 1), null);
    });

    test('returns null when generation does not match', () => {
        setCachedTasks('rico', [{ id: 'a' }], 1);
        assert.equal(getCachedTasks('rico', 2), null);
    });

    test('returns tasks when generation matches', () => {
        const tasks = [{ id: 'a', text: 'Follow up' }];
        setCachedTasks('rico', tasks, 5);
        assert.deepEqual(getCachedTasks('rico', 5), tasks);
    });

    test('each node is cached independently', () => {
        setCachedTasks('rico', [{ id: 'a' }], 1);
        setCachedTasks('carmen', [{ id: 'b' }], 1);
        assert.equal(getCachedTasks('rico', 1)?.[0].id, 'a');
        assert.equal(getCachedTasks('carmen', 1)?.[0].id, 'b');
    });

    test('overwriting with same generation replaces the entry', () => {
        setCachedTasks('rico', [{ id: 'old' }], 1);
        setCachedTasks('rico', [{ id: 'new' }], 1);
        assert.equal(getCachedTasks('rico', 1)?.[0].id, 'new');
    });

    test('clearTaskCache removes all entries', () => {
        setCachedTasks('rico', [{ id: 'a' }], 1);
        setCachedTasks('carmen', [{ id: 'b' }], 1);
        clearTaskCache();
        assert.equal(getCachedTasks('rico', 1), null);
        assert.equal(getCachedTasks('carmen', 1), null);
    });

    test('generation 0 is a valid cache key', () => {
        setCachedTasks('rico', [{ id: 'x' }], 0);
        assert.equal(getCachedTasks('rico', 0)?.[0].id, 'x');
        assert.equal(getCachedTasks('rico', 1), null);
    });

    test('caches an empty task array', () => {
        setCachedTasks('empty-note', [], 3);
        const result = getCachedTasks('empty-note', 3);
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 0);
    });
});
