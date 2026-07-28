'use strict';

const fs = require('fs');

const { getIndex, getFieldsCache, getVaultGeneration, extractRelationTargets } = require('../../core/indexService');
const { getEdges, getBacklinks } = require('../../core/graph');
const { getMutationEvents } = require('../../runtime/mutationEventLog');
const { buildNoteIntelligenceSnapshot } = require('../../intelligence/intelligenceSnapshots');
const { reconstructNoteAtTime } = require('../../core/timeEngine');
const { parseFrontmatterDocument } = require('../../core/frontmatter');
const { readFileStatDates } = require('../../engine/queryExecutor');
const { json, errorJson, badRequest, methodNotAllowed, parseJsonBody, requireFields, coercePositiveInt, notFound } = require('../http');
const { writeNoteFile, applyFieldUpdates } = require('../write');
const { appendMutationEvents, withMutationContext } = require('../../runtime/mutationEventLog');

/**
 * @typedef {Error & {
 *   status?: number,
 *   code?: string,
 *   details?: Record<string, any>
 * }} ApiWriteError
 */

/**
 * @param {string} id
 * @param {string|null|undefined} filePath
 * @param {Record<string, any>} fields
 * @returns {Record<string, any>}
 */
function buildNodeResponse(id, filePath, fields) {
    return {
        id,
        _filePath: filePath,
        ...Object.fromEntries(Object.entries(fields).filter(([key]) => !key.startsWith('__')))
    };
}

/**
 * @param {string} id
 * @param {string|null|undefined} filePath
 * @param {Record<string, any>} fields
 * @returns {Record<string, any>}
 */
function buildNodeDetailResponse(id, filePath, fields) {
    const outbound = (getEdges(id) || []).map((edge) => ({ field: edge.field, to: edge.targetId }));
    const inbound = (getBacklinks(id) || []).map((edge) => ({ field: edge.field, from: edge.sourceId }));
    return {
        ...buildNodeResponse(id, filePath, fields),
        _outbound: outbound,
        _inbound: inbound,
    };
}

function buildOutboundComposite(id, fieldsCache) {
    return (getEdges(id) || []).map((edge) => {
        const targetFields = fieldsCache.get(edge.targetId) || {};
        return {
            field: edge.field,
            to: edge.targetId,
            toType: targetFields.type || null,
            toName: targetFields.name || targetFields.title || edge.targetId
        };
    });
}

function buildInboundComposite(id, fieldsCache) {
    return (getBacklinks(id) || []).map((edge) => {
        const sourceFields = fieldsCache.get(edge.sourceId) || {};
        return {
            field: edge.field,
            from: edge.sourceId,
            fromType: sourceFields.type || null,
            fromName: sourceFields.name || sourceFields.title || edge.sourceId
        };
    });
}

/**
 * @returns {Record<string, any>[]}
 */
function allNodes() {
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const nodes = [];
    for (const [id, filePath] of idIndex) {
        nodes.push(buildNodeResponse(id, filePath, fieldsCache.get(id) || {}));
    }
    return nodes;
}

/**
 * Extract the request source for mutation attribution.
 * Reads X-Yamlink-Source header; falls back to 'api'.
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
function requestSource(req) {
    const header = String(req.headers['x-yamlink-source'] || '').trim().toLowerCase();
    return header || 'api';
}

function requestSessionId(req) {
    const header = req.headers['x-yamlink-session-id'];
    return header == null ? null : String(header).trim() || null;
}

/**
 * @param {{ eventBus: { emitMutationEvents: (events: any[]) => void } }} context
 * @param {any[]} events
 * @returns {void}
 */
function appendAndEmitMutationEvents(context, events) {
    if (!Array.isArray(events) || !events.length) return;
    appendMutationEvents(events);
    context.eventBus.emitMutationEvents(events);
}

async function listNodes(req, res, url) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const type = url.searchParams.get('type');
    const page = coercePositiveInt(url.searchParams.get('page'), 1, 1);
    const rawLimit = coercePositiveInt(url.searchParams.get('limit'), 100, 1);
    const limit = Math.min(rawLimit, 500);

    let nodes = allNodes();
    if (type) nodes = nodes.filter((node) => (node.type || '').toLowerCase() === type.toLowerCase());

    const total = nodes.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, pages);
    const start = (safePage - 1) * limit;
    const slice = nodes.slice(start, start + limit);

    json(res, {
        nodes: slice,
        meta: { total, page: safePage, limit, pages }
    });
}

/** @param {Record<string, any>} fields @returns {Array<{field: string, to: string}>} */
function buildHistoricalOutbound(fields) {
    const outbound = [];
    for (const [field, value] of Object.entries(fields || {})) {
        if (!field || field === 'id' || field === 'type' || field.startsWith('__')) continue;
        for (const targetId of extractRelationTargets(value)) outbound.push({ field, to: targetId });
    }
    return outbound;
}

/**
 * Raw, verbatim note body (everything after the closing `---`), opt-in via
 * `?include=body`. Never cached, never lowercased — unlike the query
 * engine's `readBody()`, which intentionally lowercases for search matching
 * and would silently corrupt a "give me the real body text" response.
 * @param {string|null} filePath @returns {string|null}
 */
function readRawBody(filePath) {
    if (!filePath) return null;
    try {
        return parseFrontmatterDocument(fs.readFileSync(filePath, 'utf8')).body;
    } catch (e) { return null; }
}

async function getNode(req, res, id, url, context) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }

    const at = String(url?.searchParams?.get('at') || '').trim();
    if (at) {
        if (!Number.isFinite(Date.parse(at))) {
            badRequest(res, 'Invalid "at" timestamp — expected ISO-8601', 'INVALID_PARAM');
            return;
        }
        const idIndex = getIndex();
        const fieldsCache = getFieldsCache();
        const currentFields = idIndex.has(id) ? (fieldsCache.get(id) || {}) : null;
        const events = getMutationEvents({ noteId: id });
        const result = reconstructNoteAtTime(id, at, currentFields, events);

        if (!result.exists) {
            errorJson(res, 'NOT_FOUND', 'Note did not exist at ' + at, {
                reason: result.reason,
                earliestReconstructableTimestamp: result.earliestReconstructableTimestamp
            });
            return;
        }

        json(res, {
            id,
            at,
            exists: true,
            fields: result.fields,
            _outbound: result.fields ? buildHistoricalOutbound(result.fields) : [],
            complete: result.complete,
            earliestReconstructableTimestamp: result.earliestReconstructableTimestamp,
            ...(result.reason ? { reason: result.reason } : {}),
            ...(result.deletedAt ? { deletedAt: result.deletedAt } : {})
        });
        return;
    }

    const minGeneration = coercePositiveInt(url.searchParams.get('minGeneration'), null, 0);
    if (minGeneration !== null && context && context.eventBus && typeof context.eventBus.waitForGeneration === 'function') {
        await context.eventBus.waitForGeneration(minGeneration, 3000);
    }
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    if (!idIndex.has(id)) { notFound(res, 'Note not found: ' + id); return; }
    const filePath = idIndex.get(id);
    const fields = fieldsCache.get(id) || {};
    const include = String(url?.searchParams?.get('include') || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (!include.length) {
        json(res, buildNodeDetailResponse(id, filePath, fields));
        return;
    }

    const response = buildNodeResponse(id, filePath, fields);
    if (include.includes('outbound')) response._outbound = buildOutboundComposite(id, fieldsCache);
    if (include.includes('inbound')) response._inbound = buildInboundComposite(id, fieldsCache);
    if (include.includes('intelligence')) response._intelligence = buildNoteIntelligenceSnapshot(id);
    if (include.includes('history')) response._history = getMutationEvents({ noteId: id, limit: 20 }).slice().reverse();
    if (include.includes('body')) response._body = readRawBody(filePath);
    if (include.includes('timestamps')) {
        const stat = readFileStatDates(filePath);
        response._timestamps = stat ? { created: stat['file.created'], modified: stat['file.modified'] } : null;
    }
    json(res, response);
}

async function createNode(req, res, context) {
    if (req.method !== 'POST') { methodNotAllowed(res); return; }
    const body = await parseJsonBody(req, res);
    if (!body) return;
    if (!requireFields(body, res, ['type'])) return;

    const noteType = String(body.type || '').trim();

    const extraFields = (body.fields && typeof body.fields === 'object') ? body.fields : {};
    /** @type {any} */
    let result = null;
    try {
        await context.vaultService.mutate(async () => {
            result = writeNoteFile(context.vaultPath, noteType, extraFields);
            if (!result.ok) {
                /** @type {ApiWriteError} */
                const error = new Error(result.error || 'Create failed');
                error.status = result.status || 500;
                error.code = result.code || 'INTERNAL_ERROR';
                error.details = result.id ? { id: result.id } : {};
                throw error;
            }
            if (context.eventBus && typeof context.eventBus.setPendingChangedId === 'function') {
                context.eventBus.setPendingChangedId(result.id);
            }
            const noteCreatedEvent = withMutationContext(
                [{ type: 'note_created', noteId: result.id, timestamp: new Date().toISOString(), field: null, oldValue: null, newValue: null }],
                { source: requestSource(req), cause: 'api_create_node', sessionId: requestSessionId(req) }
            );
            appendAndEmitMutationEvents(context, noteCreatedEvent);
        });
    } catch (error) {
        /** @type {ApiWriteError} */
        const writeError = error;
        errorJson(res, writeError.code || writeError.status || 500, writeError.message || 'Create failed', writeError.details || {});
        return;
    }

    if (!result) {
        errorJson(res, 'INTERNAL_ERROR', 'Create failed');
        return;
    }
    json(res, { ok: true, id: result.id, filePath: result.filePath, _generation: getVaultGeneration() }, 201);
}

async function bulkCreate(req, res, context) {
    if (req.method !== 'POST') { methodNotAllowed(res); return; }
    const body = await parseJsonBody(req, res);
    if (!body) return;
    if (!requireFields(body, res, ['notes'])) return;

    const notes = Array.isArray(body.notes) ? body.notes : null;
    if (!notes) { badRequest(res, 'Missing param: notes', 'MISSING_PARAM'); return; }
    if (notes.length > 50) { badRequest(res, 'Bulk create limit is 50 notes', 'LIMIT_EXCEEDED'); return; }

    const created = [];
    const errors = [];

    try {
        await context.vaultService.mutate(async () => {
            let lastCreatedId = null;
            for (let index = 0; index < notes.length; index++) {
                const entry = notes[index] || {};
                const noteType = String(entry.type || '').trim();
                if (!noteType) {
                    errors.push({ index, code: 'MISSING_PARAM', error: 'Missing param: type' });
                    continue;
                }
                const extraFields = (entry.fields && typeof entry.fields === 'object') ? entry.fields : {};
                const result = writeNoteFile(context.vaultPath, noteType, extraFields);
                if (!result.ok) {
                    errors.push({ index, code: result.code || 'INTERNAL_ERROR', error: result.error });
                    continue;
                }
                created.push({ ok: true, id: result.id, filePath: result.filePath });
                lastCreatedId = result.id;
                appendAndEmitMutationEvents(
                    context,
                    withMutationContext(
                        [{ type: 'note_created', noteId: result.id, timestamp: new Date().toISOString(), field: null, oldValue: null, newValue: null }],
                        { source: requestSource(req), cause: 'api_bulk_create_node', sessionId: requestSessionId(req) }
                    )
                );
            }
            if (context.eventBus && typeof context.eventBus.setPendingChangedId === 'function') {
                context.eventBus.setPendingChangedId(created.length === 1 && errors.length === 0 ? lastCreatedId : null);
            }
        });
    } catch (error) {
        /** @type {ApiWriteError} */
        const writeError = error;
        errorJson(res, writeError.code || writeError.status || 500, writeError.message || 'Bulk create failed');
        return;
    }

    const status = errors.length > 0 ? 207 : 201;
    json(res, { created, errors, _generation: getVaultGeneration() }, status);
}

async function updateNode(req, res, id, context) {
    if (req.method !== 'PATCH') { methodNotAllowed(res); return; }
    const body = await parseJsonBody(req, res);
    if (!body) return;

    const fieldMap = (body.fields && typeof body.fields === 'object')
        ? body.fields
        : (typeof body.field === 'string' ? { [body.field]: body.value ?? null } : null);

    if (!fieldMap || Object.keys(fieldMap).length === 0) {
        badRequest(res, 'Body must include "field"+"value" or a "fields" object');
        return;
    }

    /** @type {any} */
    let result = null;
    try {
        await context.vaultService.mutate(async () => {
            if (context.eventBus && typeof context.eventBus.setPendingChangedId === 'function') {
                context.eventBus.setPendingChangedId(id);
            }
            result = applyFieldUpdates(id, fieldMap);
            if (!result.ok) {
                /** @type {ApiWriteError} */
                const error = new Error(result.error || 'Update failed');
                error.status = result.status || 500;
                error.code = result.code || 'INTERNAL_ERROR';
                throw error;
            }
            appendAndEmitMutationEvents(
                context,
                withMutationContext(result.mutationEvents, { source: requestSource(req), cause: 'api_update_node', sessionId: requestSessionId(req) })
            );
        });
    } catch (error) {
        /** @type {ApiWriteError} */
        const writeError = error;
        errorJson(res, writeError.code || writeError.status || 500, writeError.message || 'Update failed');
        return;
    }

    const updated = getFieldsCache().get(id) || {};
    json(res, {
        ok: true,
        id,
        _generation: getVaultGeneration(),
        ...Object.fromEntries(Object.entries(updated).filter(([key]) => !key.startsWith('__')))
    });
}

async function bulkUpdate(req, res, context) {
    if (req.method !== 'PATCH') { methodNotAllowed(res); return; }
    const body = await parseJsonBody(req, res);
    if (!body) return;
    if (!requireFields(body, res, ['updates'])) return;

    const updates = Array.isArray(body.updates) ? body.updates : null;
    if (!updates) { badRequest(res, 'Missing param: updates', 'MISSING_PARAM'); return; }
    if (updates.length > 50) { badRequest(res, 'Bulk update limit is 50 notes', 'LIMIT_EXCEEDED'); return; }

    const updated = [];
    const errors = [];

    try {
        await context.vaultService.mutate(async () => {
            let changedId = null;
            for (const entry of updates) {
                const id = String(entry && entry.id || '').trim();
                const fieldMap = (entry && entry.fields && typeof entry.fields === 'object') ? entry.fields : null;
                if (!id || !fieldMap || Object.keys(fieldMap).length === 0) {
                    errors.push({ id: id || '(missing)', code: 'MISSING_PARAM', error: 'Each update must include "id" and non-empty "fields"' });
                    continue;
                }
                const result = applyFieldUpdates(id, fieldMap);
                if (!result.ok) {
                    errors.push({ id, code: result.code || 'INTERNAL_ERROR', error: result.error });
                    continue;
                }
                updated.push({ id, fields: result.changedFields, mutationEvents: result.mutationEvents });
                if (updated.length === 1 && errors.length === 0) changedId = id;
                else changedId = null;
                appendAndEmitMutationEvents(
                    context,
                    withMutationContext(result.mutationEvents, { source: requestSource(req), cause: 'api_bulk_update_node', sessionId: requestSessionId(req) })
                );
            }
            if (context.eventBus && typeof context.eventBus.setPendingChangedId === 'function') {
                context.eventBus.setPendingChangedId(updated.length === 1 && errors.length === 0 ? changedId : null);
            }
        });
    } catch (error) {
        errorJson(res, error.code || error.status || 500, error.message || 'Bulk update failed');
        return;
    }

    const status = errors.length > 0 ? 207 : 200;
    json(res, { updated, errors, _generation: getVaultGeneration() }, status);
}

async function deleteNode(req, res, id, context) {
    if (req.method !== 'DELETE') { methodNotAllowed(res); return; }
    const idIndex = getIndex();
    if (!idIndex.has(id)) { notFound(res, 'Note not found: ' + id); return; }
    const filePath = idIndex.get(id);
    try {
        await context.vaultService.mutate(async () => {
            if (context.eventBus && typeof context.eventBus.setPendingChangedId === 'function') {
                context.eventBus.setPendingChangedId(id);
            }
            fs.unlinkSync(filePath);
            appendAndEmitMutationEvents(
                context,
                withMutationContext(
                    [{ type: 'note_deleted', noteId: id, timestamp: new Date().toISOString(), field: null, oldValue: null, newValue: null }],
                    { source: requestSource(req), cause: 'api_delete_node', sessionId: requestSessionId(req) }
                )
            );
        });
    } catch (error) {
        errorJson(res, 'INTERNAL_ERROR', 'Could not delete file: ' + error.message);
        return;
    }
    json(res, { ok: true, id, _generation: getVaultGeneration() });
}

module.exports = {
    listNodes,
    getNode,
    createNode,
    bulkCreate,
    updateNode,
    bulkUpdate,
    deleteNode
};
