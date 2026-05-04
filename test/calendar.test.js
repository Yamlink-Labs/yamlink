'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);
require.cache.__calendar_vscode_stub__ = {
    id: '__calendar_vscode_stub__',
    filename: '__calendar_vscode_stub__',
    loaded: true,
    exports: {}
};
Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__calendar_vscode_stub__';
    return originalResolve(request, parent, ...rest);
};

const { buildCalendarModel } = require('../src/features/calendarPanel');

describe('calendar model', () => {
    test('groups dated tasks and keeps undated tasks separate', () => {
        const model = buildCalendarModel([
            { id: 'a#t1-x', fileId: 'a', done: false, text: 'Brief team', date: '2026-03-27' },
            { id: 'a#t2-y', fileId: 'a', done: true, text: 'Archive deck', date: '2026-03-27' },
            { id: 'b#t1-z', fileId: 'b', done: false, text: 'Review notes', date: '2026-03-30' },
            { id: 'c#t1-k', fileId: 'c', done: false, text: 'Undated item', date: '' }
        ], new Map([
            ['a', { type: 'planner', name: 'Alpha Plan' }],
            ['b', { type: 'mission', title: 'Beta Mission' }],
            ['c', { type: 'note' }]
        ]), '2026-03-27');

        assert.equal(model.stats.total, 4);
        assert.equal(model.stats.today, 2);
        assert.equal(model.stats.completed, 1);
        assert.equal(model.monthKeys.length, 1);
        assert.equal(model.selectedMonth, '2026-03');
        assert.equal(model.months['2026-03'].length, 3);
        assert.equal(model.undated.length, 1);
        assert.equal(model.months['2026-03'][0].sourceLabel, 'Alpha Plan');
    });

    test('includes created-note activity in dated calendar rows', () => {
        const model = buildCalendarModel([
            { id: 'a#t1-x', fileId: 'a', done: false, text: 'Brief team', date: '2026-03-27' }
        ], new Map([
            ['a', { type: 'planner', name: 'Alpha Plan', created: '2026-03-26' }],
            ['b', { type: 'contact', title: 'Bravo Contact', created: '2026-03-28' }]
        ]), '2026-03-27');

        assert.equal(model.stats.total, 3);
        assert.equal(model.stats.created, 2);
        assert.equal(model.months['2026-03'].length, 3);
        assert.ok(model.months['2026-03'].some(row => row.itemKind === 'created' && row.fileId === 'b'));
    });

    test('uses note date field before created and normalises supported formats', () => {
        const model = buildCalendarModel([], new Map([
            ['a', { type: 'mission', title: 'Alpha', date: '04/03/2026', created: '2026-03-01' }],
            ['b', { type: 'note', title: 'Bravo', date: 'March 6, 2026' }],
            ['c', { type: 'note', title: 'Charlie', created: '2026-03-07' }]
        ]), '2026-03-04');

        assert.equal(model.stats.total, 3);
        assert.equal(model.stats.created, 3);
        assert.ok(model.months['2026-03'].some(row => row.fileId === 'a' && row.date === '2026-03-04' && row.itemKind === 'date'));
        assert.ok(model.months['2026-03'].some(row => row.fileId === 'b' && row.date === '2026-03-06' && row.itemKind === 'date'));
        assert.ok(model.months['2026-03'].some(row => row.fileId === 'c' && row.date === '2026-03-07' && row.itemKind === 'created'));
    });
});

describe('calendar model resilience', () => {
    test('tasks whose fileId is absent from fieldsCache fall back to fileId as label', () => {
        const model = buildCalendarModel([
            { id: 'ghost#t1-aa', fileId: 'ghost-file', done: false, text: 'Orphan task', date: '2026-05-01' }
        ], new Map(), '2026-05-01');

        assert.equal(model.stats.total, 1);
        assert.equal(model.months['2026-05'][0].sourceLabel, 'ghost-file');
    });

    test('tasks with empty date string land in undated, not in any month', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'Undated task', date: '' },
            { id: 'a#t2', fileId: 'a', done: false, text: 'Dated task', date: '2026-05-10' }
        ], new Map([['a', { type: 'note' }]]), '2026-05-10');

        assert.equal(model.undated.length, 1);
        assert.equal(model.undated[0].text, 'Undated task');
        assert.equal(model.months['2026-05'].length, 1);
    });

    test('empty task list and empty fieldsCache returns a valid empty model', () => {
        const model = buildCalendarModel([], new Map(), '2026-05-01');

        assert.equal(model.stats.total, 0);
        assert.equal(model.dated.length, 0);
        assert.equal(model.undated.length, 0);
        assert.deepEqual(model.monthKeys, []);
        assert.equal(model.selectedMonth, '2026-05');
    });

    test('stats invariant: total equals tasks plus created, dated plus undated equals total', () => {
        const tasks = [
            { id: 'a#t1', fileId: 'a', done: false, text: 'Task one', date: '2026-05-01' },
            { id: 'a#t2', fileId: 'a', done: true, text: 'Task two', date: '' },
            { id: 'b#t1', fileId: 'b', done: false, text: 'Task three', date: '2026-06-01' }
        ];
        const fieldsCache = new Map([
            ['a', { type: 'project', created: '2026-04-01' }],
            ['b', { type: 'note', date: '2026-06-15' }]
        ]);
        const model = buildCalendarModel(tasks, fieldsCache, '2026-05-01');

        assert.equal(model.stats.total, model.stats.tasks + model.stats.created);
        assert.equal(model.stats.dated + model.stats.undated, model.stats.total);
    });

    test('stats.completed counts only done tasks, not created-note items', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: true, text: 'Done task', date: '2026-05-01' },
            { id: 'a#t2', fileId: 'a', done: false, text: 'Open task', date: '2026-05-02' }
        ], new Map([
            ['a', { type: 'note', created: '2026-05-03' }],
            ['b', { type: 'note', created: '2026-05-04' }]
        ]), '2026-05-01');

        assert.equal(model.stats.completed, 1);
    });

    test('multi-year tasks produce correctly ordered monthKeys', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'Task in 2025', date: '2025-11-01' },
            { id: 'a#t2', fileId: 'a', done: false, text: 'Task in 2027', date: '2027-02-01' },
            { id: 'a#t3', fileId: 'a', done: false, text: 'Task in 2026', date: '2026-05-01' }
        ], new Map([['a', { type: 'note' }]]), '2026-05-01');

        assert.deepEqual(model.monthKeys, ['2025-11', '2026-05', '2027-02']);
    });

    test('multiple tasks on the same date are sorted stably by fileId then id', () => {
        const model = buildCalendarModel([
            { id: 'z-file#t1', fileId: 'z-file', done: false, text: 'Task Z', date: '2026-05-01' },
            { id: 'a-file#t1', fileId: 'a-file', done: false, text: 'Task A', date: '2026-05-01' },
            { id: 'a-file#t2', fileId: 'a-file', done: false, text: 'Task B', date: '2026-05-01' }
        ], new Map([
            ['z-file', { type: 'note' }],
            ['a-file', { type: 'note' }]
        ]), '2026-05-01');

        const dayRows = model.months['2026-05'].filter(r => r.date === '2026-05-01');
        assert.equal(dayRows[0].fileId, 'a-file');
        assert.equal(dayRows[1].id, 'a-file#t2');
        assert.equal(dayRows[2].fileId, 'z-file');
    });

    test('dense vault: 60 tasks across 3 months plus 15 dated notes', () => {
        const MONTHS = ['2026-04', '2026-05', '2026-06'];
        const tasks = [];
        for (let i = 0; i < 60; i++) {
            const month = MONTHS[i % 3];
            const day = String((i % 28) + 1).padStart(2, '0');
            tasks.push({
                id: `file-${i % 15}#t${i}`,
                fileId: `file-${i % 15}`,
                done: i % 4 === 0,
                text: `Task number ${i}`,
                date: `${month}-${day}`
            });
        }
        const fieldsCache = new Map();
        for (let j = 0; j < 15; j++) {
            const day = String(j + 1).padStart(2, '0');
            fieldsCache.set(`file-${j}`, { type: 'project', title: `Project ${j}`, created: `2026-04-${day}` });
        }

        const model = buildCalendarModel(tasks, fieldsCache, '2026-05-01');

        assert.equal(model.stats.tasks, 60);
        assert.equal(model.stats.created, 15);
        assert.equal(model.stats.total, 75);
        assert.equal(model.stats.total, model.stats.tasks + model.stats.created);
        assert.equal(model.stats.dated + model.stats.undated, model.stats.total);
        assert.ok(model.monthKeys.includes('2026-04'));
        assert.ok(model.monthKeys.includes('2026-05'));
        assert.ok(model.monthKeys.includes('2026-06'));
        assert.equal(model.selectedMonth, '2026-05');

        const dates = model.dated.map(r => r.date);
        for (let i = 1; i < dates.length; i++) {
            assert.ok(dates[i] >= dates[i - 1], `rows out of order at index ${i}: ${dates[i - 1]} > ${dates[i]}`);
        }
    });

    test('notes with neither date nor created field are excluded from calendar rows', () => {
        const model = buildCalendarModel([], new Map([
            ['a', { type: 'note', title: 'No dates at all' }],
            ['b', { type: 'note', created: '2026-05-01' }]
        ]), '2026-05-01');

        assert.equal(model.stats.total, 1);
        assert.equal(model.stats.created, 1);
    });
});

describe('calendar model product surface', () => {
    // ── navigation state ─────────────────────────────────────────────

    test('selectedMonth is today when today has activity', () => {
        const today = '2026-06-10';
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'Task today', date: today }
        ], new Map([['a', { type: 'note' }]]), today);

        assert.equal(model.selectedMonth, '2026-06');
        assert.equal(model.selectedDate, today);
    });

    test('selectedMonth falls back to first available month when today has no activity', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'Past task', date: '2026-03-05' },
            { id: 'a#t2', fileId: 'a', done: false, text: 'Future task', date: '2026-08-01' }
        ], new Map([['a', { type: 'note' }]]), '2026-06-15');

        assert.equal(model.selectedMonth, '2026-03');
    });

    test('selectedDate is today when today has dated items', () => {
        const today = '2026-05-20';
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'Prep call', date: today },
            { id: 'a#t2', fileId: 'a', done: false, text: 'Earlier task', date: '2026-05-01' }
        ], new Map([['a', { type: 'note' }]]), today);

        assert.equal(model.selectedDate, today);
    });

    test('selectedDate falls back to earliest dated item when today has no activity', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'Old task', date: '2026-01-15' },
            { id: 'a#t2', fileId: 'a', done: false, text: 'New task', date: '2026-09-01' }
        ], new Map([['a', { type: 'note' }]]), '2026-06-01');

        assert.equal(model.selectedDate, '2026-01-15');
    });

    test('selectedDate and selectedMonth are today when vault is empty', () => {
        const today = '2026-07-04';
        const model = buildCalendarModel([], new Map(), today);

        assert.equal(model.selectedDate, today);
        assert.equal(model.selectedMonth, '2026-07');
    });

    // ── stats.today ──────────────────────────────────────────────────

    test('stats.today counts tasks and created-note items on today', () => {
        const today = '2026-06-01';
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'Task today', date: today },
            { id: 'a#t2', fileId: 'a', done: true, text: 'Done today', date: today },
            { id: 'b#t1', fileId: 'b', done: false, text: 'Other day', date: '2026-06-02' }
        ], new Map([
            ['a', { type: 'note' }],
            ['c', { type: 'contact', created: today }]
        ]), today);

        assert.equal(model.stats.today, 3);
    });

    test('stats.today is 0 when nothing falls on today', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'Yesterday', date: '2026-05-31' }
        ], new Map([['a', { type: 'note' }]]), '2026-06-01');

        assert.equal(model.stats.today, 0);
    });

    // ── item shape / correctness ─────────────────────────────────────

    test('note with both date and created fields produces exactly one calendar entry using date', () => {
        const model = buildCalendarModel([], new Map([
            ['x', { type: 'event', title: 'Launch Day', date: '2026-05-10', created: '2026-04-01' }]
        ]), '2026-05-10');

        assert.equal(model.stats.total, 1);
        assert.equal(model.stats.created, 1);
        const row = model.months['2026-05'][0];
        assert.equal(row.date, '2026-05-10');
        assert.equal(row.itemKind, 'date');
    });

    test('sourceLabel priority: name before title before fileId', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'name-note', done: false, text: 'T1', date: '2026-05-01' },
            { id: 'b#t1', fileId: 'title-note', done: false, text: 'T2', date: '2026-05-01' },
            { id: 'c#t1', fileId: 'id-only', done: false, text: 'T3', date: '2026-05-01' }
        ], new Map([
            ['name-note',  { type: 'note', name: 'Named Note', title: 'Old Title' }],
            ['title-note', { type: 'note', title: 'Titled Note' }],
            ['id-only',    { type: 'note' }]
        ]), '2026-05-01');

        const rows = model.months['2026-05'];
        assert.equal(rows.find(r => r.fileId === 'name-note').sourceLabel, 'Named Note');
        assert.equal(rows.find(r => r.fileId === 'title-note').sourceLabel, 'Titled Note');
        assert.equal(rows.find(r => r.fileId === 'id-only').sourceLabel, 'id-only');
    });

    test('itemKind is task for task rows, date for date-field notes, created for created-only notes', () => {
        const model = buildCalendarModel([
            { id: 'p#t1', fileId: 'p', done: false, text: 'A task', date: '2026-05-05' }
        ], new Map([
            ['q', { type: 'event', date: '2026-05-06' }],
            ['r', { type: 'note', created: '2026-05-07' }]
        ]), '2026-05-05');

        const byDate = Object.fromEntries(
            model.dated.map(row => [row.date + ':' + row.fileId, row.itemKind])
        );
        assert.equal(byDate['2026-05-05:p'], 'task');
        assert.equal(byDate['2026-05-06:q'], 'date');
        assert.equal(byDate['2026-05-07:r'], 'created');
    });

    test('months[key] contains both task items and created-note items for the same month', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'Meeting', date: '2026-07-10' }
        ], new Map([
            ['a', { type: 'project', title: 'Project A' }],
            ['b', { type: 'contact', title: 'Contact B', created: '2026-07-15' }]
        ]), '2026-07-01');

        const julyRows = model.months['2026-07'];
        assert.equal(julyRows.length, 2);
        assert.ok(julyRows.some(r => r.itemKind === 'task'));
        assert.ok(julyRows.some(r => r.itemKind === 'created'));
    });

    // ── resilience under weird input ─────────────────────────────────

    test('non-ISO truthy task dates are treated as undated, not placed in a garbage month', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'Bad date task', date: 'sometime soon' },
            { id: 'a#t2', fileId: 'a', done: false, text: 'Good date task', date: '2026-05-01' }
        ], new Map([['a', { type: 'note' }]]), '2026-05-01');

        assert.equal(model.undated.length, 1);
        assert.equal(model.undated[0].text, 'Bad date task');
        assert.equal(model.monthKeys.length, 1);
        assert.equal(model.monthKeys[0], '2026-05');
    });

    test('task rows with undefined fileId sort and render without crashing', () => {
        const model = buildCalendarModel([
            { id: 'x#t1', fileId: undefined, done: false, text: 'No file ref', date: '2026-05-01' }
        ], new Map(), '2026-05-01');

        assert.equal(model.stats.total, 1);
        assert.equal(model.months['2026-05'][0].sourceLabel, '');
    });

    test('task rows with null text produce empty string, not "null" in the label', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: null, date: '2026-05-01' }
        ], new Map([['a', { type: 'note' }]]), '2026-05-01');

        assert.equal(model.months['2026-05'][0].text, '');
    });

    // ── high-volume / real-usage simulation ──────────────────────────

    test('CRM simulation: 120 tasks across 6 months plus 40 dated notes', () => {
        const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
        const tasks = [];
        let doneCount = 0;
        let undatedCount = 0;

        for (let i = 0; i < 120; i++) {
            const month = MONTHS[i % 6];
            const day = String((i % 28) + 1).padStart(2, '0');
            const isUndated = i % 10 === 0;
            const isDone = i % 5 === 0;
            if (isDone) doneCount++;
            if (isUndated) undatedCount++;
            tasks.push({
                id: `note-${i % 40}#t${i}`,
                fileId: `note-${i % 40}`,
                done: isDone,
                text: `Task ${i} for note ${i % 40}`,
                date: isUndated ? '' : `${month}-${day}`
            });
        }

        const fieldsCache = new Map();
        for (let j = 0; j < 40; j++) {
            const month = MONTHS[j % 6];
            const day = String((j % 28) + 1).padStart(2, '0');
            fieldsCache.set(`note-${j}`, {
                type: j < 20 ? 'contact' : 'account',
                title: `Note ${j}`,
                created: `${month}-${day}`
            });
        }

        const model = buildCalendarModel(tasks, fieldsCache, '2026-03-15');

        assert.equal(model.stats.tasks, 120);
        assert.equal(model.stats.created, 40);
        assert.equal(model.stats.total, 160);
        assert.equal(model.stats.total, model.stats.tasks + model.stats.created);
        assert.equal(model.stats.dated + model.stats.undated, model.stats.total);
        assert.equal(model.stats.completed, doneCount);

        for (const m of MONTHS) assert.ok(model.monthKeys.includes(m), `month ${m} missing`);
        assert.equal(model.selectedMonth, '2026-03');

        const dates = model.dated.map(r => r.date);
        for (let i = 1; i < dates.length; i++) {
            assert.ok(dates[i] >= dates[i - 1], `out of order at ${i}: ${dates[i - 1]} > ${dates[i]}`);
        }

        const undated = model.undated.filter(r => r.itemKind === 'task');
        assert.equal(undated.length, undatedCount);
    });

    test('overdue tasks appear in their correct historical months, not today', () => {
        const today = '2026-06-01';
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'Jan task overdue', date: '2026-01-15' },
            { id: 'a#t2', fileId: 'a', done: false, text: 'May task overdue', date: '2026-05-20' },
            { id: 'a#t3', fileId: 'a', done: false, text: 'Future task', date: '2026-07-01' }
        ], new Map([['a', { type: 'note' }]]), today);

        assert.ok(model.monthKeys.includes('2026-01'));
        assert.ok(model.monthKeys.includes('2026-05'));
        assert.ok(model.monthKeys.includes('2026-07'));
        assert.equal(model.stats.today, 0);
        assert.equal(model.months['2026-01'].length, 1);
        assert.equal(model.months['2026-07'].length, 1);
    });

    test('undated items from mixed sources (no-date tasks and no-date notes) all land in undated', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'No date task 1', date: '' },
            { id: 'a#t2', fileId: 'a', done: true, text: 'No date task 2', date: '' }
        ], new Map([
            ['a', { type: 'note' }],
            ['b', { type: 'note', title: 'No dates at all' }]
        ]), '2026-06-01');

        assert.equal(model.stats.undated, 2);
        assert.equal(model.stats.dated, 0);
        assert.deepEqual(model.monthKeys, []);
    });
});

describe('calendar model contracts', () => {
    // ── model shape the client depends on ────────────────────────────

    test('model.todayIso is preserved for client keyboard navigation (T shortcut)', () => {
        const today = '2026-08-12';
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'Some task', date: today }
        ], new Map([['a', { type: 'note' }]]), today);

        assert.equal(model.todayIso, today);
    });

    test('months object is a faithful decomposition of dated: all item counts match', () => {
        const MONTHS = ['2026-03', '2026-04', '2026-05'];
        const tasks = [];
        for (let i = 0; i < 30; i++) {
            tasks.push({
                id: `f#t${i}`, fileId: 'f', done: false,
                text: `Task ${i}`, date: `${MONTHS[i % 3]}-${String((i % 10) + 1).padStart(2, '0')}`
            });
        }
        const model = buildCalendarModel(tasks, new Map([['f', { type: 'note' }]]), '2026-04-01');

        const monthsTotal = Object.values(model.months).reduce((sum, arr) => sum + arr.length, 0);
        assert.equal(monthsTotal, model.stats.dated,
            `months total ${monthsTotal} !== stats.dated ${model.stats.dated}`);
    });

    test('dated array spans all months, not just selectedMonth (week and day views need this)', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'March', date: '2026-03-10' },
            { id: 'a#t2', fileId: 'a', done: false, text: 'May',   date: '2026-05-20' },
            { id: 'a#t3', fileId: 'a', done: false, text: 'July',  date: '2026-07-04' }
        ], new Map([['a', { type: 'note' }]]), '2026-05-01');

        assert.equal(model.selectedMonth, '2026-05');
        assert.equal(model.dated.length, 3,
            'dated must include items from all months, not just selectedMonth');
        assert.ok(model.dated.some(r => r.date === '2026-03-10'));
        assert.ok(model.dated.some(r => r.date === '2026-07-04'));
    });

    // ── navigation: created-note activity ────────────────────────────

    test('selectedDate is todayIso when today has only created-note activity, not task activity', () => {
        const today = '2026-09-05';
        const model = buildCalendarModel([], new Map([
            ['launch', { type: 'event', title: 'Launch', created: today }]
        ]), today);

        assert.equal(model.selectedDate, today);
        assert.equal(model.selectedMonth, '2026-09');
    });

    // ── dual-entry behaviour ─────────────────────────────────────────

    test('one file with tasks and a created date contributes both task items and one created entry', () => {
        const model = buildCalendarModel([
            { id: 'proj#t1', fileId: 'proj', done: false, text: 'Kick off',  date: '2026-05-10' },
            { id: 'proj#t2', fileId: 'proj', done: false, text: 'Follow up', date: '2026-05-15' }
        ], new Map([
            ['proj', { type: 'project', title: 'Alpha Project', created: '2026-05-01' }]
        ]), '2026-05-01');

        assert.equal(model.stats.tasks, 2);
        assert.equal(model.stats.created, 1);
        assert.equal(model.stats.total, 3);

        const mayRows = model.months['2026-05'];
        assert.equal(mayRows.filter(r => r.itemKind === 'task').length, 2);
        assert.equal(mayRows.filter(r => r.itemKind === 'created').length, 1);
    });

    // ── dense same-day concentration ─────────────────────────────────

    test('30 tasks on one date all appear in the month bucket in sorted order', () => {
        const DATE = '2026-05-15';
        const tasks = [];
        for (let i = 0; i < 30; i++) {
            tasks.push({
                id: `file-${i}#t1`,
                fileId: `file-${String(i).padStart(3, '0')}`,
                done: i % 3 === 0,
                text: `Task ${i}`,
                date: DATE
            });
        }
        const fieldsCache = new Map(tasks.map(t => [t.fileId, { type: 'note' }]));
        const model = buildCalendarModel(tasks, fieldsCache, DATE);

        const dayBucket = (model.months['2026-05'] || []).filter(r => r.date === DATE);
        assert.equal(dayBucket.length, 30);
        for (let i = 1; i < dayBucket.length; i++) {
            assert.ok(
                safeLocaleCompare(dayBucket[i].fileId, dayBucket[i - 1].fileId) >= 0,
                `bucket out of order at ${i}`
            );
        }
    });

    // ── stats.completed with undated done tasks ───────────────────────

    test('done undated tasks still increment stats.completed', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: true,  text: 'Done, no date', date: '' },
            { id: 'a#t2', fileId: 'a', done: false, text: 'Open, dated',   date: '2026-05-01' }
        ], new Map([['a', { type: 'note' }]]), '2026-05-01');

        assert.equal(model.stats.completed, 1);
        assert.equal(model.stats.undated, 1);
        assert.equal(model.stats.dated, 1);
    });

    // ── undated invariant ────────────────────────────────────────────

    test('all undated items are task items: created-note items always have a date', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'No date task', date: '' },
            { id: 'a#t2', fileId: 'a', done: false, text: 'Dated task',   date: '2026-06-01' }
        ], new Map([
            ['a', { type: 'note', created: '2026-06-02' }],
            ['b', { type: 'contact', created: '2026-06-03' }]
        ]), '2026-06-01');

        assert.ok(
            model.undated.every(r => r.itemKind === 'task'),
            'undated array must contain only task items'
        );
    });

    // ── fileType population ──────────────────────────────────────────

    test('fileType is populated from fieldsCache type field, empty string when absent', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'typed',   done: false, text: 'T1', date: '2026-05-01' },
            { id: 'b#t1', fileId: 'untyped', done: false, text: 'T2', date: '2026-05-01' }
        ], new Map([
            ['typed',   { type: 'mission' }],
            ['untyped', {}]
        ]), '2026-05-01');

        const rows = model.months['2026-05'];
        assert.equal(rows.find(r => r.fileId === 'typed').fileType, 'mission');
        assert.equal(rows.find(r => r.fileId === 'untyped').fileType, '');
    });

    // ── monthKeys format guard ───────────────────────────────────────

    test('all monthKeys are valid YYYY-MM strings', () => {
        const MONTHS = ['2025-12', '2026-01', '2026-06', '2027-03'];
        const tasks = MONTHS.map((m, i) => ({
            id: `f#t${i}`, fileId: 'f', done: false, text: `Task ${i}`, date: `${m}-01`
        }));
        const model = buildCalendarModel(tasks, new Map([['f', { type: 'note' }]]), '2026-06-01');

        const YYYY_MM = /^\d{4}-\d{2}$/;
        for (const key of model.monthKeys) {
            assert.ok(YYYY_MM.test(key), `invalid monthKey: "${key}"`);
        }
        assert.deepEqual(model.monthKeys, MONTHS);
    });

    // ── ISO guard regression ─────────────────────────────────────────

    test('all items in dated have valid ISO dates after ISO guard', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: false, text: 'Good',          date: '2026-05-01' },
            { id: 'a#t2', fileId: 'a', done: false, text: 'Should be gone', date: 'not-a-date' },
            { id: 'a#t3', fileId: 'a', done: false, text: 'Also gone',      date: '2026-5-1' }
        ], new Map([['a', { type: 'note' }]]), '2026-05-01');

        const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
        for (const row of model.dated) {
            assert.ok(ISO_DATE.test(row.date), `non-ISO date in dated: "${row.date}"`);
        }
        assert.equal(model.dated.length, 1);
        assert.equal(model.undated.length, 2);
    });

    // ── renderSummary open count: date-kind must not inflate open count (bug #2) ─

    test('stats.completed counts only task rows marked done, not date-kind notes', () => {
        const model = buildCalendarModel([
            { id: 'a#t1', fileId: 'a', done: true,  text: 'Done task',  date: '2026-06-01' },
            { id: 'a#t2', fileId: 'a', done: false, text: 'Open task',  date: '2026-06-02' }
        ], new Map([
            ['a', { type: 'note' }],
            ['evt', { type: 'event', date: '2026-06-03', name: 'Conf' }]
        ]), '2026-06-01');

        const taskItems  = model.dated.filter(r => r.itemKind === 'task');
        const dateItems  = model.dated.filter(r => r.itemKind === 'date');
        const openTasks  = taskItems.filter(r => !r.done).length;
        const doneTasks  = taskItems.filter(r => r.done).length;

        assert.equal(dateItems.length, 1,      'one date-kind item present');
        assert.equal(openTasks, 1,             'exactly one open task');
        assert.equal(doneTasks, 1,             'exactly one done task');
        assert.equal(model.stats.completed, 1, 'stats.completed = done task count only');
    });

    // ── agenda pill: date-kind items must show "note", not "open" (bug #3) ──────

    test('date-kind items carry itemKind=date, not task (pill label correctness)', () => {
        const model = buildCalendarModel([], new Map([
            ['note-a', { type: 'meeting', date: '2026-07-10', name: 'Planning' }]
        ]), '2026-07-10');

        const row = model.dated.find(r => r.fileId === 'note-a');
        assert.ok(row, 'date-kind item present in dated');
        assert.equal(row.itemKind, 'date',  'itemKind is "date", not "task"');
        assert.equal(row.done, false,        'done=false for note items');
        const pillLabel = row.itemKind === 'task'
            ? (row.done ? 'done' : 'open')
            : (row.itemKind === 'created' ? 'created' : 'note');
        assert.equal(pillLabel, 'note', 'pill label for date-kind item is "note"');
    });
});

// ── stripFrontmatter regression (bug #4) ─────────────────────────────────────

const { parseTasksFromContent } = require('../src/core/tasks');

describe('stripFrontmatter regression', () => {
    test('--- inside a frontmatter value does not truncate body', () => {
        const content = [
            '---',
            'id: test-node',
            'status: ---pending---',
            '---',
            '- [ ] Real task 2026-08-01'
        ].join('\n');
        const rows = parseTasksFromContent(content, 'test-node', '/v/test-node.md');
        assert.equal(rows.length, 1, 'task after real closing --- must be parsed');
        assert.equal(rows[0].date, '2026-08-01');
    });

    test('--- as the only non-opening marker still correctly strips', () => {
        const content = [
            '---',
            'id: clean',
            'type: note',
            '---',
            '- [ ] Task here 2026-09-15'
        ].join('\n');
        const rows = parseTasksFromContent(content, 'clean', '/v/clean.md');
        assert.equal(rows.length, 1);
        assert.equal(rows[0].date, '2026-09-15');
    });

    test('content with no frontmatter is parsed normally', () => {
        const rows = parseTasksFromContent(
            '- [ ] No frontmatter task 2026-10-01',
            'bare', '/v/bare.md'
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].date, '2026-10-01');
    });
});

// helper used inside a test above
function safeLocaleCompare(a, b) {
    return String(a || '').localeCompare(String(b || ''));
}

Module._resolveFilename = originalResolve;
