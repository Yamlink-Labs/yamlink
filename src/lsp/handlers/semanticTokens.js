'use strict';

const { getIndex, getAliasIndex, getFieldsCache, getVaultGeneration } = require('../../core/indexService');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { CATEGORY } = require('../../intelligence/fieldCategory');
const { classifyFieldForAuthoring } = require('../../intelligence/authoringEngine');
const { resolveLinkedTarget } = require('../../core/id');
const { respond } = require('../transport');

const TOKEN_TYPES = ['property', 'type', 'enumMember', 'class', 'string', 'operator'];
const TOKEN_MODIFIERS = ['deprecated'];

const TOKEN_TYPE_INDEX = Object.fromEntries(TOKEN_TYPES.map((name, index) => [name, index]));
const TOKEN_MODIFIER_MASK = Object.fromEntries(TOKEN_MODIFIERS.map((name, index) => [name, 1 << index]));

function pushToken(tokens, line, start, length, type, modifiers = 0) {
    if (length <= 0) return;
    tokens.push({ line, start, length, tokenType: TOKEN_TYPE_INDEX[type], tokenModifiers: modifiers });
}

function encodeTokens(tokens) {
    tokens.sort((a, b) => a.line - b.line || a.start - b.start || a.tokenType - b.tokenType);
    const data = [];
    let prevLine = 0;
    let prevStart = 0;
    for (const token of tokens) {
        const deltaLine = token.line - prevLine;
        const deltaStart = deltaLine === 0 ? token.start - prevStart : token.start;
        data.push(deltaLine, deltaStart, token.length, token.tokenType, token.tokenModifiers);
        prevLine = token.line;
        prevStart = token.start;
    }
    return data;
}

function semanticLegend() {
    return {
        tokenTypes: TOKEN_TYPES,
        tokenModifiers: TOKEN_MODIFIERS
    };
}

function frontmatterContext(content) {
    const lines = content.split('\n');
    if (!lines[0] || lines[0].trim() !== '---') return { lines, end: -1 };
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] && lines[i].trim() === '---') return { lines, end: i };
    }
    return { lines, end: -1 };
}

function classifyFrontmatterField(fieldName, noteFields, noteType, priors, fieldsCache) {
    return classifyFieldForAuthoring(fieldName, {
        fieldsCache,
        noteFields,
        noteType,
        generation: getVaultGeneration()
    }).classification;
}

function buildSemanticTokens(content) {
    const tokens = [];
    const { lines, end } = frontmatterContext(content);
    const idIndex = getIndex();
    const aliasIndex = getAliasIndex();
    const fieldsCache = getFieldsCache();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());

    let noteFields = {};
    let noteType = '';
    if (end !== -1) {
        for (let i = 1; i < end; i++) {
            const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
            if (!match) continue;
            noteFields[match[1]] = match[2].trim();
        }
        noteType = String(noteFields.type || '');
    }

    if (end !== -1) {
        for (let i = 1; i < end; i++) {
            const line = lines[i];
            const match = /^([A-Za-z0-9_-]+):(\s*)(.*)$/.exec(line);
            if (!match) continue;
            const fieldName = match[1];
            const spacing = match[2] || '';
            const value = match[3] || '';
            const keyStart = line.indexOf(fieldName);
            pushToken(tokens, i, keyStart, fieldName.length, 'property');

            const valueStart = keyStart + fieldName.length + 1 + spacing.length;
            if (fieldName === 'type' && value.trim()) {
                const trimmed = value.trim();
                const offset = value.indexOf(trimmed);
                pushToken(tokens, i, valueStart + offset, trimmed.length, 'type');
            } else {
                const classification = classifyFrontmatterField(fieldName, noteFields, noteType, priors, fieldsCache);
                if (classification.category === CATEGORY.WORKFLOW) {
                    const trimmed = value.trim();
                    if (trimmed) {
                        const offset = value.indexOf(trimmed);
                        pushToken(tokens, i, valueStart + offset, trimmed.length, 'enumMember');
                    }
                }
            }
        }
    }

    const wikilinkRegex = /(!?)\[\[([^\]]+)\]\]/g;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        let match;
        while ((match = wikilinkRegex.exec(line)) !== null) {
            const full = match[0];
            const rawInner = match[2];
            const fullStart = match.index + (match[1] ? 1 : 0);
            pushToken(tokens, lineIndex, fullStart, 2, 'operator');
            pushToken(tokens, lineIndex, fullStart + full.length - (match[1] ? 3 : 2), 2, 'operator');

            const innerStart = fullStart + 2;
            const innerRaw = rawInner.split('|')[0];
            const innerLength = innerRaw.length;
            const resolved = resolveLinkedTarget(rawInner, idIndex, aliasIndex);
            if (resolved) {
                pushToken(tokens, lineIndex, innerStart, innerLength, 'class');
            } else {
                pushToken(tokens, lineIndex, innerStart, innerLength, 'string', TOKEN_MODIFIER_MASK.deprecated);
            }
        }
        wikilinkRegex.lastIndex = 0;
    }

    return { data: encodeTokens(tokens) };
}

function handleSemanticTokensFull(msg, state) {
    const { textDocument } = msg.params || {};
    if (!textDocument) { respond(msg.id, { data: [] }); return; }
    const content = state.openDocs.get(textDocument.uri) || '';
    respond(msg.id, buildSemanticTokens(content));
}

module.exports = {
    TOKEN_TYPES,
    TOKEN_MODIFIERS,
    semanticLegend,
    buildSemanticTokens,
    handleSemanticTokensFull
};
