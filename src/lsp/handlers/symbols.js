'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { respond, respondImmediate } = require('../transport');
const { pathToUri } = require('../utils');
const { getDocumentText } = require('../documentState');
const { buildDocumentStructure } = require('../documentStructure');
const { cancellationCheckpoint, isRequestCancelled } = require('../cancellation');

function makeDocumentSymbol(name, detail, kind, range, selectionRange, children = []) {
    return { name, detail, kind, range, selectionRange, children };
}

function fieldSymbol(field) {
    return makeDocumentSymbol(
        field.key,
        String(field.value || '').trim(),
        8,
        field.range,
        field.selectionRange
    );
}

function headingSymbol(heading) {
    return makeDocumentSymbol(
        heading.title,
        '#'.repeat(heading.level),
        15,
        heading.range,
        heading.selectionRange,
        heading.children.map(headingSymbol)
    );
}

function handleDocumentSymbols(msg, state) {
    const { textDocument } = msg.params || {};
    if (!textDocument) { respond(msg.id, []); return; }

    const structure = buildDocumentStructure(getDocumentText(state, textDocument.uri), textDocument.uri);
    const children = [];

    if (structure.frontmatter?.fields.length) {
        children.push(makeDocumentSymbol(
            'Frontmatter',
            `${structure.frontmatter.fields.length} field${structure.frontmatter.fields.length === 1 ? '' : 's'}`,
            2,
            structure.frontmatter.range,
            structure.frontmatter.selectionRange,
            structure.frontmatter.fields.map(fieldSymbol)
        ));
    }
    children.push(...structure.headingRoots.map(headingSymbol));

    respond(msg.id, [
        makeDocumentSymbol(
            structure.rootName,
            structure.rootDetail,
            5,
            structure.rootRange,
            structure.rootRange,
            children
        )
    ]);
}

async function handleWorkspaceSymbol(msg, state) {
    const { query } = msg.params || {};
    const q = (query || '').toLowerCase();

    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const symbols = [];

    let processed = 0;
    for (const [id, filePath] of idIndex) {
        if ((processed++ % 200) === 0) await cancellationCheckpoint(state, msg.id);
        const fields = fieldsCache.get(id) || {};
        const name = String(fields.name || fields.title || id);
        const type = String(fields.type || '');

        if (q && !id.includes(q) && !name.toLowerCase().includes(q) && !type.includes(q)) continue;

        symbols.push({
            name: name !== id ? name : id,
            detail: type,
            kind: 5,
            location: {
                uri: pathToUri(filePath),
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
            }
        });
    }

    symbols.sort((a, b) => a.name.localeCompare(b.name));
    if (isRequestCancelled(state, msg.id)) return;
    respondImmediate(msg.id, symbols.slice(0, 100));
}

module.exports = { handleDocumentSymbols, handleWorkspaceSymbol };
