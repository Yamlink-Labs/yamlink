'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const MOCK_BACKLINKS = new Map([
    ['johnny-rico', [
        { field: 'commander', sourceId: 'mission-alpha' },
        { field: 'commander', sourceId: 'mission-beta' },
        { field: 'body', sourceId: 'mission-body-mention' }
    ]],
    ['cloudlabs-solutions', [
        { field: 'account', sourceId: 'contact-andreas' },
        { field: 'account', sourceId: 'meeting-partner-call' }
    ]]
]);

const MOCK_FIELDS = new Map([
    ['johnny-rico', { type: 'character' }],
    ['mission-alpha', { type: 'mission' }],
    ['mission-beta', { type: 'mission' }],
    ['mission-body-mention', { type: 'mission' }],
    ['cloudlabs-solutions', { type: 'partner' }],
    ['future-partner', { type: 'partner' }],
    ['contact-andreas', { type: 'contact', account: '[[cloudlabs-solutions]]' }],
    ['contact-brenda', { type: 'contact', account: '[[future-partner]]' }],
    ['contact-prospect', { type: 'note', email: 'prospect@cloudlabs.com', phone: '+56 9 1111 1111', name: 'Prospect Contact' }],
    ['meeting-partner-call', { type: 'meeting' }],
    ['meeting-qbr', { type: 'meeting', account: '[[cloudlabs-solutions]]', followup: '2026-04-30' }],
    ['issue-graph-selection', { type: 'note', status: 'in-progress', deadline: '2026-04-20', project: '[[yamlink]]', reporter: '[[contact-andreas]]', title: 'Graph selection bug' }],
    ['review-hover-card', { type: 'task', status: 'planned', project: '[[yamlink]]', owner: '[[contact-andreas]]' }],
    ['yamlink', { type: 'project', name: 'Yamlink' }],
    ['product-inkjet-pro', { type: 'product', related: '[[inkjet]]' }],
    ['product-colorstream', { type: 'product', related: '[[inkjet]]' }],
    ['concept-inkjet', { type: 'note', title: 'Inkjet concept', related: '[[inkjet]]', products: '[[product-inkjet-pro]]', summary: 'Inkjet knowledge and product context' }],
    ['inkjet', { type: 'concept' }]
]);

const MOCK_SCHEMAS = new Map([
    ['contact', {
        sourceId: 'schema-contact',
        fields: {
            account: { type: 'relation', target: 'partner' },
            created: { type: 'string' }
        }
    }],
    ['meeting', {
        sourceId: 'schema-meeting',
        fields: {
            account: { type: 'relation', target: 'partner' },
            date: { type: 'string' }
        }
    }]
]);

const originalResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, ...rest) {
    if (request === '../core/graph') return '__suggestions_graph__';
    if (request === '../core/index') return '__suggestions_index__';
    if (request === '../core/indexService') return '__suggestions_index__';
    if (request === '../registries/schemaRegistry') return '__suggestions_schema__';
    return originalResolve(request, parent, ...rest);
};

require.cache.__suggestions_graph__ = {
    id: '__suggestions_graph__',
    filename: '__suggestions_graph__',
    loaded: true,
    exports: {
        getBacklinks(id) {
            return MOCK_BACKLINKS.get(id) ?? [];
        }
    }
};

require.cache.__suggestions_index__ = {
    id: '__suggestions_index__',
    filename: '__suggestions_index__',
    loaded: true,
    exports: {
        getFieldsCache() {
            return MOCK_FIELDS;
        },
        getVaultGeneration() {
            return 0;
        }
    }
};

require.cache.__suggestions_schema__ = {
    id: '__suggestions_schema__',
    filename: '__suggestions_schema__',
    loaded: true,
    exports: {
        getSchema(type) {
            return MOCK_SCHEMAS.get(type) ?? null;
        },
        getSchemaTargets() {
            return new Set(MOCK_SCHEMAS.keys());
        }
    }
};

const {
    computeSuggestionsForNode,
    explainSuggestionState,
    queryAlreadyExists,
    QUERY_SUGGESTION_THRESHOLD
} = require('../src/engine/suggestions');
const { resetVaultPriorsCache } = require('../src/intelligence/vaultPriors');
const { resetObservedNoteIndexCache } = require('../src/intelligence/suggestionNoteIndex');
const { clearActivationCache } = require('../src/intelligence/activationCache');

describe('smart suggestions', () => {
    after(() => {
        resetVaultPriorsCache();
        resetObservedNoteIndexCache();
        clearActivationCache();
    });
    test('repeated incoming pattern still emits canonical incoming query', () => {
        const results = computeSuggestionsForNode('johnny-rico', null);
        const canonical = results.find(r => r.queryText === '!view incoming mission\nvia commander');
        assert.ok(canonical);
        assert.equal(canonical.kind, 'incoming-pattern');
        assert.equal(canonical.field, 'commander');
        assert.equal(canonical.sourceType, 'mission');
        assert.equal(canonical.count, QUERY_SUGGESTION_THRESHOLD);
    });

    test('schema-aware relation suggestions unlock on a single backlink', () => {
        const results = computeSuggestionsForNode('cloudlabs-solutions', null);
        assert.equal(results.length, 3);
        assert.deepEqual(
            results.map(r => r.queryText),
            [
                '!view contact\nwhere account = [[cloudlabs-solutions]]\nsort created desc',
                '!view meeting\nwhere account = [[cloudlabs-solutions]]\nsort date desc',
                '!view incoming *\nvia account'
            ]
        );
        assert.deepEqual(
            results.map(r => r.kind),
            ['schema-relation', 'schema-relation', 'mixed-incoming']
        );
    });

    test('schema-aware relation suggestions still appear before backlinks exist', () => {
        const results = computeSuggestionsForNode('future-partner', null);
        assert.equal(results.length, 2);
        assert.deepEqual(
            results.map(r => r.queryText),
            [
                '!view contact\nwhere account = [[future-partner]]\nsort created desc',
                '!view meeting\nwhere account = [[future-partner]]\nsort date desc'
            ]
        );
        assert.ok(results.every(r => r.kind === 'schema-relation'));
        assert.ok(results.every(r => r.count === 0));
    });

    test('observed relation patterns can suggest useful views before backlinks exist', () => {
        const originalSchemas = new Map(MOCK_SCHEMAS);
        try {
            MOCK_SCHEMAS.clear();

            const results = computeSuggestionsForNode('future-partner', null);
            assert.ok(results.some(r => r.kind === 'observed-relation'));
            assert.deepEqual(
                results.map(r => r.queryText),
                [
                    '!view contact\nwhere account = [[future-partner]]',
                    '!view meeting\nwhere account = [[future-partner]]\nsort followup desc'
                ]
            );
            assert.ok(results.every(r => r.description.includes('often linked')));
        } finally {
            MOCK_SCHEMAS.clear();
            for (const [key, value] of originalSchemas.entries()) MOCK_SCHEMAS.set(key, value);
        }
    });

    test('current note relation fields can suggest peer views', () => {
        const results = computeSuggestionsForNode('contact-andreas', null);
        assert.ok(results.some(r => r.queryText === '!view meeting\nwhere account = [[cloudlabs-solutions]]\nsort date desc'));
        assert.ok(results.some(r => r.queryText === '!view contact\nwhere account = [[cloudlabs-solutions]]\nsort created desc'));
    });

    test('observed relational structure can unlock shared-context suggestions without schema', () => {
        const results = computeSuggestionsForNode('concept-inkjet', null);
        assert.ok(results.some(r => r.kind === 'shared-relation-context'));
        const productSuggestion = results.find(r => r.kind === 'shared-relation-context' && r.sourceType === 'product');
        assert.ok(productSuggestion);
        assert.equal(productSuggestion.queryText, '!view product\nwhere related = [[inkjet]]');
        assert.match(productSuggestion.description, /related → inkjet/);
        assert.ok(results.some(r => r.kind === 'surrounding-setup'));
    });

    test('relation intelligence can suggest a useful thread view from shared workflow context alone', () => {
        const results = computeSuggestionsForNode('issue-graph-selection', null);
        const threadSuggestion = results.find(r => r.queryText === '!view task\nwhere project = [[yamlink]]');
        assert.ok(threadSuggestion);
        assert.match(threadSuggestion.description, /yamlink/i);
        assert.ok(results.some(r => r.kind === 'context-thread'));
        assert.ok(results.some(r => r.kind === 'surrounding-setup'));
    });

    test('explanation can infer richer note roles even when type is only "note"', () => {
        const explanation = explainSuggestionState('concept-inkjet');
        assert.ok(explanation.reasons.some(reason => reason.includes('concept note')));
    });

    test('explanation can surface likely next fields and links from similar notes', () => {
        const explanation = explainSuggestionState('contact-prospect');
        assert.ok(explanation.reasons.some(reason => reason.includes('often add')));
        assert.ok(explanation.reasons.some(reason => reason.includes('"account"')));
        assert.ok(explanation.reasons.some(reason => reason.includes('Next link:')));
        assert.ok(explanation.reasons.some(reason => reason.includes('Missing:')));
        assert.ok(explanation.reasons.some(reason => reason.includes('Useful fields:')));
        assert.ok(explanation.reasons.some(reason => reason.includes('Context:')));
        assert.ok(explanation.reasons.some(reason => reason.includes('Other notes also use')));
    });

    test('explanation can infer task-style notes from workflow fields even when type is generic', () => {
        const explanation = explainSuggestionState('issue-graph-selection');
        assert.ok(explanation.reasons.some(reason => reason.includes('work item note') || reason.includes('task note') || reason.includes('bug note')));
    });

    test('explanation can surface likely missing links from shared context', () => {
        const explanation = explainSuggestionState('concept-inkjet');
        assert.ok(explanation.reasons.some(reason => reason.includes('Related notes nearby:')));
        assert.ok(explanation.reasons.some(reason => reason.includes('product-colorstream')));
        assert.ok(explanation.reasons.some(reason => reason.includes('Path: concept-inkjet -> inkjet -> product-colorstream')));
    });

    test('explanation can surface the next useful relation thread view', () => {
        const explanation = explainSuggestionState('issue-graph-selection');
        assert.ok(explanation.reasons.some(reason => reason.includes('Related note:')));
        assert.ok(explanation.reasons.some(reason => reason.includes('Next view: follow project around yamlink')));
        assert.ok(explanation.reasons.some(reason => reason.includes('Common flow: project -> yamlink')));
        assert.ok(explanation.reasons.some(reason => reason.includes('Nearby note: review-hover-card')));
        assert.ok(explanation.reasons.some(reason => reason.includes('Common view: follow project around yamlink')));
        assert.ok(explanation.reasons.some(reason => reason.includes('Common setup:')));
        assert.ok(explanation.reasons.some(reason => reason.includes('Often includes')));
    });

    test('existing forward query suppresses duplicate schema suggestion', () => {
        const docText = '!view contact\nwhere account = [[cloudlabs-solutions]]\nsort created desc';
        const results = computeSuggestionsForNode('cloudlabs-solutions', docText);
        assert.equal(results.some(r => r.queryText.includes('!view contact')), false);
        assert.equal(results.some(r => r.queryText.includes('!view meeting')), true);
    });

    test('keepExisting preserves suggestions and marks them as inserted', () => {
        const docText = '!view contact\nwhere account = [[cloudlabs-solutions]]\nsort created desc';
        const results = computeSuggestionsForNode('cloudlabs-solutions', docText, { keepExisting: true });
        const contact = results.find(r => r.sourceType === 'contact');
        assert.equal(Boolean(contact), true);
        assert.equal(contact.inserted, true);
    });

    test('existing peer query is suppressed too', () => {
        const docText = '!view contact\nwhere account = [[cloudlabs-solutions]]\nsort created desc';
        const results = computeSuggestionsForNode('contact-andreas', docText);
        assert.ok(results.some(r => r.queryText === '!view meeting\nwhere account = [[cloudlabs-solutions]]\nsort date desc'));
        assert.equal(results.some(r => r.queryText === '!view contact\nwhere account = [[cloudlabs-solutions]]\nsort created desc'), false);
    });

    test('explainSuggestionState describes why no suggestions exist yet', () => {
        const explanation = explainSuggestionState('future-partner');
        assert.equal(explanation.title, 'No suggested views yet');
        assert.ok(explanation.reasons.some(reason => reason.includes('This looks like a')));
        assert.ok(explanation.reasons.some(reason => reason.includes('Schema links here through')));
        assert.ok(explanation.reasons.some(reason => reason.includes('No structured links here yet')));
    });

    test('queryAlreadyExists recognises current and compatibility formats', () => {
        assert.equal(queryAlreadyExists('!view incoming mission via commander', 'mission', 'commander', 'johnny-rico'), true);
        assert.equal(queryAlreadyExists('!view mission via commander', 'mission', 'commander', 'johnny-rico'), true);
        assert.equal(queryAlreadyExists('!view mission where commander = [[johnny-rico]]', 'mission', 'commander', 'johnny-rico'), true);
        assert.equal(queryAlreadyExists('!view mission where intelligence = [[johnny-rico]]', 'mission', 'commander', 'johnny-rico'), false);
    });
});
