'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getEdges } = require('../../core/graph');
const { getRegistry } = require('../../registries/typeRegistry');
const { json, methodNotAllowed } = require('../http');

async function handleHealth(req, res, context) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const registry = getRegistry();
    const { buildSchemaIntelligence } = require('../../features/health/healthStats');
    const intelligence = buildSchemaIntelligence(idIndex, fieldsCache, registry);
    let brokenLinks = 0;
    for (const [id] of idIndex) {
        for (const edge of getEdges(id) || []) {
            if (!idIndex.has(edge.targetId)) brokenLinks++;
        }
    }
    json(res, { notes: idIndex.size, brokenLinks, schemaIntelligence: intelligence, vaultPath: context?.vaultPath || null });
}

module.exports = { handleHealth };
