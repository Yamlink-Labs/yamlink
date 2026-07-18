'use strict';

const { reconstructVaultAtTime } = require('../core/timeEngine');
const { computeVaultDrift } = require('./driftDetector');

// Types that are structural (schema/template/dashboard notes), not real vault
// content — excluded from growth counts the same way healthStats.js excludes
// them from its own type tallies.
const SYSTEM_TYPES = new Set(['schema', 'dashboard', 'template']);

/**
 * Vault Projections — Phase 1 of the 2026-07-13 rebuild.
 *
 * Replaces the old model (a rolling 4-week mutation-log window fed into a
 * single `currentRate * 90` multiplier, with a hand-tuned "evidence score"
 * standing in for real confidence) with real trend-fitting over real
 * historical data. The Time Engine (`reconstructVaultAtTime`) makes this
 * possible: instead of inferring growth from recent event *volume*, we can
 * reconstruct the vault's actual size at real past timestamps and fit an
 * honest line through real points.
 *
 * Known, deliberate limitation carried over from the Time Engine itself: a
 * note with zero mutation history (predates the log, or was imported without
 * git-history backfill) reconstructs identically at every checkpoint — its
 * current fields, unconditionally — because there is nothing recorded to
 * undo. If such a note was actually created partway through the trajectory
 * window, it will read as having existed the whole time, inflating early
 * checkpoints. `notesWithoutHistory` on the result reports how many notes
 * this applies to, so a caller can surface the caveat rather than silently
 * trusting an inflated early trend.
 */

/**
 * Ordinary least-squares linear regression through real (x, y) points.
 * @param {Array<{x: number, y: number}>} points
 * @returns {{slope: number, intercept: number, r2: number}|null} null if fewer than 2 points or all points share one x value
 */
function fitLinearTrend(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const n = points.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (const p of points) {
        sumX += p.x;
        sumY += p.y;
        sumXY += p.x * p.y;
        sumXX += p.x * p.x;
    }
    const denom = (n * sumXX) - (sumX * sumX);
    if (denom === 0) return null;
    const slope = ((n * sumXY) - (sumX * sumY)) / denom;
    const intercept = (sumY - (slope * sumX)) / n;

    const meanY = sumY / n;
    let ssRes = 0;
    let ssTot = 0;
    for (const p of points) {
        const predicted = (slope * p.x) + intercept;
        ssRes += (p.y - predicted) ** 2;
        ssTot += (p.y - meanY) ** 2;
    }
    // R² — how well the fitted line actually explains the real data. A flat
    // vault (ssTot === 0) is a perfect fit only if the residuals are also
    // zero; otherwise there's no meaningful "% explained" to report.
    const r2 = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : Math.max(0, 1 - (ssRes / ssTot));
    return { slope, intercept, r2 };
}

/**
 * @param {Array<{timestamp?: string}>} mutationEvents
 * @returns {string|null}
 */
function earliestEventTimestamp(mutationEvents) {
    let earliest = null;
    for (const event of mutationEvents || []) {
        if (!event || !event.timestamp) continue;
        if (earliest === null || event.timestamp < earliest) earliest = event.timestamp;
    }
    return earliest;
}

function countNotesWithoutHistory(fieldsCache, mutationEvents) {
    const touchedIds = new Set();
    for (const event of mutationEvents || []) {
        if (event && event.noteId) touchedIds.add(event.noteId);
    }
    let count = 0;
    for (const id of fieldsCache.keys()) {
        if (!touchedIds.has(id)) count += 1;
    }
    return count;
}

/**
 * @typedef {{ insufficientHistory: false, usableTimestamps: string[], snapshotTimestampSet: Set<string>, snapshotCheckpointCount: number, earliestReconstructableTimestamp: string|null }} UsableCheckpointSelection
 */

/**
 * Shared checkpoint-timestamp selection, extracted so `buildVaultTrajectory`
 * (growth only) and `buildLaneTrajectories` (growth + stale + structure)
 * pick the exact same real checkpoints without duplicating this logic.
 * Pure refactor of what `buildVaultTrajectory` always did inline — no
 * behavior change for existing callers.
 * @param {Array} mutationEvents
 * @param {Array<{timestamp: string}>} availableSnapshots
 * @param {{checkpoints?: number, spacingDays?: number, now?: number}} options
 * @returns {{insufficientHistory: true, reason: string, earliestReconstructableTimestamp?: string|null}
 *   | {insufficientHistory: false, usableTimestamps: string[], snapshotTimestampSet: Set<string>, snapshotCheckpointCount: number, earliestReconstructableTimestamp: string|null}}
 */
function _selectCheckpointTimestamps(mutationEvents, availableSnapshots, options = {}) {
    const checkpointCount = options.checkpoints || 12;
    const spacingDays = options.spacingDays || 7;
    const now = options.now || Date.now();

    const earliest = earliestEventTimestamp(mutationEvents);
    if (!earliest && !availableSnapshots.length) {
        return { insufficientHistory: true, reason: 'no-mutation-history' };
    }

    // Requested checkpoints, oldest first, ending at "now". Any checkpoint
    // older than the earliest real event is dropped rather than
    // extrapolated — honest bound, matching the Time Engine's own
    // completeness discipline.
    const requested = [];
    for (let i = checkpointCount - 1; i >= 0; i--) {
        requested.push(now - (i * spacingDays * 86400000));
    }
    const liveUsableIso = earliest
        ? requested.filter((ts) => new Date(ts).toISOString() >= earliest).map((ts) => new Date(ts).toISOString())
        : [];

    // Real snapshot timestamps older than the live window's own reach extend
    // the trajectory further back — exact recorded checkpoints, not
    // synthesized dates. Never duplicates an era the live deltas already
    // cover.
    const liveFloor = liveUsableIso.length ? liveUsableIso[0] : earliest;
    const snapshotIso = availableSnapshots
        .map((s) => s.timestamp)
        .filter((ts) => !liveFloor || ts < liveFloor);

    const usableTimestamps = [...new Set([...snapshotIso, ...liveUsableIso])].sort();
    // The earliest point genuinely reconstructable at all — not just the
    // earliest of the *usable checkpoint candidates* above, which can be
    // misleadingly late when too few candidates survive the spacing filter.
    // A snapshot older than the earliest live event pushes this back further.
    const earliestReconstructable = snapshotIso.length && (!earliest || snapshotIso[0] < earliest)
        ? snapshotIso[0]
        : earliest;

    if (usableTimestamps.length < 2) {
        return {
            insufficientHistory: true,
            reason: 'not-enough-history',
            earliestReconstructableTimestamp: earliestReconstructable
        };
    }

    return {
        insufficientHistory: false,
        usableTimestamps,
        snapshotTimestampSet: new Set(snapshotIso),
        snapshotCheckpointCount: snapshotIso.length,
        earliestReconstructableTimestamp: earliestReconstructable
    };
}

/**
 * Binary search: the last timestamp in a sorted-ascending array that is
 * <= targetMs, or null if none qualifies (no recorded event yet at that
 * point in time).
 * @param {number[]|undefined} sortedTimestamps
 * @param {number} targetMs
 * @returns {number|null}
 */
function _lastAtOrBefore(sortedTimestamps, targetMs) {
    if (!sortedTimestamps || !sortedTimestamps.length) return null;
    let lo = 0, hi = sortedTimestamps.length - 1, result = null;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sortedTimestamps[mid] <= targetMs) {
            result = sortedTimestamps[mid];
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return result;
}

/**
 * Every note's mutation-event timestamps, sorted ascending, grouped by
 * noteId — built once per trajectory call so per-checkpoint "was this note
 * stale as of this point" lookups are a cheap binary search, not a rescan
 * of the whole event log per note per checkpoint.
 * @param {Array<{noteId?: string, timestamp?: string}>} mutationEvents
 * @returns {Map<string, number[]>}
 */
function _groupSortedEventTimestampsByNote(mutationEvents) {
    const map = new Map();
    for (const event of mutationEvents || []) {
        if (!event || !event.noteId || !event.timestamp) continue;
        const ts = Date.parse(event.timestamp);
        if (Number.isNaN(ts)) continue;
        if (!map.has(event.noteId)) map.set(event.noteId, []);
        map.get(event.noteId).push(ts);
    }
    for (const arr of map.values()) arr.sort((a, b) => a - b);
    return map;
}

/**
 * Builds a real historical trajectory for vault size (overall + per type)
 * from actual reconstructed checkpoints, then fits an honest linear trend
 * through them.
 *
 * `snapshots` (from `mutationEventLog.js`'s `getVaultSnapshots()`, see
 * docs/architecture/TIME-ENGINE.md §4.1) extends how far back real
 * checkpoints can reach once the live mutation-log window runs out. A
 * snapshot only answers "the vault's exact state at its own recorded
 * timestamp" — no interpolation — so snapshot timestamps are used as
 * additional real checkpoints in their own right (evenly-spaced synthetic
 * dates would almost never land exactly on one), not as a way to extend the
 * evenly-spaced live-window candidates further back. Checkpoints therefore
 * stop being perfectly evenly spaced once snapshots are involved — that's
 * honest: real retained history, not fabricated regularity.
 *
 * @param {{fieldsCache: Map<string, Record<string, any>>, mutationEvents: Array, snapshots?: Array<{timestamp: string, notes: Record<string, any>}>}} context
 * @param {{checkpoints?: number, spacingDays?: number, horizonDays?: number, now?: number}} [options]
 * @returns {{
 *   insufficientHistory: boolean,
 *   reason?: string,
 *   earliestReconstructableTimestamp?: string|null,
 *   windowDays?: number,
 *   horizonDays?: number,
 *   notesWithoutHistory?: number,
 *   snapshotCheckpointCount?: number,
 *   checkpoints: Array<{timestamp: string, daysAgo: number, total: number, byType: Record<string, number>, fromSnapshot?: boolean}>,
 *   overall: {slope: number, r2: number, current: number, projected: number}|null,
 *   byType: Record<string, {slope: number, r2: number, current: number, projected: number}>
 * }}
 */
function buildVaultTrajectory({ fieldsCache, mutationEvents, snapshots }, options = {}) {
    const horizonDays = options.horizonDays || 90;
    const now = options.now || Date.now();
    const availableSnapshots = snapshots || [];

    const selection = _selectCheckpointTimestamps(mutationEvents, availableSnapshots, options);
    if (selection.insufficientHistory) {
        return {
            insufficientHistory: true,
            reason: selection.reason,
            ...(selection.earliestReconstructableTimestamp !== undefined
                ? { earliestReconstructableTimestamp: selection.earliestReconstructableTimestamp }
                : {}),
            checkpoints: [],
            overall: null,
            byType: {}
        };
    }

    // The early return above proves insufficientHistory is false here.
    const { usableTimestamps, snapshotTimestampSet, earliestReconstructableTimestamp, snapshotCheckpointCount } =
        /** @type {UsableCheckpointSelection} */ (selection);
    const checkpoints = usableTimestamps.map((isoTs) => {
        const ts = Date.parse(isoTs);
        const reconstructed = reconstructVaultAtTime(isoTs, { fieldsCache, mutationEvents, snapshots: availableSnapshots });
        const byType = new Map();
        let total = 0;
        for (const [, entry] of reconstructed) {
            if (!entry.exists || !entry.fields) continue;
            const type = String(entry.fields.type || '').trim().toLowerCase();
            if (!type || SYSTEM_TYPES.has(type)) continue;
            total += 1;
            byType.set(type, (byType.get(type) || 0) + 1);
        }
        return {
            timestamp: isoTs,
            daysAgo: Math.round((now - ts) / 86400000),
            total,
            byType: Object.fromEntries(byType),
            ...(snapshotTimestampSet.has(isoTs) ? { fromSnapshot: true } : {})
        };
    });

    // x-axis: days since the oldest usable checkpoint, so "today" always
    // lands at a real, computable x rather than an arbitrary origin.
    const dayZero = checkpoints[0].daysAgo;
    const toX = (daysAgo) => dayZero - daysAgo;
    const nowX = toX(0);

    const fitSeries = (getValue) => {
        const points = checkpoints.map((c) => ({ x: toX(c.daysAgo), y: getValue(c) }));
        const fit = fitLinearTrend(points);
        if (!fit) return null;
        return {
            slope: Number(fit.slope.toFixed(4)),
            r2: Number(fit.r2.toFixed(3)),
            current: getValue(checkpoints[checkpoints.length - 1]),
            projected: Math.max(0, Math.round((fit.slope * (nowX + horizonDays)) + fit.intercept))
        };
    };

    const overall = fitSeries((c) => c.total);

    const allTypes = new Set();
    for (const c of checkpoints) {
        for (const type of Object.keys(c.byType)) allTypes.add(type);
    }
    /** @type {Record<string, {slope: number, r2: number, current: number, projected: number}>} */
    const byType = {};
    for (const type of allTypes) {
        const fit = fitSeries((c) => c.byType[type] || 0);
        if (fit) byType[type] = fit;
    }

    return {
        insufficientHistory: false,
        earliestReconstructableTimestamp,
        windowDays: checkpoints[0].daysAgo,
        horizonDays,
        notesWithoutHistory: countNotesWithoutHistory(fieldsCache, mutationEvents),
        snapshotCheckpointCount,
        checkpoints,
        overall,
        byType
    };
}

const DEFAULT_STALE_DAYS = 90;

/**
 * Phase 3 — Growth, Stale, and Structure all need reconstructed vault state
 * at the same checkpoints, and `reconstructVaultAtTime()` (whole-vault) is
 * the expensive part of a trajectory build, not the tallying done at each
 * checkpoint. Running three independent checkpoint sweeps (as three separate
 * `buildVaultTrajectory`-style functions would) would triple that cost for
 * no reason. This does one reconstruction per checkpoint and tallies all
 * three metrics from it.
 *
 * `growth` mirrors `buildVaultTrajectory`'s exact return shape, so callers
 * that already consume it can switch to `buildLaneTrajectories(...).growth`
 * with no other changes.
 *
 * `stale`: a note counts as stale-as-of-checkpoint when its last recorded
 * mutation event at-or-before that checkpoint is more than `staleDays` old.
 * A note with no recorded event before a checkpoint it otherwise exists at
 * is excluded from that checkpoint's tally rather than guessed at — the
 * same honest-uncertainty convention `notesWithoutHistory` already uses.
 *
 * `structure`: reuses `driftDetector.js`'s `computeVaultDrift()` directly
 * against each checkpoint's reconstructed fields, scored against the
 * vault's CURRENT priors (passed in once, never recomputed per checkpoint —
 * historical priors don't exist). This answers "how well did this note
 * match what we know TODAY about its type, at that point in its history,"
 * not a fully historical model of the vault's evolving norms.
 *
 * @param {{fieldsCache: Map<string, Record<string, any>>, mutationEvents: Array, snapshots?: Array, priors: object}} context
 *   `priors` is the vault's current statistical priors (`vaultPriors.js`'s
 *   `getCachedPriors()` result) — must include `typeFieldBundles` and
 *   `typeBundleTotals` for `computeVaultDrift` to stay O(notes) per checkpoint.
 * @param {{checkpoints?: number, spacingDays?: number, horizonDays?: number, staleDays?: number, now?: number}} [options]
 * @returns {{
 *   insufficientHistory: boolean,
 *   reason?: string,
 *   earliestReconstructableTimestamp?: string|null,
 *   growth: object,
 *   stale: {checkpoints: Array<{timestamp: string, daysAgo: number, staleCount: number, eligible: number}>, trend: {slope: number, r2: number, current: number, projected: number}|null}|null,
 *   structure: {checkpoints: Array<{timestamp: string, daysAgo: number, problematic: number, sampled: number}>, trend: {slope: number, r2: number, current: number, projected: number}|null}|null
 * }}
 */
function buildLaneTrajectories({ fieldsCache, mutationEvents, snapshots, priors }, options = {}) {
    const horizonDays = options.horizonDays || 90;
    const staleDays = options.staleDays || DEFAULT_STALE_DAYS;
    const now = options.now || Date.now();
    const availableSnapshots = snapshots || [];

    const selection = _selectCheckpointTimestamps(mutationEvents, availableSnapshots, options);
    if (selection.insufficientHistory) {
        return {
            insufficientHistory: true,
            reason: selection.reason,
            ...(selection.earliestReconstructableTimestamp !== undefined
                ? { earliestReconstructableTimestamp: selection.earliestReconstructableTimestamp }
                : {}),
            growth: { insufficientHistory: true, reason: selection.reason, checkpoints: [], overall: null, byType: {} },
            stale: null,
            structure: null
        };
    }

    // The early return above proves insufficientHistory is false here.
    const { usableTimestamps, snapshotTimestampSet, earliestReconstructableTimestamp, snapshotCheckpointCount } =
        /** @type {UsableCheckpointSelection} */ (selection);
    const eventTimestampsByNote = _groupSortedEventTimestampsByNote(mutationEvents);

    const growthCheckpoints = [];
    const staleCheckpoints = [];
    const structureCheckpoints = [];

    for (const isoTs of usableTimestamps) {
        const ts = Date.parse(isoTs);
        const daysAgo = Math.round((now - ts) / 86400000);
        const fromSnapshot = snapshotTimestampSet.has(isoTs) ? { fromSnapshot: true } : {};
        const reconstructed = reconstructVaultAtTime(isoTs, { fieldsCache, mutationEvents, snapshots: availableSnapshots });

        const byType = new Map();
        let total = 0;
        let staleCount = 0;
        let staleEligible = 0;
        const reconstructedFieldsById = new Map();

        for (const [id, entry] of reconstructed) {
            if (!entry.exists || !entry.fields) continue;

            const type = String(entry.fields.type || '').trim().toLowerCase();
            if (type && !SYSTEM_TYPES.has(type)) {
                total += 1;
                byType.set(type, (byType.get(type) || 0) + 1);
            }

            const lastAtOrBefore = _lastAtOrBefore(eventTimestampsByNote.get(id), ts);
            if (lastAtOrBefore !== null) {
                staleEligible += 1;
                if ((ts - lastAtOrBefore) > staleDays * 86400000) staleCount += 1;
            }

            reconstructedFieldsById.set(id, entry.fields);
        }

        growthCheckpoints.push({ timestamp: isoTs, daysAgo, total, byType: Object.fromEntries(byType), ...fromSnapshot });
        staleCheckpoints.push({ timestamp: isoTs, daysAgo, staleCount, eligible: staleEligible, ...fromSnapshot });

        const drift = computeVaultDrift(reconstructedFieldsById, priors);
        const problematic = drift.filter((d) => d.driftLabel === 'drifting' || d.driftLabel === 'outlier').length;
        structureCheckpoints.push({ timestamp: isoTs, daysAgo, problematic, sampled: drift.length, ...fromSnapshot });
    }

    const dayZero = growthCheckpoints[0].daysAgo;
    const toX = (daysAgo) => dayZero - daysAgo;
    const nowX = toX(0);

    const fitFrom = (checkpoints, getValue) => {
        const points = checkpoints.map((c) => ({ x: toX(c.daysAgo), y: getValue(c) }));
        const fit = fitLinearTrend(points);
        if (!fit) return null;
        return {
            slope: Number(fit.slope.toFixed(4)),
            r2: Number(fit.r2.toFixed(3)),
            current: getValue(checkpoints[checkpoints.length - 1]),
            projected: Math.max(0, Math.round((fit.slope * (nowX + horizonDays)) + fit.intercept))
        };
    };

    const overall = fitFrom(growthCheckpoints, (c) => c.total);
    const allTypes = new Set();
    for (const c of growthCheckpoints) {
        for (const type of Object.keys(c.byType)) allTypes.add(type);
    }
    const byType = {};
    for (const type of allTypes) {
        const fit = fitFrom(growthCheckpoints, (c) => c.byType[type] || 0);
        if (fit) byType[type] = fit;
    }

    return {
        insufficientHistory: false,
        earliestReconstructableTimestamp,
        growth: {
            insufficientHistory: false,
            earliestReconstructableTimestamp,
            windowDays: dayZero,
            horizonDays,
            notesWithoutHistory: countNotesWithoutHistory(fieldsCache, mutationEvents),
            snapshotCheckpointCount,
            checkpoints: growthCheckpoints,
            overall,
            byType
        },
        stale: {
            checkpoints: staleCheckpoints,
            trend: fitFrom(staleCheckpoints, (c) => c.staleCount)
        },
        structure: {
            checkpoints: structureCheckpoints,
            trend: fitFrom(structureCheckpoints, (c) => c.problematic)
        }
    };
}

/**
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {{total: number, byType: Record<string, number>}}
 */
function tallyLiveCounts(fieldsCache) {
    const byType = new Map();
    let total = 0;
    for (const [, fields] of fieldsCache) {
        const type = String(fields?.type || '').trim().toLowerCase();
        if (!type || SYSTEM_TYPES.has(type)) continue;
        total += 1;
        byType.set(type, (byType.get(type) || 0) + 1);
    }
    return { total, byType: Object.fromEntries(byType) };
}

/**
 * Symmetric accuracy score in [0, 1]: 1 means the projection exactly matched
 * reality, 0 means the miss was at least as large as the bigger of the two
 * numbers. Clamped rather than allowed to go negative — a wildly wrong
 * projection should read as "0% accurate," not a nonsensical negative score.
 * @param {number} projected
 * @param {number} actual
 * @returns {number}
 */
function computeAccuracy(projected, actual) {
    if (actual === 0 && projected === 0) return 1;
    const denom = Math.max(actual, projected, 1);
    const error = Math.abs(projected - actual) / denom;
    return Math.max(0, Number((1 - error).toFixed(3)));
}

/**
 * Phase 2 — retrospective accuracy scoring, the genuinely checkable claim
 * Phase 1 was built to support. Reconstructs the vault as it looked
 * `horizonDays` ago, runs the *exact same* trend-fit (`buildVaultTrajectory`)
 * on that reconstructed snapshot's own trailing history — i.e. what the
 * model would have projected for "today" back when it only had data up to
 * that past point — then compares that historical projection against what
 * actually happened, counted directly from the live vault.
 *
 * This only reuses `buildVaultTrajectory` with its `now` option pointed at
 * the past; no separate reconstruction/fitting logic exists here, so Phase 1
 * and Phase 2 can never silently drift apart into two different models.
 *
 * @param {{fieldsCache: Map<string, Record<string, any>>, mutationEvents: Array, snapshots?: Array<{timestamp: string, notes: Record<string, any>}>}} context
 * @param {{horizonDays?: number, checkpoints?: number, spacingDays?: number, now?: number}} [options]
 * @returns {{
 *   available: boolean,
 *   reason?: string,
 *   horizonDays?: number,
 *   projectedAsOf?: string,
 *   overall?: {projected: number, actual: number, accuracy: number},
 *   byType?: Record<string, {projected: number, actual: number, accuracy: number}>
 * }}
 */
function buildRetrospectiveAccuracy({ fieldsCache, mutationEvents, snapshots }, options = {}) {
    const horizonDays = options.horizonDays || 90;
    const now = options.now || Date.now();
    const pastNow = now - (horizonDays * 86400000);

    const historical = buildVaultTrajectory({ fieldsCache, mutationEvents, snapshots }, {
        now: pastNow,
        horizonDays,
        checkpoints: options.checkpoints || 12,
        spacingDays: options.spacingDays || 7
    });

    if (historical.insufficientHistory || !historical.overall) {
        return {
            available: false,
            reason: historical.reason || 'insufficient-history-at-that-point'
        };
    }

    const actualCounts = tallyLiveCounts(fieldsCache);
    const overall = {
        projected: historical.overall.projected,
        actual: actualCounts.total,
        accuracy: computeAccuracy(historical.overall.projected, actualCounts.total)
    };

    /** @type {Record<string, {projected: number, actual: number, accuracy: number}>} */
    const byType = {};
    for (const [type, hist] of Object.entries(historical.byType)) {
        const actual = actualCounts.byType[type] || 0;
        byType[type] = {
            projected: hist.projected,
            actual,
            accuracy: computeAccuracy(hist.projected, actual)
        };
    }

    return {
        available: true,
        horizonDays,
        projectedAsOf: new Date(pastNow).toISOString(),
        overall,
        byType
    };
}

/**
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {Array} mutationEvents
 * @param {number} staleDays
 * @param {number} now
 * @returns {number}
 */
function tallyLiveStaleCount(fieldsCache, mutationEvents, staleDays, now) {
    const eventTimestampsByNote = _groupSortedEventTimestampsByNote(mutationEvents);
    let count = 0;
    for (const id of fieldsCache.keys()) {
        const last = _lastAtOrBefore(eventTimestampsByNote.get(id), now);
        if (last !== null && (now - last) > staleDays * 86400000) count += 1;
    }
    return count;
}

/**
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {object} priors
 * @returns {number}
 */
function tallyLiveProblematicCount(fieldsCache, priors) {
    const drift = computeVaultDrift(fieldsCache, priors);
    return drift.filter((d) => d.driftLabel === 'drifting' || d.driftLabel === 'outlier').length;
}

/**
 * Retrospective accuracy for all three lanes at once — same cost-sharing
 * reasoning as `buildLaneTrajectories`: one historical sweep instead of
 * three. Mirrors `buildRetrospectiveAccuracy`'s pattern exactly (re-run the
 * trajectory build with `now` pointed `horizonDays` in the past, compare its
 * projection-for-today against what actually happened).
 *
 * @param {{fieldsCache: Map<string, Record<string, any>>, mutationEvents: Array, snapshots?: Array, priors: object}} context
 * @param {{horizonDays?: number, staleDays?: number, checkpoints?: number, spacingDays?: number, now?: number}} [options]
 * @returns {{
 *   available: boolean,
 *   reason?: string,
 *   horizonDays?: number,
 *   projectedAsOf?: string,
 *   growth?: {projected: number, actual: number, accuracy: number},
 *   stale?: {projected: number, actual: number, accuracy: number}|null,
 *   structure?: {projected: number, actual: number, accuracy: number}|null
 * }}
 */
function buildLaneRetrospectiveAccuracy({ fieldsCache, mutationEvents, snapshots, priors }, options = {}) {
    const horizonDays = options.horizonDays || 90;
    const staleDays = options.staleDays || DEFAULT_STALE_DAYS;
    const now = options.now || Date.now();
    const pastNow = now - (horizonDays * 86400000);

    const historical = buildLaneTrajectories({ fieldsCache, mutationEvents, snapshots, priors }, {
        now: pastNow,
        horizonDays,
        staleDays,
        checkpoints: options.checkpoints || 12,
        spacingDays: options.spacingDays || 7
    });

    if (historical.insufficientHistory || !historical.growth.overall) {
        return {
            available: false,
            reason: historical.reason || 'insufficient-history-at-that-point'
        };
    }

    const actualCounts = tallyLiveCounts(fieldsCache);
    const growth = {
        projected: historical.growth.overall.projected,
        actual: actualCounts.total,
        accuracy: computeAccuracy(historical.growth.overall.projected, actualCounts.total)
    };

    const staleActual = tallyLiveStaleCount(fieldsCache, mutationEvents, staleDays, now);
    const stale = historical.stale?.trend ? {
        projected: historical.stale.trend.projected,
        actual: staleActual,
        accuracy: computeAccuracy(historical.stale.trend.projected, staleActual)
    } : null;

    const structureActual = tallyLiveProblematicCount(fieldsCache, priors);
    const structure = historical.structure?.trend ? {
        projected: historical.structure.trend.projected,
        actual: structureActual,
        accuracy: computeAccuracy(historical.structure.trend.projected, structureActual)
    } : null;

    return {
        available: true,
        horizonDays,
        projectedAsOf: new Date(pastNow).toISOString(),
        growth,
        stale,
        structure
    };
}

/**
 * Phase 4 — which specific notes will cross into stale in the next N days,
 * ranked soonest-first. Pure current-state calculation, no reconstruction
 * needed: staleness only ever depends on time-since-last-touch, so this is
 * a plain sort, not a trend fit.
 *
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {Map<string, string>} lastMutationByNote  noteId -> ISO timestamp of its most recent mutation event
 * @param {{staleDays?: number, limit?: number, now?: number}} [options]
 * @returns {Array<{noteId: string, type: string|null, daysUntilStale: number}>}
 */
function buildStalenessForecast(fieldsCache, lastMutationByNote, options = {}) {
    const staleDays = options.staleDays || DEFAULT_STALE_DAYS;
    const limit = options.limit || 8;
    const now = options.now || Date.now();

    const upcoming = [];
    for (const [id, fields] of fieldsCache) {
        const type = String(fields?.type || '').trim().toLowerCase();
        if (type && SYSTEM_TYPES.has(type)) continue;

        const lastIso = lastMutationByNote.get(id);
        if (!lastIso) continue; // no recorded history — honest exclusion, not a guess

        const lastMs = Date.parse(lastIso);
        if (Number.isNaN(lastMs)) continue;

        const daysSinceTouch = (now - lastMs) / 86400000;
        const daysUntilStale = staleDays - daysSinceTouch;
        if (daysUntilStale <= 0) continue; // already stale, not "approaching"

        upcoming.push({ noteId: id, type: type || null, daysUntilStale: Math.round(daysUntilStale) });
    }

    upcoming.sort((a, b) => a.daysUntilStale - b.daysUntilStale || a.noteId.localeCompare(b.noteId));
    return upcoming.slice(0, limit);
}

module.exports = {
    buildVaultTrajectory,
    fitLinearTrend,
    buildRetrospectiveAccuracy,
    buildLaneTrajectories,
    buildLaneRetrospectiveAccuracy,
    buildStalenessForecast
};
