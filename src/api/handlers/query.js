'use strict';

const { parseViewQuery, runQuery } = require('../../engine/query');
const { json, badRequest, methodNotAllowed } = require('../http');

async function handleQuery(req, res, url) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const q = url.searchParams.get('q');
    if (!q) { badRequest(res, 'Missing param: q', 'MISSING_PARAM'); return; }
    let text = q.trim();
    if (!text.startsWith('!view ')) text = '!view * ' + text;
    const parsed = parseViewQuery(text);
    if (!parsed) { badRequest(res, 'Could not parse query: ' + q); return; }
    const result = runQuery(parsed, new Date().toISOString().slice(0, 10));
    if (!result?.success) { badRequest(res, 'Query failed'); return; }
    json(res, { query: q, count: result.rows.length, rows: result.rows, columns: result.columns });
}

module.exports = { handleQuery };
