'use strict';

const { json, methodNotAllowed, coercePositiveInt } = require('../http');
const { getMutationEvents } = require('../../runtime/mutationEventLog');

async function handleMutations(req, res, url, context) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const page = coercePositiveInt(url.searchParams.get('page'), 1, 1);
    const rawLimit = coercePositiveInt(url.searchParams.get('limit'), 50, 1);
    const limit = Math.min(rawLimit, 200);
    const sinceParam = url.searchParams.get('since') || null;
    const typeParam = url.searchParams.get('type') || null;
    const noteIdParam = url.searchParams.get('id') || null;
    const MAX_EVENTS = 10000;

    let events = getMutationEvents({
        type: typeParam || undefined,
        noteId: noteIdParam || undefined,
        since: sinceParam || undefined,
        limit: MAX_EVENTS
    }).slice().reverse();

    const total = events.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, pages);
    const start = (safePage - 1) * limit;

    json(res, {
        events: events.slice(start, start + limit),
        meta: { total, page: safePage, limit, pages }
    });
}

module.exports = { handleMutations };
