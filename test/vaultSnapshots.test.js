'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { appendVaultSnapshot, loadVaultSnapshots } = require('../src/core/vaultSnapshots');

function tmpSnapshotPath() {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-snap-')), 'vault-snapshots.ndjson');
}

describe('vaultSnapshots', () => {
    test('appendVaultSnapshot then loadVaultSnapshots round-trips exactly', () => {
        const snapPath = tmpSnapshotPath();
        appendVaultSnapshot(snapPath, '2026-01-01T00:00:00.000Z', { rico: { type: 'character', name: 'Rico' } });
        const snapshots = loadVaultSnapshots(snapPath);
        assert.equal(snapshots.length, 1);
        assert.equal(snapshots[0].timestamp, '2026-01-01T00:00:00.000Z');
        assert.deepEqual(snapshots[0].notes, { rico: { type: 'character', name: 'Rico' } });
    });

    test('multiple snapshots are returned sorted ascending regardless of write order', () => {
        const snapPath = tmpSnapshotPath();
        appendVaultSnapshot(snapPath, '2026-03-01T00:00:00.000Z', { a: {} });
        appendVaultSnapshot(snapPath, '2026-01-01T00:00:00.000Z', { a: {} });
        appendVaultSnapshot(snapPath, '2026-02-01T00:00:00.000Z', { a: {} });
        const snapshots = loadVaultSnapshots(snapPath);
        assert.deepEqual(snapshots.map((s) => s.timestamp), [
            '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'
        ]);
    });

    test('a note recorded as null (existed, content unknown) round-trips as null, not dropped', () => {
        const snapPath = tmpSnapshotPath();
        appendVaultSnapshot(snapPath, '2026-01-01T00:00:00.000Z', { rico: { type: 'character' }, ghost: null });
        const snapshots = loadVaultSnapshots(snapPath);
        assert.equal(snapshots[0].notes.ghost, null);
        assert.ok('ghost' in snapshots[0].notes);
    });

    test('loadVaultSnapshots returns an empty array for a missing file', () => {
        assert.deepEqual(loadVaultSnapshots(path.join(os.tmpdir(), 'definitely-does-not-exist.ndjson')), []);
    });

    test('loadVaultSnapshots returns an empty array for a null path', () => {
        assert.deepEqual(loadVaultSnapshots(null), []);
    });

    test('a corrupt line is skipped rather than failing the whole load', () => {
        const snapPath = tmpSnapshotPath();
        fs.writeFileSync(snapPath, 'not valid json\n' + JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', notes: { a: {} } }) + '\n', 'utf8');
        const snapshots = loadVaultSnapshots(snapPath);
        assert.equal(snapshots.length, 1);
    });

    test('appendVaultSnapshot silently no-ops for a null path', () => {
        assert.doesNotThrow(() => appendVaultSnapshot(null, '2026-01-01T00:00:00.000Z', { a: {} }));
    });
});
