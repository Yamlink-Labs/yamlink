'use strict';

const fs = require('fs');
const { getIndex, getFieldsCache, getVaultGeneration } = require('../core/indexService');
const { getBacklinks, getEdges, computeNodeExplorerScore } = require('../core/graph');
const { buildTaskRows } = require('../core/tasks');
const { normaliseDateInput, getTodayIsoLocal, addDaysIso } = require('../core/date');
const { normalizeText } = require('../core/frontmatter');
const {
    addQueryWarnings,
    closestFieldMatch,
    collectFieldCandidates
} = require('../intelligence/queryDiagnostics');
const { classifyScalarValue, compareScalarValues } = require('./queryParser');

const BODY_CACHE_MAX = 200;
const bodyCache = new Map();
const FILE_STAT_FIELDS = new Set(['file.created', 'file.modified']);
const GRAPH_VIRTUAL_FIELDS = new Set(['_inbound_count', '_outbound_count', '_hub_score']);

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
function isVirtualQueryField(field) {
    return isFileStatField(field) || isGraphVirtualField(field);
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
function finaliseRows(query, rows, warnings) {
    if (!query.groupBy) {
        if (query.sort) {
            const { field, desc } = query.sort;
            rows.sort((a, b) => {
                const av = a.fields[field] == null ? (field === 'id' ? a.id : '') : (a.fields[field] || a.id || '');
                const bv = b.fields[field] == null ? (field === 'id' ? b.id : '') : (b.fields[field] || b.id || '');
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
            const key = groupField === 'id' ? row.id : String(row.fields[groupField] ?? '');
            if (!groupMap.has(key)) groupMap.set(key, { key, count: 0, rows: [] });
            const g = groupMap.get(key);
            g.count++;
            g.rows.push(row);
        }
        const groups = [...groupMap.values()];
        const sortField = query.sort?.field;
        if (sortField === groupField) {
            const desc = !!query.sort.desc;
            groups.sort((a, b) => desc ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key));
        } else {
            const asc = sortField === 'count' && !query.sort?.desc;
            groups.sort((a, b) => asc ? a.count - b.count : b.count - a.count);
        }
        if (query.limit && query.limit > 0) groups.splice(query.limit);
        const allRows = groups.flatMap(g => g.rows);
        const types = [...new Set(allRows.map(r => r.nodeType).filter(Boolean))].sort();
        return { success: true, rows: allRows, groups, groupBy: groupField, columns: [groupField, 'count'], types, warnings, error: null };
    }

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

    return { success: true, rows, columns, types, warnings, error: null };
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
    const needsFileStatWhere = validWheres.some(w => isFileStatField(w.field));
    const needsFileStat = needsFileStatWhere
        || (query.select && query.select.some(isFileStatField))
        || isFileStatField(query.sort?.field);
    const needsGraphVirtual = validWheres.some(w => isGraphVirtualField(w.field))
        || (query.select && query.select.some(isGraphVirtualField))
        || isGraphVirtualField(query.sort?.field);
    const index = getIndex();
    const todayIso = getTodayIsoLocal();

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
            for (const [id, filePath] of index.entries()) {
                const fields = fieldCache.get(id);
                if (!fields) continue;
                const nodeType = (fields.type || '').trim().toLowerCase();
                if (query.type !== '*' && nodeType !== query.type) continue;
                if (validWhereGroups.length > 0) {
                    const whereFields = needsGraphVirtual ? { ...fields, ...readGraphVirtualFields(id, fieldCache) } : fields;
                    const passes = validWhereGroups.every((group) =>
                        group.some((cond) => matchesCondition(cond, whereFields, (needsBody || needsFileStatWhere) ? filePath : null))
                    );
                    if (!passes) continue;
                }
                const fileStatFields = needsFileStat ? readFileStatDates(filePath) : null;
                const graphVirtualFields = needsGraphVirtual ? readGraphVirtualFields(id, fieldCache) : null;
                rows.push({ id, fields: { ...fields, ...(fileStatFields || {}), ...(graphVirtualFields || {}) }, filePath, nodeType });
            }
        }
    } catch (e) {
        return { success: false, rows: [], columns: [], types: [], warnings, error: `Runtime error: ${e.message}` };
    }

    const fieldCandidates = collectFieldCandidates(query.type, fieldCache);
    if (query.sort?.field && !fieldCandidates.includes(query.sort.field) && !isVirtualQueryField(query.sort.field)) {
        const sortSuggestion = closestFieldMatch(query.sort.field, query.type, fieldCache);
        if (sortSuggestion) {
            warnings.push(`Sort field "${query.sort.field}" is uncommon here. Try "${sortSuggestion}" instead.`);
        }
    }

    addZeroResultWarnings(query, rows, warnings, index, fieldCache);
    return finaliseRows(query, rows, warnings);
}

module.exports = { runQuery, clearBodyCache, readFileStatDates };
