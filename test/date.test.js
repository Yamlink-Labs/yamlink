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

    test('extracts relative and weekday dates from prose', () => {
        assert.equal(extractDateFromText('Follow up tomorrow with [[alpha]]', '2026-04-08'), '2026-04-09');
        assert.equal(extractDateFromText('Schedule review for Friday', '2026-04-08'), '2026-04-10');
        assert.equal(extractDateFromText('Prep notes by next Monday', '2026-04-08'), '2026-04-20');
        assert.equal(extractDateFromText('Close the loop end of month', '2026-04-08'), '2026-04-30');
        assert.equal(extractDateFromText('Ping them in 3 days', '2026-04-08'), '2026-04-11');
        assert.equal(extractDateFromText('Check in again in 2 weeks', '2026-04-08'), '2026-04-22');
        assert.equal(extractDateFromText('Review this weekend', '2026-04-08'), '2026-04-11');
        assert.equal(extractDateFromText('Ship next weekend', '2026-04-08'), '2026-04-18');
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

    test('task rows can extract natural-language dates from task text', () => {
        const rows = parseTasksFromContent([
            '- [ ] Call prospect Friday',
            '- [ ] Send wrap-up tomorrow',
            '- [ ] Re-open proposal in 3 days'
        ].join('\n'), 'crm-alpha', '/vault/crm-alpha.md', '2026-04-08');

        assert.equal(rows.length, 3);
        assert.equal(rows[0].date, '2026-04-10');
        assert.equal(rows[1].date, '2026-04-09');
        assert.equal(rows[2].date, '2026-04-11');
    });
});
