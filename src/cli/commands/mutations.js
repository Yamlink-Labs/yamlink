'use strict';

const fmt = require('../format');
const { emitCliError, emitCliSuccess, emitText } = require('../io');
const { getMutationEvents } = require('../../runtime/mutationEventLog');

function run({ eventType, noteId, since, limit, json, quiet }) {
    const normalizedLimit = Number.isFinite(limit) ? limit : 50;
    const safeLimit = Math.max(1, Math.min(normalizedLimit, 500));

    if (since && Number.isNaN(Date.parse(since))) {
        emitCliError({ json, error: 'Invalid --since value. Expected ISO date.', code: 'INVALID_INPUT', exitCode: 1 });
        return;
    }

    const events = getMutationEvents({
        type: eventType || undefined,
        noteId: noteId || undefined,
        since: since || undefined,
        limit: safeLimit
    }).slice().reverse();

    if (json) {
        emitCliSuccess({ count: events.length, events });
        return;
    }

    if (quiet) {
        emitText(events.map((event) => event.noteId).join('\n') + (events.length ? '\n' : ''));
        return;
    }

    const rows = events.map((event) => ({
        timestamp: event.timestamp || '',
        type: event.type || '',
        id: event.noteId || '',
        field: event.field || ''
    }));

    if (!rows.length) {
        emitText('  (no events)\n');
        return;
    }

    emitText((() => {
        const originalLog = console.log;
        let buffer = '';
        console.log = (...args) => {
            buffer += args.map((arg) => String(arg)).join(' ') + '\n';
        };
        try {
            fmt.table(rows, [
                { key: 'timestamp', label: 'timestamp' },
                { key: 'type', label: 'type' },
                { key: 'id', label: 'id' },
                { key: 'field', label: 'field' }
            ]);
        } finally {
            console.log = originalLog;
        }
        return buffer;
    })());
}

module.exports = { run };
