'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const MOCK_BACKLINKS = new Map([
    ['johnny-rico', [
        { field: 'commander', sourceId: 'mission-alpha' },
        { field: 'commander', sourceId: 'mission-beta' },
        { field: 'body', sourceId: 'mission-body-mention' }
    ]]
]);

const MOCK_FIELDS = new Map([
    ['mission-alpha', { type: 'mission' }],
    ['mission-beta', { type: 'mission' }],
    ['mission-body-mention', { type: 'mission' }]
]);

const originalResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, ...rest) {
    if (request === '../core/graph') return '__suggestions_graph__';
    if (request === '../core/index') return '__suggestions_index__';
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

const {
    computeSuggestionsForNode,
    queryAlreadyExists,
    QUERY_SUGGESTION_THRESHOLD
} = require('../src/engine/suggestions');

describe('smart suggestions', () => {
    test('suggestions emit canonical incoming via queries', () => {
        const results = computeSuggestionsForNode('johnny-rico', null);
        assert.equal(results.length, 1);
        assert.equal(results[0].field, 'commander');
        assert.equal(results[0].sourceType, 'mission');
        assert.equal(results[0].count, QUERY_SUGGESTION_THRESHOLD);
        assert.equal(results[0].queryText, '!view incoming mission\nvia commander');
    });

    test('existing incoming via query suppresses duplicate suggestion', () => {
        const docText = '!view incoming mission\nvia commander';
        const results = computeSuggestionsForNode('johnny-rico', docText);
        assert.equal(results.length, 0);
    });

    test('legacy where query still suppresses duplicate suggestion', () => {
        const docText = '!view mission\nwhere commander = [[johnny-rico]]';
        const results = computeSuggestionsForNode('johnny-rico', docText);
        assert.equal(results.length, 0);
    });

    test('queryAlreadyExists recognises current and compatibility formats', () => {
        assert.equal(queryAlreadyExists('!view incoming mission via commander', 'mission', 'commander', 'johnny-rico'), true);
        assert.equal(queryAlreadyExists('!view mission via commander', 'mission', 'commander', 'johnny-rico'), true);
        assert.equal(queryAlreadyExists('!view mission where commander = [[johnny-rico]]', 'mission', 'commander', 'johnny-rico'), true);
        assert.equal(queryAlreadyExists('!view mission where intelligence = [[johnny-rico]]', 'mission', 'commander', 'johnny-rico'), false);
    });
});
