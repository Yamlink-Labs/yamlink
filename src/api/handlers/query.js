'use strict';

const { parseViewQuery, runQuery } = require('../../engine/query');
const { json, errorJson, badRequest, methodNotAllowed, parseJsonBody, requireFields } = require('../http');

function executeQuery(res, q) {
    if (!q) { badRequest(res, 'Missing param: q', 'MISSING_PARAM'); return; }
    const raw = String(q);
    let text = raw.trim();
    if (!text.startsWith('!view ')) text = '!view * ' + text;
    const parsed = parseViewQuery(text);
    if (!parsed) { badRequest(res, 'Could not parse query: ' + raw); return; }
    const result = runQuery(parsed, null);
    if (!result?.success) {
        errorJson(res, 'BAD_REQUEST', result?.error || 'Query failed', { warnings: result?.warnings || [] });
        return;
    }
    json(res, { query: raw, count: result.rows.length, rows: result.rows, columns: result.columns });
}

async function handleQuery(req, res, url) {
    if (req.method === 'GET') {
        executeQuery(res, url.searchParams.get('q'));
        return;
    }
    if (req.method === 'POST') {
        const body = await parseJsonBody(req, res);
        if (!body) return;
        if (!requireFields(body, res, ['q'])) return;
        executeQuery(res, body.q);
        return;
    }
    methodNotAllowed(res);
}

module.exports = { handleQuery };
