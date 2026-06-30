'use strict';

const { parseViewQuery, runQuery } = require('../../engine/query');
const { captureOutput, emitCliError, emitCliSuccess, emitText } = require('../io');

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

function truncateValue(value, maxWidth) {
    const text = String(value ?? '');
    if (text.length <= maxWidth) return text;
    if (maxWidth <= 1) return text.slice(0, maxWidth);
    return text.slice(0, maxWidth - 1) + '…';
}

function renderTable(rows) {
    if (!rows.length) {
        console.log('(no results)');
        return;
    }

    const columnSet = new Set();
    for (const row of rows) {
        for (const key of Object.keys(row || {})) columnSet.add(key);
    }
    const columns = [...columnSet];
    const widths = columns.map((column) => {
        const longestValue = rows.reduce((max, row) => {
            const value = String(row?.[column] ?? '');
            return Math.max(max, value.length);
        }, 0);
        return Math.min(40, Math.max(column.length, longestValue));
    });

    const header = columns.map((column, index) => truncateValue(column, widths[index]).padEnd(widths[index])).join('  ');
    const divider = widths.map((width) => '─'.repeat(width)).join('  ');
    console.log(header);
    console.log(divider);
    for (const row of rows) {
        const line = columns.map((column, index) => {
            const value = truncateValue(row?.[column] ?? '', widths[index]);
            return value.padEnd(widths[index]);
        }).join('  ');
        console.log(line);
    }
}

function run({ query, json, quiet, output }) {
    const normalized = normalizeQuery(query);
    let parsed;
    try {
        parsed = parseViewQuery(normalized);
    } catch (e) {
        emitCliError({ json, outputPath: output, error: 'Query parse error: ' + e.message, code: 'QUERY_PARSE_ERROR', exitCode: 1 });
        return;
    }

    if (!parsed) {
        emitCliError({ json, outputPath: output, error: 'Could not parse query: ' + query, code: 'QUERY_PARSE_ERROR', exitCode: 1 });
        return;
    }

    let result;
    try {
        result = runQuery(parsed);
    } catch (e) {
        emitCliError({ json, outputPath: output, error: 'Query failed: ' + e.message, code: 'QUERY_FAILED', exitCode: 2 });
        return;
    }

    if (!result || result.success === false) {
        emitCliError({ json, outputPath: output, error: 'Query returned no result.', code: 'QUERY_EMPTY', exitCode: 1 });
        return;
    }

    const rows    = result.rows    || [];
    const columns = result.columns || [];

    const structuredRows = rows.map((row) => ({
        id: row.id,
        fields: row.fields || {}
    }));

    // Flatten each row: { id, fields:{...}, filePath, nodeType } → { id, field1, field2, ... }
    const flatRows = rows.map(r => {
        const flat = { id: r.id };
        for (const col of columns) {
            if (col === 'id') continue;
            flat[col] = r.fields?.[col] ?? r[col] ?? '';
        }
        return flat;
    });

    if (json) {
        emitCliSuccess({ query, count: structuredRows.length, rows: structuredRows }, output);
        return;
    }
    if (!flatRows.length) {
        emitText('(no results)\n', output);
        return;
    }
    if (quiet) {
        emitText(flatRows.map((row) => row.id).join('\n') + (flatRows.length ? '\n' : ''), output);
        return;
    }
    emitText(captureOutput(() => renderTable(flatRows)), output);
}

module.exports = { run };
