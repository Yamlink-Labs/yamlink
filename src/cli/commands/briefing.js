'use strict';

const fs = require('fs');
const path = require('path');

const { getIndex, getFieldsCache, getVaultGeneration } = require('../../core/indexService');
const { getEdges, getGraphStats } = require('../../core/graph');
const { getRegistryStats } = require('../../registries/typeRegistry');
const { buildTaskRows } = require('../../core/tasks');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { buildNoteArc } = require('../../intelligence/noteArc');
const { computeVaultDrift, getDriftSummary } = require('../../intelligence/driftDetector');
const fmt = require('../format');
const { captureOutput, emitCliSuccess, emitText } = require('../io');

function truncate(text, maxLength) {
    const value = String(text || '').trim();
    if (value.length <= maxLength) return value;
    return value.slice(0, Math.max(0, maxLength - 3)).trimEnd() + '...';
}

function getTodayIso() {
    return new Date().toISOString().slice(0, 10);
}

function collectBrokenLinks(idIndex) {
    let brokenLinks = 0;
    for (const [id] of idIndex) {
        for (const edge of getEdges(id) || []) {
            if (!idIndex.has(edge.targetId)) brokenLinks++;
        }
    }
    return brokenLinks;
}

function collectTasks(idIndex) {
    const todayIso = getTodayIso();
    const rows = buildTaskRows(idIndex, 0);
    const overdue = [];
    const today = [];

    for (const row of rows) {
        if (row.done || !row.date) continue;
        const entry = {
            text: truncate(row.displayText, 60),
            noteId: row.fields.file,
            date: row.date
        };
        if (row.date < todayIso) overdue.push(entry);
        else if (row.date === todayIso) today.push(entry);
    }

    overdue.sort((a, b) => a.date.localeCompare(b.date) || a.noteId.localeCompare(b.noteId));
    today.sort((a, b) => a.noteId.localeCompare(b.noteId) || a.text.localeCompare(b.text));

    return {
        overdue: overdue.slice(0, 10),
        today: today.slice(0, 10)
    };
}

function formatRelativeTime(timestamp) {
    const value = new Date(timestamp).getTime();
    if (!Number.isFinite(value)) return 'unknown';
    const diffMs = Math.max(0, Date.now() - value);
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    return days + 'd ago';
}

function humanEventLabel(type) {
    switch (String(type || '').trim()) {
    case 'note_created': return 'Created';
    case 'note_deleted': return 'Deleted';
    case 'field_added': return 'Added';
    case 'field_changed': return 'Updated';
    case 'field_removed': return 'Removed';
    case 'relation_added': return 'Linked';
    case 'relation_changed': return 'Relinked';
    case 'relation_removed': return 'Unlinked';
    case 'type_set': return 'Typed';
    case 'task_status_changed': return 'Task';
    default: return String(type || 'Event');
    }
}

function readMutationLog(vaultPath) {
    const logPath = path.join(vaultPath, '.yamlink', 'mutation-log.ndjson');
    if (!fs.existsSync(logPath)) return [];

    let raw;
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

function readRecentActivity(vaultPath) {
    const skipped = new Set(['completion_accepted', 'lightbulb_applied']);
    return readMutationLog(vaultPath)
        .filter((event) => !skipped.has(event.type))
        .map((event) => ({
            timestamp: event.timestamp || null,
            relativeTime: formatRelativeTime(event.timestamp),
            type: event.type || 'event',
            label: humanEventLabel(event.type),
            noteId: event.noteId || '',
            field: event.field || null,
            newValue: event.newValue ?? null
        }))
        .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
        .slice(0, 8);
}

function buildArcPredictions(vaultPath, fieldsCache, priors) {
    const todayIsoStart = getTodayIso() + 'T00:00:00.000Z';
    const touchedIds = [];
    const seen = new Set();
    for (const event of readMutationLog(vaultPath)) {
        if (!event || !event.noteId || !event.timestamp) continue;
        if (String(event.timestamp) < todayIsoStart) continue;
        if (seen.has(event.noteId)) continue;
        seen.add(event.noteId);
        touchedIds.push(event.noteId);
        if (touchedIds.length >= 5) break;
    }

    const predictions = [];
    for (const noteId of touchedIds) {
        const fields = fieldsCache.get(noteId);
        const noteType = String(fields?.type || '').trim().toLowerCase();
        if (!fields || !noteType || !priors.typeFieldBundles?.has(noteType)) continue;
        const arc = buildNoteArc(
            fields,
            noteType,
            fieldsCache,
            priors.typeFieldBundles,
            priors.fieldTargetTypes,
            priors.outcomeCalibration
        );
        const topMissing = arc.missingFields?.[0];
        if (!topMissing) continue;
        predictions.push({ noteId, missingField: topMissing.field });
        if (predictions.length >= 3) break;
    }
    return predictions;
}

function buildDriftFlag(fieldsCache, priors) {
    const vaultDrift = computeVaultDrift(fieldsCache, priors);
    const summary = getDriftSummary(vaultDrift);
    if (summary.total < 5) return null;
    const rate = (summary.drifting + summary.outliers) / Math.max(1, summary.total);
    return {
        triggered: rate > 0.30,
        rate,
        drifting: summary.drifting,
        outliers: summary.outliers,
        total: summary.total
    };
}

function run({ json, vaultPath, output }) {
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const graphStats = getGraphStats();
    const registryStats = getRegistryStats();
    const pulse = {
        notes: idIndex.size,
        edges: graphStats?.totalEdges ?? 0,
        types: registryStats?.uniqueTypes ?? 0,
        brokenLinks: collectBrokenLinks(idIndex)
    };
    const tasks = collectTasks(idIndex);
    const recentActivity = readRecentActivity(vaultPath);
    const arcPredictions = buildArcPredictions(vaultPath, fieldsCache, priors);
    const driftFlag = buildDriftFlag(fieldsCache, priors);

    if (json) {
        emitCliSuccess({
            pulse,
            tasks,
            activity: recentActivity,
            recentActivity,
            arcPredictions,
            driftFlag
        }, output);
        return;
    }
    emitText(captureOutput(() => {
        fmt.header('Briefing');
        fmt.subheader('Vault pulse');
        fmt.row('Notes', pulse.notes);
        fmt.row('Edges', pulse.edges);
        fmt.row('Types', pulse.types);
        fmt.row('Broken links', pulse.brokenLinks);

        fmt.blank();
        fmt.subheader('Tasks due');
        if (tasks.overdue.length) {
            fmt.row('Overdue', tasks.overdue.length);
            fmt.table(tasks.overdue, [
                { key: 'date', label: 'date' },
                { key: 'text', label: 'task' },
                { key: 'noteId', label: 'note' }
            ]);
        } else {
            fmt.row('Overdue', fmt.ok('none'));
        }

        fmt.blank();
        if (tasks.today.length) {
            fmt.row('Today', tasks.today.length);
            fmt.table(tasks.today, [
                { key: 'date', label: 'date' },
                { key: 'text', label: 'task' },
                { key: 'noteId', label: 'note' }
            ]);
        } else {
            fmt.row('Today', fmt.ok('none'));
        }

        fmt.blank();
        fmt.subheader('Recent activity');
        if (recentActivity.length) {
            fmt.table(recentActivity.map((event) => ({
                when: event.relativeTime,
                action: event.label,
                note: event.noteId
            })), [
                { key: 'when', label: 'when' },
                { key: 'action', label: 'action' },
                { key: 'note', label: 'note' }
            ]);
        } else {
            fmt.row('Activity', fmt.warn('no mutation log yet'));
        }

        if (arcPredictions.length) {
            fmt.blank();
            fmt.subheader('Arc predictions');
            for (const entry of arcPredictions) {
                console.log(`  · ${entry.noteId}: likely missing "${entry.missingField}"`);
            }
        }

        if (driftFlag && driftFlag.triggered) {
            const pct = Math.round(driftFlag.rate * 100);
            fmt.blank();
            console.log(`  ${fmt.warn('⚠')} Drift: ${pct}% of typed notes structurally off-pattern`);
        }
        fmt.blank();
    }), output);
}

module.exports = { run };
