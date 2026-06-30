'use strict';

const vscode = require('vscode');
const { getVaultGeneration } = require('../core/indexService');
const { getSurfacePolicy, readConfidence } = require('../intelligence/confidence');
const { CATEGORY } = require('../intelligence/fieldCategory');
const { classifyFieldForAuthoring } = require('../intelligence/authoringEngine');

function parseFieldNameFromLine(line) {
    const match = String(line || '').trim().match(/^([\w-]+)\s*:/);
    return match ? match[1].toLowerCase() : null;
}

function classifyCurrentField(fieldName, nodeType, fieldsCache, noteFields, bodyWikilinkCounts) {
    if (!fieldName) return { category: CATEGORY.UNKNOWN, confidence: 0, source: 'default', reasons: ['missing field name'] };
    return classifyFieldForAuthoring(fieldName, {
        fieldsCache,
        noteType: nodeType,
        noteFields,
        generation: getVaultGeneration(),
        documentText: '',
        bodyWikilinkCounts: bodyWikilinkCounts || null
    }).classification;
}

function getFrontmatterRange(document) {
    const lines = document.getText().split('\n');
    let openLine = -1;
    let closeLine = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^---\s*$/.test(lines[i])) {
            if (openLine === -1) openLine = i;
            else {
                closeLine = i;
                break;
            }
        }
    }
    return openLine !== -1 && closeLine !== -1 ? { openLine, closeLine } : null;
}

function parseFrontmatterLine(lineText = '') {
    const match = String(lineText || '').match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
    if (!match) return null;
    return {
        fieldName: String(match[1] || '').trim().toLowerCase(),
        rawValue: String(match[2] || ''),
        value: String(match[2] || '').trim()
    };
}

function strictSurfaceItems(items = [], surface, options = {}) {
    const policy = getSurfacePolicy(surface);
    return (Array.isArray(items) ? items : []).filter((item) => readConfidence(item, options) >= policy.minimum);
}

function formatFieldPrompt(field) {
    return `Add ${field} here?`;
}

function formatFieldListPrompt(fields, fallback = 'Fill in the usual fields?') {
    const list = Array.isArray(fields)
        ? fields.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
    if (list.length === 1) return `Add ${list[0]} here?`;
    if (list.length === 2) return `Add ${list[0]} and ${list[1]} here?`;
    if (list.length >= 3) return `Fill in the usual fields?`;
    return fallback;
}

function formatLinkPrompt(targetId, prefix = 'Should this note link to') {
    return `${prefix} ${targetId}?`;
}

function getFieldTargetTypesFromSchema(schema, fieldName) {
    if (!schema?.fields || !fieldName) return [];
    const raw = schema.fields[fieldName] || schema.fields[fieldName.replace(/-/g, '_')] || null;
    if (!raw || String(raw.type || '').trim().toLowerCase() !== 'relation') return [];
    if (raw.target) return [String(raw.target).trim().toLowerCase()].filter(Boolean);
    if (Array.isArray(raw.targetTypes)) {
        return raw.targetTypes.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
    }
    return [];
}

function buildFieldValueRange(document, lineIndex, fieldName) {
    const lineText = document.lineAt(lineIndex).text;
    const match = String(lineText || '').match(/^(\s*[\w-]+\s*:)(\s*)(.*?)\s*$/);
    if (!match) return null;
    const normalized = String(fieldName || '').trim().toLowerCase();
    const parsedField = parseFieldNameFromLine(lineText);
    if (normalized && parsedField !== normalized) return null;
    const valueStart = match[1].length;
    return new vscode.Range(
        new vscode.Position(lineIndex, valueStart),
        new vscode.Position(lineIndex, lineText.length)
    );
}

function getFieldValueReplacement(document, lineIndex, fieldName, replacement) {
    const range = buildFieldValueRange(document, lineIndex, fieldName);
    const normalizedReplacement = String(replacement || '').replace(/\r?\n$/, '');
    if (!range) return null;
    return { range, text: normalizedReplacement ? ` ${normalizedReplacement}` : '' };
}

module.exports = {
    parseFieldNameFromLine,
    classifyCurrentField,
    getFrontmatterRange,
    parseFrontmatterLine,
    strictSurfaceItems,
    formatFieldPrompt,
    formatFieldListPrompt,
    formatLinkPrompt,
    getFieldTargetTypesFromSchema,
    buildFieldValueRange,
    getFieldValueReplacement
};
