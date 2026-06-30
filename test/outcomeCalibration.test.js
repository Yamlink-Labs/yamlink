'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// Stub vscode before any module that might transitively require it
before(() => {
    if (!global.vscode) {
        global.vscode = { Uri: { file: (p) => ({ fsPath: p }) } };
    }
});

const { buildOutcomeCalibration, getFieldCalibrationBoost } = require('../src/intelligence/outcomeCalibration');

// ── buildOutcomeCalibration ──────────────────────────────────────────────────

describe('buildOutcomeCalibration', () => {
    it('returns empty byField map for empty event array', () => {
        const cal = buildOutcomeCalibration([]);
        assert.equal(cal.byField.size, 0);
    });

    it('returns empty byField map for null events', () => {
        const cal = buildOutcomeCalibration(null);
        assert.equal(cal.byField.size, 0);
    });

    it('counts completion_accepted events per field', () => {
        const events = [
            { type: 'completion_accepted', field: 'commander', noteId: 'n1' },
            { type: 'completion_accepted', field: 'commander', noteId: 'n2' },
            { type: 'completion_accepted', field: 'faction',   noteId: 'n1' }
        ];
        const cal = buildOutcomeCalibration(events);
        assert.equal(cal.byField.get('commander'), 2);
        assert.equal(cal.byField.get('faction'), 1);
    });

    it('counts lightbulb_applied events per field', () => {
        const events = [
            { type: 'lightbulb_applied', field: 'homeworld', noteId: 'n1' },
            { type: 'lightbulb_applied', field: 'homeworld', noteId: 'n2' }
        ];
        const cal = buildOutcomeCalibration(events);
        assert.equal(cal.byField.get('homeworld'), 2);
    });

    it('ignores non-outcome event types', () => {
        const events = [
            { type: 'relation_changed', field: 'commander', noteId: 'n1' },
            { type: 'field_added',      field: 'faction',   noteId: 'n1' },
            { type: 'note_created',     field: null,        noteId: 'n1' },
            { type: 'completion_accepted', field: 'commander', noteId: 'n2' }
        ];
        const cal = buildOutcomeCalibration(events);
        assert.equal(cal.byField.size, 1);
        assert.equal(cal.byField.get('commander'), 1);
    });

    it('ignores events with empty or missing field', () => {
        const events = [
            { type: 'completion_accepted', field: '',   noteId: 'n1' },
            { type: 'completion_accepted', field: null, noteId: 'n2' },
            { type: 'completion_accepted', field: 'ok', noteId: 'n3' }
        ];
        const cal = buildOutcomeCalibration(events);
        assert.equal(cal.byField.size, 1);
        assert.equal(cal.byField.get('ok'), 1);
    });

    it('normalises field names to lowercase', () => {
        const events = [
            { type: 'completion_accepted', field: 'Commander', noteId: 'n1' },
            { type: 'completion_accepted', field: 'COMMANDER', noteId: 'n2' }
        ];
        const cal = buildOutcomeCalibration(events);
        assert.equal(cal.byField.get('commander'), 2);
        assert.equal(cal.byField.size, 1);
    });

    it('mixes completion_accepted and lightbulb_applied counts for the same field', () => {
        const events = [
            { type: 'completion_accepted', field: 'mission', noteId: 'n1' },
            { type: 'lightbulb_applied',   field: 'mission', noteId: 'n2' }
        ];
        const cal = buildOutcomeCalibration(events);
        assert.equal(cal.byField.get('mission'), 2);
    });
});

// ── getFieldCalibrationBoost ────────────────────────────────────────────────

describe('getFieldCalibrationBoost', () => {
    it('returns zero boost for null calibration', () => {
        const { boost } = getFieldCalibrationBoost('commander', null);
        assert.equal(boost, 0);
    });

    it('returns zero boost for calibration with empty byField', () => {
        const cal = buildOutcomeCalibration([]);
        const { boost } = getFieldCalibrationBoost('commander', cal);
        assert.equal(boost, 0);
    });

    it('returns zero boost for a field not in calibration', () => {
        const events = [{ type: 'completion_accepted', field: 'faction', noteId: 'n1' }];
        const cal = buildOutcomeCalibration(events);
        const { boost } = getFieldCalibrationBoost('commander', cal);
        assert.equal(boost, 0);
    });

    it('returns ~0.07 boost for 1 accepted suggestion', () => {
        const events = [{ type: 'completion_accepted', field: 'commander', noteId: 'n1' }];
        const cal = buildOutcomeCalibration(events);
        const { boost, reason } = getFieldCalibrationBoost('commander', cal);
        assert.ok(boost >= 0.07 && boost <= 0.08, `expected ~0.07, got ${boost}`);
        assert.ok(reason.includes('"commander"'));
        assert.ok(reason.includes('once'));
    });

    it('returns increasing boost for more accepted suggestions', () => {
        function boostFor(n) {
            const events = Array.from({ length: n }, (_, i) => ({
                type: 'completion_accepted', field: 'f', noteId: `n${i}`
            }));
            return getFieldCalibrationBoost('f', buildOutcomeCalibration(events)).boost;
        }
        assert.ok(boostFor(1) < boostFor(3));
        assert.ok(boostFor(3) < boostFor(6));
    });

    it('caps boost at 0.15 for many accepted suggestions', () => {
        const events = Array.from({ length: 20 }, (_, i) => ({
            type: 'completion_accepted', field: 'commander', noteId: `n${i}`
        }));
        const cal = buildOutcomeCalibration(events);
        const { boost } = getFieldCalibrationBoost('commander', cal);
        assert.equal(boost, 0.15);
    });

    it('reason mentions count when more than one acceptance', () => {
        const events = [
            { type: 'completion_accepted', field: 'faction', noteId: 'n1' },
            { type: 'completion_accepted', field: 'faction', noteId: 'n2' },
            { type: 'completion_accepted', field: 'faction', noteId: 'n3' }
        ];
        const cal = buildOutcomeCalibration(events);
        const { reason } = getFieldCalibrationBoost('faction', cal);
        assert.ok(reason.includes('3'));
    });
});

// ── signal decay ─────────────────────────────────────────────────────────────

describe('outcomeCalibration — signal decay', () => {
    const HALF_LIFE = 60;
    const MS_PER_DAY = 86400000;

    it('events with no timestamp get full decay weight (1.0 contribution)', () => {
        const cal = buildOutcomeCalibration([
            { type: 'completion_accepted', field: 'commander', noteId: 'n1' }
        ]);
        const count = cal.byField.get('commander');
        assert.ok(Math.abs(count - 1.0) < 0.001,
            `no-timestamp event should contribute 1.0, got ${count}`);
    });

    it('event at exactly half-life age contributes ~0.5', () => {
        const nowMs = Date.now();
        const cal = buildOutcomeCalibration([{
            type: 'completion_accepted', field: 'faction', noteId: 'n1',
            timestamp: new Date(nowMs - HALF_LIFE * MS_PER_DAY).toISOString()
        }], nowMs);
        const count = cal.byField.get('faction');
        assert.ok(count !== undefined, 'faction must be present');
        assert.ok(Math.abs(count - 0.5) < 0.01,
            `count at half-life should be ~0.5, got ${count}`);
    });

    it('recent acceptance gives higher boost than stale acceptance at identical raw count', () => {
        const nowMs = Date.now();
        const recentCal = buildOutcomeCalibration([{
            type: 'completion_accepted', field: 'commander', noteId: 'n1',
            timestamp: new Date(nowMs).toISOString()
        }], nowMs);
        const staleCal = buildOutcomeCalibration([{
            type: 'completion_accepted', field: 'commander', noteId: 'n1',
            timestamp: new Date(nowMs - HALF_LIFE * 2 * MS_PER_DAY).toISOString()
        }], nowMs);
        const recentBoost = getFieldCalibrationBoost('commander', recentCal).boost;
        const staleBoost  = getFieldCalibrationBoost('commander', staleCal).boost;
        assert.ok(recentBoost > staleBoost,
            `recent boost (${recentBoost}) should exceed stale boost (${staleBoost})`);
    });

    it('event older than 4× half-life decays below floor and gives zero boost', () => {
        const nowMs = Date.now();
        const cal = buildOutcomeCalibration([{
            type: 'completion_accepted', field: 'commander', noteId: 'n1',
            timestamp: new Date(nowMs - HALF_LIFE * 4 * MS_PER_DAY).toISOString()
        }], nowMs);
        const { boost } = getFieldCalibrationBoost('commander', cal);
        assert.equal(boost, 0,
            `event older than 4 half-lives (~${HALF_LIFE * 4}d) should give 0 boost`);
    });

    it('mix of recent and stale acceptances accumulates to decayed sum', () => {
        const nowMs = Date.now();
        const cal = buildOutcomeCalibration([
            { type: 'completion_accepted', field: 'f', noteId: 'n1',
              timestamp: new Date(nowMs).toISOString() },
            { type: 'completion_accepted', field: 'f', noteId: 'n2',
              timestamp: new Date(nowMs - HALF_LIFE * MS_PER_DAY).toISOString() }
        ], nowMs);
        const count = cal.byField.get('f');
        // 1.0 (recent) + 0.5 (at half-life) = 1.5
        assert.ok(Math.abs(count - 1.5) < 0.01, `expected ~1.5, got ${count}`);
    });
});
