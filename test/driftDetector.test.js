'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeNoteDrift, computeVaultDrift, getDriftSummary } = require('../src/intelligence/driftDetector');

function makeFieldsCache(entries) {
    return new Map(entries);
}

function makeBundle(entries) {
    return new Map(entries);
}

function makePriors(typeBundleEntries = [], ambiguityEntries = []) {
    return {
        typeFieldBundles: new Map(typeBundleEntries),
        fieldAmbiguity: new Map(ambiguityEntries)
    };
}

describe('driftDetector', () => {
    describe('computeNoteDrift', () => {
        it('returns null when note has no type', () => {
            const cache = makeFieldsCache([['x', { name: 'foo' }]]);
            const priors = makePriors();
            assert.equal(computeNoteDrift('x', { name: 'foo' }, cache, priors), null);
        });

        it('returns null for schema type', () => {
            const cache = makeFieldsCache([['s', { type: 'schema', target: 'character' }]]);
            const priors = makePriors();
            assert.equal(computeNoteDrift('s', { type: 'schema', target: 'character' }, cache, priors), null);
        });

        it('returns insufficientData when no bundle for type', () => {
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'A' }],
                ['c2', { type: 'character', name: 'B' }],
                ['c3', { type: 'character', name: 'C' }]
            ]);
            const priors = makePriors(); // no bundle for 'character'
            const result = computeNoteDrift('c1', cache.get('c1'), cache, priors);
            assert.ok(result.insufficientData);
            assert.equal(result.noteType, 'character');
        });

        it('returns insufficientData when fewer than 3 notes of same type', () => {
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'A' }],
                ['c2', { type: 'character', name: 'B' }]
            ]);
            const bundle = makeBundle([['name', 2]]);
            const priors = makePriors([['character', bundle]]);
            const result = computeNoteDrift('c1', cache.get('c1'), cache, priors);
            assert.ok(result.insufficientData);
        });

        it('detects no drift when note has all expected fields', () => {
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'Alice', homeworld: '[[earth]]' }],
                ['c2', { type: 'character', name: 'Bob', homeworld: '[[mars]]' }],
                ['c3', { type: 'character', name: 'Carol', homeworld: '[[venus]]' }]
            ]);
            const bundle = makeBundle([['name', 3], ['homeworld', 3]]);
            const priors = makePriors([['character', bundle]]);
            const result = computeNoteDrift('c1', cache.get('c1'), cache, priors);
            assert.equal(result.insufficientData, false);
            assert.equal(result.driftScore, 0);
            assert.equal(result.driftLabel, 'on-track');
            assert.equal(result.missingExpected.length, 0);
        });

        it('detects missing expected fields and raises driftScore', () => {
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'Alice', homeworld: '[[earth]]', faction: '[[avengers]]' }],
                ['c2', { type: 'character', name: 'Bob', homeworld: '[[mars]]', faction: '[[x-men]]' }],
                ['c3', { type: 'character', name: 'Carol' }] // missing homeworld and faction
            ]);
            // all 3 have name (3/3=1.0), homeworld (2/3=0.67), faction (2/3=0.67)
            const bundle = makeBundle([['name', 3], ['homeworld', 2], ['faction', 2]]);
            const priors = makePriors([['character', bundle]]);
            const result = computeNoteDrift('c3', cache.get('c3'), cache, priors);
            assert.equal(result.missingExpected.length, 2);
            const fields = result.missingExpected.map(m => m.field);
            assert.ok(fields.includes('homeworld'));
            assert.ok(fields.includes('faction'));
            assert.ok(result.driftScore > 0);
            assert.equal(result.typeTotal, 3);
        });

        it('sorts missingExpected by ratio descending', () => {
            // c4 has no content fields — missing name (4/4=1.0) and hw (3/4=0.75)
            // fac is 2/4=0.5 < EXPECTED_RATIO so not flagged
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'A', hw: '[[x]]', fac: '[[y]]' }],
                ['c2', { type: 'character', name: 'B', hw: '[[x]]', fac: '[[y]]' }],
                ['c3', { type: 'character', name: 'C', hw: '[[x]]' }],
                ['c4', { type: 'character' }]
            ]);
            const bundle = makeBundle([['name', 4], ['hw', 3], ['fac', 2]]);
            const priors = makePriors([['character', bundle]]);
            const result = computeNoteDrift('c4', cache.get('c4'), cache, priors);
            assert.equal(result.missingExpected.length, 2);
            assert.equal(result.missingExpected[0].field, 'name'); // ratio 1.0 first
            assert.equal(result.missingExpected[1].field, 'hw');   // ratio 0.75 second
            assert.ok(result.missingExpected[0].ratio >= result.missingExpected[1].ratio);
        });

        it('computes drifting label when two high-ratio fields are missing', () => {
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'A', homeworld: '[[x]]', faction: '[[y]]' }],
                ['c2', { type: 'character', name: 'B', homeworld: '[[x]]', faction: '[[y]]' }],
                ['c3', { type: 'character', name: 'C' }] // missing homeworld (3/3) and faction (3/3) — actually 2/3 each
            ]);
            // Use bundle where all 3 have homeworld and faction so ratio=1.0
            const bundle = makeBundle([['name', 3], ['homeworld', 3], ['faction', 3]]);
            const priors = makePriors([['character', bundle]]);
            const result = computeNoteDrift('c3', cache.get('c3'), cache, priors);
            // missingScore = round((1.0-0.60)*80) * 2 = 32*2 = 64 → drifting
            assert.ok(result.driftScore >= 50);
            assert.equal(result.driftLabel, 'drifting');
        });

        it('does not flag unusual fields when typeTotal < 5', () => {
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'A', quirk: 'bold' }],
                ['c2', { type: 'character', name: 'B' }],
                ['c3', { type: 'character', name: 'C' }]
            ]);
            const bundle = makeBundle([['name', 3]]); // 'quirk' not in bundle
            const priors = makePriors([['character', bundle]]);
            const result = computeNoteDrift('c1', cache.get('c1'), cache, priors);
            assert.equal(result.unusualFields.length, 0); // typeTotal=3 < MIN_UNUSUAL_SAMPLE=5
        });

        it('flags unusual fields when typeTotal >= 5', () => {
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'A' }],
                ['c2', { type: 'character', name: 'B' }],
                ['c3', { type: 'character', name: 'C' }],
                ['c4', { type: 'character', name: 'D' }],
                ['c5', { type: 'character', name: 'E', quirk: 'shy' }] // quirk is unusual
            ]);
            const bundle = makeBundle([['name', 5]]); // 'quirk' count 0
            const priors = makePriors([['character', bundle]]);
            const result = computeNoteDrift('c5', cache.get('c5'), cache, priors);
            assert.equal(result.unusualFields.length, 1);
            assert.equal(result.unusualFields[0].field, 'quirk');
            assert.equal(result.unusualFields[0].count, 0);
        });

        it('sorts unusualFields by ratio ascending (rarest first)', () => {
            // 7 notes so count=1 gives ratio 1/7≈0.143 < UNUSUAL_RATIO(0.15)
            // quirk count=1, gimmick not in bundle (count=0) → both unusual, gimmick rarer
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'A' }],
                ['c2', { type: 'character', name: 'B' }],
                ['c3', { type: 'character', name: 'C' }],
                ['c4', { type: 'character', name: 'D' }],
                ['c5', { type: 'character', name: 'E' }],
                ['c6', { type: 'character', name: 'F' }],
                ['c7', { type: 'character', name: 'G', quirk: 'shy', gimmick: 'odd' }]
            ]);
            const bundle = makeBundle([['name', 7], ['quirk', 1]]); // gimmick count=0 (not in bundle)
            const priors = makePriors([['character', bundle]]);
            const result = computeNoteDrift('c7', cache.get('c7'), cache, priors);
            assert.equal(result.unusualFields.length, 2);
            // sorted ascending: gimmick (ratio=0) first, quirk (ratio≈0.143) second
            assert.equal(result.unusualFields[0].field, 'gimmick');
            assert.equal(result.unusualFields[1].field, 'quirk');
            assert.ok(result.unusualFields[0].ratio <= result.unusualFields[1].ratio);
        });

        it('detects value mismatch when field usually holds a wikilink', () => {
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'Alice', homeworld: '[[earth]]' }],
                ['c2', { type: 'character', name: 'Bob', homeworld: '[[mars]]' }],
                ['c3', { type: 'character', name: 'Carol', homeworld: 'venus' }] // scalar instead of link
            ]);
            const bundle = makeBundle([['name', 3], ['homeworld', 3]]);
            // homeworld: 3 total, 0.9 linkRatio → expects wikilink
            const priors = makePriors(
                [['character', bundle]],
                [['homeworld', { total: 3, linkRatio: 0.9 }]]
            );
            const result = computeNoteDrift('c3', cache.get('c3'), cache, priors);
            assert.equal(result.valueMismatches.length, 1);
            assert.equal(result.valueMismatches[0].field, 'homeworld');
            assert.equal(result.valueMismatches[0].expected, 'wikilink');
            assert.equal(result.valueMismatches[0].actual, 'scalar');
        });

        it('detects value mismatch when field usually holds a scalar', () => {
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'Alice', rank: '5' }],
                ['c2', { type: 'character', name: 'Bob', rank: '3' }],
                ['c3', { type: 'character', name: 'Carol', rank: '[[rank-5]]' }] // link instead of scalar
            ]);
            const bundle = makeBundle([['name', 3], ['rank', 3]]);
            // rank: 0.05 linkRatio → usually scalar; (1-0.05)=0.95 >= 0.70 → mismatch when note has link
            const priors = makePriors(
                [['character', bundle]],
                [['rank', { total: 3, linkRatio: 0.05 }]]
            );
            const result = computeNoteDrift('c3', cache.get('c3'), cache, priors);
            assert.equal(result.valueMismatches.length, 1);
            assert.equal(result.valueMismatches[0].expected, 'scalar');
            assert.equal(result.valueMismatches[0].actual, 'wikilink');
        });

        it('skips value mismatch when fieldAmbiguity total is below MIN_TYPE_SAMPLE', () => {
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'A', homeworld: '[[x]]' }],
                ['c2', { type: 'character', name: 'B', homeworld: '[[y]]' }],
                ['c3', { type: 'character', name: 'C', homeworld: 'earth' }]
            ]);
            const bundle = makeBundle([['name', 3], ['homeworld', 3]]);
            const priors = makePriors(
                [['character', bundle]],
                [['homeworld', { total: 2, linkRatio: 0.9 }]] // total < 3 → skipped
            );
            const result = computeNoteDrift('c3', cache.get('c3'), cache, priors);
            assert.equal(result.valueMismatches.length, 0);
        });

        it('outlier label fires at driftScore >= 80', () => {
            // 3 missing fields each at ratio 1.0 → missingScore = 32*3 = 96
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'A', hw: '[[x]]', fac: '[[y]]', rank: '[[z]]' }],
                ['c2', { type: 'character', name: 'B', hw: '[[x]]', fac: '[[y]]', rank: '[[z]]' }],
                ['c3', { type: 'character', name: 'C' }] // missing hw, fac, rank
            ]);
            const bundle = makeBundle([['name', 3], ['hw', 3], ['fac', 3], ['rank', 3]]);
            const priors = makePriors([['character', bundle]]);
            const result = computeNoteDrift('c3', cache.get('c3'), cache, priors);
            // 3 missing at ratio 1.0 → 32*3=96, capped at 100
            assert.ok(result.driftScore >= 80);
            assert.equal(result.driftLabel, 'outlier');
        });

        it('ignores system fields in drift computation', () => {
            const cache = makeFieldsCache([
                ['c1', { type: 'character', id: 'c1', created: '2025-01-01', name: 'A' }],
                ['c2', { type: 'character', id: 'c2', created: '2025-01-02', name: 'B' }],
                ['c3', { type: 'character', id: 'c3', created: '2025-01-03', name: 'C' }]
            ]);
            const bundle = makeBundle([['name', 3]]); // system fields not in bundle
            const priors = makePriors([['character', bundle]]);
            const result = computeNoteDrift('c1', cache.get('c1'), cache, priors);
            // no unusual fields flagged for system fields
            assert.equal(result.unusualFields.length, 0);
        });
    });

    describe('computeVaultDrift', () => {
        it('returns empty array for empty vault', () => {
            const results = computeVaultDrift(new Map(), makePriors());
            assert.deepEqual(results, []);
        });

        it('skips notes with no type', () => {
            const cache = makeFieldsCache([
                ['x', { name: 'orphan' }]
            ]);
            const results = computeVaultDrift(cache, makePriors());
            assert.equal(results.length, 0);
        });

        it('skips schema-type notes', () => {
            const cache = makeFieldsCache([
                ['s1', { type: 'schema', target: 'character' }],
                ['c1', { type: 'character', name: 'A' }],
                ['c2', { type: 'character', name: 'B' }],
                ['c3', { type: 'character', name: 'C' }]
            ]);
            const bundle = makeBundle([['name', 3]]);
            const priors = makePriors([['character', bundle]]);
            const results = computeVaultDrift(cache, priors);
            assert.ok(results.every(r => r.noteType !== 'schema'));
        });

        it('excludes insufficientData notes from results', () => {
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'A' }],
                ['c2', { type: 'character', name: 'B' }]
            ]);
            const bundle = makeBundle([['name', 2]]);
            const priors = makePriors([['character', bundle]]);
            const results = computeVaultDrift(cache, priors);
            assert.equal(results.length, 0); // only 2 of same type
        });

        it('sorts results by driftScore descending', () => {
            const cache = makeFieldsCache([
                ['c1', { type: 'character', name: 'A', homeworld: '[[x]]' }],
                ['c2', { type: 'character', name: 'B', homeworld: '[[y]]' }],
                ['c3', { type: 'character', name: 'C' }] // missing homeworld → higher drift
            ]);
            // homeworld: 3/3=1.0 → expected; c3 missing it → missingScore > 0
            const bundle = makeBundle([['name', 3], ['homeworld', 3]]);
            const priors = makePriors([['character', bundle]]);
            const results = computeVaultDrift(cache, priors);
            assert.ok(results.length > 0);
            for (let i = 1; i < results.length; i++) {
                assert.ok(results[i - 1].driftScore >= results[i].driftScore);
            }
        });
    });

    describe('getDriftSummary', () => {
        it('returns zero counts for empty input', () => {
            const summary = getDriftSummary([]);
            assert.equal(summary.total, 0);
            assert.equal(summary.onTrack, 0);
            assert.equal(summary.minorDrift, 0);
            assert.equal(summary.drifting, 0);
            assert.equal(summary.outliers, 0);
            assert.equal(summary.needsAttention.length, 0);
        });

        it('counts each label bucket correctly', () => {
            const vaultDrift = [
                { noteId: 'a', driftLabel: 'on-track', driftScore: 5 },
                { noteId: 'b', driftLabel: 'minor-drift', driftScore: 30 },
                { noteId: 'c', driftLabel: 'minor-drift', driftScore: 35 },
                { noteId: 'd', driftLabel: 'drifting', driftScore: 60 },
                { noteId: 'e', driftLabel: 'outlier', driftScore: 90 }
            ];
            const summary = getDriftSummary(vaultDrift);
            assert.equal(summary.total, 5);
            assert.equal(summary.onTrack, 1);
            assert.equal(summary.minorDrift, 2);
            assert.equal(summary.drifting, 1);
            assert.equal(summary.outliers, 1);
        });

        it('needsAttention includes only drifting and outlier notes', () => {
            const vaultDrift = [
                { noteId: 'a', driftLabel: 'on-track', driftScore: 5 },
                { noteId: 'b', driftLabel: 'minor-drift', driftScore: 30 },
                { noteId: 'c', driftLabel: 'drifting', driftScore: 60 },
                { noteId: 'd', driftLabel: 'outlier', driftScore: 90 }
            ];
            const summary = getDriftSummary(vaultDrift);
            assert.equal(summary.needsAttention.length, 2);
            const ids = summary.needsAttention.map(n => n.noteId);
            assert.ok(ids.includes('c'));
            assert.ok(ids.includes('d'));
            assert.ok(!ids.includes('a'));
            assert.ok(!ids.includes('b'));
        });

        it('handles all notes on-track', () => {
            const vaultDrift = [
                { noteId: 'a', driftLabel: 'on-track', driftScore: 0 },
                { noteId: 'b', driftLabel: 'on-track', driftScore: 10 }
            ];
            const summary = getDriftSummary(vaultDrift);
            assert.equal(summary.onTrack, 2);
            assert.equal(summary.needsAttention.length, 0);
        });
    });
});
