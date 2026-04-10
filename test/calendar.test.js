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

Module._resolveFilename = originalResolve;
