'use strict';

const { getBacklinks } = require('../core/graph');
const {
    appendQueryOptions,
    buildIncomingViewQuery,
    buildTypeViewQuery,
    capitalize,
    findSchemaRelationField,
    getAvailableFieldsForType
} = require('./viewBuilderCore');
const { showBuilderQuickPick, showBuilderInput } = require('./viewBuilderPromptUi');
const { runViewRefinementBuilder, runViewRefinementByIndex } = require('./viewBuilderRefinement');

async function runGuidedViewBuilder(activeDocument, noteId, knownTypes, noteFields = {}) {
    const currentNoteType = String(noteFields?.type || '').trim().toLowerCase() || null;

    function hasField(type, fieldName) {
        return getAvailableFieldsForType(type).includes(fieldName);
    }

    function humanizePlural(type) {
        return type === '*' ? 'nodes' : `${type}s`;
    }

    async function pickLabel() {
        const raw = await showBuilderInput({
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

        const sortChoice = await showBuilderQuickPick([
            { label: 'No sort', value: '' },
            ...fields.map(field => ({ label: field, value: field }))
        ], {
            title: 'Yamlink — Query Builder',
            placeHolder: 'Optional sort field'
        });
        if (!sortChoice) return null;

        let sortDirection = 'asc';
        if (sortChoice.value) {
            const directionPick = await showBuilderQuickPick([
                { label: 'Ascending', value: 'asc' },
                { label: 'Descending', value: 'desc' }
            ], {
                title: 'Yamlink — Query Builder',
                placeHolder: 'Choose sort direction'
            });
            if (!directionPick) return null;
            sortDirection = directionPick.value;
        }

        const limitPick = await showBuilderQuickPick([
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

        const filterField = await showBuilderQuickPick([
            { label: 'No starter filter', value: '' },
            ...fields.map(field => ({ label: field, value: field }))
        ], {
            title: 'Yamlink — Query Builder',
            placeHolder: 'Optional starter filter'
        });
        if (!filterField) return null;
        if (!filterField.value) return {};

        const whereValue = await showBuilderInput({
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

    const root = await showBuilderQuickPick(rootItems, {
        title: 'Yamlink — Query Builder',
        placeHolder: 'Choose the kind of view you want to build'
    });
    if (!root) return null;

    if (root.value === 'tasks') {
        const taskPick = await showBuilderQuickPick([
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
        const typePick = await showBuilderQuickPick([
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
        const fieldPick = await showBuilderQuickPick([
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

        const presetPick = await showBuilderQuickPick(incomingPresets, {
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

    const typeItems = [
        { label: 'All nodes', value: '*', description: 'Browse the whole vault' }
    ];
    if (currentNoteType && knownTypes.includes(currentNoteType)) {
        typeItems.push({
            label: `${capitalize(currentNoteType)} table`,
            value: currentNoteType,
            description: 'current note type'
        });
    }
    for (const type of knownTypes) {
        if (type === currentNoteType) continue;
        typeItems.push({ label: `${capitalize(type)} table`, description: type, value: type });
    }

    const typePick = await showBuilderQuickPick(typeItems, {
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

    if (typePick.value !== '*' && noteId && currentNoteType) {
        const relField = findSchemaRelationField(typePick.value, currentNoteType);
        if (relField) {
            presets.unshift({
                label: `${capitalize(humanizePlural(typePick.value))} linked to this ${currentNoteType}`,
                description: `where ${relField} = [[${noteId}]]`,
                query: buildTypeViewQuery(typePick.value, 'smart', {
                    label: `${capitalize(humanizePlural(typePick.value))} — ${noteId}`,
                    whereField: relField,
                    whereValue: `[[${noteId}]]`
                })
            });
        }
    }

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

    const presetPick = await showBuilderQuickPick(presets, {
        title: 'Yamlink — Query Builder',
        placeHolder: 'Choose a table preset'
    });
    if (!presetPick) return null;
    if (presetPick.query !== '__custom__') return presetPick.query;

    const selectPick = await showBuilderQuickPick([
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

module.exports = {
    runGuidedViewBuilder,
    runViewRefinementBuilder,
    runViewRefinementByIndex
};
