'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { json, badRequest, methodNotAllowed, normaliseSearchValue, coercePositiveInt } = require('../http');

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

async function handleSearch(req, res, url) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    if (!q) { badRequest(res, 'Missing param: q', 'MISSING_PARAM'); return; }

    const type = String(url.searchParams.get('type') || '').trim().toLowerCase();
    const field = String(url.searchParams.get('field') || '').trim();
    const page = coercePositiveInt(url.searchParams.get('page'), 1, 1);
    const rawLimit = coercePositiveInt(url.searchParams.get('limit'), 50, 1);
    const limit = Math.min(rawLimit, 200);

    const matches = [];
    for (const node of allNodes()) {
        if (type && String(node.type || '').trim().toLowerCase() !== type) continue;

        if (field) {
            const fieldValue = normaliseSearchValue(node[field]);
            if (fieldValue && fieldValue.toLowerCase().includes(q)) matches.push(node);
        } else {
            const candidates = [
                node.id,
                normaliseSearchValue(node.name),
                ...Object.entries(node)
                    .filter(([key]) => !key.startsWith('_') && key !== 'id' && key !== 'name')
                    .map(([, value]) => normaliseSearchValue(value))
                    .filter(Boolean)
            ];
            if (candidates.some((value) => value.toLowerCase().includes(q))) matches.push(node);
        }
    }
    const total = matches.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, pages);
    const start = (safePage - 1) * limit;
    json(res, {
        results: matches.slice(start, start + limit),
        meta: { total, page: safePage, limit, pages }
    });
}

module.exports = { handleSearch };
