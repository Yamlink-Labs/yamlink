'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { normaliseDateInput, extractDateFromText } = require('../src/core/date');
const { parseTasksFromContent } = require('../src/core/tasks');

describe('date utils', () => {
    test('normalises year-first numeric dates', () => {
        assert.equal(normaliseDateInput('2026/03/26'), '2026-03-26');
        assert.equal(normaliseDateInput('2026.3.5'), '2026-03-05');
    });

    test('normalises day-first and textual dates', () => {
        assert.equal(normaliseDateInput('26/03/2026'), '2026-03-26');
        assert.equal(normaliseDateInput('26 March 2026'), '2026-03-26');
        assert.equal(normaliseDateInput('March 26, 2026'), '2026-03-26');
    });

    test('extracts the first supported date from prose', () => {
        assert.equal(extractDateFromText('Review notes on 26 Mar 2026 with [[johnny-rico]]'), '2026-03-26');
    });
});

describe('task date parsing', () => {
    test('task rows inherit normalised dates and stable block ids', () => {
        const rows = parseTasksFromContent([
            '---',
            'id: mission-alpha',
            'type: mission',
            '---',
            '- [ ] Brief squad on 26/03/2026',
            '- [x] Close report March 27, 2026'
        ].join('\n'), 'mission-alpha', '/vault/mission-alpha.md');

        assert.equal(rows.length, 2);
        assert.equal(rows[0].date, '2026-03-26');
        assert.equal(rows[1].date, '2026-03-27');
        assert.ok(rows[0].id.startsWith('mission-alpha#t1-'));
    });
});
