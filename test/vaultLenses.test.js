'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildVaultLenses } = require('../src/intelligence/vaultLenses');

// Real, previously-undiscovered bug, found while auditing why this file was
// never wired into the test scripts: buildVaultLenses's "fastest growing
// types" lens uses a real 30-day rolling window from Date.now() (see
// src/intelligence/vaultLenses.js), but this test hardcoded absolute
// June 2026 calendar dates — a "time bomb" that passed when written and was
// silently guaranteed to start failing once real time moved far enough past
// those dates. Fixed to compute every timestamp relative to Date.now(), so
// it stays valid no matter when it actually runs.
function daysAgo(days, extraMs = 0) {
    return new Date(Date.now() - days * 86400000 + extraMs).toISOString();
}

test('buildVaultLenses returns edit leaders, growth, instability, and recurring workflows', () => {
    const events = [];
    for (let i = 0; i < 10; i++) {
        events.push({ type: 'field_changed', noteId: 'rico', field: 'status', timestamp: daysAgo(20, i * 1000) });
    }
    events.push({ type: 'note_created', noteId: 'a1', timestamp: daysAgo(5) });
    events.push({ type: 'type_set', noteId: 'a1', newValue: 'character', timestamp: daysAgo(5, 10000) });
    events.push({ type: 'field_added', noteId: 'a1', field: 'name', timestamp: daysAgo(5, 20000) });
    events.push({ type: 'field_added', noteId: 'a1', field: 'rank', timestamp: daysAgo(5, 30000) });
    events.push({ type: 'field_added', noteId: 'a1', field: 'unit', timestamp: daysAgo(5, 40000) });
    events.push({ type: 'note_created', noteId: 'a2', timestamp: daysAgo(4) });
    events.push({ type: 'type_set', noteId: 'a2', newValue: 'character', timestamp: daysAgo(4, 10000) });
    events.push({ type: 'note_created', noteId: 'a3', timestamp: daysAgo(3) });
    events.push({ type: 'type_set', noteId: 'a3', newValue: 'character', timestamp: daysAgo(3, 10000) });
    events.push({ type: 'note_created', noteId: 'm1', timestamp: daysAgo(2) });
    events.push({ type: 'type_set', noteId: 'm1', newValue: 'mission', timestamp: daysAgo(2, 10000) });
    events.push({ type: 'note_created', noteId: 'm2', timestamp: daysAgo(1) });
    events.push({ type: 'type_set', noteId: 'm2', newValue: 'mission', timestamp: daysAgo(1, 10000) });
    events.push({ type: 'note_created', noteId: 'm3', timestamp: daysAgo(0, 60000) });
    events.push({ type: 'type_set', noteId: 'm3', newValue: 'mission', timestamp: daysAgo(0, 70000) });
    events.push({ type: 'field_changed', noteId: 'carl', field: 'status', timestamp: daysAgo(20, 3600000) });
    events.push({ type: 'field_changed', noteId: 'carl', field: 'status', timestamp: daysAgo(20, 3660000) });
    events.push({ type: 'field_changed', noteId: 'carl', field: 'status', timestamp: daysAgo(20, 3720000) });

    const lenses = buildVaultLenses(events, new Map());
    assert.equal(lenses.mostEdited[0].noteId, 'rico');
    assert.equal(lenses.mostEdited[0].editCount, 10);
    assert.deepEqual(lenses.fastestGrowingTypes.slice(0, 2), [
        { type: 'character', count: 3 },
        { type: 'mission', count: 3 }
    ]);
    assert.ok(lenses.unstableFields.some((item) => item.field === 'status' && item.reversalCount >= 2));
    assert.ok(lenses.recurringPatterns.some((item) => item.pattern === 'note_created -> type_set -> field_added x3+'));
});
