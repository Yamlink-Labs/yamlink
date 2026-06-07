'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    initMutationLog,
    appendMutationEvents,
    getMutationEvents,
    clearMutationEvents
} = require('../src/runtime/mutationEventLog');

describe('mutation event log', () => {
    beforeEach(() => {
        initMutationLog(null);
        clearMutationEvents();
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
