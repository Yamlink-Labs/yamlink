'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    summarizeTaskNotifications,
    buildNotificationFingerprint
} = require('../src/runtime/taskNotifications');

describe('task notifications', () => {
    test('prioritizes overdue tasks before due-today tasks', () => {
        const summary = summarizeTaskNotifications([
            { id: 'b', fileId: 'beta', line: 2, done: false, date: '2026-06-18' },
            { id: 'a', fileId: 'alpha', line: 1, done: false, date: '2026-06-17' }
        ], '2026-06-18', { maxItemsPerAlert: 3 });

        assert.equal(summary.overdueCount, 1);
        assert.equal(summary.dueTodayCount, 1);
        assert.equal(summary.severity, 'warning');
        assert.deepEqual(summary.items.map((item) => item.id), ['a', 'b']);
    });

    test('ignores completed and undated tasks', () => {
        const summary = summarizeTaskNotifications([
            { id: 'done', done: true, date: '2026-06-17' },
            { id: 'undated', done: false, date: null }
        ], '2026-06-18');

        assert.equal(summary.shouldNotify, false);
        assert.equal(summary.message, '');
    });

    test('respects overdue and due-today toggles', () => {
        const rows = [
            { id: 'overdue', done: false, date: '2026-06-17' },
            { id: 'today', done: false, date: '2026-06-18' }
        ];

        const overdueOnly = summarizeTaskNotifications(rows, '2026-06-18', { includeDueToday: false });
        assert.equal(overdueOnly.overdueCount, 1);
        assert.equal(overdueOnly.dueTodayCount, 0);

        const todayOnly = summarizeTaskNotifications(rows, '2026-06-18', { includeOverdue: false });
        assert.equal(todayOnly.overdueCount, 0);
        assert.equal(todayOnly.dueTodayCount, 1);
        assert.equal(todayOnly.severity, 'info');
    });

    test('limits items per alert without losing aggregate counts', () => {
        const summary = summarizeTaskNotifications([
            { id: 'a', done: false, date: '2026-06-16' },
            { id: 'b', done: false, date: '2026-06-17' },
            { id: 'c', done: false, date: '2026-06-18' }
        ], '2026-06-18', { maxItemsPerAlert: 2 });

        assert.equal(summary.overdueCount, 2);
        assert.equal(summary.dueTodayCount, 1);
        assert.equal(summary.items.length, 2);
    });

    test('fingerprint changes when task state changes', () => {
        const summaryA = summarizeTaskNotifications([
            { id: 'a', done: false, date: '2026-06-17' }
        ], '2026-06-18');
        const summaryB = summarizeTaskNotifications([
            { id: 'a', done: false, date: '2026-06-17' },
            { id: 'b', done: false, date: '2026-06-18' }
        ], '2026-06-18');

        assert.notEqual(buildNotificationFingerprint(summaryA), buildNotificationFingerprint(summaryB));
    });
});
