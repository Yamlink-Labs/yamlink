'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    MUTATION_EVENT_TYPES,
    isKnownMutationEventType,
    getMutationEventTypesByCategory
} = require('../src/runtime/mutationEventTypes');
const { OUTCOME_EVENT_TYPES } = require('../src/runtime/mutationEventLog');
const { VALUE_EVENT_TYPES } = require('../src/core/timeEngine');

describe('mutationEventTypes registry', () => {
    test('every registered type has a category and a description', () => {
        for (const [type, meta] of MUTATION_EVENT_TYPES) {
            assert.ok(['structural', 'task', 'outcome', 'telemetry'].includes(meta.category), `${type} has a valid category`);
            assert.ok(typeof meta.description === 'string' && meta.description.length > 0, `${type} has a description`);
            assert.ok(typeof meta.reconstructable === 'boolean', `${type} declares reconstructable`);
        }
    });

    test('isKnownMutationEventType recognizes registered types and rejects unknown ones', () => {
        assert.equal(isKnownMutationEventType('field_changed'), true);
        assert.equal(isKnownMutationEventType('not_a_real_event'), false);
    });

    test('getMutationEventTypesByCategory filters correctly', () => {
        const structural = getMutationEventTypesByCategory('structural');
        assert.ok(structural.includes('note_created'));
        assert.ok(structural.includes('relation_added'));
        assert.ok(!structural.includes('completion_accepted'));
    });

    // The registry must stay in sync with the two places that already enforce
    // a subset at runtime — mutationEventLog.js's outcome-event whitelist and
    // timeEngine.js's reconstructable-value-event set — so this module is a
    // superset that actually reflects both, not a third, drifting list.
    test('every OUTCOME_EVENT_TYPES entry is registered under category outcome', () => {
        for (const type of OUTCOME_EVENT_TYPES) {
            assert.ok(MUTATION_EVENT_TYPES.has(type), `${type} is registered`);
            assert.equal(MUTATION_EVENT_TYPES.get(type).category, 'outcome', `${type} is categorized as outcome`);
        }
    });

    test('every VALUE_EVENT_TYPES entry is registered and marked reconstructable', () => {
        for (const type of VALUE_EVENT_TYPES) {
            assert.ok(MUTATION_EVENT_TYPES.has(type), `${type} is registered`);
            assert.equal(MUTATION_EVENT_TYPES.get(type).reconstructable, true, `${type} is marked reconstructable`);
        }
    });
});
