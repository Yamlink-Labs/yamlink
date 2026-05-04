'use strict';

const vscode = require('vscode');
const { getFieldsCache } = require('../core/indexService');
const { parseSingleViewBlock } = require('../engine/query');
const {
    buildLikelyRepairActions,
    buildRefinedBlockText,
    getAvailableFieldsForType,
    getViewBlockAtRange,
    getViewBlockByIndex,
    refineParsedQuery
} = require('./viewBuilderCore');
const { showBuilderQuickPick, showBuilderInput } = require('./viewBuilderPromptUi');

async function runViewRefinementBuilder(document, range) {
    if (!document) return null;
    const blockInfo = getViewBlockAtRange(document, range || new vscode.Range(0, 0, 0, 0));
    if (!blockInfo || !blockInfo.query) return null;

    const query = blockInfo.query;
    const type = query.type || '*';
    const fieldCache = getFieldsCache();
    const sortCandidates = type === '*'
        ? ['created', 'type']
        : Array.from(new Set(['created', ...getAvailableFieldsForType(type)]));
    const filterCandidates = type === '*'
        ? ['id', 'type', 'created']
        : getAvailableFieldsForType(type);
    const smartRepairActions = buildLikelyRepairActions(query, sortCandidates, filterCandidates, fieldCache);

    const action = await showBuilderQuickPick([
        ...smartRepairActions,
        { label: 'Edit query text directly', value: 'raw-edit', description: 'Rewrite this !view block in one text step' },
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
    let nextText = null;

    if (action.value === 'smart-repair' && typeof action.apply === 'function') {
        nextQuery = action.apply(query);
    }

    if (action.value === 'raw-edit') {
        const initial = buildRefinedBlockText(blockInfo.block, query);
        const edited = await showBuilderInput({
            title: 'Yamlink — Edit Query',
            prompt: 'Edit the !view block directly',
            value: initial,
            valueSelection: [0, initial.length],
            validateInput(value) {
                const lines = String(value || '').split(/\r?\n/).map(function (line) { return line.trimEnd(); });
                const parsed = parseSingleViewBlock(lines);
                return parsed ? null : 'Enter a valid !view block starting with !view.';
            }
        });
        if (edited === undefined) return null;
        nextText = String(edited || '').trim();
        nextQuery = parseSingleViewBlock(nextText.split(/\r?\n/));
    }

    if (action.value === 'label') {
        const label = await showBuilderInput({
            title: 'Yamlink — Refine View',
            prompt: 'Label for the query tab',
            value: query.label || '',
            placeHolder: 'Latest missions'
        });
        if (label === undefined) return null;
        nextQuery = refineParsedQuery(query, { label: label.trim() });
    }

    if (action.value === 'sort') {
        const sortPick = await showBuilderQuickPick([
            { label: 'No sort', value: '' },
            ...sortCandidates.map(field => ({ label: field, value: field }))
        ], {
            title: 'Yamlink — Refine View',
            placeHolder: 'Choose a sort field'
        });
        if (!sortPick) return null;

        let sortDirection = 'asc';
        if (sortPick.value) {
            const dirPick = await showBuilderQuickPick([
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
        const limitPick = await showBuilderQuickPick([
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
        const fieldPick = await showBuilderQuickPick(filterCandidates.map(field => ({
            label: field,
            value: field
        })), {
            title: 'Yamlink — Refine View',
            placeHolder: 'Choose a field to filter by'
        });
        if (!fieldPick) return null;

        const whereValue = await showBuilderInput({
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
        nextText: nextText || buildRefinedBlockText(blockInfo.block, nextQuery),
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
    runViewRefinementBuilder,
    runViewRefinementByIndex
};
