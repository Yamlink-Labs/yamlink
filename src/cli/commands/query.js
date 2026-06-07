'use strict';

const { parseViewQuery, runQuery } = require('../../engine/query');
const fmt = require('../format');

// Accept either raw !view syntax or a bare clause like "where type = x".
// Also normalise space-separated select fields to comma-separated so
// "select id type" works the same as "select id, type".
function normalizeQuery(text) {
    let q = text.trim();
    if (!q.startsWith('!view ')) q = '!view * ' + q;
    // convert "select a b c" → "select a, b, c"  (only outside a where clause)
    q = q.replace(/\bselect\s+([\w][\w\s,-]*?)(?=\s+(?:where|sort|limit|via|group)\b|$)/i, (_, fields) =>
        'select ' + fields.split(/[\s,]+/).filter(Boolean).join(', ')
    );
    return q;
}

function run({ query, json }) {
    const normalized = normalizeQuery(query);
    let parsed;
    try {
        parsed = parseViewQuery(normalized);
    } catch (e) {
        console.error(fmt.err('Query parse error: ' + e.message));
        process.exit(1);
    }

    if (!parsed) {
        console.error(fmt.err('Could not parse query: ' + query));
        console.error(fmt.c.dim('  Tip: try  where type = <value>  or  !view <type>'));
        process.exit(1);
    }

    let result;
    try {
        result = runQuery(parsed);
    } catch (e) {
        console.error(fmt.err('Query failed: ' + e.message));
        process.exit(1);
    }

    if (!result || result.success === false) {
        console.error(fmt.err('Query returned no result.'));
        process.exit(1);
    }

    const rows    = result.rows    || [];
    const columns = result.columns || [];

    // Flatten each row: { id, fields:{...}, filePath, nodeType } → { id, field1, field2, ... }
    const flatRows = rows.map(r => {
        const flat = { id: r.id };
        for (const col of columns) {
            if (col === 'id') continue;
            flat[col] = r.fields?.[col] ?? r[col] ?? '';
        }
        return flat;
    });

    if (json) { console.log(JSON.stringify({ query, rows: flatRows }, null, 2)); return; }

    fmt.header('Query Results');
    fmt.row('Query',   query);
    fmt.row('Results', flatRows.length);
    fmt.blank();

    if (!flatRows.length) {
        console.log(fmt.c.dim('  (no results)'));
        fmt.blank();
        return;
    }

    const cols = columns.length > 0
        ? columns.slice(0, 7)
        : ['id', ...Object.keys(flatRows[0]).filter(k => k !== 'id')].slice(0, 7);

    fmt.table(flatRows, cols.map(k => ({ key: k, label: k })));
    fmt.blank();
}

module.exports = { run };
