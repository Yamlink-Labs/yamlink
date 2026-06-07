'use strict';

const fs   = require('fs');

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { parseViewQuery, runQuery } = require('../../engine/query');
const fmt = require('../format');

function unwikilink(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_, id) => id.trim());
}

function flattenNote(id, fields) {
    const out = { id };
    for (const [k, v] of Object.entries(fields)) {
        if (k.startsWith('__')) continue;
        const raw = Array.isArray(v) ? v.map(unwikilink).join('; ') : unwikilink(String(v ?? ''));
        out[k] = raw;
    }
    return out;
}

function toCSV(rows) {
    if (!rows.length) return '';
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
    const escape = v => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
            ? '"' + s.replace(/"/g, '""') + '"'
            : s;
    };
    const lines = [keys.join(',')];
    for (const row of rows) {
        lines.push(keys.map(k => escape(row[k] ?? '')).join(','));
    }
    return lines.join('\n');
}

function run({ query, format, output, json }) {
    const idIndex    = getIndex();
    const fieldsCache = getFieldsCache();

    let rows;
    if (query) {
        let text = query.trim();
        if (!text.startsWith('!view ')) text = '!view * ' + text;
        const parsed = parseViewQuery(text);
        if (!parsed) {
            console.error(fmt.err('Could not parse query: ' + query));
            process.exit(1);
        }
        const result = runQuery(parsed, new Date().toISOString().slice(0, 10));
        if (!result?.success) { console.error(fmt.err('Query failed')); process.exit(1); }
        rows = result.rows.map(r => flattenNote(r.id, r.fields || {}));
    } else {
        rows = [];
        for (const [id] of idIndex) {
            rows.push(flattenNote(id, fieldsCache.get(id) || {}));
        }
    }

    const fmt2 = format || (json ? 'json' : 'json');
    let content;
    if (fmt2 === 'csv') {
        content = toCSV(rows);
    } else {
        content = JSON.stringify(rows, null, 2);
    }

    if (output) {
        fs.writeFileSync(output, content, 'utf8');
        console.log(fmt.ok('Exported ' + rows.length + ' note(s) to ' + output));
    } else {
        process.stdout.write(content + '\n');
    }
}

module.exports = { run };
