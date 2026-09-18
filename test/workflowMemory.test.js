'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildAuthoringSessions,
    buildFieldCoOccurrenceMemory,
    findCoOccurringField
} = require('../src/intelligence/workflowMemory');

function ev(timestamp, type, noteId, field, newValue = null) {
    return { timestamp, type, noteId, field, newValue };
}

describe('workflow memory', () => {
    test('splits same-note field additions when the default 15-minute window is exceeded', () => {
        const events = [
            ev('2026-01-01T10:00:00.000Z', 'type_set', 'mission-a', 'type', 'mission'),
            ev('2026-01-01T10:01:00.000Z', 'field_added', 'mission-a', 'commander', '[[rico]]'),
            ev('2026-01-01T10:20:00.000Z', 'field_added', 'mission-a', 'outcome', 'success')
        ];

        const sessions = buildAuthoringSessions(events);

        assert.equal(sessions.length, 2);
        assert.deepEqual(sessions.map(session => session.fields), [['commander'], ['outcome']]);
    });

    test('drops co-occurring pairs below the shared ratio/count confidence bar', () => {
        const events = [
            ev('2026-01-01T10:00:00.000Z', 'type_set', 'm1', 'type', 'mission'),
            ev('2026-01-01T10:01:00.000Z', 'field_added', 'm1', 'commander'),
            ev('2026-01-01T10:02:00.000Z', 'field_added', 'm1', 'unit'),
            ev('2026-01-02T10:00:00.000Z', 'type_set', 'm2', 'type', 'mission'),
            ev('2026-01-02T10:01:00.000Z', 'field_added', 'm2', 'commander'),
            ev('2026-01-03T10:00:00.000Z', 'type_set', 'm3', 'type', 'mission'),
            ev('2026-01-03T10:01:00.000Z', 'field_added', 'm3', 'unit')
        ];

        const memory = buildFieldCoOccurrenceMemory(events);

        assert.equal(memory.has('mission'), false);
    });

    test('tallies sessions under the note type active when each mutation happened', () => {
        const events = [
            ev('2026-01-01T10:00:00.000Z', 'type_set', 'record-a', 'type', 'mission'),
            ev('2026-01-01T10:01:00.000Z', 'field_added', 'record-a', 'commander'),
            ev('2026-01-01T10:02:00.000Z', 'relation_added', 'record-a', 'unit'),
            ev('2026-01-02T10:00:00.000Z', 'field_changed', 'record-a', 'type', 'dossier'),
            ev('2026-01-02T10:01:00.000Z', 'field_added', 'record-a', 'subject'),
            ev('2026-01-02T10:02:00.000Z', 'field_added', 'record-a', 'source'),
            ev('2026-01-03T10:00:00.000Z', 'type_set', 'record-b', 'type', 'mission'),
            ev('2026-01-03T10:01:00.000Z', 'field_added', 'record-b', 'commander'),
            ev('2026-01-03T10:02:00.000Z', 'relation_added', 'record-b', 'unit'),
            ev('2026-01-04T10:00:00.000Z', 'type_set', 'record-c', 'type', 'dossier'),
            ev('2026-01-04T10:01:00.000Z', 'field_added', 'record-c', 'subject'),
            ev('2026-01-04T10:02:00.000Z', 'field_added', 'record-c', 'source')
        ];

        const memory = buildFieldCoOccurrenceMemory(events);

        assert.deepEqual(memory.get('mission')[0], {
            fieldA: 'commander',
            fieldB: 'unit',
            coOccurrenceRatio: 1,
            count: 2,
            sessionCount: 2
        });
        assert.deepEqual(memory.get('dossier')[0], {
            fieldA: 'source',
            fieldB: 'subject',
            coOccurrenceRatio: 1,
            count: 2,
            sessionCount: 2
        });
    });

    test('findCoOccurringField returns the missing side of a gated pair', () => {
        const memory = new Map([
            ['mission', [{ fieldA: 'commander', fieldB: 'unit', coOccurrenceRatio: 1, count: 2, sessionCount: 2 }]]
        ]);

        assert.equal(findCoOccurringField(memory, 'mission', 'commander', { commander: '[[rico]]' }).field, 'unit');
        assert.equal(findCoOccurringField(memory, 'mission', 'commander', { commander: '[[rico]]', unit: '[[roughnecks]]' }), null);
    });
});
