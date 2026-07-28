'use strict';

const fs = require('fs');

const { getIndex, getVaultGeneration } = require('../../core/indexService');
const { buildTaskRows, toggleTaskLine } = require('../../core/tasks');
const { json, errorJson, badRequest, methodNotAllowed, parseJsonBody, requireFields, coercePositiveInt, notFound } = require('../http');
const { appendMutationEvents, withMutationContext } = require('../../runtime/mutationEventLog');

function requestSource(req) {
    const header = String(req.headers['x-yamlink-source'] || '').trim().toLowerCase();
    return header || 'api';
}

function requestSessionId(req) {
    const header = req.headers['x-yamlink-session-id'];
    return header == null ? null : String(header).trim() || null;
}

async function listTasks(res, url) {
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

/**
 * `noteId` + `line` (1-indexed) identify a task the same way `buildTaskRows`
 * already reports them via `GET /api/tasks`. Shares `toggleTaskLine` (in
 * `core/tasks.js`) with VS Code's `viewPanel.js` write path — same regex,
 * same mutation-event shape — so a task toggled from either surface looks
 * identical in the mutation log.
 */
async function toggleTask(req, res, context) {
    const body = await parseJsonBody(req, res);
    if (!body) return;
    // 'done' is deliberately not in requireFields — its whole valid range
    // includes `false`, which requireFields' falsy check would reject as
    // "missing" (correct for every other endpoint's fields, wrong here).
    if (!requireFields(body, res, ['noteId', 'line'])) return;
    if (typeof body.done !== 'boolean') {
        badRequest(res, 'Missing param: done (must be a boolean)', 'MISSING_PARAM');
        return;
    }

    const noteId = String(body.noteId || '').trim();
    const line = Number(body.line);
    const done = body.done;
    if (!Number.isInteger(line) || line < 1) {
        badRequest(res, 'Invalid "line" — expected a positive integer', 'INVALID_PARAM');
        return;
    }

    const idIndex = getIndex();
    if (!idIndex.has(noteId)) { notFound(res, 'Note not found: ' + noteId); return; }
    const filePath = idIndex.get(noteId);

    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        errorJson(res, 'INTERNAL_ERROR', 'Could not read note file');
        return;
    }

    const { changed, content: newContent } = toggleTaskLine(content, line, done);
    if (!changed) {
        json(res, { ok: true, changed: false, noteId, line, done });
        return;
    }

    try {
        await context.vaultService.mutate(async () => {
            if (context.eventBus && typeof context.eventBus.setPendingChangedId === 'function') {
                context.eventBus.setPendingChangedId(noteId);
            }
            fs.writeFileSync(filePath, newContent, 'utf8');
            const events = withMutationContext([
                {
                    type: 'task_status_changed', noteId, field: `task:${line}`,
                    oldValue: done ? 'open' : 'done', newValue: done ? 'done' : 'open'
                },
                {
                    type: 'task_state_changed', noteId, field: `task:${line}`,
                    oldValue: done ? 'open' : 'done', newValue: done ? 'done' : 'open',
                    meta: { line }
                }
            ], { source: requestSource(req), cause: 'api_task_toggle', sessionId: requestSessionId(req) });
            appendMutationEvents(events);
            if (context.eventBus && typeof context.eventBus.emitMutationEvents === 'function') {
                context.eventBus.emitMutationEvents(events);
            }
        });
    } catch (error) {
        errorJson(res, 'INTERNAL_ERROR', error.message || 'Task toggle failed');
        return;
    }

    json(res, { ok: true, changed: true, noteId, line, done });
}

async function handleTasks(req, res, url, context) {
    if (req.method === 'GET') { await listTasks(res, url); return; }
    if (req.method === 'PATCH') { await toggleTask(req, res, context); return; }
    methodNotAllowed(res);
}

module.exports = { handleTasks };
