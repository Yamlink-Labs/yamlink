'use strict';

const { getIndex, getVaultGeneration } = require('../../core/indexService');
const { buildTaskRows } = require('../../core/tasks');
const { json, methodNotAllowed, coercePositiveInt } = require('../http');

async function handleTasks(req, res, url) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const idIndex = getIndex();
    const generation = getVaultGeneration();
    const todayIso = new Date().toISOString().slice(0, 10);
    const noteFilter = url.searchParams.get('note');
    const doneParam = url.searchParams.get('done');
    const overdue = url.searchParams.get('overdue') === 'true';
    const today = url.searchParams.get('today') === 'true';
    const page = coercePositiveInt(url.searchParams.get('page'), 1, 1);
    const rawLimit = coercePositiveInt(url.searchParams.get('limit'), 50, 1);
    const limit = Math.min(rawLimit, 200);

    const allRows = buildTaskRows(idIndex, generation);
    let rows = allRows.map((row) => ({
        id: row.id,
        noteId: row.fileId,
        text: row.displayText || row.text,
        done: row.done,
        date: row.date || null,
        overdue: !row.done && !!row.date && row.date < todayIso,
        dueToday: !row.done && row.date === todayIso,
        links: row.links || [],
    }));

    if (noteFilter) rows = rows.filter((row) => row.noteId === noteFilter);
    if (doneParam === 'true') rows = rows.filter((row) => row.done);
    if (doneParam === 'false') rows = rows.filter((row) => !row.done);
    if (overdue) rows = rows.filter((row) => row.overdue);
    if (today) rows = rows.filter((row) => row.dueToday);
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, pages);
    const start = (safePage - 1) * limit;

    json(res, {
        tasks: rows.slice(start, start + limit),
        meta: { total, page: safePage, limit, pages }
    });
}

module.exports = { handleTasks };
