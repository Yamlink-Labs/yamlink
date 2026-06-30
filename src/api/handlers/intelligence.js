'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const {
    buildArcSnapshot,
    buildTypeArcSnapshot,
    buildFieldCategorySnapshot,
    buildNoteIntelligenceSnapshot
} = require('../../intelligence/intelligenceSnapshots');
const { detectClusters } = require('../../intelligence/clusterEmergence');
const { json, badRequest, methodNotAllowed, notFound } = require('../http');

async function handleArc(req, res, url) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const noteId = url.searchParams.get('id');
    const noteType = url.searchParams.get('type');
    if (!noteId && !noteType) { badRequest(res, 'Missing param: id or type', 'MISSING_PARAM'); return; }

    if (!noteId && noteType) {
        json(res, buildTypeArcSnapshot(noteType));
        return;
    }

    const idIndex = getIndex();
    if (!idIndex.has(noteId)) { notFound(res, 'Note not found: ' + noteId); return; }
    json(res, buildArcSnapshot(noteId));
}

async function handleFieldCategory(req, res, url) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const noteId = url.searchParams.get('id');
    const fieldName = url.searchParams.get('field');
    if (!noteId) { badRequest(res, 'Missing param: id', 'MISSING_PARAM'); return; }
    if (!fieldName) { badRequest(res, 'Missing param: field', 'MISSING_PARAM'); return; }

    const idIndex = getIndex();
    if (!idIndex.has(noteId)) { notFound(res, 'Note not found: ' + noteId); return; }
    json(res, buildFieldCategorySnapshot(noteId, fieldName));
}

async function handleNoteIntelligence(req, res, url) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const noteId = url.searchParams.get('id');
    if (!noteId) { badRequest(res, 'Missing param: id', 'MISSING_PARAM'); return; }

    const idIndex = getIndex();
    if (!idIndex.has(noteId)) { notFound(res, 'Note not found: ' + noteId); return; }
    json(res, buildNoteIntelligenceSnapshot(noteId));
}

async function handleClusters(req, res) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    json(res, detectClusters(getIndex(), getFieldsCache()));
}

module.exports = {
    handleArc,
    handleFieldCategory,
    handleNoteIntelligence,
    handleClusters
};
