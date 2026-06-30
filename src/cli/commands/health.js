'use strict';

const { getIndex, getFieldsCache, getVaultGeneration } = require('../../core/indexService');
const { getEdges, getBacklinks, getGraphStats } = require('../../core/graph');
const { getRegistryStats } = require('../../registries/typeRegistry');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { inferLifecycleState } = require('../../intelligence/lifecycleState');
const { computeVaultDrift, getDriftSummary } = require('../../intelligence/driftDetector');
const fmt = require('../format');
const { captureOutput, emitCliSuccess, emitText } = require('../io');

function run({ json, output }) {
    const idIndex     = getIndex();
    const fieldsCache = getFieldsCache();
    const priors      = getCachedPriors(fieldsCache, getVaultGeneration());
    const graphStats  = getGraphStats();
    const regStats    = getRegistryStats();

    // Broken links — edges pointing to IDs not in index
    let brokenLinks = 0;
    for (const [id] of idIndex) {
        for (const edge of getEdges(id) || []) {
            if (!idIndex.has(edge.targetId)) brokenLinks++;
        }
    }

    // avgInbound for lifecycle hub threshold
    const noteIds = Array.from(idIndex.keys());
    let totalInbound = 0;
    for (const id of noteIds) totalInbound += (getBacklinks(id) || []).length;
    const avgInbound = noteIds.length > 0 ? totalInbound / noteIds.length : 0;

    // Lifecycle counts
    const lifecycle = { hub: 0, consolidated: 0, growing: 0, draft: 0, stale: 0 };
    for (const id of noteIds) {
        const noteFields   = fieldsCache.get(id) || {};
        const inboundCount = (getBacklinks(id) || []).length;
        try {
            const lc = inferLifecycleState(id, noteFields, {
                fieldsCache, idIndex,
                fieldTargetTypes:   priors.fieldTargetTypes,
                typeFieldBundles:   priors.typeFieldBundles,
                noteRoleTypePriors: priors.noteRoleTypePriors,
                noteType:           (noteFields.type || '').trim().toLowerCase(),
                inboundCount, avgInbound,
            });
            if (lc?.state && lifecycle[lc.state] !== undefined) lifecycle[lc.state]++;
        } catch (_) {}
    }

    // Drift summary
    let drift = null;
    try {
        drift = getDriftSummary(computeVaultDrift(fieldsCache, priors));
    } catch (_) {}

    const data = {
        notes:       idIndex.size,
        types:       regStats?.uniqueTypes ?? 0,
        links:       graphStats?.totalEdges ?? 0,
        brokenLinks,
        lifecycle,
        drift: drift ? {
            onTrack:    drift.onTrack,
            minorDrift: drift.minorDrift,
            drifting:   drift.drifting,
            outliers:   drift.outliers,
        } : null,
    };

    if (json) {
        emitCliSuccess(data, output);
        return;
    }

    emitText(captureOutput(() => {
        fmt.header('Vault Health');
        fmt.row('Notes',        data.notes);
        fmt.row('Types',        data.types);
        fmt.row('Links',        data.links);
        fmt.row('Broken links', brokenLinks > 0 ? fmt.warn(String(brokenLinks)) : fmt.ok('0'));

        fmt.blank();
        fmt.subheader('Lifecycle');
        fmt.row('  hub',          lifecycle.hub);
        fmt.row('  consolidated', lifecycle.consolidated);
        fmt.row('  growing',      lifecycle.growing);
        fmt.row('  draft',        lifecycle.draft);
        fmt.row('  stale',        lifecycle.stale > 0 ? fmt.warn(String(lifecycle.stale)) : '0');

        if (drift) {
            fmt.blank();
            fmt.subheader('Drift');
            fmt.row('  on-track',    drift.onTrack);
            if (drift.minorDrift) fmt.row('  minor-drift', drift.minorDrift);
            if (drift.drifting)   fmt.row('  drifting',    fmt.warn(String(drift.drifting)));
            if (drift.outliers)   fmt.row('  outliers',    fmt.warn(String(drift.outliers)));
        }

        fmt.blank();
    }), output);
}

module.exports = { run };
