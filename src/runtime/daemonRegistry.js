'use strict';

// Persistent registry for `yamlink on --daemon` background watchers — real
// PID tracking so a detached watcher survives its parent terminal closing,
// and so it can be listed/stopped later instead of only ever being killed
// by Ctrl+C in the terminal that started it.

const fs = require('fs');
const path = require('path');

const DAEMON_DIR = path.join('.yamlink', 'hooks');

/** @param {string} vaultPath @returns {string} */
function getDaemonDir(vaultPath) {
    return path.join(vaultPath, DAEMON_DIR);
}

/** @param {string} vaultPath @param {string} id @returns {string} */
function getPidFilePath(vaultPath, id) {
    return path.join(getDaemonDir(vaultPath), `${id}.pid.json`);
}

/** @param {string} vaultPath @param {string} id @returns {string} */
function getLogFilePath(vaultPath, id) {
    return path.join(getDaemonDir(vaultPath), `${id}.log`);
}

/** @returns {string} */
function makeDaemonId() {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const nonce = Math.random().toString(36).slice(2, 8);
    return `daemon-${stamp}-${nonce}`;
}

/**
 * Real PID-liveness check (`kill -0` equivalent) — sending signal 0 doesn't
 * actually kill anything, it only checks whether a process with that PID
 * still exists. Throws ESRCH if it's dead; throws EPERM if it exists but is
 * owned by another user (still alive, just not ours to signal) — both
 * distinguished explicitly rather than treating any throw as "dead."
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err && err.code === 'EPERM';
    }
}

/**
 * @param {string} vaultPath
 * @param {string} id
 * @param {{ pid: number, event: string, noteType: string|null, script: string, startedAt: string }} info
 * @returns {void}
 */
function writeDaemonRecord(vaultPath, id, info) {
    const dir = getDaemonDir(vaultPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getPidFilePath(vaultPath, id), JSON.stringify({ id, ...info }, null, 2) + '\n', 'utf8');
}

/**
 * @param {string} vaultPath
 * @param {string} id
 * @returns {{ id: string, pid: number, event: string, noteType: string|null, script: string, startedAt: string }|null}
 */
function readDaemonRecord(vaultPath, id) {
    const filePath = getPidFilePath(vaultPath, id);
    if (!fs.existsSync(filePath)) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || !Number.isFinite(parsed.pid)) return null;
        return parsed;
    } catch (_) {
        return null;
    }
}

/** @param {string} vaultPath @param {string} id @returns {void} */
function removeDaemonRecord(vaultPath, id) {
    try { fs.unlinkSync(getPidFilePath(vaultPath, id)); } catch (_) { /* already gone */ }
}

/**
 * Lists every registered daemon record, checking real liveness for each and
 * pruning stale (dead-process) records as it goes — a `--list` call always
 * reflects real current state, never a leftover file from a crash.
 * @param {string} vaultPath
 * @returns {Array<{ id: string, pid: number, alive: boolean, event: string, noteType: string|null, script: string, startedAt: string, logPath: string }>}
 */
function listDaemons(vaultPath) {
    const dir = getDaemonDir(vaultPath);
    if (!fs.existsSync(dir)) return [];
    let files;
    try { files = fs.readdirSync(dir); } catch (_) { return []; }

    const results = [];
    for (const file of files) {
        if (!file.endsWith('.pid.json')) continue;
        const id = file.slice(0, -'.pid.json'.length);
        const record = readDaemonRecord(vaultPath, id);
        if (!record) continue;
        const alive = isProcessAlive(record.pid);
        if (!alive) removeDaemonRecord(vaultPath, id);
        results.push({ ...record, id, alive, logPath: getLogFilePath(vaultPath, id) });
    }
    return results.sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = {
    getDaemonDir,
    getPidFilePath,
    getLogFilePath,
    makeDaemonId,
    isProcessAlive,
    writeDaemonRecord,
    readDaemonRecord,
    removeDaemonRecord,
    listDaemons
};
