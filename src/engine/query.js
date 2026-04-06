// src/engine/query.js
// Pure query engine — no VS Code, no fs writes, no HTML
// Importable by extension, desktop app, or tests

const fs = require('fs');
const { getIndex, getFieldsCache } = require('../core/index');
const { getBacklinks } = require('../core/graph');
const { buildTaskRows } = require('../core/tasks');
const { normaliseDateInput, getTodayIsoLocal, addDaysIso } = require('../core/date');

const BODY_CACHE_MAX = 200;
const bodyCache = new Map();
const TASK_PRESETS = new Set(['today', 'upcoming', 'calendar', 'agenda']);

function clearBodyCache() {
    bodyCache.clear();
}

function readBody(filePath) {
    if (!filePath) return null;

    let mtime = null;
    try { mtime = fs.statSync(filePath).mtimeMs; } catch (e) { return null; }

    const cached = bodyCache.get(filePath);
    if (cached && cached.mtime === mtime) return cached.body;

    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) { return null; }
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

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

function parseCondition(text) {
    text = text.trim();
    if (!text) return null;

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

    const eqRel = text.match(/^([\w-]+)\s*(?:=|\bis\b)\s*\[\[([^\]]+)\]\]$/i);
    if (eqRel) {
        return {
            field: eqRel[1].toLowerCase(),
            op: 'eq',
            value: eqRel[2].trim().toLowerCase(),
            valueKind: 'relation'
        };
    }

    const eqScalar = text.match(/^([\w-]+)\s*(?:=|\bis\b)\s*(.+)$/i);
    if (eqScalar) {
        let rawValue = eqScalar[2].trim();
        if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
            rawValue = rawValue.slice(1, -1);
        }
        return {
            field: eqScalar[1].toLowerCase(),
            op: 'eq',
            value: rawValue.toLowerCase(),
            valueKind: /^\d+(?:\.\d+)?$/.test(rawValue) ? 'number' : (rawValue === 'true' || rawValue === 'false' ? 'boolean' : 'string')
        };
    }

    return null;
}

function normaliseField(raw) {
    const f = raw.trim().toLowerCase();
    return f === '*' ? 'any' : f;
}

function resolveSimpleViewAlias(token) {
    const lower = String(token || '').toLowerCase();
    if (lower === 'task') return { type: 'tasks', preset: null, shorthand: 'task' };
    if (lower === 'tasks') return { type: 'tasks', preset: null, shorthand: 'tasks' };
    if (TASK_PRESETS.has(lower)) return { type: 'tasks', preset: lower === 'agenda' ? 'upcoming' : lower, shorthand: lower };
    return null;
}

function applyTaskPreset(row, preset, todayIso) {
    const date = String(row.date || row.fields?.date || '').trim();
    if (!preset) return true;
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
    const clean = raw.replace(/^\[\[|\]\]$/g, '').trim();
    return clean === cond.value || raw === cond.value;
}

function levenshtein(a, b) {
    const left = String(a ?? '');
    const right = String(b ?? '');
    const dp = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
    for (let i = 0; i <= left.length; i++) dp[i][0] = i;
    for (let j = 0; j <= right.length; j++) dp[0][j] = j;
    for (let i = 1; i <= left.length; i++) {
        for (let j = 1; j <= right.length; j++) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }
    return dp[left.length][right.length];
}

function closestTypeMatch(type, fieldCache) {
    const candidates = [...new Set(
        [...fieldCache.values()]
            .map(fields => String(fields.type || '').trim().toLowerCase())
            .filter(Boolean)
    )];
    if (candidates.length === 0) return null;
    const ranked = candidates
        .map(candidate => ({ candidate, distance: levenshtein(type, candidate) }))
        .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate));
    return ranked[0].distance <= 3 ? ranked[0].candidate : null;
}

function hasTypeMatch(type, fieldCache) {
    if (!type || type === '*' || type === 'tasks') return true;
    for (const fields of fieldCache.values()) {
        if (String(fields.type || '').trim().toLowerCase() === type) return true;
    }
    return false;
}

function addZeroResultWarnings(query, rows, warnings, index, fieldCache) {
    if (rows.length > 0) return;

    if (index.size === 0) {
        warnings.push('No indexed nodes found. Add id: fields to your Markdown files and save them to index.');
        return;
    }

    if (query.incoming) {
        if (query.type !== '*' && !hasTypeMatch(query.type, fieldCache)) {
            const suggestion = closestTypeMatch(query.type, fieldCache);
            if (suggestion && suggestion !== query.type) {
                warnings.push(`No nodes matched incoming type "${query.type}". Did you mean "${suggestion}"?`);
            } else {
                warnings.push(`No nodes matched incoming type "${query.type}". Check the type: field in your notes.`);
            }
            return;
        }
        if (query.via && query.type !== '*') {
            warnings.push(`No "${query.type}" nodes link to this note via the "${query.via}" field.`);
        } else if (query.via) {
            warnings.push(`No nodes link to this note via the "${query.via}" field.`);
        } else if (query.type !== '*') {
            warnings.push(`No "${query.type}" nodes link to this note yet.`);
        } else {
            warnings.push('No nodes link to this note yet. Add [[this-note-id]] to another note\'s frontmatter to create a connection.');
        }
        return;
    }

    if (query.type !== '*' && query.type !== 'tasks') {
        const suggestion = closestTypeMatch(query.type, fieldCache);
        if (suggestion && suggestion !== query.type) {
            warnings.push(`No nodes matched type "${query.type}". Did you mean "${suggestion}"?`);
        } else {
            warnings.push(`No nodes matched type "${query.type}". Check the type: field in your notes.`);
        }
    }

    const wheres = query.wheres && query.wheres.length > 0 ? query.wheres : (query.where ? [query.where] : []);
    for (const cond of wheres) {
        if (cond.op !== 'eq') continue;
        if (cond.field === 'id' && !index.has(cond.value)) {
            warnings.push(`No indexed node with id "${cond.value}". Save that note first or check the id.`);
        }
        if (cond.valueKind === 'string' && normaliseDateInput(cond.value) && cond.field !== 'id') {
            warnings.push(`Date filters work best when stored values normalise to YYYY-MM-DD.`);
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
    const selectMatch = clauseText.match(/\bselect\s+([\w,\s-]+?)(?=\s+where\b|\s+sort\b|\s+limit\b|\s+via\b|$)/i);
    if (selectMatch) {
        select = selectMatch[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (select.length === 0) select = null;
    }

    let sort = null;
    const sortMatch = clauseText.match(/\bsort\s+([\w-]+)(\s+desc)?(?=\s+limit\b|$)/i);
    if (sortMatch) sort = { field: sortMatch[1].toLowerCase(), desc: !!sortMatch[2] };

    let limit = null;
    const limitMatch = clauseText.match(/\blimit\s+(\d+)/i);
    if (limitMatch) limit = parseInt(limitMatch[1], 10);

    let via = null;
    const viaMatch = clauseText.match(/\bvia\s+([\w-]+)/i);
    if (viaMatch) via = viaMatch[1].toLowerCase();

    const wheres = [];
    const whereBlocks = clauseText.match(/\bwhere\s+(?:(?!\b(?:where|sort|limit|select|via)\b).)+/gi) || [];
    for (const block of whereBlocks) {
        const condText = block.replace(/^where\s+/i, '').trim();
        const parts = condText.split(/\s+and\s+(?=[\w*-]+\s+(?:=|contains\s))/i);
        for (const part of parts) {
            const cond = parseCondition(part.trim());
            if (cond) wheres.push(cond);
        }
    }

    return { type, incoming, via, select, wheres, where: wheres[0] ?? null, sort, limit, label, preset, shorthand };
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
                if (/^(select|where|sort|limit|via)\b/i.test(next)) {
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
    for (const w of wheres) {
        if (w.op === 'eq' && !w.value) warnings.push(`where ${w.field} = (missing value) — condition skipped`);
    }
    const validWheres = wheres.filter(w => w.value);
    const rows = [];
    const fieldCache = getFieldsCache();
    const needsBody = validWheres.some(w => w.field === 'body' || w.field === 'any');
    const index = getIndex();
    const todayIso = getTodayIsoLocal();

    try {
        if (query.type === 'tasks') {
            const taskRows = buildTaskRows(index);
            for (const taskRow of taskRows) {
                if (!applyTaskPreset(taskRow, query.preset, todayIso)) continue;
                if (validWheres.length > 0) {
                    const passes = validWheres.every(cond => matchesCondition(cond, taskRow.fields, taskRow.filePath));
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
                if (validWheres.length > 0) {
                    const passes = validWheres.every(cond => matchesCondition(cond, fields, needsBody ? filePath : null));
                    if (!passes) continue;
                }
                rows.push({ id, fields, filePath, nodeType });
            }
        }
    } catch (e) {
        return { success: false, rows: [], columns: [], types: [], warnings, error: `Runtime error: ${e.message}` };
    }

    addZeroResultWarnings(query, rows, warnings, index, fieldCache);
    return finaliseRows(query, rows, warnings);
}

function finaliseRows(query, rows, warnings) {
    if (query.sort) {
        const { field, desc } = query.sort;
        rows.sort((a, b) => {
            const av = String(a.fields[field] == null ? '' : a.fields[field] || a.id || '').toLowerCase();
            const bv = String(b.fields[field] == null ? '' : b.fields[field] || b.id || '').toLowerCase();
            return desc ? bv.localeCompare(av) : av.localeCompare(bv);
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

    if (query.limit && query.limit > 0) rows.splice(query.limit);

    let columns;
    if (query.select && query.select.length > 0) {
        columns = ['id', ...query.select.filter(c => c !== 'id')];
    } else {
        const fieldSet = new Set();
        for (const row of rows) for (const key of Object.keys(row.fields)) if (key !== 'id') fieldSet.add(key);
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
    if (query.via) s += ' via ' + query.via;
    if (query.select) s += '\nselect ' + query.select.join(', ');
    const wheres = query.wheres && query.wheres.length > 0 ? query.wheres : (query.where ? [query.where] : []);
    for (const w of wheres) {
        s += '\nwhere ' + w.field + ' ';
        if (w.op === 'contains') {
            s += 'contains ' + w.value;
        } else if (w.valueKind === 'relation') {
            s += '= [[' + w.value + ']]';
        } else if (w.valueKind === 'string' && /\s/.test(w.value)) {
            s += '= "' + w.value + '"';
        } else {
            s += '= ' + w.value;
        }
    }
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
