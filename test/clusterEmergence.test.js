'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { detectClusters, fieldSignature, clusterConfidence } = require('../src/intelligence/clusterEmergence');

function makeFieldsCache(notes) {
    const m = new Map();
    for (const [id, fields] of Object.entries(notes)) m.set(id, fields);
    return m;
}

describe('clusterEmergence — fieldSignature', () => {
    it('excludes system fields and sorts the remainder', () => {
        const sig = fieldSignature({ id: 'a', type: 'contact', status: 'active', company: '[[acme]]', name: 'Ada' });
        assert.equal(sig, 'company|status');
    });

    it('returns empty string for a note with only system fields', () => {
        assert.equal(fieldSignature({ id: 'a', type: 'note', created: '2026-01-01' }), '');
    });
});

describe('clusterEmergence — clusterConfidence', () => {
    it('labels by note count thresholds', () => {
        assert.equal(clusterConfidence(4), 'low');
        assert.equal(clusterConfidence(6), 'low');
        assert.equal(clusterConfidence(7), 'medium');
        assert.equal(clusterConfidence(12), 'medium');
        assert.equal(clusterConfidence(13), 'high');
    });
});

describe('clusterEmergence — detectClusters', () => {
    it('returns no clusters for an empty vault', () => {
        assert.deepEqual(detectClusters(makeFieldsCache({})).clusters, []);
    });

    it('detects a cluster from a single fieldsCache argument (no idIndex needed)', () => {
        const notes = {};
        for (let i = 0; i < 5; i++) {
            notes[`contact-${i}`] = { id: `contact-${i}`, type: 'contact', company: '[[acme]]', status: 'active' };
        }
        const { clusters } = detectClusters(makeFieldsCache(notes));
        assert.equal(clusters.length, 1);
        assert.deepEqual(clusters[0].fields, ['company', 'status']);
        assert.equal(clusters[0].noteCount, 5);
        assert.equal(clusters[0].confidence, 'low');
    });

    it('ignores clusters below the minimum size', () => {
        const notes = {
            'a.md': { id: 'a', type: 'contact', company: '[[acme]]', status: 'active' },
            'b.md': { id: 'b', type: 'contact', company: '[[acme]]', status: 'active' }
        };
        assert.deepEqual(detectClusters(makeFieldsCache(notes)).clusters, []);
    });

    it('sets dominantType only when it covers at least 60% of the cluster', () => {
        const notes = {};
        for (let i = 0; i < 4; i++) notes[`t-${i}`] = { id: `t-${i}`, type: 'contact', unit: '[[alpha]]', role: 'member' };
        notes['odd'] = { id: 'odd', type: 'other', unit: '[[alpha]]', role: 'member' };
        const { clusters } = detectClusters(makeFieldsCache(notes));
        assert.equal(clusters.length, 1);
        assert.equal(clusters[0].dominantType, 'contact');
        assert.equal(clusters[0].noteCount, 5);
    });

    it('leaves dominantType null when no type reaches the 60% threshold', () => {
        const notes = {};
        for (let i = 0; i < 2; i++) notes[`a-${i}`] = { id: `a-${i}`, type: 'contact', unit: '[[alpha]]', role: 'member' };
        for (let i = 0; i < 2; i++) notes[`b-${i}`] = { id: `b-${i}`, type: 'account', unit: '[[alpha]]', role: 'member' };
        const { clusters } = detectClusters(makeFieldsCache(notes));
        assert.equal(clusters.length, 1);
        assert.equal(clusters[0].dominantType, null);
    });

    it('caps results at the max cluster count and sorts by note count descending', () => {
        const notes = {};
        // 6 distinct signatures, each with a different note count, all above the minimum.
        for (let sigIdx = 0; sigIdx < 6; sigIdx++) {
            const size = 4 + sigIdx;
            for (let i = 0; i < size; i++) {
                notes[`s${sigIdx}-${i}`] = { id: `s${sigIdx}-${i}`, type: 'note', [`field${sigIdx}`]: 'x', [`field${sigIdx}b`]: 'y' };
            }
        }
        const { clusters } = detectClusters(makeFieldsCache(notes));
        assert.equal(clusters.length, 5, 'capped at MAX_CLUSTERS');
        for (let i = 1; i < clusters.length; i++) {
            assert.ok(clusters[i - 1].noteCount >= clusters[i].noteCount, 'sorted descending by note count');
        }
    });
});
