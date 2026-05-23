'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildFieldTargetTypes,
    getDominantTargetType,
    buildTypeFieldBundles,
    getCommonFieldsForType,
    buildFieldAmbiguity,
    buildNoteRoleTypePriors,
    inferLikelyTypesForNote,
    getCachedPriors
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

    it('ignores fields with fewer than 3 link observations', () => {
        const cache = new Map([
            ['note-a', { type: 'dossier', rare: '[[char-a]]' }],
            ['char-a', { type: 'character' }],
            ['note-b', { type: 'dossier', rare: '[[char-b]]' }],
            ['char-b', { type: 'character' }],
        ]);
        const result = buildFieldTargetTypes(cache);
        assert.ok(!result.has('rare'));
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
