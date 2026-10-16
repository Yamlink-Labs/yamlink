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
    // chain-a -> chain-b -> chain-c -> chain-a: an isolated 3-cycle used only
    // by the "within N" multi-hop traversal tests below, own type
    // ('linkchain') so it never perturbs any existing type/wildcard assertion.
    ['chain-a',               '/vault/chain-a.md'],
    ['chain-b',               '/vault/chain-b.md'],
    ['chain-c',               '/vault/chain-c.md'],
    // own type ('calc-note'), same reasoning as chain-a/b/c above — never
    // perturbs any existing type/wildcard assertion.
    ['calc-note',             '/vault/calc-note.md'],
    ['calc-source',           '/vault/calc-source.md'],
    ['calc-ref',              '/vault/calc-ref.md'],
    // own type ('calc-agg'), used only by the aggregate-clause tests below —
    // never perturbs any existing calc-note/deal-scoped assertion (in
    // particular the exact-array `where cell.total > 2` check on calc-note).
    ['agg-one',               '/vault/agg-one.md'],
    ['agg-two',               '/vault/agg-two.md'],
    ['agg-three',             '/vault/agg-three.md'],
    // own type ('calc-fm'), used only by the frontmatter-valued-cell tests —
    // never perturbs any existing calc-note-scoped assertion.
    ['calc-fm',               '/vault/calc-fm.md'],
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
    ['chain-a',              { type: 'linkchain', name: 'Chain A', next: '[[chain-b]]' }],
    ['chain-b',              { type: 'linkchain', name: 'Chain B', next: '[[chain-c]]' }],
    ['chain-c',              { type: 'linkchain', name: 'Chain C', next: '[[chain-a]]' }],
    ['calc-note',            { type: 'calc-note', name: 'Calc Note' }],
    ['calc-source',          { type: 'calc-xref', name: 'Calc Source' }],
    ['calc-ref',             { type: 'calc-xref', name: 'Calc Ref' }],
    // calc-agg fixtures: budget is a plain frontmatter field (agg-three's
    // 'n/a' is deliberately non-numeric, for exclusion/null-aggregate tests)
    // alongside a cell.total inline calc in each note's body (see MOCK_BODIES).
    ['agg-one',              { type: 'calc-agg', name: 'Agg One', region: 'north', budget: '50' }],
    ['agg-two',              { type: 'calc-agg', name: 'Agg Two', region: 'north', budget: '150' }],
    ['agg-three',            { type: 'calc-agg', name: 'Agg Three', region: 'south', budget: 'n/a' }],
    // calc-fm: real numeric frontmatter fields a calc cell reads by name —
    // see MOCK_BODIES for the formula itself.
    ['calc-fm',              { type: 'calc-fm', name: 'Calc FM', price: 10, quantity: 3 }],
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
    // chain-a -> chain-b -> chain-c -> chain-a (a 3-cycle; see MOCK_INDEX note above)
    ['chain-a', [
        { field: 'next', sourceId: 'chain-c' },
    ]],
    ['chain-b', [
        { field: 'next', sourceId: 'chain-a' },
    ]],
    ['chain-c', [
        { field: 'next', sourceId: 'chain-b' },
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
    // chain-a -> chain-b -> chain-c -> chain-a (a 3-cycle; see MOCK_INDEX note above)
    ['chain-a', [
        { field: 'next', targetId: 'chain-b' },
    ]],
    ['chain-b', [
        { field: 'next', targetId: 'chain-c' },
    ]],
    ['chain-c', [
        { field: 'next', targetId: 'chain-a' },
    ]],
]);

// Body content keyed by filePath — used by readBody stub
const MOCK_BODIES = new Map([
    ['/vault/mission-klendathu.md',    'fleet took massive losses from plasma bugs before anyone understood what was hitting them'],
    ['/vault/mission-klendathu-ii.md', 'second assault on klendathu — more careful this time'],
    ['/vault/carl-jenkins.md',         'psychic ability confirmed during bug war intelligence operations'],
    ['/vault/johnny-rico.md',          'volunteered for mobile infantry'],
    ['/vault/roughnecks.md',           'elite mobile infantry squad'],
    ['/vault/calc-note.md',            'Apples: `total=1+2`. Double: `=total*3`. Also `=Y1+Y2`.'],
    ['/vault/calc-source.md',          '`total=40+2`'],
    ['/vault/calc-ref.md',             '`linked=[[calc-source]]^total + 8`'],
    ['/vault/agg-one.md',               '`total=1+2`'],
    ['/vault/agg-two.md',               '`total=4+6`'],
    ['/vault/agg-three.md',             '`total=90+10`'],
    ['/vault/calc-fm.md',               '`total=price*quantity`'],
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
        getVaultGeneration: () => 0,
        getBodyLinksCache: () => new Map()
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

describe('parseSingleViewBlock — linked_to / linked_from (VQL v1)', () => {

    test('linked_to clause parsed', () => {
        const q = parseSingleViewLine('!view * linked_to [[johnny-rico]]');
        assert.equal(q.linkedTo, 'johnny-rico');
        assert.equal(q.linkedFrom, null);
    });

    test('linked_from clause parsed', () => {
        const q = parseSingleViewLine('!view * linked_from [[mission-klendathu]]');
        assert.equal(q.linkedFrom, 'mission-klendathu');
        assert.equal(q.linkedTo, null);
    });

    test('no linked_to/linked_from clause → both null', () => {
        const q = parseSingleViewLine('!view *');
        assert.equal(q.linkedTo, null);
        assert.equal(q.linkedFrom, null);
    });

    test('linked_to does not get swallowed by an adjacent where clause', () => {
        const q = parseSingleViewLine('!view mission where outcome = victory linked_to [[johnny-rico]]');
        assert.equal(q.linkedTo, 'johnny-rico');
        assert.equal(q.wheres.length, 1);
        assert.equal(q.wheres[0].field, 'outcome');
    });

    test('linked_to/linked_from default depth is 1 when "within" is omitted', () => {
        const q = parseSingleViewLine('!view * linked_to [[johnny-rico]]');
        assert.equal(q.linkedToDepth, 1);
        const q2 = parseSingleViewLine('!view * linked_from [[johnny-rico]]');
        assert.equal(q2.linkedFromDepth, 1);
    });

    test('linked_to [[x]] within N parses a real depth', () => {
        const q = parseSingleViewLine('!view * linked_to [[chain-c]] within 2');
        assert.equal(q.linkedTo, 'chain-c');
        assert.equal(q.linkedToDepth, 2);
    });

    test('linked_from [[x]] within N parses a real depth', () => {
        const q = parseSingleViewLine('!view * linked_from [[chain-a]] within 3');
        assert.equal(q.linkedFrom, 'chain-a');
        assert.equal(q.linkedFromDepth, 3);
    });

    test('within 0 is out of range — warns, falls back to depth 1, no crash', () => {
        const q = parseSingleViewLine('!view * linked_from [[chain-a]] within 0');
        assert.equal(q.linkedFromDepth, 1);
        assert.ok(q.parseWarnings.some((w) => w.includes('out of range')));
    });

    test('within 6 (above the cap of 5) is out of range — warns, falls back to depth 1', () => {
        const q = parseSingleViewLine('!view * linked_from [[chain-a]] within 6');
        assert.equal(q.linkedFromDepth, 1);
        assert.ok(q.parseWarnings.some((w) => w.includes('out of range')));
    });

    test('within 5 (at the cap) is accepted', () => {
        const q = parseSingleViewLine('!view * linked_from [[chain-a]] within 5');
        assert.equal(q.linkedFromDepth, 5);
        assert.equal(q.parseWarnings.length, 0);
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

    test('explicit sort asc parses the same as omitting the keyword, not a trailing-token failure — a real bug found via sample-vault content: previously the whole clause silently failed to match (sort: null, no warning) whenever "asc" was written explicitly, since only "desc" was ever recognized as a direction keyword', () => {
        const q = parseSingleViewLine('!view mission sort date asc');
        assert.equal(q.sort.field, 'date');
        assert.equal(q.sort.desc, false);
        const qField = parseSingleViewLine('!view mission sort cell.total asc');
        assert.equal(qField.sort.field, 'cell.total');
        assert.equal(qField.sort.desc, false);
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

    test('plain linked_to (no within) never emits "within 1"', () => {
        const q = parseSingleViewLine('!view * linked_to [[johnny-rico]]');
        assert.equal(buildQueryString(q), '!view * linked_to [[johnny-rico]]');
    });

    test('linked_to [[x]] within N roundtrips with the real depth', () => {
        const q = parseSingleViewLine('!view * linked_to [[chain-c]] within 3');
        assert.equal(buildQueryString(q), '!view * linked_to [[chain-c]] within 3');
    });

    test('linked_from [[x]] within N roundtrips with the real depth', () => {
        const q = parseSingleViewLine('!view * linked_from [[chain-a]] within 2');
        assert.equal(buildQueryString(q), '!view * linked_from [[chain-a]] within 2');
    });

    test('an out-of-range within falls back to depth 1 and roundtrips without "within"', () => {
        const q = parseSingleViewLine('!view * linked_from [[chain-a]] within 99');
        assert.equal(buildQueryString(q), '!view * linked_from [[chain-a]]');
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

describe('parseSingleViewBlock — aggregate', () => {

    test('aggregate sum(field) as alias parses to a single-term array', () => {
        const q = parseSingleViewLine('!view * aggregate sum(cell.total) as total');
        assert.deepEqual(q.aggregate, [{ fn: 'sum', field: 'cell.total', alias: 'total' }]);
    });

    test('average(field) as alias parses with fn "average"', () => {
        const q = parseSingleViewLine('!view * aggregate average(cell.total) as avg_total');
        assert.deepEqual(q.aggregate, [{ fn: 'average', field: 'cell.total', alias: 'avg_total' }]);
    });

    test('avg(field) as alias is canonicalized to fn "average"', () => {
        const q = parseSingleViewLine('!view * aggregate avg(cell.total) as avg_total');
        assert.deepEqual(q.aggregate, [{ fn: 'average', field: 'cell.total', alias: 'avg_total' }]);
    });

    test('multiple comma-separated terms parse in order', () => {
        const q = parseSingleViewLine('!view * aggregate min(cell.total) as lowest, max(cell.total) as highest');
        assert.deepEqual(q.aggregate, [
            { fn: 'min', field: 'cell.total', alias: 'lowest' },
            { fn: 'max', field: 'cell.total', alias: 'highest' }
        ]);
    });

    test('bare count needs no field and defaults its alias to "count"', () => {
        const q = parseSingleViewLine('!view * aggregate count');
        assert.deepEqual(q.aggregate, [{ fn: 'count', field: null, alias: 'count' }]);
    });

    test('count as <alias> overrides the default alias', () => {
        const q = parseSingleViewLine('!view * aggregate count as n');
        assert.deepEqual(q.aggregate, [{ fn: 'count', field: null, alias: 'n' }]);
    });

    test('group by and aggregate coexist — neither swallows the other', () => {
        const q = parseSingleViewLine('!view * group by type aggregate sum(cell.total) as total');
        assert.equal(q.groupBy, 'type');
        assert.deepEqual(q.aggregate, [{ fn: 'sum', field: 'cell.total', alias: 'total' }]);
    });

    test('select does not swallow a following aggregate clause', () => {
        const q = parseSingleViewLine('!view * select name, cell.total aggregate sum(cell.total) as total');
        assert.deepEqual(q.select, ['name', 'cell.total']);
        assert.deepEqual(q.aggregate, [{ fn: 'sum', field: 'cell.total', alias: 'total' }]);
    });

    test('an aggregate term missing "as alias" is rejected with a warning, not a crash', () => {
        const q = parseSingleViewLine('!view * aggregate sum(cell.total)');
        assert.equal(q.aggregate, null);
        assert.ok(q.parseWarnings.some(w => /alias/i.test(w)));
    });

    test('a malformed aggregate term does not throw', () => {
        assert.doesNotThrow(() => parseSingleViewLine('!view * aggregate sum(('));
    });

    test('multi-line continuation keyword recognizes aggregate', () => {
        const qs = parseAllViewQueries('!view *\nselect name\naggregate sum(cell.total) as total');
        assert.ok(qs && qs.length === 1);
        assert.deepEqual(qs[0].select, ['name']);
        assert.deepEqual(qs[0].aggregate, [{ fn: 'sum', field: 'cell.total', alias: 'total' }]);
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

    test('sort _hub_score desc keeps zero-score notes after scored notes', () => {
        const r = runQuery(parseSingleViewLine('!view * sort _hub_score desc'));
        assert.ok(r.rows[0].fields._hub_score > 0);
        assert.equal(r.rows.at(-1).fields._hub_score, 0);
    });

    test('zero-edge notes report graph virtual fields as 0', () => {
        const r = runQuery(parseSingleViewLine('!view deal select _inbound_count, _outbound_count, _hub_score'));
        const alpha = r.rows.find(row => row.id === 'deal-alpha');
        assert.equal(alpha.fields._inbound_count, 0);
        assert.equal(alpha.fields._outbound_count, 0);
        assert.equal(alpha.fields._hub_score, 0);
    });

});

describe('runQuery — forward — inline calc virtual fields (cell.<name>)', () => {

    test('select cell.<name> exposes a note\'s named calc cell as a row field', () => {
        const r = runQuery(parseSingleViewLine('!view calc-note select name, cell.total'));
        const note = r.rows.find(row => row.id === 'calc-note');
        assert.equal(r.columns.includes('cell.total'), true);
        assert.equal(note.fields['cell.total'], 3);
    });

    test('select cell.<label> exposes a note\'s positional cell (named or not) the same way', () => {
        const r = runQuery(parseSingleViewLine('!view calc-note select cell.y1, cell.y2, cell.y3'));
        const note = r.rows[0];
        assert.equal(note.fields['cell.y1'], 3);  // total = 1+2
        assert.equal(note.fields['cell.y2'], 9);  // total*3
        assert.equal(note.fields['cell.y3'], 12); // Y1+Y2
    });

    test('where cell.<name> filters by the computed value', () => {
        const r = runQuery(parseSingleViewLine('!view calc-note where cell.total > 2'));
        assert.deepEqual(ids(r), ['calc-note']);
        const r2 = runQuery(parseSingleViewLine('!view calc-note where cell.total > 100'));
        assert.deepEqual(ids(r2), []);
    });

    test('sort cell.<name> orders numerically like any other virtual field', () => {
        const r = runQuery(parseSingleViewLine('!view calc-note sort cell.y3 desc'));
        assert.equal(r.rows[0].fields['cell.y3'], 12);
    });

    test('a cell that does not exist on the note is simply absent, never an error', () => {
        const r = runQuery(parseSingleViewLine('!view calc-note select cell.nonexistent'));
        assert.equal(r.success, true);
        assert.equal(r.rows[0].fields['cell.nonexistent'], undefined);
    });

    test('a note with no calc cells at all reports no cell.* fields', () => {
        const r = runQuery(parseSingleViewLine('!view character select name, cell.total'));
        const rico = r.rows.find(row => row.id === 'johnny-rico');
        assert.equal(rico.fields['cell.total'], undefined);
    });

    test('select cell.<name> resolves a cross-note-derived calc value', () => {
        const r = runQuery(parseSingleViewLine('!view calc-xref select name, cell.linked'));
        const ref = r.rows.find(row => row.id === 'calc-ref');
        assert.ok(ref);
        assert.equal(ref.fields['cell.linked'], 50);
    });

    test('where cell.<name> filters against a cross-note-derived calc value', () => {
        const r = runQuery(parseSingleViewLine('!view calc-xref where cell.linked > 45 select name, cell.linked'));
        assert.deepEqual(ids(r), ['calc-ref']);

        const empty = runQuery(parseSingleViewLine('!view calc-xref where cell.linked > 100 select name, cell.linked'));
        assert.deepEqual(ids(empty), []);
    });

});

describe('runQuery — forward — frontmatter-valued cells (a formula reading the note\'s own frontmatter)', () => {
    test('cell.<name> resolves correctly when the formula reads real frontmatter fields, not just other calc cells', () => {
        const r = runQuery(parseSingleViewLine('!view calc-fm select name, cell.total'));
        const note = r.rows.find(row => row.id === 'calc-fm');
        assert.equal(note.fields['cell.total'], 30); // price(10) * quantity(3)
    });

    test('where cell.<name> filters correctly against a frontmatter-derived calc value', () => {
        const r = runQuery(parseSingleViewLine('!view calc-fm where cell.total > 20'));
        assert.deepEqual(ids(r), ['calc-fm']);
        const empty = runQuery(parseSingleViewLine('!view calc-fm where cell.total > 100'));
        assert.deepEqual(ids(empty), []);
    });
});

describe('runQuery — forward — cellMeta (drill-back provenance for cell.<name>)', () => {

    test('a row that references cell.<name> carries a cellMeta entry with the source expression', () => {
        // calc-note's body (see MOCK_BODIES): 'total=1+2' — name 'total', expr '1+2'.
        const r = runQuery(parseSingleViewLine('!view calc-note select name, cell.total'));
        const note = r.rows.find(row => row.id === 'calc-note');
        assert.ok(note.cellMeta);
        assert.equal(note.cellMeta['cell.total'].expr, '1+2');
    });

    test('cellMeta is keyed by both label and name for the same block, matching cell.<name> resolution', () => {
        const r = runQuery(parseSingleViewLine('!view calc-note select cell.total, cell.y1'));
        const note = r.rows[0];
        assert.equal(note.cellMeta['cell.total'].label, 'Y1');
        assert.equal(note.cellMeta['cell.y1'].label, 'Y1');
        assert.equal(note.cellMeta['cell.total'].name, 'total');
        assert.equal(note.cellMeta['cell.y1'].name, 'total');
    });

    test('an unnamed cell\'s meta has name: null', () => {
        const r = runQuery(parseSingleViewLine('!view calc-note select cell.y3'));
        assert.equal(r.rows[0].cellMeta['cell.y3'].name, null);
        assert.equal(r.rows[0].cellMeta['cell.y3'].label, 'Y3');
    });

    test('a query that never references cell.* has no cellMeta on any row at all', () => {
        const r = runQuery(parseSingleViewLine('!view calc-note select name'));
        assert.equal('cellMeta' in r.rows[0], false);
    });

    test('a note with no calc cells has no cellMeta, even if the query references cell.*', () => {
        const r = runQuery(parseSingleViewLine('!view character select name, cell.total'));
        const rico = r.rows.find(row => row.id === 'johnny-rico');
        assert.equal('cellMeta' in rico, false);
    });

});

describe('runQuery — forward — aggregate clause', () => {
    // Fixture recap (calc-agg type, own dedicated type — see MOCK_INDEX):
    //   agg-one:   region north, budget 50,  cell.total = 1+2  = 3
    //   agg-two:   region north, budget 150, cell.total = 4+6  = 10
    //   agg-three: region south, budget n/a (non-numeric), cell.total = 90+10 = 100

    test('standalone aggregate (no group by) folds sum/average/min/max/count over the whole matched set', () => {
        const r = runQuery(parseSingleViewLine(
            '!view calc-agg aggregate sum(cell.total) as total, average(cell.total) as avg, min(cell.total) as lowest, max(cell.total) as highest, count'
        ));
        assert.ok(r.success);
        assert.equal(r.aggregates.total, 113);
        assert.ok(Math.abs(r.aggregates.avg - (113 / 3)) < 1e-9);
        assert.equal(r.aggregates.lowest, 3);
        assert.equal(r.aggregates.highest, 100);
        assert.equal(r.aggregates.count, 3);
    });

    test('aggregate + group by folds per-bucket, and columns gain the alias', () => {
        const r = runQuery(parseSingleViewLine('!view calc-agg group by region aggregate sum(cell.total) as total'));
        assert.ok(r.success);
        const byRegion = Object.fromEntries(r.groups.map(g => [g.key, g.aggregates.total]));
        assert.equal(byRegion.north, 13);
        assert.equal(byRegion.south, 100);
        assert.deepEqual(r.columns, ['region', 'count', 'total']);
    });

    test('a non-numeric value is silently excluded from sum/average/min/max but still counted', () => {
        const r = runQuery(parseSingleViewLine('!view calc-agg aggregate sum(budget) as total, count'));
        assert.ok(r.success);
        assert.equal(r.aggregates.total, 200); // 50 + 150, "n/a" excluded
        assert.equal(r.aggregates.count, 3);   // all 3 rows still counted
    });

    test('a field that is non-numeric on every matched row resolves to null, never 0 or NaN', () => {
        const r = runQuery(parseSingleViewLine('!view calc-agg aggregate sum(region) as total'));
        assert.ok(r.success);
        assert.equal(r.aggregates.total, null);
    });

    test('sort by an aggregate alias orders groups by that value, nulls sorted last regardless of direction', () => {
        const desc = runQuery(parseSingleViewLine('!view calc-agg group by region aggregate sum(budget) as total sort total desc'));
        assert.deepEqual(desc.groups.map(g => g.key), ['north', 'south']); // south's total is null (n/a)
        const asc = runQuery(parseSingleViewLine('!view calc-agg group by region aggregate sum(budget) as total sort total'));
        assert.deepEqual(asc.groups.map(g => g.key), ['north', 'south']); // still last in ascending order
    });

    test('aggregates reflect the full matched set regardless of limit (standalone and grouped)', () => {
        const r = runQuery(parseSingleViewLine('!view calc-agg aggregate sum(cell.total) as total limit 1'));
        assert.equal(r.rows.length, 1);
        assert.equal(r.aggregates.total, 113); // unaffected by the row limit

        const grouped = runQuery(parseSingleViewLine('!view calc-agg group by region aggregate sum(cell.total) as total limit 1'));
        assert.equal(grouped.groups.length, 1); // limit trims which groups are shown...
        assert.equal(grouped.groups[0].aggregates.total, grouped.groups[0].key === 'north' ? 13 : 100); // ...never rows within a surviving group
    });

    test('no-aggregate group by keeps the exact pre-existing columns shape (regression guard)', () => {
        const r = runQuery(parseSingleViewLine('!view * group by type'));
        assert.deepEqual(r.columns, ['type', 'count']);
    });

    test('a non-grouped query with no aggregate clause has no "aggregates" key at all', () => {
        const r = runQuery(parseSingleViewLine('!view calc-agg select name'));
        assert.equal('aggregates' in r, false);
    });

});

describe('runQuery — VQL v1 — linked_to / linked_from', () => {

    test('linked_to [[johnny-rico]] returns notes with an outbound edge to johnny-rico', () => {
        // johnny-rico's real backlinks (MOCK_BACKLINKS): only mission-klendathu
        // (commander field) — mission-klendathu-ii has no commander set.
        const r = runQuery(parseSingleViewLine('!view * linked_to [[johnny-rico]]'));
        assert.deepEqual(ids(r), ['mission-klendathu']);
    });

    test('linked_from [[mission-klendathu]] returns every note mission-klendathu points to', () => {
        // mission-klendathu's real outbound edges (MOCK_EDGES): carl-jenkins
        // (intelligence), johnny-rico (commander), roughnecks (unit).
        const r = runQuery(parseSingleViewLine('!view * linked_from [[mission-klendathu]]'));
        assert.deepEqual(ids(r), ['carl-jenkins', 'johnny-rico', 'roughnecks']);
    });

    test('linked_from combines with a type filter', () => {
        const r = runQuery(parseSingleViewLine('!view unit linked_from [[mission-klendathu]]'));
        assert.deepEqual(ids(r), ['roughnecks']);
    });

    test('linked_to a note with no backlinks returns no rows, not an error', () => {
        // deal-alpha is confirmed zero-edge by the "zero-edge notes" test above.
        const r = runQuery(parseSingleViewLine('!view * linked_to [[deal-alpha]]'));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), []);
    });

    test('linked_to and linked_from together intersect (AND, not OR)', () => {
        // Only mission-klendathu links to johnny-rico; of the notes
        // mission-klendathu itself links to (carl-jenkins/johnny-rico/roughnecks),
        // none also link to johnny-rico — so the intersection is empty.
        const r = runQuery(parseSingleViewLine('!view * linked_to [[johnny-rico]] linked_from [[mission-klendathu]]'));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), []);
    });

});

describe('runQuery — VQL v1 — linked_to / linked_from within N (multi-hop)', () => {
    // chain-a -> chain-b -> chain-c -> chain-a (a 3-cycle, see MOCK_INDEX note)

    test('within 1 (default) is identical to omitting "within" entirely', () => {
        const withWithin = runQuery(parseSingleViewLine('!view * linked_from [[chain-a]] within 1'));
        const noWithin = runQuery(parseSingleViewLine('!view * linked_from [[chain-a]]'));
        assert.deepEqual(ids(withWithin), ids(noWithin));
        assert.deepEqual(ids(noWithin), ['chain-b']);
    });

    test('linked_from within 2 reaches a genuine 2-hop note that within 1 does not', () => {
        const hop1 = runQuery(parseSingleViewLine('!view * linked_from [[chain-a]] within 1'));
        assert.deepEqual(ids(hop1), ['chain-b']);
        const hop2 = runQuery(parseSingleViewLine('!view * linked_from [[chain-a]] within 2'));
        assert.deepEqual(ids(hop2), ['chain-b', 'chain-c']);
    });

    test('linked_to within 2 reaches a genuine 2-hop note that within 1 does not', () => {
        const hop1 = runQuery(parseSingleViewLine('!view * linked_to [[chain-c]] within 1'));
        assert.deepEqual(ids(hop1), ['chain-b']);
        const hop2 = runQuery(parseSingleViewLine('!view * linked_to [[chain-c]] within 2'));
        assert.deepEqual(ids(hop2), ['chain-a', 'chain-b']);
    });

    test('a cycle does not infinite-loop, duplicate results, or include the start id', () => {
        const r = runQuery(parseSingleViewLine('!view * linked_from [[chain-a]] within 5'));
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), ['chain-b', 'chain-c']);
        assert.ok(!ids(r).includes('chain-a'));
    });

    test('within combines with a type filter', () => {
        const r = runQuery(parseSingleViewLine('!view linkchain linked_from [[chain-a]] within 2'));
        assert.deepEqual(ids(r), ['chain-b', 'chain-c']);
    });

    test('an out-of-range within (parse warning) still runs the query at depth 1', () => {
        const q = parseSingleViewLine('!view * linked_from [[chain-a]] within 99');
        assert.ok(q.parseWarnings.some((w) => w.includes('out of range')));
        const r = runQuery(q);
        assert.equal(r.success, true);
        assert.deepEqual(ids(r), ['chain-b']);
    });

});

describe('parseSingleViewBlock — as of (VQL v1 temporal)', () => {

    test('as of with a literal date parses to a resolved ISO-ish date string', () => {
        const q = parseSingleViewLine('!view mission as of 2297-08-10');
        assert.equal(q.asOf, '2297-08-10');
    });

    test('as of with a function call resolves through the same date resolver where clauses use', () => {
        const q = parseSingleViewLine('!view mission as of days-ago(7)');
        assert.equal(q.asOf, addDaysIso(getTodayIsoLocal(), -7));
    });

    test('no as of clause leaves asOf null', () => {
        const q = parseSingleViewLine('!view mission');
        assert.equal(q.asOf, null);
    });

    test('as of does not get swallowed by an adjacent where clause, in either order', () => {
        const before = parseSingleViewLine('!view mission where outcome = defeat as of 2297-08-10');
        assert.equal(before.asOf, '2297-08-10');
        assert.equal(before.wheres.length, 1);

        const after = parseSingleViewLine('!view mission as of 2297-08-10 where outcome = defeat');
        assert.equal(after.asOf, '2297-08-10');
        assert.equal(after.wheres.length, 1);
    });

});

describe('buildQueryString — as of', () => {

    test('plain query (no as of) never emits "as of"', () => {
        const q = parseSingleViewLine('!view mission');
        assert.equal(buildQueryString(q), '!view mission');
    });

    test('as of roundtrips with the real resolved date', () => {
        const q = parseSingleViewLine('!view mission as of 2297-08-10');
        assert.equal(buildQueryString(q), '!view mission as of 2297-08-10');
    });

});

describe('runQuery — VQL v1 — as of (real historical reconstruction)', () => {
    const { appendMutationEvents, clearMutationEvents, withMutationContext } = require('../src/runtime/mutationEventLog');

    test('as of before a recorded field change shows the old value; live/after shows the new one', () => {
        clearMutationEvents();
        try {
            // Live MOCK_FIELDS has mission-klendathu.outcome = 'defeat'. Seed a
            // real mutation event recording that it used to be 'ongoing'
            // before this timestamp.
            appendMutationEvents(withMutationContext([{
                type: 'field_changed',
                noteId: 'mission-klendathu',
                field: 'outcome',
                oldValue: 'ongoing',
                newValue: 'defeat',
                timestamp: '2297-08-15T00:00:00.000Z'
            }], { source: 'test', cause: 'seed' }));

            const before = runQuery(parseSingleViewLine('!view mission as of 2297-08-10 select id, outcome'));
            const beforeRow = before.rows.find((r) => r.id === 'mission-klendathu');
            assert.ok(beforeRow, 'expected mission-klendathu to exist as of 2297-08-10');
            assert.equal(beforeRow.fields.outcome, 'ongoing');

            const after = runQuery(parseSingleViewLine('!view mission as of 2297-08-20 select id, outcome'));
            const afterRow = after.rows.find((r) => r.id === 'mission-klendathu');
            assert.equal(afterRow.fields.outcome, 'defeat');

            const live = runQuery(parseSingleViewLine('!view mission select id, outcome'));
            const liveRow = live.rows.find((r) => r.id === 'mission-klendathu');
            assert.equal(liveRow.fields.outcome, 'defeat');
        } finally {
            clearMutationEvents();
        }
    });

    test('as of combines with a where clause — filters against the reconstructed value, not the live one', () => {
        clearMutationEvents();
        try {
            appendMutationEvents(withMutationContext([{
                type: 'field_changed',
                noteId: 'mission-klendathu',
                field: 'outcome',
                oldValue: 'ongoing',
                newValue: 'defeat',
                timestamp: '2297-08-15T00:00:00.000Z'
            }], { source: 'test', cause: 'seed' }));

            const r = runQuery(parseSingleViewLine('!view mission as of 2297-08-10 where outcome = ongoing'));
            assert.deepEqual(ids(r), ['mission-klendathu']);

            const liveMatch = runQuery(parseSingleViewLine('!view mission where outcome = ongoing'));
            assert.deepEqual(ids(liveMatch), []);
        } finally {
            clearMutationEvents();
        }
    });

    test('an invalid as of date produces a warning and falls back to current state, never crashes', () => {
        const r = runQuery(parseSingleViewLine('!view mission as of not-a-real-date'));
        assert.equal(r.success, true);
        assert.ok(r.warnings.some((w) => w.includes('not a valid date')));
        assert.deepEqual(ids(r), ['mission-klendathu', 'mission-klendathu-ii']);
    });

    test('as of with no recorded mutation history reconstructs to the same rows as a live query', () => {
        clearMutationEvents();
        const withAsOf = runQuery(parseSingleViewLine('!view mission as of 2297-08-10'));
        const live = runQuery(parseSingleViewLine('!view mission'));
        assert.deepEqual(ids(withAsOf), ids(live));
    });

});

describe('buildQueryString — aggregate', () => {

    test('aggregate clause round-trips', () => {
        const q = parseSingleViewLine('!view * aggregate sum(cell.total) as total');
        assert.match(buildQueryString(q), /aggregate sum\(cell\.total\) as total/);
    });

    test('avg canonicalizes to average on output, and re-parses to the same structure', () => {
        // Uses a real type ('calc-agg'), not '*' — buildQueryString's
        // multi-line output separates clauses with "\n", and
        // parseSingleViewLine's wildcard-type detection specifically
        // requires a literal "* " (space); re-parsing a serialized wildcard
        // query is a separate, pre-existing quirk unrelated to aggregate,
        // so this test sidesteps it the same way the "combined with group
        // by" test above already does (using 'deal', not '*').
        const q = parseSingleViewLine('!view calc-agg aggregate avg(cell.total) as a');
        const serialized = buildQueryString(q);
        assert.match(serialized, /aggregate average\(cell\.total\) as a/);
        assert.doesNotMatch(serialized, /aggregate avg\(/);
        const reparsed = parseSingleViewLine(serialized);
        assert.deepEqual(reparsed.aggregate, q.aggregate);
    });

    test('combined with group by, both clauses appear in the serialized string', () => {
        const q = parseSingleViewLine('!view deal group by stage aggregate sum(value) as total');
        const serialized = buildQueryString(q);
        assert.match(serialized, /group by stage/);
        assert.match(serialized, /aggregate sum\(value\) as total/);
    });

    test('bare count round-trips without a redundant default alias', () => {
        const q = parseSingleViewLine('!view * aggregate count');
        assert.match(buildQueryString(q), /aggregate count$/m);
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

