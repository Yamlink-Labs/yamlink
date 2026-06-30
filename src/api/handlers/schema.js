'use strict';

const { getSchemaTargets, getSchema } = require('../../registries/schemaRegistry');
const { json, methodNotAllowed, coercePositiveInt } = require('../http');

async function handleSchema(req, res, url) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const type = String(url.searchParams.get('type') || '').trim().toLowerCase();
    const page = coercePositiveInt(url.searchParams.get('page'), 1, 1);
    const rawLimit = coercePositiveInt(url.searchParams.get('limit'), 50, 1);
    const limit = Math.min(rawLimit, 100);
    const targets = [...getSchemaTargets()].filter((targetType) => !type || targetType === type);
    const result = targets.map((targetType) => {
        const schema = getSchema(targetType);
        return {
            targetType,
            schemaId: schema ? schema.sourceId : null,
            fields: schema && schema.fields ? schema.fields : {}
        };
    });
    const total = result.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, pages);
    const start = (safePage - 1) * limit;
    json(res, {
        schemas: result.slice(start, start + limit),
        meta: { total, page: safePage, limit, pages }
    });
}

module.exports = { handleSchema };
