// src/engine/query.js
// Pure query engine — no VS Code, no fs writes, no HTML
// Importable by extension, desktop app, or tests

const fs = require('fs');
const { getIndex, getFieldsCache, getVaultGeneration } = require('../core/indexService');
const { getBacklinks } = require('../core/graph');
const { buildTaskRows } = require('../core/tasks');
const { normaliseDateInput, getTodayIsoLocal, addDaysIso } = require('../core/date');
const { normalizeText } = require('../core/frontmatter');
const {
    addQueryWarnings,
    closestFieldMatch,
    collectFieldCandidates
} = require('../intelligence/queryDiagnostics');

const BODY_CACHE_MAX = 200;
const bodyCache = new Map();
const TASK_PRESETS = new Set(['today', 'upcoming', 'calendar', 'agenda', 'open', 'done', 'undated', 'overdue']);

function clearBodyCache() {
    bodyCache.clear();
}

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

function classifyScalarValue(rawValue) {
    const value = String(rawValue ?? '').trim();
    if (!value) return 'string';
    if (resolveQueryFunctionValue(value)) return 'date';
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return 'number';
    if (value === 'true' || value === 'false') return 'boolean';
    if (normaliseDateInput(value)) return 'date';
    return 'string';
}

function parseSignedInteger(rawValue) {
    const text = String(rawValue ?? '').trim();
    if (!/^-?\d+$/.test(text)) return null;
    return Number(text);
}

function resolveQueryFunctionValue(rawValue) {
    const text = String(rawValue ?? '').trim();
    const match = text.match(/^([a-z][\w-]*)\((.*?)\)$/i);
    if (!match) return null;

    const fn = match[1].toLowerCase();
    const argText = match[2].trim();
    const todayIso = getTodayIsoLocal();

    if (fn === 'today' || fn === 'now') {
        if (argText) return null;
        return { value: todayIso, valueKind: 'date', valueSource: `${fn}()` };
    }

    if (fn === 'tomorrow') {
        if (argText) return null;
        return { value: addDaysIso(todayIso, 1), valueKind: 'date', valueSource: 'tomorrow()' };
    }

    if (fn === 'yesterday') {
        if (argText) return null;
        return { value: addDaysIso(todayIso, -1), valueKind: 'date', valueSource: 'yesterday()' };
    }

    if (fn === 'days-from-now' || fn === 'add-days') {
        const amount = parseSignedInteger(argText);
        if (amount === null) return null;
        return { value: addDaysIso(todayIso, amount), valueKind: 'date', valueSource: `${fn}(${amount})` };
    }

    if (fn === 'days-ago') {
        const amount = parseSignedInteger(argText);
        if (amount === null) return null;
        return { value: addDaysIso(todayIso, -amount), valueKind: 'date', valueSource: `days-ago(${amount})` };
    }

    return null;
}

function parseScalarQueryValue(rawValue) {
    const resolved = resolveQueryFunctionValue(rawValue);
    if (resolved) return resolved;
    const value = String(rawValue ?? '').trim().toLowerCase();
    return {
        value,
        valueKind: classifyScalarValue(value),
        valueSource: null
    };
}

function compareScalarValues(left, right, kind = 'string') {
    if (kind === 'number') {
        const leftNum = Number(left);
        const rightNum = Number(right);
        if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
            return leftNum - rightNum;
        }
    }
    if (kind === 'date') {
        const leftDate = normaliseDateInput(left) || String(left || '');
        const rightDate = normaliseDateInput(right) || String(right || '');
        return leftDate.localeCompare(rightDate);
    }
    if (kind === 'boolean') {
        const leftBool = String(left).toLowerCase() === 'true' ? 1 : 0;
        const rightBool = String(right).toLowerCase() === 'true' ? 1 : 0;
        return leftBool - rightBool;
    }
    return String(left ?? '').toLowerCase().localeCompare(String(right ?? '').toLowerCase());
}

function parseCondition(text) {
    text = text.trim();
    if (!text) return null;

    // #tag shorthand → __yamlink_tags contains <tag>
    const hashtagShorthand = text.match(/^#([A-Za-z][\w-]*)$/i);
    if (hashtagShorthand) {
        return { field: '__yamlink_tags', op: 'contains', value: hashtagShorthand[1].toLowerCase(), valueKind: 'string', tagShorthand: true };
    }

    const containsQuoted = text.match(/^([\w-]+|\*)\s+contains\s+["'](.+?)["']$/i);
    if (containsQuoted) {
        return {
            field: normaliseField(containsQuoted[1]),
            op: 'contains',
            value: containsQuoted[2].trim().toLowerCase(),
            valueKind: 'string'
        };
    }

    const containsPlain = text.match(/^([\w-]+|\*)\s+contains\s+(.+)$/i);
    if (containsPlain) {
        return {
            field: normaliseField(containsPlain[1]),
            op: 'contains',
            value: containsPlain[2].trim().toLowerCase(),
            valueKind: 'string'
        };
    }

    // empty / exists predicates: "field is empty", "field is not empty", "field exists"
    const emptyExistsMatch = text.match(/^([\w-]+|\*)\s+is\s+(empty|not\s+empty)$/i);
    if (emptyExistsMatch) {
        const op = /^not\s+empty$/i.test(emptyExistsMatch[2].trim()) ? 'exists' : 'empty';
        return { field: normaliseField(emptyExistsMatch[1]), op, value: '', valueKind: 'string' };
    }
    const existsMatch = text.match(/^([\w-]+|\*)\s+exists$/i);
    if (existsMatch) {
        return { field: normaliseField(existsMatch[1]), op: 'exists', value: '', valueKind: 'string' };
    }

    const eqRel = text.match(/^([\w-]+)\s*(?:=|\bis\b)\s*\[\[([^\]]+)\]\]$/i);
    if (eqRel) {
        return {
            field: eqRel[1].toLowerCase(),
            op: 'eq',
            value: eqRel[2].trim().toLowerCase(),
            valueKind: 'relation'
        };
    }

    // != with relation value
    const neqRel = text.match(/^([\w-]+)\s*!=\s*\[\[([^\]]+)\]\]$/i);
    if (neqRel) {
        return { field: neqRel[1].toLowerCase(), op: 'neq', value: neqRel[2].trim().toLowerCase(), valueKind: 'relation' };
    }

    const compareOp = text.match(/^([\w-]+)\s*(>=|<=|>|<)\s*(.+)$/i);
    if (compareOp) {
        let rawValue = compareOp[3].trim();
        if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
            rawValue = rawValue.slice(1, -1);
        }
        const opMap = { '>=': 'gte', '<=': 'lte', '>': 'gt', '<': 'lt' };
        const scalar = parseScalarQueryValue(rawValue);
        return {
            field: compareOp[1].toLowerCase(),
            op: opMap[compareOp[2]],
            value: scalar.value,
            valueKind: scalar.valueKind,
            valueSource: scalar.valueSource
        };
    }

    // != with scalar value
    const neqScalar = text.match(/^([\w-]+)\s*!=\s*(.+)$/i);
    if (neqScalar) {
        let rawValue = neqScalar[2].trim();
        if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
            rawValue = rawValue.slice(1, -1);
        }
        const scalar = parseScalarQueryValue(rawValue);
        return {
            field: neqScalar[1].toLowerCase(),
            op: 'neq',
            value: scalar.value,
            valueKind: scalar.valueKind,
            valueSource: scalar.valueSource
        };
    }

    const eqScalar = text.match(/^([\w-]+)\s*(?:=|\bis\b)\s*(.+)$/i);
    if (eqScalar) {
        let rawFull = eqScalar[2].trim();
        const orParts = rawFull.split(/\s+or\s+/i);
        if (orParts.length > 1) {
            const looksLikeCondition = /\s*(?:=|contains\b|>=|<=|>|<)/i;
            const allSimple = orParts.slice(1).every(p => !looksLikeCondition.test(p.trim()));
            if (allSimple) {
                const values = orParts.map(v => {
                    let s = v.trim();
                    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
                    if (s.startsWith('[[') && s.endsWith(']]')) s = s.slice(2, -2).trim();
                    return s.toLowerCase();
                }).filter(Boolean);
                return {
                    field: eqScalar[1].toLowerCase(),
                    op: 'in',
                    values,
                    value: values[0],
                    valueKind: 'string'
                };
            }
            return null;
        }
        let rawValue = rawFull;
        if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
            rawValue = rawValue.slice(1, -1);
        }
        return {
            field: eqScalar[1].toLowerCase(),
            op: 'eq',
            ...parseScalarQueryValue(rawValue)
        };
    }

    return null;
}

function parseWhereGroup(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const parts = raw
        .split(/\s+or\s+(?=(?:[\w*-]+\s+(?:contains\b|=|!=|>=|<=|>|<|\bis\b|\bexists\b)|#[A-Za-z][\w-]*))/i)
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length <= 1) {
        const condition = parseCondition(raw);
        if (!condition) return null;
        return { conditions: [condition], warning: condition.warning || null };
    }

    const conditions = [];
    const warnings = [];
    for (const part of parts) {
        const condition = parseCondition(part);
        if (!condition) {
            return null;
        }
        if (condition.warning) warnings.push(condition.warning);
        conditions.push(condition);
    }

    return {
        conditions,
        warning: warnings.length ? warnings.join(' ') : null
    };
}

function normaliseField(raw) {
    const f = raw.trim().toLowerCase();
    return f === '*' ? 'any' : f;
}

function resolveSimpleViewAlias(token) {
    const lower = String(token || '').toLowerCase();
    if (lower === 'task') return { type: 'tasks', preset: null, shorthand: 'task' };
    if (lower === 'tasks') return { type: 'tasks', preset: null, shorthand: 'tasks' };
    if (lower === 'open-tasks') return { type: 'tasks', preset: 'open', shorthand: 'open-tasks' };
    if (lower === 'done-tasks') return { type: 'tasks', preset: 'done', shorthand: 'done-tasks' };
    if (lower === 'undated-tasks') return { type: 'tasks', preset: 'undated', shorthand: 'undated-tasks' };
    if (lower === 'overdue') return { type: 'tasks', preset: 'overdue', shorthand: 'overdue' };
    if (TASK_PRESETS.has(lower)) return { type: 'tasks', preset: lower === 'agenda' ? 'upcoming' : lower, shorthand: lower };
    return null;
}

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

function matchesCondition(cond, fields, filePath) {
    if (cond.op === 'empty') {
        if (cond.field === 'body') { const body = readBody(filePath); return body === null || body.trim() === ''; }
        const raw = fields[cond.field];
        return raw == null || String(raw).trim() === '';
    }
    if (cond.op === 'exists') {
        if (cond.field === 'body') { const body = readBody(filePath); return body !== null && body.trim() !== ''; }
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

function parseSingleViewBlock(lines) {
    if (!lines || lines.length === 0) return null;

    const firstLine = lines[0].trim();
    if (!firstLine.startsWith('!view ')) return null;

    let rest = firstLine.slice(6).trim();
    let label = null;

    const pipeIdx = rest.indexOf('|');
    if (pipeIdx !== -1) {
        label = rest.slice(pipeIdx + 1).trim() || null;
        rest = rest.slice(0, pipeIdx).trim();
    }

    let incoming = false;
    if (rest.startsWith('incoming ') || rest === 'incoming') {
        incoming = true;
        rest = rest.slice('incoming'.length).trim();
    }

    let type = '*';
    let preset = null;
    let shorthand = null;
    if (rest !== '*' && !rest.startsWith('* ')) {
        const typeMatch = rest.match(/^([\w-]+)/);
        if (!typeMatch) return null;
        const alias = resolveSimpleViewAlias(typeMatch[1]);
        if (alias) {
            type = alias.type;
            preset = alias.preset;
            shorthand = alias.shorthand;
        } else {
            type = typeMatch[1].toLowerCase();
        }
        rest = rest.slice(typeMatch[1].length).trim();
        if (!preset) {
            const presetMatch = rest.match(/^(today|upcoming|calendar|agenda)\b/i);
            if (presetMatch) {
                preset = presetMatch[1].toLowerCase() === 'agenda' ? 'upcoming' : presetMatch[1].toLowerCase();
                shorthand = presetMatch[1].toLowerCase();
                rest = rest.slice(presetMatch[1].length).trim();
            }
        }
    } else if (rest.startsWith('* ')) {
        rest = rest.slice(2).trim();
    } else {
        rest = '';
    }

    const clauseLines = [rest];
    for (let i = 1; i < lines.length; i++) clauseLines.push(lines[i].trim());
    const clauseText = clauseLines.join(' ').trim();

    let select = null;
    const selectMatch = clauseText.match(/\bselect\s+([\w,\s-]+?)(?=\s+where\b|\s+sort\b|\s+limit\b|\s+via\b|\s+group\b|$)/i);
    if (selectMatch) {
        select = selectMatch[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (select.length === 0) select = null;
    }

    let sort = null;
    const sortMatch = clauseText.match(/\bsort\s+([\w-]+)(\s+desc)?(?=\s+(?:limit|group)\b|$)/i);
    if (sortMatch) sort = { field: sortMatch[1].toLowerCase(), desc: !!sortMatch[2] };

    let limit = null;
    const limitMatch = clauseText.match(/\blimit\s+(\d+)/i);
    if (limitMatch) limit = parseInt(limitMatch[1], 10);

    let via = null;
    const viaMatch = clauseText.match(/\bvia\s+([\w-]+)/i);
    if (viaMatch) via = viaMatch[1].toLowerCase();

    let groupBy = null;
    const groupByMatch = clauseText.match(/\bgroup\s+by\s+([\w-]+)(?=\s+(?:sort|limit)\b|$)/i);
    if (groupByMatch) groupBy = groupByMatch[1].toLowerCase();

    const wheres = [];
    const whereGroups = [];
    const parseWarnings = [];
    const whereBlocks = clauseText.match(/\bwhere\s+(?:(?!\b(?:where|sort|limit|select|via|group)\b).)+/gi) || [];
    for (const block of whereBlocks) {
        const condText = block.replace(/^where\s+/i, '').trim();
        const parts = condText.split(/\s+and\s+(?=(?:[\w*-]+\s+(?:contains\b|=|!=|>=|<=|>|<|\bis\b|\bexists\b)|#[A-Za-z][\w-]*))/i);
        for (const part of parts) {
            const group = parseWhereGroup(part.trim());
            if (group?.conditions?.length) {
                if (group.warning) parseWarnings.push(group.warning);
                whereGroups.push(group.conditions);
                wheres.push(...group.conditions);
            } else if (part.trim()) {
                parseWarnings.push(`Could not understand where clause: "${part.trim()}".`);
            }
        }
    }

    return { type, incoming, via, select, wheres, whereGroups, where: wheres[0] ?? null, sort, limit, label, preset, shorthand, groupBy, parseWarnings };
}

function parseAllViewQueries(text) {
    const queries = [];
    const lines = text.split('\n');

    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();
        if (line.startsWith('!view ')) {
            const block = [lines[i]];
            let j = i + 1;
            while (j < lines.length) {
                const next = lines[j].trim();
                if (!next.length) break;
                if (next.startsWith('!view ')) break;
                if (/^(select|where|sort|limit|via|group)\b/i.test(next)) {
                    block.push(lines[j]);
                    j++;
                } else {
                    break;
                }
            }
            const q = parseSingleViewBlock(block);
            if (q) queries.push(q);
            i = j;
        } else {
            i++;
        }
    }

    return queries.length > 0 ? queries : null;
}

function parseSingleViewLine(line) { return parseSingleViewBlock([line]); }
function parseViewQuery(text) { const all = parseAllViewQueries(text); return all ? all[0] : null; }

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
                    const passes = validWhereGroups.every((group) =>
                        group.some((cond) => matchesCondition(cond, fields, needsBody ? filePath : null))
                    );
                    if (!passes) continue;
                }
                rows.push({ id, fields, filePath, nodeType });
            }
        }
    } catch (e) {
        return { success: false, rows: [], columns: [], types: [], warnings, error: `Runtime error: ${e.message}` };
    }

    const fieldCandidates = collectFieldCandidates(query.type, fieldCache);
    if (query.sort?.field && !fieldCandidates.includes(query.sort.field)) {
        const sortSuggestion = closestFieldMatch(query.sort.field, query.type, fieldCache);
        if (sortSuggestion) {
            warnings.push(`Sort field "${query.sort.field}" is uncommon here. Try "${sortSuggestion}" instead.`);
        }
    }

    addZeroResultWarnings(query, rows, warnings, index, fieldCache);
    return finaliseRows(query, rows, warnings);
}

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

function buildQueryString(query) {
    const prefix = query.incoming ? 'incoming ' : '';
    let head = query.type;
    if (!query.incoming && query.type === 'tasks' && query.shorthand && (!query.select || query.select.length === 0) && !query.via) {
        head = query.shorthand;
    } else if (!query.incoming && query.type === 'tasks' && query.preset) {
        head = query.preset;
    }
    let s = '!view ' + prefix + head;
    if (!query.shorthand && query.type === 'tasks' && query.preset) s += ' ' + query.preset;
    if (query.label) s += ' | ' + query.label;
    if (query.via) s += ' via ' + query.via;
    if (query.select) s += '\nselect ' + query.select.join(', ');
    const whereGroups = query.whereGroups && query.whereGroups.length > 0
        ? query.whereGroups
        : ((query.wheres && query.wheres.length > 0)
            ? query.wheres.map((condition) => [condition])
            : (query.where ? [[query.where]] : []));
    const opSymbol = { gte: '>=', lte: '<=', gt: '>', lt: '<' };
    const stringifyWhere = (w) => {
        if (w.tagShorthand || w.field === '__yamlink_tags') {
            return '#' + w.value;
        }
        const scalarValue = w.valueSource || w.value;
        let clause = w.field + ' ';
        if (w.op === 'contains') {
            clause += 'contains ' + w.value;
        } else if (w.op === 'empty') {
            clause += 'is empty';
        } else if (w.op === 'exists') {
            clause += 'exists';
        } else if (w.op === 'neq') {
            clause += w.valueKind === 'relation' ? `!= [[${w.value}]]` : `!= ${scalarValue}`;
        } else if (w.op === 'in') {
            clause += '= ' + (w.values || [w.value]).join(' or ');
        } else if (opSymbol[w.op]) {
            clause += opSymbol[w.op] + ' ' + scalarValue;
        } else if (w.valueKind === 'relation') {
            clause += '= [[' + w.value + ']]';
        } else if (w.valueKind === 'string' && /\s/.test(scalarValue)) {
            clause += '= "' + scalarValue + '"';
        } else {
            clause += '= ' + scalarValue;
        }
        return clause;
    };
    for (const group of whereGroups) {
        if (!group || !group.length) continue;
        s += '\nwhere ' + group.map(stringifyWhere).join(' or ');
    }
    if (query.groupBy) s += '\ngroup by ' + query.groupBy;
    if (query.sort) s += '\nsort ' + query.sort.field + (query.sort.desc ? ' desc' : '');
    if (query.limit) s += '\nlimit ' + query.limit;
    return s;
}

module.exports = {
    parseSingleViewLine,
    parseSingleViewBlock,
    parseAllViewQueries,
    parseViewQuery,
    runQuery,
    buildQueryString,
    clearBodyCache
};
