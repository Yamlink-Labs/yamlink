'use strict';

const { getFieldsCache } = require('../../core/indexService');
const { getMutationEvents } = require('../../runtime/mutationEventLog');
const { reconstructVaultAtTime } = require('../../core/timeEngine');
const { captureOutput, emitCliError, emitCliSuccess, emitText } = require('../io');
const fmt = require('../format');

const STRUCTURAL_TYPES = new Set([
    'field_added', 'field_changed', 'field_removed', 'type_set',
    'relation_added', 'relation_changed', 'relation_removed'
]);

function typeOf(fields) {
    return String((fields && fields.type) || '').trim().toLowerCase() || 'untyped';
}

/**
 * Calendar-quarter boundaries in UTC, matching this codebase's canonical
 * date handling (see `src/core/date.js`). Q1 = Jan-Mar, Q2 = Apr-Jun, etc.
 * @param {Date} [now]
 * @returns {{ sinceIso: string, label: string }}
 */
function getCurrentQuarterInfo(now = new Date()) {
    const year = now.getUTCFullYear();
    const quarterIndex = Math.floor(now.getUTCMonth() / 3);
    const sinceIso = new Date(Date.UTC(year, quarterIndex * 3, 1, 0, 0, 0, 0)).toISOString();
    return { sinceIso, label: `Q${quarterIndex + 1} ${year}` };
}

/**
 * @param {string} sinceIso
 * @returns {object}
 */
function buildStoryData(sinceIso) {
    const fieldsCache = getFieldsCache();
    const mutationEvents = getMutationEvents();
    const reconstructed = reconstructVaultAtTime(sinceIso, { fieldsCache, mutationEvents });

    let thenNotes = 0;
    let thenIncomplete = 0;
    const thenTypeCounts = new Map();
    for (const [, entry] of reconstructed) {
        if (!entry.exists) continue;
        thenNotes++;
        if (!entry.complete) thenIncomplete++;
        const type = typeOf(entry.fields);
        thenTypeCounts.set(type, (thenTypeCounts.get(type) || 0) + 1);
    }

    let nowNotes = 0;
    const nowTypeCounts = new Map();
    for (const [, fields] of fieldsCache) {
        nowNotes++;
        const type = typeOf(fields);
        nowTypeCounts.set(type, (nowTypeCounts.get(type) || 0) + 1);
    }

    const allTypes = new Set([...thenTypeCounts.keys(), ...nowTypeCounts.keys()]);
    const typeDeltas = [...allTypes]
        .map((type) => ({
            type,
            then: thenTypeCounts.get(type) || 0,
            now: nowTypeCounts.get(type) || 0,
            delta: (nowTypeCounts.get(type) || 0) - (thenTypeCounts.get(type) || 0)
        }))
        .sort((a, b) => b.delta - a.delta || a.type.localeCompare(b.type));

    const windowEvents = mutationEvents.filter((e) => e && e.timestamp >= sinceIso);
    const created = windowEvents.filter((e) => e.type === 'note_created').length;
    const deleted = windowEvents.filter((e) => e.type === 'note_deleted').length;
    const touched = windowEvents.filter((e) => e.type === 'note_touched').length;
    const structuralEdits = windowEvents.filter((e) => STRUCTURAL_TYPES.has(e.type)).length;

    const editCounts = new Map();
    for (const e of windowEvents) {
        if (!e.noteId || !STRUCTURAL_TYPES.has(e.type)) continue;
        editCounts.set(e.noteId, (editCounts.get(e.noteId) || 0) + 1);
    }
    const busiestNotes = [...editCounts.entries()]
        .map(([id, edits]) => ({ id, edits }))
        .sort((a, b) => b.edits - a.edits)
        .slice(0, 5);

    return {
        since: sinceIso,
        now: new Date().toISOString(),
        then: { notes: thenNotes, incompleteReconstructions: thenIncomplete, types: Object.fromEntries(thenTypeCounts) },
        current: { notes: nowNotes, types: Object.fromEntries(nowTypeCounts) },
        typeDeltas,
        activity: { notesCreated: created, notesDeleted: deleted, notesTouched: touched, structuralEdits, totalEvents: windowEvents.length },
        busiestNotes
    };
}

function run({ since, quarterly, json, output }) {
    if (quarterly && String(since || '').trim()) {
        emitCliError({ json, outputPath: output, error: 'Usage: yamlink story --since <date> OR yamlink story --quarterly, not both', code: 'USAGE', exitCode: 1 });
        return;
    }

    let sinceIso;
    let quarterLabel = null;
    if (quarterly) {
        const info = getCurrentQuarterInfo();
        sinceIso = info.sinceIso;
        quarterLabel = info.label;
    } else {
        const raw = String(since || '').trim();
        if (!raw) {
            emitCliError({ json, outputPath: output, error: 'Usage: yamlink story --since <date> (or --quarterly for the current calendar quarter to date)', code: 'USAGE', exitCode: 1 });
            return;
        }
        const parsedMs = Date.parse(raw);
        if (!Number.isFinite(parsedMs)) {
            emitCliError({ json, outputPath: output, error: `Invalid date: ${raw}`, code: 'INVALID_PARAM', exitCode: 1 });
            return;
        }
        sinceIso = new Date(parsedMs).toISOString();
    }

    const data = buildStoryData(sinceIso);
    if (quarterLabel) data.quarter = quarterLabel;

    if (json) {
        emitCliSuccess(data, output);
        return;
    }

    emitText(captureOutput(() => {
        const title = quarterLabel
            ? `Vault Quarterly Review — ${quarterLabel} (since ${data.since.slice(0, 10)})`
            : `Vault Story — since ${data.since.slice(0, 10)}`;
        fmt.header(title);
        if (data.then.incompleteReconstructions > 0) {
            console.log('  ' + fmt.warn(`Note: ${data.then.incompleteReconstructions} note(s) could only be partially reconstructed (mutation log retention limit) — the "then" picture for those may be incomplete.`));
            fmt.blank();
        }

        fmt.subheader('Notes');
        fmt.row('Then', data.then.notes);
        fmt.row('Now', data.current.notes);
        fmt.row('Change', `${data.current.notes - data.then.notes >= 0 ? '+' : ''}${data.current.notes - data.then.notes}`);
        fmt.blank();

        fmt.subheader('Activity since then');
        fmt.row('Notes created', data.activity.notesCreated);
        fmt.row('Notes deleted', data.activity.notesDeleted);
        fmt.row('Notes touched', data.activity.notesTouched);
        fmt.row('Structural edits', data.activity.structuralEdits);
        fmt.blank();

        fmt.subheader('Types (biggest growth first)');
        if (!data.typeDeltas.length) {
            console.log('  (no types recorded)');
        } else {
            for (const t of data.typeDeltas) {
                if (t.then === 0 && t.now === 0) continue;
                const sign = t.delta > 0 ? '+' : '';
                console.log(`  ${t.type.padEnd(20)} ${String(t.then).padStart(4)} → ${String(t.now).padEnd(4)} (${sign}${t.delta})`);
            }
        }
        fmt.blank();

        if (data.busiestNotes.length) {
            fmt.subheader('Busiest notes since then');
            for (const n of data.busiestNotes) {
                console.log(`  ${n.id} — ${n.edits} edit${n.edits === 1 ? '' : 's'}`);
            }
            fmt.blank();
        }
    }), output);
}

module.exports = { run, buildStoryData, getCurrentQuarterInfo };
