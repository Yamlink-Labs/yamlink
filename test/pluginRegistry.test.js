'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    registerFieldEvidenceSource,
    clearRegisteredEvidenceSources,
    collectPluginEvidence
} = require('../src/intelligence/pluginRegistry');

describe('pluginRegistry', () => {
    beforeEach(() => {
        clearRegisteredEvidenceSources();
    });

    test('a registered source contributes its score and reason', () => {
        registerFieldEvidenceSource(() => ({ score: 0.9, reason: 'looks like a relation to me' }));
        const results = collectPluginEvidence('owner', {});
        assert.equal(results.length, 1);
        assert.equal(results[0].score, 0.9);
        assert.equal(results[0].reason, 'looks like a relation to me');
        assert.equal(results[0].source, 'plugin');
    });

    test('dispose() removes a registered source', () => {
        const handle = registerFieldEvidenceSource(() => ({ score: 0.9, reason: 'x' }));
        handle.dispose();
        assert.deepEqual(collectPluginEvidence('owner', {}), []);
    });

    test('a source that throws is skipped, never crashes classification', () => {
        registerFieldEvidenceSource(() => { throw new Error('bad plugin'); });
        registerFieldEvidenceSource(() => ({ score: 0.7, reason: 'a working one' }));
        const results = collectPluginEvidence('owner', {});
        assert.equal(results.length, 1);
        assert.equal(results[0].reason, 'a working one');
    });

    test('a source returning null contributes nothing (honest silence, not a guess)', () => {
        registerFieldEvidenceSource(() => null);
        assert.deepEqual(collectPluginEvidence('owner', {}), []);
    });

    test('a source with a non-numeric score is discarded', () => {
        registerFieldEvidenceSource(() => ({ score: 'high', reason: 'not a real number' }));
        assert.deepEqual(collectPluginEvidence('owner', {}), []);
    });

    test('a source with no reason string is discarded — every signal must be explainable', () => {
        registerFieldEvidenceSource(() => ({ score: 0.9, reason: '' }));
        assert.deepEqual(collectPluginEvidence('owner', {}), []);
    });

    test('a source with a reason that is not a string is discarded', () => {
        registerFieldEvidenceSource(() => ({ score: 0.9, reason: 42 }));
        assert.deepEqual(collectPluginEvidence('owner', {}), []);
    });

    test('scores are clamped to [0, 1]', () => {
        registerFieldEvidenceSource(() => ({ score: 5, reason: 'way too confident' }));
        registerFieldEvidenceSource(() => ({ score: -3, reason: 'way too negative' }));
        const results = collectPluginEvidence('owner', {});
        const scores = results.map((r) => r.score).sort();
        assert.deepEqual(scores, [0, 1]);
    });

    test('multiple sources all contribute independently', () => {
        registerFieldEvidenceSource(() => ({ score: 0.6, reason: 'first' }));
        registerFieldEvidenceSource(() => ({ score: 0.8, reason: 'second' }));
        const results = collectPluginEvidence('owner', {});
        assert.equal(results.length, 2);
    });

    test('the field name and context are passed through to the source function', () => {
        let received = null;
        registerFieldEvidenceSource((fieldName, context) => {
            received = { fieldName, context };
            return null;
        });
        collectPluginEvidence('owner', { noteType: 'contact' });
        assert.equal(received.fieldName, 'owner');
        assert.equal(received.context.noteType, 'contact');
    });

    test('registerFieldEvidenceSource throws for a non-function argument', () => {
        assert.throws(() => registerFieldEvidenceSource('not a function'));
    });
});
