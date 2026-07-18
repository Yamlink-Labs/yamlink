'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    initMutationLog,
    appendMutationEvents,
    emitOutcomeEvent,
    getMutationEvents,
    getVaultSnapshots,
    clearMutationEvents,
    withMutationContext,
    setDefaultMutationContextProvider,
    setSnapshotFieldsCacheProvider,
    onMutationEventsAppended
} = require('../src/runtime/mutationEventLog');

describe('mutation event log', () => {
    beforeEach(() => {
        initMutationLog(null);
        clearMutationEvents();
        setDefaultMutationContextProvider(null);
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

    test('works with no log path — pure in-memory', () => {
        initMutationLog(null);
        appendMutationEvents([{ type: 'note_created', noteId: 'rico' }]);
        assert.equal(getMutationEvents().length, 1);
    });

    describe('onMutationEventsAppended', () => {
        test('fires with the newly appended events after a real append', () => {
            const seen = [];
            const unsubscribe = onMutationEventsAppended((events) => seen.push(...events));
            appendMutationEvents([{ type: 'note_created', noteId: 'rico' }]);
            unsubscribe();
            assert.equal(seen.length, 1);
            assert.equal(seen[0].noteId, 'rico');
        });

        test('does not fire when every event is filtered out (missing type/noteId)', () => {
            let callCount = 0;
            const unsubscribe = onMutationEventsAppended(() => { callCount += 1; });
            appendMutationEvents([{ type: 'note_created' }, { noteId: 'rico' }]);
            unsubscribe();
            assert.equal(callCount, 0);
        });

        test('unsubscribe stops further notifications', () => {
            let callCount = 0;
            const unsubscribe = onMutationEventsAppended(() => { callCount += 1; });
            appendMutationEvents([{ type: 'note_created', noteId: 'a' }]);
            unsubscribe();
            appendMutationEvents([{ type: 'note_created', noteId: 'b' }]);
            assert.equal(callCount, 1);
        });

        test('a throwing listener does not break logging or other listeners', () => {
            const seen = [];
            const unsubBad = onMutationEventsAppended(() => { throw new Error('boom'); });
            const unsubGood = onMutationEventsAppended((events) => seen.push(...events));
            appendMutationEvents([{ type: 'note_created', noteId: 'rico' }]);
            unsubBad();
            unsubGood();
            assert.equal(seen.length, 1);
            assert.equal(getMutationEvents().length, 1);
        });

        test('ignores a non-function argument rather than throwing', () => {
            const unsubscribe = onMutationEventsAppended('not a function');
            assert.doesNotThrow(() => appendMutationEvents([{ type: 'note_created', noteId: 'rico' }]));
            unsubscribe();
        });
    });

    // ── Query API ────────────────────────────────────────────────────────────

    test('getMutationEvents filters by noteId', () => {
        appendMutationEvents([
            { timestamp: '2026-05-17T00:00:00.000Z', type: 'note_created', noteId: 'rico' },
            { timestamp: '2026-05-17T00:00:01.000Z', type: 'note_created', noteId: 'carmen' }
        ]);
        const events = getMutationEvents({ noteId: 'rico' });
        assert.equal(events.length, 1);
        assert.equal(events[0].noteId, 'rico');
    });

    test('getMutationEvents filters by type', () => {
        appendMutationEvents([
            { timestamp: '2026-05-17T00:00:00.000Z', type: 'note_created', noteId: 'rico' },
            { timestamp: '2026-05-17T00:01:00.000Z', type: 'field_added', noteId: 'rico', field: 'unit', newValue: '[[roughnecks]]' }
        ]);
        const events = getMutationEvents({ type: 'field_added' });
        assert.equal(events.length, 1);
        assert.equal(events[0].type, 'field_added');
    });

    test('getMutationEvents filters by since', () => {
        appendMutationEvents([
            { timestamp: '2026-05-10T00:00:00.000Z', type: 'note_created', noteId: 'old-note' },
            { timestamp: '2026-05-20T00:00:00.000Z', type: 'note_created', noteId: 'new-note' }
        ]);
        const events = getMutationEvents({ since: '2026-05-15T00:00:00.000Z' });
        assert.equal(events.length, 1);
        assert.equal(events[0].noteId, 'new-note');
    });

    test('getMutationEvents filters by until', () => {
        appendMutationEvents([
            { timestamp: '2026-05-10T00:00:00.000Z', type: 'note_created', noteId: 'old-note' },
            { timestamp: '2026-05-20T00:00:00.000Z', type: 'note_created', noteId: 'new-note' }
        ]);
        const events = getMutationEvents({ until: '2026-05-15T00:00:00.000Z' });
        assert.equal(events.length, 1);
        assert.equal(events[0].noteId, 'old-note');
    });

    test('getMutationEvents respects limit', () => {
        appendMutationEvents([
            { timestamp: '2026-05-17T00:00:00.000Z', type: 'note_created', noteId: 'a' },
            { timestamp: '2026-05-17T00:00:01.000Z', type: 'note_created', noteId: 'b' },
            { timestamp: '2026-05-17T00:00:02.000Z', type: 'note_created', noteId: 'c' }
        ]);
        const events = getMutationEvents({ limit: 2 });
        assert.equal(events.length, 2);
        assert.equal(events[0].noteId, 'b');
        assert.equal(events[1].noteId, 'c');
    });

    test('getMutationEvents combines filters', () => {
        appendMutationEvents([
            { timestamp: '2026-05-17T00:00:00.000Z', type: 'note_created', noteId: 'rico' },
            { timestamp: '2026-05-17T00:01:00.000Z', type: 'field_changed', noteId: 'rico', field: 'status', oldValue: 'draft', newValue: 'active' },
            { timestamp: '2026-05-17T00:02:00.000Z', type: 'field_changed', noteId: 'carmen', field: 'status', oldValue: 'draft', newValue: 'active' }
        ]);
        const events = getMutationEvents({ noteId: 'rico', type: 'field_changed' });
        assert.equal(events.length, 1);
        assert.equal(events[0].noteId, 'rico');
        assert.equal(events[0].field, 'status');
    });

    // ── Deduplication ────────────────────────────────────────────────────────

    test('duplicate events within 3 seconds are collapsed', () => {
        const ts = '2026-05-17T00:00:00.000Z';
        appendMutationEvents([{ timestamp: ts, type: 'field_changed', noteId: 'rico', field: 'status', newValue: 'active' }]);
        appendMutationEvents([{ timestamp: ts, type: 'field_changed', noteId: 'rico', field: 'status', newValue: 'active' }]);
        assert.equal(getMutationEvents().length, 1);
    });

    test('same event type after 3 seconds is not deduplicated', () => {
        appendMutationEvents([{ timestamp: '2026-05-17T00:00:00.000Z', type: 'field_changed', noteId: 'rico', field: 'status', newValue: 'active' }]);
        appendMutationEvents([{ timestamp: '2026-05-17T00:00:04.000Z', type: 'field_changed', noteId: 'rico', field: 'status', newValue: 'active' }]);
        assert.equal(getMutationEvents().length, 2);
    });

    test('different newValue is not deduplicated', () => {
        const ts = '2026-05-17T00:00:00.000Z';
        appendMutationEvents([{ timestamp: ts, type: 'field_changed', noteId: 'rico', field: 'status', newValue: 'draft' }]);
        appendMutationEvents([{ timestamp: ts, type: 'field_changed', noteId: 'rico', field: 'status', newValue: 'active' }]);
        assert.equal(getMutationEvents().length, 2);
    });

    test('different noteId is not deduplicated', () => {
        const ts = '2026-05-17T00:00:00.000Z';
        appendMutationEvents([{ timestamp: ts, type: 'note_created', noteId: 'rico' }]);
        appendMutationEvents([{ timestamp: ts, type: 'note_created', noteId: 'carmen' }]);
        assert.equal(getMutationEvents().length, 2);
    });

    test('initMutationLog loads existing events from file', () => {
        const tmpPath = path.join(os.tmpdir(), `yamlink-mel-test-${Date.now()}.ndjson`);
        try {
            const stored = [
                { timestamp: '2026-05-17T00:00:00.000Z', type: 'note_created', noteId: 'carl-jenkins', field: null, oldValue: null, newValue: null },
                { timestamp: '2026-05-17T00:00:02.000Z', type: 'field_added', noteId: 'carl-jenkins', field: 'unit', oldValue: null, newValue: '[[roughnecks]]' }
            ];
            fs.writeFileSync(tmpPath, stored.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');

            initMutationLog(tmpPath);

            const events = getMutationEvents();
            assert.equal(events.length, 2);
            assert.equal(events[0].noteId, 'carl-jenkins');
            assert.equal(events[1].field, 'unit');
        } finally {
            initMutationLog(null);
            try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
    });

    test('appendMutationEvents writes new events to file', () => {
        const tmpPath = path.join(os.tmpdir(), `yamlink-mel-test-${Date.now()}.ndjson`);
        try {
            initMutationLog(tmpPath);
            appendMutationEvents([{ type: 'note_created', noteId: 'rico-delgado' }]);

            const lines = fs.readFileSync(tmpPath, 'utf8').split('\n').filter(Boolean);
            assert.equal(lines.length, 1);
            const parsed = JSON.parse(lines[0]);
            assert.equal(parsed.noteId, 'rico-delgado');
            assert.equal(parsed.type, 'note_created');
            assert.ok(typeof parsed.timestamp === 'string');
        } finally {
            initMutationLog(null);
            try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
    });

    test('withMutationContext applies source and cause without overwriting explicit event values', () => {
        const events = withMutationContext([
            { type: 'note_created', noteId: 'rico' },
            { type: 'field_changed', noteId: 'carmen', field: 'status', newValue: 'active', source: 'cli' }
        ], {
            source: 'api',
            cause: 'api_bulk_update_node'
        });

        assert.equal(events[0].source, 'api');
        assert.equal(events[0].cause, 'api_bulk_update_node');
        assert.equal(events[1].source, 'cli');
        assert.equal(events[1].cause, 'api_bulk_update_node');
    });

    test('appendMutationEvents preserves source, cause, and sessionId fields', () => {
        appendMutationEvents([{
            type: 'field_changed',
            noteId: 'rico',
            field: 'status',
            oldValue: 'draft',
            newValue: 'active',
            source: 'api',
            cause: 'api_update_node',
            sessionId: 'session-1'
        }]);

        const [event] = getMutationEvents();
        assert.equal(event.source, 'api');
        assert.equal(event.cause, 'api_update_node');
        assert.equal(event.sessionId, 'session-1');
    });

    test('emitOutcomeEvent preserves source and cause on behavioral events', () => {
        emitOutcomeEvent({
            type: 'completion_accepted',
            noteId: 'rico',
            field: 'unit',
            newValue: '[[roughnecks]]',
            source: 'vscode',
            cause: 'completion_accept'
        });

        const [event] = getMutationEvents();
        assert.equal(event.type, 'completion_accepted');
        assert.equal(event.source, 'vscode');
        assert.equal(event.cause, 'completion_accept');
    });

    test('appendMutationEvents inherits default session context when provider is set', () => {
        setDefaultMutationContextProvider(() => ({
            source: 'vscode',
            sessionId: 'session-auto-1',
            meta: { sessionReason: 'mutation' }
        }));

        appendMutationEvents([{
            type: 'field_changed',
            noteId: 'rico',
            field: 'rank',
            newValue: 'lieutenant'
        }]);

        const [event] = getMutationEvents();
        assert.equal(event.source, 'vscode');
        assert.equal(event.sessionId, 'session-auto-1');
        assert.equal(event.meta.sessionReason, 'mutation');
    });

    test('withMutationContext preserves provider defaults while allowing explicit context overrides', () => {
        setDefaultMutationContextProvider(() => ({
            source: 'vscode',
            sessionId: 'session-auto-2',
            meta: { sessionReason: 'mutation' }
        }));

        const [event] = withMutationContext([{
            type: 'note_created',
            noteId: 'carmen'
        }], {
            cause: 'workspace_index_mutation'
        });

        assert.equal(event.source, 'vscode');
        assert.equal(event.sessionId, 'session-auto-2');
        assert.equal(event.cause, 'workspace_index_mutation');
        assert.equal(event.meta.sessionReason, 'mutation');
    });

    test('events from multiple appends accumulate in file', () => {
        const tmpPath = path.join(os.tmpdir(), `yamlink-mel-test-${Date.now()}.ndjson`);
        try {
            initMutationLog(tmpPath);
            appendMutationEvents([{ type: 'note_created', noteId: 'rico-delgado' }]);
            appendMutationEvents([{ type: 'field_added', noteId: 'rico-delgado', field: 'unit', newValue: '[[roughnecks]]' }]);

            const lines = fs.readFileSync(tmpPath, 'utf8').split('\n').filter(Boolean);
            assert.equal(lines.length, 2);
            assert.equal(JSON.parse(lines[1]).field, 'unit');
        } finally {
            initMutationLog(null);
            try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
    });

    test('clearMutationEvents truncates the file', () => {
        const tmpPath = path.join(os.tmpdir(), `yamlink-mel-test-${Date.now()}.ndjson`);
        try {
            initMutationLog(tmpPath);
            appendMutationEvents([{ type: 'note_created', noteId: 'rico-delgado' }]);
            clearMutationEvents();

            const content = fs.readFileSync(tmpPath, 'utf8');
            assert.equal(content, '');
            assert.equal(getMutationEvents().length, 0);
        } finally {
            initMutationLog(null);
            try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
    });

    test('initMutationLog compacts file when stored events exceed MAX_EVENTS', () => {
        const tmpPath = path.join(os.tmpdir(), `yamlink-mel-test-${Date.now()}.ndjson`);
        try {
            const lines = [];
            for (let i = 0; i < 10005; i++) {
                lines.push(JSON.stringify({ timestamp: '2026-05-17T00:00:00.000Z', type: 'note_created', noteId: `note-${i}`, field: null, oldValue: null, newValue: null }));
            }
            fs.writeFileSync(tmpPath, lines.join('\n') + '\n', 'utf8');

            initMutationLog(tmpPath);

            assert.equal(getMutationEvents().length, 10000);
            const fileLines = fs.readFileSync(tmpPath, 'utf8').split('\n').filter(Boolean);
            assert.equal(fileLines.length, 10000);
            assert.equal(JSON.parse(fileLines[0]).noteId, 'note-5');
        } finally {
            initMutationLog(null);
            try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
    });

    test('initMutationLog creates directory if it does not exist', () => {
        const tmpDir = path.join(os.tmpdir(), `yamlink-mel-dir-${Date.now()}`);
        const tmpPath = path.join(tmpDir, 'mutation-log.ndjson');
        try {
            initMutationLog(tmpPath);
            appendMutationEvents([{ type: 'note_created', noteId: 'test' }]);
            assert.ok(fs.existsSync(tmpPath));
        } finally {
            initMutationLog(null);
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            try { fs.rmdirSync(tmpDir); } catch (_) {}
        }
    });

    test('ignores malformed lines in the log file', () => {
        const tmpPath = path.join(os.tmpdir(), `yamlink-mel-test-${Date.now()}.ndjson`);
        try {
            fs.writeFileSync(tmpPath, 'not json\n{"type":"note_created","noteId":"valid","timestamp":"2026-05-17T00:00:00.000Z","field":null,"oldValue":null,"newValue":null}\n', 'utf8');

            initMutationLog(tmpPath);

            assert.equal(getMutationEvents().length, 1);
            assert.equal(getMutationEvents()[0].noteId, 'valid');
        } finally {
            initMutationLog(null);
            try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
    });
});

describe('vault snapshotting — see docs/architecture/TIME-ENGINE.md', () => {
    test('appending past MAX_EVENTS with a registered fieldsCache provider takes a snapshot at the truncation boundary', () => {
        const tmpDir = path.join(os.tmpdir(), `yamlink-snap-e2e-${Date.now()}`);
        const tmpPath = path.join(tmpDir, 'mutation-log.ndjson');
        try {
            initMutationLog(tmpPath);
            // A single note whose 'status' field changes on every event, so the
            // reconstructed snapshot state is trivially checkable.
            const fieldsCache = new Map([['rico', { id: 'rico', type: 'character', status: 'active' }]]);
            setSnapshotFieldsCacheProvider(() => fieldsCache);

            const base = Date.parse('2026-01-01T00:00:00.000Z');
            const batch = [];
            for (let i = 0; i < 10001; i++) {
                batch.push({
                    timestamp: new Date(base + i * 1000).toISOString(),
                    type: 'field_changed',
                    noteId: 'rico',
                    field: 'status',
                    oldValue: i === 0 ? null : `status-${i - 1}`,
                    newValue: `status-${i}`
                });
            }
            appendMutationEvents(batch);

            // Trimmed to MAX_EVENTS - SNAPSHOT_INTERVAL (10000 - 2000 = 8000), not MAX_EVENTS.
            assert.equal(getMutationEvents().length, 8000);

            const snapshots = getVaultSnapshots();
            assert.equal(snapshots.length, 1);
            // Boundary = the timestamp of the (dropCount-1)th dropped event.
            // dropCount = 10001 - 8000 = 2001, so the boundary event is index 2000
            // (0-indexed) of the batch, whose newValue is 'status-2000'.
            assert.equal(snapshots[0].notes.rico.status, 'status-2000');

            // The persisted log file must match the truncated in-memory array —
            // this was a real pre-existing gap (file only ever grew via append,
            // never rewritten on truncation until the next process restart).
            const fileLines = fs.readFileSync(tmpPath, 'utf8').split('\n').filter(Boolean);
            assert.equal(fileLines.length, 8000);
        } finally {
            initMutationLog(null);
            setSnapshotFieldsCacheProvider(null);
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            try { fs.unlinkSync(path.join(tmpDir, 'vault-snapshots.ndjson')); } catch (_) {}
            try { fs.rmdirSync(tmpDir); } catch (_) {}
        }
    });

    test('no snapshot is taken when no fieldsCache provider is registered — truncation still happens safely', () => {
        const tmpDir = path.join(os.tmpdir(), `yamlink-snap-e2e-noprov-${Date.now()}`);
        const tmpPath = path.join(tmpDir, 'mutation-log.ndjson');
        try {
            initMutationLog(tmpPath);
            setSnapshotFieldsCacheProvider(null);

            const base = Date.parse('2026-01-01T00:00:00.000Z');
            const batch = [];
            for (let i = 0; i < 10001; i++) {
                batch.push({
                    timestamp: new Date(base + i * 1000).toISOString(),
                    type: 'note_created',
                    noteId: `note-${i}`
                });
            }
            appendMutationEvents(batch);

            assert.equal(getMutationEvents().length, 8000);
            assert.deepEqual(getVaultSnapshots(), []);
        } finally {
            initMutationLog(null);
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            try { fs.rmdirSync(tmpDir); } catch (_) {}
        }
    });

    test('clearMutationEvents also clears persisted snapshots', () => {
        const tmpDir = path.join(os.tmpdir(), `yamlink-snap-clear-${Date.now()}`);
        const tmpPath = path.join(tmpDir, 'mutation-log.ndjson');
        try {
            initMutationLog(tmpPath);
            const { appendVaultSnapshot } = require('../src/core/vaultSnapshots');
            appendVaultSnapshot(path.join(tmpDir, 'vault-snapshots.ndjson'), '2026-01-01T00:00:00.000Z', { a: {} });
            assert.equal(getVaultSnapshots().length, 1);

            clearMutationEvents();
            assert.deepEqual(getVaultSnapshots(), []);
        } finally {
            initMutationLog(null);
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            try { fs.unlinkSync(path.join(tmpDir, 'vault-snapshots.ndjson')); } catch (_) {}
            try { fs.rmdirSync(tmpDir); } catch (_) {}
        }
    });
});
