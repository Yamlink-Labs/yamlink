'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @typedef {{ timestamp: string, type: string, noteId: string, field: string|null, oldValue: *, newValue: *, meta?: object }} MutationEvent
 */

// Outcome event types — user feedback on system predictions.
const OUTCOME_EVENT_TYPES = new Set(['completion_accepted', 'lightbulb_applied']);

const MAX_EVENTS = 10000;
let _events = [];
let _logPath = null;

/**
 * @param {string|null} logPath Absolute path for the NDJSON log file, or null to disable persistence.
 * @returns {void}
 */
function initMutationLog(logPath) {
    _logPath = logPath || null;
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

/**
 * @param {Partial<MutationEvent>[]} events
 * @returns {void}
 */
function appendMutationEvents(events = []) {
    const normalized = [];
    for (const event of events) {
        if (!event || !event.type || !event.noteId) continue;
        const entry = {
            timestamp: event.timestamp || new Date().toISOString(),
            type: event.type,
            noteId: event.noteId,
            field: event.field ?? null,
            oldValue: event.oldValue ?? null,
            newValue: event.newValue ?? null,
            ...(event.meta && typeof event.meta === 'object' ? { meta: event.meta } : {})
        };
        if (!_isDuplicate(entry)) normalized.push(entry);
    }
    if (!normalized.length) return;

    _events.push(...normalized);
    if (_events.length > MAX_EVENTS) {
        _events = _events.slice(_events.length - MAX_EVENTS);
    }

    if (_logPath) {
        try {
            fs.appendFileSync(_logPath, normalized.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
        } catch (_) {}
    }
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
 * Emit a single outcome event — user feedback on a system prediction.
 * Silently no-ops if the event type is not a recognised outcome type or if
 * required fields are missing.
 *
 * @param {{ type: string, noteId: string, field: string, newValue?: *, meta?: object }} event
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
}

module.exports = {
    initMutationLog,
    appendMutationEvents,
    emitOutcomeEvent,
    getMutationEvents,
    clearMutationEvents
};
