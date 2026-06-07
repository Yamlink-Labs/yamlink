'use strict';

const { normalizeFieldName } = require('./fieldRolesCore');

/** @param {any} value @returns {string} */
function normalizeTagToken(value) {
    return normalizeFieldName(String(value || '').replace(/^#+/, ''));
}

/** @param {string} text @returns {string[]} */
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

/** @param {Record<string, any>} [nodeFields] @returns {string[]} */
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

/** @param {{ getText?: () => string }} document @param {Record<string, any>} [nodeFields] @returns {string[]} */
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
