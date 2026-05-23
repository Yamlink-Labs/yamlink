'use strict';
/**
 * frontmatterIntelligence.test.js
 *
 * Unit tests for the frontmatter intelligence cluster — all pure modules,
 * no VS Code imports, no vault simulation needed.
 *
 * Covers:
 *   frontmatterFieldFamilies  — detectFieldFamily, naturalList, pick*, summarizePattern,
 *                               collectCurrentFieldFamilies, getFieldRoleResult
 *   frontmatterBodyHints      — extractBodyMentionedIds, buildBodyMentionHints
 *   frontmatterGapLearning    — buildSchemaAdaptiveGaps, buildRecommendedBundles
 *   frontmatterRelationLearning — buildFieldFamilyRelationModel
 *   frontmatterIntelligence   — buildFrontmatterOpportunityModel,
 *                               buildFrontmatterGuidanceSummary,
 *                               summarizeGuidanceExplanation
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Load modules ──────────────────────────────────────────────────────────────

const {
    SEMANTIC_FIELD_FAMILIES,
    summarizePattern,
    naturalList,
    pickPreferredSourceType,
    pickConnectionField,
    detectFieldFamily,
    collectCurrentFieldFamilies,
    getFieldRoleResult
} = require('../src/intelligence/frontmatterFieldFamilies');

const {
    extractBodyMentionedIds,
    buildBodyMentionHints
} = require('../src/intelligence/frontmatterBodyHints');

const {
    buildSchemaAdaptiveGaps,
    buildRecommendedBundles
} = require('../src/intelligence/frontmatterGapLearning');

const {
    buildFieldFamilyRelationModel
} = require('../src/intelligence/frontmatterRelationLearning');

const {
    buildFrontmatterOpportunityModel,
    buildFrontmatterGuidanceSummary,
    summarizeGuidanceExplanation
} = require('../src/intelligence/frontmatterIntelligence');

const { resetObservedNoteIndexCache } = require('../src/intelligence/suggestionCore');
const { resetVaultPriorsCache } = require('../src/intelligence/vaultPriors');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCache(entries) {
    return new Map(entries.map(([id, fields]) => [id, fields]));
}

const CRM_CACHE = makeCache([
    ['rico',   { type: 'contact', name: 'Rico',   email: 'rico@mi.gov',       account: '[[mi]]' }],
    ['dizzy',  { type: 'contact', name: 'Dizzy',  email: 'dizzy@mi.gov',      account: '[[mi]]' }],
    ['carmen', { type: 'contact', name: 'Carmen', email: 'carmen@navajo.gov', account: '[[navajo]]' }],
    ['mi',     { type: 'account', name: 'Mobile Infantry' }],
    ['navajo', { type: 'account', name: 'FCV Navajo' }],
]);

// ── SEMANTIC_FIELD_FAMILIES export ────────────────────────────────────────────

describe('frontmatterFieldFamilies — SEMANTIC_FIELD_FAMILIES', () => {
    test('exports an object with known family keys', () => {
        const keys = Object.keys(SEMANTIC_FIELD_FAMILIES);
        assert.ok(keys.includes('title'));
        assert.ok(keys.includes('container'));
        assert.ok(keys.includes('person'));
        assert.ok(keys.includes('date'));
        assert.ok(keys.includes('status'));
    });

    test('each family has fields array and summary string', () => {
        for (const [key, config] of Object.entries(SEMANTIC_FIELD_FAMILIES)) {
            assert.ok(Array.isArray(config.fields), `${key}.fields must be array`);
            assert.ok(config.fields.length > 0, `${key}.fields must be non-empty`);
            assert.ok(typeof config.summary === 'string', `${key}.summary must be string`);
        }
    });
});

// ── detectFieldFamily ─────────────────────────────────────────────────────────

describe('frontmatterFieldFamilies — detectFieldFamily', () => {
    test('canonical title fields map to title family', () => {
        assert.equal(detectFieldFamily('name'),    'title');
        assert.equal(detectFieldFamily('title'),   'title');
        assert.equal(detectFieldFamily('subject'), 'title');
    });

    test('container fields map to container family', () => {
        assert.equal(detectFieldFamily('account'), 'container');
        assert.equal(detectFieldFamily('company'), 'container');
        assert.equal(detectFieldFamily('project'), 'container');
    });

    test('person fields map to person family', () => {
        assert.equal(detectFieldFamily('owner'),    'person');
        assert.equal(detectFieldFamily('assignee'), 'person');
        assert.equal(detectFieldFamily('manager'),  'person');
    });

    test('date fields map to date family', () => {
        assert.equal(detectFieldFamily('date'),     'date');
        assert.equal(detectFieldFamily('deadline'), 'date');
        assert.equal(detectFieldFamily('due'),      'date');
    });

    test('status fields map to status family', () => {
        assert.equal(detectFieldFamily('status'), 'status');
        assert.equal(detectFieldFamily('stage'),  'status');
        assert.equal(detectFieldFamily('phase'),  'status');
    });

    test('priority fields map to priority family', () => {
        assert.equal(detectFieldFamily('priority'), 'priority');
        assert.equal(detectFieldFamily('severity'), 'priority');
    });

    test('location fields map to location family', () => {
        assert.equal(detectFieldFamily('location'), 'location');
        assert.equal(detectFieldFamily('place'),    'location');
    });

    test('hyphenated/compound fields still match', () => {
        assert.equal(detectFieldFamily('ship-date'),  'date');
        assert.equal(detectFieldFamily('follow-up'),  'date');
    });

    test('unknown field name returns null', () => {
        assert.equal(detectFieldFamily('foobar'),       null);
        assert.equal(detectFieldFamily(''),             null);
        assert.equal(detectFieldFamily(null),           null);
        assert.equal(detectFieldFamily('random-xyz'),   null);
    });

    test('semantic role fallback activates when no name match', () => {
        assert.equal(detectFieldFamily('my_custom_tracker', 'date'),      'date');
        assert.equal(detectFieldFamily('workflow_stage',    'status'),    'status');
        assert.equal(detectFieldFamily('responsible_party', 'person'),   'person');
        assert.equal(detectFieldFamily('parent_entity',     'container'),'container');
    });
});

// ── naturalList ───────────────────────────────────────────────────────────────

describe('frontmatterFieldFamilies — naturalList', () => {
    test('empty input returns empty string', () => {
        assert.equal(naturalList([]),          '');
        assert.equal(naturalList([null, '']),  '');
    });

    test('single item returns the item', () => {
        assert.equal(naturalList(['alpha']), 'alpha');
    });

    test('two items returns "a and b"', () => {
        assert.equal(naturalList(['a', 'b']), 'a and b');
    });

    test('three items returns "a, b, and c"', () => {
        assert.equal(naturalList(['a', 'b', 'c']), 'a, b, and c');
    });

    test('four items uses Oxford comma style', () => {
        const result = naturalList(['a', 'b', 'c', 'd']);
        assert.ok(result.includes(', and d'), `got: ${result}`);
    });
});

// ── pickPreferredSourceType ───────────────────────────────────────────────────

describe('frontmatterFieldFamilies — pickPreferredSourceType', () => {
    test('returns first non-note type', () => {
        assert.equal(pickPreferredSourceType(['note', 'contact', 'account']), 'contact');
    });

    test('returns note when that is all there is', () => {
        assert.equal(pickPreferredSourceType(['note']), 'note');
    });

    test('returns the specific type directly when note absent', () => {
        assert.equal(pickPreferredSourceType(['account', 'contact']), 'account');
    });

    test('returns empty string for empty list', () => {
        assert.equal(pickPreferredSourceType([]), '');
    });
});

// ── pickConnectionField ───────────────────────────────────────────────────────

describe('frontmatterFieldFamilies — pickConnectionField', () => {
    test('returns "related" when no special field exists', () => {
        assert.equal(pickConnectionField({ name: 'Rico', status: 'active' }), 'related');
    });

    test('returns "related" when that field is present', () => {
        assert.equal(pickConnectionField({ related: '[[mi]]' }), 'related');
    });

    test('returns "links" when present', () => {
        assert.equal(pickConnectionField({ links: '[[mi]]' }), 'links');
    });

    test('returns "see-also" when present', () => {
        assert.equal(pickConnectionField({ 'see-also': '[[x]]' }), 'see-also');
    });

    test('returns "connections" when present', () => {
        assert.equal(pickConnectionField({ connections: '[[x]]' }), 'connections');
    });

    test('returns "related" for empty fields', () => {
        assert.equal(pickConnectionField({}), 'related');
    });
});

// ── summarizePattern ──────────────────────────────────────────────────────────

describe('frontmatterFieldFamilies — summarizePattern', () => {
    test('non-relational pattern generates plain summary', () => {
        const summary = summarizePattern({
            field: 'status', sharedFields: [], sampleTargets: [], relational: false
        });
        assert.match(summary, /notes like this often add status/);
    });

    test('relational pattern with targets mentions linking', () => {
        const summary = summarizePattern({
            field: 'account', sharedFields: [], sampleTargets: ['mi'], relational: true
        });
        assert.match(summary, /account/);
        assert.match(summary, /mi/);
    });

    test('shared fields appear in summary', () => {
        const summary = summarizePattern({
            field: 'account', sharedFields: ['name', 'email'], sampleTargets: [], relational: false
        });
        assert.match(summary, /name/);
    });
});

// ── collectCurrentFieldFamilies ───────────────────────────────────────────────

describe('frontmatterFieldFamilies — collectCurrentFieldFamilies', () => {
    test('identifies families present in node fields', () => {
        const families = collectCurrentFieldFamilies({
            name: 'Rico', status: 'active', account: '[[mi]]', date: '2026-01-01'
        });
        assert.ok(families.has('title'));
        assert.ok(families.has('status'));
        assert.ok(families.has('container'));
        assert.ok(families.has('date'));
    });

    test('empty fields returns empty set', () => {
        assert.equal(collectCurrentFieldFamilies({}).size, 0);
    });

    test('empty-string field values are excluded (not counted as filled)', () => {
        const families = collectCurrentFieldFamilies({ name: '' });
        assert.equal(families.size, 0);
    });

    test('unknown field names do not add families', () => {
        const families = collectCurrentFieldFamilies({ foobar: 'value', xyz: '123' });
        assert.equal(families.size, 0);
    });
});

// ── getFieldRoleResult ────────────────────────────────────────────────────────

describe('frontmatterFieldFamilies — getFieldRoleResult', () => {
    const context = {
        fieldRoleResults: [
            { fieldName: 'status',  semanticRole: 'status',    relational: false },
            { fieldName: 'account', semanticRole: 'container', relational: true  }
        ]
    };

    test('finds result by exact field name', () => {
        const result = getFieldRoleResult(context, 'status');
        assert.equal(result.semanticRole, 'status');
    });

    test('lookup is case-insensitive', () => {
        const result = getFieldRoleResult(context, 'ACCOUNT');
        assert.equal(result.semanticRole, 'container');
    });

    test('returns null for unknown field', () => {
        assert.equal(getFieldRoleResult(context, 'email'), null);
    });

    test('returns null for empty context', () => {
        assert.equal(getFieldRoleResult({}, 'name'), null);
    });
});

// ── extractBodyMentionedIds ───────────────────────────────────────────────────

describe('frontmatterBodyHints — extractBodyMentionedIds', () => {
    test('returns empty map for empty content', () => {
        assert.equal(extractBodyMentionedIds('').size,   0);
        assert.equal(extractBodyMentionedIds(null).size, 0);
    });

    test('counts wikilinks in body text', () => {
        const content = '---\nid: note\ntype: contact\n---\n\nSee [[rico]] and [[rico]] again. Also [[dizzy]].\n';
        const counts = extractBodyMentionedIds(content);
        assert.equal(counts.get('rico'),  2);
        assert.equal(counts.get('dizzy'), 1);
    });

    test('strips frontmatter block before counting', () => {
        const content = '---\nid: [[should-not-count]]\n---\n\n[[body-mention]]\n';
        const counts = extractBodyMentionedIds(content);
        assert.ok(!counts.has('should-not-count'));
        assert.ok(counts.has('body-mention'));
    });

    test('ignores wikilinks inside fenced code blocks', () => {
        const content = '---\nid: note\n---\n\n```\n[[inside-code]]\n```\n\n[[outside]]\n';
        const counts = extractBodyMentionedIds(content);
        assert.ok(!counts.has('inside-code'));
        assert.ok(counts.has('outside'));
    });

    test('handles piped wikilinks [[id|display label]]', () => {
        const content = '---\nid: note\n---\n\n[[rico|Johnny Rico]] appeared.\n';
        const counts = extractBodyMentionedIds(content);
        assert.ok(counts.has('rico'));
        assert.ok(!counts.has('johnny rico'));
    });

    test('ids are stored lowercase', () => {
        const content = '---\nid: note\n---\n\n[[RICO]] shows up.\n';
        const counts = extractBodyMentionedIds(content);
        assert.ok(counts.has('rico'));
    });
});

// ── buildBodyMentionHints ─────────────────────────────────────────────────────

describe('frontmatterBodyHints — buildBodyMentionHints', () => {
    const body2 = '---\nid: note\ntype: contact\n---\n\n[[mi]] here. [[mi]] again.\n';
    const body1 = '---\nid: note\ntype: contact\n---\n\nSee [[mi]] once.\n';

    test('returns empty array when no mention meets threshold', () => {
        const hints = buildBodyMentionHints(body1, {}, new Map([['mi', {}]]), { threshold: 2 });
        assert.equal(hints.length, 0);
    });

    test('returns hint when count meets threshold', () => {
        const hints = buildBodyMentionHints(body2, {}, new Map([['mi', {}]]), { threshold: 2 });
        assert.equal(hints.length, 1);
        assert.equal(hints[0].id, 'mi');
        assert.equal(hints[0].count, 2);
    });

    test('excludes ids already linked in frontmatter wikilinks', () => {
        const hints = buildBodyMentionHints(body2, { account: '[[mi]]' }, new Map([['mi', {}]]), { threshold: 2 });
        assert.equal(hints.length, 0);
    });

    test('excludes ids not found in the fieldsCache when cache is non-empty', () => {
        const hints = buildBodyMentionHints(body2, {}, new Map([['someone-else', {}]]), { threshold: 2 });
        assert.equal(hints.length, 0);
    });

    test('sorts hints by count descending', () => {
        const content = '---\nid: note\n---\n\n[[a]] x. [[a]] x. [[a]] x. [[b]] y. [[b]] y.\n';
        const cache = new Map([['a', {}], ['b', {}]]);
        const hints = buildBodyMentionHints(content, {}, cache, { threshold: 2 });
        assert.ok(hints.length >= 2);
        assert.equal(hints[0].id, 'a');
    });

    test('hint includes insertText containing the id', () => {
        const hints = buildBodyMentionHints(body2, {}, new Map([['mi', {}]]), { threshold: 2 });
        assert.ok(hints[0].insertText.includes('mi'));
    });

    test('hint includes a field name for the link', () => {
        const hints = buildBodyMentionHints(body2, {}, new Map([['mi', {}]]), { threshold: 2 });
        assert.ok(typeof hints[0].field === 'string' && hints[0].field.length > 0);
    });
});

// ── buildRecommendedBundles ───────────────────────────────────────────────────

describe('frontmatterGapLearning — buildRecommendedBundles', () => {
    test('returns bundle object with fields array and insertText', () => {
        const bundle = buildRecommendedBundles([], []);
        assert.ok(Array.isArray(bundle.fields));
        assert.ok(typeof bundle.insertText === 'string');
    });

    test('deduplicates fields shared between likelyFields and likelyGaps', () => {
        const likelyFields = [{ field: 'email', insertText: 'email: \n' }];
        const likelyGaps   = [{ field: 'email', insertText: 'email: \n' }, { field: 'status', insertText: 'status: \n' }];
        const bundle = buildRecommendedBundles(likelyFields, likelyGaps);
        const names = bundle.fields.map(h => h.field);
        assert.equal(new Set(names).size, names.length, 'fields must be unique');
    });

    test('insertText concatenates hint insertTexts', () => {
        const hints = [
            { field: 'name',  insertText: 'name: \n'  },
            { field: 'email', insertText: 'email: \n' }
        ];
        const bundle = buildRecommendedBundles(hints, []);
        assert.ok(bundle.insertText.includes('name: \n'));
        assert.ok(bundle.insertText.includes('email: \n'));
    });

    test('respects bundleLimit option', () => {
        const hints = Array.from({ length: 6 }, (_, i) => ({
            field: `field${i}`, insertText: `field${i}: \n`
        }));
        const bundle = buildRecommendedBundles(hints, [], { bundleLimit: 2 });
        assert.equal(bundle.fields.length, 2);
    });

    test('prefers relationInsertText when present', () => {
        const hints = [{ field: 'account', insertText: 'account: [[\n', relationInsertText: 'account: [[mi]]\n' }];
        const bundle = buildRecommendedBundles(hints, []);
        assert.ok(bundle.insertText.includes('[[mi]]'));
    });
});

// ── buildSchemaAdaptiveGaps ───────────────────────────────────────────────────

describe('frontmatterGapLearning — buildSchemaAdaptiveGaps', () => {
    test('returns empty array for empty cache', () => {
        const gaps = buildSchemaAdaptiveGaps({ type: 'contact' }, {}, new Map(), {});
        assert.ok(Array.isArray(gaps));
    });

    test('returns array (may be empty) for a sparse note in a rich vault', () => {
        const entries = [];
        for (let i = 0; i < 5; i++) {
            entries.push([`c${i}`, { type: 'contact', name: `P${i}`, email: `c${i}@x.com`, account: '[[mi]]' }]);
        }
        entries.push(['mi', { type: 'account' }]);
        const gaps = buildSchemaAdaptiveGaps(
            { type: 'contact' }, {}, makeCache(entries), { nodeType: 'contact' }
        );
        assert.ok(Array.isArray(gaps));
        for (const gap of gaps) {
            assert.ok(typeof gap.field === 'string',         'gap must have field');
            assert.ok(typeof gap.score === 'number',         'gap must have score');
            assert.ok(typeof gap.missingSummary === 'string','gap must have missingSummary');
            assert.ok(typeof gap.insertText === 'string',    'gap must have insertText');
        }
    });

    test('gaps are sorted by score descending', () => {
        const entries = [];
        for (let i = 0; i < 5; i++) {
            entries.push([`c${i}`, { type: 'contact', name: `P${i}`, email: `c${i}@x.com`, account: '[[mi]]', status: 'active' }]);
        }
        entries.push(['mi', { type: 'account' }]);
        const gaps = buildSchemaAdaptiveGaps({ type: 'contact' }, {}, makeCache(entries), { nodeType: 'contact' });
        for (let i = 1; i < gaps.length; i++) {
            assert.ok(gaps[i - 1].score >= gaps[i].score, 'gaps should be sorted descending by score');
        }
    });

    test('gapLimit option caps result length', () => {
        const entries = [];
        for (let i = 0; i < 8; i++) {
            entries.push([`c${i}`, { type: 'contact', name: `P${i}`, email: `c${i}@x.com`, account: '[[mi]]', status: 'active', phone: `555-00${i}` }]);
        }
        entries.push(['mi', { type: 'account' }]);
        const gaps = buildSchemaAdaptiveGaps({ type: 'contact' }, {}, makeCache(entries), {
            nodeType: 'contact', gapLimit: 2
        });
        assert.ok(gaps.length <= 2);
    });
});

// ── buildFieldFamilyRelationModel ─────────────────────────────────────────────

describe('frontmatterRelationLearning — buildFieldFamilyRelationModel', () => {
    // Reset the module-level generation-keyed cache before each test so that
    // earlier describe blocks (which call gap-learning with empty Maps) cannot
    // poison the observed-note index used here.
    beforeEach(() => {
        resetObservedNoteIndexCache();
        resetVaultPriorsCache();
    });

    test('returns a model object with the expected shape', () => {
        const model = buildFieldFamilyRelationModel('account', { type: 'contact' }, {}, CRM_CACHE, { nodeType: 'contact' });
        assert.ok(typeof model === 'object');
        assert.ok(typeof model.field === 'string');
        assert.ok(Array.isArray(model.preferredTargets));
        assert.ok(Array.isArray(model.variants));
        assert.ok(typeof model.insertText === 'string');
        assert.ok(typeof model.summary === 'string');
    });

    test('preferred targets match vault observations', () => {
        const model = buildFieldFamilyRelationModel('account', { type: 'contact' }, {}, CRM_CACHE, { nodeType: 'contact' });
        assert.ok(model.preferredTargets.includes('mi'), `expected mi, got ${model.preferredTargets}`);
        assert.ok(model.preferredTargets.includes('navajo'));
    });

    test('most frequent target is first', () => {
        const model = buildFieldFamilyRelationModel('account', { type: 'contact' }, {}, CRM_CACHE, { nodeType: 'contact' });
        assert.equal(model.preferredTargets[0], 'mi');
    });

    test('insertText contains the top preferred target', () => {
        const model = buildFieldFamilyRelationModel('account', { type: 'contact' }, {}, CRM_CACHE, { nodeType: 'contact' });
        assert.ok(model.insertText.includes('mi'), `insertText was: ${model.insertText}`);
    });

    test('returns empty targets for unknown field with no vault observations', () => {
        const model = buildFieldFamilyRelationModel('nonexistent-field', { type: 'contact' }, {}, CRM_CACHE, { nodeType: 'contact' });
        assert.ok(Array.isArray(model.preferredTargets));
    });

    test('works with empty cache (no crash)', () => {
        const model = buildFieldFamilyRelationModel('account', { type: 'contact' }, {}, new Map(), {});
        assert.ok(typeof model === 'object');
    });
});

// ── buildFrontmatterOpportunityModel ─────────────────────────────────────────

describe('frontmatterIntelligence — buildFrontmatterOpportunityModel', () => {
    test('returns all expected top-level keys', () => {
        const model = buildFrontmatterOpportunityModel({ type: 'contact' }, { fieldsCache: CRM_CACHE, nodeType: 'contact' });
        const expected = [
            'likelyFields', 'likelyLinks', 'likelyGaps', 'likelyContexts',
            'likelyConnections', 'bodyMentionHints', 'recommendedBundle',
            'contextBundle', 'contextThreadViews', 'likelyCompanions',
            'surroundingSetups', 'setupInsertText', 'relationSetupInsertText'
        ];
        for (const key of expected) {
            assert.ok(key in model, `missing key: ${key}`);
        }
    });

    test('likelyFields is non-empty for a contact note in a CRM vault', () => {
        const model = buildFrontmatterOpportunityModel({ type: 'contact' }, { fieldsCache: CRM_CACHE, nodeType: 'contact' });
        assert.ok(model.likelyFields.length > 0, 'expected at least one suggested field');
    });

    test('each likelyField has required structure', () => {
        const model = buildFrontmatterOpportunityModel({ type: 'contact' }, { fieldsCache: CRM_CACHE, nodeType: 'contact' });
        for (const f of model.likelyFields) {
            assert.ok(typeof f.field === 'string',       `field: ${f.field}`);
            assert.ok(typeof f.score === 'number',       `score: ${f.score}`);
            assert.ok(typeof f.relational === 'boolean', `relational: ${f.relational}`);
            assert.ok(typeof f.insertText === 'string',  `insertText: ${f.insertText}`);
            assert.ok(typeof f.summary === 'string',     `summary: ${f.summary}`);
        }
    });

    test('account field is suggested for a bare contact note', () => {
        const model = buildFrontmatterOpportunityModel({ type: 'contact' }, { fieldsCache: CRM_CACHE, nodeType: 'contact' });
        const fieldNames = model.likelyFields.map(f => f.field);
        assert.ok(fieldNames.includes('account'), `expected account in ${fieldNames}`);
    });

    test('account suggestion is relational', () => {
        const model = buildFrontmatterOpportunityModel({ type: 'contact' }, { fieldsCache: CRM_CACHE, nodeType: 'contact' });
        const accountHint = model.likelyFields.find(f => f.field === 'account');
        if (accountHint) {
            assert.ok(accountHint.relational, 'account should be relational');
        }
    });

    test('works with empty vault (no crash, returns empty arrays)', () => {
        const model = buildFrontmatterOpportunityModel({ type: 'contact' }, { fieldsCache: new Map() });
        assert.ok(Array.isArray(model.likelyFields));
        assert.ok(Array.isArray(model.likelyGaps));
    });

    test('body mention hints generated when content has repeated wikilinks', () => {
        const content = '---\nid: note\ntype: contact\n---\n\nSee [[mi]] here. [[mi]] confirms.\n';
        const model = buildFrontmatterOpportunityModel(
            { type: 'contact' },
            { fieldsCache: CRM_CACHE, content, bodyMentionThreshold: 2 }
        );
        const miHint = model.bodyMentionHints.find(h => h.id === 'mi');
        assert.ok(miHint, 'expected body mention hint for mi');
    });

    test('likelyLinks is a subset of relational likelyFields', () => {
        const model = buildFrontmatterOpportunityModel({ type: 'contact' }, { fieldsCache: CRM_CACHE, nodeType: 'contact' });
        for (const link of model.likelyLinks) {
            assert.ok(link.relational, 'likelyLinks items must be relational');
            assert.ok(model.likelyFields.some(f => f.field === link.field), 'likelyLink must appear in likelyFields');
        }
    });

    test('likelyFields are sorted by score descending', () => {
        const model = buildFrontmatterOpportunityModel({ type: 'contact' }, { fieldsCache: CRM_CACHE, nodeType: 'contact' });
        for (let i = 1; i < model.likelyFields.length; i++) {
            assert.ok(
                model.likelyFields[i - 1].score >= model.likelyFields[i].score,
                'likelyFields must be sorted by score descending'
            );
        }
    });

    test('limit option caps likelyFields length', () => {
        const model = buildFrontmatterOpportunityModel(
            { type: 'contact' },
            { fieldsCache: CRM_CACHE, nodeType: 'contact', limit: 2 }
        );
        assert.ok(model.likelyFields.length <= 2);
    });
});

// ── buildFrontmatterGuidanceSummary ───────────────────────────────────────────

describe('frontmatterIntelligence — buildFrontmatterGuidanceSummary', () => {
    test('returns all required keys even for empty model', () => {
        const summary = buildFrontmatterGuidanceSummary({});
        assert.ok('headline' in summary);
        assert.ok('bestNextStep' in summary);
        assert.ok('why' in summary);
        assert.ok('starterActions' in summary);
        assert.ok('workflowSummary' in summary);
        assert.ok('setupSummary' in summary);
        assert.ok('bodyEvidence' in summary);
        assert.ok(Array.isArray(summary.starterActions));
    });

    test('uses nextContext as the primary signal for bestNextStep', () => {
        const model = {
            likelyContexts: [{ field: 'account', targetId: 'mi', summary: 'contacts point to mi', insertText: 'account: [[mi]]\n' }],
            likelyGaps: [],
            likelyFields: [],
            bodyMentionHints: []
        };
        const summary = buildFrontmatterGuidanceSummary(model);
        assert.ok(summary.headline.includes('account'));
        assert.equal(summary.bestNextStep?.kind, 'context');
    });

    test('falls back to missingPiece when no context available', () => {
        const model = {
            likelyContexts: [],
            likelyGaps: [{ field: 'email', summary: 'contacts have email', missingSummary: 'You may still be missing email', insertText: 'email: \n' }],
            likelyFields: [],
            bodyMentionHints: []
        };
        const summary = buildFrontmatterGuidanceSummary(model);
        assert.equal(summary.bestNextStep?.kind, 'missing-piece');
    });

    test('falls back to nextField when no context or gap', () => {
        const model = {
            likelyContexts: [],
            likelyGaps: [],
            likelyFields: [{ field: 'email', summary: 'contacts have email', insertText: 'email: \n' }],
            bodyMentionHints: []
        };
        const summary = buildFrontmatterGuidanceSummary(model);
        assert.equal(summary.bestNextStep?.kind, 'field');
    });

    test('falls back to body mention when all other signals absent', () => {
        const model = {
            likelyContexts: [],
            likelyGaps: [],
            likelyFields: [],
            bodyMentionHints: [{ id: 'mi', count: 3, insertText: 'related: [[mi]]\n' }]
        };
        const summary = buildFrontmatterGuidanceSummary(model);
        assert.equal(summary.bestNextStep?.kind, 'body-mention');
    });

    test('starterActions array contains the bestNextStep', () => {
        const model = {
            likelyContexts: [{ field: 'account', targetId: 'mi', summary: 'x', insertText: 'account: [[mi]]\n' }],
            likelyGaps: [], likelyFields: [], bodyMentionHints: []
        };
        const summary = buildFrontmatterGuidanceSummary(model);
        assert.ok(summary.starterActions.includes(summary.bestNextStep));
    });

    test('recommendedBundle adds a bundle action to starterActions', () => {
        const model = {
            likelyContexts: [],
            likelyGaps: [],
            likelyFields: [],
            bodyMentionHints: [],
            recommendedBundle: {
                fields: [
                    { field: 'email', insertText: 'email: \n' },
                    { field: 'status', insertText: 'status: \n' }
                ],
                insertText: 'email: \nstatus: \n'
            }
        };
        const summary = buildFrontmatterGuidanceSummary(model);
        assert.ok(summary.starterActions.some(a => a.kind === 'bundle'));
    });

    test('produces guidance from a real opportunity model', () => {
        const model = buildFrontmatterOpportunityModel({ type: 'contact' }, { fieldsCache: CRM_CACHE, nodeType: 'contact' });
        const summary = buildFrontmatterGuidanceSummary(model);
        assert.ok(typeof summary.headline === 'string');
        assert.ok(summary.starterActions.length > 0, 'should have at least one starter action');
    });
});

// ── summarizeGuidanceExplanation ──────────────────────────────────────────────

describe('frontmatterIntelligence — summarizeGuidanceExplanation', () => {
    test('returns empty string for null or empty input', () => {
        assert.equal(summarizeGuidanceExplanation(null), '');
        assert.equal(summarizeGuidanceExplanation({}),   '');
    });

    test('returns why when present', () => {
        assert.equal(summarizeGuidanceExplanation({ why: 'contacts usually link account' }), 'contacts usually link account');
    });

    test('falls back to workflowSummary when why is absent', () => {
        assert.equal(summarizeGuidanceExplanation({ workflowSummary: 'wf' }), 'wf');
    });

    test('falls back to setupSummary when higher-priority fields absent', () => {
        assert.equal(summarizeGuidanceExplanation({ setupSummary: 'ss' }), 'ss');
    });

    test('falls back to nextContext.summary', () => {
        assert.equal(
            summarizeGuidanceExplanation({ nextContext: { summary: 'context summary' } }),
            'context summary'
        );
    });

    test('falls back to nextField.summary', () => {
        assert.equal(
            summarizeGuidanceExplanation({ nextField: { summary: 'field summary' } }),
            'field summary'
        );
    });

    test('trims whitespace from result', () => {
        assert.equal(summarizeGuidanceExplanation({ why: '  trimmed  ' }), 'trimmed');
    });

    test('returns empty string when no useful field present', () => {
        assert.equal(summarizeGuidanceExplanation({ headline: 'x', starterActions: [] }), '');
    });
});
