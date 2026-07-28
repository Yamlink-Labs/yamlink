'use strict';

const fs = require('fs');
const { getIndex, getFieldsCache } = require('../../core/indexService');
const { emitCliError, emitCliSuccess, captureOutput, emitText } = require('../io');
const fmt = require('../format');

function groupRows(rows) {
    const groups = [];
    const byKey = new Map();
    for (const row of rows) {
        const key = `${row.targetKind}:${row.targetBlockId}:${row.targetLabel}`;
        if (!byKey.has(key)) {
            const group = {
                targetBlockId: row.targetBlockId,
                targetLabel: row.targetLabel,
                targetKind: row.targetKind,
                rows: []
            };
            byKey.set(key, group);
            groups.push(group);
        }
        byKey.get(key).rows.push(row);
    }
    return groups;
}

function run({ id, blockId, json }) {
    const noteId = String(id || '').trim();
    if (!noteId) {
        emitCliError({ json, error: 'Usage: yamlink block-backlinks <note-id> [--block <block-id>]', code: 'USAGE', exitCode: 1 });
        return;
    }

    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    if (!idIndex.has(noteId)) {
        emitCliError({ json, error: 'Note not found: ' + noteId, code: 'NOT_FOUND', exitCode: 1, details: { id: noteId } });
        return;
    }

    const filePath = idIndex.get(noteId);
    let docText = '';
    try {
        docText = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        emitCliError({ json, error: 'Could not read note: ' + error.message, code: 'INTERNAL_ERROR', exitCode: 2, details: { id: noteId, filePath } });
        return;
    }

    const requestedBlock = String(blockId || '').trim();
    const { buildBlockBacklinks } = require('../../features/entityHubModel');
    const backlinks = buildBlockBacklinks(noteId, docText, idIndex, fieldsCache)
        .filter((row) => !requestedBlock || row.targetBlockId === requestedBlock);

    if (json) {
        emitCliSuccess({ noteId, blockId: requestedBlock || null, backlinks });
        return;
    }

    if (!backlinks.length) {
        emitText(fmt.warn('no block-level backlinks found') + '\n');
        return;
    }

    emitText(captureOutput(() => {
        for (const group of groupRows(backlinks)) {
            fmt.header(`${group.targetLabel} (${group.targetKind})`);
            for (const row of group.rows) {
                const sourceType = row.sourceType ? ` (${row.sourceType})` : '';
                console.log(`  ${fmt.ok(row.sourceLabel)}${sourceType}, line ${row.line} — ${row.kind}`);
            }
        }
    }));
}

module.exports = { run, groupRows };
