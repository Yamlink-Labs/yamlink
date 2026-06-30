'use strict';

const { normaliseDateInput, getTodayIsoLocal, addDaysIso } = require('../core/date');

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

/** @param {unknown} rawValue @returns {ValueKind} */
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

/** @param {unknown} rawValue @returns {ScalarValue|null} */
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

/** @param {unknown} rawValue @returns {ScalarValue} */
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

/**
 * @param {string} text
 * @returns {ParsedCondition|null}
 */
function parseCondition(text) {
    text = text.trim();
    if (!text) return null;

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

module.exports = {
    TASK_PRESETS,
    classifyScalarValue,
    resolveQueryFunctionValue,
    parseScalarQueryValue,
    compareScalarValues,
    normaliseField,
    resolveSimpleViewAlias,
    parseCondition,
    parseWhereGroup
};
