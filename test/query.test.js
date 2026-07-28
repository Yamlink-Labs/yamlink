// test/query.test.js
// Yamlink query engine test suite
//
// Runner: Node built-in (node:test) — no extra dependencies.
// Run:    npm test
//
// Coverage:
//   parseSingleViewBlock / parseSingleViewLine
//     - type parsing (named, wildcard, incoming)
//     - via clause
//     - where: eq scalar, eq relation, contains, body, any, inline AND, multi-line
//     - select, sort asc/desc, limit, label
//     - malformed / edge-case inputs
//   runQuery (forward)
//     - type filter, where eq, where contains, body contains, any contains
//     - multi-where AND, sort, limit, structured error return
//   runQuery (reverse / incoming)
//     - basic, via filter, sort, limit, no-context error
//   buildQueryString
//     - forward roundtrip, incoming roundtrip, contains roundtrip

'use strict';

const { test, describe } = require('node:test');
const assert             = require('node:assert/strict');
const { getTodayIsoLocal, addDaysIso } = require('../src/core/date');

// ─────────────────────────────────────────────────────────────────
// Dependency injection
//
// query.js uses require('../core/index') and require('../core/graph').
// We stub both before loading the module so tests run without a real
// vault on disk and without any VS Code APIs.
// ─────────────────────────────────────────────────────────────────

// Minimal vault used across most tests:
//   carl-jenkins   — character
//   johnny-rico    — character
//   mission-klendathu    — mission, body mentions "plasma bugs"
//   mission-klendathu-ii — mission
//   roughnecks     — unit

const MOCK_INDEX = new Map([
    ['carl-jenkins',          '/vault/carl-jenkins.md'],
    ['johnny-rico',           '/vault/johnny-rico.md'],
    ['mission-klendathu',     '/vault/mission-klendathu.md'],
    ['mission-klendathu-ii',  '/vault/mission-klendathu-ii.md'],
    ['roughnecks',            '/vault/roughnecks.md'],
    ['deal-alpha',            '/vault/deal-alpha.md'],
    ['deal-beta',             '/vault/deal-beta.md'],
    ['deal-gamma',            '/vault/deal-gamma.md'],
]);

const MOCK_FIELDS = new Map([
    ['carl-jenkins',         { type: 'character', name: 'Carl Jenkins', rank: 'Private', __yamlink_tags: 'psychic, intelligence' }],
    ['johnny-rico',          { type: 'character', name: 'Johnny Rico',  rank: 'Lieutenant' }],
    ['mission-klendathu',    { type: 'mission', intelligence: '[[carl-jenkins]]', commander: '[[johnny-rico]]', unit: '[[roughnecks]]', date: '2297-08-01', outcome: 'defeat', __yamlink_tags: 'combat, klendathu' }],
    ['mission-klendathu-ii', { type: 'mission', intelligence: '[[carl-jenkins]]', unit: '[[roughnecks]]', date: '2297-09-15', outcome: 'victory' }],
    ['roughnecks',           { type: 'unit', name: 'Roughnecks' }],
    ['deal-alpha',           { type: 'deal', value: '2', stage: 'open', date: '2026-05-03' }],
    ['deal-beta',            { type: 'deal', value: '10', stage: 'won', date: '2026-05-12' }],
    ['deal-gamma',           { type: 'deal', value: '100', stage: 'open', date: '2026-05-20' }],
]);

const MOCK_BACKLINKS = new Map([
    ['carl-jenkins', [
        { field: 'intelligence', sourceId: 'mission-klendathu'    },
        { field: 'intelligence', sourceId: 'mission-klendathu-ii' },
    ]],
    ['johnny-rico', [
        { field: 'commander', sourceId: 'mission-klendathu' },
    ]],
    ['roughnecks', [
        { field: 'unit', sourceId: 'mission-klendathu'    },
        { field: 'unit', sourceId: 'mission-klendathu-ii' },
    ]],
]);

const MOCK_EDGES = new Map([
    ['mission-klendathu', [
        { field: 'intelligence', targetId: 'carl-jenkins' },
        { field: 'commander', targetId: 'johnny-rico' },
        { field: 'unit', targetId: 'roughnecks' },
    ]],
    ['mission-klendathu-ii', [
        { field: 'intelligence', targetId: 'carl-jenkins' },
        { field: 'unit', targetId: 'roughnecks' },
    ]],
]);

// Body content keyed by filePath — used by readBody stub
const MOCK_BODIES = new Map([
    ['/vault/mission-klendathu.md',    'fleet took massive losses from plasma bugs before anyone understood what was hitting them'],
    ['/vault/mission-klendathu-ii.md', 'second assault on klendathu — more careful this time'],
    ['/vault/carl-jenkins.md',         'psychic ability confirmed during bug war intelligence operations'],
    ['/vault/johnny-rico.md',          'volunteered for mobile infantry'],
    ['/vault/roughnecks.md',           'elite mobile infantry squad'],
]);

// Inject stubs into Node module cache before requiring query.js
const Module = require('module');
const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (req, parent, ...rest) {
    if (req === '../core/index') return '__stub_index__';
    if (req === '../core/indexService') return '__stub_index__';
    if (req === '../core/graph') return '__stub_graph__';
    if (req === '../core/tasks') return '__stub_tasks__';
    return _origResolve(req, parent, ...rest);
};
require.cache['__stub_index__'] = {
    id: '__stub_index__', filename: '__stub_index__', loaded: true,
    exports: {
        getIndex:      () => MOCK_INDEX,
        getFieldsCache: () => MOCK_FIELDS,
        getVaultGeneration: () => 0
    }
};
require.cache['__stub_graph__'] = {
    id: '__stub_graph__', filename: '__stub_graph__', loaded: true,
    exports: {
        getBacklinks: (id) => MOCK_BACKLINKS.get(id) ?? [],
        getEdges: (id) => MOCK_EDGES.get(id) ?? [],
        computeNodeExplorerScore: (id, fieldsCache) => {
            const edges = MOCK_EDGES.get(id) ?? [];
            const backlinks = MOCK_BACKLINKS.get(id) ?? [];
            const relationFields = new Set();
            const relatedTypes = new Set();
            let strongEdges = 0;
            for (const edge of edges) {
                const label = edge.field === 'body' ? 'mention' : edge.field;
                relationFields.add(label);
                relatedTypes.add(String((fieldsCache.get(edge.targetId) || {}).type || 'unknown'));
                if (label !== 'mention') strongEdges += 1;
            }
            for (const edge of backlinks) {
                const label = edge.field === 'body' ? 'mention' : edge.field;
                relationFields.add(label);
                relatedTypes.add(String((fieldsCache.get(edge.sourceId) || {}).type || 'unknown'));
                if (label !== 'mention') strongEdges += 1;
            }
            const tagCount = String((fieldsCache.get(id) || {}).__yamlink_tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).length;
            const weightedDegree = (edges.length + backlinks.length) * 2.55;
            return Math.round(((weightedDegree * 2.2) + (relationFields.size * 1.4) + (relatedTypes.size * 1.1) + (strongEdges * 0.75) + (Math.min(tagCount, 4) * 0.25)) * 100) / 100;
        },
    }
};
const todayIso = getTodayIsoLocal();
require.cache['__stub_tasks__'] = {
    id: '__stub_tasks__', filename: '__stub_tasks__', loaded: true,
    exports: {
        buildTaskRows: () => ([
            {
                id: 'carl-jenkins#t0-overdue',
                fileId: 'carl-jenkins',
                filePath: '/vault/carl-jenkins.md',
                line: 3,
                text: 'Follow up on overdue intel',
                done: false,
                date: addDaysIso(todayIso, -2),
                links: [],
                fields: { text: 'Follow up on overdue intel', done: 'false', date: addDaysIso(todayIso, -2), file: 'carl-jenkins', line: '3' },
                nodeType: 'tasks'
            },
            {
                id: 'mission-klendathu#t1-alpha',
                fileId: 'mission-klendathu',
                filePath: '/vault/mission-klendathu.md',
                line: 8,
                text: 'Brief squad',
                done: false,
                date: todayIso,
                links: ['johnny-rico'],
                fields: { text: 'Brief squad', done: 'false', date: todayIso, file: 'mission-klendathu', line: '8' },
                nodeType: 'tasks'
            },
            {
                id: 'mission-klendathu-ii#t2-beta',
                fileId: 'mission-klendathu-ii',
                filePath: '/vault/mission-klendathu-ii.md',
                line: 9,
                text: 'Debrief command',
                done: false,
                date: addDaysIso(todayIso, 5),
                links: ['carl-jenkins'],
                fields: { text: 'Debrief command', done: 'false', date: addDaysIso(todayIso, 5), file: 'mission-klendathu-ii', line: '9' },
                nodeType: 'tasks'
            },
            {
                id: 'roughnecks#t3-gamma',
                fileId: 'roughnecks',
                filePath: '/vault/roughnecks.md',
                line: 4,
                text: 'Archive old notes',
                done: true,
                date: addDaysIso(todayIso, 20),
                links: [],
                fields: { text: 'Archive old notes', done: 'true', date: addDaysIso(todayIso, 20), file: 'roughnecks', line: '4' },
                nodeType: 'tasks'
            },
            {
                id: 'johnny-rico#t4-delta',
                fileId: 'johnny-rico',
                filePath: '/vault/johnny-rico.md',
                line: 7,
                text: 'Add a date later',
                done: false,
                date: '',
                links: [],
                fields: { text: 'Add a date later', done: 'false', date: '', file: 'johnny-rico', line: '7' },
                nodeType: 'tasks'
            }
        ])
    }
};

// Stub fs.readFileSync and fs.statSync so body-read tests don't hit disk.
// We override only for paths present in MOCK_BODIES.
const fs     = require('fs');
const origRead = fs.readFileSync.bind(fs);
const origStat = fs.statSync.bind(fs);
fs.readFileSync = function (p, enc) {
    if (MOCK_BODIES.has(p)) {
        // Wrap body in minimal frontmatter so readBody() strips it correctly
        return `---\nid: stub\n---\n${MOCK_BODIES.get(p)}`;
    }
    return origRead(p, enc);
};
fs.statSync = function (p) {
    if (MOCK_BODIES.has(p)) return { birthtimeMs: 1000, mtimeMs: 946684800000 };  // created 1970-01-01, modified 2000-01-01
    return origStat(p);
};

const {
    parseSingleViewLine,
    parseSingleViewBlock,
    parseAllViewQueries,
    runQuery,
    buildQueryString,
    clearBodyCache,
} = require('../src/engine/query.js');

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
function ids(result) {
    return result.rows.map(r => r.id).sort();
}

// ─────────────────────────────────────────────────────────────────
// PARSER TESTS
// ─────────────────────────────────────────────────────────────────

describe('parseSingleViewBlock — type', () => {

    test('named type', () => {
        const q = parseSingleViewLine('!view mission');
        assert.equal(q.type, 'mission');
        assert.equal(q.incoming, false);
    });

    test('wildcard type *', () => {
        const q = parseSingleViewLine('!view *');
        assert.equal(q.type, '*');
    });

    test('incoming named type', () => {
        const q = parseSingleViewLine('!view incoming mission');
        assert.equal(q.incoming, true);
        assert.equal(q.type, 'mission');
    });

    test('incoming wildcard', () => {
        const q = parseSingleViewLine('!view incoming *');
        assert.equal(q.incoming, true);
        assert.equal(q.type, '*');
    });

    test('returns null for missing type token', () => {
        const q = parseSingleViewLine('!view');
        assert.equal(q, null);
    });

    test('label parsed via pipe', () => {
        const q = parseSingleViewLine('!view mission | Active Missions');
        assert.equal(q.label, 'Active Missions');
        assert.equal(q.type, 'mission');
    });

    test('calendar shorthand targets tasks preset', () => {
        const q = parseSingleViewLine('!view calendar');
        assert.equal(q.type, 'tasks');
        assert.equal(q.preset, 'calendar');
    });

    test('today shorthand targets tasks preset', () => {
        const q = parseSingleViewLine('!view today');
        assert.equal(q.type, 'tasks');
        assert.equal(q.preset, 'today');
    });

});

describe('parseSingleViewBlock — via', () => {

    test('via clause parsed', () => {
        const q = parseSingleViewLine('!view incoming mission via intelligence');
        assert.equal(q.via, 'intelligence');
    });

    test('no via clause → null', () => {
        const q = parseSingleViewLine('!view incoming mission');
        assert.equal(q.via, null);
    });

});

describe('parseSingleViewBlock — where', () => {

    test('eq relation [[id]]', () => {
        const q = parseSingleViewLine('!view mission where commander = [[johnny-rico]]');
        assert.equal(q.wheres.length, 1);
        assert.equal(q.wheres[0].field, 'commander');
        assert.equal(q.wheres[0].op, 'eq');
        assert.equal(q.wheres[0].value, 'johnny-rico');
    });

    test('eq scalar value', () => {
        const q = parseSingleViewLine('!view mission where outcome = victory');
        assert.equal(q.wheres[0].op, 'eq');
        assert.equal(q.wheres[0].value, 'victory');
    });

    test('eq alias "is" parses scalar values too', () => {
        const q = parseSingleViewLine('!view mission where outcome is victory');
        assert.equal(q.wheres[0].op, 'eq');
        assert.equal(q.wheres[0].value, 'victory');
    });

    test('eq alias "is" parses relation values too', () => {
        const q = parseSingleViewLine('!view mission where commander is [[johnny-rico]]');
        assert.equal(q.wheres[0].op, 'eq');
        assert.equal(q.wheres[0].value, 'johnny-rico');
        assert.equal(q.wheres[0].valueKind, 'relation');
    });

    test('contains unquoted', () => {
        const q = parseSingleViewLine('!view mission where outcome contains def');
        assert.equal(q.wheres[0].op, 'contains');
        assert.equal(q.wheres[0].value, 'def');
    });

    test('contains quoted phrase', () => {
        const q = parseSingleViewLine('!view mission where body contains "plasma bugs"');
        assert.equal(q.wheres[0].field, 'body');
        assert.equal(q.wheres[0].value, 'plasma bugs');
    });

    test('body contains', () => {
        const q = parseSingleViewLine('!view mission where body contains klendathu');
        assert.equal(q.wheres[0].field, 'body');
        assert.equal(q.wheres[0].op, 'contains');
    });

    test('any contains', () => {
        const q = parseSingleViewLine('!view * where any contains klendathu');
        assert.equal(q.wheres[0].field, 'any');
    });

    test('* alias for any', () => {
        const q = parseSingleViewLine('!view * where * contains roughnecks');
        assert.equal(q.wheres[0].field, 'any');
    });

    test('inline AND produces two conditions', () => {
        const q = parseSingleViewLine('!view mission where commander = [[johnny-rico]] and unit = [[roughnecks]]');
        assert.equal(q.wheres.length, 2);
        assert.equal(q.wheres[0].field, 'commander');
        assert.equal(q.wheres[1].field, 'unit');
    });

    test('multi-line where produces two conditions', () => {
        const q = parseSingleViewBlock([
            '!view mission',
            'where commander = [[johnny-rico]]',
            'where unit = [[roughnecks]]',
        ]);
        assert.equal(q.wheres.length, 2);
    });

    test('backward compat: query.where points to first condition', () => {
        const q = parseSingleViewLine('!view mission where commander = [[johnny-rico]]');
        assert.notEqual(q.where, null);
        assert.equal(q.where.field, 'commander');
    });

    test('no where clause → empty wheres array', () => {
        const q = parseSingleViewLine('!view mission');
        assert.equal(q.wheres.length, 0);
        assert.equal(q.where, null);
    });

    test('same-field OR produces op:in with values array', () => {
        const q = parseSingleViewLine('!view mission where outcome = victory or defeat');
        assert.equal(q.wheres[0].op, 'in');
        assert.deepEqual(q.wheres[0].values, ['victory', 'defeat']);
    });

    test('same-field OR with three values', () => {
        const q = parseSingleViewLine('!view mission where type = character or mission or unit');
        assert.equal(q.wheres[0].op, 'in');
        assert.equal(q.wheres[0].values.length, 3);
    });

    test('cross-field OR parses into a grouped disjunction', () => {
        const q = parseSingleViewLine('!view mission where outcome = victory or type = mission');
        assert.equal(q.whereGroups.length, 1);
        assert.equal(q.whereGroups[0].length, 2);
        assert.equal(q.whereGroups[0][0].field, 'outcome');
        assert.equal(q.whereGroups[0][1].field, 'type');
        assert.equal(q.parseWarnings.length, 0);
    });

    test('date-range >= parses as gte', () => {
        const q = parseSingleViewLine('!view mission where date >= 2297-09-01');
        assert.equal(q.wheres[0].op, 'gte');
        assert.equal(q.wheres[0].value, '2297-09-01');
    });

    test('date-range < parses as lt', () => {
        const q = parseSingleViewLine('!view mission where date < 2297-09-01');
        assert.equal(q.wheres[0].op, 'lt');
        assert.equal(q.wheres[0].value, '2297-09-01');
    });

    test('date-range <= parses as lte', () => {
        const q = parseSingleViewLine('!view mission where date <= 2297-09-15');
        assert.equal(q.wheres[0].op, 'lte');
        assert.equal(q.wheres[0].value, '2297-09-15');
    });

    test('today() parses as a date query function', () => {
        const q = parseSingleViewLine('!view tasks where date >= today()');
        assert.equal(q.wheres[0].op, 'gte');
        assert.equal(q.wheres[0].valueKind, 'date');
        assert.equal(q.wheres[0].valueSource, 'today()');
        assert.equal(q.wheres[0].value, todayIso);
    });

    test('days-from-now() parses as a relative date query function', () => {
        const q = parseSingleViewLine('!view tasks where date <= days-from-now(5)');
        assert.equal(q.wheres[0].op, 'lte');
        assert.equal(q.wheres[0].valueKind, 'date');
        assert.equal(q.wheres[0].valueSource, 'days-from-now(5)');
        assert.equal(q.wheres[0].value, addDaysIso(todayIso, 5));
    });

    test('date-range > parses as gt', () => {
        const q = parseSingleViewLine('!view mission where date > 2297-08-01');
        assert.equal(q.wheres[0].op, 'gt');
        assert.equal(q.wheres[0].value, '2297-08-01');
    });

    test('AND with date-range splits correctly', () => {
        const q = parseSingleViewLine('!view mission where outcome = victory and date >= 2297-09-01');
        assert.equal(q.wheres.length, 2);
        assert.equal(q.wheres[0].field, 'outcome');
        assert.equal(q.wheres[1].op, 'gte');
    });

});

describe('parseSingleViewBlock — select / sort / limit', () => {

    test('select preserves order', () => {
        const q = parseSingleViewBlock(['!view mission', 'select date, outcome, commander']);
        assert.deepEqual(q.select, ['date', 'outcome', 'commander']);
    });

    test('sort asc (default)', () => {
        const q = parseSingleViewLine('!view mission sort name');
        assert.equal(q.sort.field, 'name');
        assert.equal(q.sort.desc, false);
    });

    test('sort desc', () => {
        const q = parseSingleViewLine('!view mission sort date desc');
        assert.equal(q.sort.desc, true);
    });

    test('limit parsed as integer', () => {
        const q = parseSingleViewLine('!view mission limit 5');
        assert.equal(q.limit, 5);
    });

    test('all clauses together', () => {
        const q = parseSingleViewBlock([
            '!view mission',
            'select date, outcome',
            'where unit = [[roughnecks]]',
            'sort date desc',
            'limit 10',
        ]);
        assert.deepEqual(q.select, ['date', 'outcome']);
        assert.equal(q.wheres[0].field, 'unit');
        assert.equal(q.sort.desc, true);
        assert.equal(q.limit, 10);
    });

});

describe('parseAllViewQueries', () => {

    test('returns null when no !view blocks', () => {
        assert.equal(parseAllViewQueries('just some text'), null);
    });

    test('parses two blocks from one document', () => {
        const text = [
            '# Dashboard',
            '',
            '!view mission',
            'where unit = [[roughnecks]]',
            '',
            '!view character',
            'sort name',
        ].join('\n');
        const qs = parseAllViewQueries(text);
        assert.equal(qs.length, 2);
        assert.equal(qs[0].type, 'mission');
        assert.equal(qs[1].type, 'character');
    });

});

// ─────────────────────────────────────────────────────────────────
// runQuery — FORWARD
// ─────────────────────────────────────────────────────────────────

describe('runQuery — forward — OR and date-range', () => {

    test('where outcome = victory or defeat returns both missions', () => {
        const r = runQuery(parseSingleViewLine('!view mission where outcome = victory or defeat'));
        assert.deepEqual(ids(r), ['mission-klendathu', 'mission-klendathu-ii']);
    });

    test('where outcome = victory or defeat but only one exists returns one', () => {
        const r = runQuery(parseSingleViewLine('!view mission where outcome = victory or unknownval'));
        assert.deepEqual(ids(r), ['mission-klendathu-ii']);
    });

    test('where type = character or mission returns all of each', () => {
        const r = runQuery(parseSingleViewLine('!view * where type = character or mission'));
        assert.deepEqual(ids(r), ['carl-jenkins', 'johnny-rico', 'mission-klendathu', 'mission-klendathu-ii']);
    });

    test('where date >= 2297-09-01 returns only later missions', () => {
        const r = runQuery(parseSingleViewLine('!view mission where date >= 2297-09-01'));
        assert.deepEqual(ids(r), ['mission-klendathu-ii']);
    });

    test('where date > 2297-08-01 returns later mission', () => {
        const r = runQuery(parseSingleViewLine('!view mission where date > 2297-08-01'));
        assert.deepEqual(ids(r), ['mission-klendathu-ii']);
    });

    test('where date < 2297-09-01 returns earlier mission', () => {
        const r = runQuery(parseSingleViewLine('!view mission where date < 2297-09-01'));
        assert.deepEqual(ids(r), ['mission-klendathu']);
    });

    test('where date <= 2297-08-01 returns exact match', () => {
        const r = runQuery(parseSingleViewLine('!view mission where date <= 2297-08-01'));
        assert.deepEqual(ids(r), ['mission-klendathu']);
    });

    test('AND combining eq and date-range', () => {
        const r = runQuery(parseSingleViewLine('!view mission where outcome = victory and date >= 2297-09-01'));
        assert.deepEqual(ids(r), ['mission-klendathu-ii']);
    });

    test('date-range on field with no values returns empty', () => {
        const r = runQuery(parseSingleViewLine('!view character where date >= 2297-01-01'));
        assert.equal(r.rows.length, 0);
    });

    test('today() works in task queries', () => {
        const r = runQuery(parseSingleViewLine('!view tasks where date >= today()'));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), [
            'mission-klendathu#t1-alpha',
            'mission-klendathu-ii#t2-beta',
            'roughnecks#t3-gamma'
        ]);
    });

    test('days-from-now() limits upcoming tasks by relative date', () => {
        const r = runQuery(parseSingleViewLine('!view tasks where date <= days-from-now(5)'));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), [
            'carl-jenkins#t0-overdue',
            'mission-klendathu#t1-alpha',
            'mission-klendathu-ii#t2-beta'
        ]);
    });

});

describe('runQuery — forward — type filter', () => {

    test('null query returns success:false', () => {
        const r = runQuery(null);
        assert.equal(r.success, false);
        assert.ok(r.error);
    });

    test('type filter returns only matching nodes', () => {
        const r = runQuery(parseSingleViewLine('!view mission'));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), ['mission-klendathu', 'mission-klendathu-ii']);
    });

    test('wildcard * returns all nodes', () => {
        const r = runQuery(parseSingleViewLine('!view *'));
        assert.equal(r.rows.length, MOCK_INDEX.size);
    });

    test('type with no matches returns empty rows', () => {
        const r = runQuery(parseSingleViewLine('!view schema'));
        assert.equal(r.success, true);
        assert.equal(r.rows.length, 0);
    });

    test('calendar shorthand returns dated tasks', () => {
        const r = runQuery(parseSingleViewLine('!view calendar'));
        assert.equal(r.success, true);
        assert.equal(r.rows.length, 4);
        assert.ok(r.rows.every(row => row.fields.date));
    });

    test('today shorthand returns only today tasks', () => {
        const r = runQuery(parseSingleViewLine('!view today'));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), ['mission-klendathu#t1-alpha']);
    });

    test('upcoming shorthand excludes distant tasks', () => {
        const r = runQuery(parseSingleViewLine('!view upcoming'));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), ['mission-klendathu#t1-alpha', 'mission-klendathu-ii#t2-beta']);
    });

    test('open-tasks shorthand returns only incomplete tasks', () => {
        const r = runQuery(parseSingleViewLine('!view open-tasks'));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), ['carl-jenkins#t0-overdue', 'johnny-rico#t4-delta', 'mission-klendathu#t1-alpha', 'mission-klendathu-ii#t2-beta']);
    });

    test('done-tasks shorthand returns only completed tasks', () => {
        const r = runQuery(parseSingleViewLine('!view done-tasks'));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), ['roughnecks#t3-gamma']);
    });

    test('undated-tasks shorthand returns only tasks without dates', () => {
        const r = runQuery(parseSingleViewLine('!view undated-tasks'));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), ['johnny-rico#t4-delta']);
    });

    test('overdue shorthand returns incomplete tasks dated before today', () => {
        const r = runQuery(parseSingleViewLine('!view overdue'));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), ['carl-jenkins#t0-overdue']);
    });

});

describe('runQuery — forward — where', () => {

    test('where eq relation filters correctly', () => {
        const r = runQuery(parseSingleViewLine('!view mission where commander = [[johnny-rico]]'));
        assert.deepEqual(ids(r), ['mission-klendathu']);
    });

    test('where eq scalar', () => {
        const r = runQuery(parseSingleViewLine('!view mission where outcome = victory'));
        assert.deepEqual(ids(r), ['mission-klendathu-ii']);
    });

    test('where "is" scalar alias filters correctly', () => {
        const r = runQuery(parseSingleViewLine('!view mission where outcome is victory'));
        assert.deepEqual(ids(r), ['mission-klendathu-ii']);
    });

    test('where "is" relation alias filters correctly', () => {
        const r = runQuery(parseSingleViewLine('!view mission where commander is johnny-rico'));
        assert.deepEqual(ids(r), ['mission-klendathu']);
    });

    test('where contains frontmatter field', () => {
        const r = runQuery(parseSingleViewLine('!view character where name contains Rico'));
        assert.deepEqual(ids(r), ['johnny-rico']);
    });

    test('where body contains finds correct nodes', () => {
        clearBodyCache();
        const r = runQuery(parseSingleViewLine('!view mission where body contains "plasma bugs"'));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), ['mission-klendathu']);
    });

    test('where any contains searches fields and body', () => {
        clearBodyCache();
        // 'klendathu' appears in both mission IDs (via body) and in mission-klendathu body
        const r = runQuery(parseSingleViewLine('!view mission where any contains klendathu'));
        assert.equal(r.success, true);
        assert.ok(r.rows.length > 0);
    });

    test('multi-where AND: both conditions must pass', () => {
        const r = runQuery(parseSingleViewBlock([
            '!view mission',
            'where commander = [[johnny-rico]]',
            'where outcome = defeat',
        ]));
        assert.deepEqual(ids(r), ['mission-klendathu']);
    });

    test('multi-where AND: no match when second condition fails', () => {
        const r = runQuery(parseSingleViewBlock([
            '!view mission',
            'where commander = [[johnny-rico]]',
            'where outcome = victory',   // mission-klendathu outcome is defeat
        ]));
        assert.equal(r.rows.length, 0);
    });

});

describe('runQuery — forward — sort and limit', () => {

    test('sort asc by date', () => {
        const r = runQuery(parseSingleViewBlock(['!view mission', 'sort date']));
        assert.equal(r.rows[0].id, 'mission-klendathu');    // 2297-08-01 < 2297-09-15
    });

    test('sort desc by date', () => {
        const r = runQuery(parseSingleViewBlock(['!view mission', 'sort date desc']));
        assert.equal(r.rows[0].id, 'mission-klendathu-ii'); // 2297-09-15 first
    });

    test('limit trims result after sort', () => {
        const r = runQuery(parseSingleViewBlock(['!view mission', 'sort date desc', 'limit 1']));
        assert.equal(r.rows.length, 1);
        assert.equal(r.rows[0].id, 'mission-klendathu-ii');
    });

    test('sorts numeric values numerically instead of lexicographically', () => {
        const r = runQuery(parseSingleViewBlock(['!view deal', 'sort value desc']));
        assert.equal(r.rows[0].id, 'deal-gamma');
        assert.equal(r.rows[1].id, 'deal-beta');
        assert.equal(r.rows[2].id, 'deal-alpha');
    });

});

describe('runQuery — forward — columns', () => {

    test('select determines column order', () => {
        const r = runQuery(parseSingleViewBlock(['!view mission', 'select date, outcome']));
        assert.deepEqual(r.columns, ['id', 'date', 'outcome']);
    });

    test('id always prepended even if in select', () => {
        const r = runQuery(parseSingleViewBlock(['!view mission', 'select id, date']));
        assert.equal(r.columns[0], 'id');
        assert.equal(r.columns.filter(c => c === 'id').length, 1); // only once
    });

    test('wildcard * includes type column', () => {
        const r = runQuery(parseSingleViewLine('!view *'));
        assert.ok(r.columns.includes('type'));
    });

});

describe('runQuery — forward — structured error return', () => {

    test('always returns success, rows, columns, types, warnings, error', () => {
        const r = runQuery(parseSingleViewLine('!view mission'));
        assert.ok('success'  in r);
        assert.ok('rows'     in r);
        assert.ok('columns'  in r);
        assert.ok('types'    in r);
        assert.ok('warnings' in r);
        assert.ok('error'    in r);
    });

    test('successful query has error:null', () => {
        const r = runQuery(parseSingleViewLine('!view mission'));
        assert.equal(r.error, null);
        assert.equal(r.success, true);
    });

    test('suggests close type names when no rows match', () => {
        const r = runQuery(parseSingleViewLine('!view charactrer'));
        assert.equal(r.success, true);
        assert.equal(r.rows.length, 0);
        assert.ok(r.warnings.some(w => w.includes('Did you mean "character"')));
    });

    test('warns when where id targets an unknown node', () => {
        const r = runQuery(parseSingleViewBlock(['!view *', 'where id = missing-node']));
        assert.equal(r.success, true);
        assert.equal(r.rows.length, 0);
        assert.ok(r.warnings.some(w => w.includes('No indexed node with id "missing-node"')));
    });

    test('suggests close field names when a filter field is uncommon', () => {
        const r = runQuery(parseSingleViewBlock(['!view mission', 'where comandr = [[johnny-rico]]']));
        assert.equal(r.success, true);
        assert.equal(r.rows.length, 0);
        assert.ok(r.warnings.some(w => w.includes('Try "commander" instead')));
    });

    test('suggests close sort fields when sort is uncommon', () => {
        const r = runQuery(parseSingleViewBlock(['!view mission', 'sort dat desc']));
        assert.equal(r.success, true);
        assert.equal(r.rows.length, 2);
        assert.ok(r.warnings.some(w => w.includes('Sort field "dat" is uncommon')));
    });

    test('cross-field OR runs as a grouped disjunction', () => {
        const r = runQuery(parseSingleViewLine('!view mission where outcome = victory or type = mission'));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), ['mission-klendathu', 'mission-klendathu-ii']);
    });

    test('cross-field OR combines with AND across where lines', () => {
        const r = runQuery(parseSingleViewBlock([
            '!view mission',
            'where outcome = victory or commander = [[carl-jenkins]]',
            'where date exists'
        ]));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), ['mission-klendathu-ii']);
    });

});

// ─────────────────────────────────────────────────────────────────
// runQuery — REVERSE (incoming)
// ─────────────────────────────────────────────────────────────────

describe('runQuery — incoming', () => {

    test('returns nodes that link TO contextNodeId', () => {
        const r = runQuery(parseSingleViewLine('!view incoming mission'), 'carl-jenkins');
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), ['mission-klendathu', 'mission-klendathu-ii']);
    });

    test('via filters by field name', () => {
        const r = runQuery(parseSingleViewLine('!view incoming mission via intelligence'), 'carl-jenkins');
        assert.deepEqual(ids(r), ['mission-klendathu', 'mission-klendathu-ii']);
    });

    test('via field with no matches returns empty', () => {
        const r = runQuery(parseSingleViewLine('!view incoming mission via commander'), 'carl-jenkins');
        assert.equal(r.rows.length, 0);
    });

    test('type filter applied to backlinks', () => {
        // roughnecks has backlinks from missions AND no unit-type nodes
        const r = runQuery(parseSingleViewLine('!view incoming character'), 'roughnecks');
        assert.equal(r.rows.length, 0); // missions link to roughnecks, not characters
    });

    test('wildcard type returns all backlink sources', () => {
        const r = runQuery(parseSingleViewLine('!view incoming *'), 'roughnecks');
        assert.equal(r.rows.length, 2); // both missions
    });

    test('missing contextNodeId returns structured error', () => {
        const r = runQuery(parseSingleViewLine('!view incoming mission'), null);
        assert.equal(r.success, false);
        assert.ok(r.error.toLowerCase().includes('context'));
    });

    test('sort applied to incoming results', () => {
        const r = runQuery(
            parseSingleViewBlock(['!view incoming mission', 'sort date desc']),
            'carl-jenkins'
        );
        assert.equal(r.rows[0].id, 'mission-klendathu-ii'); // 2297-09-15 > 2297-08-01
    });

    test('limit applied to incoming results', () => {
        const r = runQuery(
            parseSingleViewBlock(['!view incoming mission', 'limit 1']),
            'carl-jenkins'
        );
        assert.equal(r.rows.length, 1);
    });

    test('forward query unaffected when contextNodeId provided', () => {
        const r = runQuery(parseSingleViewLine('!view mission'), 'carl-jenkins');
        assert.equal(r.success, true);
        assert.equal(r.rows.length, 2); // forward: all missions
    });

    test('suggests close type names for incoming queries too', () => {
        const r = runQuery(parseSingleViewLine('!view incoming misson'), 'carl-jenkins');
        assert.equal(r.success, true);
        assert.equal(r.rows.length, 0);
        assert.ok(r.warnings.some(w => w.includes('Did you mean "mission"')));
    });

    test('suggests close via fields for incoming queries', () => {
        const r = runQuery(parseSingleViewLine('!view incoming mission via inteligence'), 'carl-jenkins');
        assert.equal(r.success, true);
        assert.equal(r.rows.length, 0);
        assert.ok(r.warnings.some(w => w.includes('Try "intelligence" instead')));
    });

    test('empty vault guidance still appears for incoming queries', () => {
        const originalIndexEntries = [...MOCK_INDEX.entries()];
        const originalFieldEntries = [...MOCK_FIELDS.entries()];
        MOCK_INDEX.clear();
        MOCK_FIELDS.clear();
        try {
            const r = runQuery(parseSingleViewLine('!view incoming mission'), 'carl-jenkins');
            assert.equal(r.success, true);
            assert.equal(r.rows.length, 0);
            assert.ok(r.warnings.some(w => w.includes('No indexed nodes found')));
        } finally {
            for (const [key, value] of originalIndexEntries) MOCK_INDEX.set(key, value);
            for (const [key, value] of originalFieldEntries) MOCK_FIELDS.set(key, value);
        }
    });

});

// ─────────────────────────────────────────────────────────────────
// buildQueryString
// ─────────────────────────────────────────────────────────────────

describe('buildQueryString', () => {

    test('forward query roundtrip', () => {
        const q = parseSingleViewBlock([
            '!view mission',
            'where commander = [[johnny-rico]]',
            'sort date desc',
            'limit 5',
        ]);
        const s = buildQueryString(q);
        assert.ok(s.startsWith('!view mission'));
        assert.ok(s.includes('where commander = [[johnny-rico]]'));
        assert.ok(s.includes('sort date desc'));
        assert.ok(s.includes('limit 5'));
    });

    test('contains roundtrip', () => {
        const q = parseSingleViewLine('!view mission where body contains klendathu');
        const s = buildQueryString(q);
        assert.ok(s.includes('where body contains klendathu'));
    });

    test('incoming roundtrip', () => {
        const q = parseSingleViewLine('!view incoming mission via intelligence');
        const s = buildQueryString(q);
        assert.equal(s, '!view incoming mission via intelligence');
    });

    test('label roundtrip', () => {
        const q = parseSingleViewLine('!view mission | Active Missions');
        const s = buildQueryString(q);
        assert.equal(s, '!view mission | Active Missions');
    });

    test('multi-where each on own line', () => {
        const q = parseSingleViewBlock([
            '!view mission',
            'where commander = [[johnny-rico]]',
            'where outcome = defeat',
        ]);
        const s = buildQueryString(q);
        const lines = s.split('\n');
        assert.equal(lines.filter(l => l.startsWith('where')).length, 2);
    });

    test('task preset shorthand roundtrip', () => {
        const q = parseSingleViewLine('!view calendar');
        assert.equal(buildQueryString(q), '!view calendar');
    });

    test('new task shorthand presets roundtrip', () => {
        assert.equal(buildQueryString(parseSingleViewLine('!view open-tasks')), '!view open-tasks');
        assert.equal(buildQueryString(parseSingleViewLine('!view done-tasks')), '!view done-tasks');
        assert.equal(buildQueryString(parseSingleViewLine('!view undated-tasks')), '!view undated-tasks');
        assert.equal(buildQueryString(parseSingleViewLine('!view overdue')), '!view overdue');
    });

    test('OR condition roundtrip', () => {
        const q = parseSingleViewLine('!view mission where outcome = victory or defeat');
        const s = buildQueryString(q);
        assert.ok(s.includes('where outcome = victory or defeat'));
    });

    test('cross-field OR roundtrip', () => {
        const q = parseSingleViewLine('!view mission where outcome = victory or commander = [[carl-jenkins]]');
        const s = buildQueryString(q);
        assert.ok(s.includes('where outcome = victory or commander = [[carl-jenkins]]'));
    });

    test('date-range >= roundtrip', () => {
        const q = parseSingleViewLine('!view mission where date >= 2297-09-01');
        const s = buildQueryString(q);
        assert.ok(s.includes('where date >= 2297-09-01'));
    });

    test('date-range < roundtrip', () => {
        const q = parseSingleViewLine('!view mission where date < 2297-09-01');
        const s = buildQueryString(q);
        assert.ok(s.includes('where date < 2297-09-01'));
    });

    test('today() roundtrip', () => {
        const q = parseSingleViewLine('!view tasks where date >= today()');
        assert.equal(buildQueryString(q), '!view tasks\nwhere date >= today()');
    });

    test('days-from-now() roundtrip', () => {
        const q = parseSingleViewLine('!view tasks where date <= days-from-now(5)');
        assert.equal(buildQueryString(q), '!view tasks\nwhere date <= days-from-now(5)');
    });

    test('neq scalar roundtrip', () => {
        const q = parseSingleViewLine('!view mission where outcome != victory');
        assert.equal(buildQueryString(q), '!view mission\nwhere outcome != victory');
    });

    test('neq relation roundtrip', () => {
        const q = parseSingleViewLine('!view mission where commander != [[johnny-rico]]');
        assert.equal(buildQueryString(q), '!view mission\nwhere commander != [[johnny-rico]]');
    });

    test('is empty roundtrip', () => {
        const q = parseSingleViewLine('!view deal where close-date is empty');
        assert.equal(buildQueryString(q), '!view deal\nwhere close-date is empty');
    });

    test('exists roundtrip', () => {
        const q = parseSingleViewLine('!view mission where date exists');
        assert.equal(buildQueryString(q), '!view mission\nwhere date exists');
    });

    test('#tag shorthand roundtrip', () => {
        const q = parseSingleViewLine('!view * where #combat');
        assert.equal(buildQueryString(q), '!view *\nwhere #combat');
    });

});

// ─────────────────────────────────────────────────────────────────
// neq operator
// ─────────────────────────────────────────────────────────────────

describe('parseSingleViewBlock — neq operator', () => {

    test('!= parses to neq op', () => {
        const q = parseSingleViewLine('!view mission where outcome != victory');
        assert.equal(q.wheres[0].op, 'neq');
        assert.equal(q.wheres[0].field, 'outcome');
        assert.equal(q.wheres[0].value, 'victory');
    });

    test('!= with [[relation]] value parses valueKind as relation', () => {
        const q = parseSingleViewLine('!view mission where commander != [[johnny-rico]]');
        assert.equal(q.wheres[0].op, 'neq');
        assert.equal(q.wheres[0].value, 'johnny-rico');
        assert.equal(q.wheres[0].valueKind, 'relation');
    });

});

describe('runQuery — forward — neq operator', () => {

    test('where outcome != victory excludes missions with that outcome', () => {
        const r = runQuery(parseSingleViewLine('!view mission where outcome != victory'));
        assert.deepEqual(ids(r), ['mission-klendathu']);
    });

    test('where outcome != defeat excludes missions with that outcome', () => {
        const r = runQuery(parseSingleViewLine('!view mission where outcome != defeat'));
        assert.deepEqual(ids(r), ['mission-klendathu-ii']);
    });

    test('where commander != [[johnny-rico]] returns missions without that commander', () => {
        const r = runQuery(parseSingleViewLine('!view mission where commander != [[johnny-rico]]'));
        // mission-klendathu-ii has no commander field (empty → not equal to johnny-rico)
        assert.deepEqual(ids(r), ['mission-klendathu-ii']);
    });

    test('neq on a missing field treats it as empty string (not equal to any non-empty value)', () => {
        const r = runQuery(parseSingleViewLine('!view unit where outcome != something'));
        // roughnecks has no outcome field — '' !== 'something' → matches
        assert.deepEqual(ids(r), ['roughnecks']);
    });

});

// ─────────────────────────────────────────────────────────────────
// empty / exists predicates
// ─────────────────────────────────────────────────────────────────

describe('parseSingleViewBlock — empty/exists predicates', () => {

    test('"is empty" parses to empty op', () => {
        const q = parseSingleViewLine('!view deal where close-date is empty');
        assert.equal(q.wheres[0].op, 'empty');
        assert.equal(q.wheres[0].field, 'close-date');
    });

    test('"is not empty" parses to exists op', () => {
        const q = parseSingleViewLine('!view mission where date is not empty');
        assert.equal(q.wheres[0].op, 'exists');
        assert.equal(q.wheres[0].field, 'date');
    });

    test('"exists" keyword parses to exists op', () => {
        const q = parseSingleViewLine('!view mission where outcome exists');
        assert.equal(q.wheres[0].op, 'exists');
        assert.equal(q.wheres[0].field, 'outcome');
    });

    test('empty/exists conditions are not filtered out by validWheres check', () => {
        const r = runQuery(parseSingleViewLine('!view mission where date is empty'));
        assert.equal(r.success, true);
    });

});

describe('runQuery — forward — empty/exists predicates', () => {

    test('where date exists returns only nodes that have a date field', () => {
        const r = runQuery(parseSingleViewLine('!view mission where date exists'));
        assert.deepEqual(ids(r), ['mission-klendathu', 'mission-klendathu-ii']);
    });

    test('where date is empty returns nodes with no date field', () => {
        const r = runQuery(parseSingleViewLine('!view character where date is empty'));
        assert.deepEqual(ids(r), ['carl-jenkins', 'johnny-rico']);
    });

    test('where outcome is empty returns only nodes with no outcome field', () => {
        const r = runQuery(parseSingleViewLine('!view unit where outcome is empty'));
        assert.deepEqual(ids(r), ['roughnecks']);
    });

    test('where commander is not empty matches only missions with a commander', () => {
        const r = runQuery(parseSingleViewLine('!view mission where commander is not empty'));
        assert.deepEqual(ids(r), ['mission-klendathu']);
    });

    test('exists and neq can be composed with AND', () => {
        const r = runQuery(parseSingleViewBlock([
            '!view mission',
            'where date exists',
            'where outcome != defeat',
        ]));
        assert.deepEqual(ids(r), ['mission-klendathu-ii']);
    });

});

// ─────────────────────────────────────────────────────────────────
// tag queries
// ─────────────────────────────────────────────────────────────────

describe('parseSingleViewBlock — tag queries', () => {

    test('#tag shorthand parses to __yamlink_tags contains', () => {
        const q = parseSingleViewLine('!view * where #combat');
        assert.equal(q.wheres[0].field, '__yamlink_tags');
        assert.equal(q.wheres[0].op, 'contains');
        assert.equal(q.wheres[0].value, 'combat');
        assert.equal(q.wheres[0].tagShorthand, true);
    });

    test('#tag is case-insensitive at parse time', () => {
        const q = parseSingleViewLine('!view * where #Psychic');
        assert.equal(q.wheres[0].value, 'psychic');
    });

});

describe('runQuery — forward — tag queries', () => {

    test('where #tag returns nodes tagged with that value', () => {
        const r = runQuery(parseSingleViewLine('!view * where #psychic'));
        assert.deepEqual(ids(r), ['carl-jenkins']);
    });

    test('where #tag matching multiple nodes', () => {
        // only mission-klendathu has 'combat' tag; carl-jenkins has 'psychic, intelligence'
        const r = runQuery(parseSingleViewLine('!view * where #combat'));
        assert.deepEqual(ids(r), ['mission-klendathu']);
    });

    test('__yamlink_tags not present in auto-columns', () => {
        const r = runQuery(parseSingleViewLine('!view *'));
        assert.ok(!r.columns.includes('__yamlink_tags'));
    });

    test('tag query AND neq compose correctly', () => {
        const r = runQuery(parseSingleViewBlock([
            '!view *',
            'where #combat',
            'where outcome != victory',
        ]));
        assert.deepEqual(ids(r), ['mission-klendathu']);
    });

});

// ─────────────────────────────────────────────────────────────────
// GROUP BY
// ─────────────────────────────────────────────────────────────────

describe('parseSingleViewBlock — group by', () => {

    test('group by <field> parses to groupBy property', () => {
        const q = parseSingleViewLine('!view * group by type');
        assert.equal(q.groupBy, 'type');
    });

    test('group by with where clause', () => {
        const q = parseSingleViewLine('!view mission where outcome = victory group by date');
        assert.equal(q.groupBy, 'date');
        assert.equal(q.wheres[0].field, 'outcome');
    });

    test('group by with sort count desc', () => {
        const q = parseSingleViewLine('!view * group by type sort count desc');
        assert.equal(q.groupBy, 'type');
        assert.deepStrictEqual(q.sort, { field: 'count', desc: true });
    });

    test('group by with limit', () => {
        const q = parseSingleViewLine('!view * group by type limit 3');
        assert.equal(q.groupBy, 'type');
        assert.equal(q.limit, 3);
    });

    test('multi-line group by is a continuation keyword', () => {
        const qs = parseAllViewQueries('!view deal\nwhere stage = open\ngroup by stage\nsort count desc');
        assert.ok(qs && qs.length === 1);
        assert.equal(qs[0].groupBy, 'stage');
        assert.deepStrictEqual(qs[0].sort, { field: 'count', desc: true });
        assert.equal(qs[0].wheres[0].field, 'stage');
    });

    test('no group by returns null groupBy', () => {
        const q = parseSingleViewLine('!view mission');
        assert.equal(q.groupBy, null);
    });

});


describe('runQuery — forward — group by', () => {

    test('group by type returns grouped result shape', () => {
        const r = runQuery(parseSingleViewLine('!view * group by type'), null);
        assert.ok(r.success);
        assert.ok(Array.isArray(r.groups));
        assert.equal(r.groupBy, 'type');
        assert.deepStrictEqual(r.columns, ['type', 'count']);
    });

    test('group by type has correct per-type counts', () => {
        const r = runQuery(parseSingleViewLine('!view * group by type'), null);
        const byType = Object.fromEntries(r.groups.map(g => [g.key, g.count]));
        assert.equal(byType['character'], 2);
        assert.equal(byType['mission'], 2);
        assert.equal(byType['deal'], 3);
        assert.equal(byType['unit'], 1);
    });

    test('groups sorted by count desc by default', () => {
        const r = runQuery(parseSingleViewLine('!view * group by type'), null);
        for (let i = 1; i < r.groups.length; i++) {
            assert.ok(r.groups[i - 1].count >= r.groups[i].count,
                `expected count[${i-1}]=${r.groups[i-1].count} >= count[${i}]=${r.groups[i].count}`);
        }
    });

    test('sort count (asc) reverses group order', () => {
        const r = runQuery(parseSingleViewLine('!view * group by type sort count'), null);
        for (let i = 1; i < r.groups.length; i++) {
            assert.ok(r.groups[i - 1].count <= r.groups[i].count,
                `expected count[${i-1}]=${r.groups[i-1].count} <= count[${i}]=${r.groups[i].count}`);
        }
    });

    test('group by deal stage gives correct bucket counts', () => {
        const r = runQuery(parseSingleViewLine('!view deal group by stage'), null);
        assert.ok(r.success);
        const byStage = Object.fromEntries(r.groups.map(g => [g.key, g.count]));
        assert.equal(byStage['open'], 2);
        assert.equal(byStage['won'], 1);
    });

    test('group by with limit caps number of groups', () => {
        const r = runQuery(parseSingleViewLine('!view * group by type limit 2'), null);
        assert.equal(r.groups.length, 2);
    });

    test('flat rows still present for export', () => {
        const r = runQuery(parseSingleViewLine('!view * group by type'), null);
        assert.ok(r.rows.length > 0);
        assert.equal(r.rows.length, MOCK_INDEX.size);
    });

    test('group by with where filter narrows before grouping', () => {
        const r = runQuery(parseSingleViewBlock([
            '!view mission',
            'where outcome = defeat',
            'group by outcome',
        ]), null);
        assert.ok(r.success);
        assert.equal(r.groups.length, 1);
        assert.equal(r.groups[0].key, 'defeat');
        assert.equal(r.groups[0].count, 1);
    });

});

// ─────────────────────────────────────────────────────────────────
// file.created / file.modified implicit query fields
// ─────────────────────────────────────────────────────────────────

describe('runQuery — forward — file.created and file.modified', () => {

    test('where file.modified exists matches notes whose files are stat-able', () => {
        const r = runQuery(parseSingleViewLine('!view character where file.modified exists'));
        assert.deepEqual(ids(r), ['carl-jenkins', 'johnny-rico']);
    });

    test('where file.created = 1970-01-01 matches notes with stub birthtimeMs', () => {
        const r = runQuery(parseSingleViewLine('!view character where file.created = 1970-01-01'));
        assert.deepEqual(ids(r), ['carl-jenkins', 'johnny-rico']);
    });

    test('where file.modified = 2000-01-01 matches notes with stub mtimeMs', () => {
        const r = runQuery(parseSingleViewLine('!view character where file.modified = 2000-01-01'));
        assert.deepEqual(ids(r), ['carl-jenkins', 'johnny-rico']);
    });

    test('where file.created >= 2000-01-01 matches nothing when birthtime is 1970', () => {
        const r = runQuery(parseSingleViewLine('!view character where file.created >= 2000-01-01'));
        assert.deepEqual(ids(r), []);
    });

    test('where file.modified < 2000-01-01 matches nothing when mtime is 2000-01-01', () => {
        const r = runQuery(parseSingleViewLine('!view character where file.modified < 2000-01-01'));
        assert.deepEqual(ids(r), []);
    });

    test('where file.modified >= 2000-01-01 matches all character notes', () => {
        const r = runQuery(parseSingleViewLine('!view character where file.modified >= 2000-01-01'));
        assert.deepEqual(ids(r), ['carl-jenkins', 'johnny-rico']);
    });

    test('where file.created empty returns nothing (file stat always resolves)', () => {
        const r = runQuery(parseSingleViewLine('!view character where file.created is empty'));
        assert.deepEqual(ids(r), []);
    });

});

describe('runQuery — forward — graph virtual fields', () => {

    test('where _inbound_count > 0 matches notes with backlinks', () => {
        const r = runQuery(parseSingleViewLine('!view character where _inbound_count > 0'));
        assert.deepEqual(ids(r), ['carl-jenkins', 'johnny-rico']);
    });

    test('select _hub_score exposes the computed hub score as a row field', () => {
        const r = runQuery(parseSingleViewLine('!view character select name, _hub_score'));
        const rico = r.rows.find(row => row.id === 'johnny-rico');
        assert.equal(r.columns.includes('_hub_score'), true);
        assert.equal(typeof rico.fields._hub_score, 'number');
        assert.ok(rico.fields._hub_score > 0);
    });

    test('sort _outbound_count desc orders notes by outgoing graph degree', () => {
        const r = runQuery(parseSingleViewLine('!view mission sort _outbound_count desc'));
        assert.deepEqual(ids(r), ['mission-klendathu', 'mission-klendathu-ii']);
        assert.equal(r.rows[0].fields._outbound_count, 3);
        assert.equal(r.rows[1].fields._outbound_count, 2);
    });

    test('zero-edge notes report graph virtual fields as 0', () => {
        const r = runQuery(parseSingleViewLine('!view deal select _inbound_count, _outbound_count, _hub_score'));
        const alpha = r.rows.find(row => row.id === 'deal-alpha');
        assert.equal(alpha.fields._inbound_count, 0);
        assert.equal(alpha.fields._outbound_count, 0);
        assert.equal(alpha.fields._hub_score, 0);
    });

});

describe('buildQueryString — group by', () => {

    test('group by serialises to "group by <field>"', () => {
        const q = parseSingleViewLine('!view deal group by stage');
        const s = buildQueryString(q);
        assert.ok(s.includes('group by stage'), `Expected "group by stage" in: ${s}`);
    });

    test('group by with sort count desc roundtrip', () => {
        const q = parseSingleViewLine('!view * group by type sort count desc');
        const s = buildQueryString(q);
        assert.ok(s.includes('group by type'));
        assert.ok(s.includes('sort count desc'));
    });


});
