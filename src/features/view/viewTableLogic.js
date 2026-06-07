'use strict';

const { getSchema } = require('../../registries/schemaRegistry');
const { isDateLike } = require('../../core/date');
const { buildQueryString } = require('../../engine/query');

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function repairUiText(text) {
    return String(text ?? '')
        .replace(/Â·/g, '-')
        .replace(/â€¢/g, '&bull;')
        .replace(/â†©/g, '&#8617;')
        .replace(/â€"/g, '-')
        .replace(/â€™/g, "'")
        .replace(/â€¦/g, '...');
}

function normaliseTableDisplayValue(kind, value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (kind === 'date') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString().slice(0, 10);
        }
    }
    if (kind === 'boolean') {
        return raw.toLowerCase() === 'true' ? 'true' : 'false';
    }
    return raw;
}

function normalizeSavedSort(sort) {
    if (!sort || typeof sort !== 'object') return null;
    const field = String(sort.field || sort.col || '').trim();
    if (!field) return null;
    const direction = sort.direction === 'desc' || sort.asc === false ? 'desc' : 'asc';
    return { field, direction };
}

function getRowFieldValue(row, field) {
    if (!row) return '';
    return field === 'id' ? row.id : String(row.fields?.[field] ?? '');
}

function applySavedColumnOrder(columns, savedOrder) {
    if (!Array.isArray(savedOrder) || savedOrder.length === 0) return columns;
    const ordered = [];
    const seen = new Set();
    for (const col of savedOrder) {
        if (columns.includes(col) && !seen.has(col)) {
            ordered.push(col);
            seen.add(col);
        }
    }
    for (const col of columns) {
        if (!seen.has(col)) ordered.push(col);
    }
    return ordered;
}

function analyseColumns(rows, columns, query) {
    const schema = query && query.type && query.type !== '*' && query.type !== 'tasks'
        ? getSchema(query.type)
        : null;
    const meta = {};
    for (const col of columns) {
        if (col === 'id') {
            meta[col] = { kind: 'id' };
            continue;
        }
        const schemaField = schema?.fields?.[col] || null;
        const rawValues = rows.map(r => String(r.fields[col] ?? '').trim()).filter(Boolean);
        const unique = [...new Set(rawValues)];
        const schemaOptions = Array.isArray(schemaField?.options) ? schemaField.options : [];
        const isRelation = schemaField?.type === 'relation' || unique.some(v => /\[\[[^\]]+\]\]/.test(v));
        const isBoolean = schemaField?.type === 'boolean' || (unique.length > 0 && unique.every(v => ['true', 'false'].includes(v.toLowerCase())));
        const isNumber = schemaField?.type === 'number' || (unique.length > 0 && unique.every(v => /^-?\d+(?:\.\d+)?$/.test(v)));
        const isDate = schemaField?.type === 'date' || (unique.length > 0 && unique.every(v => isDateLike(v)));
        const isDropdown = schemaOptions.length > 0 || (!isRelation && !isBoolean && !isNumber && !isDate && unique.length >= 2 && unique.length <= 6 && unique.every(v => v.length <= 30 && !/^\d+(?:\.\d+)?$/.test(v)));
        meta[col] = {
            kind: isRelation ? 'relation' : isBoolean ? 'boolean' : isNumber ? 'number' : isDate ? 'date' : isDropdown ? 'dropdown' : 'text',
            options: schemaOptions.length > 0 ? schemaOptions : (isDropdown ? unique : [])
        };
    }
    return meta;
}

function collectColumnFilterValues(rows, field, kind) {
    return Array.from(new Set(rows
        .map((row) => normaliseTableDisplayValue(kind, getRowFieldValue(row, field)))
        .filter((value) => String(value || '').trim())))
        .sort((a, b) => String(a).localeCompare(String(b)));
}

function sortRowsForSavedSort(rows, sort, meta) {
    const savedSort = normalizeSavedSort(sort);
    if (!savedSort) return rows.slice();
    const kind = meta?.[savedSort.field]?.kind || 'text';
    return rows.slice().sort((a, b) => {
        const av = normaliseTableDisplayValue(kind, getRowFieldValue(a, savedSort.field));
        const bv = normaliseTableDisplayValue(kind, getRowFieldValue(b, savedSort.field));
        if (kind === 'number') {
            return savedSort.direction === 'asc'
                ? Number(av || 0) - Number(bv || 0)
                : Number(bv || 0) - Number(av || 0);
        }
        const as = String(av || '').toLowerCase();
        const bs = String(bv || '').toLowerCase();
        return savedSort.direction === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
}

function getTaskStatusPresentation(row, todayIso) {
    const rawDone = String(row?.fields?.done ?? '').toLowerCase();
    const isDone = rawDone === 'true';
    if (isDone) {
        return { key: 'true', label: 'Done', sortValue: 'done', filterValue: 'done', className: 'true' };
    }
    const due = normaliseTableDisplayValue('date', row?.fields?.date ?? '');
    if (due && todayIso) {
        if (due < todayIso) {
            return { key: 'overdue', label: 'Overdue', sortValue: 'overdue', filterValue: 'overdue', className: 'overdue' };
        }
        if (due === todayIso) {
            return { key: 'due-today', label: 'Due today', sortValue: 'due-today', filterValue: 'due-today', className: 'due-today' };
        }
        const daysDiff = Math.round((new Date(due + 'T00:00:00').getTime() - new Date(todayIso + 'T00:00:00').getTime()) / 86400000);
        if (daysDiff >= 1 && daysDiff <= 3) {
            return { key: 'due-soon', label: 'Due soon', sortValue: 'due-soon', filterValue: 'due-soon', className: 'due-soon' };
        }
    }
    return { key: 'false', label: 'Not done', sortValue: 'not done', filterValue: 'not done', className: 'pending' };
}

function buildQuickFieldList(columns) {
    return (Array.isArray(columns) ? columns : [])
        .filter((col) => col && col !== 'id')
        .slice(0, 4);
}

function classifyQueryWarnings(warnings) {
    const items = Array.isArray(warnings)
        ? warnings.map(w => String(w || '').trim()).filter(Boolean)
        : [];
    if (items.length === 0) {
        return { severity: 'none', primary: '', items: [], tip: '' };
    }

    const lower = items.map(item => item.toLowerCase());
    const hasCrossFieldOr = lower.some(item => item.includes('cross-field or'));
    const hasUnsupported = lower.some(item => item.includes('not supported'));
    const hasParseIssue = lower.some(item =>
        item.includes('invalid')
        || item.includes('parse')
        || item.includes('syntax')
        || item.includes('unknown operator')
        || item.includes('could not')
    );

    if (hasCrossFieldOr) {
        return {
            severity: 'query-issue',
            primary: 'Yamlink does not support cross-field `or` yet.',
            items,
            tip: 'Keep each view to one field family, use multiple `where` lines with `and`, or split the logic into separate views.'
        };
    }

    if (hasUnsupported || hasParseIssue) {
        return {
            severity: 'query-issue',
            primary: 'Yamlink only understood part of this view.',
            items,
            tip: 'Use the simple one-line form for quick filters, or the multi-line power-user form with `select`, `where`, `sort`, and `limit`.'
        };
    }

    return {
        severity: 'query-warning',
        primary: items[0],
        items,
        tip: 'Review the query clauses and try a simpler filter first.'
    };
}

function buildTableEmptyStateTitle(query, warnings) {
    const warningState = classifyQueryWarnings(warnings);
    if (warningState.severity === 'query-issue') return 'This query needs attention.';
    if (warningState.severity === 'query-warning') return 'This view needs a quick query check.';
    const wheres = query.wheres && query.wheres.length > 0 ? query.wheres : (query.where ? [query.where] : []);
    if (wheres.some(cond => cond.field === 'id')) {
        return 'The target note was not found in this view.';
    }
    if (query.incoming) {
        return 'No notes link here yet.';
    }
    if (query.type === 'tasks') {
        return 'No tasks matched this view.';
    }
    return 'No rows matched this view.';
}

function buildEmptyStateHint(query, warnings) {
    const warningState = classifyQueryWarnings(warnings);
    if (warningState.severity === 'query-issue') {
        return `${warningState.primary} ${warningState.tip}`;
    }
    if (warningState.severity === 'query-warning') {
        return warningState.primary;
    }
    const wheres = query.wheres && query.wheres.length > 0 ? query.wheres : (query.where ? [query.where] : []);
    if (wheres.some(cond => cond.field === 'id')) {
        return 'Check that the target note is saved and the id matches exactly.';
    }
    return `Try a broader query first, for example: ${buildQueryString({ ...query, type: '*', wheres: [], where: null })}`;
}

module.exports = {
    esc,
    repairUiText,
    normaliseTableDisplayValue,
    normalizeSavedSort,
    getRowFieldValue,
    applySavedColumnOrder,
    analyseColumns,
    collectColumnFilterValues,
    sortRowsForSavedSort,
    getTaskStatusPresentation,
    buildQuickFieldList,
    classifyQueryWarnings,
    buildTableEmptyStateTitle,
    buildEmptyStateHint
};
