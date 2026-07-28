'use strict';

const yaml = require('js-yaml');
const { normaliseDateInput } = require('./date');

/** @typedef {{ hasFrontmatter: boolean, data: Record<string,any>, body: string, originalOrder: string[] }} FrontmatterDoc */

/** @param {any} text @returns {string} */
function normalizeText(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitFrontmatter(text) {
    const normalized = normalizeText(text);
    if (!normalized.startsWith('---\n') && normalized !== '---') {
        return {
            hasFrontmatter: false,
            frontmatterText: '',
            body: normalized,
            leading: '',
            originalOrder: []
        };
    }

    const closeIdx = normalized.indexOf('\n---', 4);
    if (closeIdx === -1) {
        throw new Error('Unterminated frontmatter block');
    }

    const frontmatterText = normalized.slice(4, closeIdx);
    const afterFenceIdx = closeIdx + 4;
    const body = normalized.startsWith('\n', afterFenceIdx)
        ? normalized.slice(afterFenceIdx + 1)
        : normalized.slice(afterFenceIdx);

    return {
        hasFrontmatter: true,
        frontmatterText,
        body,
        leading: '---\n',
        originalOrder: extractKeyOrder(frontmatterText)
    };
}

/** @param {string} text @returns {FrontmatterDoc} */
function parseFrontmatterDocument(text) {
    const parts = splitFrontmatter(text);
    if (!parts.hasFrontmatter) {
        return {
            hasFrontmatter: false,
            data: {},
            body: parts.body,
            originalOrder: []
        };
    }

    let data = {};
    if (parts.frontmatterText.trim()) {
        const parsed = yaml.load(parts.frontmatterText);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            data = normalizeYamlMapping(parsed);
        } else if (parsed != null) {
            throw new Error('Frontmatter must be a mapping object');
        }
    }

    return {
        hasFrontmatter: true,
        data,
        body: parts.body,
        originalOrder: parts.originalOrder
    };
}

/** @param {FrontmatterDoc|null} doc @param {string} key @param {any} value @returns {FrontmatterDoc} */
function setField(doc, key, value) {
    const data = { ...(doc?.data || {}) };
    data[key] = normalizeValue(value, data[key]);
    return {
        hasFrontmatter: true,
        data,
        body: doc?.body || '',
        originalOrder: mergeOrder(doc?.originalOrder || [], key)
    };
}

/** @param {FrontmatterDoc|null} doc @param {string} key @returns {FrontmatterDoc} */
function deleteField(doc, key) {
    const data = { ...(doc?.data || {}) };
    delete data[key];
    return {
        hasFrontmatter: true,
        data,
        body: doc?.body || '',
        originalOrder: (doc?.originalOrder || []).filter(k => k !== key)
    };
}

/** @param {FrontmatterDoc} doc @returns {string} */
function serializeFrontmatterDocument(doc) {
    const ordered = {};
    const seen = new Set();
    const order = [...(doc?.originalOrder || []), ...Object.keys(doc?.data || {})];
    for (const key of order) {
        if (seen.has(key)) continue;
        if (!Object.prototype.hasOwnProperty.call(doc.data, key)) continue;
        ordered[key] = doc.data[key];
        seen.add(key);
    }

    let fm = yaml.dump(ordered, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
        quotingType: '"',
        forceQuotes: false,
        flowLevel: 1
    }).trimEnd();

    // Keep plain wikilink scalars readable in frontmatter instead of letting
    // js-yaml wrap them in quotes like "[[target-id]]".
    fm = fm.replace(/^([A-Za-z0-9_-]+:\s+)"(\[\[[^\]]+\]\])"$/gm, '$1$2');
    fm = fm.replace(/^([A-Za-z0-9_-]+:\s+)'(\[\[[^\]]+\]\])'$/gm, '$1$2');
    fm = fm.replace(/^(\s*-\s+)"(\[\[[^\]]+\]\])"$/gm, '$1$2');
    fm = fm.replace(/^(\s*-\s+)'(\[\[[^\]]+\]\])'$/gm, '$1$2');

    const body = normalizeText(doc?.body || '');
    return `---\n${fm}\n---${body ? `\n${body}` : '\n'}`;
}

function extractKeyOrder(frontmatterText) {
    const lines = normalizeText(frontmatterText).split('\n');
    const order = [];
    for (const line of lines) {
        const match = line.match(/^([A-Za-z0-9_-]+):(?:\s|$)/);
        if (match) order.push(match[1]);
    }
    return order;
}

function mergeOrder(order, key) {
    return order.includes(key) ? [...order] : [...order, key];
}

function normalizeValue(nextValue, existingValue) {
    if (Array.isArray(existingValue)) {
        if (Array.isArray(nextValue)) return nextValue;
        const raw = String(nextValue ?? '').trim();
        if (!raw) return [];
        return raw.split(',').map(part => coerceScalar(part.trim())).filter(Boolean);
    }

    if (nextValue === null || nextValue === undefined) return '';
    return coerceScalar(nextValue, existingValue);
}

function normalizeYamlMapping(value) {
    const out = {};
    for (const [key, raw] of Object.entries(value || {})) {
        out[key] = normalizeYamlValue(raw);
    }
    return out;
}

function normalizeYamlValue(value) {
    if (value instanceof Date) {
        return normaliseDateInput(value.toISOString().slice(0, 10)) || value.toISOString().slice(0, 10);
    }
    if (Array.isArray(value)) return value.map(normalizeYamlValue);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, raw] of Object.entries(value)) out[key] = normalizeYamlValue(raw);
        return out;
    }
    return value;
}

function coerceScalar(value, existingValue) {
    if (typeof value !== 'string') return value;

    const raw = value.trim();
    if (!raw) return '';

    if (typeof existingValue === 'number' && /^-?\d+(?:\.\d+)?$/.test(raw)) {
        return Number(raw);
    }
    if (typeof existingValue === 'boolean' && /^(true|false)$/i.test(raw)) {
        return raw.toLowerCase() === 'true';
    }

    if (/^\[\[[^\]]+\]\]$/.test(raw)) return raw;
    if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
    if (/^-?\d+(?:\.\d+)?$/.test(raw) && !/^0\d/.test(raw)) return Number(raw);
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
        return raw.slice(1, -1);
    }
    return raw;
}

function serializeScalarForYaml(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'number') return String(value);
    const s = String(value).trim();
    if (!s) return null;
    if (/^\[\[[^\]]+\]\]$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^[A-Za-z0-9_\-. ]+$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s)) return s;
    return JSON.stringify(s);
}

/** @param {string} content @param {string} key @param {any} value @returns {string|null} */
function writeFrontmatterFieldSurgically(content, key, value) {
    const normalized = normalizeText(content);
    if (!normalized.startsWith('---\n')) return null;
    const closeIdx = normalized.indexOf('\n---', 4);
    if (closeIdx === -1) return null;

    if (Array.isArray(value)) return null;

    const fmText = normalized.slice(4, closeIdx);
    const after = normalized.slice(closeIdx + 4);
    const lines = fmText.split('\n');

    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyPattern = new RegExp(`^[ \\t]*${escapedKey}[ \\t]*:`);

    let foundIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (keyPattern.test(lines[i])) { foundIndex = i; break; }
    }

    if (foundIndex !== -1 && foundIndex + 1 < lines.length && /^[ \t]/.test(lines[foundIndex + 1])) {
        return null; // multi-line value — fall back to full serialize
    }

    const serialized = serializeScalarForYaml(value);
    let newLines;

    if (serialized === null) {
        if (foundIndex === -1) return normalized;
        newLines = lines.filter((_, i) => i !== foundIndex);
    } else if (foundIndex !== -1) {
        newLines = [...lines];
        newLines[foundIndex] = `${key}: ${serialized}`;
    } else {
        newLines = [...lines, `${key}: ${serialized}`];
    }

    return `---\n${newLines.join('\n')}\n---${after}`;
}

/**
 * Resolves which frontmatter key a given line belongs to, including YAML
 * block-list entries whose key lives on a previous line, e.g.:
 *
 *   contacts:
 *     - [[theo-theodorou]]
 *     - [[cesar-gutierrez]]     ← lineIndex here resolves to "contacts"
 *
 * A single-line field (`owner: [[x]]`) resolves directly from its own line,
 * same as before. For a bare list-item line (`  - [[x]]`, no colon on that
 * line at all), walks upward past other list items and blank lines until it
 * finds the nearest bare `key:` line — the parent this list hangs off of.
 * Stops at the frontmatter boundary (`---`) or at any line that isn't part
 * of the list, so it never misattributes to an unrelated field above it.
 *
 * @param {string[]} lines
 * @param {number} lineIndex
 * @returns {string|null}
 */
function resolveYamlFieldNameForLine(lines, lineIndex) {
    if (!Array.isArray(lines) || lineIndex < 0 || lineIndex >= lines.length) return null;

    const currentMatch = /^\s*([\w-]+)\s*:/.exec(lines[lineIndex] || '');
    if (currentMatch) return currentMatch[1].toLowerCase();

    for (let i = lineIndex - 1; i >= 0; i--) {
        const line = lines[i];
        if (line == null || /^\s*---\s*$/.test(line)) break;
        if (/^\s*-\s/.test(line) || line.trim() === '') continue;
        const bareKeyMatch = /^([\w-]+):\s*$/.exec(line);
        if (bareKeyMatch) return bareKeyMatch[1].toLowerCase();
        break;
    }
    return null;
}

module.exports = {
    normalizeText,
    resolveYamlFieldNameForLine,
    parseFrontmatterDocument,
    setField,
    deleteField,
    serializeFrontmatterDocument,
    writeFrontmatterFieldSurgically
};
