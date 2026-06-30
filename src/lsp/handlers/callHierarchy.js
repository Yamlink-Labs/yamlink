'use strict';

const fs = require('fs');

const { getIndex, getAliasIndex, getFieldsCache } = require('../../core/indexService');
const { resolveLinkedTarget } = require('../../core/id');
const { respond, respondImmediate } = require('../transport');
const { getDocumentText } = require('../documentState');
const { isRequestCancelled, cancellationCheckpoint } = require('../cancellation');
const {
    WIKILINK_RE,
    wikilinkMatchAtPosition,
    pathToUri,
    uriToPath,
    getLinkedOccurrences,
    collectLinkedCandidateFiles
} = require('../utils');

function buildCallHierarchyItem(id, filePath, fields) {
    const noteFields = fields || {};
    return {
        name: String(noteFields.name || noteFields.title || id),
        kind: 5,
        detail: String(noteFields.type || ''),
        uri: pathToUri(filePath),
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        data: { id }
    };
}

function resolveCallHierarchyTarget(textDocument, position, state) {
    if (!textDocument || !position) return null;
    const content = getDocumentText(state, textDocument.uri);
    const lines = content.split('\n');
    const line = lines[position.line] || '';
    const idIndex = getIndex();
    const aliasIndex = getAliasIndex();

    const linkMatch = wikilinkMatchAtPosition(line, position.character);
    if (linkMatch) {
        const id = resolveLinkedTarget(linkMatch.rawTarget, idIndex, aliasIndex);
        if (!id) return null;
        const filePath = idIndex.get(id);
        if (!filePath) return null;
        return { id, filePath };
    }

    const idMatch = /^(id:\s+)(\S+)/.exec(line);
    if (idMatch) {
        const start = idMatch[1].length;
        const end = start + idMatch[2].length;
        if (position.character >= start && position.character <= end) {
            const id = idMatch[2];
            const filePath = idIndex.get(id);
            if (!filePath) return null;
            return { id, filePath };
        }
    }

    const filePath = uriToPath(textDocument.uri);
    for (const [id, indexedPath] of idIndex.entries()) {
        if (indexedPath === filePath) return { id, filePath };
    }
    return null;
}

async function handlePrepareCallHierarchy(msg, state) {
    const { textDocument, position } = msg.params || {};
    const resolved = resolveCallHierarchyTarget(textDocument, position, state);
    if (!resolved) {
        respond(msg.id, null);
        return;
    }
    const fields = getFieldsCache().get(resolved.id) || {};
    respondImmediate(msg.id, [buildCallHierarchyItem(resolved.id, resolved.filePath, fields)]);
}

async function handleIncomingCalls(msg, state) {
    const item = msg?.params?.item;
    const id = item?.data?.id;
    if (!id) { respond(msg.id, []); return; }

    const idIndex = getIndex();
    const aliasIndex = getAliasIndex();
    const fieldsCache = getFieldsCache();
    const declarationFields = fieldsCache.get(id) || {};
    const aliasTexts = Array.isArray(declarationFields.aliases)
        ? declarationFields.aliases.map((alias) => String(alias || '').trim()).filter(Boolean)
        : String(declarationFields.aliases || '').split(/,\s*/).map((alias) => String(alias || '').trim()).filter(Boolean);
    const lookupTargets = [id].concat(aliasTexts);
    const candidateFiles = collectLinkedCandidateFiles({
        vaultPath: state.vaultPath,
        state,
        id,
        idIndex,
        aliasTexts
    });
    const openDocUris = new Set(state.openDocs.keys());
    const grouped = new Map();
    let processed = 0;

    for (const occurrence of getLinkedOccurrences(state, lookupTargets)) {
        if ((processed++ % 200) === 0) await cancellationCheckpoint(state, msg.id);
        const occurrenceUri = pathToUri(occurrence.filePath);
        if (openDocUris.has(occurrenceUri)) continue;
        const sourceId = [...idIndex.entries()].find(([, filePath]) => filePath === occurrence.filePath)?.[0];
        if (!sourceId || sourceId === id) continue;
        const currentId = resolveLinkedTarget(occurrence.rawTarget, idIndex, aliasIndex);
        if (currentId !== id) continue;
        if (!grouped.has(sourceId)) grouped.set(sourceId, []);
        grouped.get(sourceId).push({
            start: { line: occurrence.line, character: occurrence.start },
            end: { line: occurrence.line, character: occurrence.end }
        });
    }

    for (const filePath of candidateFiles) {
        if ((processed++ % 25) === 0) await cancellationCheckpoint(state, msg.id);
        const uri = pathToUri(filePath);
        if (!state.openDocs.has(uri)) continue;
        const sourceId = [...idIndex.entries()].find(([, indexedPath]) => indexedPath === filePath)?.[0];
        if (!sourceId || sourceId === id) continue;
        const text = state.openDocs.get(uri) || '';
        const lines = text.split('\n');
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            WIKILINK_RE.lastIndex = 0;
            let match;
            while ((match = WIKILINK_RE.exec(lines[lineIdx])) !== null) {
                const currentId = resolveLinkedTarget(String(match[1] || '').trim(), idIndex, aliasIndex);
                if (currentId !== id) continue;
                if (!grouped.has(sourceId)) grouped.set(sourceId, []);
                grouped.get(sourceId).push({
                    start: { line: lineIdx, character: match.index },
                    end: { line: lineIdx, character: match.index + match[0].length }
                });
            }
        }
    }

    if (isRequestCancelled(state, msg.id)) return;

    const result = [];
    for (const [sourceId, fromRanges] of grouped.entries()) {
        const filePath = idIndex.get(sourceId);
        if (!filePath) continue;
        result.push({
            from: buildCallHierarchyItem(sourceId, filePath, fieldsCache.get(sourceId) || {}),
            fromRanges
        });
    }
    respondImmediate(msg.id, result);
}

async function handleOutgoingCalls(msg, state) {
    const item = msg?.params?.item;
    const id = item?.data?.id;
    if (!id) { respond(msg.id, []); return; }

    const idIndex = getIndex();
    const aliasIndex = getAliasIndex();
    const fieldsCache = getFieldsCache();
    const filePath = idIndex.get(id);
    if (!filePath) { respond(msg.id, []); return; }

    const uri = pathToUri(filePath);
    let text = state.openDocs.has(uri) ? (state.openDocs.get(uri) || '') : null;
    if (text == null) {
        try { text = fs.readFileSync(filePath, 'utf8'); } catch (_) { text = ''; }
    }

    const grouped = new Map();
    const lines = String(text || '').split('\n');
    let processed = 0;
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        if ((processed++ % 100) === 0) await cancellationCheckpoint(state, msg.id);
        WIKILINK_RE.lastIndex = 0;
        let match;
        while ((match = WIKILINK_RE.exec(lines[lineIdx])) !== null) {
            const targetId = resolveLinkedTarget(String(match[1] || '').trim(), idIndex, aliasIndex);
            if (!targetId || targetId === id) continue;
            if (!grouped.has(targetId)) grouped.set(targetId, []);
            grouped.get(targetId).push({
                start: { line: lineIdx, character: match.index },
                end: { line: lineIdx, character: match.index + match[0].length }
            });
        }
    }

    if (isRequestCancelled(state, msg.id)) return;

    const result = [];
    for (const [targetId, fromRanges] of grouped.entries()) {
        const targetPath = idIndex.get(targetId);
        if (!targetPath) continue;
        result.push({
            to: buildCallHierarchyItem(targetId, targetPath, fieldsCache.get(targetId) || {}),
            fromRanges
        });
    }
    respondImmediate(msg.id, result);
}

module.exports = {
    handlePrepareCallHierarchy,
    handleIncomingCalls,
    handleOutgoingCalls
};
