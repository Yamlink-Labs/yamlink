'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
    appendMutationEvents,
    getMutationEvents,
    clearMutationEvents
} = require('../src/runtime/mutationEventLog');

describe('mutation event log', () => {
    beforeEach(() => {
        clearMutationEvents();
    });

    test('appends and returns events in order', () => {
        appendMutationEvents([
            { timestamp: '2026-05-17T00:00:00.000Z', type: 'note_created', noteId: 'carl-jenkins' },
            { timestamp: '2026-05-17T00:00:02.000Z', type: 'field_added', noteId: 'carl-jenkins', field: 'unit', newValue: '[[roughnecks]]' }
        ]);

        const events = getMutationEvents();
        assert.equal(events.length, 2);
        assert.equal(events[0].type, 'note_created');
        assert.equal(events[1].field, 'unit');
    });

    test('clear removes prior events', () => {
        appendMutationEvents([{ timestamp: '2026-05-17T00:00:00.000Z', type: 'note_created', noteId: 'yamlink' }]);
        clearMutationEvents();
        assert.deepEqual(getMutationEvents(), []);
    });
});
