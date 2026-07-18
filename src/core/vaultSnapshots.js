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

module.exports = { appendVaultSnapshot, loadVaultSnapshots };
