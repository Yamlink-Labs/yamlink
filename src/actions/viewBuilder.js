'use strict';

const vscode = require('vscode');
const { getSchema } = require('../registries/schemaRegistry');
const { getBacklinks } = require('../core/graph');
const { parseSingleViewBlock, buildQueryString } = require('../engine/query');

function getViewBlockAtRange(document, range) {
    const lines = document.getText().split('\n');
    let start = range.start.line;
    while (start >= 0) {
        const t = lines[start].trim();
        if (t.startsWith('!view ')) break;
        if (!t || (!/^(select|where|sort|limit|via)\b/i.test(t) && start !== range.start.line)) return null;
        start--;
    }
    if (start < 0 || !lines[start].trim().startsWith('!view ')) return null;
    const block = [lines[start]];
    let end = start + 1;
    while (end < lines.length) {
        const t = lines[end].trim();
        if (!t) break;
        if (t.startsWith('!view ')) break;
        if (/^(select|where|sort|limit|via)\b/i.test(t)) {
            block.push(lines[end]);
            end++;
        } else break;
    }
    return { start, end, block, query: parseSingleViewBlock(block) };
}

function getViewBlockByIndex(document, index) {
    const lines = document.getText().split('\n');
    let currentIndex = -1;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (!lines[lineIndex].trim().startsWith('!view ')) continue;
        currentIndex += 1;
        if (currentIndex !== index) continue;

        const block = [lines[lineIndex]];
        let end = lineIndex + 1;
        while (end < lines.length) {
            const t = lines[end].trim();
            if (!t) break;
            if (t.startsWith('!view ')) break;
            if (/^(select|where|sort|limit|via)\b/i.test(t)) {
                block.push(lines[end]);
                end += 1;
            } else {
                break;
            }
        }

        return { start: lineIndex, end, block, query: parseSingleViewBlock(block) };
    }

    return null;
}

async function revealDocumentAndRunViews(document) {
    if (!document) return;
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    await vscode.commands.executeCommand('yamlink.runViews');
}

function defaultSelectClauseForType(type) {
    const schema = getSchema ? getSchema(type) : null;
    if (!schema || !schema.fields) return '';
    const schemaFields = Object.keys(schema.fields)
        .filter(f => f !== 'id' && f !== 'created' && f !== 'type')
        .slice(0, 5);
    return schemaFields.length > 0 ? `\nselect ${schemaFields.join(', ')}` : '';
}

function getAvailableFieldsForType(type) {
    if (!type || type === '*') return [];
    const schema = getSchema ? getSchema(type) : null;
    if (!schema || !schema.fields) return [];
    return Object.keys(schema.fields)
        .filter(f => f !== 'id')
        .sort((a, b) => a.localeCompare(b));
}

function getSchemaBackedDefaultSortField(type) {
    const fields = getAvailableFieldsForType(type);
    if (fields.includes('created')) return 'created';
    if (fields.includes('date')) return 'date';
    if (fields.includes('name')) return 'name';
    return '';
}

function appendQueryOptions(baseQuery, options = {}) {
    let query = String(baseQuery || '').trim();
    if (!query) return '';

    const label = String(options.label || '').trim();
    if (label) {
        const firstLineEnd = query.indexOf('\n');
        if (firstLineEnd === -1) {
            query = `${query} | ${label}`;
        } else {
            query = `${query.slice(0, firstLineEnd)} | ${label}${query.slice(firstLineEnd)}`;
        }
    }

    const whereField = String(options.whereField || '').trim();
    const whereValue = String(options.whereValue || '').trim();
    if (whereField && whereValue) {
        const operator = String(options.whereOperator || '=').trim() || '=';
        query += `\nwhere ${whereField} ${operator} ${whereValue}`;
    }

    const sortField = String(options.sortField || '').trim();
    if (sortField) {
        const direction = String(options.sortDirection || 'asc').trim().toLowerCase() === 'desc'
            ? ' desc'
            : '';
        query += `\nsort ${sortField}${direction}`;
    }

    if (Number.isInteger(options.limit) && options.limit > 0) {
        query += `\nlimit ${options.limit}`;
    }

    return query;
}

function buildTypeViewQuery(type, selectMode = 'smart', options = {}) {
    const head = type === '*' ? '!view *' : `!view ${type}`;
    let query = head;
    if (type !== '*' && selectMode !== 'none') {
        query += selectMode === 'all' ? '\nselect *' : defaultSelectClauseForType(type);
    }
    return appendQueryOptions(query, options);
}

function buildIncomingViewQuery(sourceType, viaField, options = {}) {
    let query = `!view incoming ${sourceType}`;
    if (viaField && viaField !== '*') query += `\nvia ${viaField}`;
    return appendQueryOptions(query, options);
}

function refineParsedQuery(query, refinement = {}) {
    if (!query) return null;
    const next = {
        ...query,
        wheres: Array.isArray(query.wheres) ? query.wheres.map(where => ({ ...where })) : []
    };

    if ('label' in refinement) next.label = refinement.label || null;

    if ('sortField' in refinement) {
        if (refinement.sortField) {
            next.sort = {
                field: refinement.sortField,
                desc: String(refinement.sortDirection || 'asc').toLowerCase() === 'desc'
            };
        } else {
            next.sort = null;
        }
    }

    if ('limit' in refinement) {
        next.limit = Number.isInteger(refinement.limit) && refinement.limit > 0
            ? refinement.limit
            : null;
    }

    if ('whereField' in refinement) {
        if (refinement.whereField && refinement.whereValue) {
            next.wheres = [{
                field: refinement.whereField,
                op: refinement.whereOperator || '=',
                value: refinement.whereValue,
                valueKind: String(refinement.whereValue || '').startsWith('[[') && String(refinement.whereValue || '').endsWith(']]')
                    ? 'relation'
                    : 'string'
            }];
            if (next.wheres[0].valueKind === 'relation') {
                next.wheres[0].value = next.wheres[0].value.slice(2, -2).trim();
            }
            next.where = next.wheres[0];
        } else {
            next.wheres = [];
            next.where = null;
        }
    }

    return next;
}

function buildRefinedBlockText(originalBlock, query) {
    if (!originalBlock || !query) return '';
    return buildQueryString(query);
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

async function runGuidedViewBuilder(activeDocument, noteId, knownTypes) {
    function hasField(type, fieldName) {
        return getAvailableFieldsForType(type).includes(fieldName);
    }

    function humanizePlural(type) {
        return type === '*' ? 'nodes' : `${type}s`;
    }

    async function pickLabel() {
        const raw = await vscode.window.showInputBox({
            title: 'Yamlink — Query Builder',
            prompt: 'Optional label for the query tab',
            placeHolder: 'Latest missions'
        });
        return raw ? raw.trim() : '';
    }

    async function pickSortAndLimit(type) {
        const fields = type === '*'
            ? ['created', 'type']
            : Array.from(new Set(['created', ...getAvailableFieldsForType(type)]));

        const sortChoice = await vscode.window.showQuickPick([
            { label: 'No sort', value: '' },
            ...fields.map(field => ({ label: field, value: field }))
        ], {
            title: 'Yamlink — Query Builder',
            placeHolder: 'Optional sort field'
        });
        if (!sortChoice) return null;

        let sortDirection = 'asc';
        if (sortChoice.value) {
            const directionPick = await vscode.window.showQuickPick([
                { label: 'Ascending', value: 'asc' },
                { label: 'Descending', value: 'desc' }
            ], {
                title: 'Yamlink — Query Builder',
                placeHolder: 'Choose sort direction'
            });
            if (!directionPick) return null;
            sortDirection = directionPick.value;
        }

        const limitPick = await vscode.window.showQuickPick([
            { label: 'No limit', value: 0 },
            { label: 'Limit 10', value: 10 },
            { label: 'Limit 25', value: 25 },
            { label: 'Limit 50', value: 50 }
        ], {
            title: 'Yamlink — Query Builder',
            placeHolder: 'Optional row limit'
        });
        if (!limitPick) return null;

        return {
            sortField: sortChoice.value,
            sortDirection,
            limit: limitPick.value
        };
    }

    async function pickTypeFilter(type) {
        if (!type || type === '*') return {};
        const fields = getAvailableFieldsForType(type);
        if (fields.length === 0) return {};

        const filterField = await vscode.window.showQuickPick([
            { label: 'No starter filter', value: '' },
            ...fields.map(field => ({ label: field, value: field }))
        ], {
            title: 'Yamlink — Query Builder',
            placeHolder: 'Optional starter filter'
        });
        if (!filterField) return null;
        if (!filterField.value) return {};

        const whereValue = await vscode.window.showInputBox({
            title: 'Yamlink — Query Builder',
            prompt: `Value for ${filterField.value}`,
            placeHolder: 'victory or [[johnny-rico]]'
        });
        if (!whereValue) return null;

        return {
            whereField: filterField.value,
            whereValue: whereValue.trim()
        };
    }

    const rootItems = [
        {
            label: 'Table of a type',
            description: 'Build a node table',
            value: 'table'
        },
        {
            label: 'Tasks and calendar',
            description: 'Pick a task preset',
            value: 'tasks'
        }
    ];

    if (noteId) {
        rootItems.splice(1, 0, {
            label: 'Backlinks to this note',
            description: `Build an incoming query for ${noteId}`,
            value: 'incoming'
        });
    }

    const root = await vscode.window.showQuickPick(rootItems, {
        title: 'Yamlink — Query Builder',
        placeHolder: 'Choose the kind of view you want to build'
    });
    if (!root) return null;

    if (root.value === 'tasks') {
        const taskPick = await vscode.window.showQuickPick([
            { label: 'All tasks', query: '!view tasks', description: 'Every task row across the vault' },
            { label: 'Open tasks', query: '!view open-tasks', description: 'Only incomplete tasks' },
            { label: 'Done tasks', query: '!view done-tasks', description: 'Only completed tasks' },
            { label: 'Overdue tasks', query: '!view overdue', description: 'Incomplete tasks with dates before today' },
            { label: 'Undated tasks', query: '!view undated-tasks', description: 'Tasks that still need a date' },
            { label: 'Calendar', query: '!view calendar', description: 'Every dated task and created-note event' },
            { label: 'Today', query: '!view today', description: 'Only today activity' },
            { label: 'Upcoming', query: '!view upcoming', description: 'Next two weeks of activity' }
        ], {
            title: 'Yamlink — Query Builder',
            placeHolder: 'Choose a task or calendar preset'
        });
        return taskPick ? taskPick.query : null;
    }

    if (root.value === 'incoming') {
        const typePick = await vscode.window.showQuickPick([
            { label: 'Any source type', value: '*' },
            ...knownTypes.map(type => ({ label: capitalize(type), description: type, value: type }))
        ], {
            title: 'Yamlink — Query Builder',
            placeHolder: 'Choose which kinds of nodes can link here'
        });
        if (!typePick) return null;

        const backlinkFields = Array.from(new Set(
            getBacklinks(noteId)
                .map(edge => String(edge.field || '').trim().toLowerCase())
                .filter(field => field && field !== 'body')
        )).sort();
        const fieldPick = await vscode.window.showQuickPick([
            { label: 'Any relation field', value: '*' },
            ...backlinkFields.map(field => ({ label: field, value: field }))
        ], {
            title: 'Yamlink — Query Builder',
            placeHolder: 'Optionally narrow to a specific relation field'
        });
        if (!fieldPick) return null;

        const incomingPresets = [
            {
                label: 'Backlinks',
                description: 'Simple incoming view',
                query: buildIncomingViewQuery(typePick.value, fieldPick.value, {
                    label: typePick.value === '*'
                        ? 'Backlinks'
                        : `${capitalize(typePick.value)} backlinks`
                })
            }
        ];

        if (hasField(typePick.value, 'created')) {
            incomingPresets.push({
                label: 'Latest backlinks',
                description: 'Sort newest first and limit to 10',
                query: buildIncomingViewQuery(typePick.value, fieldPick.value, {
                    label: typePick.value === '*'
                        ? 'Latest backlinks'
                        : `Latest ${humanizePlural(typePick.value)}`,
                    sortField: 'created',
                    sortDirection: 'desc',
                    limit: 10
                })
            });
        }

        incomingPresets.push({
            label: 'Custom incoming view…',
            description: 'Choose label, sorting, and limit manually',
            query: '__custom__'
        });

        const presetPick = await vscode.window.showQuickPick(incomingPresets, {
            title: 'Yamlink — Query Builder',
            placeHolder: 'Choose a backlink preset'
        });
        if (!presetPick) return null;
        if (presetPick.query !== '__custom__') return presetPick.query;

        const label = await pickLabel();
        const sortLimit = await pickSortAndLimit(typePick.value);
        if (!sortLimit) return null;

        return buildIncomingViewQuery(typePick.value, fieldPick.value, {
            label,
            ...sortLimit
        });
    }

    const typePick = await vscode.window.showQuickPick([
        { label: 'All nodes', value: '*', description: 'Browse the whole vault' },
        ...knownTypes.map(type => ({ label: `${capitalize(type)} table`, description: type, value: type }))
    ], {
        title: 'Yamlink — Query Builder',
        placeHolder: 'Choose which type to show'
    });
    if (!typePick) return null;

    const presets = [
        {
            label: 'Standard table',
            description: 'Use smart starter columns',
            query: buildTypeViewQuery(typePick.value, 'smart', {
                label: typePick.value === '*' ? 'All nodes' : `${capitalize(typePick.value)}s`
            })
        }
    ];

    if (typePick.value !== '*' && hasField(typePick.value, 'created')) {
        presets.push({
            label: 'Latest entries',
            description: 'Sort newest first and limit to 10',
            query: buildTypeViewQuery(typePick.value, 'smart', {
                label: `Latest ${humanizePlural(typePick.value)}`,
                sortField: 'created',
                sortDirection: 'desc',
                limit: 10
            })
        });
    }

    if (typePick.value !== '*' && hasField(typePick.value, 'status')) {
        presets.push({
            label: 'Active/open items',
            description: 'Filter status to active',
            query: buildTypeViewQuery(typePick.value, 'smart', {
                label: `Active ${humanizePlural(typePick.value)}`,
                whereField: 'status',
                whereValue: 'active'
            })
        });
    }

    presets.push({
        label: 'Custom table…',
        description: 'Choose columns, filter, sort, and limit manually',
        query: '__custom__'
    });

    const presetPick = await vscode.window.showQuickPick(presets, {
        title: 'Yamlink — Query Builder',
        placeHolder: 'Choose a table preset'
    });
    if (!presetPick) return null;
    if (presetPick.query !== '__custom__') return presetPick.query;

    const selectPick = await vscode.window.showQuickPick([
        { label: 'Smart starter columns', value: 'smart', description: 'Use schema-backed columns when available' },
        { label: 'All available columns', value: 'all', description: 'Insert a wildcard select clause' },
        { label: 'No select clause', value: 'none', description: 'Keep the query minimal and let the table infer columns' }
    ], {
        title: 'Yamlink — Query Builder',
        placeHolder: 'Choose how much structure to prefill'
    });
    if (!selectPick) return null;

    const label = await pickLabel();
    const filterOptions = await pickTypeFilter(typePick.value);
    if (filterOptions === null) return null;
    const sortLimit = await pickSortAndLimit(typePick.value);
    if (!sortLimit) return null;

    return buildTypeViewQuery(typePick.value, selectPick.value, {
        label,
        ...filterOptions,
        ...sortLimit
    });
}

async function runViewRefinementBuilder(document, range) {
    if (!document) return null;
    const blockInfo = getViewBlockAtRange(document, range || new vscode.Range(0, 0, 0, 0));
    if (!blockInfo || !blockInfo.query) return null;

    const query = blockInfo.query;
    const type = query.type || '*';
    const sortCandidates = type === '*'
        ? ['created', 'type']
        : Array.from(new Set(['created', ...getAvailableFieldsForType(type)]));
    const filterCandidates = type === '*'
        ? ['id', 'type', 'created']
        : getAvailableFieldsForType(type);

    const action = await vscode.window.showQuickPick([
        { label: 'Change label', value: 'label' },
        { label: 'Change sort', value: 'sort' },
        { label: 'Change limit', value: 'limit' },
        { label: 'Set starter filter', value: 'filter' },
        { label: 'Clear filter', value: 'clear-filter' }
    ], {
        title: 'Yamlink — Refine View',
        placeHolder: 'Choose what to change in this view'
    });
    if (!action) return null;

    let nextQuery = query;

    if (action.value === 'label') {
        const label = await vscode.window.showInputBox({
            title: 'Yamlink — Refine View',
            prompt: 'Label for the query tab',
            value: query.label || '',
            placeHolder: 'Latest missions'
        });
        if (label === undefined) return null;
        nextQuery = refineParsedQuery(query, { label: label.trim() });
    }

    if (action.value === 'sort') {
        const sortPick = await vscode.window.showQuickPick([
            { label: 'No sort', value: '' },
            ...sortCandidates.map(field => ({ label: field, value: field }))
        ], {
            title: 'Yamlink — Refine View',
            placeHolder: 'Choose a sort field'
        });
        if (!sortPick) return null;

        let sortDirection = 'asc';
        if (sortPick.value) {
            const dirPick = await vscode.window.showQuickPick([
                { label: 'Ascending', value: 'asc' },
                { label: 'Descending', value: 'desc' }
            ], {
                title: 'Yamlink — Refine View',
                placeHolder: 'Choose sort direction'
            });
            if (!dirPick) return null;
            sortDirection = dirPick.value;
        }

        nextQuery = refineParsedQuery(query, {
            sortField: sortPick.value,
            sortDirection
        });
    }

    if (action.value === 'limit') {
        const limitPick = await vscode.window.showQuickPick([
            { label: 'No limit', value: 0 },
            { label: 'Limit 10', value: 10 },
            { label: 'Limit 25', value: 25 },
            { label: 'Limit 50', value: 50 }
        ], {
            title: 'Yamlink — Refine View',
            placeHolder: 'Choose a row limit'
        });
        if (!limitPick) return null;
        nextQuery = refineParsedQuery(query, { limit: limitPick.value });
    }

    if (action.value === 'filter') {
        const fieldPick = await vscode.window.showQuickPick(filterCandidates.map(field => ({
            label: field,
            value: field
        })), {
            title: 'Yamlink — Refine View',
            placeHolder: 'Choose a field to filter by'
        });
        if (!fieldPick) return null;

        const whereValue = await vscode.window.showInputBox({
            title: 'Yamlink — Refine View',
            prompt: `Value for ${fieldPick.value}`,
            placeHolder: 'active or [[johnny-rico]]'
        });
        if (!whereValue) return null;

        nextQuery = refineParsedQuery(query, {
            whereField: fieldPick.value,
            whereValue: whereValue.trim(),
            whereOperator: '='
        });
    }

    if (action.value === 'clear-filter') {
        nextQuery = refineParsedQuery(query, {
            whereField: '',
            whereValue: ''
        });
    }

    return {
        ...blockInfo,
        nextText: buildRefinedBlockText(blockInfo.block, nextQuery),
        query: nextQuery
    };
}

async function runViewRefinementByIndex(document, queryIndex) {
    if (!document || !Number.isInteger(queryIndex) || queryIndex < 0) return null;
    const blockInfo = getViewBlockByIndex(document, queryIndex);
    if (!blockInfo || !blockInfo.query) return null;
    return runViewRefinementBuilder(document, new vscode.Range(blockInfo.start, 0, blockInfo.start, 0));
}

module.exports = {
    appendQueryOptions,
    buildIncomingViewQuery,
    buildRefinedBlockText,
    buildTypeViewQuery,
    defaultSelectClauseForType,
    getAvailableFieldsForType,
    getSchemaBackedDefaultSortField,
    getViewBlockAtRange,
    getViewBlockByIndex,
    refineParsedQuery,
    revealDocumentAndRunViews,
    runGuidedViewBuilder,
    runViewRefinementBuilder,
    runViewRefinementByIndex
};
