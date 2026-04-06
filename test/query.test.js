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
]);

const MOCK_FIELDS = new Map([
    ['carl-jenkins',         { type: 'character', name: 'Carl Jenkins', rank: 'Private' }],
    ['johnny-rico',          { type: 'character', name: 'Johnny Rico',  rank: 'Lieutenant' }],
    ['mission-klendathu',    { type: 'mission', intelligence: '[[carl-jenkins]]', commander: '[[johnny-rico]]', unit: '[[roughnecks]]', date: '2297-08-01', outcome: 'defeat' }],
    ['mission-klendathu-ii', { type: 'mission', intelligence: '[[carl-jenkins]]', unit: '[[roughnecks]]', date: '2297-09-15', outcome: 'victory' }],
    ['roughnecks',           { type: 'unit', name: 'Roughnecks' }],
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
    if (req === '../core/graph') return '__stub_graph__';
    if (req === '../core/tasks') return '__stub_tasks__';
    return _origResolve(req, parent, ...rest);
};
require.cache['__stub_index__'] = {
    id: '__stub_index__', filename: '__stub_index__', loaded: true,
    exports: {
        getIndex:      () => MOCK_INDEX,
        getFieldsCache: () => MOCK_FIELDS,
    }
};
require.cache['__stub_graph__'] = {
    id: '__stub_graph__', filename: '__stub_graph__', loaded: true,
    exports: {
        getBacklinks: (id) => MOCK_BACKLINKS.get(id) ?? [],
    }
};
const todayIso = getTodayIsoLocal();
require.cache['__stub_tasks__'] = {
    id: '__stub_tasks__', filename: '__stub_tasks__', loaded: true,
    exports: {
        buildTaskRows: () => ([
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
    if (MOCK_BODIES.has(p)) return { mtimeMs: 1000 };
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
        assert.equal(r.rows.length, 3);
        assert.equal(r.rows[0].fields.date, todayIso);
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

});
