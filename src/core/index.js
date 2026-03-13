const fs   = require('fs');
const path = require('path');
const { clearGraph, registerEdges, getGraphStats, removeEdgesForSource } = require('./graph');
const { clearRegistry, registerType, unregisterType, getRegistryStats, getTypes } = require('../registries/typeRegistry');
const { clearSchemaRegistry, registerSchemaNode } = require('../registries/schemaRegistry');

let idIndex      = new Map();
let pathIndex    = new Map();
let duplicateIds = new Map();
let fieldsCache  = new Map(); // id → parsed frontmatter fields
let mtimeCache   = new Map(); // filePath → mtime (ms) — skip unchanged files on incremental update

function buildIndex(workspaceFolders) {
    idIndex.clear();
    pathIndex.clear();
    duplicateIds.clear();
    fieldsCache.clear();
    mtimeCache.clear();  // must clear so updateSingleFile re-reads all files after a full rebuild
    clearGraph();
    clearRegistry();
    clearSchemaRegistry();

    if (!workspaceFolders) return;

    const root = workspaceFolders[0].uri.fsPath;
    scanDirectory(root);

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
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

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
    if (!/^\s*---/.test(content)) return null;

    const firstDash    = content.indexOf('---');
    const closingIndex = content.indexOf('---', firstDash + 3);
    if (closingIndex === -1) return null;

    const frontmatter = content.slice(firstDash + 3, closingIndex);
    const match = frontmatter.match(/^\s*id:\s*([a-zA-Z0-9_-]+)\s*$/m);

    return match ? match[1].trim() : null;
}

function extractIdFromFrontmatter(filePath) {
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) { return null; }
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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
                    edges.push({ field: currentField, targetId: m[1].trim() });
                }
            }
            continue;
        }

        const listMatch = line.match(/^\s*-\s+\[\[([^\]]+)\]\]/);
        if (listMatch && currentField) {
            edges.push({ field: currentField, targetId: listMatch[1].trim() });
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
        const targetId = match[1].trim();
        if (targetId) edges.push({ field: 'body', targetId });
    }

    return edges;
}

function parseFrontmatter(content) {
    if (!/^\s*---/.test(content)) return null;

    const firstDash    = content.indexOf('---');
    const closingIndex = content.indexOf('---', firstDash + 3);
    if (closingIndex === -1) return null;

    const frontmatter = content.slice(firstDash + 3, closingIndex);
    const result      = {};
    let currentKey    = null;
    let listItems     = [];

    const flushList = () => {
        if (currentKey && listItems.length > 0) {
            result[currentKey] = listItems.join(', ');
            listItems = [];
        }
    };

    for (const line of frontmatter.split('\n')) {
        // List item under current key
        const listMatch = line.match(/^\s+-\s+(.+?)\s*$/);
        if (listMatch && currentKey) {
            listItems.push(listMatch[1]);
            continue;
        }

        // New field
        const fieldMatch = line.match(/^\s*([\w-]+):\s*(.+?)\s*$/);
        if (fieldMatch) {
            flushList();
            currentKey         = fieldMatch[1];
            result[currentKey] = fieldMatch[2];
            listItems          = [];
            continue;
        }

        // Field with no inline value (list follows on next lines)
        const keyOnly = line.match(/^\s*([\w-]+):\s*$/);
        if (keyOnly) {
            flushList();
            currentKey = keyOnly[1];
            listItems  = [];
            continue;
        }
    }

    flushList(); // flush any trailing list
    return result;
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
function updateSingleFile(filePath) {
    const NO_CHANGE   = { changed: false, needsFull: false };
    const NEEDS_FULL  = { changed: true,  needsFull: true  };
    const INCREMENTAL = { changed: true,  needsFull: false };

    if (!filePath.endsWith('.md')) return NO_CHANGE;
    if (filePath.includes(`${path.sep}_templates${path.sep}`)) return NO_CHANGE;

    try {
        const mtime = fs.statSync(filePath).mtimeMs;
        if (mtimeCache.get(filePath) === mtime) return NO_CHANGE;
        mtimeCache.set(filePath, mtime);
    } catch (e) { return NEEDS_FULL; }

    let newContent;
    try {
        newContent = fs.readFileSync(filePath, 'utf8');
        newContent = newContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    } catch (e) { return NEEDS_FULL; }

    const oldId = pathIndex.get(filePath) ?? null;
    const newId = extractId(newContent);

    if (oldId !== newId) return NEEDS_FULL;
    if (!newId)          return NO_CHANGE;

    const oldFields = fieldsCache.get(newId) || {};
    const oldType   = oldFields.type ? oldFields.type.trim().toLowerCase() : null;
    const newFields = parseFrontmatterCached(newContent);
    const newType   = newFields && newFields.type ? newFields.type.trim().toLowerCase() : null;

    if (oldType === 'schema' || newType === 'schema') return NEEDS_FULL;

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

    return INCREMENTAL;
}

function getIndex()        { return idIndex; }
function getPathIndex()    { return pathIndex; }
function getDuplicateIds() { return duplicateIds; }
function getFieldsCache()  { return fieldsCache; }

module.exports = {
    buildIndex,
    updateSingleFile,
    getIndex,
    getPathIndex,
    getDuplicateIds,
    getFieldsCache,
    extractIdFromFrontmatter,
    extractEdgesFromFrontmatter,
    parseFrontmatter
};