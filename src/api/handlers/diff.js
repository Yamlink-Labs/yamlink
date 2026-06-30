'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getMutationEvents } = require('../../runtime/mutationEventLog');
const { buildApiDiff } = require('../../core/noteDiff');
const { json, badRequest, methodNotAllowed, notFound } = require('../http');

async function handleDiff(req, res, url) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }

    const since = String(url.searchParams.get('since') || '').trim();
    if (since) {
        const currentFields = getFieldsCache();
        const grouped = new Map();
        const events = getMutationEvents({ since, limit: 10000 });

        for (const event of events) {
            if (!event || !event.noteId || !event.field) continue;
            if (event.type !== 'field_changed' && event.type !== 'relation_added' && event.type !== 'relation_changed' && event.type !== 'relation_removed' && event.type !== 'field_added' && event.type !== 'field_removed' && event.type !== 'type_set') continue;

            if (!grouped.has(event.noteId)) grouped.set(event.noteId, new Map());
            const byField = grouped.get(event.noteId);
            if (!byField.has(event.field)) {
                byField.set(event.field, { from: event.oldValue ?? null, to: event.newValue ?? null });
            } else {
                const existing = byField.get(event.field);
                existing.to = event.newValue ?? null;
            }
        }

        const changes = Array.from(grouped.entries()).map(([id, fieldMap]) => {
            const fields = Object.fromEntries(Array.from(fieldMap.entries()));
            const noteFields = currentFields.get(id) || {};
            return {
                id,
                type: noteFields.type || null,
                fields
            };
        });

        json(res, { since, count: changes.length, changes });
        return;
    }

    const fromId = String(url.searchParams.get('from') || '').trim();
    const toId = String(url.searchParams.get('to') || '').trim();

    if (!fromId || !toId) {
        badRequest(res, 'Missing params: from and to are required, or provide since', 'MISSING_PARAM');
        return;
    }

    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    if (!idIndex.has(fromId)) { notFound(res, 'Note not found: ' + fromId); return; }
    if (!idIndex.has(toId)) { notFound(res, 'Note not found: ' + toId); return; }

    const diff = buildApiDiff(fromId, toId, fieldsCache.get(fromId) || {}, fieldsCache.get(toId) || {});
    json(res, diff);
}

module.exports = { handleDiff };
