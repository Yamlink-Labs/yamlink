'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildRelationshipGravity, getEdgeGravity, getTopGravityEdges } = require('../src/intelligence/relationshipGravity');

describe('relationshipGravity — buildRelationshipGravity', () => {
    it('returns an empty map for an empty vault', () => {
        const gravity = buildRelationshipGravity([], new Map());
        assert.equal(gravity.size, 0);
    });

    it('gives a plain single-field edge a structural-only baseline score with no mutation history', () => {
        const fieldsCache = new Map([
            ['note-a', { type: 'mission', commander: '[[rico]]' }],
            ['rico', { type: 'character' }]
        ]);
        const gravity = buildRelationshipGravity([], fieldsCache);
        const edge = getEdgeGravity('note-a', 'commander', 'rico', gravity);
        assert.ok(edge.score > 0, 'a real edge should never score zero, even with no history');
        assert.equal(edge.structuralWeight, 1);
        assert.equal(edge.decayedMutationWeight, 0);
        assert.equal(edge.repetition, 0);
    });

    it('weighs an edge corroborated by multiple fields higher than a single-field edge', () => {
        const fieldsCache = new Map([
            ['note-a', { type: 'mission', commander: '[[rico]]', mentor: '[[rico]]' }],
            ['note-b', { type: 'mission', commander: '[[carmen]]' }],
            ['rico', { type: 'character' }],
            ['carmen', { type: 'character' }]
        ]);
        const gravity = buildRelationshipGravity([], fieldsCache);
        const corroborated = getEdgeGravity('note-a', 'commander', 'rico', gravity);
        const single = getEdgeGravity('note-b', 'commander', 'carmen', gravity);
        assert.equal(corroborated.structuralWeight, 2, 'commander + mentor both point at rico');
        assert.ok(corroborated.score > single.score, 'multi-field corroboration should score higher');
    });

    it('adds decayed mutation weight for relation_added/relation_changed events matching the edge', () => {
        const fieldsCache = new Map([
            ['note-a', { type: 'mission', commander: '[[rico]]' }],
            ['rico', { type: 'character' }]
        ]);
        const nowMs = Date.parse('2026-07-06T00:00:00Z');
        const events = [
            { type: 'relation_added', noteId: 'note-a', field: 'commander', newValue: '[[rico]]', timestamp: '2026-07-05T00:00:00Z' },
            { type: 'relation_changed', noteId: 'note-a', field: 'commander', newValue: '[[rico]]', timestamp: '2026-07-01T00:00:00Z' }
        ];
        const gravity = buildRelationshipGravity(events, fieldsCache, nowMs);
        const edge = getEdgeGravity('note-a', 'commander', 'rico', gravity);
        assert.equal(edge.repetition, 2);
        assert.ok(edge.decayedMutationWeight > 0);
    });

    it('weighs a recently-touched edge higher than an old one with the same repetition count', () => {
        const fieldsCache = new Map([
            ['note-a', { type: 'mission', commander: '[[rico]]' }],
            ['note-b', { type: 'mission', commander: '[[carmen]]' }],
            ['rico', { type: 'character' }],
            ['carmen', { type: 'character' }]
        ]);
        const nowMs = Date.parse('2026-07-06T00:00:00Z');
        const events = [
            { type: 'relation_added', noteId: 'note-a', field: 'commander', newValue: '[[rico]]', timestamp: '2026-07-05T00:00:00Z' },
            { type: 'relation_added', noteId: 'note-b', field: 'commander', newValue: '[[carmen]]', timestamp: '2024-01-01T00:00:00Z' }
        ];
        const gravity = buildRelationshipGravity(events, fieldsCache, nowMs);
        const recent = getEdgeGravity('note-a', 'commander', 'rico', gravity);
        const old = getEdgeGravity('note-b', 'commander', 'carmen', gravity);
        assert.equal(recent.repetition, 1);
        assert.equal(old.repetition, 1);
        assert.ok(recent.decayedMutationWeight > old.decayedMutationWeight, 'recent edge should carry more decayed weight than an old one');
    });

    it('gives relation_removed events reduced weight relative to an equivalent add', () => {
        const fieldsCache = new Map([
            ['note-a', { type: 'mission', commander: '[[rico]]' }],
            ['rico', { type: 'character' }]
        ]);
        const nowMs = Date.parse('2026-07-06T00:00:00Z');
        const addedGravity = buildRelationshipGravity(
            [{ type: 'relation_added', noteId: 'note-a', field: 'commander', newValue: '[[rico]]', timestamp: '2026-07-05T00:00:00Z' }],
            fieldsCache, nowMs
        );
        const removedGravity = buildRelationshipGravity(
            [{ type: 'relation_removed', noteId: 'note-a', field: 'commander', oldValue: '[[rico]]', newValue: null, timestamp: '2026-07-05T00:00:00Z' }],
            fieldsCache, nowMs
        );
        const added = getEdgeGravity('note-a', 'commander', 'rico', addedGravity);
        const removed = getEdgeGravity('note-a', 'commander', 'rico', removedGravity);
        assert.ok(removed.decayedMutationWeight < added.decayedMutationWeight);
        assert.ok(removed.decayedMutationWeight > 0, 'removal still carries some signal, just less');
    });

    it('ignores id and type fields', () => {
        const fieldsCache = new Map([
            ['note-a', { id: '[[note-a]]', type: '[[mission-schema]]' }]
        ]);
        const gravity = buildRelationshipGravity([], fieldsCache);
        assert.equal(gravity.size, 0);
    });
});

describe('relationshipGravity — getEdgeGravity', () => {
    it('returns a zeroed shape for an unknown edge rather than throwing', () => {
        const edge = getEdgeGravity('nope', 'field', 'target', new Map());
        assert.deepEqual(edge, { score: 0, structuralWeight: 0, decayedMutationWeight: 0, repetition: 0 });
    });

    it('returns a zeroed shape when the gravity map itself is null/undefined', () => {
        assert.deepEqual(getEdgeGravity('a', 'b', 'c', null), { score: 0, structuralWeight: 0, decayedMutationWeight: 0, repetition: 0 });
        assert.deepEqual(getEdgeGravity('a', 'b', 'c', undefined), { score: 0, structuralWeight: 0, decayedMutationWeight: 0, repetition: 0 });
    });
});

describe('relationshipGravity — getTopGravityEdges', () => {
    it('returns an empty array for a null/undefined/empty gravity map', () => {
        assert.deepEqual(getTopGravityEdges(null), []);
        assert.deepEqual(getTopGravityEdges(undefined), []);
        assert.deepEqual(getTopGravityEdges(new Map()), []);
    });

    it('excludes single-instance edges with no corroborating signal — most edges in a real vault', () => {
        const fieldsCache = new Map([
            ['note-a', { type: 'mission', commander: '[[rico]]' }],
            ['rico', { type: 'character' }]
        ]);
        const gravity = buildRelationshipGravity([], fieldsCache);
        assert.deepEqual(getTopGravityEdges(gravity), [], 'a lone edge with structuralWeight 1 and no mutation history carries no real corroboration');
    });

    it('surfaces an edge reinforced by multiple fields pointing at the same target', () => {
        const fieldsCache = new Map([
            ['note-a', { type: 'mission', commander: '[[rico]]', mentor: '[[rico]]' }],
            ['rico', { type: 'character' }]
        ]);
        const gravity = buildRelationshipGravity([], fieldsCache);
        const top = getTopGravityEdges(gravity);
        assert.equal(top.length, 2, 'both the commander and mentor edges to rico share the structural corroboration');
        assert.ok(top.every((edge) => edge.targetId === 'rico'));
    });

    it('surfaces an edge reinforced by repeated mutation-log touches', () => {
        const fieldsCache = new Map([
            ['note-a', { type: 'mission', commander: '[[rico]]' }],
            ['rico', { type: 'character' }]
        ]);
        const nowMs = Date.parse('2026-07-15T00:00:00Z');
        const events = [
            { type: 'relation_added', noteId: 'note-a', field: 'commander', newValue: '[[rico]]', timestamp: '2026-06-01T00:00:00Z' },
            { type: 'relation_changed', noteId: 'note-a', field: 'commander', newValue: '[[rico]]', timestamp: '2026-07-01T00:00:00Z' }
        ];
        const gravity = buildRelationshipGravity(events, fieldsCache, nowMs);
        const top = getTopGravityEdges(gravity);
        assert.equal(top.length, 1);
        assert.equal(top[0].repetition, 2);
    });

    it('ranks edges by score, descending, and respects the limit option', () => {
        const fieldsCache = new Map([
            ['note-a', { type: 'mission', commander: '[[rico]]', mentor: '[[rico]]' }],
            ['note-b', { type: 'mission', commander: '[[carmen]]', mentor: '[[carmen]]', ally: '[[carmen]]' }],
            ['rico', { type: 'character' }],
            ['carmen', { type: 'character' }]
        ]);
        const gravity = buildRelationshipGravity([], fieldsCache);
        const top = getTopGravityEdges(gravity, { limit: 1 });
        assert.equal(top.length, 1);
        assert.equal(top[0].targetId, 'carmen', 'the 3-field-corroborated edge should outrank the 2-field one');
    });
});
