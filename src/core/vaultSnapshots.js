'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @typedef {{ timestamp: string, notes: Record<string, Record<string, any>|null> }} VaultSnapshot
 */

// Persistence for Time Engine snapshots — see docs/architecture/TIME-ENGINE.md
// "Known Limits" for the problem this solves. The mutation log's 10,000-event
// rolling cap means raw deltas older than the retained window are simply
// dropped; without a snapshot, everything before that boundary becomes
// permanently unreconstructable. A snapshot is a full `noteId -> fields`
// state captured at the exact moment a batch of old deltas is about to be
// pruned, so that boundary timestamp remains reconstructable forever, even
// though continuous arbitrary-date reconstruction still ends at that
// boundary (see reconstructNoteAtTime's `snapshots` param in timeEngine.js
// for the exact honesty contract this provides).
//
// Deliberately pure I/O, no reconstruction logic — mirrors how
// mutationEventLog.js only persists raw events and leaves all interpretation
// to timeEngine.js. Kept as a sibling of timeEngine.js rather than folded
// into it so timeEngine.js stays dependency-free (no fs/path imports).

/**
 * @param {string|null} snapshotPath
 * @param {string} timestamp
 * @param {Record<string, Record<string, any>|null>} notes
 * @returns {void}
 */
function appendVaultSnapshot(snapshotPath, timestamp, notes) {
    if (!snapshotPath) return;
    try {
        fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
        fs.appendFileSync(snapshotPath, `${JSON.stringify({ timestamp, notes })}\n`, 'utf8');
    } catch (_) {}
}

/**
 * @param {string|null} snapshotPath
 * @returns {VaultSnapshot[]} sorted ascending by timestamp
 */
function loadVaultSnapshots(snapshotPath) {
    if (!snapshotPath || !fs.existsSync(snapshotPath)) return [];
    try {
        const lines = fs.readFileSync(snapshotPath, 'utf8').split('\n').filter(Boolean);
        const snapshots = [];
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line);
                if (parsed && typeof parsed.timestamp === 'string' && parsed.notes && typeof parsed.notes === 'object') {
                    snapshots.push(parsed);
                }
            } catch (_) {}
        }
        snapshots.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
        return snapshots;
    } catch (_) {
        return [];
    }
}

const REDACTED_VALUE = '[redacted]';

/**
 * Replaces a field's value, wherever it appears across every persisted
 * snapshot, with a fixed redaction marker — in place, rewriting the whole
 * file. A snapshot is a full `noteId -> fields` state at one point in time
 * (see appendVaultSnapshot above), not a per-field delta, so a field that
 * was ever set on a note at the moment of a snapshot boundary has its raw
 * value sitting in this file too — purging a sensitive field from the
 * mutation log alone (mutationEventLog.js's own `oldValue`/`newValue`) is
 * not a complete purge without also redacting it here. Keeps every other
 * field on every note untouched, and keeps the note's entry in the snapshot
 * at all (vs. deleting it outright) — a snapshot exists to answer "did this
 * note exist, with what other fields, at this timestamp," which stays true
 * and useful even with one field's value redacted.
 * @param {string|null} snapshotPath
 * @param {string} field
 * @param {string|null} [noteId] - when given, only this note's entries are redacted
 * @returns {number} how many individual (snapshot, note) entries were redacted
 */
function redactFieldInSnapshots(snapshotPath, field, noteId) {
    if (!snapshotPath || !field) return 0;
    const snapshots = loadVaultSnapshots(snapshotPath);
    if (!snapshots.length) return 0;

    let redactedCount = 0;
    for (const snapshot of snapshots) {
        for (const [snapshotNoteId, fields] of Object.entries(snapshot.notes || {})) {
            if (noteId && snapshotNoteId !== noteId) continue;
            if (fields && typeof fields === 'object' && Object.prototype.hasOwnProperty.call(fields, field) && fields[field] !== REDACTED_VALUE) {
                fields[field] = REDACTED_VALUE;
                redactedCount++;
            }
        }
    }

    if (redactedCount > 0) {
        try {
            fs.writeFileSync(snapshotPath, snapshots.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');
        } catch (_) { return 0; }
    }
    return redactedCount;
}

module.exports = { appendVaultSnapshot, loadVaultSnapshots, redactFieldInSnapshots, REDACTED_VALUE };
