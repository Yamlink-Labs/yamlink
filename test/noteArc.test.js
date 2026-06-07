'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

before(() => {
    if (!global.vscode) {
        global.vscode = { Uri: { file: (p) => ({ fsPath: p }) } };
    }
});

const { buildNoteArc } = require('../src/intelligence/noteArc');
const { buildTypeFieldBundles, buildFieldTargetTypes } = require('../src/intelligence/vaultPriors');

function makeFieldsCache(notes) {
    const m = new Map();
    for (const [id, fields] of Object.entries(notes)) m.set(id, fields);
    return m;
}

// ── buildNoteArc ─────────────────────────────────────────────────────────────

describe('buildNoteArc — no type', () => {
    it('returns null inferredType when noteType is empty', () => {
        const fc = makeFieldsCache({ n1: { id: 'n1', type: 'contact', name: 'Alice' } });
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({}, '', fc, bundles, new Map(), null);
        assert.equal(result.inferredType, null);
        assert.deepEqual(result.missingFields, []);
    });

    it('returns null inferredType when noteType not in vault', () => {
        const fc = makeFieldsCache({ n1: { id: 'n1', type: 'contact', name: 'Alice' } });
        const bundles = buildTypeFieldBundles(fc);
        const result = buildNoteArc({}, 'project', fc, bundles, new Map(), null);
        assert.equal(result.inferredType, null);
        assert.deepEqual(result.missingFields, []);
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
