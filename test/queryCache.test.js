'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { getCachedQueryResult, clearQueryCache } = require('../src/engine/queryCache');

beforeEach(() => {
    clearQueryCache();
});

test('query cache returns a cached result for the same query, generation, and day', () => {
    let calls = 0;
    const execute = () => ({ calls: ++calls });

    const first = getCachedQueryResult('!view mission', 7, '2026-05-15', execute);
    const second = getCachedQueryResult('!view mission', 7, '2026-05-15', execute);

    assert.equal(calls, 1);
    assert.equal(first, second);
    assert.deepEqual(second, { calls: 1 });
});

test('query cache misses when vault generation changes', () => {
    let calls = 0;
    const execute = () => ({ calls: ++calls });

    const first = getCachedQueryResult('!view mission', 7, '2026-05-15', execute);
    const second = getCachedQueryResult('!view mission', 8, '2026-05-15', execute);

    assert.equal(calls, 2);
    assert.notEqual(first, second);
    assert.deepEqual(second, { calls: 2 });
});

test('query cache misses when todayIso changes', () => {
    let calls = 0;
    const execute = () => ({ calls: ++calls });

    const first = getCachedQueryResult('!view upcoming', 7, '2026-05-15', execute);
    const second = getCachedQueryResult('!view upcoming', 7, '2026-05-16', execute);

    assert.equal(calls, 2);
    assert.notEqual(first, second);
    assert.deepEqual(second, { calls: 2 });
});

test('query cache evicts the least recently used entry after 300 items', () => {
    let calls = 0;
    const execute = (label) => () => ({ label, calls: ++calls });

    for (let i = 0; i < 300; i++) {
        getCachedQueryResult(`!view note-${i}`, 1, '2026-05-15', execute(`note-${i}`));
    }

    getCachedQueryResult('!view note-0', 1, '2026-05-15', execute('note-0-hit'));

    getCachedQueryResult('!view note-300', 1, '2026-05-15', execute('note-300'));

    const noteOneAgain = getCachedQueryResult('!view note-1', 1, '2026-05-15', execute('note-1-miss'));
    const noteZeroAgain = getCachedQueryResult('!view note-0', 1, '2026-05-15', execute('note-0-still-cached'));

    assert.equal(calls, 302);
    assert.deepEqual(noteOneAgain, { label: 'note-1-miss', calls: 302 });
    assert.deepEqual(noteZeroAgain, { label: 'note-0', calls: 1 });
});
