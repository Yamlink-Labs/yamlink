'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildVaultLenses } = require('../src/intelligence/vaultLenses');

test('buildVaultLenses returns edit leaders, growth, instability, and recurring workflows', () => {
    const events = [];
    for (let i = 0; i < 10; i++) {
        events.push({ type: 'field_changed', noteId: 'rico', field: 'status', timestamp: `2026-06-01T00:00:${String(i).padStart(2, '0')}.000Z` });
    }
    events.push({ type: 'note_created', noteId: 'a1', timestamp: '2026-06-20T00:00:00.000Z' });
    events.push({ type: 'type_set', noteId: 'a1', newValue: 'character', timestamp: '2026-06-20T00:00:10.000Z' });
    events.push({ type: 'field_added', noteId: 'a1', field: 'name', timestamp: '2026-06-20T00:00:20.000Z' });
    events.push({ type: 'field_added', noteId: 'a1', field: 'rank', timestamp: '2026-06-20T00:00:30.000Z' });
    events.push({ type: 'field_added', noteId: 'a1', field: 'unit', timestamp: '2026-06-20T00:00:40.000Z' });
    events.push({ type: 'note_created', noteId: 'a2', timestamp: '2026-06-21T00:00:00.000Z' });
    events.push({ type: 'type_set', noteId: 'a2', newValue: 'character', timestamp: '2026-06-21T00:00:10.000Z' });
    events.push({ type: 'note_created', noteId: 'a3', timestamp: '2026-06-22T00:00:00.000Z' });
    events.push({ type: 'type_set', noteId: 'a3', newValue: 'character', timestamp: '2026-06-22T00:00:10.000Z' });
    events.push({ type: 'note_created', noteId: 'm1', timestamp: '2026-06-23T00:00:00.000Z' });
    events.push({ type: 'type_set', noteId: 'm1', newValue: 'mission', timestamp: '2026-06-23T00:00:10.000Z' });
    events.push({ type: 'note_created', noteId: 'm2', timestamp: '2026-06-24T00:00:00.000Z' });
    events.push({ type: 'type_set', noteId: 'm2', newValue: 'mission', timestamp: '2026-06-24T00:00:10.000Z' });
    events.push({ type: 'note_created', noteId: 'm3', timestamp: '2026-06-25T00:00:00.000Z' });
    events.push({ type: 'type_set', noteId: 'm3', newValue: 'mission', timestamp: '2026-06-25T00:00:10.000Z' });
    events.push({ type: 'field_changed', noteId: 'carl', field: 'status', timestamp: '2026-06-01T01:00:00.000Z' });
    events.push({ type: 'field_changed', noteId: 'carl', field: 'status', timestamp: '2026-06-01T01:01:00.000Z' });
    events.push({ type: 'field_changed', noteId: 'carl', field: 'status', timestamp: '2026-06-01T01:02:00.000Z' });

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
