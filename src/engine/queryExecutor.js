'use strict';

const fs = require('fs');
const { getIndex, getFieldsCache, getVaultGeneration, getBodyLinksCache } = require('../core/indexService');
const { getBacklinks, getEdges, computeNodeExplorerScore } = require('../core/graph');
const { buildTaskRows } = require('../core/tasks');
const { reconstructVaultAtTime } = require('../core/timeEngine');
const { getMutationEvents } = require('../runtime/mutationEventLog');
const { normaliseDateInput, getTodayIsoLocal, addDaysIso } = require('../core/date');
const { normalizeText } = require('../core/frontmatter');
const {
    addQueryWarnings,
    closestFieldMatch,
    collectFieldCandidates
} = require('../intelligence/queryDiagnostics');
const { classifyScalarValue, compareScalarValues } = require('./queryParser');
const { scanInlineCalcs } = require('./inlineCalc');
const { createCrossNoteResolver } = require('./crossNoteCalcResolver');

const BODY_CACHE_MAX = 200;
const bodyCache = new Map();
const FILE_STAT_FIELDS = new Set(['file.created', 'file.modified']);
const GRAPH_VIRTUAL_FIELDS = new Set(['_inbound_count', '_outbound_count', '_hub_score']);
const INLINE_CALC_FIELD_PREFIX = 'cell.';
// Separate from bodyCache — that one lowercases everything for body:/any:
// substring search, which would corrupt calc syntax (Y1 becoming y1 mid-
// expression breaks the evaluator's own case rules) and named-cell lookups.
const RAW_BODY_CACHE_MAX = 200;
const rawBodyCache = new Map();
const defaultCrossNoteCalcResolver = createCrossNoteResolver({ getIndex });

/**
 * Cycle-safe BFS from `startId`, following `getNeighborIds(id)` up to `depth`
 * hops. Returns the union of every id reached at hop 1..depth (never the
 * start id itself, which is hop 0). depth=1 reduces to exactly the original
 * single-hop behavior (`getNeighborIds(startId)`, deduped into a Set).
 * @param {string} startId
 * @param {number} depth
 * @param {(id: string) => string[]} getNeighborIds
 * @returns {Set<string>}
 */
function collectTraversalIds(startId, depth, getNeighborIds) {
    const visited = new Set([startId]);
    const result = new Set();
    let frontier = [startId];
    for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
        const nextFrontier = [];
        for (const id of frontier) {
            for (const neighborId of getNeighborIds(id)) {
                if (visited.has(neighborId)) continue;
                visited.add(neighborId);
                result.add(neighborId);
                nextFrontier.push(neighborId);
            }
        }
        frontier = nextFrontier;
    }
    return result;
}

/** @returns {void} */
function clearBodyCache() {
    bodyCache.clear();
}

/**
 * @param {string|null} filePath
 * @returns {{ 'file.created': string, 'file.modified': string } | null}
 */
function readFileStatDates(filePath) {
    if (!filePath) return null;
    try {
        const stat = fs.statSync(filePath);
        return {
            'file.created': new Date(stat.birthtimeMs || stat.mtimeMs).toISOString().split('T')[0],
            'file.modified': new Date(stat.mtimeMs).toISOString().split('T')[0]
        };
    } catch (e) { return null; }
}

/** @param {string} field @returns {boolean} */
function isFileStatField(field) {
    return FILE_STAT_FIELDS.has(field);
}

/** @param {string} field @returns {boolean} */
function isGraphVirtualField(field) {
    return GRAPH_VIRTUAL_FIELDS.has(field);
}

/** @param {string} field @returns {boolean} */
function isInlineCalcField(field) {
    return typeof field === 'string' && field.startsWith(INLINE_CALC_FIELD_PREFIX);
}

/** @param {string} field @returns {boolean} */
function isVirtualQueryField(field) {
    return isFileStatField(field) || isGraphVirtualField(field) || isInlineCalcField(field);
}

/**
 * @param {string} id
 * @param {Map<string, Record<string, any>>} fieldCache
 * @returns {{ _inbound_count: number, _outbound_count: number, _hub_score: number }}
 */
function readGraphVirtualFields(id, fieldCache) {
    return {
        _inbound_count: (getBacklinks(id) || []).length,
        _outbound_count: (getEdges(id) || []).length,
        _hub_score: computeNodeExplorerScore(id, fieldCache)
    };
}

/**
 * Original-case body text for inline-calc scanning — same shape/eviction as
 * readBody() below, deliberately not shared with it (see rawBodyCache's own
 * comment above).
 * @param {string|null} filePath
 * @returns {string|null}
 */
function readRawBody(filePath) {
    if (!filePath) return null;

    let mtime = null;
    try { mtime = fs.statSync(filePath).mtimeMs; } catch (e) { return null; }

    const cached = rawBodyCache.get(filePath);
    if (cached && cached.mtime === mtime) {
        rawBodyCache.delete(filePath);
        rawBodyCache.set(filePath, cached);
        return cached.body;
    }

    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) { return null; }
    content = normalizeText(content);

    let body;
    if (/^\s*---/.test(content)) {
        const firstDash = content.indexOf('---');
        const closingIdx = content.indexOf('---', firstDash + 3);
        body = closingIdx !== -1 ? content.slice(closingIdx + 3) : content;
    } else {
        body = content;
    }

    if (rawBodyCache.size >= RAW_BODY_CACHE_MAX) {
        rawBodyCache.delete(rawBodyCache.keys().next().value);
    }
    rawBodyCache.set(filePath, { mtime, body });
    return body;
}

/** @returns {void} */
function clearRawBodyCache() {
    rawBodyCache.clear();
}

/**
 * Exposes a note's inline-calc cells (`` `=expr` `` / `` `name=expr` `` body
 * syntax — src/engine/inlineCalc.js) to the query engine as `cell.<name>`
 * fields, the same way `_hub_score` exposes graph structure. Query field
 * names are lowercased by the parser before they reach here (true for every
 * field today, not something new introduced by this), so lookups are
 * case-insensitive against the note's actual (case-sensitive) labels/names
 * — `cell.y1` in a query matches the cell labeled `Y1` in the note. A cell
 * that doesn't exist in this note, or failed to evaluate, is simply absent
 * from the returned object — honest silence, never a guessed value.
 * `frontmatterFields`, when supplied (the row's own already-parsed frontmatter
 * — callers already have this in scope during a query sweep, no extra read),
 * lets a calc cell read the note's real frontmatter values, not just other
 * calc cells. A purely additive second parameter — every pre-existing caller
 * (Query Builder, `!view` completion) calls this with only `filePath`, and
 * omitting it behaves exactly as before.
 * @param {string|null} filePath @param {Record<string, unknown>} [frontmatterFields]
 * @returns {Record<string, import('./mathExpr').ScalarValue>}
 */
function readInlineCalcVirtualFields(filePath, frontmatterFields) {
    /** @type {Record<string, import('./mathExpr').ScalarValue>} */
    const result = {};
    const body = readRawBody(filePath);
    if (!body) return result;
    for (const block of scanInlineCalcs(body, { resolveCrossNoteRef: defaultCrossNoteCalcResolver, frontmatterFields })) {
        if (!block.evalResult.ok) continue;
        result[INLINE_CALC_FIELD_PREFIX + block.label.toLowerCase()] = block.evalResult.value;
        if (block.name) result[INLINE_CALC_FIELD_PREFIX + block.name.toLowerCase()] = block.evalResult.value;
    }
    return result;
}

/**
 * Provenance for a note's `cell.<name>` query fields — the source expression,
 * label, and name behind each value `readInlineCalcVirtualFields` already
 * exposes. A separate function, not a change to that one's return shape:
 * `readInlineCalcVirtualFields` is already consumed directly by the Query
 * Builder (`src/actions/queryBuilderModel.js`) and `!view` completion
 * (`src/intelligence/completionRelationHelpers.js`), both of which expect its
 * flat `Record<string, ScalarValue>` shape as-is — changing it would silently
 * break both. This is purely additive, for UI surfaces (the View Panel
 * table) that want to show where a `cell.*` value actually came from and let
 * a user jump back to the source note.
 * @param {string|null} filePath @param {Record<string, unknown>} [frontmatterFields]
 * @returns {Record<string, {expr: string, label: string, name: string|null}>}
 */
function readInlineCalcCellMeta(filePath, frontmatterFields) {
    /** @type {Record<string, {expr: string, label: string, name: string|null}>} */
    const result = {};
    const body = readRawBody(filePath);
    if (!body) return result;
    for (const block of scanInlineCalcs(body, { resolveCrossNoteRef: defaultCrossNoteCalcResolver, frontmatterFields })) {
        if (!block.evalResult.ok) continue;
        const entry = { expr: block.expr, label: block.label, name: block.name };
        result[INLINE_CALC_FIELD_PREFIX + block.label.toLowerCase()] = entry;
        if (block.name) result[INLINE_CALC_FIELD_PREFIX + block.name.toLowerCase()] = entry;
    }
    return result;
}

/**
 * @param {string|null} filePath
 * @returns {string|null}
 */
function readBody(filePath) {
    if (!filePath) return null;

    let mtime = null;
    try { mtime = fs.statSync(filePath).mtimeMs; } catch (e) { return null; }

    const cached = bodyCache.get(filePath);
    if (cached && cached.mtime === mtime) {
        // Move to end so Map insertion order tracks recency (true LRU)
        bodyCache.delete(filePath);
        bodyCache.set(filePath, cached);
        return cached.body;
    }

    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) { return null; }
    content = normalizeText(content);

    let body;
    if (/^\s*---/.test(content)) {
        const firstDash = content.indexOf('---');
        const closingIdx = content.indexOf('---', firstDash + 3);
        body = closingIdx !== -1 ? content.slice(closingIdx + 3).toLowerCase() : content.toLowerCase();
    } else {
        body = content.toLowerCase();
    }

    if (bodyCache.size >= BODY_CACHE_MAX) {
        bodyCache.delete(bodyCache.keys().next().value);
    }
    bodyCache.set(filePath, { mtime, body });
    return body;
}

/**
 * @param {import('./queryConditions').QueryRow} row
 * @param {string|null} preset
 * @param {string} todayIso
 * @returns {boolean}
 */
function applyTaskPreset(row, preset, todayIso) {
    const date = String(row.date || row.fields?.date || '').trim();
    if (!preset) return true;
    if (preset === 'open') return !row.done;
    if (preset === 'done') return !!row.done;
    if (preset === 'undated') return !date;
    if (preset === 'overdue') return !row.done && !!date && date < todayIso;
    if (preset === 'calendar') return !!date;
    if (!date) return false;
    if (preset === 'today') return date === todayIso;
    if (preset === 'upcoming') {
        const end = addDaysIso(todayIso, 13);
        return date >= todayIso && date <= end;
    }
    return true;
}

/**
 * @param {import('./queryConditions').ParsedCondition} cond
 * @param {Record<string, any>} fields
 * @param {string|null} filePath
 * @returns {boolean}
 */
function matchesCondition(cond, fields, filePath) {
    if (cond.op === 'empty') {
        if (cond.field === 'body') { const body = readBody(filePath); return body === null || body.trim() === ''; }
        if (isFileStatField(cond.field)) return readFileStatDates(filePath) === null;
        const raw = fields[cond.field];
        return raw == null || String(raw).trim() === '';
    }
    if (cond.op === 'exists') {
        if (cond.field === 'body') { const body = readBody(filePath); return body !== null && body.trim() !== ''; }
        if (isFileStatField(cond.field)) return readFileStatDates(filePath) !== null;
        const raw = fields[cond.field];
        return raw != null && String(raw).trim() !== '';
    }

    if (cond.field === 'body') {
        const body = readBody(filePath);
        return body !== null && body.includes(cond.value);
    }

    if (cond.field === 'any') {
        const inFields = Object.values(fields).some(v => String(v).toLowerCase().includes(cond.value));
        if (inFields) return true;
        const body = readBody(filePath);
        return body !== null && body.includes(cond.value);
    }

    if (isFileStatField(cond.field)) {
        const fsd = readFileStatDates(filePath);
        if (!fsd) return false;
        const dateIso = fsd[cond.field];
        if (cond.op === 'contains') return dateIso.includes(cond.value);
        if (cond.op === 'gte' || cond.op === 'lte' || cond.op === 'gt' || cond.op === 'lt') {
            const cmp = compareScalarValues(dateIso, cond.value, cond.valueKind || 'date');
            if (cond.op === 'gte') return cmp >= 0;
            if (cond.op === 'lte') return cmp <= 0;
            if (cond.op === 'gt') return cmp > 0;
            return cmp < 0;
        }
        if (cond.op === 'neq') return dateIso !== cond.value;
        return dateIso === cond.value;
    }

    const raw = String(fields[cond.field] == null ? '' : fields[cond.field]).toLowerCase();
    if (cond.op === 'contains') return raw.includes(cond.value);

    if (cond.op === 'in') {
        const clean = raw.replace(/^\[\[|\]\]$/g, '').trim();
        return (cond.values || []).some(v => clean === v || raw === v);
    }

    if (cond.op === 'gte' || cond.op === 'lte' || cond.op === 'gt' || cond.op === 'lt') {
        if (!raw.trim()) return false;
        const cmp = compareScalarValues(raw, cond.value, cond.valueKind);
        if (cond.op === 'gte') return cmp >= 0;
        if (cond.op === 'lte') return cmp <= 0;
        if (cond.op === 'gt')  return cmp > 0;
        return cmp < 0;
    }

    if (cond.op === 'neq') {
        const clean = raw.replace(/^\[\[|\]\]$/g, '').trim();
        return clean !== cond.value && raw !== cond.value;
    }

    const clean = raw.replace(/^\[\[|\]\]$/g, '').trim();
    return clean === cond.value || raw === cond.value;
}

/**
 * @param {import('./queryConditions').ParsedQuery} query
 * @param {import('./queryConditions').QueryRow[]} rows
 * @param {string[]} warnings
 * @param {Map<string, string>} index
 * @param {Map<string, Record<string, any>>} fieldCache
 * @returns {void}
 */
function addZeroResultWarnings(query, rows, warnings, index, fieldCache) {
    if (rows.length > 0) return;
    addQueryWarnings(query, rows, warnings, index, fieldCache);

    const wheres = query.wheres && query.wheres.length > 0 ? query.wheres : (query.where ? [query.where] : []);
    for (const cond of wheres) {
        const isDateOp = cond.op === 'eq' || cond.op === 'gte' || cond.op === 'lte' || cond.op === 'gt' || cond.op === 'lt';
        if (isDateOp && cond.valueKind === 'string' && normaliseDateInput(cond.value) && cond.field !== 'id') {
            warnings.push('Date filters work best when stored values normalise to YYYY-MM-DD.');
        }
    }
}

/**
 * @param {import('./queryConditions').ParsedQuery} query
 * @param {import('./queryConditions').QueryRow[]} rows
 * @param {string[]} warnings
 * @returns {import('./queryConditions').QueryResult}
 */
/**
 * Folds `terms` (parsed aggregate clause, see queryParser) over `rows`.
 * Non-numeric or missing values for a field are silently excluded from
 * that field's fold (never coerced to 0, never a crash). If a field
 * resolves zero numeric values across all rows, its aggregate is `null`
 * — "honest silence over wrong guesses", matching project convention.
 * `count` never needs field values — it's always `rows.length`.
 * @param {{fn:string, field:string|null, alias:string}[]} terms
 * @param {import('./queryConditions').QueryRow[]} rows
 * @returns {Record<string, number|null>}
 */
const SINGLE_WIKILINK_RE = /^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/;

function groupKeyFor(rawValue) {
    const text = String(rawValue ?? '');
    const link = SINGLE_WIKILINK_RE.exec(text.trim());
    return link ? link[1].trim() : text;
}

function computeAggregates(terms, rows) {
    /** @type {Record<string, number|null>} */
    const out = {};
    for (const term of terms) {
        const scoped = term.when ? rows.filter((row) => matchesCondition(term.when, row.fields, null)) : rows;
        if (term.fn === 'count') {
            out[term.alias] = scoped.length;
            continue;
        }
        const nums = [];
        for (const row of scoped) {
            const raw = row.fields ? row.fields[term.field] : undefined;
            if (raw === undefined || raw === null || raw === '') continue;
            if (classifyScalarValue(raw) !== 'number') continue;
            const n = Number(raw);
            if (Number.isFinite(n)) nums.push(n);
        }
        if (nums.length === 0) {
            out[term.alias] = null;
            continue;
        }
        if (term.fn === 'sum') out[term.alias] = nums.reduce((a, b) => a + b, 0);
        else if (term.fn === 'average') out[term.alias] = nums.reduce((a, b) => a + b, 0) / nums.length;
        else if (term.fn === 'min') out[term.alias] = Math.min(...nums);
        else if (term.fn === 'max') out[term.alias] = Math.max(...nums);
    }
    return out;
}

function finaliseRows(query, rows, warnings) {
    if (!query.groupBy) {
        if (query.sort) {
            const { field, desc } = query.sort;
            rows.sort((a, b) => {
                const rawA = a.fields[field];
                const rawB = b.fields[field];
                const av = rawA == null ? (field === 'id' ? a.id : '') : (rawA === 0 ? 0 : (rawA || a.id || ''));
                const bv = rawB == null ? (field === 'id' ? b.id : '') : (rawB === 0 ? 0 : (rawB || b.id || ''));
                const sampleKind = classifyScalarValue(String(av || bv || '').toLowerCase());
                const cmp = compareScalarValues(av, bv, sampleKind);
                return desc ? -cmp : cmp;
            });
        } else if (query.type === 'tasks' && query.preset && query.preset !== null) {
            rows.sort((a, b) => {
                const av = String(a.fields.date || '');
                const bv = String(b.fields.date || '');
                if (!av && !bv) return a.id.localeCompare(b.id);
                if (!av) return 1;
                if (!bv) return -1;
                return av.localeCompare(bv) || a.id.localeCompare(b.id);
            });
        } else {
            rows.sort((a, b) => a.id.localeCompare(b.id));
        }
    }

    if (query.groupBy) {
        const groupField = query.groupBy;
        const groupMap = new Map();
        for (const row of rows) {
            const key = groupField === 'id' ? row.id : groupKeyFor(row.fields[groupField]);
            if (!groupMap.has(key)) groupMap.set(key, { key, count: 0, rows: [] });
            const g = groupMap.get(key);
            g.count++;
            g.rows.push(row);
        }
        const groups = [...groupMap.values()];
        if (query.aggregate) {
            for (const g of groups) g.aggregates = computeAggregates(query.aggregate, g.rows);
        }
        const sortField = query.sort?.field;
        if (sortField === groupField) {
            const desc = !!query.sort.desc;
            groups.sort((a, b) => desc ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key));
        } else if (query.aggregate && query.aggregate.some(t => t.alias === sortField)) {
            const desc = !!query.sort?.desc;
            groups.sort((a, b) => {
                const av = a.aggregates?.[sortField];
                const bv = b.aggregates?.[sortField];
                // Nulls always sort last, regardless of asc/desc (matches
                // SQL's common NULLS LAST default) — a group with no numeric
                // values never looks like a fake "lowest" score.
                if (av == null && bv == null) return 0;
                if (av == null) return 1;
                if (bv == null) return -1;
                return desc ? bv - av : av - bv;
            });
        } else {
            const asc = sortField === 'count' && !query.sort?.desc;
            groups.sort((a, b) => asc ? a.count - b.count : b.count - a.count);
        }
        if (query.limit && query.limit > 0) groups.splice(query.limit);
        const allRows = groups.flatMap(g => g.rows);
        const types = [...new Set(allRows.map(r => r.nodeType).filter(Boolean))].sort();
        const columns = query.aggregate
            ? [groupField, 'count', ...query.aggregate.filter(t => t.fn !== 'count').map(t => t.alias)]
            : [groupField, 'count'];
        return { success: true, rows: allRows, groups, groupBy: groupField, columns, types, warnings, error: null };
    }

    let aggregates = null;
    if (query.aggregate) aggregates = computeAggregates(query.aggregate, rows);

    if (query.limit && query.limit > 0) rows.splice(query.limit);

    let columns;
    if (query.select && query.select.length > 0) {
        columns = ['id', ...query.select.filter(c => c !== 'id')];
    } else {
        const fieldSet = new Set();
        for (const row of rows) for (const key of Object.keys(row.fields)) if (key !== 'id' && key !== '__yamlink_tags') fieldSet.add(key);
        fieldSet.delete('type');
        const showType = query.type === '*' || query.incoming || query.type === 'tasks';
        columns = showType ? ['id', 'type', ...Array.from(fieldSet).sort()] : ['id', ...Array.from(fieldSet).sort()];
    }

    const types = (query.type === '*' || query.incoming || query.type === 'tasks')
        ? [...new Set(rows.map(r => r.nodeType).filter(Boolean))].sort()
        : [];

    return { success: true, rows, columns, types, warnings, error: null, ...(aggregates ? { aggregates } : {}) };
}

/**
 * @param {import('./queryConditions').ParsedQuery} query
 * @param {string|null} [contextNodeId]
 * @returns {import('./queryConditions').QueryResult}
 */
function runQuery(query, contextNodeId) {
    const warnings = [];
    if (!query || typeof query !== 'object') {
        return { success: false, rows: [], columns: [], types: [], warnings, error: 'Invalid or unparseable !view block' };
    }
    if (Array.isArray(query.parseWarnings) && query.parseWarnings.length) {
        warnings.push(...query.parseWarnings);
    }

    if (query.incoming) {
        if (!contextNodeId) {
            return { success: false, rows: [], columns: [], types: [], warnings, error: '!view incoming requires a node context — save this file with an id: field first' };
        }
        const fieldCache = getFieldsCache();
        const idIndex = getIndex();
        const backlinks = getBacklinks(contextNodeId);
        const rows = [];
        try {
            for (const { field, sourceId } of backlinks) {
                if (query.via && field !== query.via) continue;
                const fields = fieldCache.get(sourceId);
                if (!fields) continue;
                const nodeType = (fields.type || '').trim().toLowerCase();
                if (query.type !== '*' && nodeType !== query.type) continue;
                rows.push({ id: sourceId, fields, filePath: idIndex.get(sourceId) ?? null, nodeType, viaField: field });
            }
        } catch (e) {
            return { success: false, rows: [], columns: [], types: [], warnings, error: `Runtime error: ${e.message}` };
        }
        addZeroResultWarnings(query, rows, warnings, idIndex, fieldCache);
        return finaliseRows(query, rows, warnings);
    }

    const wheres = query.wheres && query.wheres.length > 0 ? query.wheres : (query.where ? [query.where] : []);
    const whereGroups = query.whereGroups && query.whereGroups.length > 0
        ? query.whereGroups
        : wheres.map((condition) => [condition]);
    for (const w of wheres) {
        if (w.op === 'eq' && !w.value) warnings.push(`where ${w.field} = (missing value) — condition skipped`);
    }
    const validWheres = wheres.filter(w => w.op === 'empty' || w.op === 'exists' || w.value);
    const validWhereGroups = whereGroups
        .map((group) => group.filter(w => w.op === 'empty' || w.op === 'exists' || w.value))
        .filter((group) => group.length > 0);
    const rows = [];
    const fieldCache = getFieldsCache();
    const needsBody = validWheres.some(w => w.field === 'body' || w.field === 'any');
    // Aggregate terms reference fields too (e.g. `aggregate sum(cell.total) as
    // total`) — a field mentioned only inside `aggregate` still needs the
    // same virtual-field resolution as one mentioned in select/where/sort,
    // or it would silently resolve to undefined on every row.
    const aggregateFields = Array.isArray(query.aggregate) ? query.aggregate.map(t => t.field).filter(Boolean) : [];
    const needsFileStatWhere = validWheres.some(w => isFileStatField(w.field));
    const needsFileStat = needsFileStatWhere
        || (query.select && query.select.some(isFileStatField))
        || isFileStatField(query.sort?.field)
        || aggregateFields.some(isFileStatField);
    const needsGraphVirtual = validWheres.some(w => isGraphVirtualField(w.field))
        || (query.select && query.select.some(isGraphVirtualField))
        || isGraphVirtualField(query.sort?.field)
        || aggregateFields.some(isGraphVirtualField);
    const needsInlineCalc = validWheres.some(w => isInlineCalcField(w.field))
        || (query.select && query.select.some(isInlineCalcField))
        || isInlineCalcField(query.sort?.field)
        || aggregateFields.some(isInlineCalcField);
    const index = getIndex();
    const todayIso = getTodayIsoLocal();

    // VQL v1: graph traversal, resolved once against the target's real
    // edges/backlinks (not per-row) into a plain id Set, so filtering stays
    // a single Set.has() check per row in the main loop below — no
    // different in cost than any other where-clause filter. `within N`
    // extends this to a cycle-safe BFS unioning hops 1..N in the same
    // direction; depth 1 (the default) is identical to the original
    // single-hop behavior.
    let linkedToIds = null;
    if (query.linkedTo) {
        linkedToIds = collectTraversalIds(query.linkedTo, query.linkedToDepth || 1, (id) => (getBacklinks(id) || []).map((edge) => edge.sourceId));
    }
    let linkedFromIds = null;
    if (query.linkedFrom) {
        linkedFromIds = collectTraversalIds(query.linkedFrom, query.linkedFromDepth || 1, (id) => (getEdges(id) || []).map((edge) => edge.targetId));
    }

    // VQL v1: temporal reconstruction. When `as of` is set, row-building
    // reads from a historically-reconstructed field snapshot (the existing
    // Time Engine primitive, reconstructVaultAtTime() — no new
    // reconstruction logic, just new surfacing of it) instead of the live
    // fieldsCache. Everything else — type filter, where, select, sort,
    // limit — stays the same logic, just fed reconstructed fields.
    // Computed/virtual fields (file stats, graph degree) are NOT
    // reconstructed, a stated limitation; they still reflect current
    // values. Does not apply to the tasks/incoming branches, and does not
    // interact with linked_to/linked_from — traversal above still reads
    // the live graph, explicitly out of scope for this pass.
    let asOfFields = null;
    if (query.asOf) {
        const parsedMs = Date.parse(query.asOf);
        if (!Number.isFinite(parsedMs)) {
            warnings.push(`"as of ${query.asOf}" is not a valid date — ignoring, showing current state.`);
        } else {
            const isoTimestamp = new Date(parsedMs).toISOString();
            const reconstructed = reconstructVaultAtTime(isoTimestamp, {
                fieldsCache: fieldCache,
                mutationEvents: getMutationEvents(),
                bodyLinksCache: getBodyLinksCache()
            });
            asOfFields = new Map();
            for (const [reconstructedId, entry] of reconstructed) {
                if (entry.exists) asOfFields.set(reconstructedId, entry.fields || {});
            }
        }
    }

    try {
        if (query.type === 'tasks') {
            const taskRows = buildTaskRows(index, getVaultGeneration());
            for (const taskRow of taskRows) {
                if (!applyTaskPreset(taskRow, query.preset, todayIso)) continue;
                if (validWhereGroups.length > 0) {
                    const passes = validWhereGroups.every((group) =>
                        group.some((cond) => matchesCondition(cond, taskRow.fields, taskRow.filePath))
                    );
                    if (!passes) continue;
                }
                rows.push(taskRow);
            }
        } else {
            const rowIds = asOfFields ? asOfFields.keys() : index.keys();
            for (const id of rowIds) {
                const filePath = index.get(id) ?? null;
                const fields = asOfFields ? asOfFields.get(id) : fieldCache.get(id);
                if (!fields) continue;
                const nodeType = (fields.type || '').trim().toLowerCase();
                if (query.type !== '*' && nodeType !== query.type) continue;
                if (linkedToIds && !linkedToIds.has(id)) continue;
                if (linkedFromIds && !linkedFromIds.has(id)) continue;
                if (validWhereGroups.length > 0) {
                    const whereFields = needsGraphVirtual || needsInlineCalc
                        ? {
                            ...fields,
                            ...(needsGraphVirtual ? readGraphVirtualFields(id, fieldCache) : null),
                            ...(needsInlineCalc ? readInlineCalcVirtualFields(filePath, fields) : null)
                        }
                        : fields;
                    const passes = validWhereGroups.every((group) =>
                        group.some((cond) => matchesCondition(cond, whereFields, (needsBody || needsFileStatWhere) ? filePath : null))
                    );
                    if (!passes) continue;
                }
                const fileStatFields = needsFileStat ? readFileStatDates(filePath) : null;
                const graphVirtualFields = needsGraphVirtual ? readGraphVirtualFields(id, fieldCache) : null;
                const inlineCalcFields = needsInlineCalc ? readInlineCalcVirtualFields(filePath, fields) : null;
                const inlineCalcMeta = needsInlineCalc ? readInlineCalcCellMeta(filePath, fields) : null;
                const row = { id, fields: { ...fields, ...(fileStatFields || {}), ...(graphVirtualFields || {}), ...(inlineCalcFields || {}) }, filePath, nodeType };
                if (inlineCalcMeta && Object.keys(inlineCalcMeta).length) row.cellMeta = inlineCalcMeta;
                rows.push(row);
            }
        }
    } catch (e) {
        return { success: false, rows: [], columns: [], types: [], warnings, error: `Runtime error: ${e.message}` };
    }

    const fieldCandidates = collectFieldCandidates(query.type, fieldCache);
    const sortIsAggregateAlias = Array.isArray(query.aggregate) && query.aggregate.some(t => t.alias === query.sort?.field);
    if (query.sort?.field && !sortIsAggregateAlias && !fieldCandidates.includes(query.sort.field) && !isVirtualQueryField(query.sort.field)) {
        const sortSuggestion = closestFieldMatch(query.sort.field, query.type, fieldCache);
        if (sortSuggestion) {
            warnings.push(`Sort field "${query.sort.field}" is uncommon here. Try "${sortSuggestion}" instead.`);
        }
    }

    addZeroResultWarnings(query, rows, warnings, index, fieldCache);
    return finaliseRows(query, rows, warnings);
}

module.exports = { runQuery, clearBodyCache, readFileStatDates, clearRawBodyCache, readInlineCalcVirtualFields, readInlineCalcCellMeta };
