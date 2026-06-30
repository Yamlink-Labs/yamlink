'use strict';

const { getRegistry } = require('../../registries/typeRegistry');
const { json, methodNotAllowed } = require('../http');

async function handleTypes(req, res) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }
    const registry = getRegistry();
    const types = [];
    for (const [type, ids] of registry) types.push({ type, count: ids.size });
    json(res, { types: types.sort((a, b) => b.count - a.count) });
}

module.exports = { handleTypes };
