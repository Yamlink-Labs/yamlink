'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { buildHistoryModel, buildNoteArc } = require('../src/features/entity/historyModel');
const {
    initMutationLog,
    appendMutationEvents,
    clearMutationEvents
} = require('../src/runtime/mutationEventLog');

// All test timestamps are 2026-01-15 — far enough in the past to always
// land in the "Jan 2026" month-year bucket regardless of when tests run.
const JAN15 = '2026-01-15T10:30:00.000Z';
const JAN15_LATE = '2026-01-15T18:45:00.000Z';
const JAN16 = '2026-01-16T09:00:00.000Z';

describe('buildHistoryModel', () => {
    beforeEach(() => {
        initMutationLog(null);
        clearMutationEvents();
    });

    test('returns empty groups when no events exist for note', () => {
        appendMutationEvents([{ timestamp: JAN15, type: 'note_created', noteId: 'other-note' }]);
        const model = buildHistoryModel('rico');
        assert.equal(model.totalCount, 0);
        assert.deepEqual(model.groups, []);
    });

    test('totalCount matches number of events for the note', () => {
        appendMutationEvents([
            { timestamp: JAN15, type: 'note_created', noteId: 'rico' },
            { timestamp: JAN15_LATE, type: 'field_added', noteId: 'rico', field: 'unit', newValue: '[[roughnecks]]' },
            { timestamp: JAN16, type: 'field_changed', noteId: 'rico', field: 'status', newValue: 'active' }
        ]);
        const model = buildHistoryModel('rico');
        assert.equal(model.totalCount, 3);
    });

    test('events from other notes are excluded', () => {
        appendMutationEvents([
            { timestamp: JAN15, type: 'note_created', noteId: 'rico' },
            { timestamp: JAN15, type: 'note_created', noteId: 'carmen' }
        ]);
        const model = buildHistoryModel('rico');
        assert.equal(model.totalCount, 1);
        assert.equal(model.groups[0].events[0].noteId, 'rico');
    });

    test('events are ordered newest first within a group', () => {
        appendMutationEvents([
            { timestamp: JAN15, type: 'note_created', noteId: 'rico' },
            { timestamp: JAN15_LATE, type: 'field_added', noteId: 'rico', field: 'unit', newValue: '[[roughnecks]]' }
        ]);
        const model = buildHistoryModel('rico');
        assert.equal(model.groups.length, 1);
        const events = model.groups[0].events;
        assert.equal(events[0].type, 'field_added');
        assert.equal(events[1].type, 'note_created');
    });

    test('old events land in a month-year bucket', () => {
        appendMutationEvents([{ timestamp: JAN15, type: 'note_created', noteId: 'rico' }]);
        const model = buildHistoryModel('rico');
        assert.equal(model.groups.length, 1);
        assert.equal(model.groups[0].label, 'Jan 2026');
    });

    test('each event has a timeStr property', () => {
        appendMutationEvents([{ timestamp: JAN15, type: 'note_created', noteId: 'rico' }]);
        const model = buildHistoryModel('rico');
        const event = model.groups[0].events[0];
        assert.ok(typeof event.timeStr === 'string' && event.timeStr.length > 0);
    });

    test('timeStr for old events includes day and month abbreviation', () => {
        appendMutationEvents([{ timestamp: '2026-01-15T00:00:00.000Z', type: 'note_created', noteId: 'rico' }]);
        const model = buildHistoryModel('rico');
        const { timeStr } = model.groups[0].events[0];
        assert.match(timeStr, /\d+\s+Jan/);
    });

    test('events on different old months create separate groups', () => {
        appendMutationEvents([
            { timestamp: '2026-01-15T10:00:00.000Z', type: 'note_created', noteId: 'rico' },
            { timestamp: '2025-12-01T10:00:00.000Z', type: 'field_added', noteId: 'rico', field: 'unit', newValue: '[[roughnecks]]' }
        ]);
        const model = buildHistoryModel('rico');
        assert.equal(model.groups.length, 2);
        const labels = model.groups.map(g => g.label);
        assert.ok(labels.includes('Jan 2026'), `expected Jan 2026 in ${labels}`);
        assert.ok(labels.includes('Dec 2025'), `expected Dec 2025 in ${labels}`);
    });

    test('original event fields are preserved in model events', () => {
        appendMutationEvents([{
            timestamp: JAN15,
            type: 'field_changed',
            noteId: 'rico',
            field: 'status',
            oldValue: 'draft',
            newValue: 'active'
        }]);
        const model = buildHistoryModel('rico');
        const event = model.groups[0].events[0];
        assert.equal(event.type, 'field_changed');
        assert.equal(event.field, 'status');
        assert.equal(event.oldValue, 'draft');
        assert.equal(event.newValue, 'active');
        assert.equal(event.noteId, 'rico');
    });

    test('respects 200-event limit', () => {
        const events = [];
        for (let i = 0; i < 205; i++) {
            events.push({ timestamp: `2026-01-${String(Math.floor(i / 10) + 1).padStart(2, '0')}T${String(i % 10).padStart(2, '0')}:00:00.000Z`, type: 'note_created', noteId: 'rico' });
        }
        appendMutationEvents(events.slice(0, 100));
        appendMutationEvents(events.slice(100));
        const model = buildHistoryModel('rico');
        assert.ok(model.totalCount <= 200, `totalCount ${model.totalCount} should be <= 200`);
    });

    test('buildHistoryModel returns arc alongside groups', () => {
        appendMutationEvents([{ timestamp: JAN15, type: 'note_created', noteId: 'rico' }]);
        const model = buildHistoryModel('rico');
        assert.ok(Array.isArray(model.arc), 'arc should be an array');
        assert.equal(model.arc[0].kind, 'created');
    });

    test('buildHistoryModel returns empty arc when no events', () => {
        const model = buildHistoryModel('nobody');
        assert.deepEqual(model.arc, []);
    });
});

describe('buildNoteArc', () => {
    test('returns empty array for no events', () => {
        assert.deepEqual(buildNoteArc([]), []);
        assert.deepEqual(buildNoteArc(null), []);
    });

    test('single note_created event produces one created phase', () => {
        const arc = buildNoteArc([{ timestamp: JAN15, type: 'note_created', noteId: 'rico' }]);
        assert.equal(arc.length, 1);
        assert.equal(arc[0].kind, 'created');
        assert.equal(arc[0].label, 'Note created');
        assert.equal(arc[0].detail, null);
    });

    test('type_set produces typed phase with detail', () => {
        const arc = buildNoteArc([
            { timestamp: JAN15, type: 'note_created', noteId: 'rico' },
            { timestamp: JAN15_LATE, type: 'type_set', noteId: 'rico', newValue: 'character' }
        ]);
        assert.equal(arc.length, 2);
        assert.equal(arc[1].kind, 'typed');
        assert.equal(arc[1].detail, 'character');
    });

    test('field_added with wikilink produces connecting phase', () => {
        const arc = buildNoteArc([
            { timestamp: JAN15, type: 'note_created', noteId: 'rico' },
            { timestamp: JAN15_LATE, type: 'field_added', noteId: 'rico', field: 'unit', newValue: '[[roughnecks]]' }
        ]);
        const connecting = arc.find(p => p.kind === 'connecting');
        assert.ok(connecting, 'should have a connecting phase');
        assert.equal(connecting.detail, 'roughnecks');
    });

    test('field_added without wikilink does not produce connecting phase', () => {
        const arc = buildNoteArc([
            { timestamp: JAN15, type: 'note_created', noteId: 'rico' },
            { timestamp: JAN15_LATE, type: 'field_added', noteId: 'rico', field: 'status', newValue: 'active' }
        ]);
        assert.ok(!arc.find(p => p.kind === 'connecting'), 'should not have connecting phase for plain value');
    });

    test('most recent uncovered event produces last phase', () => {
        const arc = buildNoteArc([
            { timestamp: JAN15, type: 'note_created', noteId: 'rico' },
            { timestamp: JAN15_LATE, type: 'type_set', noteId: 'rico', newValue: 'character' },
            { timestamp: JAN16, type: 'field_changed', noteId: 'rico', field: 'status', newValue: 'active' }
        ]);
        const last = arc.find(p => p.kind === 'last');
        assert.ok(last, 'should have a last phase');
        assert.ok(last.label.includes('status'), `label should mention field name, got: ${last.label}`);
    });

    test('last phase is omitted when most recent event is already captured', () => {
        const arc = buildNoteArc([
            { timestamp: JAN15, type: 'note_created', noteId: 'rico' },
            { timestamp: JAN15_LATE, type: 'type_set', noteId: 'rico', newValue: 'character' }
        ]);
        assert.ok(!arc.find(p => p.kind === 'last'), 'last phase should be omitted when already covered');
    });

    test('phases are ordered created → typed → connecting → last', () => {
        const arc = buildNoteArc([
            { timestamp: JAN16, type: 'field_changed', noteId: 'rico', field: 'status', newValue: 'active' },
            { timestamp: JAN15_LATE, type: 'field_added', noteId: 'rico', field: 'unit', newValue: '[[roughnecks]]' },
            { timestamp: JAN15, type: 'note_created', noteId: 'rico' },
            { timestamp: JAN15, type: 'type_set', noteId: 'rico', newValue: 'character' }
        ]);
        const kinds = arc.map(p => p.kind);
        assert.deepEqual(kinds, ['created', 'typed', 'connecting', 'last']);
    });
});
