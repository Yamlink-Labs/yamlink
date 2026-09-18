'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

// lightbulbUtils.js requires 'vscode' at module load time (for Range/Position
// in buildFieldValueRange) even though getFieldTargetTypesFromSchema itself
// doesn't touch vscode — stub it minimally so the module can load.
require.cache.__lbu_vscode__ = {
    id: '__lbu_vscode__',
    filename: '__lbu_vscode__',
    loaded: true,
    exports: {
        Range: class Range { constructor(start, end) { this.start = start; this.end = end; } },
        Position: class Position { constructor(line, character) { this.line = line; this.character = character; } }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__lbu_vscode__';
    return originalResolve(request, parent, ...rest);
};

const { getFieldTargetTypesFromSchema } = require('../src/features/lightbulbUtils');

after(() => {
    Module._resolveFilename = originalResolve;
});

describe('lightbulbUtils — getFieldTargetTypesFromSchema', () => {

    test('extracts a single target from a relation field', () => {
        const schema = { fields: { commander: { type: 'relation', target: 'character' } } };
        assert.deepEqual(getFieldTargetTypesFromSchema(schema, 'commander'), ['character']);
    });

    test('extracts multiple targetTypes from a relation field', () => {
        const schema = { fields: { unit: { type: 'relation', targetTypes: ['unit', 'squad'] } } };
        assert.deepEqual(getFieldTargetTypesFromSchema(schema, 'unit'), ['unit', 'squad']);
    });

    test('a field defining both target and targetTypes combines them', () => {
        // Regression note: this now matches authoringEngine.js's
        // getExpectedRelationTypes (already-established, already-tested
        // behavior — see authoringEngine.test.js's "homeworld" case), which
        // pushes both rather than returning early on `target` alone. This
        // function used to have its own separate, duplicated extraction
        // logic that early-returned on `target` and never checked
        // targetTypes in that case — deduplicating onto one shared
        // implementation changed this specific edge case, deliberately: the
        // two functions previously disagreeing silently on this exact
        // scenario is exactly the kind of drift unification is meant to
        // eliminate, not preserve.
        const schema = { fields: { source: { type: 'relation', target: 'character', targetTypes: ['unit'] } } };
        assert.deepEqual(getFieldTargetTypesFromSchema(schema, 'source'), ['character', 'unit']);
    });

    test('non-relation fields return an empty array', () => {
        const schema = { fields: { name: { type: 'string' } } };
        assert.deepEqual(getFieldTargetTypesFromSchema(schema, 'name'), []);
    });

    test('a field not present in the schema returns an empty array', () => {
        const schema = { fields: { commander: { type: 'relation', target: 'character' } } };
        assert.deepEqual(getFieldTargetTypesFromSchema(schema, 'unknown-field'), []);
    });

    test('falls back to the underscore variant of a hyphenated field name', () => {
        const schema = { fields: { source_unit: { type: 'relation', target: 'unit' } } };
        assert.deepEqual(getFieldTargetTypesFromSchema(schema, 'source-unit'), ['unit']);
    });

    test('a schema with no fields returns an empty array', () => {
        assert.deepEqual(getFieldTargetTypesFromSchema(null, 'commander'), []);
        assert.deepEqual(getFieldTargetTypesFromSchema({}, 'commander'), []);
    });

    test('target/targetTypes values are trimmed, lowercased, and deduplicated', () => {
        const schema = { fields: { unit: { type: 'relation', targetTypes: [' Unit ', 'unit', 'Squad'] } } };
        assert.deepEqual(getFieldTargetTypesFromSchema(schema, 'unit'), ['unit', 'squad']);
    });

});
