const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { clearGraph, registerEdges, getGraphStats, removeEdgesForSource } = require('./graph');
const { getWorkspaceRoots } = require('./workspace');
const { normaliseDateInput } = require('./date');
const { extractCanonicalIdFromFrontmatter, canonicalizeId } = require('./id');
const { clearRegistry, registerType, unregisterType, getRegistryStats, getTypes } = require('../registries/typeRegistry');
const { clearSchemaRegistry, registerSchemaNode } = require('../registries/schemaRegistry');
const { normalizeText } = require('./frontmatter');

let idIndex        = new Map();
let pathIndex      = new Map();
let duplicateIds   = new Map();
let fieldsCache    = new Map(); // id → parsed frontmatter fields
let mtimeCache     = new Map(); // filePath → mtime (ms) — skip unchanged files on incremental update
let vaultGeneration = 0;        // incremented on every vault mutation — invalidates activation caches

function buildIndex(workspaceFolders) {
    vaultGeneration++;
    idIndex.clear();
    pathIndex.clear();
    duplicateIds.clear();
    fieldsCache.clear();
    mtimeCache.clear();  // must clear so updateSingleFile re-reads all files after a full rebuild
    clearGraph();
    clearRegistry();
    clearSchemaRegistry();

    if (!workspaceFolders) return;

    const roots = getWorkspaceRoots(workspaceFolders);
    for (const root of roots) scanDirectory(root);

    const graphStats    = getGraphStats();
    const registryStats = getRegistryStats();

    console.log(
        `Yamlink — Index built: ${idIndex.size} node(s), ` +
        `${graphStats.totalEdges} edge(s), ` +
        `${registryStats.uniqueTypes} type(s) ` +
        `[${[...getTypes()].join(', ') || 'none'}]`
    );
}

function scanDirectory(dir) {
    let files;
    try {
        files = fs.readdirSync(dir);
    } catch (e) {
        console.error("Yamlink — Cannot read directory:", dir);
        return;
    }

    for (const file of files) {
        if (file.startsWith('.')) continue;

        const fullPath = path.join(dir, file);

        if (fullPath.includes(`${path.sep}_templates${path.sep}`) ||
            fullPath.endsWith(`${path.sep}_templates`)) continue;

        let stat;
        try { stat = fs.statSync(fullPath); } catch (e) { continue; }

        if (stat.isDirectory()) {
            scanDirectory(fullPath);
        } else if (file.endsWith('.md')) {
            indexFile(fullPath);
        }
    }
}

function indexFile(fullPath) {
    let content;
    try {
        content = fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
        console.error("Yamlink — Cannot read:", fullPath);
        return;
    }

    // Normalize Windows line endings once at the entry point.
    // Every downstream function receives clean \n-only content.
    content = normalizeText(content);

    const id = extractId(content);
    if (!id) return;

    if (idIndex.has(id)) {
        const firstPath = idIndex.get(id);
        if (!duplicateIds.has(id)) {
            duplicateIds.set(id, [firstPath]);
        }
        duplicateIds.get(id).push(fullPath);
        console.warn(`Yamlink — Duplicate id "${id}" in: ${fullPath}`);
        console.warn(`Yamlink — Already registered: ${firstPath}`);
        return;
    }

    idIndex.set(id, fullPath);
    pathIndex.set(fullPath, id);

    const rawEdges = [
        ...extractEdgesFromFrontmatter(content),
        ...extractBodyLinks(content)
    ];

    // Deduplicate: same field + targetId pair should only produce one edge
    const seen  = new Set();
    const edges = [];
    for (const edge of rawEdges) {
        const key = `${edge.field}:${edge.targetId}`;
        if (!seen.has(key)) {
            seen.add(key);
            edges.push(edge);
        }
    }

    registerEdges(id, edges);

    const fields = parseFrontmatter(content);
    if (fields) {
        fieldsCache.set(id, fields);

        if (fields.type) {
            registerType(fields.type, id);

            if (fields.type.trim().toLowerCase() === 'schema') {
                const firstDash    = content.indexOf('---');
                const closingIndex = content.indexOf('---', firstDash + 3);
                if (closingIndex !== -1) {
                    const frontmatterText = content.slice(firstDash + 3, closingIndex);
                    registerSchemaNode(id, frontmatterText);
                }
            }
        }
    }
}

function extractId(content) {
    return extractCanonicalIdFromFrontmatter(content);
}

function extractIdFromFrontmatter(filePath) {
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) { return null; }
    content = normalizeText(content);
    return extractId(content);
}

function extractEdgesFromFrontmatter(content) {
    const edges = [];
    if (!/^\s*---/.test(content)) return edges;

    const firstDash    = content.indexOf('---');
    const closingIndex = content.indexOf('---', firstDash + 3);
    if (closingIndex === -1) return edges;

    const frontmatter = content.slice(firstDash + 3, closingIndex);
    const lines       = frontmatter.split('\n');

    let currentField = null;

    for (const line of lines) {
        const fieldMatch = line.match(/^\s*([\w-]+):\s*(.*)$/);
        if (fieldMatch) {
            currentField      = fieldMatch[1].trim();
            const inlineValue = fieldMatch[2].trim();

            if (currentField === 'id') {
                currentField = null;
                continue;
            }

            if (inlineValue) {
                const linkRegex = /\[\[([^\]]+)\]\]/g;
                let m;
                while ((m = linkRegex.exec(inlineValue)) !== null) {
                    const targetId = canonicalizeLinkedTarget(m[1]);
                    if (targetId) edges.push({ field: currentField, targetId });
                }
            }
            continue;
        }

        const listMatch = line.match(/^\s*-\s+\[\[([^\]]+)\]\]/);
        if (listMatch && currentField) {
            const targetId = canonicalizeLinkedTarget(listMatch[1]);
            if (targetId) edges.push({ field: currentField, targetId });
            continue;
        }

        if (line.trim() && !line.match(/^\s/)) {
            currentField = null;
        }
    }

    return edges;
}

function extractBodyLinks(content) {
    const edges = [];

    let bodyStart = 0;
    if (/^\s*---/.test(content)) {
        const firstDash    = content.indexOf('---');
        const closingIndex = content.indexOf('---', firstDash + 3);
        if (closingIndex !== -1) bodyStart = closingIndex + 3;
    }

    const body      = content.slice(bodyStart);
    const linkRegex = /\[\[([^\]]+)\]\]/g;
    let match;

    while ((match = linkRegex.exec(body)) !== null) {
        const targetId = canonicalizeLinkedTarget(match[1]);
        if (targetId) edges.push({ field: 'body', targetId });
    }

    return edges;
}

function canonicalizeLinkedTarget(raw) {
    const target = String(raw || '').trim().split('|')[0].trim().split('#')[0].trim().split('^')[0].trim();
    if (!target) return '';
    return canonicalizeId(target);
}

// ─────────────────────────────────────────────────────────────────
// parseFrontmatter
//
// Parses YAML frontmatter using js-yaml (already a project dependency).
// Falls back gracefully on any parse error — returns null rather than
// crashing, so a single malformed file never breaks the whole index.
//
// Normalisation:
//   - BOM stripped before parsing
//   - Array values joined to comma-separated string so the rest of
//     the codebase receives plain strings (wikilinks stay intact)
//   - null/undefined values become empty string
//   - numbers and booleans converted to string
// ─────────────────────────────────────────────────────────────────
function parseFrontmatter(content) {
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1); // strip BOM

    if (!/^\s*---/.test(content)) return null;

    const firstDash    = content.indexOf('---');
    const closingIndex = content.indexOf('---', firstDash + 3);
    if (closingIndex === -1) return null;

    const fmText = content.slice(firstDash + 3, closingIndex);

    let parsed;
    try {
        parsed = yaml.load(fmText);
    } catch (e) {
        console.warn('Yamlink — Malformed frontmatter (file skipped):', e.message);
        return null;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const result = {};
    for (const [key, val] of Object.entries(parsed)) {
        if (val === null || val === undefined) {
            result[key] = '';
        } else if (val instanceof Date) {
            result[key] = normaliseDateInput(val.toISOString().slice(0, 10)) || val.toISOString().slice(0, 10);
        } else if (Array.isArray(val)) {
            result[key] = val.map(v => stringifyFrontmatterValue(v)).join(', ');
        } else {
            result[key] = stringifyFrontmatterValue(val);
        }
    }
    return result;
}

function stringifyFrontmatterValue(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) {
        return normaliseDateInput(value.toISOString().slice(0, 10)) || value.toISOString().slice(0, 10);
    }
    const str        = String(value);
    const normalised = normaliseDateInput(str);
    return normalised !== null ? normalised : str;
}

// ─────────────────────────────────────────────────────────────────
// Tiny LRU cache for parseFrontmatter results.
// Max 200 entries; oldest evicted on overflow via Map insertion order.
// ─────────────────────────────────────────────────────────────────
const PARSE_CACHE_MAX = 200;
const parseCache      = new Map();

function hashContent(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) ^ str.charCodeAt(i);
        h = h >>> 0;
    }
    return h;
}

function parseFrontmatterCached(content) {
    const key    = hashContent(content);
    const cached = parseCache.get(key);
    if (cached !== undefined) return cached;
    const result = parseFrontmatter(content);
    if (parseCache.size >= PARSE_CACHE_MAX) {
        parseCache.delete(parseCache.keys().next().value);
    }
    parseCache.set(key, result);
    return result;
}

// ─────────────────────────────────────────────────────────────────
// updateSingleFile — incremental index update
//
// Returns { changed: boolean, needsFull: boolean }
//   changed   — false: nothing changed, callers can skip UI refresh
//   needsFull — true: caller must run buildIndex() (ID change, schema)
// ─────────────────────────────────────────────────────────────────
function updateSingleFile(filePath, options = {}) {
    const NO_CHANGE   = { changed: false, needsFull: false };
    const NEEDS_FULL  = { changed: true,  needsFull: true  };
    const INCREMENTAL = { changed: true,  needsFull: false };
    const force = !!options.force;

    if (!filePath.endsWith('.md')) return NO_CHANGE;
    if (filePath.includes(`${path.sep}_templates${path.sep}`)) return NO_CHANGE;

    try {
        const mtime = fs.statSync(filePath).mtimeMs;
        if (!force && mtimeCache.get(filePath) === mtime) return NO_CHANGE;
        mtimeCache.set(filePath, mtime);
    } catch (e) { vaultGeneration++; return NEEDS_FULL; }

    let newContent;
    try {
        newContent = fs.readFileSync(filePath, 'utf8');
        newContent = normalizeText(newContent);
    } catch (e) { vaultGeneration++; return NEEDS_FULL; }

    const oldId = pathIndex.get(filePath) ?? null;
    const newId = extractId(newContent);

    if (oldId !== newId) { vaultGeneration++; return NEEDS_FULL; }
    if (!newId)          return NO_CHANGE;

    const oldFields = fieldsCache.get(newId) || {};
    const oldType   = oldFields.type ? oldFields.type.trim().toLowerCase() : null;
    const newFields = parseFrontmatterCached(newContent);
    const newType   = newFields && newFields.type ? newFields.type.trim().toLowerCase() : null;

    if (oldType === 'schema' || newType === 'schema') { vaultGeneration++; return NEEDS_FULL; }

    removeEdgesForSource(newId);

    const rawEdges = [
        ...extractEdgesFromFrontmatter(newContent),
        ...extractBodyLinks(newContent)
    ];
    const seen  = new Set();
    const edges = [];
    for (const edge of rawEdges) {
        const key = `${edge.field}:${edge.targetId}`;
        if (!seen.has(key)) { seen.add(key); edges.push(edge); }
    }
    if (edges.length > 0) registerEdges(newId, edges);

    if (newFields) fieldsCache.set(newId, newFields);
    else           fieldsCache.delete(newId);

    if (oldType !== newType) {
        if (oldType) unregisterType(oldType, newId);
        if (newType) registerType(newType, newId);
    }

    vaultGeneration++;
    return INCREMENTAL;
}

// ─────────────────────────────────────────────────────────────────
// removeFileFromIndex — incremental delete
//
// Called when a single .md file is deleted. Removes it from all
// indexes without a full rebuild. Returns true if the file was
// known to the index, false if it was never indexed (no-op).
// ─────────────────────────────────────────────────────────────────
function removeFileFromIndex(filePath) {
    const id = pathIndex.get(filePath);
    if (!id) return false;

    idIndex.delete(id);
    pathIndex.delete(filePath);
    duplicateIds.delete(id);
    mtimeCache.delete(filePath);
    removeEdgesForSource(id);
    const deletedFields = fieldsCache.get(id);
    const deletedType   = deletedFields && deletedFields.type ? deletedFields.type.trim().toLowerCase() : null;
    if (deletedType) unregisterType(deletedType, id);
    fieldsCache.delete(id);

    vaultGeneration++;
    return true;
}

function getIndex()           { return idIndex; }
function getPathIndex()       { return pathIndex; }
function getDuplicateIds()    { return duplicateIds; }
function getFieldsCache()     { return fieldsCache; }
function getVaultGeneration() { return vaultGeneration; }
function invalidateFileCache(filePath) {
    if (!filePath) return;
    mtimeCache.delete(filePath);
}

module.exports = {
    buildIndex,
    updateSingleFile,
    invalidateFileCache,
    removeFileFromIndex,
    getIndex,
    getPathIndex,
    getDuplicateIds,
    getFieldsCache,
    getVaultGeneration,
    getGraphStats,
    extractIdFromFrontmatter,
    extractEdgesFromFrontmatter,
    extractBodyLinks,
    parseFrontmatter
};
