'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);
require.cache.__viewpanel_vscode_stub__ = {
    id: '__viewpanel_vscode_stub__',
    filename: '__viewpanel_vscode_stub__',
    loaded: true,
    exports: {}
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__viewpanel_vscode_stub__';
    return originalResolve(request, parent, ...rest);
};

const {
    normaliseTableDisplayValue,
    normalizeSavedSort,
    sortRowsForSavedSort,
    formatQueryHeroText,
    buildQuickFieldList,
    getTaskStatusPresentation,
    buildTableEmptyStateTitle,
    buildEmptyStateHint,
    classifyQueryWarnings,
    buildWarningBanner
} = require('../src/features/view/viewPanelHtml');
const { extractIdFromText } = require('../src/features/viewPanel');
const { computeNextSortState } = require('../src/features/viewPanelUiRuntime');
const {
    normaliseColumnFilters,
    setColumnFilterValues,
    rowMatchesColumnFilters
} = require('../src/features/viewPanelStateRuntime');

describe('view panel display helpers', () => {
    test('keeps canonical dates untouched and normalises parseable datetime strings', () => {
        assert.equal(normaliseTableDisplayValue('date', '2026-03-31'), '2026-03-31');
        assert.equal(
            normaliseTableDisplayValue('date', 'Mon Mar 30 2026 21:00:00 GMT-0300 (Chile Summer Time)'),
            '2026-03-31'
        );
    });

    test('keeps booleans lowercase for stable rendering', () => {
        assert.equal(normaliseTableDisplayValue('boolean', 'TRUE'), 'true');
        assert.equal(normaliseTableDisplayValue('boolean', 'false'), 'false');
    });

    test('extracts canonical context ids from accented frontmatter values', () => {
        const text = [
            '---',
            'id: Jaime Ramírez',
            'type: contact',
            '---',
            ''
        ].join('\n');
        assert.equal(extractIdFromText(text), 'jaime-ramirez');
    });
    test('uses the incoming empty-state title for backlink views', () => {
        const title = buildTableEmptyStateTitle({
            incoming: true,
            type: 'contact',
            wheres: [],
            where: null
        }, []);
        assert.equal(title, 'No notes link here yet.');
    });

    test('elevates unsupported cross-field or into a query issue state', () => {
        const warningState = classifyQueryWarnings([
            'Cross-field OR is not supported yet. Use multiple `where` lines with `and`, or split this into separate views.'
        ]);
        assert.equal(warningState.severity, 'query-issue');
        assert.match(warningState.primary, /cross-field `or`/i);
        assert.match(warningState.tip, /split the logic into separate views/i);
    });

    test('uses a stronger empty-state title and hint for query issues', () => {
        const warnings = [
            'Cross-field OR is not supported yet. Use multiple `where` lines with `and`, or split this into separate views.'
        ];
        const title = buildTableEmptyStateTitle({
            incoming: false,
            type: 'account',
            wheres: [],
            where: null
        }, warnings);
        const hint = buildEmptyStateHint({
            incoming: false,
            type: 'account',
            wheres: [],
            where: null
        }, warnings);

        assert.equal(title, 'This query needs attention.');
        assert.match(hint, /does not support cross-field `or` yet/i);
        assert.match(hint, /split the logic into separate views/i);
    });

    test('builds a structured warning banner for query issues', () => {
        const banner = buildWarningBanner({
            type: 'account',
            wheres: [],
            where: null
        }, [
            'Cross-field OR is not supported yet. Use multiple `where` lines with `and`, or split this into separate views.'
        ]);

        assert.match(banner, /warning-card/);
        assert.match(banner, /Query issue/);
        assert.match(banner, /cross-field <code>or<\/code> yet/i);
        assert.match(banner, /split the logic into separate views/i);
    });

    test('formats the query hero and limits quick field pivots to the first non-id columns', () => {
        const queryHero = formatQueryHeroText("FROM notes WHERE type = 'character' SORT created");
        assert.match(queryHero, /q-from/);
        assert.match(queryHero, /q-where/);
        assert.match(queryHero, /q-sort/);
        assert.deepEqual(
            buildQuickFieldList(['id', 'type', 'commander', 'homeworld', 'created', 'status']),
            ['type', 'commander', 'homeworld', 'created']
        );
    });

    test('task status presentation uses human labels and overdue state', () => {
        assert.deepEqual(
            getTaskStatusPresentation({ fields: { done: 'true', date: '2026-05-10' } }, '2026-05-15'),
            { key: 'true', label: 'Done', sortValue: 'done', filterValue: 'done', className: 'true' }
        );
        assert.deepEqual(
            getTaskStatusPresentation({ fields: { done: 'false', date: '2026-05-10' } }, '2026-05-15'),
            { key: 'overdue', label: 'Overdue', sortValue: 'overdue', filterValue: 'overdue', className: 'overdue' }
        );
        assert.deepEqual(
            getTaskStatusPresentation({ fields: { done: 'false', date: '2026-06-10' } }, '2026-05-15'),
            { key: 'false', label: 'Not done', sortValue: 'not done', filterValue: 'not done', className: 'pending' }
        );
    });

    test('normalizes saved sort state from either legacy or new shape', () => {
        assert.deepEqual(normalizeSavedSort({ col: 'status', asc: true }), {
            field: 'status',
            direction: 'asc'
        });
        assert.deepEqual(normalizeSavedSort({ field: 'date', direction: 'desc' }), {
            field: 'date',
            direction: 'desc'
        });
    });

    test('sort transition toggles the same column and resets new columns to asc', () => {
        assert.deepEqual(computeNextSortState(null, 'status'), {
            field: 'status',
            direction: 'asc'
        });
        assert.deepEqual(computeNextSortState({ field: 'status', direction: 'asc' }, 'status'), {
            field: 'status',
            direction: 'desc'
        });
        assert.deepEqual(computeNextSortState({ field: 'status', direction: 'desc' }, 'status'), {
            field: 'status',
            direction: 'asc'
        });
        assert.deepEqual(computeNextSortState({ field: 'status', direction: 'desc' }, 'owner'), {
            field: 'owner',
            direction: 'asc'
        });
    });

    test('render-path sort helper returns rows in the saved order', () => {
        const rows = [
            { id: 'b', fields: { status: 'done', date: '2026-05-12' } },
            { id: 'a', fields: { status: 'active', date: '2026-05-10' } },
            { id: 'c', fields: { status: 'blocked', date: '2026-05-11' } }
        ];
        const meta = {
            id: { kind: 'id' },
            status: { kind: 'text' },
            date: { kind: 'date' }
        };

        assert.deepEqual(
            sortRowsForSavedSort(rows, { field: 'status', direction: 'asc' }, meta).map((row) => row.id),
            ['a', 'c', 'b']
        );
        assert.deepEqual(
            sortRowsForSavedSort(rows, { field: 'date', direction: 'desc' }, meta).map((row) => row.id),
            ['b', 'c', 'a']
        );
    });

    test('column filters normalize legacy quick-filter state and preserve multi-value state', () => {
        assert.deepEqual(
            normaliseColumnFilters({
                status: { mode: 'include', value: 'active' },
                owner: { mode: 'include', values: ['Rico', 'Carmen'] }
            }),
            {
                status: { mode: 'include', values: ['active'] },
                owner: { mode: 'include', values: ['Rico', 'Carmen'] }
            }
        );
    });

    test('column filter state transitions support selecting and clearing multiple values', () => {
        let filters = {};
        filters = setColumnFilterValues(filters, 'status', ['active', 'blocked']);
        assert.deepEqual(filters, {
            status: { mode: 'include', values: ['active', 'blocked'] }
        });
        filters = setColumnFilterValues(filters, 'status', []);
        assert.deepEqual(filters, {});
    });

    test('row visibility respects multi-value column filters client-side', () => {
        const makeRow = function (values) {
            return {
                children: values.map((value) => ({
                    dataset: { filterValue: value },
                    textContent: value
                }))
            };
        };
        const filters = {
            status: { mode: 'include', values: ['active', 'blocked'] },
            owner: { mode: 'include', values: ['Rico'] }
        };
        const getColumnIndex = function (field) {
            return { status: 0, owner: 1 }[field] ?? -1;
        };

        assert.equal(rowMatchesColumnFilters(makeRow(['active', 'Rico']), filters, getColumnIndex), true);
        assert.equal(rowMatchesColumnFilters(makeRow(['done', 'Rico']), filters, getColumnIndex), false);
        assert.equal(rowMatchesColumnFilters(makeRow(['blocked', 'Carmen']), filters, getColumnIndex), false);
    });
});

Module._resolveFilename = originalResolve;
