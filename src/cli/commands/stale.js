'use strict';

const { getIndex, getFieldsCache, getVaultGeneration } = require('../../core/indexService');
const { getBacklinks } = require('../../core/graph');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { inferLifecycleState } = require('../../intelligence/lifecycleState');
const fmt = require('../format');
const { captureOutput, emitCliSuccess, emitText } = require('../io');

function run({ typeFilter, limit, json, output }) {
    const idIndex     = getIndex();
    const fieldsCache = getFieldsCache();
    const priors      = getCachedPriors(fieldsCache, getVaultGeneration());
    const cap         = limit || 50;

    const noteIds = Array.from(idIndex.keys());
    let totalInbound = 0;
    for (const id of noteIds) totalInbound += (getBacklinks(id) || []).length;
    const avgInbound = noteIds.length > 0 ? totalInbound / noteIds.length : 0;

    const staleNotes = [];
    for (const id of noteIds) {
        const noteFields   = fieldsCache.get(id) || {};
        const noteType     = (noteFields.type || '').trim().toLowerCase();
        if (typeFilter && noteType !== typeFilter.toLowerCase()) continue;
        const inboundCount = (getBacklinks(id) || []).length;
        try {
            const lc = inferLifecycleState(id, noteFields, {
                fieldsCache, idIndex,
                typeFieldBundles:   priors.typeFieldBundles,
                noteRoleTypePriors: priors.noteRoleTypePriors,
                noteType,
                inboundCount, avgInbound,
            });
            if (lc?.state === 'stale') {
                staleNotes.push({
                    id,
                    type:    noteType || null,
                    label:   lc.label || 'stale',
                    reasons: Array.isArray(lc.reasons) ? lc.reasons.slice(0, 2) : [],
                    inboundCount,
                });
            }
        } catch (_) {}
    }

    staleNotes.sort((a, b) => a.id.localeCompare(b.id));
    const items = staleNotes.slice(0, cap);

    const data = {
        total:      staleNotes.length,
        shown:      items.length,
        typeFilter: typeFilter || null,
        stale:      items,
    };

    if (json) {
        emitCliSuccess(data, output);
        return;
    }

    emitText(captureOutput(() => {
        const typeLabel = typeFilter ? ` (type: ${typeFilter})` : '';
        fmt.header(`Stale Notes${typeLabel}`);
        fmt.row('Stale', data.total > 0 ? fmt.warn(String(data.total)) : fmt.ok('0'));
        fmt.blank();

        if (!items.length) {
            fmt.row('Result', fmt.ok('No stale notes'));
            fmt.blank();
            return;
        }

        for (const n of items) {
            const typeStr    = n.type ? ` (${n.type})` : '';
            const reasonStr  = n.reasons.length ? `  — ${n.reasons.join('; ')}` : '';
            const inboundStr = n.inboundCount > 0 ? ` [${n.inboundCount} inbound]` : '';
            fmt.row(`  ${n.id}${typeStr}`, `${n.label}${inboundStr}${reasonStr}`);
        }
        fmt.blank();
    }), output);
}

module.exports = { run };
