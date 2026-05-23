'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { normaliseDateInput, extractDateFromText, resolveDateShortcutToken, buildDateShortcutEntries } = require('../src/core/date');

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
});
