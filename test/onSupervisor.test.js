'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { runSupervisedDaemon } = require('../src/cli/commands/on');

function fakeChild() {
    const child = new EventEmitter();
    child.kill = (signal) => { child.killedWith = signal; };
    return child;
}

describe('runSupervisedDaemon — process-crash recovery for yamlink on --daemon', () => {

    test('respawns the worker with backoff on an unexpected exit', () => {
        const spawned = [];
        const scheduled = [];
        const logs = [];
        runSupervisedDaemon({
            childArgv: ['on', 'field_changed', '--', './sync.sh'],
            logFd: 1,
            spawnFn: () => { const c = fakeChild(); spawned.push(c); return c; },
            writeLog: (line) => logs.push(line),
            backoffFn: (attempt) => 100 * (attempt + 1), // deterministic, not real timing
            scheduleFn: (fn) => scheduled.push(fn) // never actually invoked — captured only
        });

        assert.equal(spawned.length, 1);
        spawned[0].emit('exit', 1, null); // unexpected crash, not a deliberate stop

        assert.equal(scheduled.length, 1, 'expected a respawn to be scheduled');
        assert.ok(logs.some((l) => l.includes('restarting in')), `expected a respawn log line, got: ${logs.join('')}`);

        // Running the scheduled respawn callback should spawn a second worker.
        scheduled[0]();
        assert.equal(spawned.length, 2);
    });

    test('does not respawn when stop() was called first — a deliberate stop, not a crash', () => {
        const spawned = [];
        const scheduled = [];
        const supervisor = runSupervisedDaemon({
            childArgv: ['on', 'field_changed', '--', './sync.sh'],
            logFd: 1,
            spawnFn: () => { const c = fakeChild(); spawned.push(c); return c; },
            writeLog: () => {},
            scheduleFn: (fn) => scheduled.push(fn)
        });

        supervisor.stop();
        assert.equal(spawned[0].killedWith, 'SIGTERM');

        // The worker's own graceful shutdown reports back as a clean exit
        // with no signal at all (it calls process.exit(0) itself) — the
        // supervisor must not treat this as a crash regardless of what
        // code/signal come back, because `stopping` was already set.
        spawned[0].emit('exit', 0, null);
        assert.equal(scheduled.length, 0, 'must not schedule a respawn after a deliberate stop');
    });

    test('gives up after maxRespawns consecutive unexpected exits, not an infinite loop', () => {
        const spawned = [];
        let scheduledFn = null;
        let gaveUp = false;
        function spawnAndFail() {
            const c = fakeChild();
            spawned.push(c);
            return c;
        }
        runSupervisedDaemon({
            childArgv: ['on', 'field_changed', '--', './sync.sh'],
            logFd: 1,
            spawnFn: spawnAndFail,
            writeLog: () => {},
            maxRespawns: 2,
            backoffFn: () => 0,
            scheduleFn: (fn) => { scheduledFn = fn; },
            onGiveUp: () => { gaveUp = true; }
        });

        // 1st crash -> respawn 1
        spawned[0].emit('exit', 1, null);
        assert.equal(spawned.length, 1);
        scheduledFn();
        assert.equal(spawned.length, 2);

        // 2nd crash -> respawn 2
        spawned[1].emit('exit', 1, null);
        scheduledFn();
        assert.equal(spawned.length, 3);

        // 3rd crash -> exceeds maxRespawns (2) -> give up, no further respawn
        scheduledFn = null;
        spawned[2].emit('exit', 1, null);
        assert.equal(scheduledFn, null, 'must not schedule another respawn past the cap');
        assert.equal(gaveUp, true);
    });

    test('spawns the worker with the exact same argv it was given', () => {
        let capturedArgv = null;
        runSupervisedDaemon({
            childArgv: ['on', 'note_created', '--type', 'contact', '--', './hook.sh'],
            logFd: 1,
            spawnFn: (execPath, argv) => { capturedArgv = argv; return fakeChild(); },
            writeLog: () => {}
        });
        assert.deepEqual(capturedArgv.slice(1), ['on', 'note_created', '--type', 'contact', '--', './hook.sh']);
    });

    test('never lets the worker inherit YAMLINK_DAEMON_SUPERVISE — regression for a real runaway-process bug', () => {
        // Real bug, caught only by an actual --daemon smoke test, not by any
        // of the tests above: child_process.spawn() inherits process.env by
        // default. Without an explicit override, the worker would inherit
        // the supervisor's own YAMLINK_DAEMON_SUPERVISE=1, re-enter
        // supervisor mode itself, and spawn its own "worker" doing the same
        // — an unbounded chain of supervisors-spawning-supervisors, not a
        // bounded respawn loop. A real run of this bug produced 1,400+ live
        // processes in under a minute before it was caught and killed.
        const originalValue = process.env.YAMLINK_DAEMON_SUPERVISE;
        process.env.YAMLINK_DAEMON_SUPERVISE = '1';
        let capturedEnv = null;
        try {
            runSupervisedDaemon({
                childArgv: ['on', 'field_changed', '--', './sync.sh'],
                logFd: 1,
                spawnFn: (execPath, argv, options) => { capturedEnv = options.env; return fakeChild(); },
                writeLog: () => {}
            });
        } finally {
            if (originalValue === undefined) delete process.env.YAMLINK_DAEMON_SUPERVISE;
            else process.env.YAMLINK_DAEMON_SUPERVISE = originalValue;
        }
        assert.ok(capturedEnv, 'expected spawnFn to receive an options object with env');
        assert.equal(capturedEnv.YAMLINK_DAEMON_SUPERVISE, undefined);
    });

});
