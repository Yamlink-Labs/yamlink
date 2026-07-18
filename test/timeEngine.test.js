'use strict';
/**
 * timeEngine.test.js
 *
 * Pure unit tests for src/core/timeEngine.js's historical state
 * reconstruction — hand-built mutation event fixtures, no vault harness
 * needed since these are pure functions over (currentFields, events).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { reconstructNoteAtTime, reconstructVaultAtTime, buildNoteTimeline, buildFieldTimeline } = require('../src/core/timeEngine');

function ev(overrides) {
    return {
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'field_changed',
        noteId: 'note-1',
        field: null,
        oldValue: null,
        newValue: null,
        ...overrides
    };
}

describe('reconstructNoteAtTime', () => {
    test('a note with zero mutation history reconstructs to its current fields at any past time', () => {
        const current = { id: 'note-1', type: 'contact', name: 'Johnny Rico' };
        const result = reconstructNoteAtTime('note-1', '2020-01-01T00:00:00.000Z', current, []);
        assert.equal(result.exists, true);
        assert.deepEqual(result.fields, current);
        assert.equal(result.complete, true);
    });

    test('undoes a single field_changed event back to its oldValue', () => {
        const current = { id: 'note-1', type: 'contact', status: 'active' };
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z', field: null }),
            ev({ type: 'field_changed', noteId: 'note-1', field: 'status', oldValue: 'draft', newValue: 'active', timestamp: '2026-03-01T00:00:00.000Z' })
        ];
        const before = reconstructNoteAtTime('note-1', '2026-02-01T00:00:00.000Z', current, events);
        assert.equal(before.fields.status, 'draft');
        assert.equal(before.complete, true);

        const after = reconstructNoteAtTime('note-1', '2026-04-01T00:00:00.000Z', current, events);
        assert.equal(after.fields.status, 'active');
    });

    test('undoes a field_added event by removing the field entirely (it did not exist yet)', () => {
        const current = { id: 'note-1', type: 'contact', owner: 'carmen' };
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'field_added', noteId: 'note-1', field: 'owner', oldValue: null, newValue: 'carmen', timestamp: '2026-02-01T00:00:00.000Z' })
        ];
        const result = reconstructNoteAtTime('note-1', '2026-01-15T00:00:00.000Z', current, events);
        assert.equal('owner' in result.fields, false);
    });

    test('undoes a field_removed event by restoring the old value', () => {
        const current = { id: 'note-1', type: 'contact' };
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'field_removed', noteId: 'note-1', field: 'owner', oldValue: 'carmen', newValue: null, timestamp: '2026-02-01T00:00:00.000Z' })
        ];
        const result = reconstructNoteAtTime('note-1', '2026-01-15T00:00:00.000Z', current, events);
        assert.equal(result.fields.owner, 'carmen');
    });

    test('undoes a type_set event, since type is excluded from the generic field diff', () => {
        const current = { id: 'note-1', type: 'consolidated-report' };
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'type_set', noteId: 'note-1', field: 'type', oldValue: 'draft-report', newValue: 'consolidated-report', timestamp: '2026-02-01T00:00:00.000Z' })
        ];
        const result = reconstructNoteAtTime('note-1', '2026-01-15T00:00:00.000Z', current, events);
        assert.equal(result.fields.type, 'draft-report');
    });

    test('walks back through several sequential changes to the same field, in order', () => {
        const current = { id: 'note-1', type: 'contact', status: 'consolidated' };
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'field_added', noteId: 'note-1', field: 'status', oldValue: null, newValue: 'draft', timestamp: '2026-01-05T00:00:00.000Z' }),
            ev({ type: 'field_changed', noteId: 'note-1', field: 'status', oldValue: 'draft', newValue: 'growing', timestamp: '2026-02-01T00:00:00.000Z' }),
            ev({ type: 'field_changed', noteId: 'note-1', field: 'status', oldValue: 'growing', newValue: 'consolidated', timestamp: '2026-03-01T00:00:00.000Z' })
        ];
        assert.equal('status' in reconstructNoteAtTime('note-1', '2026-01-02T00:00:00.000Z', current, events).fields, false);
        assert.equal(reconstructNoteAtTime('note-1', '2026-01-10T00:00:00.000Z', current, events).fields.status, 'draft');
        assert.equal(reconstructNoteAtTime('note-1', '2026-02-15T00:00:00.000Z', current, events).fields.status, 'growing');
        assert.equal(reconstructNoteAtTime('note-1', '2026-04-01T00:00:00.000Z', current, events).fields.status, 'consolidated');
    });

    test('ignores relation_* events and uses the field-level event as the source of truth', () => {
        // buildMutationEvents() emits both a field_removed AND a relation_removed
        // for the same change on a relation-valued field — the relation event's
        // oldValue is a lossy, canonicalized join of extracted target ids, not
        // the raw frontmatter value. field_removed must win.
        const current = { id: 'note-1', type: 'contact' };
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'field_removed', noteId: 'note-1', field: 'unit', oldValue: '[[roughnecks|the Roughnecks]]', newValue: null, timestamp: '2026-02-01T00:00:00.000Z' }),
            ev({ type: 'relation_removed', noteId: 'note-1', field: 'unit', oldValue: 'roughnecks', newValue: null, timestamp: '2026-02-01T00:00:00.000Z' })
        ];
        const result = reconstructNoteAtTime('note-1', '2026-01-15T00:00:00.000Z', current, events);
        assert.equal(result.fields.unit, '[[roughnecks|the Roughnecks]]');
    });

    test('a note created after the target time does not exist yet', () => {
        const current = { id: 'note-1', type: 'contact' };
        const events = [ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-06-01T00:00:00.000Z' })];
        const result = reconstructNoteAtTime('note-1', '2026-01-01T00:00:00.000Z', current, events);
        assert.equal(result.exists, false);
        assert.equal(result.reason, 'not-yet-created');
        assert.equal(result.earliestReconstructableTimestamp, '2026-06-01T00:00:00.000Z');
    });

    test('a note deleted before the target time was already gone by then too', () => {
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'note_deleted', noteId: 'note-1', timestamp: '2026-02-01T00:00:00.000Z' })
        ];
        const result = reconstructNoteAtTime('note-1', '2026-03-01T00:00:00.000Z', null, events);
        assert.equal(result.exists, false);
        assert.equal(result.reason, 'already-deleted');
    });

    test('a note deleted after the target time existed then, but its content is honestly unrecoverable', () => {
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'note_deleted', noteId: 'note-1', timestamp: '2026-03-01T00:00:00.000Z' })
        ];
        const result = reconstructNoteAtTime('note-1', '2026-02-01T00:00:00.000Z', null, events);
        assert.equal(result.exists, true);
        assert.equal(result.reason, 'deleted');
        assert.equal(result.fields, null);
        assert.equal(result.complete, false);
        assert.equal(result.deletedAt, '2026-03-01T00:00:00.000Z');
    });

    test('a noteId with no current fields and no recorded history is honestly unknown', () => {
        const result = reconstructNoteAtTime('ghost-note', '2026-01-01T00:00:00.000Z', null, []);
        assert.equal(result.exists, false);
        assert.equal(result.reason, 'no-history');
    });

    test('reports incomplete when the note lacks a retained note_created event and the target predates the earliest retained event', () => {
        // Simulates a note whose creation event scrolled off the 10k-event
        // cap (or predates logging entirely) — we can walk back to the
        // earliest event we still have, but not further, and must say so.
        const current = { id: 'note-1', type: 'contact', status: 'active' };
        const events = [
            ev({ type: 'field_changed', noteId: 'note-1', field: 'status', oldValue: 'growing', newValue: 'active', timestamp: '2026-03-01T00:00:00.000Z' })
        ];
        const result = reconstructNoteAtTime('note-1', '2026-01-01T00:00:00.000Z', current, events);
        assert.equal(result.complete, false);
        assert.equal(result.earliestReconstructableTimestamp, '2026-03-01T00:00:00.000Z');
        // Best-effort reconstruction still returned, just flagged as partial.
        assert.equal(result.fields.status, 'growing');
    });

    test('reports complete when the target time is at or after the earliest retained event, even without a created event', () => {
        const current = { id: 'note-1', type: 'contact', status: 'active' };
        const events = [
            ev({ type: 'field_changed', noteId: 'note-1', field: 'status', oldValue: 'growing', newValue: 'active', timestamp: '2026-03-01T00:00:00.000Z' })
        ];
        const result = reconstructNoteAtTime('note-1', '2026-03-15T00:00:00.000Z', current, events);
        assert.equal(result.complete, true);
        assert.equal(result.fields.status, 'active');
    });

    test('a future timestamp reconstructs to exactly the current fields', () => {
        const current = { id: 'note-1', type: 'contact', status: 'active' };
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'field_changed', noteId: 'note-1', field: 'status', oldValue: 'draft', newValue: 'active', timestamp: '2026-02-01T00:00:00.000Z' })
        ];
        const result = reconstructNoteAtTime('note-1', '2099-01-01T00:00:00.000Z', current, events);
        assert.deepEqual(result.fields, current);
        assert.equal(result.complete, true);
    });

    test('a note id deleted and later reused by a brand-new note does not bleed the old lifetime into the new one', () => {
        const current = { id: 'note-1', type: 'contact', name: 'New Owner' };
        const events = [
            // First lifetime: created, given a status, then deleted.
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'field_added', noteId: 'note-1', field: 'status', oldValue: null, newValue: 'active', timestamp: '2026-01-10T00:00:00.000Z' }),
            ev({ type: 'note_deleted', noteId: 'note-1', timestamp: '2026-02-01T00:00:00.000Z' }),
            // Second lifetime: the id reused for an unrelated new note.
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-06-01T00:00:00.000Z' }),
            ev({ type: 'field_added', noteId: 'note-1', field: 'name', oldValue: null, newValue: 'New Owner', timestamp: '2026-06-05T00:00:00.000Z' })
        ];

        // A target time inside the FIRST lifetime's window must not resolve
        // to the new note's history — the current note simply didn't exist
        // yet at that point, even though the same id existed once before.
        const duringFirstLife = reconstructNoteAtTime('note-1', '2026-01-15T00:00:00.000Z', current, events);
        assert.equal(duringFirstLife.exists, false);
        assert.equal(duringFirstLife.reason, 'not-yet-created');
        assert.equal(duringFirstLife.earliestReconstructableTimestamp, '2026-06-01T00:00:00.000Z');

        // A target time inside the second (current) lifetime, before `name`
        // was added, should undo just that field — not see the first
        // lifetime's `status` field at all.
        const duringSecondLife = reconstructNoteAtTime('note-1', '2026-06-02T00:00:00.000Z', current, events);
        assert.equal(duringSecondLife.exists, true);
        assert.equal(duringSecondLife.complete, true);
        assert.equal('name' in duringSecondLife.fields, false);
        assert.equal('status' in duringSecondLife.fields, false);
    });
});

describe('reconstructNoteAtTime — snapshot-aware reconstruction', () => {
    test('an exact snapshot match is used and marked complete, even when retained deltas do not reach that far back', () => {
        const current = { id: 'note-1', type: 'contact', status: 'active' };
        // No events at all retained for this note (they scrolled off the cap) —
        // without a snapshot this would be honestly unreconstructable at this
        // old a timestamp; today it just falls back to "no history" territory.
        const snapshots = [
            { timestamp: '2025-01-01T00:00:00.000Z', notes: { 'note-1': { id: 'note-1', type: 'contact', status: 'draft' } } }
        ];
        const result = reconstructNoteAtTime('note-1', '2025-01-01T00:00:00.000Z', current, [], snapshots);
        assert.equal(result.exists, true);
        assert.equal(result.complete, true);
        assert.deepEqual(result.fields, { id: 'note-1', type: 'contact', status: 'draft' });
    });

    test('a snapshot recording a note as null (existed, content unknown) is honored, not silently treated as nonexistent', () => {
        const snapshots = [{ timestamp: '2025-01-01T00:00:00.000Z', notes: { 'ghost-note': null } }];
        const result = reconstructNoteAtTime('ghost-note', '2025-01-01T00:00:00.000Z', null, [], snapshots);
        assert.equal(result.exists, true);
        assert.equal(result.fields, null);
    });

    test('a note absent from the snapshot entirely (did not exist yet at that time) reconstructs as not-yet-existing', () => {
        const snapshots = [{ timestamp: '2025-01-01T00:00:00.000Z', notes: { 'other-note': {} } }];
        const result = reconstructNoteAtTime('note-1', '2025-01-01T00:00:00.000Z', { id: 'note-1' }, [], snapshots);
        assert.equal(result.exists, false);
        assert.equal(result.reason, 'no-history');
    });

    test('no snapshot at that exact timestamp falls back to ordinary backward-undo, unchanged', () => {
        const current = { id: 'note-1', type: 'contact', status: 'active' };
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'field_changed', noteId: 'note-1', field: 'status', oldValue: 'draft', newValue: 'active', timestamp: '2026-02-01T00:00:00.000Z' })
        ];
        const snapshots = [{ timestamp: '2020-01-01T00:00:00.000Z', notes: { 'note-1': { status: 'irrelevant' } } }];
        const result = reconstructNoteAtTime('note-1', '2026-01-15T00:00:00.000Z', current, events, snapshots);
        assert.equal(result.fields.status, 'draft');
    });

    test('a deleted note whose fields were captured by an earlier snapshot recovers real content — previously always unreconstructable', () => {
        const events = [
            ev({ type: 'note_deleted', noteId: 'note-1', timestamp: '2026-06-01T00:00:00.000Z' })
        ];
        const snapshots = [{ timestamp: '2026-01-01T00:00:00.000Z', notes: { 'note-1': { id: 'note-1', type: 'contact', name: 'Recovered' } } }];
        const noSnapshot = reconstructNoteAtTime('note-1', '2026-01-01T00:00:00.000Z', null, events);
        assert.equal(noSnapshot.fields, null, 'without a snapshot this stays unreconstructable, as before');
        const withSnapshot = reconstructNoteAtTime('note-1', '2026-01-01T00:00:00.000Z', null, events, snapshots);
        assert.deepEqual(withSnapshot.fields, { id: 'note-1', type: 'contact', name: 'Recovered' });
    });
});

describe('reconstructVaultAtTime', () => {
    test('reconstructs every currently-existing note', () => {
        const fieldsCache = new Map([
            ['note-1', { id: 'note-1', type: 'contact', status: 'active' }],
            ['note-2', { id: 'note-2', type: 'unit', name: 'Roughnecks' }]
        ]);
        const events = [
            ev({ noteId: 'note-1', type: 'note_created', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ noteId: 'note-1', type: 'field_changed', field: 'status', oldValue: 'draft', newValue: 'active', timestamp: '2026-03-01T00:00:00.000Z' })
        ];
        const result = reconstructVaultAtTime('2026-02-01T00:00:00.000Z', { fieldsCache, mutationEvents: events });
        assert.equal(result.size, 2);
        assert.equal(result.get('note-1').fields.status, 'draft');
        assert.deepEqual(result.get('note-2').fields, { id: 'note-2', type: 'unit', name: 'Roughnecks' });
    });

    test('includes a deleted-but-existed-at-the-time note as a ghost entry rather than silently dropping it', () => {
        const fieldsCache = new Map([['note-1', { id: 'note-1', type: 'contact' }]]);
        const events = [
            ev({ noteId: 'ghost', type: 'note_created', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ noteId: 'ghost', type: 'note_deleted', timestamp: '2026-03-01T00:00:00.000Z' })
        ];
        const result = reconstructVaultAtTime('2026-02-01T00:00:00.000Z', { fieldsCache, mutationEvents: events });
        assert.equal(result.size, 2);
        const ghost = result.get('ghost');
        assert.equal(ghost.exists, true);
        assert.equal(ghost.reason, 'deleted');
        assert.equal(ghost.fields, null);
    });

    test('omits a note that was already deleted by the target time', () => {
        const fieldsCache = new Map();
        const events = [
            ev({ noteId: 'gone', type: 'note_created', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ noteId: 'gone', type: 'note_deleted', timestamp: '2026-02-01T00:00:00.000Z' })
        ];
        const result = reconstructVaultAtTime('2026-03-01T00:00:00.000Z', { fieldsCache, mutationEvents: events });
        assert.equal(result.get('gone').exists, false);
        assert.equal(result.get('gone').reason, 'already-deleted');
    });

    test('groups the mutation log by note once instead of rescanning it per note (stays fast at real scale)', () => {
        // Regression guard for the O(notes x events) design that reconstructVaultAtTime
        // used before it grouped events by noteId once up front — this shape
        // (many notes, each with real history) is exactly what the x-graph
        // time-lapse consumer will call repeatedly across many timestamps.
        const fieldsCache = new Map();
        const events = [];
        const NOTE_COUNT = 500;
        const EVENTS_PER_NOTE = 20;
        for (let n = 0; n < NOTE_COUNT; n++) {
            const noteId = `note-${n}`;
            fieldsCache.set(noteId, { id: noteId, type: 'contact', status: 'active' });
            events.push(ev({ noteId, type: 'note_created', timestamp: '2026-01-01T00:00:00.000Z' }));
            for (let i = 0; i < EVENTS_PER_NOTE; i++) {
                events.push(ev({
                    noteId, type: 'field_changed', field: 'status',
                    oldValue: `state-${i}`, newValue: `state-${i + 1}`,
                    timestamp: `2026-01-${String(2 + i).padStart(2, '0')}T00:00:00.000Z`
                }));
            }
        }

        const start = process.hrtime.bigint();
        const result = reconstructVaultAtTime('2026-01-05T00:00:00.000Z', { fieldsCache, mutationEvents: events });
        const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

        assert.equal(result.size, NOTE_COUNT);
        // atTimestamp is Jan 5; the Jan-5 event itself (i=3, state-3→state-4)
        // isn't undone (its timestamp isn't strictly after atTimestamp), so
        // the oldest undone event is i=4 (Jan 6, oldValue "state-4") — that's
        // the last write in the newest-first undo loop, so it wins.
        assert.equal(result.get('note-0').fields.status, 'state-4');
        // Generous ceiling — the point isn't a tight benchmark, it's catching
        // a regression back to the O(notes x events) full-rescan design,
        // which would be dramatically slower than this at 500 x 21 events.
        assert.ok(elapsedMs < 500, `reconstructVaultAtTime took ${elapsedMs.toFixed(1)}ms for ${NOTE_COUNT} notes — expected well under 500ms`);
    });

    describe('body-links reconstruction (bodyLinksCache)', () => {
        // core/index.js now diffs body-text wikilink mentions on every save
        // (via the synthetic '__body_links__' field) so the mutation log can
        // finally record body-text link history, not just frontmatter — this
        // is what buildTimelapseSequence's mutation-log fallback path needs
        // for the "now" checkpoint, and for undoing past body-link changes.
        test('the current body-links value is seeded for "now" even with no relevant events', () => {
            const fieldsCache = new Map([['a', { id: 'a', type: 'note' }]]);
            const bodyLinksCache = new Map([['a', '[[b]]']]);
            const result = reconstructVaultAtTime('2026-06-01T00:00:00.000Z', { fieldsCache, mutationEvents: [], bodyLinksCache });
            assert.equal(result.get('a').fields.__body_links__, '[[b]]');
        });

        test('a field_added event for __body_links__ is undone the same way any other field is', () => {
            const fieldsCache = new Map([['a', { id: 'a', type: 'note' }]]);
            const bodyLinksCache = new Map([['a', '[[b]]']]);
            const events = [
                ev({ noteId: 'a', type: 'field_added', field: '__body_links__', oldValue: null, newValue: '[[b]]', timestamp: '2026-03-01T00:00:00.000Z' })
            ];
            const before = reconstructVaultAtTime('2026-02-01T00:00:00.000Z', { fieldsCache, mutationEvents: events, bodyLinksCache });
            assert.equal(before.get('a').fields.__body_links__, undefined);

            const after = reconstructVaultAtTime('2026-04-01T00:00:00.000Z', { fieldsCache, mutationEvents: events, bodyLinksCache });
            assert.equal(after.get('a').fields.__body_links__, '[[b]]');
        });

        test('omitting bodyLinksCache entirely leaves reconstruction unaffected (existing callers stay backward compatible)', () => {
            const fieldsCache = new Map([['a', { id: 'a', type: 'note', status: 'active' }]]);
            const result = reconstructVaultAtTime('2026-06-01T00:00:00.000Z', { fieldsCache, mutationEvents: [] });
            assert.equal(result.get('a').fields.__body_links__, undefined);
            assert.equal(result.get('a').fields.status, 'active');
        });
    });
});

describe('buildNoteTimeline', () => {
    test('a note with zero history has an empty, complete timeline', () => {
        const current = { id: 'note-1', type: 'contact', name: 'Johnny Rico' };
        const timeline = buildNoteTimeline('note-1', current, []);
        assert.equal(timeline.exists, true);
        assert.deepEqual(timeline.checkpoints, []);
        assert.equal(timeline.complete, true);
    });

    test('walks forward through a full lifecycle from birth, each checkpoint carrying the correct cumulative state', () => {
        const current = { id: 'note-1', type: 'contact', name: 'Johnny Rico', status: 'consolidated' };
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'field_added', noteId: 'note-1', field: 'name', oldValue: null, newValue: 'Johnny Rico', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'field_added', noteId: 'note-1', field: 'status', oldValue: null, newValue: 'draft', timestamp: '2026-01-05T00:00:00.000Z' }),
            ev({ type: 'field_changed', noteId: 'note-1', field: 'status', oldValue: 'draft', newValue: 'growing', timestamp: '2026-02-01T00:00:00.000Z' }),
            ev({ type: 'field_changed', noteId: 'note-1', field: 'status', oldValue: 'growing', newValue: 'consolidated', timestamp: '2026-03-01T00:00:00.000Z' })
        ];
        const timeline = buildNoteTimeline('note-1', current, events);
        assert.equal(timeline.exists, true);
        assert.equal(timeline.complete, true);
        assert.equal(timeline.checkpoints.length, 4);

        assert.equal(timeline.checkpoints[0].fieldsAfter.name, 'Johnny Rico');
        assert.equal('status' in timeline.checkpoints[0].fieldsAfter, false);

        assert.equal(timeline.checkpoints[1].fieldsAfter.status, 'draft');
        assert.equal(timeline.checkpoints[2].fieldsAfter.status, 'growing');
        assert.equal(timeline.checkpoints[3].fieldsAfter.status, 'consolidated');
        // Final checkpoint's state must match current on every field that was
        // ever actually touched by a value event — id/type are never touched
        // here (no type_set was emitted, and id is never mutable at all), so
        // they correctly never appear in the reconstructed checkpoints.
        assert.deepEqual(timeline.checkpoints[3].fieldsAfter, { name: current.name, status: current.status });
    });

    test('a field that is added then later removed disappears from fieldsAfter, not left dangling', () => {
        const current = { id: 'note-1', type: 'contact' };
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'field_added', noteId: 'note-1', field: 'owner', oldValue: null, newValue: 'carmen', timestamp: '2026-01-10T00:00:00.000Z' }),
            ev({ type: 'field_removed', noteId: 'note-1', field: 'owner', oldValue: 'carmen', newValue: null, timestamp: '2026-02-01T00:00:00.000Z' })
        ];
        const timeline = buildNoteTimeline('note-1', current, events);
        assert.equal(timeline.checkpoints[0].fieldsAfter.owner, 'carmen');
        assert.equal('owner' in timeline.checkpoints[1].fieldsAfter, false);
    });

    test('tracks type_set checkpoints under field "type"', () => {
        const current = { id: 'note-1', type: 'consolidated-report' };
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'type_set', noteId: 'note-1', field: 'type', oldValue: 'draft-report', newValue: 'consolidated-report', timestamp: '2026-02-01T00:00:00.000Z' })
        ];
        const timeline = buildNoteTimeline('note-1', current, events);
        assert.equal(timeline.checkpoints[0].field, 'type');
        assert.equal(timeline.checkpoints[0].fieldsAfter.type, 'consolidated-report');
    });

    test('an id reused after deletion only carries the current incarnation\'s checkpoints', () => {
        const current = { id: 'note-1', type: 'contact', name: 'New Owner' };
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'field_added', noteId: 'note-1', field: 'status', oldValue: null, newValue: 'active', timestamp: '2026-01-10T00:00:00.000Z' }),
            ev({ type: 'note_deleted', noteId: 'note-1', timestamp: '2026-02-01T00:00:00.000Z' }),
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-06-01T00:00:00.000Z' }),
            ev({ type: 'field_added', noteId: 'note-1', field: 'name', oldValue: null, newValue: 'New Owner', timestamp: '2026-06-05T00:00:00.000Z' })
        ];
        const timeline = buildNoteTimeline('note-1', current, events);
        assert.equal(timeline.complete, true);
        assert.equal(timeline.checkpoints.length, 1);
        assert.equal(timeline.checkpoints[0].field, 'name');
    });

    test('reports incomplete and still returns a best-effort timeline when the creation event is not retained', () => {
        const current = { id: 'note-1', type: 'contact', status: 'active' };
        const events = [
            ev({ type: 'field_changed', noteId: 'note-1', field: 'status', oldValue: 'growing', newValue: 'active', timestamp: '2026-03-01T00:00:00.000Z' })
        ];
        const timeline = buildNoteTimeline('note-1', current, events);
        assert.equal(timeline.complete, false);
        assert.equal(timeline.earliestReconstructableTimestamp, '2026-03-01T00:00:00.000Z');
        assert.equal(timeline.checkpoints.length, 1);
        assert.equal(timeline.checkpoints[0].fieldsAfter.status, 'active');
    });

    test('a deleted note has no recoverable timeline, honestly', () => {
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'note_deleted', noteId: 'note-1', timestamp: '2026-03-01T00:00:00.000Z' })
        ];
        const timeline = buildNoteTimeline('note-1', null, events);
        assert.equal(timeline.exists, true);
        assert.equal(timeline.reason, 'deleted');
        assert.deepEqual(timeline.checkpoints, []);
        assert.equal(timeline.complete, false);
    });
});

describe('buildFieldTimeline', () => {
    test('returns the plain-English "status: draft -> growing -> consolidated" history for one field', () => {
        const current = { id: 'note-1', type: 'contact', status: 'consolidated' };
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'field_added', noteId: 'note-1', field: 'status', oldValue: null, newValue: 'draft', timestamp: '2026-01-03T00:00:00.000Z' }),
            ev({ type: 'field_changed', noteId: 'note-1', field: 'status', oldValue: 'draft', newValue: 'growing', timestamp: '2026-02-01T00:00:00.000Z' }),
            ev({ type: 'field_changed', noteId: 'note-1', field: 'status', oldValue: 'growing', newValue: 'consolidated', timestamp: '2026-03-15T00:00:00.000Z' })
        ];
        const result = buildFieldTimeline('note-1', 'status', current, events);
        assert.equal(result.exists, true);
        assert.equal(result.field, 'status');
        assert.deepEqual(result.history.map((h) => h.value), ['draft', 'growing', 'consolidated']);
        assert.equal(result.history[0].timestamp, '2026-01-03T00:00:00.000Z');
        assert.equal(result.complete, true);
    });

    test('ignores checkpoints belonging to other fields', () => {
        const current = { id: 'note-1', type: 'contact', status: 'active', owner: 'carmen' };
        const events = [
            ev({ type: 'note_created', noteId: 'note-1', timestamp: '2026-01-01T00:00:00.000Z' }),
            ev({ type: 'field_added', noteId: 'note-1', field: 'status', oldValue: null, newValue: 'active', timestamp: '2026-01-05T00:00:00.000Z' }),
            ev({ type: 'field_added', noteId: 'note-1', field: 'owner', oldValue: null, newValue: 'carmen', timestamp: '2026-01-06T00:00:00.000Z' })
        ];
        const result = buildFieldTimeline('note-1', 'status', current, events);
        assert.equal(result.history.length, 1);
        assert.equal(result.history[0].value, 'active');
    });
});
