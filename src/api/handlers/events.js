'use strict';

const { URL } = require('url');

const { getVaultGeneration } = require('../../core/indexService');
const { API_VERSION, CORS_HEADERS, methodNotAllowed } = require('../http');

async function handleEvents(req, res, context) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const url = new URL(req.url, 'http://localhost');
    const note = String(url.searchParams.get('note') || '').trim();
    const noteType = String(url.searchParams.get('noteType') || '').trim().toLowerCase();
    const type = String(url.searchParams.get('type') || '').trim();
    const filters = {
        ...(note ? { note } : {}),
        ...(noteType ? { noteType } : {}),
        ...(type ? { type } : {})
    };

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Yamlink-Generation': String(getVaultGeneration()),
        'X-Yamlink-Api-Version': API_VERSION,
        'X-Accel-Buffering': 'no',
        ...CORS_HEADERS,
    });
    context.eventBus.register(res, req, Object.keys(filters).length ? filters : null);
}

module.exports = { handleEvents };
