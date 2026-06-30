'use strict';

const fs = require('fs');
const path = require('path');

const {
    parseFrontmatterDocument,
    setField,
    deleteField,
    serializeFrontmatterDocument,
    writeFrontmatterFieldSurgically,
} = require('../core/frontmatter');
const { canonicalizeId } = require('../core/id');
const { getIndex } = require('../core/indexService');

function extractRelationTargets(value) {
    const text = String(value ?? '');
    const matches = [...text.matchAll(/\[\[([^\]|#\n]+?)(?:[|#][^\]\n]*)?\]\]/g)];
    return [...new Set(matches.map((match) => match[1].trim()).filter(Boolean))].sort();
}

function buildFieldMutationEvents(noteId, beforeFields, afterFields) {
    const timestamp = new Date().toISOString();
    const events = [];
    const keys = new Set([...Object.keys(beforeFields || {}), ...Object.keys(afterFields || {})]);

    for (const key of keys) {
        if (key === 'id' || String(key).startsWith('__')) continue;
        const before = beforeFields ? beforeFields[key] : undefined;
        const after = afterFields ? afterFields[key] : undefined;
        const hadBefore = before !== undefined && before !== null && String(before).trim() !== '';
        const hasAfter = after !== undefined && after !== null && String(after).trim() !== '';
        if (!hadBefore && !hasAfter) continue;

        if (String(before ?? '') !== String(after ?? '')) {
            events.push({
                timestamp,
                type: 'field_changed',
                noteId,
                field: key,
                oldValue: hadBefore ? before : null,
                newValue: hasAfter ? after : null
            });
        }

        const beforeTargets = extractRelationTargets(before);
        const afterTargets = extractRelationTargets(after);
        if (beforeTargets.join('|') !== afterTargets.join('|') && (beforeTargets.length || afterTargets.length)) {
            const relationType = beforeTargets.length === 0 ? 'relation_added'
                : afterTargets.length === 0 ? 'relation_removed'
                : 'relation_changed';
            events.push({
                timestamp,
                type: relationType,
                noteId,
                field: key,
                oldValue: beforeTargets.join(', ') || null,
                newValue: afterTargets.join(', ') || null
            });
        }
    }

    return events;
}

function writeFieldSync(filePath, field, value) {
    if (!filePath || !field || field === 'id') return false;
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (_) { return false; }
    let parsed;
    try { parsed = parseFrontmatterDocument(content); } catch (_) { return false; }
    if (!parsed.hasFrontmatter) return false;

    const normalised = typeof value === 'string' ? value.trim() : value;
    const nextDoc = (normalised === null || normalised === '')
        ? deleteField(parsed, field)
        : setField(parsed, field, normalised);

    const canonical = (normalised === null || normalised === '') ? null : nextDoc.data[field];
    const surgical = writeFrontmatterFieldSurgically(content, field, canonical);
    const nextContent = surgical !== null ? surgical : serializeFrontmatterDocument(nextDoc);

    try {
        fs.writeFileSync(filePath, nextContent, 'utf8');
        return true;
    } catch (_) {
        return false;
    }
}

function writeNoteFile(vaultPath, noteType, extraFields) {
    const nameSource = extraFields.name || extraFields.title || extraFields.id || '';
    const rawId = nameSource ? canonicalizeId(nameSource) : `${canonicalizeId(noteType)}-${Date.now()}`;
    const noteId = rawId || `note-${Date.now()}`;
    const filePath = path.join(vaultPath, `${noteId}.md`);

    if (fs.existsSync(filePath)) {
        return { ok: false, status: 409, code: 'CONFLICT', error: 'A note with this ID already exists', id: noteId };
    }

    const lines = ['---', `id: ${noteId}`, `type: ${noteType}`];
    for (const [key, value] of Object.entries(extraFields)) {
        if (key === 'id' || key === 'type') continue;
        lines.push(`${key}: ${value}`);
    }
    lines.push('---', '');

    try {
        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
        return { ok: true, id: noteId, filePath };
    } catch (error) {
        return { ok: false, status: 500, code: 'INTERNAL_ERROR', error: 'Could not write file: ' + error.message };
    }
}

function applyFieldUpdates(id, fieldMap) {
    const idIndex = getIndex();
    if (!idIndex.has(id)) {
        return { ok: false, status: 404, code: 'NOT_FOUND', error: 'Note not found: ' + id };
    }
    const filePath = idIndex.get(id);
    let content;
    let beforeFields = {};
    try {
        content = fs.readFileSync(filePath, 'utf8');
        beforeFields = parseFrontmatterDocument(content).data || {};
    } catch (_) {}
    let anyFailed = false;
    for (const [field, value] of Object.entries(fieldMap)) {
        if (!writeFieldSync(filePath, field, value)) anyFailed = true;
    }
    let afterFields = beforeFields;
    try {
        afterFields = parseFrontmatterDocument(fs.readFileSync(filePath, 'utf8')).data || {};
    } catch (_) {}
    const mutationEvents = buildFieldMutationEvents(id, beforeFields, afterFields);
    return {
        ok: !anyFailed,
        filePath,
        changedFields: Object.keys(fieldMap),
        mutationEvents
    };
}

module.exports = {
    writeFieldSync,
    writeNoteFile,
    applyFieldUpdates,
    buildFieldMutationEvents
};
