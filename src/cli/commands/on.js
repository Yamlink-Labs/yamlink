'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const fmt = require('../format');
const { emitCliError, emitJson, emitText } = require('../io');

const VALID_EVENTS = new Set([
    'note_created',
    'type_set',
    'field_added',
    'field_changed',
    'field_removed',
    'relation_added',
    'relation_changed',
    'relation_removed'
]);

function timeStamp() {
    return new Date().toTimeString().slice(0, 8);
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
    if (!VALID_EVENTS.has(normalizedEvent)) {
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

    try {
        watcher = fs.watch(vaultPath, { recursive: true }, (_eventType, filename) => {
            if (!filename || !filename.endsWith('.md')) return;
            vaultService.notifyFileChange();
        });
    } catch (err) {
        emitCliError({ json, error: 'Hook watch failed: ' + err.message, code: 'INTERNAL_ERROR', exitCode: 2 });
    }

    process.on('SIGINT', () => {
        if (typeof unsubscribe === 'function') unsubscribe();
        if (watcher && typeof watcher.close === 'function') watcher.close();
        if (!json && !quiet) emitText('Stopped.\n');
        process.exit(0);
    });
}

module.exports = { run };
