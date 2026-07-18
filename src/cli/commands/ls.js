'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const fmt = require('../format');
const { captureOutput, emitCliError, emitJson, emitText } = require('../io');

function compareText(a, b) {
    return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
}

function dateSortValue(fields) {
    const candidates = [fields.date, fields.created, fields.updated, fields.modified];
    for (const candidate of candidates) {
        const ms = Date.parse(String(candidate || '').trim());
        if (Number.isFinite(ms)) return ms;
    }
    return 0;
}

function sortRows(rows, sortBy) {
    const normalized = String(sortBy || 'name').trim().toLowerCase();
    if (normalized === 'type') {
        rows.sort((a, b) => compareText(a.type, b.type) || compareText(a.name, b.name) || compareText(a.id, b.id));
        return;
    }
    if (normalized === 'date') {
        rows.sort((a, b) => (dateSortValue(a._fields) - dateSortValue(b._fields)) || compareText(a.name, b.name) || compareText(a.id, b.id));
        return;
    }
    rows.sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id));
}

function run({ typeFilter, sortBy, json, quiet }) {
    const normalizedSort = String(sortBy || 'name').trim().toLowerCase();
    if (!['name', 'date', 'type', ''].includes(normalizedSort)) {
        emitCliError({ json, error: `Unsupported sort: ${sortBy}`, code: 'USAGE', exitCode: 1 });
        return;
    }

    const targetType = String(typeFilter || '').trim().toLowerCase();
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const rows = [];

    for (const [id] of idIndex.entries()) {
        const fields = fieldsCache.get(id) || {};
        const noteType = String(fields.type || '').trim().toLowerCase();
        if (targetType && noteType !== targetType) continue;
        rows.push({
            id,
            type: fields.type || null,
            name: fields.name || fields.title || id,
            _fields: fields
        });
    }

    sortRows(rows, normalizedSort || 'name');
    const payload = rows.map(({ id, type, name }) => ({ id, type, name }));

    if (json) {
        emitJson(payload);
        return;
    }

    if (!payload.length) {
        emitText('(no results)\n');
        return;
    }

    if (quiet) {
        emitText(payload.map((row) => `${row.id}\t${row.type || '—'}\t${row.name}`).join('\n') + '\n');
        return;
    }

    emitText(captureOutput(() => {
        fmt.table(payload.map((row) => ({
            id: row.id,
            type: row.type || '—',
            name: row.name
        })), [
            { key: 'id', label: 'id' },
            { key: 'type', label: 'type' },
            { key: 'name', label: 'name' }
        ]);
    }));
}

module.exports = { run };
