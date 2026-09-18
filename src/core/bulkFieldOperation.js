'use strict';

const {
    parseFrontmatterDocument,
    writeFrontmatterFieldSurgically,
    serializeFrontmatterDocument,
    setField,
    deleteField
} = require('./frontmatter');

function toWikilink(value) {
    const raw = String(value || '').trim();
    if (/^\[\[[^\]]+\]\]$/.test(raw)) return raw;
    return `[[${raw}]]`;
}

function wikilinkTarget(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^\[\[([^\]|#^]+)(?:[|#^][^\]]*)?\]\]$/);
    return match ? match[1] : raw;
}

function valuesMatchRelation(a, b) {
    return wikilinkTarget(a) === wikilinkTarget(b);
}

function pickOperation({ value, add, clear }) {
    const operations = [
        value !== null && value !== undefined ? 'value' : null,
        add !== null && add !== undefined ? 'add' : null,
        clear ? 'clear' : null
    ].filter(Boolean);
    return operations.length === 1 ? operations[0] : null;
}

function buildNextValue(parsed, field, operation, rawValue, rawAdd) {
    const oldValue = Object.prototype.hasOwnProperty.call(parsed.data, field) ? parsed.data[field] : null;

    if (operation === 'clear') {
        return { oldValue, newValue: null, changed: oldValue !== null };
    }

    if (operation === 'value') {
        const newValue = String(rawValue).trim();
        return { oldValue, newValue, changed: oldValue !== newValue };
    }

    const wikilink = toWikilink(rawAdd);
    if (oldValue === null) {
        return { oldValue, newValue: [wikilink], changed: true };
    }
    if (!Array.isArray(oldValue)) {
        throw new Error(`Field "${field}" is a scalar value on this note; add only works with list fields.`);
    }
    if (oldValue.some((item) => valuesMatchRelation(item, wikilink))) {
        return { oldValue, newValue: [...oldValue], changed: false };
    }
    return { oldValue, newValue: [...oldValue, wikilink], changed: true };
}

function buildNextContent(content, parsed, field, operation, newValue) {
    const nextDoc = operation === 'clear'
        ? deleteField(parsed, field)
        : setField(parsed, field, newValue);
    const surgical = writeFrontmatterFieldSurgically(content, field, newValue);
    return surgical !== null ? surgical : serializeFrontmatterDocument(nextDoc);
}

function eventTypeFor(oldValue, newValue) {
    if (oldValue === null && newValue !== null) return 'field_added';
    if (oldValue !== null && newValue === null) return 'field_removed';
    return 'field_changed';
}

function buildFieldOperation(content, field, operation, value) {
    if (!field || field === 'id') {
        throw new Error(field === 'id' ? 'Use rename to change note ids.' : 'Field is required.');
    }
    const parsed = parseFrontmatterDocument(content);
    if (!parsed.hasFrontmatter) throw new Error('Note has no frontmatter block.');
    const rawValue = operation === 'value' ? value : null;
    const rawAdd = operation === 'add' ? value : null;
    const { oldValue, newValue, changed } = buildNextValue(parsed, field, operation, rawValue, rawAdd);
    const nextContent = changed ? buildNextContent(content, parsed, field, operation, newValue) : content;
    return {
        field,
        operation,
        oldValue,
        newValue,
        changed,
        nextContent,
        eventType: changed ? eventTypeFor(oldValue, newValue) : null
    };
}

function operationFromApiFieldValue(value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'add')) {
        return { operation: 'add', value: value.add };
    }
    if (value === null || value === '') {
        return { operation: 'clear', value: null };
    }
    return { operation: 'value', value };
}

module.exports = {
    toWikilink,
    wikilinkTarget,
    valuesMatchRelation,
    pickOperation,
    buildNextValue,
    buildNextContent,
    eventTypeFor,
    buildFieldOperation,
    operationFromApiFieldValue
};
