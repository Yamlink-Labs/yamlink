'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { LEVEL, planFieldActions, canAct } = require('../src/intelligence/fieldPlanner');
const { CATEGORY, RELATION_STRENGTH } = require('../src/intelligence/fieldCategory');

// Helper — build a classification object
function cls(category, confidence, source = 'prior', relationStrength = null) {
    return { category, confidence, source, relationStrength, reasons: [] };
}

// ─── LIGHTBULB surface (proactive, interruptive) ───────────────────────────

describe('fieldPlanner — lightbulb surface', () => {
    it('IDENTITY → silence', () => {
        const p = planFieldActions(cls(CATEGORY.IDENTITY, 0.95), 'lightbulb');
        assert.equal(p.level, LEVEL.SILENCE);
        assert.equal(p.allowedActions.size, 0);
    });

    it('STRUCTURAL → silence', () => {
        const p = planFieldActions(cls(CATEGORY.STRUCTURAL, 0.95), 'lightbulb');
        assert.equal(p.level, LEVEL.SILENCE);
    });

    it('DATE → silence', () => {
        const p = planFieldActions(cls(CATEGORY.DATE, 0.90), 'lightbulb');
        assert.equal(p.level, LEVEL.SILENCE);
    });

    it('WORKFLOW → silence', () => {
        const p = planFieldActions(cls(CATEGORY.WORKFLOW, 0.90), 'lightbulb');
        assert.equal(p.level, LEVEL.SILENCE);
    });

    it('DESCRIPTIVE → silence (we might be wrong, stay quiet)', () => {
        const p = planFieldActions(cls(CATEGORY.DESCRIPTIVE, 0.70), 'lightbulb');
        assert.equal(p.level, LEVEL.SILENCE);
    });

    it('UNKNOWN → silence', () => {
        const p = planFieldActions(cls(CATEGORY.UNKNOWN, 0.0), 'lightbulb');
        assert.equal(p.level, LEVEL.SILENCE);
    });

    it('RELATION + schema → QUICKFIX with full action set', () => {
        const p = planFieldActions(cls(CATEGORY.RELATION, 1.0, 'schema', RELATION_STRENGTH.CERTAIN), 'lightbulb');
        assert.equal(p.level, LEVEL.QUICKFIX);
        assert.ok(p.allowedActions.has('fieldQuickfix'));
        assert.ok(p.allowedActions.has('relationCompletion'));
        assert.ok(p.allowedActions.has('createNote'));
        assert.ok(p.allowedActions.has('documentBundle'));
        assert.ok(p.allowedActions.has('documentView'));
    });

    it('RELATION + high usage confidence → QUICKFIX', () => {
        // 85% wikilinks → confidence 0.60 + 0.85*0.35 = 0.898, * 0.85 source weight = 0.763 ≥ 0.72
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.898, 'usage', RELATION_STRENGTH.CERTAIN), 'lightbulb');
        assert.equal(p.level, LEVEL.QUICKFIX);
    });

    it('RELATION + medium usage → DOCUMENT only', () => {
        // 50% wikilinks → confidence 0.50, * 0.85 = 0.425 → 0.28 ≤ 0.425 < 0.72
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.50, 'usage', RELATION_STRENGTH.LIKELY), 'lightbulb');
        assert.equal(p.level, LEVEL.DOCUMENT);
        assert.ok(p.allowedActions.has('documentBundle'));
        assert.ok(!p.allowedActions.has('fieldQuickfix'));
        assert.ok(!p.allowedActions.has('createNote'));
    });

    it('RELATION + prior (vault consensus, high confidence) → QUICKFIX', () => {
        // prior source weight 0.70; confidence 0.90 → ec 0.63 >= vault-consensus threshold 0.48 → QUICKFIX
        // This represents a field used as relation in 70%+ of same-type notes (empty on this note).
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.90, 'prior', RELATION_STRENGTH.LIKELY), 'lightbulb');
        assert.equal(p.level, LEVEL.QUICKFIX);
        assert.ok(p.allowedActions.has('fieldQuickfix'));
        assert.ok(p.allowedActions.has('relationCompletion'));
    });

    it('RELATION + prior (weak vault evidence) → DOCUMENT', () => {
        // prior source weight 0.70; confidence 0.60 → ec 0.42 < vault-consensus threshold 0.48 → DOCUMENT
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.60, 'prior', RELATION_STRENGTH.LIKELY), 'lightbulb');
        assert.equal(p.level, LEVEL.DOCUMENT);
    });

    it('RELATION + very low usage confidence → silence', () => {
        // 35% wikilinks → confidence 0.35, * 0.85 = 0.2975 < 0.28 is false... wait
        // 0.2975 > 0.28, so it should be HINT
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.35, 'usage', RELATION_STRENGTH.WEAK), 'lightbulb');
        // 0.35 * 0.85 = 0.2975, which is >= 0.28 → HINT
        assert.equal(p.level, LEVEL.HINT);
    });

    it('RELATION + near-zero confidence → silence', () => {
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.20, 'usage', RELATION_STRENGTH.WEAK), 'lightbulb');
        // 0.20 * 0.85 = 0.17 < 0.28 → SILENCE
        assert.equal(p.level, LEVEL.SILENCE);
    });

    it('weak context relations do not escalate to full quickfix even with decent confidence', () => {
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.96, 'context', RELATION_STRENGTH.WEAK), 'lightbulb');
        assert.equal(p.level, LEVEL.DOCUMENT);
        assert.ok(!p.allowedActions.has('fieldQuickfix'));
    });
});

// ─── COMPLETION surface (reactive, user asked) ─────────────────────────────

describe('fieldPlanner — completion surface', () => {
    it('IDENTITY → silence even on completion', () => {
        const p = planFieldActions(cls(CATEGORY.IDENTITY, 0.95), 'completion');
        assert.equal(p.level, LEVEL.SILENCE);
    });

    it('STRUCTURAL → silence even on completion', () => {
        const p = planFieldActions(cls(CATEGORY.STRUCTURAL, 0.95), 'completion');
        assert.equal(p.level, LEVEL.SILENCE);
    });

    it('DATE → silence even on completion', () => {
        const p = planFieldActions(cls(CATEGORY.DATE, 0.90), 'completion');
        assert.equal(p.level, LEVEL.SILENCE);
    });

    it('RELATION + schema → HINT with createNote', () => {
        const p = planFieldActions(cls(CATEGORY.RELATION, 1.0, 'schema', RELATION_STRENGTH.CERTAIN), 'completion');
        assert.equal(p.level, LEVEL.HINT);
        assert.ok(p.allowedActions.has('createNote'));
        assert.ok(p.allowedActions.has('relationCompletion'));
        assert.ok(p.allowedActions.has('fieldHint'));
    });

    it('RELATION + usage but low confidence → HINT without createNote', () => {
        // ec = 0.40 * 0.85 = 0.34 < 0.60 → no createNote
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.40, 'usage', RELATION_STRENGTH.WEAK), 'completion');
        assert.equal(p.level, LEVEL.HINT);
        assert.ok(p.allowedActions.has('relationCompletion'));
        assert.ok(!p.allowedActions.has('createNote'));
    });

    it('weak context relations allow candidates but suppress createNote', () => {
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.82, 'context', RELATION_STRENGTH.WEAK), 'completion');
        assert.equal(p.level, LEVEL.HINT);
        assert.ok(p.allowedActions.has('relationCompletion'));
        assert.ok(!p.allowedActions.has('createNote'));
    });

    it('DESCRIPTIVE → COMPLETION_ONLY when user typed [[', () => {
        const p = planFieldActions(cls(CATEGORY.DESCRIPTIVE, 0.70, 'prior'), 'completion');
        assert.equal(p.level, LEVEL.COMPLETION_ONLY);
        assert.ok(p.allowedActions.has('relationCompletion'));
        assert.ok(!p.allowedActions.has('createNote'));
    });

    it('UNKNOWN → COMPLETION_ONLY when usage source', () => {
        const p = planFieldActions(cls(CATEGORY.UNKNOWN, 0.0, 'usage'), 'completion');
        assert.equal(p.level, LEVEL.COMPLETION_ONLY);
    });

    it('UNKNOWN + default source → silence', () => {
        const p = planFieldActions(cls(CATEGORY.UNKNOWN, 0.0, 'default'), 'completion');
        assert.equal(p.level, LEVEL.SILENCE);
    });
});

// ─── LEVEL ordering ───────────────────────────────────────────────────────

describe('fieldPlanner — level ordering', () => {
    it('SILENCE < COMPLETION_ONLY < HINT < DOCUMENT < QUICKFIX', () => {
        assert.ok(LEVEL.SILENCE < LEVEL.COMPLETION_ONLY);
        assert.ok(LEVEL.COMPLETION_ONLY < LEVEL.HINT);
        assert.ok(LEVEL.HINT < LEVEL.DOCUMENT);
        assert.ok(LEVEL.DOCUMENT < LEVEL.QUICKFIX);
    });
});

// ─── canAct helper ────────────────────────────────────────────────────────

describe('fieldPlanner — canAct', () => {
    it('schema RELATION on lightbulb can fieldQuickfix', () => {
        assert.ok(canAct(cls(CATEGORY.RELATION, 1.0, 'schema', RELATION_STRENGTH.CERTAIN), 'lightbulb', 'fieldQuickfix'));
    });

    it('IDENTITY on lightbulb cannot fieldQuickfix', () => {
        assert.ok(!canAct(cls(CATEGORY.IDENTITY, 0.95), 'lightbulb', 'fieldQuickfix'));
    });

    it('medium usage RELATION on lightbulb can documentBundle but not fieldQuickfix', () => {
        assert.ok(canAct(cls(CATEGORY.RELATION, 0.50, 'usage', RELATION_STRENGTH.LIKELY), 'lightbulb', 'documentBundle'));
        assert.ok(!canAct(cls(CATEGORY.RELATION, 0.50, 'usage', RELATION_STRENGTH.LIKELY), 'lightbulb', 'fieldQuickfix'));
    });

    it('schema RELATION on completion can createNote', () => {
        assert.ok(canAct(cls(CATEGORY.RELATION, 1.0, 'schema', RELATION_STRENGTH.CERTAIN), 'completion', 'createNote'));
    });

    it('DESCRIPTIVE on completion can relationCompletion but not createNote', () => {
        assert.ok(canAct(cls(CATEGORY.DESCRIPTIVE, 0.70), 'completion', 'relationCompletion'));
        assert.ok(!canAct(cls(CATEGORY.DESCRIPTIVE, 0.70), 'completion', 'createNote'));
    });
});

describe('fieldPlanner — debug output', () => {
    it('returns debug metadata for explanation and regression tracing', () => {
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.82, 'usage', RELATION_STRENGTH.LIKELY), 'completion');
        assert.equal(p.debug.relationStrength, RELATION_STRENGTH.LIKELY);
        assert.equal(typeof p.debug.effectiveConfidence, 'number');
        assert.equal(typeof p.debug.sourceWeight, 'number');
    });
});

// ─── Vault-maturity-aware thresholds ──────────────────────────────────────

describe('fieldPlanner — vault maturity scaling', () => {
    // Step 2.5 produces confidence=0.55, source='usage' (weight=0.85)
    // ec = 0.55 * 0.85 = 0.4675
    // On mature vault: DOCUMENT threshold is 0.38 — ec passes (0.4675 >= 0.38)
    // On new vault (maturity=0): DOCUMENT threshold is 0.38*0.65 = 0.247 — ec still passes
    // On mature vault: QUICKFIX threshold is 0.72 — ec fails (0.4675 < 0.72) → DOCUMENT
    function clsSingle(vaultMaturity) {
        return {
            category: CATEGORY.RELATION,
            confidence: 0.55,
            source: 'usage',
            relationStrength: RELATION_STRENGTH.WEAK,
            reasons: [],
            vaultMaturity
        };
    }

    it('one typed link → DOCUMENT or above on a brand-new vault (maturity=0)', () => {
        const p = planFieldActions(clsSingle(0), 'lightbulb');
        assert.ok(p.level >= LEVEL.DOCUMENT, `expected >= DOCUMENT, got level=${p.level}`);
    });

    it('one typed link → DOCUMENT on a mature vault too (ec above DOCUMENT bar)', () => {
        const p = planFieldActions(clsSingle(1), 'lightbulb');
        assert.ok(p.level >= LEVEL.DOCUMENT, `expected >= DOCUMENT, got level=${p.level}`);
    });

    it('one typed link is NOT enough for QUICKFIX on a mature vault', () => {
        const p = planFieldActions(clsSingle(1), 'lightbulb');
        assert.ok(p.level < LEVEL.QUICKFIX, 'single link should not reach QUICKFIX without vault history');
    });

    it('schema always reaches QUICKFIX regardless of maturity', () => {
        const schema = { category: CATEGORY.RELATION, confidence: 1.0, source: 'schema', relationStrength: RELATION_STRENGTH.CERTAIN, reasons: [], vaultMaturity: 0 };
        const p = planFieldActions(schema, 'lightbulb');
        assert.equal(p.level, LEVEL.QUICKFIX);
    });

    it('missing vaultMaturity on classification defaults to mature (no regression)', () => {
        // Old classifications without vaultMaturity field must behave like maturity=1
        const old = cls(CATEGORY.RELATION, 0.82, 'usage', RELATION_STRENGTH.LIKELY);
        const p = planFieldActions(old, 'lightbulb');
        // At maturity=1, ec=0.82*0.85=0.697 — above DOCUMENT (0.38) but below QUICKFIX (0.72)
        assert.ok(p.level >= LEVEL.DOCUMENT);
    });
});

// ─── Source weight coverage — behavior / implicit / calibration ────────────────
//
// These three sources are produced by fieldCategory.js but were previously
// falling through to SOURCE_WEIGHT.default (0.00), silencing all output.
// Each test verifies a basic non-silence outcome on each surface.

describe('fieldPlanner — source weights for learned evidence', () => {
    // behavior: used by behavioral recovery path in fieldCategory (lines 506–524).
    // Confidence range from that path: clamp(0.42 + ratio * 0.18, 0, 0.76).
    // At min ratio=0.52 → confidence≈0.514, ec≈0.386.
    // Expected lightbulb outcome: DOCUMENT (ec >= 0.38 bar, WEAK relation).

    it('behavior source — lightbulb → at least DOCUMENT (not silence)', () => {
        // confidence=0.514, weight=0.75, ec≈0.386 → clears DOCUMENT bar (0.38)
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.514, 'behavior', RELATION_STRENGTH.WEAK), 'lightbulb');
        assert.ok(p.level >= LEVEL.DOCUMENT, `expected DOCUMENT or higher, got ${p.level}`);
        assert.ok(p.allowedActions.has('documentView'));
    });

    it('behavior source — weak lightbulb evidence never reaches QUICKFIX on its own', () => {
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.60, 'behavior', RELATION_STRENGTH.WEAK), 'lightbulb');
        assert.ok(p.level < LEVEL.QUICKFIX, 'behavioral evidence alone must not trigger QUICKFIX');
    });

    it('behavior source — completion → HINT with relation candidates', () => {
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.514, 'behavior', RELATION_STRENGTH.WEAK), 'completion');
        assert.equal(p.level, LEVEL.HINT);
        assert.ok(p.allowedActions.has('relationCompletion'));
    });

    it('behavior source at 0.52 confidence crosses at least HINT on lightbulb', () => {
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.52, 'behavior', RELATION_STRENGTH.WEAK), 'lightbulb');
        assert.ok(p.level >= LEVEL.HINT, `expected HINT or above, got ${p.level}`);
    });

    it('behavior source at 0.30 confidence stays silent on lightbulb', () => {
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.30, 'behavior', RELATION_STRENGTH.LIKELY), 'lightbulb');
        assert.equal(p.level, LEVEL.SILENCE);
    });

    // implicit: mutation log history. Weight 0.80. Confidence from fieldCategory is 0.38–0.75.
    // At minimum confidence 0.38: ec = 0.38 * 0.80 = 0.304 → above HINT bar (0.28) on lightbulb.

    it('implicit source — lightbulb → at least HINT (mutation history recognized)', () => {
        // clamp(0.38 + boost, 0, 0.75) at minimum boost
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.38, 'implicit', RELATION_STRENGTH.WEAK), 'lightbulb');
        assert.ok(p.level >= LEVEL.HINT, `expected HINT or higher, got ${p.level}`);
    });

    it('implicit source with strong signal — lightbulb → DOCUMENT', () => {
        // confidence=0.60, ec = 0.60 * 0.80 = 0.48 → clears DOCUMENT bar (0.38)
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.60, 'implicit', RELATION_STRENGTH.LIKELY), 'lightbulb');
        assert.ok(p.level >= LEVEL.DOCUMENT, `expected DOCUMENT or higher, got ${p.level}`);
    });

    it('implicit source — completion → HINT', () => {
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.50, 'implicit', RELATION_STRENGTH.WEAK), 'completion');
        assert.equal(p.level, LEVEL.HINT);
        assert.ok(p.allowedActions.has('relationCompletion'));
    });

    // calibration: user accepted a prediction. Weight 0.83. Confidence 0.42–0.80.
    // At confidence 0.50: ec = 0.50 * 0.83 = 0.415 → DOCUMENT on lightbulb.
    // At confidence 0.80: ec = 0.80 * 0.83 = 0.664 → still below QUICKFIX (0.72).

    it('calibration source — lightbulb → DOCUMENT', () => {
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.50, 'calibration', RELATION_STRENGTH.WEAK), 'lightbulb');
        assert.ok(p.level >= LEVEL.DOCUMENT, `expected DOCUMENT or higher, got ${p.level}`);
    });

    it('calibration source — lightbulb → QUICKFIX via vault-consensus path when LIKELY', () => {
        // confidence=0.80, weight=0.83, ec=0.664 — isLikelyRelation && ec >= 0.48 vault-consensus bar
        // User explicitly accepted our prediction → high-quality evidence → QUICKFIX allowed
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.80, 'calibration', RELATION_STRENGTH.LIKELY), 'lightbulb');
        assert.equal(p.level, LEVEL.QUICKFIX);
    });

    it('calibration source — completion → HINT', () => {
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.50, 'calibration', RELATION_STRENGTH.WEAK), 'completion');
        assert.equal(p.level, LEVEL.HINT);
        assert.ok(p.allowedActions.has('relationCompletion'));
    });

    it('unknown source still silences via default weight', () => {
        const p = planFieldActions(cls(CATEGORY.RELATION, 0.90, 'default', RELATION_STRENGTH.CERTAIN), 'lightbulb');
        assert.equal(p.level, LEVEL.SILENCE);
    });
});
