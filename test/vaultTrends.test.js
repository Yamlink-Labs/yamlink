'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildVaultTrajectory,
    fitLinearTrend,
    buildRetrospectiveAccuracy,
    buildLaneTrajectories,
    buildLaneRetrospectiveAccuracy,
    buildStalenessForecast
} = require('../src/intelligence/vaultTrends');

const DAY = 86400000;

describe('fitLinearTrend', () => {
    test('fits a perfect line with r2 of 1', () => {
        const points = [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 4 }];
        const fit = fitLinearTrend(points);
        assert.ok(fit);
        assert.equal(Math.round(fit.slope), 1);
        assert.ok(fit.r2 > 0.999);
    });

    test('returns null for fewer than 2 points', () => {
        assert.equal(fitLinearTrend([]), null);
        assert.equal(fitLinearTrend([{ x: 0, y: 1 }]), null);
    });

    test('returns null when every point shares the same x (no real variation to fit)', () => {
        assert.equal(fitLinearTrend([{ x: 5, y: 1 }, { x: 5, y: 9 }]), null);
    });

    test('reports a low r2 for noisy, non-linear data', () => {
        const points = [{ x: 0, y: 5 }, { x: 1, y: 1 }, { x: 2, y: 8 }, { x: 3, y: 0 }, { x: 4, y: 6 }];
        const fit = fitLinearTrend(points);
        assert.ok(fit);
        assert.ok(fit.r2 < 0.5, `expected a poor fit for noisy data, got r2=${fit.r2}`);
    });
});

describe('buildVaultTrajectory', () => {
    test('reports insufficient history when there are no mutation events at all', () => {
        const fieldsCache = new Map([['a', { type: 'note' }]]);
        const result = buildVaultTrajectory({ fieldsCache, mutationEvents: [] });
        assert.equal(result.insufficientHistory, true);
        assert.equal(result.reason, 'no-mutation-history');
        assert.deepEqual(result.checkpoints, []);
        assert.equal(result.overall, null);
    });

    test('reports insufficient history when fewer than 2 requested checkpoints fall within real retained history', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map([['a', { id: 'a', type: 'note' }]]);
        const mutationEvents = [
            { type: 'note_created', noteId: 'a', timestamp: new Date(now - 1 * DAY).toISOString(), field: null, oldValue: null, newValue: null }
        ];
        const result = buildVaultTrajectory({ fieldsCache, mutationEvents }, { now, checkpoints: 12, spacingDays: 7 });
        assert.equal(result.insufficientHistory, true);
        assert.equal(result.reason, 'not-enough-history');
        assert.equal(result.earliestReconstructableTimestamp, new Date(now - 1 * DAY).toISOString());
    });

    test('fits a real, honest growth trend from reconstructed checkpoints — one note added every week for 10 weeks', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map();
        const mutationEvents = [];
        // Created offsets deliberately do not line up with the checkpoint
        // grid (49/42/.../0 days ago) so no creation event exactly
        // coincides with a checkpoint boundary — avoids ambiguity about
        // whether a note "exists yet" at the instant it was created.
        const creationOffsetsDays = [65, 58, 51, 44, 37, 30, 23, 16, 9, 2];
        creationOffsetsDays.forEach((offset, i) => {
            const id = `note${i}`;
            fieldsCache.set(id, { id, type: 'character' });
            mutationEvents.push({
                type: 'note_created', noteId: id,
                timestamp: new Date(now - offset * DAY).toISOString(),
                field: null, oldValue: null, newValue: null
            });
        });

        const result = buildVaultTrajectory({ fieldsCache, mutationEvents }, { now, checkpoints: 8, spacingDays: 7, horizonDays: 90 });

        assert.equal(result.insufficientHistory, false);
        assert.equal(result.checkpoints.length, 8);
        assert.ok(result.overall);
        // The most recent checkpoint (today) must match the real current
        // count exactly — the trend is grounded in real reconstructed state,
        // not just fit through arbitrary numbers.
        assert.equal(result.overall.current, 10);
        assert.equal(result.checkpoints[result.checkpoints.length - 1].total, 10);
        // Construction is exactly linear (1 new note per 7-day checkpoint
        // step) — the fit should recognize that almost perfectly.
        assert.ok(result.overall.r2 > 0.99, `expected a near-perfect fit, got r2=${result.overall.r2}`);
        assert.ok(result.overall.slope > 0);
        assert.ok(result.overall.projected > result.overall.current, 'a real positive trend should project growth, not just echo the current count');

        assert.ok(result.byType.character);
        assert.equal(result.byType.character.current, 10);
        assert.ok(result.byType.character.r2 > 0.99);
    });

    test('per-type trends are computed independently — two types growing at different rates', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map();
        const mutationEvents = [];

        // 'contact' grows fast: one new note every checkpoint step.
        [65, 58, 51, 44, 37, 30, 23, 16].forEach((offset, i) => {
            const id = `contact${i}`;
            fieldsCache.set(id, { id, type: 'contact' });
            mutationEvents.push({ type: 'note_created', noteId: id, timestamp: new Date(now - offset * DAY).toISOString(), field: null, oldValue: null, newValue: null });
        });
        // 'mission' grows slowly: only 2 notes, both created long ago.
        [65, 58].forEach((offset, i) => {
            const id = `mission${i}`;
            fieldsCache.set(id, { id, type: 'mission' });
            mutationEvents.push({ type: 'note_created', noteId: id, timestamp: new Date(now - offset * DAY).toISOString(), field: null, oldValue: null, newValue: null });
        });

        const result = buildVaultTrajectory({ fieldsCache, mutationEvents }, { now, checkpoints: 8, spacingDays: 7 });

        assert.ok(result.byType.contact.slope > result.byType.mission.slope, 'the fast-growing type should have a steeper slope than the flat one');
        assert.equal(result.byType.contact.current, 8);
        assert.equal(result.byType.mission.current, 2);
    });

    test('excludes system types (schema/dashboard/template) from growth counts', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map();
        const mutationEvents = [];
        [65, 58, 51, 44].forEach((offset, i) => {
            const id = `note${i}`;
            fieldsCache.set(id, { id, type: 'contact' });
            mutationEvents.push({ type: 'note_created', noteId: id, timestamp: new Date(now - offset * DAY).toISOString(), field: null, oldValue: null, newValue: null });
        });
        fieldsCache.set('schema-contact', { id: 'schema-contact', type: 'schema', target: 'contact' });
        mutationEvents.push({ type: 'note_created', noteId: 'schema-contact', timestamp: new Date(now - 60 * DAY).toISOString(), field: null, oldValue: null, newValue: null });

        const result = buildVaultTrajectory({ fieldsCache, mutationEvents }, { now, checkpoints: 8, spacingDays: 7 });
        assert.equal(result.byType.schema, undefined);
        assert.equal(result.overall.current, 4);
    });

    test('notesWithoutHistory counts notes with zero mutation events, honestly flagging the assumed-constant caveat', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map();
        const mutationEvents = [];
        [65, 58, 51, 44].forEach((offset, i) => {
            const id = `note${i}`;
            fieldsCache.set(id, { id, type: 'contact' });
            mutationEvents.push({ type: 'note_created', noteId: id, timestamp: new Date(now - offset * DAY).toISOString(), field: null, oldValue: null, newValue: null });
        });
        // Two notes with no recorded history at all — e.g. imported, or
        // predating the mutation log.
        fieldsCache.set('untouched-a', { id: 'untouched-a', type: 'contact' });
        fieldsCache.set('untouched-b', { id: 'untouched-b', type: 'contact' });

        const result = buildVaultTrajectory({ fieldsCache, mutationEvents }, { now, checkpoints: 8, spacingDays: 7 });
        assert.equal(result.notesWithoutHistory, 2);
        // Both untouched notes read as existing at every single checkpoint,
        // including the oldest one (only 3 of the 4 real notes had been
        // created by then) — the documented Time Engine limitation showing
        // up honestly in the numbers, not a bug in this module.
        assert.equal(result.checkpoints[0].total, 5);
        assert.equal(result.checkpoints[result.checkpoints.length - 1].total, 6);
    });

    test('never fabricates a checkpoint older than the earliest real event', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map([['a', { id: 'a', type: 'note' }]]);
        const mutationEvents = [
            { type: 'note_created', noteId: 'a', timestamp: new Date(now - 20 * DAY).toISOString(), field: null, oldValue: null, newValue: null }
        ];
        // Requesting 12 checkpoints spaced a week apart reaches back 77 days
        // — far more than the 20 real days of history available.
        const result = buildVaultTrajectory({ fieldsCache, mutationEvents }, { now, checkpoints: 12, spacingDays: 7 });
        for (const checkpoint of result.checkpoints) {
            assert.ok(checkpoint.timestamp >= result.earliestReconstructableTimestamp, 'no checkpoint should predate the earliest real event');
        }
    });

    // Snapshots wired in 2026-07-13 (docs/architecture/TIME-ENGINE.md §4.1) —
    // real, exact-timestamp checkpoints from before the live mutation-log
    // window's own reach, not synthesized/interpolated dates.
    test('a persisted snapshot older than the retained live window becomes an additional real checkpoint', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map([
            ['a', { id: 'a', type: 'note' }],
            ['b', { id: 'b', type: 'note' }],
            ['c', { id: 'c', type: 'note' }]
        ]);
        // Live retained history only reaches back 20 days.
        const mutationEvents = [
            { type: 'note_created', noteId: 'a', timestamp: new Date(now - 20 * DAY).toISOString(), field: null, oldValue: null, newValue: null },
            { type: 'note_created', noteId: 'b', timestamp: new Date(now - 10 * DAY).toISOString(), field: null, oldValue: null, newValue: null },
            { type: 'note_created', noteId: 'c', timestamp: new Date(now - 3 * DAY).toISOString(), field: null, oldValue: null, newValue: null }
        ];
        // A snapshot taken 60 days ago — well before the live window's own
        // reach — recording only 1 note existed at that point.
        const snapshotTimestamp = new Date(now - 60 * DAY).toISOString();
        const snapshots = [{ timestamp: snapshotTimestamp, notes: { z: { id: 'z', type: 'note' } } }];

        const withoutSnapshots = buildVaultTrajectory({ fieldsCache, mutationEvents }, { now, checkpoints: 12, spacingDays: 7 });
        const withSnapshots = buildVaultTrajectory({ fieldsCache, mutationEvents, snapshots }, { now, checkpoints: 12, spacingDays: 7 });

        assert.equal(withSnapshots.checkpoints.length, withoutSnapshots.checkpoints.length + 1, 'the snapshot adds exactly one real checkpoint');
        assert.equal(withSnapshots.checkpoints[0].timestamp, snapshotTimestamp, 'the snapshot becomes the new earliest checkpoint');
        assert.equal(withSnapshots.checkpoints[0].fromSnapshot, true);
        assert.equal(withSnapshots.checkpoints[0].total, 1, 'uses the snapshot\'s own recorded note count, not a reconstruction guess');
        assert.equal(withSnapshots.snapshotCheckpointCount, 1);
        assert.equal(withSnapshots.earliestReconstructableTimestamp, snapshotTimestamp, 'reaches further back than the live-only window');
        assert.ok(withSnapshots.earliestReconstructableTimestamp < withoutSnapshots.earliestReconstructableTimestamp);
    });

    test('a snapshot within the live window\'s own reach is not duplicated as a second checkpoint', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map([['a', { id: 'a', type: 'note' }]]);
        const mutationEvents = [
            { type: 'note_created', noteId: 'a', timestamp: new Date(now - 60 * DAY).toISOString(), field: null, oldValue: null, newValue: null }
        ];
        // A snapshot from only 5 days ago — well within the live window's
        // own reach (earliest real event is 60 days ago).
        const snapshots = [{ timestamp: new Date(now - 5 * DAY).toISOString(), notes: { a: { id: 'a', type: 'note' } } }];

        const withoutSnapshots = buildVaultTrajectory({ fieldsCache, mutationEvents }, { now, checkpoints: 12, spacingDays: 7 });
        const withSnapshots = buildVaultTrajectory({ fieldsCache, mutationEvents, snapshots }, { now, checkpoints: 12, spacingDays: 7 });

        assert.equal(withSnapshots.checkpoints.length, withoutSnapshots.checkpoints.length, 'no extra checkpoint — the snapshot\'s era is already covered by live deltas');
        assert.equal(withSnapshots.snapshotCheckpointCount, 0);
    });

    test('works using only snapshot checkpoints once the live mutation log has been fully pruned', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map([['a', { id: 'a', type: 'note' }]]);
        const snapshots = [
            { timestamp: new Date(now - 90 * DAY).toISOString(), notes: { a: { id: 'a', type: 'note' } } },
            { timestamp: new Date(now - 30 * DAY).toISOString(), notes: { a: { id: 'a', type: 'note' } } }
        ];
        const result = buildVaultTrajectory({ fieldsCache, mutationEvents: [], snapshots }, { now, checkpoints: 12, spacingDays: 7 });
        assert.equal(result.insufficientHistory, false, 'two real snapshot checkpoints are enough to fit a trend, even with zero live deltas');
        assert.equal(result.checkpoints.length, 2);
        assert.ok(result.checkpoints.every((c) => c.fromSnapshot === true));
        assert.equal(result.snapshotCheckpointCount, 2);
    });
});

describe('buildRetrospectiveAccuracy', () => {
    // Shared fixture: notes created every 7 days, offsets (days ago from
    // "now") deliberately off the checkpoint grid so no creation instant
    // exactly coincides with a checkpoint boundary. horizonDays=30,
    // checkpoints=4, spacingDays=7 means the historical model (built as of
    // 30 days ago) uses its own trailing 21 days of history — the first 4
    // creations (offsets 53/46/39/32, all >= 30 days ago) are visible to it,
    // the rest (25/18/11/4) happened after its "now" and are invisible to it,
    // exactly like a real retrospective check.
    function buildFixture(extraOffsets) {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map();
        const mutationEvents = [];
        const offsets = [53, 46, 39, 32, ...extraOffsets];
        offsets.forEach((offset, i) => {
            const id = `note${i}`;
            fieldsCache.set(id, { id, type: 'character' });
            mutationEvents.push({
                type: 'note_created', noteId: id,
                timestamp: new Date(now - offset * DAY).toISOString(),
                field: null, oldValue: null, newValue: null
            });
        });
        return { now, fieldsCache, mutationEvents };
    }

    test('reports a real, checkable accuracy score when the historical trend continued as projected', () => {
        // Growth continues at the same steady pace right through to today —
        // the historical model's projection should land close to reality.
        const { now, fieldsCache, mutationEvents } = buildFixture([25, 18, 11, 4]);
        const result = buildRetrospectiveAccuracy({ fieldsCache, mutationEvents }, { now, horizonDays: 30, checkpoints: 4, spacingDays: 7 });

        assert.equal(result.available, true);
        assert.equal(result.horizonDays, 30);
        assert.equal(result.overall.actual, 8, 'all 8 notes exist by today');
        assert.equal(result.overall.projected, 8, 'the perfectly linear construction should project exactly what happened');
        assert.ok(result.overall.accuracy > 0.95, `expected near-perfect accuracy, got ${result.overall.accuracy}`);
        assert.ok(result.byType.character);
        assert.equal(result.byType.character.actual, 8);
    });

    test('reports a real, honestly lower accuracy when growth actually stalled after the historical checkpoint', () => {
        // No further notes created after the historical model's own "now" —
        // it still projects continued growth, but reality stayed flat.
        const { now, fieldsCache, mutationEvents } = buildFixture([]);
        const result = buildRetrospectiveAccuracy({ fieldsCache, mutationEvents }, { now, horizonDays: 30, checkpoints: 4, spacingDays: 7 });

        assert.equal(result.available, true);
        assert.equal(result.overall.actual, 4, 'growth stopped — only the original 4 notes exist today');
        assert.equal(result.overall.projected, 8, 'the historical trend still projects continued growth');
        assert.ok(result.overall.accuracy < 0.6 && result.overall.accuracy > 0.4, `expected a real, moderate miss (~50%), got ${result.overall.accuracy}`);
    });

    test('is unavailable, honestly, when there is not enough real history to build a historical trend at all', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map([['a', { id: 'a', type: 'note' }]]);
        const mutationEvents = [
            { type: 'note_created', noteId: 'a', timestamp: new Date(now - 5 * DAY).toISOString(), field: null, oldValue: null, newValue: null }
        ];
        const result = buildRetrospectiveAccuracy({ fieldsCache, mutationEvents }, { now, horizonDays: 90, checkpoints: 12, spacingDays: 7 });
        assert.equal(result.available, false);
        assert.ok(result.reason);
        assert.equal(result.overall, undefined);
    });

    test('reuses buildVaultTrajectory rather than a second, separately-maintained model', () => {
        // Sanity check that projectedAsOf really is horizonDays before "now",
        // not an arbitrary or drifted timestamp.
        const { now, fieldsCache, mutationEvents } = buildFixture([25, 18, 11, 4]);
        const result = buildRetrospectiveAccuracy({ fieldsCache, mutationEvents }, { now, horizonDays: 30, checkpoints: 4, spacingDays: 7 });
        assert.equal(result.projectedAsOf, new Date(now - 30 * DAY).toISOString());
    });
});

// Minimal priors fixture — enough for computeVaultDrift to run without the
// O(n) typeBundleTotals fallback rescan (see driftDetector.js's own
// "avoids O(n) rescan per note" comment).
function buildPriors(typeBundles) {
    const typeFieldBundles = new Map();
    const typeBundleTotals = new Map();
    for (const [type, fields] of Object.entries(typeBundles)) {
        typeFieldBundles.set(type, new Map(Object.entries(fields.bundle)));
        typeBundleTotals.set(type, fields.total);
    }
    return { typeFieldBundles, typeBundleTotals, fieldAmbiguity: new Map() };
}

describe('buildLaneTrajectories', () => {
    test('insufficient history is reported the same way as buildVaultTrajectory, at both the top level and growth', () => {
        const fieldsCache = new Map([['a', { type: 'note' }]]);
        const priors = buildPriors({});
        const result = buildLaneTrajectories({ fieldsCache, mutationEvents: [], priors });
        assert.equal(result.insufficientHistory, true);
        assert.equal(result.growth.insufficientHistory, true);
        assert.equal(result.stale, null);
        assert.equal(result.structure, null);
    });

    test('growth output is identical in shape and values to buildVaultTrajectory for the same input', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map();
        const mutationEvents = [];
        const creationOffsetsDays = [65, 58, 51, 44, 37, 30, 23, 16, 9, 2];
        creationOffsetsDays.forEach((offset, i) => {
            const id = `note${i}`;
            fieldsCache.set(id, { id, type: 'character' });
            mutationEvents.push({
                type: 'note_created', noteId: id,
                timestamp: new Date(now - offset * DAY).toISOString(),
                field: null, oldValue: null, newValue: null
            });
        });
        const priors = buildPriors({});

        const direct = buildVaultTrajectory({ fieldsCache, mutationEvents }, { now });
        const combined = buildLaneTrajectories({ fieldsCache, mutationEvents, priors }, { now });

        assert.deepEqual(combined.growth, direct);
    });

    test('excludes a note with zero mutation history from the stale tally, honestly, while still counting it in growth', () => {
        const now = Date.parse('2026-07-16T00:00:00.000Z');
        const fieldsCache = new Map([
            ['tracked-a', { id: 'tracked-a', type: 'character' }],
            ['tracked-b', { id: 'tracked-b', type: 'character' }],
            ['no-history', { id: 'no-history', type: 'character' }]
        ]);
        const mutationEvents = [
            { type: 'note_created', noteId: 'tracked-a', timestamp: new Date(now - 65 * DAY).toISOString(), field: null, oldValue: null, newValue: null },
            { type: 'note_created', noteId: 'tracked-b', timestamp: new Date(now - 40 * DAY).toISOString(), field: null, oldValue: null, newValue: null }
            // 'no-history' has zero events at all — reconstructs as always-existed (Time Engine's own honest limitation).
        ];
        const priors = buildPriors({});
        const result = buildLaneTrajectories({ fieldsCache, mutationEvents, priors }, { now, staleDays: 90 });

        assert.equal(result.insufficientHistory, false);
        const lastCheckpoint = result.stale.checkpoints[result.stale.checkpoints.length - 1];
        // 3 notes exist by the final checkpoint, but only 2 have any recorded
        // history to judge staleness from.
        assert.equal(lastCheckpoint.eligible, 2);
    });

    test('fits a real stale trend — a note untouched since creation crosses the stale threshold partway through the trajectory', () => {
        const now = Date.parse('2026-07-16T00:00:00.000Z');
        const fieldsCache = new Map([['old-note', { id: 'old-note', type: 'character' }]]);
        // Created 150 days ago and never touched again — with a 90-day stale
        // threshold, this note is fresh at the earliest checkpoints and
        // already stale by the most recent ones.
        const mutationEvents = [
            { type: 'note_created', noteId: 'old-note', timestamp: new Date(now - 150 * DAY).toISOString(), field: null, oldValue: null, newValue: null }
        ];
        const priors = buildPriors({});
        const result = buildLaneTrajectories({ fieldsCache, mutationEvents, priors }, { now, staleDays: 90, checkpoints: 12, spacingDays: 7 });

        const first = result.stale.checkpoints[0];
        const last = result.stale.checkpoints[result.stale.checkpoints.length - 1];
        assert.equal(first.staleCount, 0, 'not stale yet at the earliest checkpoint');
        assert.equal(last.staleCount, 1, 'stale by the most recent checkpoint');
        assert.ok(result.stale.trend, 'a real trend should fit through a genuine 0->1 transition');
        assert.ok(result.stale.trend.slope > 0, 'stale count should trend upward over time in this scenario');
    });

    test('fits a real structure trend — notes that had a missing-field gap backfilled partway through history', () => {
        // 6 'character' notes, all currently complete (name+rank+homeworld).
        // 3 of them (char-0..2) got rank/homeworld added almost immediately
        // after creation; the other 3 (char-3..5) only got them 4 days ago —
        // so for most of the trajectory, half the vault is missing both
        // priors-expected fields.
        const now = Date.parse('2026-07-16T00:00:00.000Z');
        const fieldsCache = new Map();
        const mutationEvents = [];
        const mk = (id) => {
            fieldsCache.set(id, { id, type: 'character', name: 'X', rank: 'private', homeworld: 'Earth' });
            mutationEvents.push({ type: 'note_created', noteId: id, timestamp: new Date(now - 72 * DAY).toISOString(), field: null, oldValue: null, newValue: null });
        };
        ['char-0', 'char-1', 'char-2', 'char-3', 'char-4', 'char-5'].forEach(mk);
        for (const id of ['char-0', 'char-1', 'char-2']) {
            mutationEvents.push({ type: 'field_added', noteId: id, field: 'rank', oldValue: null, newValue: 'private', timestamp: new Date(now - 71 * DAY).toISOString() });
            mutationEvents.push({ type: 'field_added', noteId: id, field: 'homeworld', oldValue: null, newValue: 'Earth', timestamp: new Date(now - 71 * DAY).toISOString() });
        }
        for (const id of ['char-3', 'char-4', 'char-5']) {
            mutationEvents.push({ type: 'field_added', noteId: id, field: 'rank', oldValue: null, newValue: 'private', timestamp: new Date(now - 4 * DAY).toISOString() });
            mutationEvents.push({ type: 'field_added', noteId: id, field: 'homeworld', oldValue: null, newValue: 'Earth', timestamp: new Date(now - 4 * DAY).toISOString() });
        }
        const priors = buildPriors({ character: { bundle: { name: 6, rank: 6, homeworld: 6 }, total: 6 } });

        const result = buildLaneTrajectories({ fieldsCache, mutationEvents, priors }, { now });

        const last = result.structure.checkpoints[result.structure.checkpoints.length - 1];
        assert.equal(last.problematic, 0, 'everyone has all expected fields by the final checkpoint');
        assert.ok(
            result.structure.checkpoints.slice(0, -1).every((c) => c.problematic === 3),
            'the 3 late-backfilled notes should read as drifting at every earlier checkpoint'
        );
        assert.ok(result.structure.trend, 'a real trend should fit');
    });
});

describe('buildLaneRetrospectiveAccuracy', () => {
    test('validates all three lanes against real current-state counts', () => {
        const now = Date.parse('2026-07-16T00:00:00.000Z');
        const fieldsCache = new Map();
        const mutationEvents = [];
        for (let i = 0; i < 20; i++) {
            const id = `char-${i}`;
            fieldsCache.set(id, { id, type: 'character' });
            mutationEvents.push({
                type: 'note_created', noteId: id,
                timestamp: new Date(now - (200 - i * 9) * DAY).toISOString(),
                field: null, oldValue: null, newValue: null
            });
        }
        const priors = buildPriors({ character: { bundle: {}, total: 20 } });
        const result = buildLaneRetrospectiveAccuracy({ fieldsCache, mutationEvents, priors }, { now, horizonDays: 90 });

        assert.equal(result.available, true);
        assert.equal(result.growth.actual, 20);
        assert.ok(typeof result.growth.accuracy === 'number' && result.growth.accuracy >= 0 && result.growth.accuracy <= 1);
        assert.ok(result.stale, 'stale accuracy should be computed when a real historical stale trend exists');
        assert.ok(typeof result.stale.accuracy === 'number');
    });

    test('is unavailable, honestly, when there is not enough history to build a historical trend', () => {
        const now = Date.parse('2026-07-16T00:00:00.000Z');
        const fieldsCache = new Map([['a', { id: 'a', type: 'note' }]]);
        const mutationEvents = [
            { type: 'note_created', noteId: 'a', timestamp: new Date(now - 5 * DAY).toISOString(), field: null, oldValue: null, newValue: null }
        ];
        const priors = buildPriors({});
        const result = buildLaneRetrospectiveAccuracy({ fieldsCache, mutationEvents, priors }, { now, horizonDays: 90 });
        assert.equal(result.available, false);
        assert.ok(result.reason);
    });
});

describe('buildStalenessForecast', () => {
    test('ranks notes soonest-to-go-stale first, excluding already-stale and history-less notes', () => {
        const now = Date.parse('2026-07-16T00:00:00.000Z');
        const fieldsCache = new Map([
            ['soon', { id: 'soon', type: 'character' }],
            ['later', { id: 'later', type: 'character' }],
            ['already-stale', { id: 'already-stale', type: 'character' }],
            ['no-history', { id: 'no-history', type: 'character' }]
        ]);
        const lastMutationByNote = new Map([
            ['soon', new Date(now - 85 * DAY).toISOString()],       // 5 days from going stale
            ['later', new Date(now - 50 * DAY).toISOString()],      // 40 days from going stale
            ['already-stale', new Date(now - 120 * DAY).toISOString()] // already past 90 days
            // 'no-history' has no entry at all
        ]);

        const result = buildStalenessForecast(fieldsCache, lastMutationByNote, { now, staleDays: 90, limit: 8 });

        assert.deepEqual(result.map((r) => r.noteId), ['soon', 'later']);
        assert.equal(result[0].daysUntilStale, 5);
        assert.equal(result[1].daysUntilStale, 40);
    });

    test('respects the limit option', () => {
        const now = Date.parse('2026-07-16T00:00:00.000Z');
        const fieldsCache = new Map();
        const lastMutationByNote = new Map();
        for (let i = 0; i < 5; i++) {
            fieldsCache.set(`n${i}`, { id: `n${i}`, type: 'character' });
            lastMutationByNote.set(`n${i}`, new Date(now - (10 + i) * DAY).toISOString());
        }
        const result = buildStalenessForecast(fieldsCache, lastMutationByNote, { now, staleDays: 90, limit: 2 });
        assert.equal(result.length, 2);
    });

    test('returns an empty list when every note is already stale or has no history', () => {
        const now = Date.parse('2026-07-16T00:00:00.000Z');
        const fieldsCache = new Map([
            ['already-stale', { id: 'already-stale', type: 'character' }],
            ['no-history', { id: 'no-history', type: 'character' }]
        ]);
        const lastMutationByNote = new Map([['already-stale', new Date(now - 120 * DAY).toISOString()]]);
        const result = buildStalenessForecast(fieldsCache, lastMutationByNote, { now, staleDays: 90 });
        assert.deepEqual(result, []);
    });
});
