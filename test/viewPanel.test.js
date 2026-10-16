'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const originalResolve = Module._resolveFilename.bind(Module);
require.cache.__viewpanel_vscode_stub__ = {
    id: '__viewpanel_vscode_stub__',
    filename: '__viewpanel_vscode_stub__',
    loaded: true,
    exports: {
        workspace: {
            textDocuments: [],
            applyEdit: async function () { return true; }
        },
        Uri: {
            file(filePath) { return { fsPath: filePath }; }
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__viewpanel_vscode_stub__';
    return originalResolve(request, parent, ...rest);
};

const {
    normaliseTableDisplayValue,
    normalizeSavedSort,
    sortRowsForSavedSort,
    buildQuickFieldList,
    getTaskStatusPresentation,
    buildTableEmptyStateTitle,
    buildEmptyStateHint,
    classifyQueryWarnings
} = require('../src/features/view/viewTableLogic');
const {
    formatQueryHeroText,
    buildWarningBanner,
    buildBarChartHtml,
    buildScatterChartHtml,
    buildLineChartHtml,
    buildPieChartHtml,
    buildAggregateSummaryHtml,
    buildCalcSourceCellHtml
} = require('../src/features/view/viewPanelHtml');
const { editCell, extractIdFromText, toggleTaskCheckbox } = require('../src/features/viewPanel');
const { computeNextSortState } = require('../src/features/viewPanelUiRuntime');
const {
    normaliseColumnFilters,
    setColumnFilterValues,
    rowMatchesColumnFilters
} = require('../src/features/viewPanelStateRuntime');
const { getPathIndex, getFieldsCache } = require('../src/core/indexService');
const {
    initMutationLog,
    clearMutationEvents,
    getMutationEvents
} = require('../src/runtime/mutationEventLog');

beforeEach(() => {
    initMutationLog(null);
    clearMutationEvents();
    getPathIndex().clear();
    getFieldsCache().clear();
});

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

    test('task status presentation handles due-today and due-soon states', () => {
        assert.deepEqual(
            getTaskStatusPresentation({ fields: { done: 'false', date: '2026-05-15' } }, '2026-05-15'),
            { key: 'due-today', label: 'Due today', sortValue: 'due-today', filterValue: 'due-today', className: 'due-today' }
        );
        assert.deepEqual(
            getTaskStatusPresentation({ fields: { done: 'false', date: '2026-05-17' } }, '2026-05-15'),
            { key: 'due-soon', label: 'Due soon', sortValue: 'due-soon', filterValue: 'due-soon', className: 'due-soon' }
        );
        assert.deepEqual(
            getTaskStatusPresentation({ fields: { done: 'false', date: '2026-05-18' } }, '2026-05-15'),
            { key: 'due-soon', label: 'Due soon', sortValue: 'due-soon', filterValue: 'due-soon', className: 'due-soon' }
        );
        // 4 days out is not due-soon
        assert.deepEqual(
            getTaskStatusPresentation({ fields: { done: 'false', date: '2026-05-19' } }, '2026-05-15'),
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

    test('task toggles append a task status history event for the owning note', async () => {
        const tmpPath = path.join(os.tmpdir(), `yamlink-task-toggle-${Date.now()}.md`);
        try {
            fs.writeFileSync(tmpPath, '- [ ] Review drop sequence\n', 'utf8');
            getPathIndex().set(tmpPath, 'planet-p-assault');

            const ok = await toggleTaskCheckbox(tmpPath, 1, true);
            assert.equal(ok, true);

            const content = fs.readFileSync(tmpPath, 'utf8');
            assert.match(content, /^\- \[x\] Review drop sequence/m);

            const events = getMutationEvents({ noteId: 'planet-p-assault', type: 'task_status_changed' });
            assert.equal(events.length, 1);
            assert.equal(events[0].field, 'task:1');
            assert.equal(events[0].oldValue, 'open');
            assert.equal(events[0].newValue, 'done');
            const behaviorEvents = getMutationEvents({ noteId: 'planet-p-assault', type: 'task_state_changed' });
            assert.equal(behaviorEvents.length, 1);
            assert.equal(behaviorEvents[0].cause, 'viewpanel_task_toggle');
        } finally {
            getPathIndex().delete(tmpPath);
            try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
    });

    test('editCell appends a field_changed mutation event with oldValue and newValue', async () => {
        const tmpPath = path.join(os.tmpdir(), `yamlink-editcell-${Date.now()}.md`);
        try {
            fs.writeFileSync(tmpPath, '---\nid: test-note\ntype: contact\nstatus: draft\n---\n', 'utf8');
            getPathIndex().set(tmpPath, 'test-note');
            getFieldsCache().set('test-note', { id: 'test-note', type: 'contact', status: 'draft' });

            const ok = await editCell(tmpPath, 'status', 'active');
            assert.equal(ok, true);

            const events = getMutationEvents({ noteId: 'test-note', type: 'field_changed' });
            assert.equal(events.length, 1);
            assert.equal(events[0].field, 'status');
            assert.equal(events[0].oldValue, 'draft');
            assert.equal(events[0].newValue, 'active');
        } finally {
            getPathIndex().delete(tmpPath);
            getFieldsCache().delete('test-note');
            try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
    });

    test('editCell clearing a field emits newValue null', async () => {
        const tmpPath = path.join(os.tmpdir(), `yamlink-editcell-clear-${Date.now()}.md`);
        try {
            fs.writeFileSync(tmpPath, '---\nid: clear-note\ntype: task\nowner: rico\n---\n', 'utf8');
            getPathIndex().set(tmpPath, 'clear-note');
            getFieldsCache().set('clear-note', { id: 'clear-note', type: 'task', owner: 'rico' });

            const ok = await editCell(tmpPath, 'owner', '');
            assert.equal(ok, true);

            const events = getMutationEvents({ noteId: 'clear-note', type: 'field_changed' });
            assert.equal(events.length, 1);
            assert.equal(events[0].oldValue, 'rico');
            assert.equal(events[0].newValue, null);
        } finally {
            getPathIndex().delete(tmpPath);
            getFieldsCache().delete('clear-note');
            try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
    });

    test('buildBarChartHtml renders a canvas and chart init block for grouped results', () => {
        const html = buildBarChartHtml({
            idx: 0,
            groupField: 'company',
            nonce: 'test-nonce',
            groups: [
                { key: 'MI', count: 3 },
                { key: 'Fleet', count: 2 }
            ]
        });

        assert.match(html, /canvas id="view-chart-bar-0"/);
        assert.match(html, /new window\.Chart/);
        assert.match(html, /"MI"/);
        assert.match(html, /"Fleet"/);
        assert.match(html, /"data":\[3,2\]/);
    });

    test('buildBarChartHtml returns requires group by message when grouped results are unavailable', () => {
        const html = buildBarChartHtml({
            idx: 1,
            groupField: null,
            nonce: 'test-nonce',
            groups: null
        });

        assert.match(html, /Bar chart requires a <code>group by<\/code> clause\./);
        assert.doesNotMatch(html, /new window\.Chart/);
    });

    test('buildPieChartHtml renders a grouped pie chart with visible legend config', () => {
        const html = buildPieChartHtml({
            idx: 4,
            groupField: 'status',
            nonce: 'test-nonce',
            groups: [
                { key: 'open', count: 4 },
                { key: 'closed', count: 1 }
            ]
        });

        assert.match(html, /canvas id="view-chart-pie-4"/);
        assert.match(html, /"type":"pie"/);
        assert.match(html, /"position":"right"/);
        assert.match(html, /"labels":\["open","closed"\]/);
        assert.match(html, /"data":\[4,1\]/);
    });

    test('buildBarChartHtml with no aggregate clause renders no value picker at all — byte-identical to before aggregate charting existed', () => {
        const html = buildBarChartHtml({
            idx: 0,
            groupField: 'company',
            nonce: 'test-nonce',
            groups: [{ key: 'MI', count: 3 }],
            aggregateTerms: null,
            valueField: ''
        });
        assert.doesNotMatch(html, /chart-value-select/);
        assert.match(html, /"data":\[3\]/);
    });

    test('buildBarChartHtml offers a Value picker when the query has a non-count aggregate clause, defaulting to Count', () => {
        const html = buildBarChartHtml({
            idx: 0,
            groupField: 'unit',
            nonce: 'test-nonce',
            groups: [
                { key: 'alpha', count: 2, aggregates: { total: 35 } },
                { key: 'bravo', count: 1, aggregates: { total: 12 } }
            ],
            aggregateTerms: [{ fn: 'sum', field: 'cell.total', alias: 'total' }],
            valueField: ''
        });
        assert.match(html, /data-chart-value-select/);
        assert.match(html, /<option value="" selected>Count<\/option>/);
        assert.match(html, /<option value="total">total<\/option>/);
        // Defaults to count when no valueField is selected.
        assert.match(html, /"data":\[2,1\]/);
    });

    test('buildBarChartHtml plots the selected aggregate value, not the row count, once a value is picked', () => {
        const html = buildBarChartHtml({
            idx: 0,
            groupField: 'unit',
            nonce: 'test-nonce',
            groups: [
                { key: 'alpha', count: 2, aggregates: { total: 35 } },
                { key: 'bravo', count: 1, aggregates: { total: 12 } }
            ],
            aggregateTerms: [{ fn: 'sum', field: 'cell.total', alias: 'total' }],
            valueField: 'total'
        });
        assert.match(html, /<option value="total" selected>total<\/option>/);
        assert.match(html, /"data":\[35,12\]/);
        assert.match(html, /plotting <code>total<\/code>/);
    });

    test('buildBarChartHtml passes null through for a bucket with no numeric aggregate value, never a fabricated 0', () => {
        const html = buildBarChartHtml({
            idx: 0,
            groupField: 'unit',
            nonce: 'test-nonce',
            groups: [
                { key: 'alpha', count: 2, aggregates: { total: 35 } },
                { key: 'bravo', count: 1, aggregates: { total: null } }
            ],
            aggregateTerms: [{ fn: 'sum', field: 'cell.total', alias: 'total' }],
            valueField: 'total'
        });
        assert.match(html, /"data":\[35,null\]/);
    });

    test('buildBarChartHtml never offers a redundant "Count" option twice when the aggregate clause itself has a bare count term', () => {
        const html = buildBarChartHtml({
            idx: 0,
            groupField: 'unit',
            nonce: 'test-nonce',
            groups: [{ key: 'alpha', count: 2, aggregates: { count: 2, total: 35 } }],
            aggregateTerms: [
                { fn: 'count', field: null, alias: 'count' },
                { fn: 'sum', field: 'cell.total', alias: 'total' }
            ],
            valueField: ''
        });
        const countOptionMatches = html.match(/>Count</g) || [];
        assert.equal(countOptionMatches.length, 1);
        assert.match(html, /<option value="total">total<\/option>/);
    });

    test('buildPieChartHtml supports the same Value picker as buildBarChartHtml', () => {
        const html = buildPieChartHtml({
            idx: 4,
            groupField: 'status',
            nonce: 'test-nonce',
            groups: [
                { key: 'open', count: 4, aggregates: { avg_days: 3.5 } },
                { key: 'closed', count: 1, aggregates: { avg_days: 1 } }
            ],
            aggregateTerms: [{ fn: 'average', field: 'cell.days', alias: 'avg_days' }],
            valueField: 'avg_days'
        });
        assert.match(html, /data-chart-value-select/);
        assert.match(html, /"data":\[3\.5,1\]/);
    });

    test('buildScatterChartHtml renders a canvas and dataset with point values', () => {
        const rows = [
            {
                id: 'mission-alpha',
                nodeType: 'mission',
                fields: { name: 'Mission Alpha', priority: '2', duration: '14' }
            },
            {
                id: 'mission-beta',
                nodeType: 'mission',
                fields: { name: 'Mission Beta', priority: '4', duration: '21' }
            }
        ];
        const html = buildScatterChartHtml({
            idx: 2,
            rows,
            columns: ['id', 'priority', 'duration'],
            meta: {
                id: { kind: 'id' },
                priority: { kind: 'number' },
                duration: { kind: 'number' }
            },
            xField: 'priority',
            yField: 'duration',
            types: ['mission'],
            nonce: 'test-nonce'
        });

        assert.match(html, /canvas id="view-chart-scatter-2"/);
        assert.match(html, /new window\.Chart/);
        assert.match(html, /"x":2/);
        assert.match(html, /"y":14/);
        assert.match(html, /Mission Alpha/);
    });

    test('buildLineChartHtml renders sorted line points by x value', () => {
        const html = buildLineChartHtml({
            idx: 5,
            rows: [
                {
                    id: 'mission-late',
                    nodeType: 'mission',
                    fields: { name: 'Mission Late', day: '3', score: '30' }
                },
                {
                    id: 'mission-early',
                    nodeType: 'mission',
                    fields: { name: 'Mission Early', day: '1', score: '10' }
                }
            ],
            columns: ['id', 'day', 'score'],
            meta: {
                id: { kind: 'id' },
                day: { kind: 'number' },
                score: { kind: 'number' }
            },
            xField: 'day',
            yField: 'score',
            types: ['mission'],
            nonce: 'test-nonce'
        });

        assert.match(html, /canvas id="view-chart-line-5"/);
        assert.match(html, /type: 'line'/);
        assert.match(html, /"showLine":true/);
        assert.ok(html.indexOf('"x":1') < html.indexOf('"x":3'));
        assert.ok(html.indexOf('Mission Early') < html.indexOf('Mission Late'));
    });

    test('buildScatterChartHtml auto-selects axes and renders chart when xField/yField are empty', () => {
        const html = buildScatterChartHtml({
            idx: 3,
            rows: [
                {
                    id: 'mission-alpha',
                    nodeType: 'mission',
                    fields: { priority: '2', duration: '14' }
                }
            ],
            columns: ['id', 'priority', 'duration'],
            meta: {
                id: { kind: 'id' },
                priority: { kind: 'number' },
                duration: { kind: 'number' }
            },
            xField: '',
            yField: '',
            types: ['mission'],
            nonce: 'test-nonce'
        });

        assert.match(html, /data-scatter-axis="x"/);
        assert.match(html, /data-scatter-axis="y"/);
        assert.match(html, /Choose field/);
        assert.match(html, /new window\.Chart/);
        assert.match(html, /"x":2/);
        assert.match(html, /"y":14/);
    });

    test('buildAggregateSummaryHtml renders one pill per term, in order, with formatted values', () => {
        const html = buildAggregateSummaryHtml(
            { total: 113, avg: 37.666666, lowest: 3 },
            [
                { fn: 'sum', field: 'cell.total', alias: 'total' },
                { fn: 'average', field: 'cell.total', alias: 'avg' },
                { fn: 'min', field: 'cell.total', alias: 'lowest' }
            ]
        );
        assert.match(html, /class="aggregate-summary"/);
        assert.match(html, /aggregate-pill-label">total<\/span><span class="aggregate-pill-value">113/);
        assert.match(html, /aggregate-pill-label">avg<\/span><span class="aggregate-pill-value">37\.67/);
        assert.match(html, /aggregate-pill-label">lowest<\/span><span class="aggregate-pill-value">3</);
    });

    test('buildAggregateSummaryHtml renders an em-dash for a null aggregate, never 0 or NaN', () => {
        const html = buildAggregateSummaryHtml(
            { total: null },
            [{ fn: 'sum', field: 'region', alias: 'total' }]
        );
        assert.match(html, /aggregate-pill-value">—/);
        assert.doesNotMatch(html, />0</);
        assert.doesNotMatch(html, /NaN/);
    });

    test('buildAggregateSummaryHtml returns empty string when there is no aggregate clause', () => {
        assert.equal(buildAggregateSummaryHtml(null, null), '');
        assert.equal(buildAggregateSummaryHtml(undefined, []), '');
    });

    test('buildCalcSourceCellHtml renders calculated fields as non-editable source buttons', () => {
        const html = buildCalcSourceCellHtml(
            {
                id: 'field-report-alpha',
                cellMeta: {
                    'cell.total': { expr: '50+25', label: 'Y1', name: 'total' }
                }
            },
            'cell.total',
            '75',
            '',
            ' data-filter-value="75"',
            ' data-sort-value="75"'
        );

        assert.match(html, /class="cell-calc-source"/);
        assert.match(html, /data-id="field-report-alpha"/);
        assert.match(html, /title="Y1 · total = 50\+25"/);
        assert.match(html, /aria-label="Open source note for cell\.total"/);
        assert.match(html, />75<\/button>/);
        assert.doesNotMatch(html, /cell-editable/);
        assert.doesNotMatch(html, /data-edit-mode/);
    });

    test('buildCalcSourceCellHtml stays quiet for ordinary fields or missing cell metadata', () => {
        assert.equal(buildCalcSourceCellHtml({ id: 'a', cellMeta: {} }, 'status', 'active'), null);
        assert.equal(buildCalcSourceCellHtml({ id: 'a', cellMeta: {} }, 'cell.total', '75'), null);
    });
});

Module._resolveFilename = originalResolve;
