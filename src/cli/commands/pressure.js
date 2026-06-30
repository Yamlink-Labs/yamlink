'use strict';

// Knowledge pressure — surfaces structural strain in the vault:
//   1. Load-bearing drafts: draft-lifecycle notes with high inbound count.
//      Other notes depend on them but they're underdeveloped. High risk.
//   2. Stale hubs: stale notes that are heavily linked. Outdated load-bearing nodes.
//   3. Orphan clusters: notes with no links at all (zero inbound + zero outbound).
//      They represent disconnected knowledge that isn't contributing to the graph.
//
// This is not a health score — it's a directional signal about where the vault
// is under structural stress. Small vaults will show nothing; that's correct.

const { getIndex, getFieldsCache, getVaultGeneration } = require('../../core/indexService');
const { getEdges, getBacklinks } = require('../../core/graph');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { inferLifecycleState } = require('../../intelligence/lifecycleState');
const fmt = require('../format');
const { captureOutput, emitCliSuccess, emitText } = require('../io');

function run({ json, output }) {
    const idIndex     = getIndex();
    const fieldsCache = getFieldsCache();
    const priors      = getCachedPriors(fieldsCache, getVaultGeneration());

    const noteIds = Array.from(idIndex.keys());
    let totalInbound = 0;
    for (const id of noteIds) totalInbound += (getBacklinks(id) || []).length;
    const avgInbound  = noteIds.length > 0 ? totalInbound / noteIds.length : 0;
    // Load-bearing threshold: notes with inbound count notably above average
    const loadBearingThreshold = Math.max(2, Math.ceil(avgInbound * 1.5));

    const loadBearingDrafts = [];
    const staleHubs         = [];
    const orphans           = [];

    for (const id of noteIds) {
        const noteFields   = fieldsCache.get(id) || {};
        const noteType     = (noteFields.type || '').trim().toLowerCase();
        const inboundCount = (getBacklinks(id) || []).length;
        const outbound     = getEdges(id) || [];

        // Orphans: no links in either direction
        if (inboundCount === 0 && outbound.length === 0) {
            orphans.push({ id, type: noteType || null });
            continue;
        }

        let state = null;
        try {
            const lc = inferLifecycleState(id, noteFields, {
                fieldsCache, idIndex,
                typeFieldBundles:   priors.typeFieldBundles,
                noteRoleTypePriors: priors.noteRoleTypePriors,
                noteType, inboundCount, avgInbound,
            });
            state = lc?.state || null;
        } catch (_) {}

        if (state === 'draft' && inboundCount >= loadBearingThreshold) {
            loadBearingDrafts.push({ id, type: noteType || null, inboundCount });
        }
        if (state === 'stale' && inboundCount >= loadBearingThreshold) {
            staleHubs.push({ id, type: noteType || null, inboundCount });
        }
    }

    loadBearingDrafts.sort((a, b) => b.inboundCount - a.inboundCount);
    staleHubs.sort((a, b) => b.inboundCount - a.inboundCount);
    orphans.sort((a, b) => a.id.localeCompare(b.id));

    const data = {
        loadBearingDrafts: loadBearingDrafts.slice(0, 20),
        staleHubs:         staleHubs.slice(0, 20),
        orphans:           orphans.slice(0, 20),
        totals: {
            loadBearingDrafts: loadBearingDrafts.length,
            staleHubs:         staleHubs.length,
            orphans:           orphans.length,
        },
        avgInbound:           Math.round(avgInbound * 10) / 10,
        loadBearingThreshold,
    };

    if (json) {
        emitCliSuccess(data, output);
        return;
    }

    emitText(captureOutput(() => {
        fmt.header('Knowledge Pressure');
        const total = data.totals.loadBearingDrafts + data.totals.staleHubs + data.totals.orphans;
        fmt.row('Pressure indicators', total > 0 ? fmt.warn(String(total)) : fmt.ok('0'));
        fmt.row('Avg inbound links',   data.avgInbound);
        fmt.blank();

        if (!total) {
            fmt.row('Result', fmt.ok('No structural pressure detected'));
            fmt.blank();
            return;
        }

        if (data.loadBearingDrafts.length) {
            fmt.subheader(`Load-bearing drafts (${data.totals.loadBearingDrafts})`);
            fmt.row('  ↳', 'draft notes other notes depend on — develop these');
            for (const n of data.loadBearingDrafts) {
                const typeStr = n.type ? ` (${n.type})` : '';
                fmt.row(`  ${n.id}${typeStr}`, `${n.inboundCount} inbound`);
            }
            fmt.blank();
        }

        if (data.staleHubs.length) {
            fmt.subheader(`Stale hubs (${data.totals.staleHubs})`);
            fmt.row('  ↳', 'stale notes that are still heavily referenced — update or unlink');
            for (const n of data.staleHubs) {
                const typeStr = n.type ? ` (${n.type})` : '';
                fmt.row(`  ${n.id}${typeStr}`, fmt.warn(`${n.inboundCount} inbound, stale`));
            }
            fmt.blank();
        }

        if (data.orphans.length) {
            fmt.subheader(`Orphan notes (${data.totals.orphans})`);
            fmt.row('  ↳', 'no links in or out — disconnected from the graph');
            for (const n of data.orphans.slice(0, 10)) {
                const typeStr = n.type ? ` (${n.type})` : '';
                fmt.row(`  ${n.id}${typeStr}`, 'unlinked');
            }
            if (data.totals.orphans > 10) fmt.row('  ...', `and ${data.totals.orphans - 10} more`);
            fmt.blank();
        }
    }), output);
}

module.exports = { run };
