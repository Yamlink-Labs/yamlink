'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Stub installed before the FIRST require of structuralSignature.js — it
// caches its own internal require('../core/graph') the first time it's
// loaded, so the stub must be in place before that happens, not after.
// structuralSignature.js reads getBacklinks() directly from a real
// module-level graph; stubbed the same way test/query.test.js does for its
// own graph module.
const Module = require('module');
const _origResolve = Module._resolveFilename.bind(Module);
let MOCK_BACKLINKS = new Map();
Module._resolveFilename = function (req, parent, ...rest) {
    if (req === '../core/graph') return '__ss_stub_graph__';
    return _origResolve(req, parent, ...rest);
};
require.cache['__ss_stub_graph__'] = {
    id: '__ss_stub_graph__',
    filename: '__ss_stub_graph__',
    loaded: true,
    exports: {
        getBacklinks: (id) => MOCK_BACKLINKS.get(id) || []
    }
};

const {
    buildTypeDistribution,
    selectDominantTypes,
    computeFieldRigidity,
    computeHubConcentration,
    computeRecentGrowthRate,
    summarizeStructuralSignature,
    buildStructuralSignature
} = require('../src/intelligence/structuralSignature');

describe('structuralSignature — buildTypeDistribution / selectDominantTypes', () => {

    test('buildTypeDistribution counts and sorts by frequency', () => {
        const fieldsCache = new Map([
            ['a', { type: 'contact' }],
            ['b', { type: 'contact' }],
            ['c', { type: 'deal' }],
            ['d', {}] // untyped, excluded
        ]);
        const dist = buildTypeDistribution(fieldsCache);
        assert.deepEqual(dist, [
            { type: 'contact', count: 2, ratio: 2 / 3 },
            { type: 'deal', count: 1, ratio: 1 / 3 }
        ]);
    });

    test('buildTypeDistribution returns empty for an untyped vault', () => {
        const fieldsCache = new Map([['a', {}], ['b', {}]]);
        assert.deepEqual(buildTypeDistribution(fieldsCache), []);
    });

    test('selectDominantTypes stops once cumulative coverage clears the threshold', () => {
        const dist = [
            { type: 'a', count: 5, ratio: 0.5 },
            { type: 'b', count: 3, ratio: 0.3 },
            { type: 'c', count: 2, ratio: 0.2 }
        ];
        const dominant = selectDominantTypes(dist, 0.8);
        assert.deepEqual(dominant.map((t) => t.type), ['a', 'b']);
    });

    test('selectDominantTypes with a single overwhelming type returns just that one', () => {
        const dist = [
            { type: 'a', count: 9, ratio: 0.9 },
            { type: 'b', count: 1, ratio: 0.1 }
        ];
        assert.deepEqual(selectDominantTypes(dist, 0.8).map((t) => t.type), ['a']);
    });

});

describe('structuralSignature — computeFieldRigidity', () => {

    test('every note sharing the same fields scores rigidity of 1', () => {
        const typeFieldBundles = new Map([['contact', new Map([['name', 4], ['email', 4]])]]);
        const typeBundleTotals = new Map([['contact', 4]]);
        assert.equal(computeFieldRigidity('contact', typeFieldBundles, typeBundleTotals), 1);
    });

    test('a rarely-shared field set scores low rigidity', () => {
        const typeFieldBundles = new Map([['contact', new Map([['name', 1], ['email', 1]])]]);
        const typeBundleTotals = new Map([['contact', 10]]);
        assert.equal(computeFieldRigidity('contact', typeFieldBundles, typeBundleTotals), 0.1);
    });

    test('an unknown type or empty bundle returns 0, not NaN', () => {
        assert.equal(computeFieldRigidity('ghost', new Map(), new Map()), 0);
    });

});

describe('structuralSignature — computeHubConcentration', () => {

    test('a single dominant hub reports high concentration', () => {
        MOCK_BACKLINKS = new Map([
            ['hub', Array.from({ length: 20 }, () => ({ sourceId: 'x' }))],
            ['a', [{ sourceId: 'hub' }]],
            ['b', [{ sourceId: 'hub' }]]
        ]);
        const fieldsCache = new Map([['hub', {}], ['a', {}], ['b', {}]]);
        const result = computeHubConcentration(fieldsCache, 0.34); // top 1 of 3
        assert.equal(result.hubCount, 1);
        assert.equal(result.totalInbound, 22);
        assert.ok(result.concentration > 0.9, `expected high concentration, got ${result.concentration}`);
    });

    test('evenly spread links report low concentration', () => {
        MOCK_BACKLINKS = new Map([
            ['a', [{ sourceId: 'b' }]],
            ['b', [{ sourceId: 'a' }]],
            ['c', [{ sourceId: 'a' }]],
            ['d', [{ sourceId: 'c' }]]
        ]);
        const fieldsCache = new Map([['a', {}], ['b', {}], ['c', {}], ['d', {}]]);
        const result = computeHubConcentration(fieldsCache, 0.25); // top 1 of 4
        assert.ok(result.concentration <= 0.5, `expected low concentration, got ${result.concentration}`);
    });

    test('a vault with zero edges reports zero concentration, not NaN', () => {
        MOCK_BACKLINKS = new Map();
        const fieldsCache = new Map([['a', {}], ['b', {}]]);
        assert.deepEqual(computeHubConcentration(fieldsCache), { concentration: 0, hubCount: 0, totalInbound: 0 });
    });

});

describe('structuralSignature — computeRecentGrowthRate', () => {

    test('counts only note_created events inside the window', () => {
        const now = Date.parse('2026-08-19T00:00:00.000Z');
        const events = [
            { type: 'note_created', timestamp: '2026-08-15T00:00:00.000Z' }, // in window
            { type: 'note_created', timestamp: '2026-01-01T00:00:00.000Z' }, // out of window
            { type: 'field_changed', timestamp: '2026-08-18T00:00:00.000Z' } // wrong type
        ];
        const result = computeRecentGrowthRate(events, 10, 30, now);
        assert.equal(result.recentCreations, 1);
        assert.equal(result.ratio, 0.1);
    });

    test('zero total notes reports zero ratio, not division by zero', () => {
        assert.deepEqual(computeRecentGrowthRate([], 0), { recentCreations: 0, ratio: 0 });
    });

});

describe('structuralSignature — summarizeStructuralSignature', () => {

    test('produces an honest sentence, not a hardcoded archetype label', () => {
        const signature = {
            dominantTypes: [{ type: 'contact', ratio: 0.7, rigidity: 0.85 }],
            hubs: { concentration: 0.6, hubCount: 2, totalInbound: 30 },
            growth: { recentCreations: 5, ratio: 0.15 }
        };
        const summary = summarizeStructuralSignature(signature);
        assert.match(summary, /contact.*70%/);
        assert.doesNotMatch(summary, /CRM|research|lore|planning/i);
    });

    test('reports plainly when there are not enough typed notes yet', () => {
        const summary = summarizeStructuralSignature({ dominantTypes: [], hubs: { totalInbound: 0 }, growth: { ratio: 0, recentCreations: 0 } });
        assert.match(summary, /not enough/i);
    });

});

describe('structuralSignature — buildStructuralSignature (end to end)', () => {

    test('combines all four dimensions into one real signature', () => {
        MOCK_BACKLINKS = new Map([
            ['acme', [{ sourceId: 'rico' }, { sourceId: 'carl' }]],
            ['rico', []],
            ['carl', []]
        ]);
        const fieldsCache = new Map([
            ['rico', { type: 'contact', name: 'Rico', company: '[[acme]]' }],
            ['carl', { type: 'contact', name: 'Carl', company: '[[acme]]' }],
            ['acme', { type: 'company', name: 'Acme' }]
        ]);
        const events = [
            { type: 'note_created', noteId: 'rico', timestamp: new Date().toISOString() }
        ];
        const signature = buildStructuralSignature(fieldsCache, events, 1);
        assert.ok(signature.dominantTypes.some((t) => t.type === 'contact'));
        assert.ok(signature.hubs.totalInbound >= 2);
        assert.ok(signature.growth.recentCreations >= 1);
        assert.equal(typeof signature.summary, 'string');
        assert.ok(signature.summary.length > 0);
    });

    test('an empty vault produces a real, non-throwing signature', () => {
        const signature = buildStructuralSignature(new Map(), [], 0);
        assert.deepEqual(signature.dominantTypes, []);
        assert.match(signature.summary, /not enough/i);
    });

});
