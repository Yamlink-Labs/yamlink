'use strict';

const { normaliseDateInput, getTodayIsoLocal, addDaysIso } = require('../core/date');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {'string'|'number'|'date'|'boolean'|'relation'} ValueKind
 */

/**
 * @typedef {{ value: string, valueKind: ValueKind, valueSource: string|null }} ScalarValue
 */

/**
 * @typedef {{
 *   field: string,
 *   op: 'eq'|'neq'|'contains'|'empty'|'exists'|'gte'|'lte'|'gt'|'lt'|'in',
 *   value: string,
 *   valueKind: ValueKind,
 *   valueSource?: string|null,
 *   values?: string[],
 *   tagShorthand?: boolean,
 *   warning?: string
 * }} ParsedCondition
 */

/**
 * @typedef {{ field: string, desc: boolean }} SortSpec
 */

/**
 * @typedef {{
 *   type: string,
 *   incoming: boolean,
 *   via: string|null,
 *   select: string[]|null,
 *   wheres: ParsedCondition[],
 *   whereGroups: ParsedCondition[][],
 *   where: ParsedCondition|null,
 *   sort: SortSpec|null,
 *   limit: number|null,
 *   label: string|null,
 *   preset: string|null,
 *   shorthand: string|null,
 *   groupBy: string|null,
 *   parseWarnings: string[]
 * }} ParsedQuery
 */

/**
 * @typedef {{
 *   id: string,
 *   fields: Record<string, any>,
 *   filePath: string|null,
 *   nodeType: string,
 *   viaField?: string,
 *   done?: boolean,
 *   date?: string
 * }} QueryRow
 */

/**
 * @typedef {{ key: string, count: number, rows: QueryRow[] }} GroupResult
 */

/**
 * @typedef {{
 *   success: boolean,
 *   rows: QueryRow[],
 *   columns: string[],
 *   types: string[],
 *   warnings: string[],
 *   error: string|null,
 *   groups?: GroupResult[],
 *   groupBy?: string
 * }} QueryResult
 */

const TASK_PRESETS = new Set(['today', 'upcoming', 'calendar', 'agenda', 'open', 'done', 'undated', 'overdue']);

/**
 * @param {string|number} rawValue
 * @returns {ValueKind}
 */
function classifyScalarValue(rawValue) {
    const value = String(rawValue ?? '').trim();
    if (!value) return 'string';
    if (resolveQueryFunctionValue(value)) return 'date';
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return 'number';
    if (value === 'true' || value === 'false') return 'boolean';
    if (normaliseDateInput(value)) return 'date';
    return 'string';
}

/**
 * @param {string|number} rawValue
 * @returns {number|null}
 */
function parseSignedInteger(rawValue) {
    const text = String(rawValue ?? '').trim();
    if (!/^-?\d+$/.test(text)) return null;
    return Number(text);
}

/**
 * @param {string|number} rawValue
 * @returns {ScalarValue|null}
 */
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

/**
 * @param {string|number} rawValue
 * @returns {ScalarValue}
 */
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

/**
 * @param {string} left
 * @param {string} right
 * @param {ValueKind} [kind]
 * @returns {number}
 */
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

/**
 * @param {string} raw
 * @returns {string}
 */
function normaliseField(raw) {
    const f = raw.trim().toLowerCase();
    return f === '*' ? 'any' : f;
}

/**
 * @param {string} token
 * @returns {{ type: string, preset: string|null, shorthand: string }|null}
 */
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

/**
 * @param {string} text
 * @returns {ParsedCondition|null}
 */
function parseCondition(text) {
    text = text.trim();
    if (!text) return null;

    // #tag shorthand → __yamlink_tags contains <tag>
    const hashtagShorthand = text.match(/^#([A-Za-z][\w-]*)$/i);
    if (hashtagShorthand) {
        return { field: '__yamlink_tags', op: 'contains', value: hashtagShorthand[1].toLowerCase(), valueKind: 'string', tagShorthand: true };
    }

    const containsQuoted = text.match(/^([\w.-]+|\*)\s+contains\s+["'](.+?)["']$/i);
    if (containsQuoted) {
        return {
            field: normaliseField(containsQuoted[1]),
            op: 'contains',
            value: containsQuoted[2].trim().toLowerCase(),
            valueKind: 'string'
        };
    }

    const containsPlain = text.match(/^([\w.-]+|\*)\s+contains\s+(.+)$/i);
    if (containsPlain) {
        return {
            field: normaliseField(containsPlain[1]),
            op: 'contains',
            value: containsPlain[2].trim().toLowerCase(),
            valueKind: 'string'
        };
    }

    // empty / exists predicates: "field is empty", "field is not empty", "field exists"
    const emptyExistsMatch = text.match(/^([\w.-]+|\*)\s+is\s+(empty|not\s+empty)$/i);
    if (emptyExistsMatch) {
        const op = /^not\s+empty$/i.test(emptyExistsMatch[2].trim()) ? 'exists' : 'empty';
        return { field: normaliseField(emptyExistsMatch[1]), op, value: '', valueKind: 'string' };
    }
    const existsMatch = text.match(/^([\w.-]+|\*)\s+exists$/i);
    if (existsMatch) {
        return { field: normaliseField(existsMatch[1]), op: 'exists', value: '', valueKind: 'string' };
    }

    const eqRel = text.match(/^([\w.-]+)\s*(?:=|\bis\b)\s*\[\[([^\]]+)\]\]$/i);
    if (eqRel) {
        return {
            field: eqRel[1].toLowerCase(),
            op: 'eq',
            value: eqRel[2].trim().toLowerCase(),
            valueKind: 'relation'
        };
    }

    // != with relation value
    const neqRel = text.match(/^([\w.-]+)\s*!=\s*\[\[([^\]]+)\]\]$/i);
    if (neqRel) {
        return { field: neqRel[1].toLowerCase(), op: 'neq', value: neqRel[2].trim().toLowerCase(), valueKind: 'relation' };
    }

    const compareOp = text.match(/^([\w.-]+)\s*(>=|<=|>|<)\s*(.+)$/i);
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
    const neqScalar = text.match(/^([\w.-]+)\s*!=\s*(.+)$/i);
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

    const eqScalar = text.match(/^([\w.-]+)\s*(?:=|\bis\b)\s*(.+)$/i);
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

/**
 * @param {string} text
 * @returns {{ conditions: ParsedCondition[], warning: string|null }|null}
 */
function parseWhereGroup(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const parts = raw
        .split(/\s+or\s+(?=(?:[\w*.-]+\s+(?:contains\b|=|!=|>=|<=|>|<|\bis\b|\bexists\b)|#[A-Za-z][\w-]*))/i)
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

/**
 * @param {string[]} lines
 * @returns {ParsedQuery|null}
 */
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
    const selectMatch = clauseText.match(/\bselect\s+([\w,\s.-]+?)(?=\s+where\b|\s+sort\b|\s+limit\b|\s+via\b|\s+group\b|$)/i);
    if (selectMatch) {
        select = selectMatch[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (select.length === 0) select = null;
    }

    let sort = null;
    const sortMatch = clauseText.match(/\bsort\s+([\w.-]+)(\s+desc)?(?=\s+(?:limit|group)\b|$)/i);
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
        const parts = condText.split(/\s+and\s+(?=(?:[\w*.-]+\s+(?:contains\b|=|!=|>=|<=|>|<|\bis\b|\bexists\b)|#[A-Za-z][\w-]*))/i);
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

/**
 * @param {string} text
 * @returns {ParsedQuery[]|null}
 */
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

/** @param {string} line @returns {ParsedQuery|null} */
function parseSingleViewLine(line) { return parseSingleViewBlock([line]); }

/** @param {string} text @returns {ParsedQuery|null} */
function parseViewQuery(text) { const all = parseAllViewQueries(text); return all ? all[0] : null; }

/**
 * @param {ParsedQuery} query
 * @returns {string}
 */
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
    TASK_PRESETS,
    classifyScalarValue,
    resolveQueryFunctionValue,
    parseScalarQueryValue,
    compareScalarValues,
    normaliseField,
    parseCondition,
    parseWhereGroup,
    parseSingleViewBlock,
    parseAllViewQueries,
    parseSingleViewLine,
    parseViewQuery,
    buildQueryString
};
