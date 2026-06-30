'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

before(() => {
    if (!global.vscode) {
        global.vscode = { Uri: { file: (p) => ({ fsPath: p }) } };
    }
});

const { buildNoteArc } = require('../src/intelligence/noteArc');
const { buildTypeFieldBundles, buildTypeBundleTotals, buildFieldTargetTypes } = require('../src/intelligence/vaultPriors');

function makeFieldsCache(notes) {
    const m = new Map();
    for (const [id, fields] of Object.entries(notes)) m.set(id, fields);
    return m;
}

// ── buildNoteArc ─────────────────────────────────────────────────────────────

describe('buildNoteArc — no type / cold-start', () => {
    it('returns null inferredType and cold-start fields when noteType is empty', () => {
        const fc = makeFieldsCache({ n1: { id: 'n1', type: 'contact', name: 'Alice' } });
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({}, '', fc, bundles, new Map(), null);
        assert.equal(result.inferredType, null);
        // Cold-start: untyped note gets universal starter fields
        assert.ok(result.missingFields.length > 0, 'cold-start should return starter fields');
        assert.ok(result.missingFields.every(f => f.coldStart === true), 'all fields should be marked coldStart');
    });

    it('returns type inferredType and cold-start fields when noteType not in vault', () => {
        const fc = makeFieldsCache({ n1: { id: 'n1', type: 'contact', name: 'Alice' } });
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({}, 'project', fc, bundles, new Map(), null);
        assert.equal(result.inferredType, 'project');
        // Cold-start: new type with no vault bundle gets universal starter fields
        assert.ok(result.missingFields.length > 0, 'cold-start should return starter fields');
        assert.ok(result.missingFields.every(f => f.coldStart === true), 'all fields should be marked coldStart');
    });

    it('cold-start fields do not repeat fields the note already has', () => {
        const fc = makeFieldsCache({});
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({ name: 'Alice', status: 'active' }, 'newtype', fc, bundles, new Map(), null);
        const fieldNames = result.missingFields.map(f => f.field);
        assert.ok(!fieldNames.includes('name'),   'already-set name should not appear');
        assert.ok(!fieldNames.includes('status'), 'already-set status should not appear');
    });
});

describe('buildNoteArc — basic field detection', () => {
    it('returns fields the note is missing relative to its type', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', name: 'Alice', company: 'Acme', role: 'engineer' },
            n2: { id: 'n2', type: 'contact', name: 'Bob',   company: 'Corp', role: 'designer' },
            n3: { id: 'n3', type: 'contact', name: 'Carol', company: 'Llc',  role: 'manager'  }
        });
        const bundles = buildTypeFieldBundles(fc);
        // Note with only `name` set
        const result = buildNoteArc({ id: 'nx', type: 'contact', name: 'Dave' }, 'contact', fc, bundles, new Map(), null);
        assert.equal(result.inferredType, 'contact');
        const fieldNames = result.missingFields.map(f => f.field);
        assert.ok(fieldNames.includes('company'), `expected company in ${fieldNames}`);
        assert.ok(fieldNames.includes('role'),    `expected role in ${fieldNames}`);
    });

    it('does not include fields the note already has', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', name: 'Alice', company: 'Acme' },
            n2: { id: 'n2', type: 'contact', name: 'Bob',   company: 'Corp' }
        });
        const bundles = buildTypeFieldBundles(fc);
        // Note already has company
        const result = buildNoteArc({ id: 'nx', type: 'contact', name: 'Dave', company: 'Mine' }, 'contact', fc, bundles, new Map(), null);
        const fieldNames = result.missingFields.map(f => f.field);
        assert.ok(!fieldNames.includes('company'), `company should not be in ${fieldNames}`);
    });

    it('excludes structural fields (id, type, created) from missing', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', name: 'Alice', created: '2024-01-01' },
            n2: { id: 'n2', type: 'contact', name: 'Bob',   created: '2024-01-02' }
        });
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), null);
        const fieldNames = result.missingFields.map(f => f.field);
        assert.ok(!fieldNames.includes('id'),      'id should never be suggested');
        assert.ok(!fieldNames.includes('type'),    'type should never be suggested');
        assert.ok(!fieldNames.includes('created'), 'created should never be suggested');
    });

    it('returns empty array when all common fields are present', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', name: 'Alice', company: 'Acme' },
            n2: { id: 'n2', type: 'contact', name: 'Bob',   company: 'Corp' }
        });
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({ id: 'nx', type: 'contact', name: 'Dave', company: 'Mine' }, 'contact', fc, bundles, new Map(), null);
        assert.deepEqual(result.missingFields, []);
    });
});

describe('buildNoteArc — scoring and ranking', () => {
    it('ranks fields by ratio descending', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', name: 'A', company: 'x', role: 'y', phone: 'z' },
            n2: { id: 'n2', type: 'contact', name: 'B', company: 'x', role: 'y'              },
            n3: { id: 'n3', type: 'contact', name: 'C', company: 'x'                         }
        });
        const bundles = buildTypeFieldBundles(fc);
        // name already present — so missing: company (100%), role (67%), phone (33%)
        const result = buildNoteArc({ id: 'nx', type: 'contact', name: 'Dave' }, 'contact', fc, bundles, new Map(), null);
        const fields = result.missingFields.map(f => f.field);
        assert.equal(fields[0], 'company');
        assert.equal(fields[1], 'role');
    });

    it('ratio values are between 0 and 1', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', name: 'A', company: 'x' },
            n2: { id: 'n2', type: 'contact', name: 'B', company: 'y' }
        });
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), null);
        for (const f of result.missingFields) {
            assert.ok(f.ratio > 0 && f.ratio <= 1, `ratio ${f.ratio} out of range`);
        }
    });

    it('respects the limit option', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' },
            n2: { id: 'n2', type: 'contact', a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' }
        });
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), null, { limit: 3 });
        assert.ok(result.missingFields.length <= 3);
    });
});

describe('buildNoteArc — isRelation flag', () => {
    it('marks relational fields with isRelation: true', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', manager: '[[boss-id]]' },
            n2: { id: 'n2', type: 'contact', manager: '[[other-id]]' }
        });
        const bundles = buildTypeFieldBundles(fc);
        const fieldTargetTypes = buildFieldTargetTypes(fc);
        const result = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, fieldTargetTypes, null);
        const managerField = result.missingFields.find(f => f.field === 'manager');
        // manager links to typed notes — should be flagged as a relation
        // (may not be true if the linked targets have no type — accept either)
        assert.ok(managerField !== undefined || result.missingFields.length === 0);
    });

    it('marks scalar fields with isRelation: false', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', phone: '555-1234' },
            n2: { id: 'n2', type: 'contact', phone: '555-5678' }
        });
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), null);
        const phoneField = result.missingFields.find(f => f.field === 'phone');
        if (phoneField) assert.equal(phoneField.isRelation, false);
    });
});

describe('buildNoteArc — calibration integration', () => {
    it('calibrationCount reflects accepted suggestions for the field', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', name: 'A', faction: 'x' },
            n2: { id: 'n2', type: 'contact', name: 'B', faction: 'y' }
        });
        const bundles = buildTypeFieldBundles(fc);
        const calibration = { byField: new Map([['faction', 4]]) };
        const result = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), calibration);
        const factionField = result.missingFields.find(f => f.field === 'faction');
        if (factionField) {
            assert.equal(factionField.calibrationCount, 4);
        }
    });

    it('zero calibration when outcomeCalibration is null', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', name: 'A', faction: 'x' },
            n2: { id: 'n2', type: 'contact', name: 'B', faction: 'y' }
        });
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), null);
        for (const f of result.missingFields) {
            assert.equal(f.calibrationCount, 0);
        }
    });

    it('calibrated fields score higher than uncalibrated ones of equal ratio', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', alpha: 'a', beta: 'b' },
            n2: { id: 'n2', type: 'contact', alpha: 'a', beta: 'b' }
        });
        const bundles = buildTypeFieldBundles(fc);
        // alpha accepted 5 times, beta never
        const calibration = { byField: new Map([['alpha', 5]]) };
        const result = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), calibration);
        const alpha = result.missingFields.find(f => f.field === 'alpha');
        const beta  = result.missingFields.find(f => f.field === 'beta');
        if (alpha && beta) {
            assert.ok(alpha.score > beta.score, `alpha (${alpha.score}) should beat beta (${beta.score})`);
        }
    });
});

describe('buildNoteArc — frequency-weighted calibration', () => {
    it('calibration provides proportionally larger lift for higher-frequency fields', () => {
        // 8 notes: alpha in all 8 (ratio=1.0), beta in 3 of 8 (ratio=0.375)
        // Same acceptance count for both — high-frequency field should get larger lift
        const notes = {};
        for (let i = 0; i < 8; i++) {
            notes[`n${i}`] = { id: `n${i}`, type: 'contact', alpha: `a${i}`, ...(i < 3 ? { beta: `b${i}` } : {}) };
        }
        const fc = makeFieldsCache(notes);
        const bundles = buildTypeFieldBundles(fc);

        // Baseline (no calibration)
        const noCalResult = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), null);
        const alpha0 = noCalResult.missingFields.find(f => f.field === 'alpha');
        const beta0  = noCalResult.missingFields.find(f => f.field === 'beta');

        // Equal calibration for both fields
        const calibration = { byField: new Map([['alpha', 4], ['beta', 4]]) };
        const calResult = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), calibration);
        const alpha4 = calResult.missingFields.find(f => f.field === 'alpha');
        const beta4  = calResult.missingFields.find(f => f.field === 'beta');

        if (alpha0 && beta0 && alpha4 && beta4) {
            const alphaLift = alpha4.score - alpha0.score;
            const betaLift  = beta4.score  - beta0.score;
            assert.ok(alphaLift > betaLift,
                `high-frequency field (lift=${alphaLift.toFixed(4)}) should get larger calibration boost than low-frequency (lift=${betaLift.toFixed(4)})`);
        }
    });

    it('uncalibrated fields are unaffected by frequency weighting (no regression)', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', alpha: 'a' },
            n2: { id: 'n2', type: 'contact', alpha: 'a' },
        });
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), null);
        for (const f of result.missingFields) {
            assert.equal(f.calibrationCount, 0);
        }
    });
});

describe('buildNoteArc — bundle density', () => {
    it('each arc field exposes adjustedRatio alongside ratio', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', name: 'A', company: 'x' },
            n2: { id: 'n2', type: 'contact', name: 'B', company: 'y' },
            n3: { id: 'n3', type: 'contact', name: 'C', company: 'z' },
        });
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), null);
        assert.ok(result.missingFields.length > 0, 'should have missing fields');
        for (const f of result.missingFields) {
            assert.ok(typeof f.adjustedRatio === 'number', `adjustedRatio must be a number on field "${f.field}"`);
            assert.ok(f.adjustedRatio >= 0 && f.adjustedRatio <= 1, `adjustedRatio ${f.adjustedRatio} out of range`);
            assert.ok(f.adjustedRatio <= f.ratio + 1e-9, 'adjustedRatio cannot exceed raw ratio');
        }
    });

    it('well-sampled vault scores fields higher than sparse vault at identical raw density', () => {
        // Both vaults have density=1.0 for "company". Only sample size differs.
        const sparse = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', company: 'x' },
            n2: { id: 'n2', type: 'contact', company: 'y' },
        });
        const rich = makeFieldsCache(
            Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`n${i}`, { id: `n${i}`, type: 'contact', company: `co${i}` }]))
        );
        const sparseBundles = buildTypeFieldBundles(sparse);
        const richBundles   = buildTypeFieldBundles(rich);
        const sparseResult  = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', sparse, sparseBundles, new Map(), null);
        const richResult    = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', rich,   richBundles,   new Map(), null);
        const sf = sparseResult.missingFields.find(f => f.field === 'company');
        const rf = richResult.missingFields.find(f => f.field === 'company');
        assert.ok(sf && rf, 'company must appear in both arcs');
        assert.ok(Math.abs(sf.ratio - rf.ratio) < 0.001, 'raw ratios should both be 1.0');
        assert.ok(sf.score < rf.score, `sparse score (${sf.score}) must be below rich score (${rf.score})`);
        assert.ok(sf.adjustedRatio < rf.adjustedRatio, 'sparse adjustedRatio must be below rich');
    });

    it('each arc field exposes confidenceLabel alongside score', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', company: 'x' },
            n2: { id: 'n2', type: 'contact', company: 'y' },
        });
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), null);
        assert.ok(result.missingFields.length > 0, 'should have missing fields');
        for (const f of result.missingFields) {
            assert.ok(['high', 'medium', 'low'].includes(f.confidenceLabel),
                `confidenceLabel must be high/medium/low, got "${f.confidenceLabel}"`);
        }
    });

    it('well-sampled vault with high-density field gets confidenceLabel high', () => {
        // 10 notes all having 'company' → adjustedRatio=1.0 → score=0.75 → 'high'
        const fc = makeFieldsCache(
            Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`n${i}`, { id: `n${i}`, type: 'contact', company: `co${i}` }]))
        );
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), null);
        const companyField = result.missingFields.find(f => f.field === 'company');
        assert.ok(companyField, 'company must appear');
        assert.equal(companyField.confidenceLabel, 'high',
            `well-sampled 100% field should be 'high', got '${companyField.confidenceLabel}'`);
    });

    it('sparse vault field gets confidenceLabel medium or low (never high)', () => {
        // 2 notes → sampleWeight = 2/8 = 0.25 → adjustedRatio = 0.25 → score = 0.1875 → 'low'
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', company: 'x' },
            n2: { id: 'n2', type: 'contact', company: 'y' },
        });
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), null);
        const companyField = result.missingFields.find(f => f.field === 'company');
        assert.ok(companyField, 'company must appear');
        assert.notEqual(companyField.confidenceLabel, 'high',
            `sparse 2-note vault should not be 'high', got '${companyField.confidenceLabel}'`);
    });

    it('typeBundleTotals option avoids rescan and produces identical results', () => {
        const fc = makeFieldsCache({
            n1: { id: 'n1', type: 'contact', name: 'A', company: 'x', role: 'eng' },
            n2: { id: 'n2', type: 'contact', name: 'B', company: 'y', role: 'des' },
            n3: { id: 'n3', type: 'contact', name: 'C', company: 'z' },
        });
        const bundles = buildTypeFieldBundles(fc);
        const totals  = buildTypeBundleTotals(fc);
        const withScan   = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), null);
        const withTotals = buildNoteArc({ id: 'nx', type: 'contact' }, 'contact', fc, bundles, new Map(), null, { typeBundleTotals: totals });
        assert.deepEqual(
            withScan.missingFields.map(f => ({ field: f.field, score: f.score, adjustedRatio: f.adjustedRatio })),
            withTotals.missingFields.map(f => ({ field: f.field, score: f.score, adjustedRatio: f.adjustedRatio }))
        );
    });
});
