'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
    clearSchemaRegistry,
    registerSchemaNode,
    hasSchema,
    getSchema,
    getSchemaTargets,
    getDuplicateSchemas,
    getSchemaStats
} = require('../src/registries/schemaRegistry');

describe('schemaRegistry', () => {
    beforeEach(() => clearSchemaRegistry());

    test('empty registry has zero schemas', () => {
        const stats = getSchemaStats();
        assert.equal(stats.schemas, 0);
        assert.equal(stats.duplicates, 0);
        assert.deepEqual(stats.targets, []);
    });

    test('registers a schema node with a target type', () => {
        const frontmatter = 'id: schema-character\ntype: schema\ntarget: character\nfields:\n  name:\n    type: string\n    required: true';
        registerSchemaNode('schema-character', frontmatter);
        assert.equal(hasSchema('character'), true);
    });

    test('target type lookup is case-insensitive', () => {
        registerSchemaNode('schema-char', 'id: schema-char\ntype: schema\ntarget: Character\n');
        assert.equal(hasSchema('character'), true);
        assert.equal(hasSchema('CHARACTER'), true);
    });

    test('getSchema returns the schema with sourceId and fields', () => {
        const frontmatter = 'id: schema-contact\ntype: schema\ntarget: contact\nfields:\n  email:\n    type: string\n    required: true\n  account:\n    type: relation\n    target: account';
        registerSchemaNode('schema-contact', frontmatter);
        const schema = getSchema('contact');
        assert.ok(schema !== null);
        assert.equal(schema.sourceId, 'schema-contact');
        assert.ok('email' in schema.fields);
        assert.ok('account' in schema.fields);
    });

    test('getSchema field types are normalized', () => {
        registerSchemaNode('s', 'target: person\nfields:\n  name:\n    type: String\n  age:\n    type: NUMBER');
        const schema = getSchema('person');
        assert.equal(schema.fields.name.type, 'string');
        assert.equal(schema.fields.age.type, 'number');
    });

    test('required flag parsed correctly', () => {
        registerSchemaNode('s', 'target: deal\nfields:\n  owner:\n    type: relation\n    required: true\n  stage:\n    type: string');
        const schema = getSchema('deal');
        assert.equal(schema.fields.owner.required, true);
        assert.equal(schema.fields.stage.required, false);
    });

    test('relation field stores target type', () => {
        registerSchemaNode('s', 'target: deal\nfields:\n  owner:\n    type: relation\n    target: contact');
        const schema = getSchema('deal');
        assert.equal(schema.fields.owner.target, 'contact');
    });

    test('getSchemaTargets returns Set of all target types', () => {
        registerSchemaNode('s1', 'target: character\n');
        registerSchemaNode('s2', 'target: mission\n');
        const targets = getSchemaTargets();
        assert.ok(targets.has('character'));
        assert.ok(targets.has('mission'));
    });

    test('hasSchema returns false for unregistered type', () => {
        assert.equal(hasSchema('unknown'), false);
    });

    test('getSchema returns null for unregistered type', () => {
        assert.equal(getSchema('nobody'), null);
    });

    test('duplicate schema — first writer wins', () => {
        registerSchemaNode('schema-char-v1', 'target: character\nfields:\n  name:\n    type: string');
        registerSchemaNode('schema-char-v2', 'target: character\nfields:\n  alias:\n    type: string');
        const schema = getSchema('character');
        assert.equal(schema.sourceId, 'schema-char-v1');
        assert.ok('name' in schema.fields);
    });

    test('duplicate schemas are tracked in getDuplicateSchemas', () => {
        registerSchemaNode('s1', 'target: contact\n');
        registerSchemaNode('s2', 'target: contact\n');
        const dupes = getDuplicateSchemas();
        assert.ok(dupes.has('contact'));
        assert.ok(dupes.get('contact').includes('s1'));
        assert.ok(dupes.get('contact').includes('s2'));
    });

    test('schema with no target field is silently skipped', () => {
        registerSchemaNode('s', 'type: schema\nfields:\n  name:\n    type: string');
        assert.equal(getSchemaStats().schemas, 0);
    });

    test('schema with malformed YAML is silently skipped', () => {
        assert.doesNotThrow(() => registerSchemaNode('s', '{ bad yaml ::'));
        assert.equal(getSchemaStats().schemas, 0);
    });

    test('clearSchemaRegistry removes all schemas', () => {
        registerSchemaNode('s', 'target: character\n');
        clearSchemaRegistry();
        assert.equal(hasSchema('character'), false);
        assert.equal(getSchemaStats().schemas, 0);
    });
});
