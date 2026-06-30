'use strict';

// Lightweight broken-link + orphan count snapshot.
// Appended to .yamlink/health-snapshots.ndjson on every buildIndex call.
// Deduped to one entry per calendar day; pruned to MAX_SNAPSHOTS entries.

const fs   = require('fs');
const path = require('path');

const SNAPSHOT_FILE  = 'health-snapshots.ndjson';
const MAX_SNAPSHOTS  = 30;
const LOOKBACK_COUNT = 7;

/** @param {string} yamLinkDir @param {{ broken: number, orphans: number }} data */
function appendHealthSnapshot(yamLinkDir, { broken, orphans }) {
    try {
        const file  = path.join(yamLinkDir, SNAPSHOT_FILE);
        const today = new Date().toISOString().slice(0, 10);

        let lines = [];
        try {
            lines = fs.readFileSync(file, 'utf8')
                .split('\n')
                .filter(Boolean)
                .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
                .filter(Boolean);
        } catch (_) {}

        lines = lines.filter(l => l.date !== today);
        lines.push({ date: today, broken, orphans, ts: Date.now() });
        if (lines.length > MAX_SNAPSHOTS) lines = lines.slice(-MAX_SNAPSHOTS);

        fs.mkdirSync(yamLinkDir, { recursive: true });
        fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
    } catch (_) {}
}

/**
 * Read recent snapshots and compute directional trend.
 * @param {string} yamLinkDir
 * @returns {{
 *   brokenTrend: 'up'|'down'|'same'|null,
 *   orphanTrend:  'up'|'down'|'same'|null,
 *   brokenDelta:  number|null,
 *   orphanDelta:  number|null,
 *   snapshotCount: number
 * }}
 */
function readHealthSnapshotTrend(yamLinkDir) {
    try {
        const file  = path.join(yamLinkDir, SNAPSHOT_FILE);
        const lines = fs.readFileSync(file, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
            .filter(Boolean)
            .sort((a, b) => (a.ts || 0) - (b.ts || 0));

        if (lines.length < 2) {
            return { brokenTrend: null, orphanTrend: null, brokenDelta: null, orphanDelta: null, snapshotCount: lines.length };
        }

        const recent   = lines[lines.length - 1];
        const baseline = lines[Math.max(0, lines.length - 1 - LOOKBACK_COUNT)];

        const brokenDelta = recent.broken  - baseline.broken;
        const orphanDelta = recent.orphans - baseline.orphans;

        return {
            brokenTrend:   brokenDelta > 0 ? 'up' : brokenDelta < 0 ? 'down' : 'same',
            orphanTrend:   orphanDelta > 0 ? 'up' : orphanDelta < 0 ? 'down' : 'same',
            brokenDelta,
            orphanDelta,
            snapshotCount: lines.length
        };
    } catch (_) {
        return { brokenTrend: null, orphanTrend: null, brokenDelta: null, orphanDelta: null, snapshotCount: 0 };
    }
}

module.exports = { appendHealthSnapshot, readHealthSnapshotTrend };
