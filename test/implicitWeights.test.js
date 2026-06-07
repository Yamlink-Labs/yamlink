'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildImplicitFieldWeights, getImplicitBoost } = require('../src/intelligence/implicitWeights');

// ─── buildImplicitFieldWeights ────────────────────────────────────────────

describe('implicitWeights — buildImplicitFieldWeights', () => {
    it('returns empty map for no events', () => {
        assert.equal(buildImplicitFieldWeights([]).size, 0);
        assert.equal(buildImplicitFieldWeights(null).size, 0);
        assert.equal(buildImplicitFieldWeights(undefined).size, 0);
    });

    it('counts relation_changed events with wikilink newValue', () => {
        const events = [
            { type: 'relation_changed', field: 'commander', newValue: '[[rico]]', noteId: 'a' },
            { type: 'relation_changed', field: 'commander', newValue: '[[carmen]]', noteId: 'b' },
        ];
        const weights = buildImplicitFieldWeights(events);
        assert.ok(weights.has('commander'));
        assert.equal(weights.get('commander').relationCount, 2);
        assert.equal(weights.get('commander').total, 2);
    });

    it('counts field_added events with wikilink newValue', () => {
        const events = [
            { type: 'field_added', field: 'faction', newValue: '[[roughnecks]]', noteId: 'a' },
        ];
        const weights = buildImplicitFieldWeights(events);
        assert.equal(weights.get('faction').relationCount, 1);
    });

    it('counts total but not relationCount for non-wikilink newValue', () => {
        const events = [
            { type: 'relation_changed', field: 'status', newValue: 'active', noteId: 'a' },
            { type: 'relation_changed', field: 'status', newValue: 'done', noteId: 'b' },
        ];
        const weights = buildImplicitFieldWeights(events);
        const w = weights.get('status');
        assert.equal(w.total, 2);
        assert.equal(w.relationCount, 0);
    });

    it('ignores id and type fields', () => {
        const events = [
            { type: 'relation_changed', field: 'id', newValue: '[[x]]', noteId: 'a' },
            { type: 'relation_changed', field: 'type', newValue: '[[x]]', noteId: 'a' },
        ];
        const weights = buildImplicitFieldWeights(events);
        assert.equal(weights.size, 0);
    });

    it('ignores note_created and type_set events', () => {
        const events = [
            { type: 'note_created', field: 'commander', newValue: '[[rico]]', noteId: 'a' },
            { type: 'type_set', field: 'type', newValue: 'character', noteId: 'a' },
        ];
        assert.equal(buildImplicitFieldWeights(events).size, 0);
    });

    it('normalizes field names to lowercase', () => {
        const events = [
            { type: 'relation_changed', field: 'Commander', newValue: '[[rico]]', noteId: 'a' },
            { type: 'relation_changed', field: 'commander', newValue: '[[carmen]]', noteId: 'b' },
        ];
        const weights = buildImplicitFieldWeights(events);
        assert.equal(weights.size, 1);
        assert.equal(weights.get('commander').relationCount, 2);
    });
});

// ─── getImplicitBoost ────────────────────────────────────────────────────

describe('implicitWeights — getImplicitBoost', () => {
    it('returns 0 boost for empty weights map', () => {
        const { boost } = getImplicitBoost('commander', new Map());
        assert.equal(boost, 0);
    });

    it('returns 0 boost when field has no relation history', () => {
        const weights = buildImplicitFieldWeights([
            { type: 'relation_changed', field: 'status', newValue: 'active', noteId: 'a' }
        ]);
        const { boost } = getImplicitBoost('commander', weights);
        assert.equal(boost, 0);
    });

    it('returns positive boost after 1 confirmed relation use', () => {
        const weights = buildImplicitFieldWeights([
            { type: 'relation_changed', field: 'commander', newValue: '[[rico]]', noteId: 'a' }
        ]);
        const { boost, reason } = getImplicitBoost('commander', weights);
        assert.ok(boost >= 0.10, `expected >= 0.10, got ${boost}`);
        assert.ok(typeof reason === 'string');
    });

    it('boost grows with more confirmed uses', () => {
        const make = (count) => buildImplicitFieldWeights(
            Array.from({ length: count }, (_, i) => ({
                type: 'relation_changed', field: 'commander', newValue: '[[x]]', noteId: `n${i}`
            }))
        );
        const boost1 = getImplicitBoost('commander', make(1)).boost;
        const boost5 = getImplicitBoost('commander', make(5)).boost;
        assert.ok(boost5 > boost1, `5 uses should boost more than 1 (${boost5} > ${boost1})`);
    });

    it('boost is capped at 0.28', () => {
        const weights = buildImplicitFieldWeights(
            Array.from({ length: 50 }, (_, i) => ({
                type: 'relation_changed', field: 'cmd', newValue: '[[x]]', noteId: `n${i}`
            }))
        );
        const { boost } = getImplicitBoost('cmd', weights);
        assert.ok(boost <= 0.28, `boost should not exceed 0.28, got ${boost}`);
    });

    it('returns 0 when total > 0 but relationCount is 0 (field used but not as wikilink)', () => {
        const weights = buildImplicitFieldWeights([
            { type: 'relation_changed', field: 'status', newValue: 'active', noteId: 'a' },
            { type: 'relation_changed', field: 'status', newValue: 'done', noteId: 'b' },
        ]);
        const { boost } = getImplicitBoost('status', weights);
        assert.equal(boost, 0);
    });
});
