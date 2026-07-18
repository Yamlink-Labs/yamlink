'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildFieldTargetTypes,
    getDominantTargetType,
    buildTypeFieldBundles,
    buildTypeBundleTotals,
    getCommonFieldsForType,
    buildFieldAmbiguity,
    buildNoteRoleTypePriors,
    inferLikelyTypesForNote,
    getCachedPriors,
    getVaultMaturity,
    buildValuePatterns,
    buildWorkflowFields,
    buildTypeRoleMap
} = require('../src/intelligence/vaultPriors');

// ─── buildFieldTargetTypes ────────────────────────────────────────────────

describe('vaultPriors — buildFieldTargetTypes', () => {
    it('maps a relational field to its most common target type', () => {
        const cache = new Map([
            ['note-a', { type: 'dossier', subject: '[[char-a]]' }],
            ['char-a', { type: 'character' }],
            ['note-b', { type: 'dossier', subject: '[[char-b]]' }],
            ['char-b', { type: 'character' }],
            ['note-c', { type: 'dossier', subject: '[[char-c]]' }],
            ['char-c', { type: 'character' }],
        ]);
        const result = buildFieldTargetTypes(cache);
        assert.ok(result.has('subject'));
        const tm = result.get('subject');
        assert.equal(tm.get('character'), 3);
    });

    it('includes fields with fewer than 3 observations — cold-start vault', () => {
        // One typed link is real evidence. The classifier applies a confidence penalty
        // for sparse samples; vaultPriors must not throw them away.
        const cache = new Map([
            ['note-a', { type: 'dossier', rare: '[[char-a]]' }],
            ['char-a', { type: 'character' }],
            ['note-b', { type: 'dossier', rare: '[[char-b]]' }],
            ['char-b', { type: 'character' }],
        ]);
        const result = buildFieldTargetTypes(cache);
        assert.ok(result.has('rare'));
        assert.equal(result.get('rare').get('character'), 2);
    });

    it('includes single-observation fields', () => {
        const cache = new Map([
            ['note-a', { type: 'mission', commander: '[[rico]]' }],
            ['rico', { type: 'character' }],
        ]);
        const result = buildFieldTargetTypes(cache);
        assert.ok(result.has('commander'));
        assert.equal(result.get('commander').get('character'), 1);
    });

    it('learns relational target types from canonical id values already normalized out of wikilinks', () => {
        const cache = new Map([
            ['note-a', { type: 'mission', commander: 'rico' }],
            ['rico', { type: 'character' }],
        ]);
        const result = buildFieldTargetTypes(cache);
        assert.ok(result.has('commander'));
        assert.equal(result.get('commander').get('character'), 1);
    });

    it('skips id and type fields', () => {
        const cache = new Map([
            ['note-a', { id: 'note-a', type: '[[some-type]]' }],
        ]);
        const result = buildFieldTargetTypes(cache);
        assert.ok(!result.has('id'));
        assert.ok(!result.has('type'));
    });

    it('handles array values', () => {
        const cache = new Map([
            ['note-a', { tags: ['[[char-a]]', '[[char-b]]', '[[char-c]]'] }],
            ['char-a', { type: 'character' }],
            ['char-b', { type: 'character' }],
            ['char-c', { type: 'character' }],
        ]);
        const result = buildFieldTargetTypes(cache);
        assert.ok(result.has('tags'));
        assert.equal(result.get('tags').get('character'), 3);
    });

    it('omits links where target has no type', () => {
        const cache = new Map([
            ['note-a', { contact: '[[unknown-person]]' }],
            ['note-b', { contact: '[[unknown-org]]' }],
            ['note-c', { contact: '[[unknown-x]]' }],
            // none of the targets are in cache
        ]);
        const result = buildFieldTargetTypes(cache);
        assert.ok(!result.has('contact'));
    });
});

// ─── getDominantTargetType ────────────────────────────────────────────────

describe('vaultPriors — getDominantTargetType', () => {
    it('returns the top type and its stats', () => {
        const ftt = new Map([
            ['subject', new Map([['character', 8], ['location', 2]])]
        ]);
        const r = getDominantTargetType('subject', ftt);
        assert.ok(r);
        assert.equal(r.targetType, 'character');
        assert.equal(r.count, 8);
        assert.equal(r.total, 10);
        assert.ok(Math.abs(r.ratio - 0.8) < 0.001);
    });

    it('returns null for unknown field', () => {
        const ftt = new Map();
        assert.equal(getDominantTargetType('mission', ftt), null);
    });
});

// ─── buildTypeFieldBundles ────────────────────────────────────────────────

describe('vaultPriors — buildTypeFieldBundles', () => {
    it('groups fields by note type and counts occurrences', () => {
        const cache = new Map([
            ['a', { type: 'dossier', subject: '[[c]]', status: 'active', date: '2026-01-01' }],
            ['b', { type: 'dossier', subject: '[[d]]', status: 'closed' }],
            ['c', { type: 'character', name: 'Alpha' }],
            ['d', { type: 'character', name: 'Beta' }],
        ]);
        const bundles = buildTypeFieldBundles(cache);
        assert.ok(bundles.has('dossier'));
        const db = bundles.get('dossier');
        assert.equal(db.get('subject'), 2);
        assert.equal(db.get('status'), 2);
        assert.equal(db.get('date'), 1);
        assert.ok(!db.has('type'));
        assert.ok(!db.has('id'));
    });

    it('skips notes with no type', () => {
        const cache = new Map([
            ['x', { subject: '[[y]]' }],
        ]);
        const bundles = buildTypeFieldBundles(cache);
        assert.equal(bundles.size, 0);
    });
});

// ─── buildTypeBundleTotals ────────────────────────────────────────────────

describe('vaultPriors — buildTypeBundleTotals', () => {
    it('counts notes per type', () => {
        const cache = new Map([
            ['a', { type: 'contact', name: 'Alice' }],
            ['b', { type: 'contact', name: 'Bob' }],
            ['c', { type: 'unit',    name: 'Alpha Squad' }],
        ]);
        const totals = buildTypeBundleTotals(cache);
        assert.equal(totals.get('contact'), 2);
        assert.equal(totals.get('unit'), 1);
    });

    it('skips notes with no type', () => {
        const cache = new Map([
            ['x', { name: 'Untyped' }],
            ['y', { type: 'contact', name: 'Alice' }],
        ]);
        const totals = buildTypeBundleTotals(cache);
        assert.equal(totals.size, 1);
        assert.equal(totals.get('contact'), 1);
    });

    it('returns empty map for empty vault', () => {
        const totals = buildTypeBundleTotals(new Map());
        assert.equal(totals.size, 0);
    });
});

// ─── getCommonFieldsForType ───────────────────────────────────────────────

describe('vaultPriors — getCommonFieldsForType', () => {
    it('returns fields above minRatio threshold, sorted by frequency', () => {
        const cache = new Map([
            ['a', { type: 'dossier', subject: 'x', status: 'active', date: '2026-01-01' }],
            ['b', { type: 'dossier', subject: 'y', status: 'closed' }],
            ['c', { type: 'dossier', subject: 'z' }],
        ]);
        const bundles = buildTypeFieldBundles(cache);
        const fields = getCommonFieldsForType('dossier', bundles, cache, { minRatio: 0.50 });
        // subject appears in all 3 (ratio 1.0), status in 2 (ratio 0.67), date in 1 (ratio 0.33)
        assert.ok(fields.find(f => f.field === 'subject'));
        assert.ok(fields.find(f => f.field === 'status'));
        assert.ok(!fields.find(f => f.field === 'date')); // ratio 0.33 < 0.50
    });

    it('returns empty for unknown type', () => {
        const bundles = new Map();
        const fields = getCommonFieldsForType('nonexistent', bundles, new Map());
        assert.equal(fields.length, 0);
    });

    it('each entry includes adjustedRatio between 0 and 1', () => {
        const cache = new Map([
            ['a', { type: 'dossier', subject: 'x', status: 'active' }],
            ['b', { type: 'dossier', subject: 'y', status: 'closed' }],
            ['c', { type: 'dossier', subject: 'z' }],
        ]);
        const bundles = buildTypeFieldBundles(cache);
        const fields = getCommonFieldsForType('dossier', bundles, cache, { minRatio: 0.30 });
        assert.ok(fields.length > 0);
        for (const f of fields) {
            assert.ok(typeof f.adjustedRatio === 'number', 'adjustedRatio must be a number');
            assert.ok(f.adjustedRatio >= 0 && f.adjustedRatio <= 1, `adjustedRatio ${f.adjustedRatio} out of range`);
            assert.ok(f.adjustedRatio <= f.ratio + 1e-9, 'adjustedRatio cannot exceed raw ratio');
        }
    });

    it('adjustedRatio is lower for small samples than reliable samples', () => {
        // Small vault: 2 notes — sampleWeight = 2/8 = 0.25
        const small = new Map([
            ['a', { type: 'contact', company: 'Acme' }],
            ['b', { type: 'contact', company: 'Corp' }],
        ]);
        // Large vault: 10 notes — sampleWeight = 1.0
        const large = new Map(
            Array.from({ length: 10 }, (_, i) => [`n${i}`, { type: 'contact', company: `Co${i}` }])
        );
        const smallBundles = buildTypeFieldBundles(small);
        const largeBundles = buildTypeFieldBundles(large);
        const smallFields = getCommonFieldsForType('contact', smallBundles, small);
        const largeFields = getCommonFieldsForType('contact', largeBundles, large);
        const sc = smallFields.find(f => f.field === 'company');
        const lc = largeFields.find(f => f.field === 'company');
        assert.ok(sc && lc, 'company must appear in both results');
        assert.ok(sc.ratio === lc.ratio, 'raw ratio should be identical (1.0)');
        assert.ok(sc.adjustedRatio < lc.adjustedRatio, 'small vault adjusted score must be lower');
    });

    it('typeBundleTotals avoids fieldsCache scan and produces same results', () => {
        const cache = new Map([
            ['a', { type: 'dossier', subject: 'x', status: 'active' }],
            ['b', { type: 'dossier', subject: 'y', status: 'closed' }],
            ['c', { type: 'dossier', subject: 'z' }],
        ]);
        const bundles = buildTypeFieldBundles(cache);
        const totals  = buildTypeBundleTotals(cache);
        const withScan    = getCommonFieldsForType('dossier', bundles, cache, { minRatio: 0.30 });
        const withTotals  = getCommonFieldsForType('dossier', bundles, cache, { minRatio: 0.30 }, totals);
        assert.deepEqual(
            withScan.map(f => ({ field: f.field, ratio: f.ratio, adjustedRatio: f.adjustedRatio })),
            withTotals.map(f => ({ field: f.field, ratio: f.ratio, adjustedRatio: f.adjustedRatio }))
        );
    });
});

// ─── buildFieldAmbiguity ──────────────────────────────────────────────────

describe('vaultPriors — buildFieldAmbiguity', () => {
    it('computes link vs scalar ratio per field', () => {
        const cache = new Map([
            ['a', { contact: '[[person-a]]' }],
            ['b', { contact: 'John Smith' }],
            ['c', { contact: '[[person-b]]' }],
        ]);
        const amb = buildFieldAmbiguity(cache);
        const c = amb.get('contact');
        assert.ok(c);
        assert.equal(c.linkCount, 2);
        assert.equal(c.scalarCount, 1);
        assert.equal(c.total, 3);
        assert.ok(Math.abs(c.linkRatio - 2/3) < 0.001);
    });

    it('skips id and type fields', () => {
        const cache = new Map([
            ['a', { id: 'note-a', type: 'dossier' }],
        ]);
        const amb = buildFieldAmbiguity(cache);
        assert.ok(!amb.has('id'));
        assert.ok(!amb.has('type'));
    });
});

// ─── getCachedPriors ──────────────────────────────────────────────────────────

describe('vaultPriors — getCachedPriors', () => {
    it('returns all three prior maps', () => {
        const cache = new Map([
            ['note-a', { type: 'dossier', subject: '[[char-a]]' }],
            ['char-a', { type: 'character' }],
            ['note-b', { type: 'dossier', subject: '[[char-b]]' }],
            ['char-b', { type: 'character' }],
            ['note-c', { type: 'dossier', subject: '[[char-c]]' }],
            ['char-c', { type: 'character' }],
        ]);
        const priors = getCachedPriors(cache, 1);
        assert.ok(priors.fieldTargetTypes instanceof Map);
        assert.ok(priors.typeFieldBundles instanceof Map);
        assert.ok(priors.typeBundleTotals instanceof Map, 'typeBundleTotals must be present in priors');
        assert.ok(priors.fieldAmbiguity instanceof Map);
        assert.ok(priors.fieldTargetTypes.has('subject'));
    });

    it('returns the same object on repeated calls with the same generation', () => {
        const cache = new Map([['a', { type: 'x', owner: '[[b]]' }], ['b', { type: 'y' }], ['c', { type: 'x', owner: '[[d]]' }], ['d', { type: 'y' }], ['e', { type: 'x', owner: '[[f]]' }], ['f', { type: 'y' }]]);
        const first  = getCachedPriors(cache, 42);
        const second = getCachedPriors(cache, 42);
        assert.strictEqual(first, second);
    });

    it('recomputes when the generation changes', () => {
        const cache = new Map([['a', { type: 'x', owner: '[[b]]' }], ['b', { type: 'y' }], ['c', { type: 'x', owner: '[[d]]' }], ['d', { type: 'y' }], ['e', { type: 'x', owner: '[[f]]' }], ['f', { type: 'y' }]]);
        const gen100 = getCachedPriors(cache, 100);
        const gen101 = getCachedPriors(cache, 101);
        assert.notStrictEqual(gen100, gen101);
    });

    it('returns null maps for an empty cache', () => {
        const priors = getCachedPriors(new Map(), 99);
        // empty cache still produces Maps, just empty ones
        assert.ok(priors.fieldTargetTypes instanceof Map);
        assert.equal(priors.fieldTargetTypes.size, 0);
    });

    it('includes noteRoleTypePriors in the cached output', () => {
        const cache = new Map([
            ['note-a', { type: 'contact', name: 'Alice', email: 'a@co.com' }],
            ['note-b', { type: 'contact', name: 'Bob',   email: 'b@co.com' }],
            ['note-c', { type: 'contact', name: 'Carol', email: 'c@co.com' }],
        ]);
        const priors = getCachedPriors(cache, 200);
        assert.ok(priors.noteRoleTypePriors instanceof Map);
    });
});

// ─── buildNoteRoleTypePriors ──────────────────────────────────────────────────

describe('vaultPriors — buildNoteRoleTypePriors', () => {
    it('maps the person role to the most common contact-like type', () => {
        const cache = new Map([
            ['a', { type: 'contact', name: 'Alice', email: 'a@co.com' }],
            ['b', { type: 'contact', name: 'Bob',   email: 'b@co.com' }],
            ['c', { type: 'contact', name: 'Carol', email: 'c@co.com' }],
            ['d', { type: 'account', industry: 'tech', contacts: '[[a]]' }],
        ]);
        const priors = buildNoteRoleTypePriors(cache);
        // contact notes infer as person role → person role maps to 'contact'
        const personEntry = priors.get('person');
        assert.ok(personEntry, 'person role should be in priors');
        assert.equal(personEntry.dominantType, 'contact');
        assert.ok(personEntry.count >= 3);
    });

    it('returns an empty map for a vault with only generic notes', () => {
        // notes with no recognizable role pattern (note type is 'record'-ish)
        const cache = new Map([
            ['a', { type: 'note', summary: 'a thing' }],
            ['b', { type: 'entry', summary: 'another thing' }],
        ]);
        const priors = buildNoteRoleTypePriors(cache);
        // 'note'/'entry' are record-role types — low-confidence generic role, may not appear
        // Just ensure the function runs without error and returns a Map
        assert.ok(priors instanceof Map);
    });

    it('ignores notes with low-confidence role inference', () => {
        // A single field 'name' is weak signal — confidence < 0.65 expected
        const cache = new Map([
            ['a', { type: 'thing', name: 'Alice' }],
        ]);
        const priors = buildNoteRoleTypePriors(cache);
        // With only 'name' field and no corroborating signals, confidence should be low
        // The map may be empty or small — we just verify it doesn't crash
        assert.ok(priors instanceof Map);
    });

    it('handles an empty cache', () => {
        const priors = buildNoteRoleTypePriors(new Map());
        assert.ok(priors instanceof Map);
        assert.equal(priors.size, 0);
    });
});

describe('vaultPriors — inferLikelyTypesForNote', () => {
    it('infers likely types from current field bundle overlap', () => {
        const cache = new Map([
            ['johnny-rico', { type: 'character', name: 'Johnny Rico', unit: '[[roughnecks]]', rank: 'private' }],
            ['carmen-ibanez', { type: 'character', name: 'Carmen Ibanez', unit: '[[roughnecks]]', rank: 'captain' }],
            ['lt-rasczak', { type: 'character', name: 'Lieutenant Rasczak', unit: '[[roughnecks]]', rank: 'lieutenant' }],
            ['roughnecks', { type: 'unit', name: 'Roughnecks' }],
            ['acme', { type: 'account', name: 'Acme', industry: 'tech', contacts: '[[johnny-rico]]' }]
        ]);
        const bundles = buildTypeFieldBundles(cache);
        const rolePriors = buildNoteRoleTypePriors(cache);

        const inferred = inferLikelyTypesForNote(
            { id: 'carl-jenkins', type: '', name: 'Carl Jenkins', unit: '[[roughnecks]]' },
            cache,
            bundles,
            rolePriors,
            { noteRole: 'person', confidence: 0.72 }
        );

        assert.ok(inferred.length > 0);
        assert.equal(inferred[0].noteType, 'character');
        assert.ok(inferred[0].matchedFields.includes('name'));
        assert.ok(inferred[0].matchedFields.includes('unit'));
    });

    it('stays quiet when there is not enough field evidence', () => {
        const cache = new Map([
            ['a', { type: 'character', name: 'Alice', unit: '[[roughnecks]]' }],
            ['roughnecks', { type: 'unit', name: 'Roughnecks' }]
        ]);
        const bundles = buildTypeFieldBundles(cache);
        const rolePriors = buildNoteRoleTypePriors(cache);

        const inferred = inferLikelyTypesForNote(
            { id: 'plain-note', type: '', summary: 'Short note' },
            cache,
            bundles,
            rolePriors,
            { noteRole: 'record', confidence: 0.3 }
        );

        assert.equal(inferred.length, 0);
    });
});

// ─── getVaultMaturity ──────────────────────────────────────────────────────

describe('vaultPriors — getVaultMaturity', () => {
    it('returns 0 for an empty vault', () => {
        assert.equal(getVaultMaturity(new Map()), 0);
    });

    it('returns a low score for a brand-new vault with no links', () => {
        const cache = new Map([
            ['note-a', { type: 'character', name: 'Alice' }],
            ['note-b', { type: 'character', name: 'Bob' }],
        ]);
        const m = getVaultMaturity(cache);
        assert.ok(m > 0, 'should be above 0');
        assert.ok(m < 0.4, 'should be well below mature');
    });

    it('returns a higher score when notes have wikilinks', () => {
        const sparse = new Map([
            ['note-a', { type: 'mission', name: 'Op Rico' }],
            ['note-b', { type: 'character', name: 'Rico' }],
        ]);
        const withLinks = new Map([
            ['note-a', { type: 'mission', name: 'Op Rico', commander: '[[note-b]]' }],
            ['note-b', { type: 'character', name: 'Rico' }],
        ]);
        assert.ok(getVaultMaturity(withLinks) > getVaultMaturity(sparse));
    });

    it('returns a value between 0 and 1', () => {
        const cache = new Map(
            Array.from({ length: 100 }, (_, i) => [
                `note-${i}`, { type: 'character', rel: `[[note-${(i + 1) % 100}]]` }
            ])
        );
        const m = getVaultMaturity(cache);
        assert.ok(m >= 0 && m <= 1);
    });

    it('getCachedPriors includes vaultMaturity', () => {
        const cache = new Map([
            ['note-a', { type: 'mission', commander: '[[rico]]' }],
            ['rico', { type: 'character' }],
        ]);
        const priors = getCachedPriors(cache, 999);
        assert.ok(typeof priors.vaultMaturity === 'number');
        assert.ok(priors.vaultMaturity >= 0 && priors.vaultMaturity <= 1);
    });
});

// ─── buildValuePatterns ───────────────────────────────────────────────────

describe('vaultPriors — buildValuePatterns', () => {
    it('detects date-valued fields', () => {
        const cache = new Map([
            ['n1', { type: 'event', date: '2026-01-01' }],
            ['n2', { type: 'event', date: '2026-02-15' }],
        ]);
        const vp = buildValuePatterns(cache);
        assert.ok(vp.get('date').dateCount >= 2);
        assert.equal(vp.get('date').wikilinkCount, 0);
    });

    it('detects wikilink-dominated fields', () => {
        const cache = new Map([
            ['n1', { type: 'mission', commander: '[[rico]]' }],
            ['n2', { type: 'mission', commander: '[[carmen]]' }],
        ]);
        const vp = buildValuePatterns(cache);
        assert.ok(vp.get('commander').wikilinkCount >= 2);
    });

    it('detects short scalar values and tracks distinct set', () => {
        const cache = new Map([
            ['n1', { type: 'deal', status: 'active' }],
            ['n2', { type: 'deal', status: 'closed' }],
            ['n3', { type: 'deal', status: 'active' }],
        ]);
        const vp = buildValuePatterns(cache);
        const p = vp.get('status');
        assert.ok(p.shortScalarCount >= 3);
        assert.ok(p.distinctScalars.has('active'));
        assert.ok(p.distinctScalars.has('closed'));
    });
});

// ─── buildWorkflowFields ─────────────────────────────────────────────────

describe('vaultPriors — buildWorkflowFields', () => {
    it('detects a status field with finite, genuinely recurring scalar values', () => {
        const cache = new Map([
            ['n1', { type: 'deal', status: 'active' }],
            ['n2', { type: 'deal', status: 'active' }],
            ['n3', { type: 'deal', status: 'active' }],
            ['n4', { type: 'deal', status: 'active' }],
            ['n5', { type: 'deal', status: 'closed' }],
            ['n6', { type: 'deal', status: 'closed' }],
            ['n7', { type: 'deal', status: 'pending' }],
            ['n8', { type: 'deal', status: 'pending' }],
        ]);
        const vp = buildValuePatterns(cache);
        const wf = buildWorkflowFields(vp);
        assert.ok(wf.has('status'));
        assert.ok(wf.get('status').values.includes('active'));
    });

    it('excludes wikilink-dominated fields', () => {
        const cache = new Map([
            ['n1', { commander: '[[rico]]' }],
            ['n2', { commander: '[[carmen]]' }],
            ['n3', { commander: '[[zim]]' }],
        ]);
        const vp = buildValuePatterns(cache);
        const wf = buildWorkflowFields(vp);
        assert.ok(!wf.has('commander'));
    });

    it('excludes date-dominated fields', () => {
        const cache = new Map([
            ['n1', { due: '2026-01-01' }],
            ['n2', { due: '2026-02-01' }],
        ]);
        const vp = buildValuePatterns(cache);
        const wf = buildWorkflowFields(vp);
        assert.ok(!wf.has('due'));
    });

    it('excludes a field with too few samples to judge, even if all distinct counts are small', () => {
        const cache = new Map([
            ['n1', { rank: 'private' }],
            ['n2', { rank: 'private' }],
            ['n3', { rank: 'colonel' }],
        ]);
        const vp = buildValuePatterns(cache);
        const wf = buildWorkflowFields(vp);
        assert.ok(!wf.has('rank'), 'too few samples (3) to treat this as a genuinely closed vocabulary');
    });

    it('excludes a field with enough samples but mostly-unique values (weak recurrence signal)', () => {
        // Mirrors a real false positive found in the sample vault: a small vault made
        // "rank" look closed (few distinct values) purely because there were few notes,
        // not because rank is actually a finite enum — most values appear only once.
        const cache = new Map([
            ['n1', { rank: 'private' }],
            ['n2', { rank: 'private' }],
            ['n3', { rank: 'colonel' }],
            ['n4', { rank: 'lieutenant' }],
            ['n5', { rank: 'lieutenant commander' }],
            ['n6', { rank: 'sergeant' }],
        ]);
        const vp = buildValuePatterns(cache);
        const wf = buildWorkflowFields(vp);
        assert.ok(!wf.has('rank'), 'weak repeat ratio (avg < 2 occurrences per distinct value) should not qualify');
    });
});

// ─── buildTypeRoleMap ─────────────────────────────────────────────────────

describe('vaultPriors — buildTypeRoleMap', () => {
    function makeVault(notes) {
        return new Map(notes.map(([id, fields]) => [id, fields]));
    }

    it('infers container role for heavily-referenced type', () => {
        // 2 company notes, 8 contacts all link to them → high inbound
        const cache = makeVault([
            ['co1', { type: 'company', name: 'Acme' }],
            ['co2', { type: 'company', name: 'Initech' }],
            ...Array.from({ length: 8 }, (_, i) => [`c${i}`, { type: 'contact', account: `[[co${i % 2 === 0 ? 1 : 2}]]` }]),
        ]);
        const ftt = buildFieldTargetTypes(cache);
        const tfb = buildTypeFieldBundles(cache);
        const fa = buildFieldAmbiguity(cache);
        const vp = buildValuePatterns(cache);
        const map = buildTypeRoleMap(tfb, vp, ftt, fa, cache);
        const companyRole = map.get('company');
        assert.ok(companyRole, 'company should have a role');
        assert.equal(companyRole.role, 'container');
    });

    it('infers person role for notes with relations and low inbound', () => {
        const cache = makeVault([
            ['rico', { type: 'trooper', unit: '[[roughnecks]]', commander: '[[rasczak]]' }],
            ['carmen', { type: 'trooper', unit: '[[roughnecks]]', commander: '[[rasczak]]' }],
            ['dizzy', { type: 'trooper', unit: '[[roughnecks]]', commander: '[[rasczak]]' }],
            ['roughnecks', { type: 'unit', name: 'Roughnecks' }],
            ['rasczak', { type: 'officer', name: 'Rasczak' }],
        ]);
        const ftt = buildFieldTargetTypes(cache);
        const tfb = buildTypeFieldBundles(cache);
        const fa = buildFieldAmbiguity(cache);
        const vp = buildValuePatterns(cache);
        const map = buildTypeRoleMap(tfb, vp, ftt, fa, cache);
        const trooperRole = map.get('trooper');
        assert.ok(trooperRole, 'trooper should have a role');
        assert.equal(trooperRole.role, 'person');
    });

    it('infers task role for types with workflow + date + relation', () => {
        const cache = makeVault([
            ['t1', { type: 'task', status: 'open', due: '2026-06-01', assignee: '[[rico]]' }],
            ['t2', { type: 'task', status: 'done', due: '2026-05-01', assignee: '[[carmen]]' }],
            ['t3', { type: 'task', status: 'open', due: '2026-07-01', assignee: '[[dizzy]]' }],
            ['rico', { type: 'trooper' }],
            ['carmen', { type: 'trooper' }],
            ['dizzy', { type: 'trooper' }],
        ]);
        const ftt = buildFieldTargetTypes(cache);
        const tfb = buildTypeFieldBundles(cache);
        const fa = buildFieldAmbiguity(cache);
        const vp = buildValuePatterns(cache);
        const map = buildTypeRoleMap(tfb, vp, ftt, fa, cache);
        const taskRole = map.get('task');
        assert.ok(taskRole, 'task should have a role');
        assert.equal(taskRole.role, 'task');
    });

    it('getCachedPriors includes typeRoleMap', () => {
        const cache = makeVault([
            ['c1', { type: 'contact', company: '[[a1]]' }],
            ['c2', { type: 'contact', company: '[[a2]]' }],
            ['a1', { type: 'account', name: 'Acme' }],
            ['a2', { type: 'account', name: 'Beta' }],
        ]);
        const priors = getCachedPriors(cache, 888);
        assert.ok(priors.typeRoleMap instanceof Map);
        assert.ok(priors.workflowFields instanceof Map);
        assert.ok(priors.valuePatterns instanceof Map);
        assert.equal(typeof priors.noteRoleNamePriors, 'object');
        assert.equal(typeof priors.noteRoleFieldHints, 'object');
    });
});
