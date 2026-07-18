'use strict';

const { getIndex, getFieldsCache, extractRelationTargets } = require('../../core/indexService');
const { getEdges, getBacklinks } = require('../../core/graph');
const { reconstructNoteAtTime } = require('../../core/timeEngine');
const { getMutationEvents } = require('../../runtime/mutationEventLog');
const fmt = require('../format');
const { captureOutput, emitCliError, emitCliSuccess, emitText } = require('../io');

function run({ id, json, output, at }) {
    const idIndex     = getIndex();
    const fieldsCache = getFieldsCache();

    if (at) {
        const parsedMs = Date.parse(at);
        if (!Number.isFinite(parsedMs)) {
            emitCliError({ json, outputPath: output, error: `Invalid date: ${at}`, code: 'INVALID_PARAM', exitCode: 1 });
            return;
        }
        const sinceIso = new Date(parsedMs).toISOString();
        const currentFields = idIndex.has(id) ? (fieldsCache.get(id) || {}) : null;
        const events = getMutationEvents({ noteId: id });
        const result = reconstructNoteAtTime(id, sinceIso, currentFields, events);

        if (!result.exists) {
            emitCliError({
                json, outputPath: output,
                error: `Note did not exist at ${sinceIso}: ${id}`,
                code: 'NOT_FOUND', exitCode: 1,
                details: { id, reason: result.reason, earliestReconstructableTimestamp: result.earliestReconstructableTimestamp }
            });
            return;
        }

        const outbound = [];
        for (const [field, value] of Object.entries(result.fields || {})) {
            if (!field || field === 'id' || field === 'type' || field.startsWith('__')) continue;
            for (const targetId of extractRelationTargets(value)) outbound.push({ field, to: targetId });
        }

        const data = {
            id, at: sinceIso, exists: true,
            outbound,
            complete: result.complete,
            earliestReconstructableTimestamp: result.earliestReconstructableTimestamp
        };

        if (json) {
            emitCliSuccess(data, output);
            return;
        }

        emitText(captureOutput(() => {
            fmt.header(`Links: ${id} (as of ${sinceIso})`);
            if (!data.complete) console.log('  ' + fmt.warn(`Note: only guaranteed accurate back to ${data.earliestReconstructableTimestamp}`));
            fmt.row('Outbound', outbound.length);
            if (outbound.length) {
                fmt.blank();
                fmt.subheader('Outbound');
                fmt.table(outbound.map((e) => ({ field: e.field, to: e.to })), [
                    { key: 'field', label: 'field' },
                    { key: 'to', label: 'to' }
                ]);
            }
            fmt.blank();
            console.log('  (Inbound links at a point in time require reconstructing the whole vault — use `yamlink graph --at ' + sinceIso + '` for that.)');
            fmt.blank();
        }), output);
        return;
    }

    if (!idIndex.has(id)) {
        emitCliError({
            json,
            outputPath: output,
            error: 'Note not found: ' + id,
            code: 'NOT_FOUND',
            details: { id },
            exitCode: 1
        });
        return;
    }

    const outbound = getEdges(id) || [];
    const inbound  = getBacklinks(id) || [];

    const data = {
        id,
        outbound: outbound.map(e => ({
            field:  e.field,
            to:     e.targetId,
            type:   (fieldsCache.get(e.targetId) || {}).type || null,
            exists: idIndex.has(e.targetId),
        })),
        inbound: inbound.map(e => ({
            field: e.field,
            from:  e.sourceId,
            type:  (fieldsCache.get(e.sourceId) || {}).type || null,
        })),
    };

    if (json) {
        emitCliSuccess(data, output);
        return;
    }

    emitText(captureOutput(() => {
        fmt.header('Links: ' + id);
        fmt.row('Outbound', outbound.length);
        fmt.row('Inbound',  inbound.length);

        if (data.outbound.length) {
            fmt.blank();
            fmt.subheader('Outbound');
            fmt.table(
                data.outbound.map(e => ({
                    field: e.field,
                    to:    e.exists ? e.to : fmt.warn(e.to + ' ⚠'),
                    type:  e.type || '—',
                })),
                [
                    { key: 'field', label: 'field' },
                    { key: 'to',    label: 'to' },
                    { key: 'type',  label: 'type' },
                ]
            );
        }

        if (data.inbound.length) {
            fmt.blank();
            fmt.subheader('Inbound');
            fmt.table(
                data.inbound.map(e => ({
                    field: e.field,
                    from:  e.from,
                    type:  e.type || '—',
                })),
                [
                    { key: 'field', label: 'field' },
                    { key: 'from',  label: 'from' },
                    { key: 'type',  label: 'type' },
                ]
            );
        }

        fmt.blank();
    }), output);
}

module.exports = { run };
