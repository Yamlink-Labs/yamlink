'use strict';

const fs = require('fs');
const path = require('path');
const { reconstructVaultAtTime } = require('../core/timeEngine');
const { appendVaultSnapshot, loadVaultSnapshots } = require('../core/vaultSnapshots');

/**
 * @typedef {{
 *   timestamp: string,
 *   type: string,
 *   noteId: string,
 *   field: string|null,
 *   oldValue: *,
 *   newValue: *,
 *   source?: string|null,
 *   cause?: string|null,
 *   sessionId?: string|null,
 *   meta?: object
 * }} MutationEvent
 */

// Outcome event types — user feedback on system predictions and authoring assists.
const OUTCOME_EVENT_TYPES = new Set([
    'completion_accepted',
    'lightbulb_applied',
    'suggestion_ignored',
    'template_applied',
    'template_fields_filled',
    'block_reference_created'
]);

const MAX_EVENTS = 10000;
// How far past MAX_EVENTS truncation trims back down to, and therefore how
// many events accumulate between snapshots. See _snapshotAndTruncate().
const SNAPSHOT_INTERVAL = 2000;
let _events = [];
let _logPath = null;
let _snapshotPath = null;
let _defaultContextProvider = null;
let _snapshotFieldsCacheProvider = null;

/**
 * Registers a function returning the vault's current fieldsCache (Map<noteId,
 * fields>), called lazily only when a snapshot is actually about to be taken
 * (see _snapshotAndTruncate) — never during normal appends. Each surface
 * that calls initMutationLog() (extension.js, cli/index.js) should also call
 * this once, since mutationEventLog.js has no access to the live index
 * otherwise. Snapshotting is silently skipped if no provider is registered.
 * @param {(() => Map<string, Record<string, any>>)|null} provider
 * @returns {void}
 */
function setSnapshotFieldsCacheProvider(provider) {
    _snapshotFieldsCacheProvider = typeof provider === 'function' ? provider : null;
}

/**
 * @param {string|null} logPath Absolute path for the NDJSON log file, or null to disable persistence.
 * @returns {void}
 */
function initMutationLog(logPath) {
    _logPath = logPath || null;
    _snapshotPath = _logPath ? path.join(path.dirname(_logPath), 'vault-snapshots.ndjson') : null;
    _events = [];
    if (!_logPath) return;

    try {
        fs.mkdirSync(path.dirname(_logPath), { recursive: true });
    } catch (_) {}

    if (!fs.existsSync(_logPath)) return;

    try {
        const lines = fs.readFileSync(_logPath, 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
            try { _events.push(JSON.parse(line)); } catch (_) {}
        }
        // Plain truncation, deliberately not _snapshotAndTruncate() — this
        // runs at process startup, before the vault index exists, so there
        // is no live fieldsCache to reconstruct a snapshot from yet. Only
        // reachable at all if a log file already exceeded MAX_EVENTS before
        // this process started (e.g. carried over from a version predating
        // the cap); the normal snapshot path is _snapshotAndTruncate(),
        // triggered from appendMutationEvents() once the vault is live.
        if (_events.length > MAX_EVENTS) {
            _events = _events.slice(_events.length - MAX_EVENTS);
            _rewriteLog();
        }
    } catch (_) {}
}

function _rewriteLog() {
    if (!_logPath) return;
    try {
        fs.writeFileSync(_logPath, _events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    } catch (_) {}
}

function _isDuplicate(event) {
    if (!_events.length) return false;
    const last = _events[_events.length - 1];
    if (last.type !== event.type || last.noteId !== event.noteId || last.field !== event.field) return false;
    if (String(last.newValue) !== String(event.newValue)) return false;
    return (new Date(event.timestamp).getTime() - new Date(last.timestamp).getTime()) < 3000;
}

function _getDefaultContext() {
    if (typeof _defaultContextProvider !== 'function') return {};
    try {
        const context = _defaultContextProvider();
        return context && typeof context === 'object' ? context : {};
    } catch (_) {
        return {};
    }
}

/**
 * Apply shared source/cause/session metadata to a batch of mutation events.
 * Existing per-event values win over the provided context.
 *
 * @param {Partial<MutationEvent>[]} events
 * @param {{ source?: string|null, cause?: string|null, sessionId?: string|null, meta?: object|null }} context
 * @returns {Partial<MutationEvent>[]}
 */
function withMutationContext(events = [], context = {}) {
    return (events || []).map((event) => {
        if (!event || typeof event !== 'object') return event;
        const defaults = _getDefaultContext();
        const mergedMeta = {
            ...(defaults.meta && typeof defaults.meta === 'object' ? defaults.meta : {}),
            ...(context.meta && typeof context.meta === 'object' ? context.meta : {}),
            ...(event.meta && typeof event.meta === 'object' ? event.meta : {})
        };
        return {
            ...event,
            ...(event.source === undefined && context.source === undefined && defaults.source !== undefined ? { source: defaults.source } : {}),
            ...(event.cause === undefined && context.cause === undefined && defaults.cause !== undefined ? { cause: defaults.cause } : {}),
            ...(event.sessionId === undefined && context.sessionId === undefined && defaults.sessionId !== undefined ? { sessionId: defaults.sessionId } : {}),
            ...(event.source === undefined && context.source !== undefined ? { source: context.source } : {}),
            ...(event.cause === undefined && context.cause !== undefined ? { cause: context.cause } : {}),
            ...(event.sessionId === undefined && context.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
            ...(Object.keys(mergedMeta).length ? { meta: mergedMeta } : {})
        };
    });
}

/**
 * @param {Partial<MutationEvent>[]} events
 * @returns {void}
 */
// Listener registry — a lightweight, additive hook for cross-cutting
// concerns that need to react to *newly appended* events without owning the
// log themselves (e.g. the guided tour detecting "a real link was just
// created" to drive its own step-completion signal). Deliberately separate
// from the persisted log/duplicate-window logic above.
const _appendListeners = new Set();

/** @param {(events: MutationEvent[]) => void} callback @returns {() => void} unsubscribe */
function onMutationEventsAppended(callback) {
    if (typeof callback !== 'function') return () => {};
    _appendListeners.add(callback);
    return () => _appendListeners.delete(callback);
}

function appendMutationEvents(events = []) {
    const defaults = _getDefaultContext();
    const normalized = [];
    for (const event of events) {
        if (!event || !event.type || !event.noteId) continue;
        const mergedMeta = {
            ...(defaults.meta && typeof defaults.meta === 'object' ? defaults.meta : {}),
            ...(event.meta && typeof event.meta === 'object' ? event.meta : {})
        };
        const entry = {
            timestamp: event.timestamp || new Date().toISOString(),
            type: event.type,
            noteId: event.noteId,
            field: event.field ?? null,
            oldValue: event.oldValue ?? null,
            newValue: event.newValue ?? null,
            source: event.source ?? defaults.source ?? null,
            cause: event.cause ?? defaults.cause ?? null,
            sessionId: event.sessionId ?? defaults.sessionId ?? null,
            ...(Object.keys(mergedMeta).length ? { meta: mergedMeta } : {})
        };
        if (!_isDuplicate(entry)) normalized.push(entry);
    }
    if (!normalized.length) return;

    _events.push(...normalized);

    if (_events.length > MAX_EVENTS) {
        // Snapshot-then-truncate, not a blind slice — see _snapshotAndTruncate.
        // Also fixes a real pre-existing gap: the persisted file was never
        // rewritten to match the truncated in-memory array here (only on the
        // next initMutationLog() load), so during a single long-running
        // process the file grew unbounded even while _events stayed capped.
        _snapshotAndTruncate();
    } else if (_logPath) {
        try {
            fs.appendFileSync(_logPath, normalized.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
        } catch (_) {}
    }

    for (const listener of _appendListeners) {
        try { listener(normalized); } catch (_) { /* one bad listener must never break logging */ }
    }
}

/**
 * Runs once _events exceeds MAX_EVENTS. Trims back down to
 * MAX_EVENTS - SNAPSHOT_INTERVAL (not MAX_EVENTS) so this only fires again
 * once another SNAPSHOT_INTERVAL events accumulate — snapshotting on every
 * single append past the cap would mean reconstructing the whole vault's
 * state on every mutation, which is not viable. Before dropping the oldest
 * events, captures the vault's exact state at the boundary timestamp (via
 * the Time Engine) and persists it as a Time Engine snapshot, so that exact
 * moment remains reconstructable forever — see
 * docs/architecture/TIME-ENGINE.md for the full rationale and honesty
 * contract this provides (exact-boundary reconstruction only, no
 * interpolation between snapshots).
 * @returns {void}
 */
function _snapshotAndTruncate() {
    const targetLength = Math.max(0, MAX_EVENTS - SNAPSHOT_INTERVAL);
    const dropCount = _events.length - targetLength;
    if (dropCount > 0) {
        const boundaryEvent = _events[dropCount - 1];
        if (_snapshotPath && typeof _snapshotFieldsCacheProvider === 'function') {
            try {
                const fieldsCache = _snapshotFieldsCacheProvider();
                if (fieldsCache && typeof fieldsCache.keys === 'function') {
                    const reconstructed = reconstructVaultAtTime(boundaryEvent.timestamp, { fieldsCache, mutationEvents: _events });
                    /** @type {Record<string, Record<string, any>|null>} */
                    const notes = {};
                    for (const [noteId, entry] of reconstructed) {
                        if (entry.exists) notes[noteId] = entry.fields ?? null;
                    }
                    appendVaultSnapshot(_snapshotPath, boundaryEvent.timestamp, notes);
                }
            } catch (_) {}
        }
        _events = _events.slice(dropCount);
    }
    _rewriteLog();
}

/**
 * @param {{ noteId?: string, since?: string, until?: string, type?: string, limit?: number }} [options]
 * @returns {MutationEvent[]}
 */
function getMutationEvents(options = {}) {
    const { noteId, since, until, type, limit = MAX_EVENTS } = options;
    let result = _events;
    if (noteId) result = result.filter(e => e.noteId === noteId);
    if (since) result = result.filter(e => e.timestamp >= since);
    if (until) result = result.filter(e => e.timestamp <= until);
    if (type) result = result.filter(e => e.type === type);
    return result.slice(Math.max(0, result.length - limit));
}

/**
 * @param {string|null|undefined} sessionId
 * @returns {MutationEvent[]}
 */
function getSessionEvents(sessionId) {
    if (!sessionId) return [];
    return _events.filter((event) => event.sessionId === sessionId);
}

/**
 * Emit a single outcome event — user feedback on a system prediction.
 * Silently no-ops if the event type is not a recognised outcome type or if
 * required fields are missing.
 *
 * @param {{ type: string, noteId: string, field: string, newValue?: *, source?: string|null, cause?: string|null, sessionId?: string|null, meta?: object }} event
 * @returns {void}
 */
function emitOutcomeEvent(event) {
    if (!event || !OUTCOME_EVENT_TYPES.has(event.type)) return;
    if (!event.noteId || !event.field) return;
    appendMutationEvents([event]);
}

/** @returns {void} */
function clearMutationEvents() {
    _events = [];
    if (_logPath) {
        try { fs.writeFileSync(_logPath, '', 'utf8'); } catch (_) {}
    }
    if (_snapshotPath) {
        try { fs.writeFileSync(_snapshotPath, '', 'utf8'); } catch (_) {}
    }
}

/**
 * @returns {Array<{timestamp: string, notes: Record<string, any>}>} persisted Time Engine snapshots, sorted ascending
 */
function getVaultSnapshots() {
    return loadVaultSnapshots(_snapshotPath);
}

/**
 * Captures the current vault state as a Time Engine snapshot on demand.
 * @param {string|null|undefined} [reason]
 * @returns {{ timestamp: string, noteCount: number, snapshotPath: string|null, reason: string|null }}
 */
function createManualSnapshot(reason) {
    if (!_snapshotPath) {
        throw new Error('Mutation log is not initialized');
    }
    if (typeof _snapshotFieldsCacheProvider !== 'function') {
        throw new Error('Snapshot fields provider is not initialized');
    }

    const fieldsCache = _snapshotFieldsCacheProvider();
    if (!fieldsCache || typeof fieldsCache.entries !== 'function') {
        throw new Error('Snapshot fields provider did not return a fields cache');
    }

    const timestamp = new Date().toISOString();
    /** @type {Record<string, Record<string, any>|null>} */
    const notes = {};
    for (const [noteId, fields] of fieldsCache.entries()) {
        notes[noteId] = fields ? { ...fields } : null;
    }
    appendVaultSnapshot(_snapshotPath, timestamp, notes);
    return {
        timestamp,
        noteCount: Object.keys(notes).length,
        snapshotPath: _snapshotPath,
        reason: reason ? String(reason) : null
    };
}

function setDefaultMutationContextProvider(provider) {
    _defaultContextProvider = typeof provider === 'function' ? provider : null;
}

module.exports = {
    initMutationLog,
    appendMutationEvents,
    emitOutcomeEvent,
    getMutationEvents,
    getSessionEvents,
    getVaultSnapshots,
    clearMutationEvents,
    createManualSnapshot,
    withMutationContext,
    setDefaultMutationContextProvider,
    setSnapshotFieldsCacheProvider,
    onMutationEventsAppended,
    OUTCOME_EVENT_TYPES
};
