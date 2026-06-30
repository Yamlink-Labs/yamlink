'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getEdges, getBacklinks } = require('../../core/graph');
const { inferLifecycleState } = require('../../intelligence/lifecycleState');
const { emitCliSuccess } = require('../io');

function run({ typeFilter, output }) {
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const includedTypes = Array.isArray(typeFilter) && typeFilter.length
        ? new Set(typeFilter.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))
        : null;

    const ids = [...idIndex.keys()].sort().filter((id) => {
        if (!includedTypes) return true;
        const noteType = String(fieldsCache.get(id)?.type || '').trim().toLowerCase();
        return includedTypes.has(noteType);
    });
    const includedIds = new Set(ids);

    const avgInbound = ids.length > 0
        ? ids.reduce((sum, id) => sum + getBacklinks(id).filter((edge) => !includedTypes || includedIds.has(edge.sourceId)).length, 0) / ids.length
        : 0;

    const nodes = ids.map((id) => {
        const fields = fieldsCache.get(id) || {};
        const inbound = getBacklinks(id).filter((edge) => !includedTypes || includedIds.has(edge.sourceId)).length;
        const outbound = getEdges(id).filter((edge) => idIndex.has(edge.targetId) && (!includedTypes || includedIds.has(edge.targetId))).length;
        const lifecycle = inferLifecycleState(id, fields, {
            idIndex,
            fieldsCache,
            noteType: String(fields.type || '').trim().toLowerCase(),
            inboundCount: inbound,
            avgInbound
        });
        return {
            id,
            type: fields.type || null,
            label: fields.name || fields.title || id,
            lifecycle: lifecycle.state,
            inbound,
            outbound
        };
    });

    const edges = [];
    for (const id of ids) {
        for (const edge of getEdges(id)) {
            if (!idIndex.has(edge.targetId)) continue;
            if (includedTypes && !includedIds.has(edge.targetId)) continue;
            edges.push({
                source: id,
                target: edge.targetId,
                field: edge.field,
                type: 'relation'
            });
        }
    }

    const types = new Set(nodes.map((node) => node.type).filter(Boolean));
    emitCliSuccess({
        nodes,
        edges,
        stats: {
            nodes: nodes.length,
            edges: edges.length,
            types: types.size
        }
    }, output);
}

module.exports = { run };
