'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { inferReverseRelationField, mergeRelationFieldValue } = require('../src/intelligence/reverseRelationHelpers');

describe('inferReverseRelationField', () => {
    test('returns "observed" confidence when an existing note of the target type already has a field named after the source type', () => {
        const fieldsCache = new Map([
            ['roughnecks', { type: 'unit', characters: '[[johnny-rico]]' }]
        ]);
        const result = inferReverseRelationField('unit', 'character', 'johnny-rico', fieldsCache);
        assert.deepEqual(result, { field: 'characters', confidence: 'observed' });
    });

    test('matches the singular field name too, not just the pluralized form', () => {
        const fieldsCache = new Map([
            ['some-account', { type: 'account', owner: '[[some-contact]]' }]
        ]);
        const result = inferReverseRelationField('account', 'owner', 'some-contact', fieldsCache);
        assert.deepEqual(result, { field: 'owner', confidence: 'observed' });
    });

    test('falls back to "guessed" confidence with the bare source type as the field name when no note of the target type has a matching field', () => {
        const fieldsCache = new Map([
            ['unrelated', { type: 'unit', name: 'Unrelated' }]
        ]);
        const result = inferReverseRelationField('unit', 'mission', 'operation-x', fieldsCache);
        assert.deepEqual(result, { field: 'mission', confidence: 'guessed' });
    });

    test('returns null when there is no sourceType at all', () => {
        assert.equal(inferReverseRelationField('unit', '', 'some-id', new Map()), null);
    });

    test('returns null when there is no matching field and no sourceId to guess with', () => {
        assert.equal(inferReverseRelationField('unit', 'mission', '', new Map()), null);
    });

    test('ignores notes of a different type than the target when scanning for observed evidence', () => {
        const fieldsCache = new Map([
            ['some-mission', { type: 'mission', characters: '[[johnny-rico]]' }]
        ]);
        // Target type is 'unit', not 'mission' — this note's 'characters'
        // field must not count as evidence for a 'unit' reverse field.
        const result = inferReverseRelationField('unit', 'character', 'johnny-rico', fieldsCache);
        assert.deepEqual(result, { field: 'character', confidence: 'guessed' });
    });
});

describe('mergeRelationFieldValue', () => {
    test('returns a bare wikilink when the existing value is empty', () => {
        assert.equal(mergeRelationFieldValue('', 'target-id'), '[[target-id]]');
    });

    test('appends to an existing value with a comma', () => {
        assert.equal(mergeRelationFieldValue('[[existing]]', 'target-id'), '[[existing]], [[target-id]]');
    });

    test('does not duplicate an id already present in the existing value', () => {
        assert.equal(mergeRelationFieldValue('[[existing]], [[target-id]]', 'target-id'), '[[existing]], [[target-id]]');
    });
});
