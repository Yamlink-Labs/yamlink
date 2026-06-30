'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSessionSummary, detectWorkflowBursts } = require('../src/intelligence/sessionSummary');

test('buildSessionSummary counts core mutation types', () => {
    const summary = buildSessionSummary([
        { type: 'note_created', noteId: 'a' },
        { type: 'field_added', noteId: 'a', field: 'name' },
        { type: 'relation_added', noteId: 'a', field: 'unit' },
        { type: 'relation_changed', noteId: 'a', field: 'unit' },
        { type: 'task_state_changed', noteId: 'a', field: 'task:1' },
        { type: 'completion_accepted', noteId: 'a', field: 'unit' },
        { type: 'template_applied', noteId: 'a', field: 'type' }
    ]);

    assert.equal(summary.notesCreated, 1);
    assert.equal(summary.fieldsAdded, 1);
    assert.equal(summary.relationsFormed, 1);
    assert.equal(summary.relationsChanged, 1);
    assert.equal(summary.tasksChanged, 1);
    assert.equal(summary.completionsAccepted, 1);
    assert.equal(summary.templateApplied, 1);
    assert.deepEqual(summary.noteIds, ['a']);
});

test('detectWorkflowBursts finds 3-note burst within 60 seconds', () => {
    const bursts = detectWorkflowBursts([
        { type: 'field_added', noteId: 'a', timestamp: '2026-06-27T10:00:00.000Z' },
        { type: 'field_added', noteId: 'b', timestamp: '2026-06-27T10:00:10.000Z' },
        { type: 'field_added', noteId: 'c', timestamp: '2026-06-27T10:00:20.000Z' }
    ]);
    assert.equal(bursts.length, 1);
    assert.equal(bursts[0].type, 'field_added');
    assert.deepEqual(bursts[0].noteIds, ['a', 'b', 'c']);
});

test('detectWorkflowBursts ignores sparse non-burst sequences', () => {
    const bursts = detectWorkflowBursts([
        { type: 'field_added', noteId: 'a', timestamp: '2026-06-27T10:00:00.000Z' },
        { type: 'field_added', noteId: 'a', timestamp: '2026-06-27T10:00:10.000Z' },
        { type: 'field_added', noteId: 'b', timestamp: '2026-06-27T10:02:20.000Z' }
    ]);
    assert.equal(bursts.length, 0);
});
