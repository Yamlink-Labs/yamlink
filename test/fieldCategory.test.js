'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORY, classifyField, canPerformAction, getActionThreshold } = require('../src/intelligence/fieldCategory');

describe('fieldCategory — classifyField', () => {
    it('classifies identity fields from name pattern', () => {
        assert.equal(classifyField('id').category, CATEGORY.IDENTITY);
        assert.equal(classifyField('uid').category, CATEGORY.IDENTITY);
        assert.equal(classifyField('uuid').category, CATEGORY.IDENTITY);
        assert.equal(classifyField('slug').category, CATEGORY.IDENTITY);
    });

    it('classifies structural fields from name pattern', () => {
        assert.equal(classifyField('type').category, CATEGORY.STRUCTURAL);
        assert.equal(classifyField('kind').category, CATEGORY.STRUCTURAL);
        assert.equal(classifyField('category').category, CATEGORY.STRUCTURAL);
    });

    it('classifies date fields from name pattern', () => {
        assert.equal(classifyField('date').category, CATEGORY.DATE);
        assert.equal(classifyField('due').category, CATEGORY.DATE);
        assert.equal(classifyField('deadline').category, CATEGORY.DATE);
        assert.equal(classifyField('created').category, CATEGORY.DATE);
        assert.equal(classifyField('ship-date').category, CATEGORY.DATE);
    });

    it('classifies workflow fields from name pattern', () => {
        assert.equal(classifyField('status').category, CATEGORY.WORKFLOW);
        assert.equal(classifyField('priority').category, CATEGORY.WORKFLOW);
        assert.equal(classifyField('stage').category, CATEGORY.WORKFLOW);
    });

    it('classifies descriptive fields from name pattern', () => {
        assert.equal(classifyField('name').category, CATEGORY.DESCRIPTIVE);
        assert.equal(classifyField('title').category, CATEGORY.DESCRIPTIVE);
        assert.equal(classifyField('summary').category, CATEGORY.DESCRIPTIVE);
        assert.equal(classifyField('subject').category, CATEGORY.DESCRIPTIVE);
    });

    it('returns UNKNOWN for unrecognized fields with no vault data', () => {
        assert.equal(classifyField('mission').category, CATEGORY.UNKNOWN);
        assert.equal(classifyField('protagonist').category, CATEGORY.UNKNOWN);
    });

    it('schema overrides everything — relation', () => {
        const result = classifyField('subject', { schemaFieldDef: { type: 'relation' } });
        assert.equal(result.category, CATEGORY.RELATION);
        assert.equal(result.confidence, 1.0);
        assert.equal(result.source, 'schema');
    });

    it('schema overrides everything — text overrides unknown field', () => {
        const result = classifyField('mission', { schemaFieldDef: { type: 'text' } });
        assert.equal(result.category, CATEGORY.DESCRIPTIVE);
        assert.equal(result.source, 'schema');
    });

    it('schema overrides name pattern — id field explicitly typed as relation', () => {
        const result = classifyField('id', { schemaFieldDef: { type: 'relation' } });
        assert.equal(result.category, CATEGORY.RELATION);
        assert.equal(result.source, 'schema');
    });

    it('observed usage 70%+ wikilinks classifies as RELATION', () => {
        const fieldsCache = new Map([
            ['a', { mission: '[[alpha]]' }],
            ['b', { mission: '[[beta]]' }],
            ['c', { mission: '[[gamma]]' }],
            ['d', { mission: '[[delta]]' }],
        ]);
        const result = classifyField('mission', { fieldsCache });
        assert.equal(result.category, CATEGORY.RELATION);
        assert.equal(result.source, 'usage');
        assert.ok(result.confidence > 0.6);
    });

    it('observed usage below 35% does not classify as RELATION', () => {
        const fieldsCache = new Map([
            ['a', { mission: 'alpha' }],
            ['b', { mission: 'beta' }],
            ['c', { mission: 'gamma' }],
            ['d', { mission: '[[delta]]' }],
        ]);
        const result = classifyField('mission', { fieldsCache });
        // 1/4 = 25% — below threshold → UNKNOWN (not enough signal for relation)
        assert.notEqual(result.category, CATEGORY.RELATION);
    });

    it('observed usage < 3 observations returns no signal from usage', () => {
        const fieldsCache = new Map([
            ['a', { rare: '[[x]]' }],
            ['b', { rare: '[[y]]' }],
        ]);
        // Only 2 observations → usage returns null → falls through to UNKNOWN
        const result = classifyField('rare', { fieldsCache });
        assert.equal(result.category, CATEGORY.UNKNOWN);
    });

    it('schema takes priority over observed usage', () => {
        const fieldsCache = new Map([
            ['a', { contact: '[[person-a]]' }],
            ['b', { contact: '[[person-b]]' }],
            ['c', { contact: '[[person-c]]' }],
            ['d', { contact: '[[person-d]]' }],
        ]);
        // Even though usage is 100% wikilinks, schema says text
        const result = classifyField('contact', {
            schemaFieldDef: { type: 'text' },
            fieldsCache
        });
        assert.equal(result.category, CATEGORY.DESCRIPTIVE);
        assert.equal(result.source, 'schema');
    });

    it('vault priors can promote an ambiguous descriptive field into RELATION', () => {
        const fieldsCache = new Map();
        for (let i = 0; i < 10; i++) {
            fieldsCache.set(`dossier-${i}`, { type: 'dossier', subject: `[[char-${i}]]`, status: 'drafting' });
            fieldsCache.set(`char-${i}`, { type: 'character', name: `Character ${i}` });
        }
        const result = classifyField('subject', {
            noteType: 'dossier',
            fieldsCache,
            fieldTargetTypes: new Map([
                ['subject', new Map([['character', 8], ['location', 2]])]
            ]),
            typeFieldBundles: new Map([
                ['dossier', new Map([['subject', 10], ['status', 10], ['date', 4]])]
            ]),
            fieldAmbiguity: new Map([
                ['subject', { linkCount: 8, scalarCount: 2, total: 10, linkRatio: 0.8 }]
            ])
        });
        assert.equal(result.category, CATEGORY.RELATION);
        assert.equal(result.source, 'usage');
        assert.ok(result.confidence >= 0.65);
        assert.ok(result.reasons.some((reason) => reason.includes('usually links to character notes')));
        assert.ok(result.reasons.some((reason) => reason.includes('commonly appears on dossier notes')));
    });

    it('20-34% wikilink ratio returns UNKNOWN, not DESCRIPTIVE — vault evidence wins over name pattern', () => {
        // subject matches RE_DESCRIPTIVE, but vault shows 25% wikilinks → ambiguous → UNKNOWN
        const fieldsCache = new Map([
            ['a', { subject: '[[char-a]]' }],
            ['b', { subject: 'plain text' }],
            ['c', { subject: 'more text' }],
            ['d', { subject: 'even more' }],
        ]);
        const result = classifyField('subject', { fieldsCache });
        assert.equal(result.category, CATEGORY.UNKNOWN);
        assert.equal(result.source, 'usage');
        assert.ok(result.reasons[0].includes('ambiguous'));
    });

    it('20-34% wikilink ratio + strong same-note context → context breaks the tie to RELATION', () => {
        // vault says 25% wikilinks (ambiguous), but this note is full of wikilinks → context wins
        const fieldsCache = new Map([
            ['a', { subject: '[[char-a]]' }],
            ['b', { subject: 'plain text' }],
            ['c', { subject: 'more text' }],
            ['d', { subject: 'even more' }],
        ]);
        const result = classifyField('subject', {
            fieldsCache,
            noteFields: {
                subject:  '',
                mission:  '[[mission-1]]',
                location: '[[city-x]]',
                handler:  '[[person-y]]'
            },
            fieldTargetTypes: new Map([
                ['mission', new Map([['mission', 6]])],
                ['location', new Map([['location', 5]])],
                ['handler', new Map([['character', 4]])]
            ])
        });
        assert.equal(result.category, CATEGORY.RELATION);
        assert.equal(result.source, 'context');
        assert.ok(result.reasons.some((r) => r.includes('ambiguous')));
    });

    it('< 20% wikilink ratio with descriptive name confirms DESCRIPTIVE', () => {
        // 1 link out of 10 — vault confirms scalar usage
        const fieldsCache = new Map([
            ['a', { subject: '[[char-a]]' }],
            ...Array.from({ length: 9 }, (_, i) => [`n-${i}`, { subject: 'scalar' }])
        ]);
        const result = classifyField('subject', { fieldsCache });
        assert.equal(result.category, CATEGORY.DESCRIPTIVE);
    });

    it('same-note context signal promotes UNKNOWN field to RELATION when note is mostly wikilinks', () => {
        // protagonist has no vault data, but this note has 3 other relation fields filled
        const result = classifyField('protagonist', {
            noteFields: {
                protagonist: '',
                subject:    '[[char-a]]',
                mission:    '[[mission-1]]',
                location:   '[[city-x]]'
            },
            fieldTargetTypes: new Map([
                ['subject', new Map([['character', 8]])],
                ['mission', new Map([['mission', 6]])],
                ['location', new Map([['location', 5]])]
            ])
        });
        assert.equal(result.category, CATEGORY.RELATION);
        assert.equal(result.source, 'context');
        assert.ok(result.confidence > 0.30);
        assert.ok(result.reasons[0].includes('nearby/co-occurring fields'));
    });

    it('same-note context signal does not fire when fewer than half other fields are wikilinks', () => {
        const result = classifyField('protagonist', {
            noteFields: {
                protagonist: '',
                subject:    '[[char-a]]',
                title:      'A Great Story',
                summary:    'A long description',
                notes:      'Some text here'
            }
        });
        // 1/4 other eligible fields are wikilinks — below 50% threshold
        assert.equal(result.category, CATEGORY.UNKNOWN);
    });

    it('same-note context ignores structural fields when computing ratio', () => {
        // status/date/type don't count — only the wikilink field does
        const result = classifyField('protagonist', {
            noteFields: {
                protagonist: '',
                type:   'dossier',
                status: 'active',
                date:   '2026-01-01',
                subject: '[[char-a]]'
            }
        });
        // Only 1 eligible field (subject) — insufficient context (< 2 required)
        assert.equal(result.category, CATEGORY.UNKNOWN);
    });

    it('scalar-heavy ambiguity keeps vault priors quieter', () => {
        const fieldsCache = new Map();
        for (let i = 0; i < 8; i++) {
            fieldsCache.set(`record-${i}`, { type: 'record', owner: i < 3 ? `[[person-${i}]]` : `Owner ${i}` });
            fieldsCache.set(`person-${i}`, { type: 'character', name: `Person ${i}` });
        }
        const withoutAmbiguityPenalty = classifyField('owner', {
            noteType: 'record',
            fieldsCache,
            fieldTargetTypes: new Map([
                ['owner', new Map([['character', 6], ['org', 2]])]
            ]),
            typeFieldBundles: new Map([
                ['record', new Map([['owner', 8]])]
            ]),
            fieldAmbiguity: new Map([
                ['owner', { linkCount: 8, scalarCount: 0, total: 8, linkRatio: 1.0 }]
            ])
        });
        const withAmbiguityPenalty = classifyField('owner', {
            noteType: 'record',
            fieldsCache,
            fieldTargetTypes: new Map([
                ['owner', new Map([['character', 6], ['org', 2]])]
            ]),
            typeFieldBundles: new Map([
                ['record', new Map([['owner', 8]])]
            ]),
            fieldAmbiguity: new Map([
                ['owner', { linkCount: 3, scalarCount: 5, total: 8, linkRatio: 0.375 }]
            ])
        });
        assert.equal(withoutAmbiguityPenalty.category, CATEGORY.RELATION);
        assert.equal(withAmbiguityPenalty.category, CATEGORY.RELATION);
        assert.ok(withAmbiguityPenalty.confidence < withoutAmbiguityPenalty.confidence);
        assert.ok(withAmbiguityPenalty.reasons.some((reason) => reason.includes('mixed between links and scalar values')));
    });

    it('small target samples reduce relation confidence even when the dominant type looks strong', () => {
        const fieldsCache = new Map();
        for (let i = 0; i < 4; i++) {
            fieldsCache.set(`record-${i}`, { type: 'record', owner: `[[person-${i}]]` });
            fieldsCache.set(`person-${i}`, { type: 'character', name: `Person ${i}` });
        }
        const result = classifyField('owner', {
            noteType: 'record',
            fieldsCache,
            fieldTargetTypes: new Map([
                ['owner', new Map([['character', 4]])]
            ]),
            fieldAmbiguity: new Map([
                ['owner', { linkCount: 4, scalarCount: 0, total: 4, linkRatio: 1.0 }]
            ])
        });
        assert.equal(result.category, CATEGORY.RELATION);
        assert.ok(result.confidence < 0.75);
        assert.ok(result.reasons.some((reason) => reason.includes('small sample')));
        assert.equal(result.sampleSize, 4);
    });

    it('body evidence boosts confidence when body wikilinks match the dominant target type', () => {
        const fieldsCache = new Map([
            ['dossier-a', { type: 'dossier', subject: '[[char-a]]' }],
            ['dossier-b', { type: 'dossier', subject: '[[char-b]]' }],
            ['dossier-c', { type: 'dossier', subject: '[[char-c]]' }],
            ['dossier-d', { type: 'dossier', subject: '[[char-d]]' }],
            ['dossier-e', { type: 'dossier', subject: '[[char-e]]' }],
            ['char-a', { type: 'character' }],
            ['char-b', { type: 'character' }],
            ['char-c', { type: 'character' }],
            ['char-d', { type: 'character' }],
            ['char-e', { type: 'character' }],
        ]);
        const fieldTargetTypes = new Map([['subject', new Map([['character', 8]])]]);
        const fieldAmbiguity  = new Map([['subject', { linkCount: 8, scalarCount: 0, total: 8, linkRatio: 1.0 }]]);

        // body mentions two character IDs — corroborating evidence
        const bodyWikilinkCounts = new Map([['char-a', 3], ['char-b', 1]]);

        const withBody    = classifyField('subject', { fieldsCache, fieldTargetTypes, fieldAmbiguity, bodyWikilinkCounts });
        const withoutBody = classifyField('subject', { fieldsCache, fieldTargetTypes, fieldAmbiguity });

        assert.equal(withBody.category, CATEGORY.RELATION);
        assert.equal(withoutBody.category, CATEGORY.RELATION);
        assert.ok(withBody.confidence > withoutBody.confidence, 'body evidence should raise confidence');
        assert.ok(withBody.reasons.some((r) => r.includes('body mentions')));
    });

    it('body evidence does not boost when body wikilinks are a different type than the dominant target', () => {
        const fieldsCache = new Map([
            ['dossier-a', { type: 'dossier', subject: '[[char-a]]' }],
            ['dossier-b', { type: 'dossier', subject: '[[char-b]]' }],
            ['dossier-c', { type: 'dossier', subject: '[[char-c]]' }],
            ['char-a', { type: 'character' }],
            ['char-b', { type: 'character' }],
            ['char-c', { type: 'character' }],
            ['loc-x',  { type: 'location' }],
        ]);
        const fieldTargetTypes = new Map([['subject', new Map([['character', 6]])]]);
        const fieldAmbiguity  = new Map([['subject', { linkCount: 6, scalarCount: 0, total: 6, linkRatio: 1.0 }]]);

        // body only mentions a location — doesn't match 'character' dominant target
        const bodyWikilinkCounts = new Map([['loc-x', 4]]);

        const withBody    = classifyField('subject', { fieldsCache, fieldTargetTypes, fieldAmbiguity, bodyWikilinkCounts });
        const withoutBody = classifyField('subject', { fieldsCache, fieldTargetTypes, fieldAmbiguity });

        assert.equal(withBody.category, CATEGORY.RELATION);
        assert.ok(Math.abs(withBody.confidence - withoutBody.confidence) < 0.01, 'mismatched body type should not boost confidence');
        assert.ok(!withBody.reasons.some((r) => r.includes('body mentions')));
    });

    it('note role enables bundle bonus when noteType is absent', () => {
        // vault: 8 contact notes with a company field, 8 company notes
        const fieldsCache = new Map();
        for (let i = 0; i < 8; i++) {
            fieldsCache.set(`contact-${i}`, { type: 'contact', name: `Person ${i}`, email: `p${i}@co.com` });
            fieldsCache.set(`company-${i}`, { type: 'company', name: `Company ${i}` });
        }
        const fieldTargetTypes = new Map([['company', new Map([['company', 6]])]]);
        const typeFieldBundles = new Map([['contact', new Map([['company', 8], ['name', 8], ['email', 8]])]]);
        const noteRoleTypePriors = new Map([['person', { dominantType: 'contact', count: 8 }]]);

        // Note being classified has no type: field — noteRole inference gives us 'person'
        const withRole = classifyField('company', {
            fieldsCache,
            fieldTargetTypes,
            typeFieldBundles,
            noteRoleTypePriors,
            noteRole: { noteRole: 'person', confidence: 0.85 }
            // noteType intentionally absent
        });
        const withNoteType = classifyField('company', {
            fieldsCache,
            fieldTargetTypes,
            typeFieldBundles,
            noteType: 'contact'
        });

        assert.equal(withRole.category, CATEGORY.RELATION);
        assert.ok(withRole.reasons.some((r) => r.includes('inferred role')));
        // confidence should be close to the explicit-noteType path
        assert.ok(Math.abs(withRole.confidence - withNoteType.confidence) <= 0.10);
    });

    it('note role does not fire when confidence is below 0.70', () => {
        const fieldsCache = new Map([
            ['contact-0', { type: 'contact', name: 'Alice', email: 'a@co.com' }],
            ['company-0', { type: 'company', name: 'Acme' }],
        ]);
        const fieldTargetTypes = new Map([['company', new Map([['company', 3]])]]);
        const typeFieldBundles = new Map([['contact', new Map([['company', 3], ['name', 3]])]]);
        const noteRoleTypePriors = new Map([['person', { dominantType: 'contact', count: 3 }]]);

        const lowConfidenceRole = classifyField('company', {
            fieldsCache,
            fieldTargetTypes,
            typeFieldBundles,
            noteRoleTypePriors,
            noteRole: { noteRole: 'person', confidence: 0.55 }  // below 0.70 threshold
        });
        // Should NOT see the role-based bundle bonus
        assert.ok(!lowConfidenceRole.reasons.some((r) => r.includes('inferred role')));
    });

    it('mixed target types reduce relation confidence even when one target type dominates', () => {
        const fieldsCache = new Map();
        for (let i = 0; i < 10; i++) {
            fieldsCache.set(`record-${i}`, { type: 'record', owner: `[[target-${i}]]` });
            fieldsCache.set(`target-${i}`, { type: i < 6 ? 'character' : 'location', name: `Target ${i}` });
        }
        const result = classifyField('owner', {
            noteType: 'record',
            fieldsCache,
            fieldTargetTypes: new Map([
                ['owner', new Map([['character', 6], ['location', 4]])]
            ]),
            fieldAmbiguity: new Map([
                ['owner', { linkCount: 10, scalarCount: 0, total: 10, linkRatio: 1.0 }]
            ])
        });
        assert.equal(result.category, CATEGORY.RELATION);
        assert.ok(result.confidence < 0.70);
        assert.ok(result.reasons.some((reason) => reason.includes('splits across 2 target types')));
        assert.equal(result.targetDiversity, 2);
    });
});

describe('fieldCategory — canPerformAction', () => {
    it('IDENTITY blocks all actions', () => {
        assert.equal(canPerformAction(CATEGORY.IDENTITY, 'relationCompletion'), false);
        assert.equal(canPerformAction(CATEGORY.IDENTITY, 'fieldSetup'), false);
        assert.equal(canPerformAction(CATEGORY.IDENTITY, 'documentSetup'), false);
        assert.equal(canPerformAction(CATEGORY.IDENTITY, 'createNote'), false);
    });

    it('STRUCTURAL blocks all actions', () => {
        assert.equal(canPerformAction(CATEGORY.STRUCTURAL, 'relationCompletion'), false);
        assert.equal(canPerformAction(CATEGORY.STRUCTURAL, 'documentSetup'), false);
    });

    it('RELATION allows all actions', () => {
        assert.equal(canPerformAction(CATEGORY.RELATION, 'relationCompletion'), true);
        assert.equal(canPerformAction(CATEGORY.RELATION, 'fieldSetup'), true);
        assert.equal(canPerformAction(CATEGORY.RELATION, 'documentSetup'), true);
        assert.equal(canPerformAction(CATEGORY.RELATION, 'createNote'), true);
    });

    it('DESCRIPTIVE allows only document-level setup', () => {
        assert.equal(canPerformAction(CATEGORY.DESCRIPTIVE, 'relationCompletion'), false);
        assert.equal(canPerformAction(CATEGORY.DESCRIPTIVE, 'fieldSetup'), false);
        assert.equal(canPerformAction(CATEGORY.DESCRIPTIVE, 'documentSetup'), true);
        assert.equal(canPerformAction(CATEGORY.DESCRIPTIVE, 'createNote'), false);
    });

    it('UNKNOWN allows only document-level setup', () => {
        assert.equal(canPerformAction(CATEGORY.UNKNOWN, 'relationCompletion'), false);
        assert.equal(canPerformAction(CATEGORY.UNKNOWN, 'documentSetup'), true);
    });
});

describe('fieldCategory — getActionThreshold', () => {
    it('relation completion has lower threshold than document setup', () => {
        assert.ok(getActionThreshold('relationCompletion') < getActionThreshold('documentSetup'));
    });

    it('returns default for unknown action type', () => {
        assert.equal(typeof getActionThreshold('nonexistent'), 'number');
    });
});
