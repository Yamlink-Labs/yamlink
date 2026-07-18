const fs   = require('fs');
const path = require('path');

/**
 * @typedef {{ timestamp: string, type: string, noteId: string, field: string|null, oldValue: any, newValue: any }} MutationEvent
 * @typedef {{ changed: boolean, needsFull: boolean, changedId: string|null, mutationEvents: MutationEvent[] }} UpdateResult
 * @typedef {{ removed: boolean, mutationEvents: MutationEvent[] }} RemoveResult
 */
const yaml = require('js-yaml');
const { clearGraph, registerEdges, getGraphStats, removeEdgesForSource } = require('./graph');
const { getWorkspaceRoots, getWorkspaceRootForFile } = require('./workspace');
const { loadIgnoreRules, isIgnoredPath } = require('./ignore');
const { normaliseDateInput } = require('./date');
const { extractCanonicalIdFromFrontmatter, canonicalizeId, canonicalizeLinkedTarget, resolveLinkedTarget } = require('./id');
const { clearRegistry, registerType, unregisterType, getRegistryStats, getTypes } = require('../registries/typeRegistry');
const { clearSchemaRegistry, registerSchemaNode } = require('../registries/schemaRegistry');
const { normalizeText } = require('./frontmatter');
const { extractTagsFromText, extractTagsFromNodeFields } = require('../intelligence/tagSignals');
const { extractMeaningfulBodyBlocks } = require('./bodyBlocks');

let idIndex        = new Map();
let pathIndex      = new Map();
let duplicateIds   = new Map();
let fieldsCache    = new Map(); // id → parsed frontmatter fields
let aliasIndex     = new Map(); // alias → canonical id
let blockIndex     = new Map(); // id → (blockId → body block metadata)
// id → comma-joined "[[rawTarget]]" text for every body-text wikilink mention,
// deliberately kept OUT of fieldsCache — a synthetic frontmatter-shaped field
// would need auditing/exclusion across every consumer that enumerates a
// note's fields (drift detection, lifecycle state, query autocomplete,
// cluster emergence...). This is Time Engine-only data: it exists so
// buildMutationEvents-style diffing can detect body-link changes on save
// (the mutation log has otherwise never recorded body text at all), and so
// historical reconstruction can seed "now"'s body-link value. See
// core/timeEngine.js's use of getBodyLinksCache().
let bodyLinksCache = new Map();
let mtimeCache     = new Map(); // filePath → mtime (ms) — skip unchanged files on incremental update
let malformedFiles = new Map(); // filePath → yaml error message — files skipped for unparsable frontmatter
let vaultGeneration = 0;        // incremented on every vault mutation — invalidates activation caches

function isNonEmptyFieldValue(rawValue) {
    if (Array.isArray(rawValue)) return rawValue.some((value) => String(value || '').trim());
    return String(rawValue || '').trim().length > 0;
}

function extractRelationTargets(rawValue) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const targets = [];
    for (const value of values) {
        const text = String(value || '');
        for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
            const targetId = canonicalizeLinkedTarget(match[1]);
            if (targetId) targets.push(targetId);
        }
    }
    return [...new Set(targets)].sort();
}

/**
 * Same [[wikilink]] extraction as extractRelationTargets(), but resolves each
 * match the same way the live graph does — through resolveLinkedTarget()'s
 * idIndex/aliasIndex lookup, falling back to a bare canonicalize only if that
 * fails. extractRelationTargets() alone only ever produces a naive
 * canonicalized guess, which silently misses every link written by display
 * name/alias ([[Carl Jenkins]]) rather than exact canonical id ([[carl-jenkins]]).
 * Time Engine historical-graph reconstruction (buildHistoricalGraph()'s
 * consumers — the ?at= API, CLI, and x-graph time-lapse) needs this version,
 * since the live graph resolves the same links correctly and a historical
 * view should never show fewer real connections than the live one for a
 * reason this basic.
 *
 * @param {any} rawValue
 * @param {Map<string, string>} idIndex
 * @param {Map<string, string>} [aliasIndex]
 * @returns {string[]}
 */
function extractAndResolveRelationTargets(rawValue, idIndex, aliasIndex) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const targets = [];
    for (const value of values) {
        const text = String(value || '');
        for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
            const targetId = resolveLinkedTarget(match[1], idIndex, aliasIndex) || canonicalizeLinkedTarget(match[1]);
            if (targetId) targets.push(targetId);
        }
    }
    return [...new Set(targets)].sort();
}

function buildMutationEvents(oldFields, newFields, noteId) {
    const events = [];
    const timestamp = new Date().toISOString();
    const oldExists = oldFields && Object.keys(oldFields).length > 0;
    const newExists = newFields && Object.keys(newFields).length > 0;
    if (!newExists || !noteId) return events;

    const normalizedOld = oldFields || {};
    const normalizedNew = newFields || {};
    const oldType = String(normalizedOld.type || '').trim();
    const newType = String(normalizedNew.type || '').trim();

    if (!oldExists) {
        events.push({ timestamp, type: 'note_created', noteId });
    }
    if (newType && oldType !== newType) {
        events.push({ timestamp, type: 'type_set', noteId, field: 'type', oldValue: oldType || null, newValue: newType });
    }

    const fieldNames = new Set([...Object.keys(normalizedOld), ...Object.keys(normalizedNew)]);
    for (const fieldName of fieldNames) {
        const fn = String(fieldName || '').trim().toLowerCase();
        if (!fn || fn === 'id' || fn === 'type' || fn.startsWith('__')) continue;
        const oldValue = normalizedOld[fieldName];
        const newValue = normalizedNew[fieldName];
        const hadValue = isNonEmptyFieldValue(oldValue);
        const hasValue = isNonEmptyFieldValue(newValue);
        const oldTargets = extractRelationTargets(oldValue);
        const newTargets = extractRelationTargets(newValue);
        const hasRelations = oldTargets.length > 0 || newTargets.length > 0;
        const targetsChanged = oldTargets.join('|') !== newTargets.join('|') && hasRelations;

        if (!hadValue && hasValue) {
            events.push({ timestamp, type: 'field_added', noteId, field: fieldName, oldValue: oldValue ?? null, newValue });
        } else if (hadValue && !hasValue) {
            events.push({ timestamp, type: 'field_removed', noteId, field: fieldName, oldValue, newValue: null });
        } else if (hadValue && hasValue && !hasRelations) {
            const oldStr = String(oldValue ?? '').trim();
            const newStr = String(newValue ?? '').trim();
            if (oldStr !== newStr) {
                events.push({ timestamp, type: 'field_changed', noteId, field: fieldName, oldValue, newValue });
            }
        }

        if (targetsChanged) {
            const relType = oldTargets.length === 0 ? 'relation_added'
                : newTargets.length === 0 ? 'relation_removed'
                : 'relation_changed';
            events.push({
                timestamp,
                type: relType,
                noteId,
                field: fieldName,
                oldValue: oldTargets.join(', ') || null,
                newValue: newTargets.join(', ') || null
            });
        }
    }

    return events;
}

// Synthetic field name used only inside the mutation log / Time Engine
// reconstruction — never written to fieldsCache, never shown as a real
// frontmatter field. See bodyLinksCache's own comment for why this is kept
// completely separate rather than folded into fieldsCache.
const BODY_LINKS_FIELD = '__body_links__';

/**
 * Mirrors buildMutationEvents()'s per-field diff logic, but for the one
 * synthetic "field" that isn't real frontmatter: a note's body-text wikilink
 * mentions. This is what lets time-lapse's mutation-log fallback path
 * (graphTimelapse.js, for vaults with no git history) show body-mention
 * growth going forward — the mutation log itself has never recorded body
 * text before this.
 *
 * @param {string|undefined} oldValue
 * @param {string|undefined} newValue
 * @param {string} noteId
 * @returns {object[]}
 */
function buildBodyLinkMutationEvents(oldValue, newValue, noteId) {
    if (!noteId) return [];
    const timestamp = new Date().toISOString();
    const hadValue = String(oldValue || '').trim().length > 0;
    const hasValue = String(newValue || '').trim().length > 0;

    if (!hadValue && hasValue) {
        return [{ timestamp, type: 'field_added', noteId, field: BODY_LINKS_FIELD, oldValue: oldValue ?? null, newValue }];
    }
    if (hadValue && !hasValue) {
        return [{ timestamp, type: 'field_removed', noteId, field: BODY_LINKS_FIELD, oldValue, newValue: null }];
    }
    if (hadValue && hasValue && String(oldValue).trim() !== String(newValue).trim()) {
        return [{ timestamp, type: 'field_changed', noteId, field: BODY_LINKS_FIELD, oldValue, newValue }];
    }
    return [];
}

/**
 * @typedef {{ field: string, rawTarget: string }} RawEdge
 */

function buildTouchEvent(noteId) {
    if (!noteId) return [];
    return [{
        timestamp: new Date().toISOString(),
        type: 'note_touched',
        noteId,
        field: null,
        oldValue: null,
        newValue: null
    }];
}

function extractAliasesFromFields(fields) {
    if (!fields || !fields.aliases) return [];
    const raw = String(fields.aliases || '').trim();
    if (!raw) return [];
    return raw.split(/,\s*/).map(a => canonicalizeId(String(a || '').trim())).filter(Boolean);
}

/** @param {ReadonlyArray<import('./workspace').WorkspaceFolderLike>|null|undefined} workspaceFolders @returns {void} */
function buildIndex(workspaceFolders) {
    vaultGeneration++;
    idIndex.clear();
    pathIndex.clear();
    duplicateIds.clear();
    fieldsCache.clear();
    aliasIndex.clear();
    blockIndex.clear();
    bodyLinksCache.clear();
    mtimeCache.clear();  // must clear so updateSingleFile re-reads all files after a full rebuild
    malformedFiles.clear();
    clearGraph();
    clearRegistry();
    clearSchemaRegistry();

    if (!workspaceFolders) return;

    const roots = getWorkspaceRoots(workspaceFolders);
    const pendingGraphBuild = [];

    for (const root of roots) {
        const ignoreRules = loadIgnoreRules(root);
        scanDirectory(root, root, ignoreRules, pendingGraphBuild);
    }

    for (const pending of pendingGraphBuild) {
        registerResolvedEdges(pending.sourceId, pending.rawEdges);
    }

    const graphStats    = getGraphStats();
    const registryStats = getRegistryStats();

    console.error(
        `Yamlink — Index built: ${idIndex.size} node(s), ` +
        `${graphStats.totalEdges} edge(s), ` +
        `${registryStats.uniqueTypes} type(s) ` +
        `[${[...getTypes()].join(', ') || 'none'}]`
    );
}

function scanDirectory(dir, workspaceRoot, ignoreRules = [], pendingGraphBuild = []) {
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
        if (isIgnoredPath(fullPath, workspaceRoot, ignoreRules)) continue;

        let stat;
        try { stat = fs.statSync(fullPath); } catch (e) { continue; }

        if (stat.isDirectory()) {
            scanDirectory(fullPath, workspaceRoot, ignoreRules, pendingGraphBuild);
        } else if (file.endsWith('.md')) {
            indexFile(fullPath, pendingGraphBuild);
        }
    }
}

function indexFile(fullPath, pendingGraphBuild = null) {
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
        ...extractEdgesFromFrontmatterRaw(content),
        ...extractBodyLinksRaw(content)
    ];

    const fields = parseFrontmatter(content, fullPath);
    if (fields) {
        const enriched = enrichFieldsWithTagSignals(fields, content);
        fieldsCache.set(id, enriched);
        bodyLinksCache.set(id, extractBodyLinksFieldValue(content));
        for (const alias of extractAliasesFromFields(enriched)) {
            if (!aliasIndex.has(alias)) aliasIndex.set(alias, id);
        }

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

    const bodyBlocks = extractMeaningfulBodyBlocks(content);
    if (bodyBlocks.length) {
        blockIndex.set(id, new Map(bodyBlocks.map((block) => [block.blockId, block])));
    } else {
        blockIndex.delete(id);
    }

    if (pendingGraphBuild) {
        pendingGraphBuild.push({ sourceId: id, rawEdges });
    } else {
        registerResolvedEdges(id, rawEdges);
    }
}

function extractId(content) {
    return extractCanonicalIdFromFrontmatter(content);
}

/** @param {string} filePath @returns {string|null} */
function extractIdFromFrontmatter(filePath) {
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) { return null; }
    content = normalizeText(content);
    return extractId(content);
}

/** @param {string} content @returns {import('./graph').OutboundEdge[]} */
function extractEdgesFromFrontmatter(content) {
    return extractEdgesFromFrontmatterRaw(content).map((edge) => ({
        field: edge.field,
        targetId: canonicalizeLinkedTarget(edge.rawTarget)
    })).filter((edge) => edge.targetId);
}

/** @param {string} content @returns {RawEdge[]} */
function extractEdgesFromFrontmatterRaw(content) {
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
                    if (m[1]) edges.push({ field: currentField, rawTarget: m[1] });
                }
            }
            continue;
        }

        const listMatch = line.match(/^\s*-\s+\[\[([^\]]+)\]\]/);
        if (listMatch && currentField) {
            if (listMatch[1]) edges.push({ field: currentField, rawTarget: listMatch[1] });
            continue;
        }

        if (line.trim() && !line.match(/^\s/)) {
            currentField = null;
        }
    }

    return edges;
}

/** @param {string} content @returns {import('./graph').OutboundEdge[]} */
function extractBodyLinks(content) {
    return extractBodyLinksRaw(content).map((edge) => ({
        field: edge.field,
        targetId: canonicalizeLinkedTarget(edge.rawTarget)
    })).filter((edge) => edge.targetId);
}

/** @param {string} content @returns {RawEdge[]} */
function extractBodyLinksRaw(content) {
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
        if (match[1]) edges.push({ field: 'body', rawTarget: match[1] });
    }

    return edges;
}

/**
 * Renders a note's body-text wikilink mentions as a single comma-joined
 * "[[target]]" string — the same raw-bracket-text shape a frontmatter
 * relation field's value would have, so it can be diffed and later resolved
 * with the exact same extractRelationTargets/extractAndResolveRelationTargets
 * machinery relation fields already use, no format-specific branching needed.
 * Deduplicated (case/whitespace-insensitive) and order-stable so repeated
 * mentions of the same target don't produce a noisy mutation-log diff.
 *
 * @param {string} content
 * @returns {string}
 */
function extractBodyLinksFieldValue(content) {
    const seen = new Set();
    const out = [];
    for (const edge of extractBodyLinksRaw(content)) {
        const key = String(edge.rawTarget || '').trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(`[[${edge.rawTarget}]]`);
    }
    return out.join(', ');
}

/**
 * @param {string} sourceId
 * @param {RawEdge[]} rawEdges
 * @returns {void}
 */
/**
 * Resolves raw {field, rawTarget} edges to canonical {field, targetId} edges,
 * via the same idIndex/aliasIndex lookup the live graph always uses
 * (resolveLinkedTarget, falling back to a bare canonicalize). Pulled out as
 * a pure function (rather than inlined in registerResolvedEdges) so
 * historical reconstruction — the x-graph time-lapse git-based path in
 * particular — can resolve wikilinks the exact same way the live graph does,
 * using a point-in-time idIndex/aliasIndex instead of the live global ones.
 *
 * @param {RawEdge[]} rawEdges
 * @param {string|null} sourceId
 * @param {Map<string,string>} idIndexArg
 * @param {Map<string,string>} [aliasIndexArg]
 * @returns {Array<{field: string, targetId: string}>}
 */
function resolveRawEdges(rawEdges, sourceId, idIndexArg, aliasIndexArg) {
    const seen = new Set();
    const edges = [];

    for (const edge of rawEdges || []) {
        const targetId = resolveLinkedTarget(edge.rawTarget, idIndexArg, aliasIndexArg) || canonicalizeLinkedTarget(edge.rawTarget);
        if (!targetId || targetId === sourceId) continue;
        const key = `${edge.field}:${targetId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ field: edge.field, targetId });
    }

    return edges;
}

function registerResolvedEdges(sourceId, rawEdges) {
    registerEdges(sourceId, resolveRawEdges(rawEdges, sourceId, idIndex, aliasIndex));
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
/** @param {string} content @param {string} [filePath] @returns {Record<string,any>|null} */
function parseFrontmatter(content, filePath) {
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
        if (filePath) malformedFiles.set(filePath, e.message);
        console.warn(`Yamlink — Malformed frontmatter (file skipped)${filePath ? `: ${filePath}` : ''} —`, e.message);
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
            const wikilinkText = unwrapYamlWikilinkAmbiguity(val);
            result[key] = wikilinkText !== null
                ? wikilinkText
                : val.map(v => stringifyFrontmatterValue(v)).join(', ');
        } else {
            result[key] = stringifyFrontmatterValue(val);
        }
    }
    return result;
}

/**
 * A `[[note-id]]` value written directly as a frontmatter scalar is also
 * valid YAML flow-sequence syntax — `unit: [[federations-fleet]]` parses as
 * `{ unit: [["federations-fleet"]] }`, a nested array, not a string. Left
 * alone, the literal `[[...]]` brackets are lost forever by the time the
 * value reaches fieldsCache (and therefore the mutation log and every Time
 * Engine historical reconstruction downstream of it) — even though the raw
 * file text still has them, which is why the live graph's edge builder
 * (extractEdgesFromFrontmatterRaw, which scans raw file text directly and
 * never goes through YAML parsing) was never affected by this.
 *
 * Reconstructs the original wikilink text for both shapes this ambiguity
 * produces: a single scalar ("unit: [[x]]" -> [["x"]]) and a YAML block list
 * of wikilinks ("squad:\n  - [[a]]\n  - [[b]]" -> [[["a"]], [["b"]]]).
 * Returns null (not a match) for any other array shape — including a real
 * single-item array like `tags: [a]` (only one level of nesting, not two) —
 * so normal array handling is completely unaffected.
 *
 * @param {any[]} val
 * @returns {string|null}
 */
function unwrapYamlWikilinkAmbiguity(val) {
    const single = unwrapSingleWikilinkChain(val);
    if (single !== null) return `[[${single}]]`;

    if (Array.isArray(val) && val.length > 0) {
        const items = val.map((el) => unwrapSingleWikilinkChain(el));
        if (items.every((item) => item !== null)) {
            return items.map((item) => `[[${item}]]`).join(', ');
        }
    }
    return null;
}

/**
 * Recursively unwraps a chain of single-element arrays down to the leaf
 * string, but only if there are at least two levels of nesting — that depth
 * is what distinguishes "this was `[[x]]`" from a genuine single-item array
 * like `tags: [a]` (one level only). Returns null for anything else.
 *
 * @param {any} val
 * @returns {string|null}
 */
function unwrapSingleWikilinkChain(val) {
    let cur = val;
    let depth = 0;
    while (Array.isArray(cur)) {
        if (cur.length !== 1) return null;
        cur = cur[0];
        depth++;
    }
    return (depth >= 2 && typeof cur === 'string') ? cur : null;
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

function enrichFieldsWithTagSignals(fields, content) {
    const baseFields = { ...(fields || {}) };
    const combinedTags = new Set([
        ...extractTagsFromNodeFields(baseFields),
        ...extractTagsFromText(content)
    ]);
    if (combinedTags.size > 0) {
        baseFields.__yamlink_tags = [...combinedTags].join(', ');
    } else {
        delete baseFields.__yamlink_tags;
    }
    return baseFields;
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
    if (cached !== undefined) {
        // Move to end so Map insertion order tracks recency (true LRU)
        parseCache.delete(key);
        parseCache.set(key, cached);
        return cached;
    }
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
/** @param {string} filePath @param {{ force?: boolean, workspaceFolders?: ReadonlyArray<import('./workspace').WorkspaceFolderLike> }} [options] @returns {UpdateResult} */
function updateSingleFile(filePath, options = {}) {
    const NO_CHANGE   = { changed: false, needsFull: false, changedId: null, mutationEvents: [] };
    const NEEDS_FULL  = { changed: true,  needsFull: true,  changedId: null, mutationEvents: [] };
    const force = !!options.force;

    if (!filePath.endsWith('.md')) return NO_CHANGE;
    if (filePath.includes(`${path.sep}_templates${path.sep}`)) return NO_CHANGE;
    const workspaceRoot = getWorkspaceRootForFile(options.workspaceFolders, filePath);
    if (workspaceRoot) {
        const ignoreRules = loadIgnoreRules(workspaceRoot);
        if (isIgnoredPath(filePath, workspaceRoot, ignoreRules)) return NO_CHANGE;
    }

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

    if (oldId !== newId) {
        const newFieldsForEvent = newId ? parseFrontmatterCached(newContent) : null;
        const mutationEvents = newId ? buildMutationEvents(null, newFieldsForEvent, newId) : [];
        if (newId) {
            const newBodyLinks = extractBodyLinksFieldValue(newContent);
            mutationEvents.push(...buildBodyLinkMutationEvents(bodyLinksCache.get(newId), newBodyLinks, newId));
            bodyLinksCache.set(newId, newBodyLinks);
        }
        vaultGeneration++;
        return { changed: true, needsFull: true, changedId: newId || null, mutationEvents };
    }
    if (!newId)          return NO_CHANGE;

    const oldFields = fieldsCache.get(newId) || {};
    const oldType   = oldFields.type ? oldFields.type.trim().toLowerCase() : null;
    const newFields = parseFrontmatterCached(newContent);
    const newType   = newFields && newFields.type ? newFields.type.trim().toLowerCase() : null;

    if (oldType === 'schema' || newType === 'schema') {
        const mutationEvents = buildMutationEvents(oldFields, newFields || {}, newId);
        const newBodyLinks = extractBodyLinksFieldValue(newContent);
        mutationEvents.push(...buildBodyLinkMutationEvents(bodyLinksCache.get(newId), newBodyLinks, newId));
        bodyLinksCache.set(newId, newBodyLinks);
        vaultGeneration++;
        return { changed: true, needsFull: true, changedId: newId, mutationEvents };
    }

    removeEdgesForSource(newId);

    const rawEdges = [
        ...extractEdgesFromFrontmatterRaw(newContent),
        ...extractBodyLinksRaw(newContent)
    ];

    const oldAliases = extractAliasesFromFields(oldFields);
    for (const alias of oldAliases) {
        if (aliasIndex.get(alias) === newId) aliasIndex.delete(alias);
    }
    if (newFields) {
        const enrichedNew = enrichFieldsWithTagSignals(newFields, newContent);
        fieldsCache.set(newId, enrichedNew);
        for (const alias of extractAliasesFromFields(enrichedNew)) {
            if (!aliasIndex.has(alias)) aliasIndex.set(alias, newId);
        }
        registerResolvedEdges(newId, rawEdges);
    } else {
        fieldsCache.delete(newId);
    }

    const bodyBlocks = extractMeaningfulBodyBlocks(newContent);
    if (bodyBlocks.length) {
        blockIndex.set(newId, new Map(bodyBlocks.map((block) => [block.blockId, block])));
    } else {
        blockIndex.delete(newId);
    }

    if (oldType !== newType) {
        if (oldType) unregisterType(oldType, newId);
        if (newType) registerType(newType, newId);
    }

    const mutationEvents = buildMutationEvents(oldFields, newFields ? enrichFieldsWithTagSignals(newFields, newContent) : {}, newId);
    const oldBodyLinks = bodyLinksCache.get(newId);
    const newBodyLinks = newFields ? extractBodyLinksFieldValue(newContent) : '';
    mutationEvents.push(...buildBodyLinkMutationEvents(oldBodyLinks, newBodyLinks, newId));
    if (newFields) bodyLinksCache.set(newId, newBodyLinks);
    else bodyLinksCache.delete(newId);
    const effectiveEvents = mutationEvents.length > 0 ? mutationEvents : buildTouchEvent(newId);
    vaultGeneration++;
    return { changed: true, needsFull: false, changedId: newId, mutationEvents: effectiveEvents };
}

// ─────────────────────────────────────────────────────────────────
// removeFileFromIndex — incremental delete
//
// Called when a single .md file is deleted. Removes it from all
// indexes without a full rebuild. Returns true if the file was
// known to the index, false if it was never indexed (no-op).
// ─────────────────────────────────────────────────────────────────
/** @param {string} filePath @returns {RemoveResult} */
function removeFileFromIndex(filePath) {
    const id = pathIndex.get(filePath);
    if (!id) return { removed: false, mutationEvents: [] };

    idIndex.delete(id);
    pathIndex.delete(filePath);
    duplicateIds.delete(id);
    mtimeCache.delete(filePath);
    removeEdgesForSource(id);
    for (const [alias, canonId] of aliasIndex.entries()) {
        if (canonId === id) aliasIndex.delete(alias);
    }
    const deletedFields = fieldsCache.get(id);
    const deletedType   = deletedFields && deletedFields.type ? deletedFields.type.trim().toLowerCase() : null;
    if (deletedType) unregisterType(deletedType, id);
    fieldsCache.delete(id);
    blockIndex.delete(id);
    bodyLinksCache.delete(id);

    vaultGeneration++;
    return {
        removed: true,
        mutationEvents: [{ timestamp: new Date().toISOString(), type: 'note_deleted', noteId: id, field: null, oldValue: null, newValue: null }]
    };
}

/** @returns {Map<string,string>} */
function getIndex()           { return idIndex; }
/** @returns {Map<string,string>} */
function getPathIndex()       { return pathIndex; }
/** @returns {Map<string,string[]>} */
function getDuplicateIds()    { return duplicateIds; }
/** @returns {Map<string,string>} filePath → yaml error message */
function getMalformedFiles()  { return malformedFiles; }
/** @returns {Map<string,Record<string,any>>} */
function getFieldsCache()     { return fieldsCache; }
/** @returns {Map<string,string>} */
function getAliasIndex()      { return aliasIndex; }
/** @returns {Map<string,Map<string,import('./bodyBlocks').BodyBlock>>} */
function getBodyBlockIndex()  { return blockIndex; }
/** @returns {Map<string,string>} id → comma-joined "[[rawTarget]]" body-mention text; Time Engine-only, never a real frontmatter field */
function getBodyLinksCache()  { return bodyLinksCache; }
/** @returns {number} */
function getVaultGeneration() { return vaultGeneration; }
/** @param {string|null} [filePath] @returns {void} */
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
    getMalformedFiles,
    getFieldsCache,
    getAliasIndex,
    getBodyBlockIndex,
    getBodyLinksCache,
    getVaultGeneration,
    getGraphStats,
    extractIdFromFrontmatter,
    extractEdgesFromFrontmatter,
    extractEdgesFromFrontmatterRaw,
    extractBodyLinks,
    extractBodyLinksRaw,
    extractAliasesFromFields,
    extractBodyLinksFieldValue,
    resolveRawEdges,
    parseFrontmatter,
    extractRelationTargets,
    extractAndResolveRelationTargets,
    BODY_LINKS_FIELD
};
