'use strict';

const { getFieldsCache } = require('../../core/indexService');
const { getMutationEvents } = require('../../runtime/mutationEventLog');
const { buildFieldCoOccurrenceMemory } = require('../../intelligence/workflowMemory');
const fmt = require('../format');
const { captureOutput, emitCliError, emitCliSuccess, emitText } = require('../io');

function serializeMemory(memory, typeFilter = null) {
    if (typeFilter) {
        const type = String(typeFilter || '').trim().toLowerCase();
        return {
            type,
            pairs: memory.get(type) || []
        };
    }
    return {
        types: [...memory.entries()].map(([type, pairs]) => ({ type, pairs }))
    };
}

function run({ typeFilter, json, output }) {
    const type = String(typeFilter || '').trim().toLowerCase();
    if (!json && !type) {
        emitCliError({
            json,
            outputPath: output,
            error: 'Usage: yamlink workflow-memory --type <type>',
            code: 'USAGE',
            exitCode: 1
        });
        return;
    }

    const fieldsCache = getFieldsCache();
    const memory = buildFieldCoOccurrenceMemory(getMutationEvents(), { fieldsCache });
    const data = serializeMemory(memory, type || null);

    if (json) {
        emitCliSuccess(data, output);
        return;
    }

    emitText(captureOutput(() => {
        fmt.header(`Workflow Memory (${type})`);
        const pairs = data.pairs || [];
        if (!pairs.length) {
            fmt.row('Result', fmt.ok('No repeated field-pair pattern yet'));
            fmt.blank();
            return;
        }
        for (const pair of pairs) {
            const pct = `${Math.round(pair.coOccurrenceRatio * 100)}%`;
            fmt.row(`  ${pair.fieldA} + ${pair.fieldB}`, `${pct} across ${pair.sessionCount} sessions`);
        }
        fmt.blank();
    }), output);
}

module.exports = { run, serializeMemory };
