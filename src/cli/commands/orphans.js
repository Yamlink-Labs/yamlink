'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getEdges, getBacklinks } = require('../../core/graph');
const fmt = require('../format');
const { captureOutput, emitCliSuccess, emitText } = require('../io');

function run({ typeFilter, limit, json, output }) {
    const idIndex     = getIndex();
    const fieldsCache = getFieldsCache();
    const cap         = limit || 50;

    const orphans = [];
    for (const [id] of idIndex) {
        const noteFields   = fieldsCache.get(id) || {};
        const noteType     = (noteFields.type || '').trim().toLowerCase();
        if (typeFilter && noteType !== typeFilter.toLowerCase()) continue;
        const outbound = getEdges(id) || [];
        const inbound  = getBacklinks(id) || [];
        if (outbound.length === 0 && inbound.length === 0) {
            orphans.push({ id, type: noteType || null });
        }
    }

    orphans.sort((a, b) => a.id.localeCompare(b.id));
    const items = orphans.slice(0, cap);

    const data = {
        total:      orphans.length,
        shown:      items.length,
        typeFilter: typeFilter || null,
        orphans:    items,
    };

    if (json) {
        emitCliSuccess(data, output);
        return;
    }

    emitText(captureOutput(() => {
        const typeLabel = typeFilter ? ` (type: ${typeFilter})` : '';
        fmt.header(`Orphan Notes${typeLabel}`);
        fmt.row('Orphans', data.total > 0 ? fmt.warn(String(data.total)) : fmt.ok('0'));
        fmt.blank();

        if (!items.length) {
            fmt.row('Result', fmt.ok('No orphans — all notes have at least one link'));
            fmt.blank();
            return;
        }

        for (const n of items) {
            const typeStr = n.type ? ` (${n.type})` : '';
            fmt.row(`  ${n.id}${typeStr}`, 'no inbound or outbound links');
        }
        fmt.blank();
    }), output);
}

module.exports = { run };
