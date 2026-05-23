'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_SCORE_CONFIDENCE_SCALE,
    SURFACE_POLICY,
    getSurfacePolicy,
    scoreToConfidence,
    readConfidence,
    filterItemsForSurface,
    shouldSurface
} = require('../src/intelligence/confidence');

describe('confidence — scoreToConfidence', () => {
    test('zero score → zero confidence', () => {
        assert.equal(scoreToConfidence(0), 0);
    });

    test('full scale score → 1.0 confidence', () => {
        assert.equal(scoreToConfidence(DEFAULT_SCORE_CONFIDENCE_SCALE), 1);
    });

    test('half scale → 0.5 confidence', () => {
        assert.equal(scoreToConfidence(DEFAULT_SCORE_CONFIDENCE_SCALE / 2), 0.5);
    });

    test('clamped above 1.0', () => {
        assert.equal(scoreToConfidence(DEFAULT_SCORE_CONFIDENCE_SCALE * 10), 1);
    });

    test('negative score clamped to 0', () => {
        assert.equal(scoreToConfidence(-100), 0);
    });

    test('null/undefined treated as 0', () => {
        assert.equal(scoreToConfidence(null), 0);
        assert.equal(scoreToConfidence(undefined), 0);
    });
});

describe('confidence — readConfidence', () => {
    test('reads direct confidence field', () => {
        assert.equal(readConfidence({ confidence: 0.75 }), 0.75);
    });

    test('falls back to score field', () => {
        const val = readConfidence({ score: DEFAULT_SCORE_CONFIDENCE_SCALE / 2 });
        assert.ok(Math.abs(val - 0.5) < 0.001);
    });

    test('returns 0 for item with neither field', () => {
        assert.equal(readConfidence({ label: 'something' }), 0);
    });

    test('clamps confidence values above 1', () => {
        assert.equal(readConfidence({ confidence: 2.5 }), 1);
    });

    test('returns 0 for null item', () => {
        assert.equal(readConfidence(null), 0);
    });

    test('supports custom key names', () => {
        const val = readConfidence({ certainty: 0.9 }, { confidenceKey: 'certainty' });
        assert.equal(val, 0.9);
    });
});

describe('confidence — filterItemsForSurface', () => {
    const policy = SURFACE_POLICY['hover-note-role']; // minimum: 0.5

    test('returns items above the surface minimum', () => {
        const items = [
            { label: 'strong', confidence: 0.8 },
            { label: 'weak',   confidence: 0.2 }
        ];
        const result = filterItemsForSurface(items, 'hover-note-role');
        assert.equal(result.length, 1);
        assert.equal(result[0].label, 'strong');
    });

    test('falls back to at most fallbackLimit items when none pass threshold', () => {
        const items = [
            { label: 'a', confidence: 0.1 },
            { label: 'b', confidence: 0.2 },
            { label: 'c', confidence: 0.3 }
        ];
        const result = filterItemsForSurface(items, 'hover-note-role');
        assert.ok(result.length <= policy.fallbackLimit);
        assert.equal(result[0].label, 'a');
    });

    test('returns empty array for empty input', () => {
        assert.deepEqual(filterItemsForSurface([], 'hover-note-role'), []);
    });

    test('returns empty array for null input', () => {
        assert.deepEqual(filterItemsForSurface(null, 'hover-note-role'), []);
    });

    test('strictest surface (frontmatter-actions) filters more aggressively', () => {
        const items = [
            { label: 'moderate', confidence: 0.55 },
            { label: 'strong',   confidence: 0.75 }
        ];
        const result = filterItemsForSurface(items, 'frontmatter-actions');
        assert.equal(result.length, 1);
        assert.equal(result[0].label, 'strong');
    });
});

describe('confidence — shouldSurface', () => {
    test('returns true when confidence meets minimum', () => {
        assert.equal(shouldSurface({ confidence: 0.9 }, 'hover-note-role'), true);
    });

    test('returns false when below minimum', () => {
        assert.equal(shouldSurface({ confidence: 0.3 }, 'hover-note-role'), false);
    });

    test('unknown surface falls back to default policy', () => {
        assert.equal(shouldSurface({ confidence: 0.6 }, 'unknown-surface'), true);
        assert.equal(shouldSurface({ confidence: 0.3 }, 'unknown-surface'), false);
    });
});

describe('confidence — getSurfacePolicy', () => {
    test('all defined surfaces have a minimum and fallbackLimit', () => {
        for (const key of Object.keys(SURFACE_POLICY)) {
            const policy = getSurfacePolicy(key);
            assert.ok(typeof policy.minimum === 'number', `${key} missing minimum`);
            assert.ok(typeof policy.fallbackLimit === 'number', `${key} missing fallbackLimit`);
            assert.ok(policy.minimum >= 0 && policy.minimum <= 1, `${key} minimum out of range`);
        }
    });

    test('unknown surface returns a valid default policy', () => {
        const policy = getSurfacePolicy('nonexistent');
        assert.ok(typeof policy.minimum === 'number');
        assert.ok(typeof policy.fallbackLimit === 'number');
    });
});
