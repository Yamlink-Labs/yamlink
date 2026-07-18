'use strict';

const { getIndex, getFieldsCache, getVaultGeneration, extractRelationTargets } = require('../../core/indexService');
const { getEdges, getBacklinks } = require('../../core/graph');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { inferLifecycleState } = require('../../intelligence/lifecycleState');
const { computeNoteDrift } = require('../../intelligence/driftDetector');
const { getMutationEvents } = require('../../runtime/mutationEventLog');
const { buildNoteEvolution } = require('../../intelligence/noteEvolution');
const { reconstructNoteAtTime } = require('../../core/timeEngine');
const fmt = require('../format');
const { captureOutput, emitCliError, emitCliSuccess, emitText } = require('../io');

function run({ id, json, output, history = false, at }) {
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
            type: result.fields ? (result.fields.type || null) : null,
            fields: result.fields,
            outbound,
            complete: result.complete,
            earliestReconstructableTimestamp: result.earliestReconstructableTimestamp,
            ...(result.reason ? { reason: result.reason } : {}),
            ...(result.deletedAt ? { deletedAt: result.deletedAt } : {})
        };

        if (json) {
            emitCliSuccess(data, output);
            return;
        }

        emitText(captureOutput(() => {
            fmt.header(`Note Report: ${id} (as of ${sinceIso})`);
            if (!data.fields) {
                console.log(`  Existed then, deleted since${data.deletedAt ? ' at ' + data.deletedAt : ''} — content unrecoverable.`);
                fmt.blank();
                return;
            }
            if (data.type) fmt.row('Type', data.type);
            if (!data.complete) console.log('  ' + fmt.warn(`Note: only guaranteed accurate back to ${data.earliestReconstructableTimestamp}`));
            fmt.row('Outbound links', outbound.length);
            if (outbound.length) {
                fmt.blank();
                fmt.subheader('Outbound');
                for (const edge of outbound) fmt.row('  ' + edge.field, edge.to);
            }
            fmt.blank();
            console.log('  (Lifecycle/drift/inbound/history are live-vault inferences and are not available for a historical snapshot — use `yamlink report ' + id + '` without --at for those.)');
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

    const noteFields   = fieldsCache.get(id) || {};
    const outbound     = getEdges(id) || [];
    const inbound      = getBacklinks(id) || [];

    let lifecycleState = null;
    let driftState     = null;

    try {
        const priors = getCachedPriors(fieldsCache, getVaultGeneration());
        const noteIds = Array.from(idIndex.keys());
        let totalInbound = 0;
        for (const nid of noteIds) totalInbound += (getBacklinks(nid) || []).length;
        const avgInbound = noteIds.length > 0 ? totalInbound / noteIds.length : 0;

        const lc = inferLifecycleState(id, noteFields, {
            fieldsCache, idIndex,
            typeFieldBundles:   priors.typeFieldBundles,
            noteRoleTypePriors: priors.noteRoleTypePriors,
            inboundCount: inbound.length,
            avgInbound,
        });
        lifecycleState = lc?.label || null;

        const drift = computeNoteDrift(id, noteFields, fieldsCache, priors);
        if (drift && !drift.insufficientData && drift.driftLabel && drift.driftLabel !== 'on-track') {
            driftState = drift.driftLabelHuman || drift.driftLabel;
        }
    } catch (_) {}

    // Group by field
    const outboundByField = {};
    for (const e of outbound) {
        if (!outboundByField[e.field]) outboundByField[e.field] = [];
        outboundByField[e.field].push(e.targetId);
    }
    const inboundByField = {};
    for (const e of inbound) {
        if (!inboundByField[e.field]) inboundByField[e.field] = [];
        inboundByField[e.field].push(e.sourceId);
    }

    const data = {
        id,
        type:          noteFields.type || null,
        lifecycle:     lifecycleState,
        drift:         driftState,
        inboundCount:  inbound.length,
        outboundCount: outbound.length,
        outbound:      outbound.map(e => ({ field: e.field, to: e.targetId })),
        inbound:       inbound.map(e => ({ field: e.field, from: e.sourceId })),
        fields:        Object.fromEntries(
            Object.entries(noteFields).filter(([k]) => !k.startsWith('__'))
        ),
        evolution: history ? buildNoteEvolution(id, getMutationEvents({ noteId: id, limit: 500 })) : null
    };

    if (json) {
        emitCliSuccess(data, output);
        return;
    }

    emitText(captureOutput(() => {
        fmt.header('Note Report: ' + id);
        if (data.type)      fmt.row('Type',           data.type);
        if (lifecycleState) fmt.row('Lifecycle',       lifecycleState);
        if (driftState)     fmt.row('Drift',           fmt.warn(driftState));
        fmt.row('Outbound links', data.outboundCount);
        fmt.row('Inbound links',  data.inboundCount);

        if (Object.keys(outboundByField).length) {
            fmt.blank();
            fmt.subheader('Outbound');
            for (const [field, targets] of Object.entries(outboundByField)) {
                fmt.row('  ' + field, targets.join(', '));
            }
        }

        if (Object.keys(inboundByField).length) {
            fmt.blank();
            fmt.subheader('Inbound');
            for (const [field, sources] of Object.entries(inboundByField)) {
                fmt.row('  ' + field, sources.join(', '));
            }
        }

        if (history && data.evolution) {
            fmt.blank();
            fmt.subheader('History');
            fmt.row('Created', data.evolution.created || '—');
            fmt.row('First type', data.evolution.typeSet || '—');
            fmt.row('First fields', data.evolution.firstFields.join(', ') || '—');
            fmt.row('Stable fields', data.evolution.stableFields.join(', ') || '—');
            fmt.row('Unstable fields', data.evolution.unstableFields.map((item) => `${item.field} (${item.changeCount})`).join(', ') || '—');
            fmt.row('Relations formed', data.evolution.relationsFormed.map((item) => `${item.field} → ${item.target}`).join(', ') || '—');
            fmt.row('Total edits', data.evolution.totalEdits);
            fmt.row('Last activity', data.evolution.lastActivity || '—');
        }

        fmt.blank();
    }), output);
}

module.exports = { run };
