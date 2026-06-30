'use strict';

const { getIndex, getFieldsCache, getVaultGeneration } = require('../../core/indexService');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { buildNoteArc } = require('../../intelligence/noteArc');
const fmt = require('../format');
const { captureOutput, emitCliError, emitCliSuccess, emitText } = require('../io');

function run({ id, json, output }) {
    const idIndex     = getIndex();
    const fieldsCache = getFieldsCache();

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

    const noteFields = fieldsCache.get(id) || {};
    const noteType   = noteFields.type || null;
    const priors     = getCachedPriors(fieldsCache, getVaultGeneration());

    const arc = buildNoteArc(
        noteFields,
        noteType,
        fieldsCache,
        priors.typeFieldBundles,
        priors.fieldTargetTypes,
        priors.outcomeCalibration,
        { typeBundleTotals: priors.typeBundleTotals, limit: 8 }
    );

    const data = {
        id,
        type: noteType,
        inferredType: arc.inferredType,
        missingFields: (arc.missingFields || []).map(f => ({
            field:            f.field,
            confidenceLabel:  f.confidenceLabel,
            score:            Math.round(f.score * 100) / 100,
            ratio:            Math.round(f.ratio * 100) / 100,
            isRelation:       f.isRelation,
            coldStart:        f.coldStart || false,
        })),
    };

    if (json) {
        emitCliSuccess(data, output);
        return;
    }

    emitText(captureOutput(() => {
        const typeLabel = data.type ? ` (${data.type})` : '';
        fmt.header(`Suggested fields for ${id}${typeLabel}`);

        if (!data.missingFields.length) {
            fmt.row('Result', fmt.ok('No missing fields — note looks complete'));
            fmt.blank();
            return;
        }

        fmt.blank();
        for (const f of data.missingFields) {
            const badge  = f.confidenceLabel === 'high'   ? fmt.ok(f.confidenceLabel)
                         : f.confidenceLabel === 'medium' ? fmt.warn(f.confidenceLabel)
                         : f.confidenceLabel;
            const rel    = f.isRelation ? ' [relation]' : '';
            const cold   = f.coldStart  ? ' [cold-start]' : '';
            const pct    = `${Math.round(f.ratio * 100)}% of peers`;
            fmt.row(`  ${f.field}`, `${badge}${rel}${cold}  ${pct}`);
        }
        fmt.blank();
    }), output);
}

module.exports = { run };
