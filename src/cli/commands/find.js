'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { emitJson, emitText } = require('../io');

function hasValue(value) {
    if (Array.isArray(value)) return value.some((entry) => String(entry || '').trim());
    return String(value || '').trim().length > 0;
}

function run({ hasFields, missingFields, typeFilter, json }) {
    const requiredFields = (Array.isArray(hasFields) ? hasFields : []).map((value) => String(value || '').trim()).filter(Boolean);
    const forbiddenFields = (Array.isArray(missingFields) ? missingFields : []).map((value) => String(value || '').trim()).filter(Boolean);
    const targetType = String(typeFilter || '').trim().toLowerCase();
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const results = [];

    for (const [id] of idIndex.entries()) {
        const fields = fieldsCache.get(id) || {};
        const noteType = String(fields.type || '').trim().toLowerCase();
        if (targetType && noteType !== targetType) continue;
        if (requiredFields.some((field) => !hasValue(fields[field]))) continue;
        if (forbiddenFields.some((field) => hasValue(fields[field]))) continue;
        results.push({ id, type: fields.type || null });
    }

    results.sort((a, b) => a.id.localeCompare(b.id));

    if (json) {
        emitJson(results);
        return;
    }

    emitText(results.map((entry) => `${entry.id}\t${entry.type || '—'}`).join('\n') + (results.length ? '\n' : ''));
}

module.exports = { run };
