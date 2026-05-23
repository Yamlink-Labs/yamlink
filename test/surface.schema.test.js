'use strict';
/**
 * surface.schema.test.js
 *
 * Integration tests for schema-in-vault driving fieldCategory.
 * Each test builds a real vault with a schema note, then asserts that
 * classifyField uses the schema as the authoritative source (confidence=1.0)
 * for declared fields, and falls back to heuristics for undeclared fields.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createVault } = require('./lib/vaultSim');
const { getSchema } = require('../src/registries/schemaRegistry');

const NOTE = (id, type, extra = '') =>
    `---\nid: ${id}\ntype: ${type}\n${extra}---\n`;

// Schema note: declares 'account' as relation and 'email' as string
const SCHEMA_CONTACT = [
    '---',
    'id: schema-contact',
    'type: schema',
    'target: contact',
    'fields:',
    '  account:',
    '    type: relation',
    '    target: account',
    '  email:',
    '    type: string',
    '---',
    ''
].join('\n');

// Schema note: declares 'revenue' as number and 'founded' as date
const SCHEMA_ACCOUNT = [
    '---',
    'id: schema-account',
    'type: schema',
    'target: account',
    'fields:',
    '  revenue:',
    '    type: number',
    '  founded:',
    '    type: date',
    '  stage:',
    '    type: status',
    '---',
    ''
].join('\n');

// ── Schema registration ───────────────────────────────────────────────────────

describe('schema — registry state after vault build', () => {
    test('schema node is registered after buildIndex', () => {
        const vault = createVault({
            'schema-contact.md': SCHEMA_CONTACT,
            'rico.md':           NOTE('rico', 'contact')
        });
        const schema = getSchema('contact');
        assert.ok(schema, 'schema for contact should be registered');
        assert.equal(schema.sourceId, 'schema-contact');
        assert.ok('account' in schema.fields, 'account field should be declared');
        assert.ok('email'   in schema.fields, 'email field should be declared');
        vault.destroy();
    });

    test('vault with no schema note returns null from getSchema', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact')
        });
        const schema = getSchema('contact');
        assert.equal(schema, null, 'no schema should be registered when vault has none');
        vault.destroy();
    });

    test('schema fields carry the declared type', () => {
        const vault = createVault({
            'schema-contact.md': SCHEMA_CONTACT
        });
        const schema = getSchema('contact');
        assert.equal(schema.fields.account.type, 'relation');
        assert.equal(schema.fields.email.type,   'string');
        vault.destroy();
    });
});

// ── fieldCategory with schema authority ───────────────────────────────────────

describe('schema — fieldCategory driven by schema', () => {
    test('schema-declared relation field is classified as RELATION', () => {
        const vault = createVault({
            'schema-contact.md': SCHEMA_CONTACT,
            'mi.md':   NOTE('mi',   'account'),
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n')
        });
        const result = vault.fieldCategory('rico', 'account');
        assert.ok(result, 'should return a classification');
        assert.equal(result.category, 'RELATION');
        vault.destroy();
    });

    test('schema authority sets source to "schema"', () => {
        const vault = createVault({
            'schema-contact.md': SCHEMA_CONTACT,
            'mi.md':   NOTE('mi',   'account'),
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n')
        });
        const result = vault.fieldCategory('rico', 'account');
        assert.equal(result.source, 'schema');
        vault.destroy();
    });

    test('schema authority gives confidence=1.0', () => {
        const vault = createVault({
            'schema-contact.md': SCHEMA_CONTACT,
            'mi.md':   NOTE('mi',   'account'),
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n')
        });
        const result = vault.fieldCategory('rico', 'account');
        assert.equal(result.confidence, 1.0);
        vault.destroy();
    });

    test('schema-declared string field is classified as DESCRIPTIVE', () => {
        const vault = createVault({
            'schema-contact.md': SCHEMA_CONTACT,
            'rico.md': NOTE('rico', 'contact', 'email: rico@mi.gov\n')
        });
        const result = vault.fieldCategory('rico', 'email');
        assert.ok(result, 'should return a classification');
        assert.equal(result.category, 'DESCRIPTIVE', `expected DESCRIPTIVE for string type, got ${result.category}`);
        assert.equal(result.source, 'schema');
        vault.destroy();
    });

    test('schema-declared date field is classified as DATE', () => {
        const vault = createVault({
            'schema-account.md': SCHEMA_ACCOUNT,
            'mi.md': NOTE('mi', 'account', 'founded: 2010-01-01\n')
        });
        const result = vault.fieldCategory('mi', 'founded');
        assert.ok(result, 'should return a classification');
        assert.equal(result.category, 'DATE');
        assert.equal(result.source, 'schema');
        vault.destroy();
    });

    test('schema-declared status field is classified as WORKFLOW', () => {
        const vault = createVault({
            'schema-account.md': SCHEMA_ACCOUNT,
            'mi.md': NOTE('mi', 'account', 'stage: active\n')
        });
        const result = vault.fieldCategory('mi', 'stage');
        assert.ok(result, 'should return a classification');
        assert.equal(result.category, 'WORKFLOW');
        assert.equal(result.source, 'schema');
        vault.destroy();
    });

    test('field not in schema falls back to heuristic classification', () => {
        const vault = createVault({
            'schema-contact.md': SCHEMA_CONTACT,
            'rico.md': NOTE('rico', 'contact', 'phone: 555-1234\n')
        });
        // 'phone' is not in the contact schema → falls through to name patterns
        const result = vault.fieldCategory('rico', 'phone');
        assert.ok(result, 'should still return a classification via fallback');
        // 'phone' has no matching identity/structural/date/workflow name pattern
        // so it could be DESCRIPTIVE or UNKNOWN depending on vault priors
        assert.ok(typeof result.category === 'string', 'category should be a string');
        assert.notEqual(result.source, 'schema', 'source should not be schema for undeclared field');
        vault.destroy();
    });

    test('schema applies only to its declared target type', () => {
        const vault = createVault({
            'schema-contact.md': SCHEMA_CONTACT,
            'schema-account.md': SCHEMA_ACCOUNT,
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi',   'account', 'revenue: 5000\n')
        });
        // contact schema covers account → RELATION
        const ricoResult = vault.fieldCategory('rico', 'account');
        assert.equal(ricoResult.category, 'RELATION');
        assert.equal(ricoResult.source,   'schema');

        // account schema covers revenue → not RELATION (type: number → UNKNOWN/DESCRIPTIVE)
        const miResult = vault.fieldCategory('mi', 'revenue');
        assert.ok(miResult, 'mi.revenue should be classified');
        // 'number' type is not a recognised schema type that maps to RELATION
        assert.notEqual(miResult.category, 'RELATION', 'revenue should not be RELATION');
        vault.destroy();
    });

    test('vault without any schema still classifies via name-pattern heuristics', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'status: active\n')
        });
        const result = vault.fieldCategory('rico', 'status');
        assert.ok(result);
        assert.match(result.category, /WORKFLOW/,
            `'status' should match the workflow pattern, got ${result.category}`);
        vault.destroy();
    });
});
