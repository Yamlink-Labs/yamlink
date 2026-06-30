'use strict';

const { getIndex } = require('../../core/indexService');
const { getMutationEvents } = require('../../runtime/mutationEventLog');
const { json, methodNotAllowed, notFound } = require('../http');
const { buildNoteEvolution, buildRelationArchaeology } = require('../../intelligence/noteEvolution');
const { buildVaultLenses } = require('../../intelligence/vaultLenses');
const { buildSessionSummary, detectWorkflowBursts } = require('../../intelligence/sessionSummary');
const { getSessionEvents } = require('../../runtime/mutationEventLog');

async function handleNodeHistory(req, res, id) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const idIndex = getIndex();
    if (!idIndex.has(id)) {
        notFound(res, 'Note not found: ' + id);
        return;
    }

    const events = getMutationEvents({ noteId: id, limit: 100 }).slice().reverse();
    json(res, { id, events });
}

async function handleNodeEvolution(req, res, id) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const idIndex = getIndex();
    if (!idIndex.has(id)) {
        notFound(res, 'Note not found: ' + id);
        return;
    }
    const events = getMutationEvents({ noteId: id, limit: 500 });
    json(res, buildNoteEvolution(id, events));
}

async function handleNodeArchaeology(req, res, id, url) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const idIndex = getIndex();
    if (!idIndex.has(id)) {
        notFound(res, 'Note not found: ' + id);
        return;
    }
    const field = String(url.searchParams.get('field') || '').trim();
    if (!field) {
        json(res, { error: 'Missing field query param', code: 'MISSING_PARAM' }, 400);
        return;
    }
    const events = getMutationEvents({ noteId: id, limit: 500 });
    json(res, buildRelationArchaeology(id, field, events));
}

async function handleVaultLenses(req, res) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    json(res, buildVaultLenses(getMutationEvents({ limit: 2000 }), getIndex()));
}

async function handleSessionSummary(req, res, url) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const sessionId = String(url.searchParams.get('sessionId') || '').trim() || null;
    const events = sessionId
        ? getSessionEvents(sessionId)
        : getMutationEvents({ since: new Date(Date.now() - 30 * 60000).toISOString(), limit: 500 });
    json(res, {
        sessionId,
        summary: buildSessionSummary(events),
        bursts: detectWorkflowBursts(events),
        events
    });
}

module.exports = { handleNodeHistory, handleNodeEvolution, handleNodeArchaeology, handleVaultLenses, handleSessionSummary };
