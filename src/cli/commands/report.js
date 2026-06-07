'use strict';

const { getIndex, getFieldsCache, getVaultGeneration } = require('../../core/indexService');
const { getEdges, getBacklinks } = require('../../core/graph');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { inferLifecycleState } = require('../../intelligence/lifecycleState');
const { computeNoteDrift } = require('../../intelligence/driftDetector');
const fmt = require('../format');

function run({ id, json }) {
    const idIndex     = getIndex();
    const fieldsCache = getFieldsCache();

    if (!idIndex.has(id)) {
        console.error(fmt.err('Note not found: ' + id));
        console.error('Run ' + fmt.c.bold('yamlink health') + ' to see all indexed IDs.');
        process.exit(1);
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
            driftState = drift.driftLabel;
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
    };

    if (json) { console.log(JSON.stringify(data, null, 2)); return; }

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

    fmt.blank();
}

module.exports = { run };
