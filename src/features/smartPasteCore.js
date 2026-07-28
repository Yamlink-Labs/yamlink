'use strict';

const { canonicalizeId } = require('../core/id');
const { serializeFrontmatterDocument, normalizeText } = require('../core/frontmatter');

const MAX_PREVIEW_NOTES = 8;

/** @typedef {{ kind: 'table', source: 'tsv'|'markdown', headers: string[], fields: string[], rows: string[][] }} SmartPasteTable */
/** @typedef {{ kind: 'json', data: Record<string, any> }} SmartPasteJson */
/** @typedef {{ kind: 'list', items: string[] }} SmartPasteList */
/** @typedef {SmartPasteTable|SmartPasteJson|SmartPasteList} SmartPasteDetection */

/** @param {string} text @returns {SmartPasteDetection|null} */
function detectSmartPaste(text) {
    const normalized = normalizeText(text).trim();
    if (!normalized) return null;

    const json = parseJsonObject(normalized);
    if (json) return json;

    const table = parseTable(normalized);
    if (table) return table;

    const list = parseList(normalized);
    if (list) return list;

    return null;
}

/** @param {string} text @returns {SmartPasteJson|null} */
function parseJsonObject(text) {
    if (!text.startsWith('{') || !text.endsWith('}')) return null;
    try {
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
        if (!Object.keys(data).length) return null;
        return { kind: 'json', data };
    } catch {
        return null;
    }
}

/** @param {string} text @returns {SmartPasteTable|null} */
function parseTable(text) {
    return parseMarkdownTable(text) || parseTsvTable(text);
}

/** @param {string} text @returns {SmartPasteTable|null} */
function parseTsvTable(text) {
    const lines = normalizeText(text).split('\n').map(line => line.trimEnd()).filter(line => line.trim());
    if (lines.length < 2 || !lines.every(line => line.includes('\t'))) return null;

    const cells = lines.map(line => line.split('\t').map(cell => cell.trim()));
    const width = cells[0].length;
    if (width < 2 || !cells.every(row => row.length === width)) return null;

    // Word (and other rich-text editors) put a literal tab between a list
    // marker and its text, so a pasted numbered/bulleted list looks exactly
    // like a 2-column TSV table to the check above (marker column, text
    // column). If every row's first cell is a bare marker with nothing else
    // in it, this is a disguised list, not a table — bail out and let
    // `parseList` (which already treats a tab as valid marker whitespace)
    // handle it instead.
    if (width === 2 && cells.every(row => /^(?:[-*]|\d+[.)])$/.test(row[0]))) return null;

    return buildTable('tsv', cells[0], cells.slice(1));
}

/** @param {string} text @returns {SmartPasteTable|null} */
function parseMarkdownTable(text) {
    const lines = normalizeText(text).split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length < 3) return null;
    if (!lines[0].startsWith('|') || !lines[0].endsWith('|')) return null;
    if (!/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[1])) return null;

    const rows = lines.map(splitMarkdownTableRow);
    const width = rows[0].length;
    if (width < 2 || !rows.every(row => row.length === width)) return null;

    return buildTable('markdown', rows[0], rows.slice(2));
}

/** @param {string} line @returns {string[]} */
function splitMarkdownTableRow(line) {
    return line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(cell => cell.trim());
}

/** @param {'tsv'|'markdown'} source @param {string[]} headers @param {string[][]} rows @returns {SmartPasteTable|null} */
function buildTable(source, headers, rows) {
    if (!headers.every(Boolean) || !rows.length) return null;
    const fields = normalizeFieldNames(headers);
    if (!fields.length || fields.length !== headers.length) return null;
    return { kind: 'table', source, headers, fields, rows };
}

/** @param {string[]} headers @returns {string[]} */
function normalizeFieldNames(headers) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < headers.length; i++) {
        const base = canonicalizeId(headers[i]).replace(/-/g, '_') || `field_${i + 1}`;
        let key = base;
        let suffix = 2;
        while (seen.has(key)) {
            key = `${base}_${suffix}`;
            suffix++;
        }
        seen.add(key);
        out.push(key);
    }
    return out;
}

/** @param {string} text @returns {SmartPasteList|null} */
function parseList(text) {
    const lines = normalizeText(text).split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length < 2) return null;

    const items = [];
    for (const line of lines) {
        if (/^[-*]\s+\[[ xX]\]\s+/.test(line)) return null;
        const match = line.match(/^(?:[-*]\s+|\d+[.)]\s+)(.+)$/);
        if (!match || !match[1].trim()) return null;
        items.push(match[1].trim());
    }

    return { kind: 'list', items };
}

/**
 * `!view` requires a type (or the `*` wildcard) on the same first line as the
 * marker itself — `queryParser.js`'s `parseSingleViewBlock` only recognizes a
 * block at all if the first line matches `!view <something>`; a bare `!view`
 * with nothing after it fails that check and the whole block silently renders
 * as an unparseable-query error. There's no way to infer a real type from a
 * pasted table alone, so `*` (query every type) is the only honest default —
 * this is a starting scaffold for the user to narrow down, not a finished query.
 * @param {SmartPasteTable} table @returns {string}
 */
function buildViewBlock(table) {
    return `!view *\nselect ${table.fields.join(', ')}\n`;
}

/** @param {SmartPasteJson} json @returns {string} */
function buildFrontmatterFromJson(json) {
    return serializeFrontmatterDocument({
        hasFrontmatter: true,
        data: json.data,
        body: '',
        originalOrder: Object.keys(json.data)
    });
}

/** @param {SmartPasteList} list @returns {string} */
function buildTaskList(list) {
    return `${list.items.map(item => `- [ ] ${item}`).join('\n')}\n`;
}

/**
 * @param {SmartPasteTable} table
 * @returns {{ id: string, fileName: string, fields: Record<string, any>, content: string }[]}
 */
function buildNotesFromTable(table) {
    const idFieldIndex = findIdentityFieldIndex(table.fields);
    const seen = new Set();
    return table.rows.map((row, index) => {
        const seed = row[idFieldIndex] || row[0] || `note-${index + 1}`;
        const id = uniqueId(canonicalizeId(seed) || `note-${index + 1}`, seen);
        const fields = { id };
        for (let i = 0; i < table.fields.length; i++) {
            const field = table.fields[i];
            const value = row[i] ?? '';
            if (field === 'id') continue;
            if (String(value).trim() === '') continue;
            fields[field] = value;
        }
        const content = serializeFrontmatterDocument({
            hasFrontmatter: true,
            data: fields,
            body: '',
            originalOrder: Object.keys(fields)
        });
        return { id, fileName: `${id}.md`, fields, content };
    });
}

/** @param {string[]} fields @returns {number} */
function findIdentityFieldIndex(fields) {
    for (const preferred of ['id', 'name', 'title']) {
        const index = fields.indexOf(preferred);
        if (index !== -1) return index;
    }
    return 0;
}

/** @param {string} id @param {Set<string>} seen @returns {string} */
function uniqueId(id, seen) {
    let candidate = id;
    let suffix = 2;
    while (seen.has(candidate)) {
        candidate = `${id}-${suffix}`;
        suffix++;
    }
    seen.add(candidate);
    return candidate;
}

/** @param {{ id: string, fields: Record<string, any> }[]} notes @returns {string} */
function buildNotesPreview(notes) {
    const lines = notes.slice(0, MAX_PREVIEW_NOTES).map(note => {
        const fields = Object.keys(note.fields).filter(field => field !== 'id').join(', ');
        return `- ${note.id}${fields ? ` (${fields})` : ''}`;
    });
    if (notes.length > MAX_PREVIEW_NOTES) {
        lines.push(`- ...${notes.length - MAX_PREVIEW_NOTES} more`);
    }
    return lines.join('\n');
}

module.exports = {
    detectSmartPaste,
    buildViewBlock,
    buildFrontmatterFromJson,
    buildTaskList,
    buildNotesFromTable,
    buildNotesPreview
};
