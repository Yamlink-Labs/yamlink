'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const fmt = require('../format');
const { captureOutput, emitCliError, emitCliSuccess, emitText } = require('../io');

function matchesQuery(value, query) {
    return String(value || '').toLowerCase().includes(query);
}

function run({ query, typeFilter, field, json, quiet }) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) {
        emitCliError({ json, error: 'Usage: yamlink search <query>', code: 'USAGE', exitCode: 1 });
        return;
    }

    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const targetType = String(typeFilter || '').trim().toLowerCase();
    const targetField = String(field || '').trim();
    const results = [];

    for (const id of idIndex.keys()) {
        const fields = fieldsCache.get(id) || {};
        const noteType = String(fields.type || '').trim().toLowerCase();
        if (targetType && noteType !== targetType) continue;

        const label = fields.name || fields.title || '';
        const candidates = targetField
            ? [{ field: targetField, value: fields[targetField] ?? '' }]
            : [
                { field: 'id', value: id },
                { field: 'name', value: fields.name || '' },
                { field: 'title', value: fields.title || '' },
                { field: 'type', value: fields.type || '' }
            ];

        const match = candidates.find((entry) => matchesQuery(entry.value, q));
        if (!match) continue;

        results.push({
            id,
            type: fields.type || null,
            name: label || id,
            matchedField: match.field,
            matchedValue: String(match.value || '')
        });
    }

    if (json) {
        emitCliSuccess({ query: q, count: results.length, results });
        return;
    }

    if (!results.length) {
        emitText('(no results)\n');
        return;
    }

    if (quiet) {
        emitText(results.map((entry) => entry.id).join('\n') + '\n');
        return;
    }

    emitText(captureOutput(() => {
        fmt.table(results.map((entry) => ({
            id: entry.id,
            type: entry.type || '—',
            name: entry.name
        })), [
            { key: 'id', label: 'id' },
            { key: 'type', label: 'type' },
            { key: 'name', label: 'name/title' }
        ]);
    }));
}

module.exports = { run };
