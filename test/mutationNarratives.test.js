const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildSessionNarratives, buildFamilyStreaks, buildBehaviorEvolution } = require('../src/runtime/mutationNarratives');

test('buildSessionNarratives summarizes primary work and secondary actions', () => {
    const fieldsCache = new Map([
        ['johnny-rico', { name: 'Johnny Rico', type: 'character' }],
        ['roughnecks', { name: 'Roughnecks', type: 'unit' }]
    ]);
    const sessions = buildSessionNarratives([
        { sessionId: 's1', timestamp: '2026-06-23T10:00:00.000Z', type: 'field_added', noteId: 'johnny-rico', field: 'unit' },
        { sessionId: 's1', timestamp: '2026-06-23T10:01:00.000Z', type: 'relation_changed', noteId: 'johnny-rico', field: 'unit', newValue: '[[roughnecks]]' },
        { sessionId: 's1', timestamp: '2026-06-23T10:02:00.000Z', type: 'template_fields_filled', noteId: 'johnny-rico', field: 'type' }
    ], fieldsCache, { limit: 5 });

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].primaryType, 'template_fields_filled');
    assert.equal(sessions[0].primaryNoteId, 'johnny-rico');
    assert.equal(sessions[0].family, 'templating');
    assert.equal(sessions[0].outcome, 'expanded');
    assert.deepEqual(sessions[0].focusFields, ['unit', 'type']);
    assert.deepEqual(sessions[0].impactedTargets, ['roughnecks']);
    assert.match(sessions[0].summary, /smart template|template fields filled/i);
    assert.match(sessions[0].summary, /Johnny Rico/);
    assert.match(sessions[0].summary, /relation updated/);
});

test('buildSessionNarratives falls back gracefully when multiple notes were touched', () => {
    const fieldsCache = new Map([
        ['a', { name: 'A', type: 'character' }],
        ['b', { name: 'B', type: 'mission' }]
    ]);
    const sessions = buildSessionNarratives([
        { sessionId: 's2', timestamp: '2026-06-23T09:00:00.000Z', type: 'note_created', noteId: 'a' },
        { sessionId: 's2', timestamp: '2026-06-23T09:01:00.000Z', type: 'note_created', noteId: 'b' },
        { sessionId: 's2', timestamp: '2026-06-23T09:02:00.000Z', type: 'vault_import_completed', noteId: 'a' }
    ], fieldsCache, { limit: 5 });

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].family, 'import');
    assert.equal(sessions[0].outcome, 'imported');
    assert.match(sessions[0].summary, /import completed/i);
    assert.match(sessions[0].summary, /across 2 notes/);
});

test('buildSessionNarratives classifies query sessions with exploratory reason', () => {
    const fieldsCache = new Map([
        ['tasks-calendar', { name: 'Tasks Calendar', type: 'planner' }]
    ]);
    const sessions = buildSessionNarratives([
        { sessionId: 's3', timestamp: '2026-06-23T11:00:00.000Z', type: 'query_builder_opened', noteId: 'tasks-calendar', meta: { sessionReason: 'editor_focus' } },
        { sessionId: 's3', timestamp: '2026-06-23T11:01:00.000Z', type: 'query_builder_preview_opened', noteId: 'tasks-calendar', field: 'query' }
    ], fieldsCache, { limit: 5 });

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].family, 'querying');
    assert.equal(sessions[0].outcome, 'explored');
    assert.equal(sessions[0].sessionReason, 'editor_focus');
    assert.deepEqual(sessions[0].focusFields, ['query']);
});

test('buildFamilyStreaks groups consecutive sessions by family and mode', () => {
    const streaks = buildFamilyStreaks([
        { family: 'templating', familyLabel: 'Template', mode: 'applied', startedAt: '2026-06-23T10:00:00.000Z', endedAt: '2026-06-23T10:01:00.000Z' },
        { family: 'templating', familyLabel: 'Template', mode: 'applied', startedAt: '2026-06-23T10:02:00.000Z', endedAt: '2026-06-23T10:03:00.000Z' },
        { family: 'querying', familyLabel: 'Query', mode: 'exploratory', startedAt: '2026-06-23T10:04:00.000Z', endedAt: '2026-06-23T10:05:00.000Z' }
    ]);

    assert.equal(streaks[0].family, 'templating');
    assert.equal(streaks[0].mode, 'applied');
    assert.equal(streaks[0].count, 2);
});

test('buildBehaviorEvolution detects shift toward execution', () => {
    const evolution = buildBehaviorEvolution([
        { family: 'querying', mode: 'exploratory', endedAt: '2026-06-23T09:00:00.000Z' },
        { family: 'querying', mode: 'exploratory', endedAt: '2026-06-23T09:10:00.000Z' },
        { family: 'templating', mode: 'applied', endedAt: '2026-06-23T10:00:00.000Z' },
        { family: 'modeling', mode: 'applied', endedAt: '2026-06-23T10:20:00.000Z' }
    ]);

    assert.equal(evolution.phaseShift, 'execution');
    assert.match(evolution.summary, /execution/i);
});
