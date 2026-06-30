'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { emitCliError, emitJson, emitText } = require('../io');

function serialiseValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
}

function run({ text, typeFilter, field, json }) {
    const query = String(text || '').trim().toLowerCase();
    if (!query) {
        emitCliError({ json, error: 'Usage: yamlink grep <text>', code: 'USAGE', exitCode: 1 });
        return;
    }

    const targetType = String(typeFilter || '').trim().toLowerCase();
    const targetField = String(field || '').trim();
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const results = [];

    for (const [id] of idIndex.entries()) {
        const fields = fieldsCache.get(id) || {};
        const noteType = String(fields.type || '').trim().toLowerCase();
        if (targetType && noteType !== targetType) continue;

        const entries = targetField
            ? [[targetField, fields[targetField]]]
            : Object.entries(fields).filter(([key]) => !key.startsWith('__'));

        for (const [fieldName, rawValue] of entries) {
            const value = serialiseValue(rawValue);
            if (!value.toLowerCase().includes(query)) continue;
            results.push({
                id,
                type: fields.type || null,
                field: fieldName,
                value
            });
        }
    }

    if (json) {
        emitJson(results);
        return;
    }

    emitText(results.map((entry) => `${entry.id}\t${entry.field}\t${entry.value}`).join('\n') + (results.length ? '\n' : ''));
}

module.exports = { run };
