'use strict';

const { getFieldsCache, getVaultGeneration } = require('../../core/indexService');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { computeVaultDrift } = require('../../intelligence/driftDetector');
const fmt = require('../format');
const { captureOutput, emitCliSuccess, emitText } = require('../io');

function run({ typeFilter, limit, json, output }) {
    const fieldsCache = getFieldsCache();
    const priors      = getCachedPriors(fieldsCache, getVaultGeneration());

    const vaultDrift = computeVaultDrift(fieldsCache, priors);
    const cap = limit || 50;

    // Filter by type if requested, exclude on-track and insufficient-data
    const notOnTrack = vaultDrift.filter(d => {
        if (d.insufficientData) return false;
        if (d.driftLabel === 'on-track') return false;
        if (typeFilter && d.noteType !== typeFilter.toLowerCase()) return false;
        return true;
    });

    // Sort: outlier > drifting > minor-drift; then by driftScore desc
    const ORDER = { outlier: 0, drifting: 1, 'minor-drift': 2 };
    notOnTrack.sort((a, b) => {
        const ord = (ORDER[a.driftLabel] ?? 3) - (ORDER[b.driftLabel] ?? 3);
        if (ord !== 0) return ord;
        return (b.driftScore || 0) - (a.driftScore || 0);
    });

    const items = notOnTrack.slice(0, cap);

    const byLabel = {};
    for (const d of items) {
        const label = d.driftLabel || 'unknown';
        if (!byLabel[label]) byLabel[label] = [];
        byLabel[label].push({
            id:        d.noteId,
            type:      d.noteType,
            score:     d.driftScore,
            label:     d.driftLabel,
            reasons:   [
                ...(d.missingExpected  || []).slice(0, 2).map(f => `missing: ${f.field}`),
                ...(d.unusualFields    || []).slice(0, 2).map(f => `unusual: ${f.field}`),
                ...(d.valueMismatches  || []).slice(0, 1).map(f => `mismatch: ${f.field}`),
            ].slice(0, 3),
        });
    }

    const data = {
        total:      notOnTrack.length,
        shown:      items.length,
        typeFilter: typeFilter || null,
        byLabel,
        items: items.map(d => ({
            id:         d.noteId,
            type:       d.noteType,
            label:      d.driftLabel,
            score:      d.driftScore,
            missing:    (d.missingExpected  || []).map(f => f.field),
            unusual:    (d.unusualFields    || []).map(f => f.field),
            mismatches: (d.valueMismatches  || []).map(f => f.field),
        })),
    };

    if (json) {
        emitCliSuccess(data, output);
        return;
    }

    emitText(captureOutput(() => {
        const typeLabel = typeFilter ? ` (type: ${typeFilter})` : '';
        fmt.header(`Vault Drift${typeLabel}`);
        fmt.row('Drifting notes', data.total > 0 ? fmt.warn(String(data.total)) : fmt.ok('0'));
        fmt.blank();

        if (!items.length) {
            fmt.row('Result', fmt.ok('No structural drift detected'));
            fmt.blank();
            return;
        }

        for (const [label, notes] of Object.entries(byLabel)) {
            const labelFmt = label === 'outlier' || label === 'drifting' ? fmt.warn(label) : label;
            fmt.subheader(`${labelFmt} (${notes.length})`);
            for (const n of notes) {
                const reasons = n.reasons.length ? `  — ${n.reasons.join('; ')}` : '';
                fmt.row(`  ${n.id}`, `${n.type}${reasons}`);
            }
            fmt.blank();
        }
    }), output);
}

module.exports = { run };
