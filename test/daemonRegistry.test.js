'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    makeDaemonId,
    isProcessAlive,
    writeDaemonRecord,
    readDaemonRecord,
    removeDaemonRecord,
    listDaemons,
    getPidFilePath,
    getLogFilePath
} = require('../src/runtime/daemonRegistry');

function makeTmpVault() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-daemon-'));
}

function baseInfo(overrides = {}) {
    return {
        pid: process.pid,
        event: 'field_changed',
        noteType: null,
        script: './sync.sh',
        startedAt: new Date().toISOString(),
        ...overrides
    };
}

describe('daemonRegistry', () => {

    test('makeDaemonId produces unique, stable-shaped ids', () => {
        const a = makeDaemonId();
        const b = makeDaemonId();
        assert.notEqual(a, b);
        assert.match(a, /^daemon-\d{14}-[a-z0-9]{6}$/);
    });

    test('isProcessAlive is true for this process\'s own real pid', () => {
        assert.equal(isProcessAlive(process.pid), true);
    });

    test('isProcessAlive is false for a pid that does not exist', () => {
        // A pid this large is not a real running process on any real machine.
        assert.equal(isProcessAlive(999999999), false);
    });

    test('isProcessAlive is false for invalid input, never throws', () => {
        assert.equal(isProcessAlive(0), false);
        assert.equal(isProcessAlive(-1), false);
        assert.equal(isProcessAlive(NaN), false);
    });

    test('writeDaemonRecord + readDaemonRecord round-trip real fields', () => {
        const vault = makeTmpVault();
        try {
            const id = makeDaemonId();
            writeDaemonRecord(vault, id, baseInfo({ event: 'note_created', script: './hook.sh' }));
            const record = readDaemonRecord(vault, id);
            assert.equal(record.id, id);
            assert.equal(record.pid, process.pid);
            assert.equal(record.event, 'note_created');
            assert.equal(record.script, './hook.sh');
        } finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });

    test('readDaemonRecord returns null for a missing or malformed record', () => {
        const vault = makeTmpVault();
        try {
            assert.equal(readDaemonRecord(vault, 'no-such-daemon'), null);
            fs.mkdirSync(path.join(vault, '.yamlink', 'hooks'), { recursive: true });
            fs.writeFileSync(getPidFilePath(vault, 'broken'), 'not json', 'utf8');
            assert.equal(readDaemonRecord(vault, 'broken'), null);
        } finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });

    test('removeDaemonRecord deletes the file and is safe to call twice', () => {
        const vault = makeTmpVault();
        try {
            const id = makeDaemonId();
            writeDaemonRecord(vault, id, baseInfo());
            assert.ok(readDaemonRecord(vault, id));
            removeDaemonRecord(vault, id);
            assert.equal(readDaemonRecord(vault, id), null);
            removeDaemonRecord(vault, id); // second call, already gone — must not throw
        } finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });

    test('listDaemons returns an empty array when no hooks directory exists', () => {
        const vault = makeTmpVault();
        try {
            assert.deepEqual(listDaemons(vault), []);
        } finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });

    test('listDaemons reports a real, alive process correctly and includes its log path', () => {
        const vault = makeTmpVault();
        try {
            const id = makeDaemonId();
            writeDaemonRecord(vault, id, baseInfo({ pid: process.pid }));
            const list = listDaemons(vault);
            assert.equal(list.length, 1);
            assert.equal(list[0].id, id);
            assert.equal(list[0].alive, true);
            assert.equal(list[0].logPath, getLogFilePath(vault, id));
        } finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });

    test('listDaemons reports a dead pid as alive:false and cleans up its on-disk record', () => {
        const vault = makeTmpVault();
        try {
            const id = makeDaemonId();
            writeDaemonRecord(vault, id, baseInfo({ pid: 999999999 }));
            const list = listDaemons(vault);
            assert.equal(list.length, 1);
            assert.equal(list[0].id, id);
            assert.equal(list[0].alive, false);
            // Reported once for this call (so a status display can show "was
            // running, now dead"), but the underlying record is pruned — a
            // second listDaemons() call won't find it again.
            assert.equal(readDaemonRecord(vault, id), null);
            assert.deepEqual(listDaemons(vault), []);
        } finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });

    test('listDaemons sorts by id and reports multiple real records', () => {
        const vault = makeTmpVault();
        try {
            writeDaemonRecord(vault, 'daemon-b', baseInfo());
            writeDaemonRecord(vault, 'daemon-a', baseInfo());
            const list = listDaemons(vault);
            assert.deepEqual(list.map((d) => d.id), ['daemon-a', 'daemon-b']);
        } finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });

});
