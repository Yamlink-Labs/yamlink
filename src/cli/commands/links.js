'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getEdges, getBacklinks } = require('../../core/graph');
const fmt = require('../format');
const { captureOutput, emitCliError, emitCliSuccess, emitText } = require('../io');

function run({ id, json, output }) {
    const idIndex     = getIndex();
    const fieldsCache = getFieldsCache();

    if (!idIndex.has(id)) {
        emitCliError({
            json,
            outputPath: output,
            error: 'Note not found: ' + id,
            code: 'NOT_FOUND',
            details: { id },
            exitCode: 1
        });
        return;
    }

    const outbound = getEdges(id) || [];
    const inbound  = getBacklinks(id) || [];

    const data = {
        id,
        outbound: outbound.map(e => ({
            field:  e.field,
            to:     e.targetId,
            type:   (fieldsCache.get(e.targetId) || {}).type || null,
            exists: idIndex.has(e.targetId),
        })),
        inbound: inbound.map(e => ({
            field: e.field,
            from:  e.sourceId,
            type:  (fieldsCache.get(e.sourceId) || {}).type || null,
        })),
    };

    if (json) {
        emitCliSuccess(data, output);
        return;
    }

    emitText(captureOutput(() => {
        fmt.header('Links: ' + id);
        fmt.row('Outbound', outbound.length);
        fmt.row('Inbound',  inbound.length);

        if (data.outbound.length) {
            fmt.blank();
            fmt.subheader('Outbound');
            fmt.table(
                data.outbound.map(e => ({
                    field: e.field,
                    to:    e.exists ? e.to : fmt.warn(e.to + ' ⚠'),
                    type:  e.type || '—',
                })),
                [
                    { key: 'field', label: 'field' },
                    { key: 'to',    label: 'to' },
                    { key: 'type',  label: 'type' },
                ]
            );
        }

        if (data.inbound.length) {
            fmt.blank();
            fmt.subheader('Inbound');
            fmt.table(
                data.inbound.map(e => ({
                    field: e.field,
                    from:  e.from,
                    type:  e.type || '—',
                })),
                [
                    { key: 'field', label: 'field' },
                    { key: 'from',  label: 'from' },
                    { key: 'type',  label: 'type' },
                ]
            );
        }

        fmt.blank();
    }), output);
}

module.exports = { run };
