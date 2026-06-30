'use strict';

const { parseSingleViewBlock, buildQueryString, runQuery } = require('../engine/query');
const { getFieldsCache } = require('../core/indexService');
const { getTypes: getRegisteredTypes } = require('../registries/typeRegistry');
const { collectFieldCandidates, collectRelationFieldCandidates } = require('../intelligence/queryDiagnostics');
const {
    buildTypeViewQuery,
    buildIncomingViewQuery,
    defaultSelectClauseForType
} = require('./viewBuilderCore');

const TASK_PRESETS = [
    'tasks',
    'open-tasks',
    'done-tasks',
    'overdue',
    'undated-tasks',
    'calendar',
    'today',
    'upcoming'
];
const RENDER_LAYOUTS = ['table', 'matrix', 'bar', 'scatter'];

function uniqueSorted(values = []) {
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
}

function uniqueInOrder(values = []) {
    const out = [];
    const seen = new Set();
    for (const value of values) {
        if (!value || seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out;
}

function deriveKnownTypes(fieldsCache = getFieldsCache()) {
    const registryTypes = Array.from(getRegisteredTypes ? getRegisteredTypes() : []);
    const vaultTypes = [];
    for (const fields of fieldsCache.values()) {
        const type = String(fields?.type || '').trim().toLowerCase();
        if (type) vaultTypes.push(type);
    }
    return uniqueSorted([...registryTypes, ...vaultTypes]);
}

function normalizeRelationValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('[[') && raw.endsWith(']]')) return raw;
    return raw;
}

function normalizeBuilderState(input = {}, options = {}) {
    const knownTypes = options.knownTypes || deriveKnownTypes(options.fieldsCache);
    const normalized = {
        mode: ['table', 'incoming', 'tasks'].includes(input.mode) ? input.mode : 'table',
        type: String(input.type || '').trim().toLowerCase() || (knownTypes[0] || '*'),
        label: String(input.label || '').trim(),
        selectMode: ['smart', 'all', 'none', 'custom'].includes(input.selectMode) ? input.selectMode : 'smart',
        selectFields: Array.isArray(input.selectFields) ? uniqueInOrder(input.selectFields.map((field) => String(field || '').trim().toLowerCase())) : [],
        whereField: String(input.whereField || '').trim().toLowerCase(),
        whereOperator: String(input.whereOperator || '=').trim() || '=',
        whereValue: String(input.whereValue || '').trim(),
        sortField: String(input.sortField || '').trim().toLowerCase(),
        sortDirection: String(input.sortDirection || 'asc').trim().toLowerCase() === 'desc' ? 'desc' : 'asc',
        limit: Number.isInteger(input.limit) ? input.limit : Number.parseInt(input.limit, 10) || 0,
        viaField: String(input.viaField || '*').trim().toLowerCase() || '*',
        taskPreset: TASK_PRESETS.includes(input.taskPreset) ? input.taskPreset : 'tasks',
        groupBy: String(input.groupBy || '').trim().toLowerCase(),
        renderLayout: RENDER_LAYOUTS.includes(input.renderLayout) ? input.renderLayout : 'table',
        matrixColType: String(input.matrixColType || '').trim().toLowerCase(),
        scatterX: String(input.scatterX || '').trim().toLowerCase(),
        scatterY: String(input.scatterY || '').trim().toLowerCase(),
        barGroupBy: String(input.barGroupBy || '').trim().toLowerCase()
    };
    if (normalized.type !== '*' && !knownTypes.includes(normalized.type) && normalized.mode !== 'tasks') {
        normalized.type = knownTypes[0] || '*';
    }
    if (normalized.limit < 0) normalized.limit = 0;
    return normalized;
}

function buildStateFromQuery(query, options = {}) {
    const fieldsCache = options.fieldsCache || getFieldsCache();
    const knownTypes = options.knownTypes || deriveKnownTypes(fieldsCache);
    if (!query) {
        return normalizeBuilderState({
            mode: 'table',
            type: options.defaultType || knownTypes[0] || '*',
            selectMode: 'smart'
        }, { fieldsCache, knownTypes });
    }

    if (query.type === 'tasks' && !query.incoming) {
        return normalizeBuilderState({
            mode: 'tasks',
            taskPreset: query.preset || query.shorthand || 'tasks',
            label: query.label || '',
            sortField: query.sort?.field || '',
            sortDirection: query.sort?.desc ? 'desc' : 'asc',
            limit: query.limit || 0
        }, { fieldsCache, knownTypes });
    }

    const selectFields = Array.isArray(query.select) ? query.select.map((field) => String(field || '').trim().toLowerCase()).filter(Boolean) : [];
    let selectMode = 'smart';
    if (!selectFields.length) selectMode = 'none';
    else if (selectFields.length === 1 && selectFields[0] === '*') selectMode = 'all';
    else {
        const smartText = buildTypeViewQuery(query.type, 'smart');
        const smartParsed = parseSingleViewBlock(smartText.split('\n'));
        const smartFields = Array.isArray(smartParsed?.select) ? smartParsed.select : [];
        selectMode = JSON.stringify(selectFields) === JSON.stringify(smartFields) ? 'smart' : 'custom';
    }

    return normalizeBuilderState({
        mode: query.incoming ? 'incoming' : 'table',
        type: query.type || options.defaultType || knownTypes[0] || '*',
        label: query.label || '',
        selectMode,
        selectFields,
        whereField: query.where?.field || '',
        whereOperator: query.where?.op === 'contains' ? 'contains' : '=',
        whereValue: query.where
            ? (query.where.valueKind === 'relation' ? `[[${query.where.value}]]` : String(query.where.valueSource || query.where.value || ''))
            : '',
        sortField: query.sort?.field || '',
        sortDirection: query.sort?.desc ? 'desc' : 'asc',
        limit: query.limit || 0,
        viaField: query.via || '*',
        groupBy: query.groupBy || '',
        renderLayout: 'table'
    }, { fieldsCache, knownTypes });
}

function buildRenderLayoutSummary(parsed, result, options = {}) {
    const fieldsCache = options.fieldsCache || getFieldsCache();
    const knownTypes = options.knownTypes || deriveKnownTypes(fieldsCache);
    const rowType = String(parsed?.type || '').trim().toLowerCase();
    const columns = Array.isArray(result?.columns) ? result.columns : [];
    const hasNumericOrDate = columns.some((field) => {
        if (!field || field === 'id') return false;
        const values = [];
        for (const fields of fieldsCache.values()) {
            const type = String(fields?.type || '').trim().toLowerCase();
            if (rowType && rowType !== '*' && rowType !== 'tasks' && type && type !== rowType) continue;
            const raw = fields?.[field];
            if (raw === undefined || raw === null || raw === '') continue;
            values.push(raw);
            if (values.length >= 8) break;
        }
        const allNumber = values.length > 0 && values.every((value) => Number.isFinite(Number(value)));
        const allDate = values.length > 0 && values.every((value) => Number.isFinite(Date.parse(String(value))));
        return allNumber || allDate;
    });
    const matrixColumnTypes = rowType && rowType !== 'tasks'
        ? knownTypes.filter((type) => type !== rowType)
        : [];
    return {
        available: [
            { key: 'table', label: 'Table', enabled: true, detail: 'Default editable rows and columns.' },
            { key: 'matrix', label: 'Matrix', enabled: rowType !== 'tasks', detail: rowType === 'tasks' ? 'Matrix is best for note-to-note relation grids.' : 'Compare one note type against another.' },
            { key: 'bar', label: 'Bar', enabled: columns.some((field) => field !== 'id'), detail: 'Bucket records by a selected field.' },
            { key: 'scatter', label: 'Scatter', enabled: hasNumericOrDate, detail: hasNumericOrDate ? 'Plot numeric or date fields against each other.' : 'Needs numeric or date fields in the result.' }
        ],
        matrixColumnTypes,
        scatterFields: columns.filter((field) => field !== 'id'),
        barFields: columns.filter((field) => field !== 'id'),
        hasNumericOrDate
    };
}

function buildQueryTextFromState(input, options = {}) {
    const state = normalizeBuilderState(input, options);
    let queryText = '';

    if (state.mode === 'tasks') {
        queryText = `!view ${state.taskPreset}`;
        const parsed = parseSingleViewBlock(queryText.split('\n'));
        if (parsed) {
            parsed.label = state.label || null;
            if (state.sortField) parsed.sort = { field: state.sortField, desc: state.sortDirection === 'desc' };
            if (state.limit > 0) parsed.limit = state.limit;
            queryText = buildQueryString(parsed);
        }
        return queryText;
    }

    if (state.mode === 'incoming') {
        queryText = buildIncomingViewQuery(state.type || '*', state.viaField || '*', {
            label: state.label,
            sortField: state.sortField,
            sortDirection: state.sortDirection,
            limit: state.limit > 0 ? state.limit : 0
        });
    } else {
        const selectMode = state.selectMode === 'custom'
            ? 'none'
            : state.selectMode;
        queryText = buildTypeViewQuery(state.type || '*', selectMode, {
            label: state.label,
            sortField: state.sortField,
            sortDirection: state.sortDirection,
            limit: state.limit > 0 ? state.limit : 0
        });

        let parsed = parseSingleViewBlock(queryText.split('\n'));
        if (!parsed) return queryText;
        if (state.selectMode === 'custom') {
            parsed.select = state.selectFields.length ? [...state.selectFields] : null;
        } else if (state.selectMode === 'none') {
            parsed.select = null;
        } else if (state.selectMode === 'all') {
            parsed.select = ['*'];
        } else if (state.selectMode === 'smart' && state.type !== '*') {
            parsed.select = parseSingleViewBlock(buildTypeViewQuery(state.type, 'smart').split('\n'))?.select || null;
        }
        parsed.groupBy = state.groupBy || null;
        if (state.whereField && state.whereValue) {
            const relationValue = normalizeRelationValue(state.whereValue);
            const isRelation = relationValue.startsWith('[[') && relationValue.endsWith(']]');
            const cleanValue = isRelation ? relationValue.slice(2, -2).trim() : state.whereValue.trim();
            parsed.whereGroups = [[{
                field: state.whereField,
                op: state.whereOperator === 'contains' ? 'contains' : 'eq',
                value: cleanValue,
                valueSource: state.whereValue.trim(),
                valueKind: isRelation ? 'relation' : 'string'
            }]];
            parsed.wheres = [...parsed.whereGroups[0]];
            parsed.where = parsed.wheres[0];
        } else {
            parsed.whereGroups = [];
            parsed.wheres = [];
            parsed.where = null;
        }
        queryText = buildQueryString(parsed);
    }

    return queryText;
}

function buildPreviewFromState(state, options = {}) {
    const queryText = buildQueryTextFromState(state, options);
    const parsed = parseSingleViewBlock(queryText.split('\n'));
    if (!parsed) {
        return {
            queryText,
            summary: { ok: false, title: 'Invalid query', detail: 'The builder state could not be converted into a valid !view block.' }
        };
    }
    const result = runQuery(parsed, options.contextNodeId || null);
    if (!result.success) {
        return {
            queryText,
            parsed,
            summary: {
                ok: false,
                title: 'Query needs context',
                detail: String(result.error || 'The query could not run.'),
                warnings: Array.isArray(result.warnings) ? result.warnings : []
            }
        };
    }
    return {
        queryText,
        parsed,
        summary: {
            ok: true,
            title: `${result.rows.length} row${result.rows.length === 1 ? '' : 's'}`,
            detail: result.groupBy
                ? `Grouped by ${result.groupBy} across ${result.groups?.length || 0} bucket${(result.groups?.length || 0) === 1 ? '' : 's'}.`
                : `${result.columns.length} visible column${result.columns.length === 1 ? '' : 's'}.`,
            warnings: Array.isArray(result.warnings) ? result.warnings : [],
            columns: result.columns || [],
            sampleRows: Array.isArray(result.rows) ? result.rows.slice(0, 3).map((row) => ({
                id: row.id,
                fields: row.fields || {}
            })) : [],
            layouts: buildRenderLayoutSummary(parsed, result, options)
        },
        result
    };
}

function buildBuilderOptions(state, options = {}) {
    const fieldsCache = options.fieldsCache || getFieldsCache();
    const knownTypes = options.knownTypes || deriveKnownTypes(fieldsCache);
    const normalized = normalizeBuilderState(state, { fieldsCache, knownTypes });
    const type = normalized.type || '*';
    const fieldCandidates = collectFieldCandidates(type, fieldsCache);
    const relationFieldCandidates = collectRelationFieldCandidates(type, fieldsCache);
    const smartFields = type === '*'
        ? []
        : (parseSingleViewBlock(buildTypeViewQuery(type, 'smart').split('\n'))?.select || []);
    const groupableFields = fieldCandidates.filter((field) => field !== 'id' && field !== 'type');
    return {
        knownTypes,
        fieldCandidates,
        relationFieldCandidates,
        smartFields,
        groupableFields,
        defaultSelectClause: defaultSelectClauseForType(type)
    };
}

module.exports = {
    TASK_PRESETS,
    RENDER_LAYOUTS,
    deriveKnownTypes,
    normalizeBuilderState,
    buildStateFromQuery,
    buildQueryTextFromState,
    buildPreviewFromState,
    buildBuilderOptions
};
