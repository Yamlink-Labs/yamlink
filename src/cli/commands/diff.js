'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getMutationEvents } = require('../../runtime/mutationEventLog');
const { buildCliDiff } = require('../../core/noteDiff');
const { captureOutput, emitCliError, emitCliSuccess, emitText } = require('../io');
const fmt = require('../format');

function buildChangesSince(since) {
    const fieldsCache = getFieldsCache();
    const grouped = new Map();
    const events = getMutationEvents({ since, limit: 10000 });

    for (const event of events) {
        if (!event || !event.noteId || !event.field) continue;
        if (event.type !== 'field_changed' && event.type !== 'relation_added' && event.type !== 'relation_changed' && event.type !== 'relation_removed' && event.type !== 'field_added' && event.type !== 'field_removed' && event.type !== 'type_set') continue;

        if (!grouped.has(event.noteId)) grouped.set(event.noteId, new Map());
        const byField = grouped.get(event.noteId);
        if (!byField.has(event.field)) {
            byField.set(event.field, { from: event.oldValue ?? null, to: event.newValue ?? null });
        } else {
            byField.get(event.field).to = event.newValue ?? null;
        }
    }

    return Array.from(grouped.entries()).map(([id, fieldMap]) => ({
        id,
        type: (fieldsCache.get(id) || {}).type || null,
        fields: Object.fromEntries(Array.from(fieldMap.entries()))
    }));
}

function run({ id1, id2, since, json, quiet, output }) {
    const sinceDate = String(since || '').trim();
    const leftId = String(id1 || '').trim();
    const rightId = String(id2 || '').trim();
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();

    if (sinceDate) {
        const changes = buildChangesSince(sinceDate);
        const payload = { since: sinceDate, count: changes.length, changes };

        if (json) {
            emitCliSuccess(payload, output);
            return;
        }

        emitText(captureOutput(() => {
            if (!quiet) fmt.header(`Diff since ${sinceDate}`);
            if (!changes.length) {
                console.log('  (no field changes)');
                fmt.blank();
                return;
            }

            for (const entry of changes) {
                const label = entry.type ? `${entry.id} (${entry.type})` : entry.id;
                fmt.subheader(label);
                for (const [field, delta] of Object.entries(entry.fields)) {
                    console.log(`  ~ ${field}`);
                    console.log(`      from: ${delta.from}`);
                    console.log(`      to:   ${delta.to}`);
                }
                fmt.blank();
            }
        }), output);
        return;
    }

    if (!leftId || !rightId) {
        emitCliError({
            json,
            outputPath: output,
            error: 'Usage: yamlink diff <id1> <id2> | yamlink diff --since <date>',
            code: 'USAGE',
            exitCode: 1
        });
        return;
    }
    if (!idIndex.has(leftId)) {
        emitCliError({ json, outputPath: output, error: `Note not found: ${leftId}`, code: 'NOT_FOUND', exitCode: 1 });
        return;
    }
    if (!idIndex.has(rightId)) {
        emitCliError({ json, outputPath: output, error: `Note not found: ${rightId}`, code: 'NOT_FOUND', exitCode: 1 });
        return;
    }

    const diff = buildCliDiff(leftId, rightId, fieldsCache.get(leftId) || {}, fieldsCache.get(rightId) || {});

    if (json) {
        emitCliSuccess(diff, output);
        return;
    }

    emitText(captureOutput(() => {
        if (!quiet) fmt.header(`Diff: ${leftId} ↔ ${rightId}`);

        fmt.subheader(`Only in ${leftId}`);
        const leftOnlyKeys = Object.keys(diff.onlyIn1);
        if (!leftOnlyKeys.length) console.log('  (none)');
        else leftOnlyKeys.forEach((field) => console.log(`  - ${field}: ${diff.onlyIn1[field]}`));

        fmt.blank();
        fmt.subheader(`Only in ${rightId}`);
        const rightOnlyKeys = Object.keys(diff.onlyIn2);
        if (!rightOnlyKeys.length) console.log('  (none)');
        else rightOnlyKeys.forEach((field) => console.log(`  + ${field}: ${diff.onlyIn2[field]}`));

        fmt.blank();
        fmt.subheader('Changed');
        if (!diff.changed.length) {
            console.log('  (none)');
        } else {
            for (const entry of diff.changed) {
                console.log(`  ~ ${entry.field}`);
                console.log(`      ${leftId}: ${entry.value1}`);
                console.log(`      ${rightId}: ${entry.value2}`);
            }
        }

        fmt.blank();
    }), output);
}

module.exports = { run };
