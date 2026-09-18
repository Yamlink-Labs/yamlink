'use strict';

const {
    addHook,
    removeHook,
    patchHook,
    readHooks
} = require('../../runtime/webhooks');
const { json, badRequest, methodNotAllowed, parseJsonBody, notFound } = require('../http');

async function listHooks(req, res, context) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    json(res, { hooks: readHooks(context.vaultPath) });
}

async function createHook(req, res, context) {
    if (req.method !== 'POST') { methodNotAllowed(res); return; }
    const body = await parseJsonBody(req, res);
    if (!body) return;
    const result = addHook(context.vaultPath, body);
    if (!result.ok) {
        badRequest(res, result.error, result.field === 'url' || result.field === 'event' ? 'INVALID_PARAM' : 'BAD_REQUEST');
        return;
    }
    json(res, { ok: true, hook: result.hook }, 201);
}

async function deleteHook(req, res, id, context) {
    if (req.method !== 'DELETE') { methodNotAllowed(res); return; }
    const result = removeHook(context.vaultPath, id);
    if (!result.ok) { notFound(res, result.error); return; }
    json(res, { ok: true, id: result.id });
}

async function updateHook(req, res, id, context) {
    if (req.method !== 'PATCH') { methodNotAllowed(res); return; }
    const body = await parseJsonBody(req, res);
    if (!body) return;
    const result = patchHook(context.vaultPath, id, body);
    if (!result.ok) { notFound(res, result.error); return; }
    json(res, { ok: true, hook: result.hook });
}

module.exports = {
    listHooks,
    createHook,
    deleteHook,
    updateHook
};
