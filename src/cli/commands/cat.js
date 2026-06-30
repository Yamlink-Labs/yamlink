'use strict';

const fs = require('fs');
const { getIndex, getFieldsCache } = require('../../core/indexService');
const { emitCliError, emitJson, emitText } = require('../io');

function orderedFieldEntries(id, fields) {
    const filtered = Object.entries(fields || {}).filter(([key]) => !key.startsWith('__'));
    filtered.sort(([a], [b]) => {
        if (a === 'id') return -1;
        if (b === 'id') return 1;
        if (a === 'type') return b === 'id' ? 1 : -1;
        if (b === 'type') return a === 'id' ? -1 : 1;
        return a.localeCompare(b);
    });
    if (!filtered.some(([key]) => key === 'id')) filtered.unshift(['id', id]);
    return filtered;
}

function yamlScalar(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value) || (typeof value === 'object' && value)) return JSON.stringify(value);
    const text = String(value);
    if (!text.length) return '""';
    if (/^[A-Za-z0-9_.\/:-]+$/.test(text) && !/^(true|false|null)$/i.test(text)) return text;
    return JSON.stringify(text);
}

function extractBody(content) {
    const match = String(content || '').match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (!match) return String(content || '');
    return String(content || '').slice(match[0].length);
}

function run({ id, json }) {
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    if (!idIndex.has(id)) {
        emitCliError({ json, error: 'Note not found: ' + id, code: 'NOT_FOUND', exitCode: 1, details: { id } });
        return;
    }

    const filePath = idIndex.get(id);
    const fields = fieldsCache.get(id) || {};
    const content = fs.readFileSync(filePath, 'utf8');
    const body = extractBody(content);
    const orderedFields = Object.fromEntries(orderedFieldEntries(id, fields));

    if (json) {
        emitJson({ id, ...orderedFields, body });
        return;
    }

    const frontmatter = orderedFieldEntries(id, fields)
        .map(([key, value]) => `${key}: ${yamlScalar(value)}`)
        .join('\n');

    emitText(`---\n${frontmatter}\n---\n${body}`);
}

module.exports = { run };
