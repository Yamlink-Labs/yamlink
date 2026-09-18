'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const fmt = require('../format');
const { emitCliError, emitJson, emitText } = require('../io');
const { validateHookEvent } = require('../../runtime/webhooks');
const {
    isProcessAlive,
    readDaemonRecord,
    removeDaemonRecord,
    listDaemons,
    getLogFilePath
} = require('../../runtime/daemonRegistry');

const MAX_WATCH_RETRIES = 5;
const MAX_BACKOFF_MS = 30000;
const MAX_WORKER_RESPAWNS = 5;

function timeStamp() {
    return new Date().toTimeString().slice(0, 8);
}

function backoffMs(attempt) {
    return Math.min(1000 * Math.pow(2, attempt), MAX_BACKOFF_MS);
}

/**
 * Process-level crash recovery for `--daemon`, distinct from (and layered on
 * top of) the watch-level retry already in run() below. That retry only
 * covers a real fs.watch failure inside a still-alive process; it does
 * nothing if the worker process itself is killed (OOM, an uncaught
 * exception outside the watch callback, `kill -9` from something else).
 * This supervisor spawns the real worker as its own child, and respawns it
 * with backoff on any *unexpected* exit — capped, so a worker that crashes
 * immediately on every start can't loop forever. A deliberate stop (the
 * supervisor's own SIGTERM/SIGINT handler, which is how `yamlink on --stop`
 * reaches it) is tracked via the `stopping` flag, checked before the
 * respawn decision, rather than inspecting the child's reported exit
 * signal — a worker doing its own graceful shutdown in response to SIGTERM
 * calls process.exit(0) itself, which reports back as a clean exit with no
 * signal at all, not as "killed by SIGTERM".
 * @param {{
 *   childArgv: string[],
 *   logFd: number,
 *   spawnFn?: Function,
 *   writeLog?: (line: string) => void,
 *   maxRespawns?: number,
 *   onGiveUp?: () => void,
 *   backoffFn?: (attempt: number) => number,
 *   scheduleFn?: (fn: Function, delay: number) => any
 * }} options
 * @returns {{ stop: () => void }}
 */
function runSupervisedDaemon({ childArgv, logFd, spawnFn = spawn, writeLog, maxRespawns = MAX_WORKER_RESPAWNS, onGiveUp, backoffFn = backoffMs, scheduleFn = setTimeout }) {
    const log = writeLog || ((line) => { try { fs.writeSync(logFd, line); } catch (_) { /* best effort */ } });
    let respawnCount = 0;
    let currentChild = null;
    let stopping = false;

    function spawnWorker() {
        // Real bug found via smoke test, not caught by unit tests: spawn()
        // inherits process.env by default. The supervisor's own env has
        // YAMLINK_DAEMON_SUPERVISE=1 (set by --daemon when it spawned the
        // supervisor) — without stripping it here, the worker would inherit
        // it too, re-enter supervisor mode itself instead of running the
        // plain watcher, and spawn its own "worker" that does the same
        // thing — an unbounded recursive chain of supervisors, not a
        // bounded respawn loop. Explicit env with the flag removed avoids
        // this regardless of what router.js's dispatch logic does with it.
        const workerEnv = { ...process.env };
        delete workerEnv.YAMLINK_DAEMON_SUPERVISE;
        currentChild = spawnFn(process.execPath, [process.argv[1], ...childArgv], {
            stdio: ['ignore', logFd, logFd],
            cwd: process.cwd(),
            env: workerEnv
        });
        currentChild.on('exit', (code, signal) => {
            if (stopping) return;
            respawnCount += 1;
            if (respawnCount > maxRespawns) {
                log(`[supervisor] worker exited unexpectedly ${respawnCount} times (last: code=${code} signal=${signal}) — giving up\n`);
                if (onGiveUp) onGiveUp();
                return;
            }
            const delay = backoffFn(respawnCount - 1);
            log(`[supervisor] worker exited unexpectedly (code=${code} signal=${signal}) — restarting in ${Math.round(delay / 1000)}s (attempt ${respawnCount}/${maxRespawns})\n`);
            scheduleFn(spawnWorker, delay);
        });
    }

    spawnWorker();

    return {
        stop() {
            stopping = true;
            if (currentChild && typeof currentChild.kill === 'function') currentChild.kill('SIGTERM');
        }
    };
}

/**
 * `--list` — reports every registered daemon (real PID liveness checked,
 * stale records pruned as a side effect — see daemonRegistry.js).
 */
function runList({ vaultPath, json }) {
    const daemons = listDaemons(vaultPath);
    if (json) { emitJson({ ok: true, daemons }); return; }
    if (!daemons.length) { emitText('No daemons registered for this vault.\n'); return; }
    for (const d of daemons) {
        const status = d.alive ? fmt.ok('running') : fmt.err('dead');
        emitText(`${d.id}  pid=${d.pid}  ${status}  ${d.event}${d.noteType ? ' (' + d.noteType + ')' : ''} -> ${d.script}\n`);
    }
}

/**
 * `--stop <id>` / `--stop-all` — sends SIGTERM to a real, live daemon
 * process and removes its record. Stopping an already-dead or unknown id is
 * reported clearly, not silently ignored.
 */
function runStop({ vaultPath, json, stopId = null, stopAll = false }) {
    const targets = stopAll ? listDaemons(vaultPath).filter((d) => d.alive) : [];
    if (!stopAll) {
        const record = readDaemonRecord(vaultPath, stopId);
        if (!record) {
            return emitCliError({ json, error: `No daemon registered with id "${stopId}".`, code: 'NOT_FOUND', exitCode: 1 });
        }
        targets.push({ ...record, alive: isProcessAlive(record.pid), logPath: getLogFilePath(vaultPath, stopId) });
    }

    const stopped = [];
    const skipped = [];
    for (const d of targets) {
        if (!d.alive) { skipped.push(d.id); removeDaemonRecord(vaultPath, d.id); continue; }
        try {
            process.kill(d.pid, 'SIGTERM');
            stopped.push(d.id);
        } catch (err) {
            skipped.push(d.id);
        }
        removeDaemonRecord(vaultPath, d.id);
    }

    if (json) { emitJson({ ok: true, stopped, skipped }); return; }
    for (const id of stopped) emitText(fmt.ok(`Stopped ${id}\n`));
    for (const id of skipped) emitText(`${id} was already dead — record removed.\n`);
    if (!stopped.length && !skipped.length) emitText('Nothing to stop.\n');
}

function readMutationLog(logPath) {
    if (!fs.existsSync(logPath)) return [];
    let raw = '';
    try {
        raw = fs.readFileSync(logPath, 'utf8');
    } catch (_) {
        return [];
    }
    const events = [];
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            events.push(JSON.parse(trimmed));
        } catch (_) {
            continue;
        }
    }
    return events;
}

function run({ event, noteType, script, vaultPath, vaultService, json, quiet }) {
    const normalizedEvent = String(event || '').trim();
    const normalizedType = noteType ? String(noteType).trim().toLowerCase() : null;
    const eventValidation = validateHookEvent(normalizedEvent);
    if (!eventValidation.ok) {
        emitCliError({
            json,
            error: `Invalid event: ${normalizedEvent}. Usage: yamlink on <event> [--type <type>] -- <script>`,
            code: 'USAGE',
            exitCode: 1
        });
    }
    if (!script) {
        emitCliError({ json, error: 'Usage: yamlink on <event> [--type <type>] -- <script>', code: 'USAGE', exitCode: 1 });
    }

    const logPath = path.join(vaultPath, '.yamlink', 'mutation-log.ndjson');
    let lastRebuildTimestamp = new Date().toISOString();
    let watcher = null;
    const unsubscribe = vaultService && vaultService.onRebuild(() => {
        try {
            const recentEvents = readMutationLog(logPath)
                .filter((entry) => String(entry.timestamp || '') > lastRebuildTimestamp)
                .filter((entry) => entry.type === normalizedEvent)
                .filter((entry) => !normalizedType || String(entry.noteType || '').trim().toLowerCase() === normalizedType);

            for (const entry of recentEvents) {
                const yamlinkVars = {
                    YAMLINK_EVENT: String(entry.type || ''),
                    YAMLINK_NOTE_ID: String(entry.noteId || ''),
                    YAMLINK_TYPE: String(entry.noteType || ''),
                    YAMLINK_FIELD: String(entry.field || ''),
                    YAMLINK_VALUE: entry.newValue == null ? '' : String(entry.newValue)
                };
                if (json) {
                    emitJson({
                        ok: true,
                        event: 'hook_fired',
                        timestamp: new Date().toISOString(),
                        mutationType: entry.type,
                        noteId: entry.noteId || '',
                        noteType: entry.noteType || '',
                        field: entry.field || '',
                        script
                    });
                } else if (!quiet) {
                    emitText(`[${timeStamp()}] hook fired: ${entry.type} -> ${entry.noteId || ''} -> ${script}\n`);
                }
                spawn(script, {
                    env: { ...process.env, ...yamlinkVars },
                    stdio: 'inherit',
                    shell: true
                });
            }

            lastRebuildTimestamp = new Date().toISOString();
        } catch (err) {
            if (json) {
                emitJson({
                    ok: false,
                    event: 'hook_rebuild_failed',
                    code: 'INTERNAL_ERROR',
                    error: err.message,
                    timestamp: new Date().toISOString()
                });
            } else {
                console.error(fmt.err('Hook rebuild failed: ' + err.message));
            }
        }
    });

    if (json) {
        emitJson({
            ok: true,
            event: 'hook_watch_started',
            watchEvent: normalizedEvent,
            noteType: normalizedType,
            vaultPath,
            script,
            pid: process.pid
        });
    } else if (!quiet) {
        emitText(`Watching ${vaultPath} for ${normalizedEvent}... (Ctrl+C to stop)\n`);
    }

    // Watcher setup with retry-and-backoff: fs.watch can fail or emit an
    // 'error' event on its own (platform-dependent — e.g. certain network
    // filesystems, or a watched directory briefly disappearing) without the
    // parent process crashing. Previously any such failure just silently
    // stopped the watcher forever with no indication anything had gone
    // wrong. Now it retries up to MAX_WATCH_RETRIES times with exponential
    // backoff before giving up for good and exiting non-zero.
    let watchAttempt = 0;
    function startWatcher() {
        try {
            watcher = fs.watch(vaultPath, { recursive: true }, (_eventType, filename) => {
                if (!filename || !filename.endsWith('.md')) return;
                vaultService.notifyFileChange();
            });
            watchAttempt = 0;
            watcher.on('error', handleWatchFailure);
        } catch (err) {
            handleWatchFailure(err);
        }
    }
    function handleWatchFailure(err) {
        if (watcher && typeof watcher.close === 'function') { try { watcher.close(); } catch (_) { /* already dead */ } }
        watchAttempt += 1;
        if (watchAttempt > MAX_WATCH_RETRIES) {
            return emitCliError({
                json,
                error: `Hook watch failed after ${MAX_WATCH_RETRIES} retries: ${err && err.message ? err.message : String(err)}`,
                code: 'INTERNAL_ERROR',
                exitCode: 2
            });
        }
        const delay = backoffMs(watchAttempt - 1);
        if (!json && !quiet) emitText(`[${timeStamp()}] watch error (${err && err.message ? err.message : err}) — retrying in ${Math.round(delay / 1000)}s (attempt ${watchAttempt}/${MAX_WATCH_RETRIES})\n`);
        setTimeout(startWatcher, delay);
    }
    startWatcher();

    function shutdown() {
        if (typeof unsubscribe === 'function') unsubscribe();
        if (watcher && typeof watcher.close === 'function') watcher.close();
        if (!json && !quiet) emitText('Stopped.\n');
        process.exit(0);
    }
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

module.exports = { run, runList, runStop, runSupervisedDaemon };
