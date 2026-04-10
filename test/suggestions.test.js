'use strict';

const { test, describe } = require('node:test');
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
    ['meeting-partner-call', { type: 'meeting' }]
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

describe('smart suggestions', () => {
    test('repeated incoming pattern still emits canonical incoming query', () => {
        const results = computeSuggestionsForNode('johnny-rico', null);
        assert.equal(results.length, 1);
        assert.equal(results[0].kind, 'incoming-pattern');
        assert.equal(results[0].field, 'commander');
        assert.equal(results[0].sourceType, 'mission');
        assert.equal(results[0].count, QUERY_SUGGESTION_THRESHOLD);
        assert.equal(results[0].queryText, '!view incoming mission\nvia commander');
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

    test('current note relation fields can suggest peer views', () => {
        const results = computeSuggestionsForNode('contact-andreas', null);
        assert.equal(results.length, 2);
        assert.deepEqual(
            results.map(r => r.queryText),
            [
                '!view meeting\nwhere account = [[cloudlabs-solutions]]\nsort date desc',
                '!view contact\nwhere account = [[cloudlabs-solutions]]\nsort created desc'
            ]
        );
        assert.deepEqual(
            results.map(r => r.kind),
            ['shared-relation-context', 'peer-relation']
        );
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
        assert.equal(results.length, 1);
        assert.equal(results[0].queryText, '!view meeting\nwhere account = [[cloudlabs-solutions]]\nsort date desc');
    });

    test('explainSuggestionState describes why no suggestions exist yet', () => {
        const explanation = explainSuggestionState('future-partner');
        assert.equal(explanation.title, 'No suggested views yet');
        assert.ok(explanation.reasons.some(reason => reason.includes('Current note reads most like')));
        assert.ok(explanation.reasons.some(reason => reason.includes('Schemas already say this partner can connect')));
        assert.ok(explanation.reasons.some(reason => reason.includes('No structured backlinks point here yet')));
    });

    test('queryAlreadyExists recognises current and compatibility formats', () => {
        assert.equal(queryAlreadyExists('!view incoming mission via commander', 'mission', 'commander', 'johnny-rico'), true);
        assert.equal(queryAlreadyExists('!view mission via commander', 'mission', 'commander', 'johnny-rico'), true);
        assert.equal(queryAlreadyExists('!view mission where commander = [[johnny-rico]]', 'mission', 'commander', 'johnny-rico'), true);
        assert.equal(queryAlreadyExists('!view mission where intelligence = [[johnny-rico]]', 'mission', 'commander', 'johnny-rico'), false);
    });
});
