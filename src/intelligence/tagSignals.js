'use strict';

const { normalizeFieldName } = require('./fieldRolesCore');

function normalizeTagToken(value) {
    return normalizeFieldName(String(value || '').replace(/^#+/, ''));
}

function extractTagsFromText(text) {
    const tags = new Set();
    const regex = /(^|[\s(])#([A-Za-z][\w-]*)/gm;
    let match;
    while ((match = regex.exec(String(text || ''))) !== null) {
        const tag = normalizeTagToken(match[2] || '');
        if (tag) tags.add(tag);
    }
    return [...tags];
}

function extractTagsFromNodeFields(nodeFields = {}) {
    const tags = new Set();
    for (const key of ['tags', 'tag', 'labels', 'label', '__yamlink_tags']) {
        const rawValue = nodeFields[key];
        if (rawValue == null) continue;
        String(rawValue)
            .split(/[,\n]/)
            .map((entry) => normalizeTagToken(entry))
            .filter(Boolean)
            .forEach((tag) => tags.add(tag));
    }
    return [...tags];
}

function collectDocumentTags(document, nodeFields = {}) {
    return [...new Set([
        ...extractTagsFromNodeFields(nodeFields),
        ...extractTagsFromText(document?.getText?.() || '')
    ])];
}

module.exports = {
    normalizeTagToken,
    extractTagsFromText,
    extractTagsFromNodeFields,
    collectDocumentTags
};
