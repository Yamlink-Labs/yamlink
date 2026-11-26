'use strict';

const fmt = require('../format');
const { emitCliError, emitCliSuccess, emitText } = require('../io');
const { getMutationEvents, previewFieldHistoryPurge, purgeFieldHistory } = require('../../runtime/mutationEventLog');

/**
 * `yamlink mutations purge-field <field> [--note <id>] [--yes]` — permanent,
 * irreversible redaction of a field's historical values from both the
 * mutation log and the Time Engine snapshot archive. Confirmation-gated:
 * without `--yes`, prints what WOULD be affected and does nothing, since
 * there is no undo once the raw values are overwritten on disk.
 */
function runPurgeField({ field, noteId, confirmed, json, quiet }) {
    if (!field) {
        emitCliError({ json, error: 'Usage: yamlink mutations purge-field <field> [--note <id>] [--yes]', code: 'USAGE', exitCode: 1 });
        return;
    }

    const preview = previewFieldHistoryPurge(field, noteId || undefined);
    if (preview.eventCount === 0 && preview.snapshotCount === 0) {
        if (json) {
            emitCliSuccess({ field, noteId: noteId || null, redactedEventCount: 0, redactedSnapshotCount: 0, message: 'Nothing to purge.' });
        } else if (!quiet) {
            emitText(`Nothing to purge for field "${field}"${noteId ? ` on note "${noteId}"` : ''}.\n`);
        }
        return;
    }

    if (!confirmed) {
        if (json) {
            emitCliSuccess({
                field,
                noteId: noteId || null,
                dryRun: true,
                wouldRedactEventCount: preview.eventCount,
                wouldRedactSnapshotCount: preview.snapshotCount,
                message: 'Pass --yes to actually redact these values. This cannot be undone.'
            });
        } else if (!quiet) {
            emitText(
                `This would permanently redact field "${field}"${noteId ? ` on note "${noteId}"` : ' across every note'}:\n` +
                `  ${preview.eventCount} mutation log event(s)\n` +
                `  ${preview.snapshotCount} snapshot entry(ies)\n` +
                `This cannot be undone. Re-run with --yes to actually redact.\n`
            );
        }
        return;
    }

    const result = purgeFieldHistory({ field, noteId: noteId || undefined });
    if (json) {
        emitCliSuccess({ field, noteId: noteId || null, redactedEventCount: result.redactedEventCount, redactedSnapshotCount: result.redactedSnapshotCount });
        return;
    }
    if (!quiet) {
        emitText(
            `Redacted field "${field}"${noteId ? ` on note "${noteId}"` : ''}: ` +
            `${result.redactedEventCount} mutation log event(s), ${result.redactedSnapshotCount} snapshot entry(ies).\n`
        );
    }
}

function run({ action, field, eventType, noteId, since, limit, confirmed, json, quiet }) {
    if (action === 'purge-field') {
        runPurgeField({ field, noteId, confirmed, json, quiet });
        return;
    }

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
