'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { normaliseDateInput, extractDateFromText, resolveDateShortcutToken, buildDateShortcutEntries, daysBetweenIso, addDaysIso } = require('../src/core/date');

describe('date parsing', () => {
    test('supports abbreviated month names and ordinal day suffixes', () => {
        assert.equal(normaliseDateInput('Mar 26th 2026'), '2026-03-26');
        assert.equal(normaliseDateInput('26th Mar 2026'), '2026-03-26');
        assert.equal(normaliseDateInput('September 1st, 2026'), '2026-09-01');
    });

    test('supports month-day inputs without a year using the reference year', () => {
        assert.equal(normaliseDateInput('Mar 26', '2026-04-28'), '2026-03-26');
        assert.equal(normaliseDateInput('26 Mar', '2026-04-28'), '2026-03-26');
    });

    test('extracts due/by weekday phrases from task text', () => {
        assert.equal(extractDateFromText('Send draft by Friday', '2026-04-28'), '2026-05-01');
        assert.equal(extractDateFromText('Follow up due next Tue', '2026-04-28'), '2026-05-05');
    });

    test('resolves @date shortcut tokens into canonical iso dates', () => {
        assert.equal(resolveDateShortcutToken('@today', '2026-05-04'), '2026-05-04');
        assert.equal(resolveDateShortcutToken('tomorrow', '2026-05-04'), '2026-05-05');
        assert.equal(resolveDateShortcutToken('next-week', '2026-05-04'), '2026-05-11');
        assert.equal(resolveDateShortcutToken('friday', '2026-05-04'), '2026-05-08');
    });

    test('builds date shortcut completion entries with labels and iso output', () => {
        const entries = buildDateShortcutEntries('2026-05-04');
        const today = entries.find(entry => entry.token === 'today');
        const friday = entries.find(entry => entry.token === 'friday');
        assert.ok(today);
        assert.equal(today.iso, '2026-05-04');
        assert.ok(friday);
        assert.equal(friday.iso, '2026-05-08');
    });

    test('daysBetweenIso is b minus a, in whole days — used by mathExpr.js\'s days_between() formula function', () => {
        assert.equal(daysBetweenIso('2026-01-01', '2026-01-15'), 14);
        assert.equal(daysBetweenIso('2026-01-15', '2026-01-01'), -14);
        assert.equal(daysBetweenIso('2026-01-01', '2026-01-01'), 0);
    });

    test('daysBetweenIso crosses a month/year boundary correctly', () => {
        assert.equal(daysBetweenIso('2025-12-20', '2026-01-05'), 16);
    });

    test('daysBetweenIso returns null for a malformed input, matching addDaysIso\'s own null-on-malformed convention', () => {
        assert.equal(daysBetweenIso('not-a-date', '2026-01-01'), null);
        assert.equal(daysBetweenIso('2026-01-01', ''), null);
    });

    test('daysBetweenIso and addDaysIso round-trip: adding the difference back gets you to the other date', () => {
        const diff = daysBetweenIso('2026-01-01', '2026-03-15');
        assert.equal(addDaysIso('2026-01-01', diff), '2026-03-15');
    });
});
