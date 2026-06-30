'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNoteEvolution, buildRelationArchaeology } = require('../src/intelligence/noteEvolution');

test('buildNoteEvolution summarizes creation, field churn, and relations', () => {
    const events = [
        { type: 'note_created', noteId: 'rico', timestamp: '2026-01-01T00:00:00.000Z' },
        { type: 'type_set', noteId: 'rico', field: 'type', newValue: 'character', timestamp: '2026-01-01T00:01:00.000Z' },
        { type: 'field_added', noteId: 'rico', field: 'name', newValue: 'Johnny Rico', timestamp: '2026-01-01T00:02:00.000Z' },
        { type: 'field_changed', noteId: 'rico', field: 'status', oldValue: 'cadet', newValue: 'private', timestamp: '2026-01-02T00:00:00.000Z' },
        { type: 'field_changed', noteId: 'rico', field: 'status', oldValue: 'private', newValue: 'corporal', timestamp: '2026-01-03T00:00:00.000Z' },
        { type: 'field_changed', noteId: 'rico', field: 'status', oldValue: 'corporal', newValue: 'lieutenant', timestamp: '2026-01-04T00:00:00.000Z' },
        { type: 'relation_added', noteId: 'rico', field: 'unit', newValue: '[[roughnecks]]', timestamp: '2026-01-04T02:00:00.000Z' }
    ];
    const evolution = buildNoteEvolution('rico', events);

    assert.equal(evolution.created, '2026-01-01T00:00:00.000Z');
    assert.equal(evolution.typeSet, 'character');
    assert.deepEqual(evolution.firstFields, ['name', 'type']);
    assert.ok(evolution.stableFields.includes('name'));
    assert.deepEqual(evolution.unstableFields, [{ field: 'status', changeCount: 3 }]);
    assert.deepEqual(evolution.relationsFormed, [{ field: 'unit', target: 'roughnecks' }]);
    assert.equal(evolution.lastActivity, '2026-01-04T02:00:00.000Z');
});

test('buildRelationArchaeology tracks set, change, and clear', () => {
    const events = [
        { type: 'relation_added', noteId: 'rico', field: 'unit', oldValue: null, newValue: '[[roughnecks]]', timestamp: '2026-01-01T00:00:00.000Z' },
        { type: 'relation_changed', noteId: 'rico', field: 'unit', oldValue: '[[roughnecks]]', newValue: '[[alpha-team]]', timestamp: '2026-01-02T00:00:00.000Z' },
        { type: 'relation_removed', noteId: 'rico', field: 'unit', oldValue: '[[alpha-team]]', newValue: null, timestamp: '2026-01-03T00:00:00.000Z' }
    ];
    const archaeology = buildRelationArchaeology('rico', 'unit', events);

    assert.equal(archaeology.firstSet, '2026-01-01T00:00:00.000Z');
    assert.deepEqual(archaeology.targets, [
        { value: 'roughnecks', setAt: '2026-01-01T00:00:00.000Z', clearedAt: '2026-01-02T00:00:00.000Z' },
        { value: 'alpha-team', setAt: '2026-01-02T00:00:00.000Z', clearedAt: '2026-01-03T00:00:00.000Z' }
    ]);
});
