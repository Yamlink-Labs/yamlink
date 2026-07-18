'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildImplicitFieldWeights,
    buildBehavioralRelationPriors,
    getImplicitBoost,
    buildFieldVolatility,
    getTemporalConfidenceAdjustment
} = require('../src/intelligence/implicitWeights');

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

// ─── signal decay ────────────────────────────────────────────────────────────

describe('implicitWeights — signal decay', () => {
    const HALF_LIFE = 180;
    const MS_PER_DAY = 86400000;

    it('events with no timestamp get full decay weight (1.0)', () => {
        const events = [
            { type: 'relation_changed', field: 'commander', newValue: '[[rico]]', noteId: 'a' }
        ];
        const weights = buildImplicitFieldWeights(events);
        const w = weights.get('commander');
        assert.ok(Math.abs(w.decayedWeight - 1.0) < 0.001,
            `no-timestamp event should get decayedWeight 1.0, got ${w.decayedWeight}`);
    });

    it('event at exactly half-life age contributes ~0.5 decayed weight', () => {
        const nowMs = Date.now();
        const events = [{
            type: 'relation_changed', field: 'commander', newValue: '[[rico]]', noteId: 'a',
            timestamp: new Date(nowMs - HALF_LIFE * MS_PER_DAY).toISOString()
        }];
        const weights = buildImplicitFieldWeights(events, nowMs);
        const w = weights.get('commander');
        assert.ok(w, 'weight entry must exist');
        assert.ok(Math.abs(w.decayedWeight - 0.5) < 0.01,
            `half-life event should give decayedWeight ~0.5, got ${w.decayedWeight}`);
    });

    it('recent event gives higher boost than stale event at identical raw count', () => {
        const nowMs = Date.now();
        const recentWeights = buildImplicitFieldWeights([{
            type: 'relation_changed', field: 'commander', newValue: '[[rico]]', noteId: 'a',
            timestamp: new Date(nowMs).toISOString()
        }], nowMs);
        const staleWeights = buildImplicitFieldWeights([{
            type: 'relation_changed', field: 'commander', newValue: '[[rico]]', noteId: 'a',
            timestamp: new Date(nowMs - HALF_LIFE * 2 * MS_PER_DAY).toISOString()
        }], nowMs);
        const recentBoost = getImplicitBoost('commander', recentWeights).boost;
        const staleBoost  = getImplicitBoost('commander', staleWeights).boost;
        assert.ok(recentBoost > staleBoost,
            `recent boost (${recentBoost}) should exceed stale boost (${staleBoost})`);
    });

    it('event older than 4× half-life decays below floor and gives zero boost', () => {
        const nowMs = Date.now();
        const events = [{
            type: 'relation_changed', field: 'commander', newValue: '[[rico]]', noteId: 'a',
            timestamp: new Date(nowMs - HALF_LIFE * 4 * MS_PER_DAY).toISOString()
        }];
        const weights = buildImplicitFieldWeights(events, nowMs);
        const { boost } = getImplicitBoost('commander', weights);
        assert.equal(boost, 0,
            `event older than 4 half-lives (~${HALF_LIFE * 4}d) should give 0 boost`);
    });

    it('multiple recent events accumulate decayed weight correctly', () => {
        const nowMs = Date.now();
        const ts = new Date(nowMs).toISOString();
        const events = Array.from({ length: 3 }, (_, i) => ({
            type: 'relation_changed', field: 'cmd', newValue: '[[x]]', noteId: `n${i}`, timestamp: ts
        }));
        const weights = buildImplicitFieldWeights(events, nowMs);
        const w = weights.get('cmd');
        assert.ok(Math.abs(w.decayedWeight - 3.0) < 0.01,
            `3 fresh events should give decayedWeight ~3.0, got ${w.decayedWeight}`);
    });

    it('raw relationCount still reflects integer count regardless of decay', () => {
        const nowMs = Date.now();
        const events = [
            { type: 'relation_changed', field: 'commander', newValue: '[[rico]]', noteId: 'a',
              timestamp: new Date(nowMs).toISOString() },
            { type: 'relation_changed', field: 'commander', newValue: '[[carmen]]', noteId: 'b',
              timestamp: new Date(nowMs - HALF_LIFE * MS_PER_DAY).toISOString() }
        ];
        const weights = buildImplicitFieldWeights(events, nowMs);
        const w = weights.get('commander');
        assert.equal(w.relationCount, 2, 'raw relationCount must remain an integer counter');
        assert.ok(w.decayedWeight > 1.0 && w.decayedWeight < 2.0,
            `decayedWeight should be between 1 and 2 (got ${w.decayedWeight})`);
    });
});

describe('implicitWeights — behavioral relation priors', () => {
    it('builds note-type-scoped target type and id scores from recent relation history', () => {
        const fieldsCache = new Map([
            ['carl', { type: 'character' }],
            ['dizzy', { type: 'character' }],
            ['roughnecks', { type: 'unit' }],
            ['ace-levy', { type: 'character', unit: '[[roughnecks]]' }]
        ]);
        const priors = buildBehavioralRelationPriors([
            { type: 'relation_changed', noteId: 'ace-levy', field: 'unit', newValue: '[[roughnecks]]' },
            { type: 'relation_changed', noteId: 'ace-levy', field: 'commander', newValue: '[[carl]]' },
            { type: 'relation_changed', noteId: 'ace-levy', field: 'commander', newValue: '[[dizzy]]' }
        ], fieldsCache);

        assert.equal(priors.fieldTargetTypeScores.get('unit').get('unit') > 0, true);
        assert.equal(priors.fieldTargetIdScores.get('unit').get('roughnecks') > 0, true);
        assert.equal(priors.noteTypeFieldTargetTypeScores.get('character').get('unit').get('unit') > 0, true);
        assert.equal(priors.noteTypeFieldTargetIdScores.get('character').get('unit').get('roughnecks') > 0, true);
    });
});

// ─── buildFieldVolatility / getTemporalConfidenceAdjustment ────────────────

describe('implicitWeights — buildFieldVolatility', () => {
    it('returns empty map for no events', () => {
        assert.equal(buildFieldVolatility([]).size, 0);
        assert.equal(buildFieldVolatility(null).size, 0);
    });

    it('ignores fields under the minimum sample size', () => {
        const events = [
            { type: 'field_added', field: 'status' },
            { type: 'field_changed', field: 'status' }
        ];
        assert.equal(buildFieldVolatility(events).has('status'), false);
    });

    it('computes a high volatility score for a frequently-revised field', () => {
        const events = [
            { type: 'field_added', field: 'status' },
            { type: 'field_changed', field: 'status' },
            { type: 'field_changed', field: 'status' },
            { type: 'field_changed', field: 'status' }
        ];
        const v = buildFieldVolatility(events).get('status');
        assert.equal(v.added, 1);
        assert.equal(v.changed, 3);
        assert.equal(v.total, 4);
        assert.equal(v.volatilityScore, 0.75);
    });

    it('computes a low volatility score for a write-once field', () => {
        const events = [
            { type: 'field_added', field: 'commander' },
            { type: 'field_added', field: 'commander' },
            { type: 'field_added', field: 'commander' }
        ];
        const v = buildFieldVolatility(events).get('commander');
        assert.equal(v.volatilityScore, 0);
    });

    it('ignores id and type fields', () => {
        const events = [
            { type: 'field_changed', field: 'id' },
            { type: 'field_changed', field: 'id' },
            { type: 'field_changed', field: 'id' },
            { type: 'field_changed', field: 'type' },
            { type: 'field_changed', field: 'type' },
            { type: 'field_changed', field: 'type' }
        ];
        assert.equal(buildFieldVolatility(events).size, 0);
    });
});

describe('implicitWeights — getTemporalConfidenceAdjustment', () => {
    it('is a no-op with no volatility map', () => {
        assert.deepEqual(getTemporalConfidenceAdjustment('status', null), { multiplier: 1, reason: null });
        assert.deepEqual(getTemporalConfidenceAdjustment('status', new Map()), { multiplier: 1, reason: null });
    });

    it('is a no-op for a field with no volatility entry', () => {
        const volatility = buildFieldVolatility([
            { type: 'field_added', field: 'commander' },
            { type: 'field_changed', field: 'commander' },
            { type: 'field_changed', field: 'commander' }
        ]);
        assert.deepEqual(getTemporalConfidenceAdjustment('unrelated-field', volatility), { multiplier: 1, reason: null });
    });

    it('penalizes a high-volatility field below 1', () => {
        const volatility = buildFieldVolatility([
            { type: 'field_added', field: 'status' },
            { type: 'field_changed', field: 'status' },
            { type: 'field_changed', field: 'status' },
            { type: 'field_changed', field: 'status' }
        ]);
        const { multiplier, reason } = getTemporalConfidenceAdjustment('status', volatility);
        assert.ok(multiplier < 1);
        assert.match(reason, /revised often/);
    });

    it('boosts a stable, write-once field above 1', () => {
        const volatility = buildFieldVolatility([
            { type: 'field_added', field: 'commander' },
            { type: 'field_added', field: 'commander' },
            { type: 'field_added', field: 'commander' }
        ]);
        const { multiplier, reason } = getTemporalConfidenceAdjustment('commander', volatility);
        assert.ok(multiplier > 1);
        assert.match(reason, /stayed stable/);
    });
});
