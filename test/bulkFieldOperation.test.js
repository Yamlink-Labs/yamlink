'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    toWikilink,
    wikilinkTarget,
    valuesMatchRelation,
    pickOperation,
    buildFieldOperation,
    operationFromApiFieldValue
} = require('../src/core/bulkFieldOperation');

describe('bulkFieldOperation — shared core (CLI bulk-set, API bulk update, VS Code multi-select all read this)', () => {

    test('toWikilink wraps a bare id, leaves an already-bracketed one alone', () => {
        assert.equal(toWikilink('roughnecks'), '[[roughnecks]]');
        assert.equal(toWikilink('[[roughnecks]]'), '[[roughnecks]]');
    });

    test('wikilinkTarget strips brackets and alias/anchor/block suffixes', () => {
        assert.equal(wikilinkTarget('[[roughnecks]]'), 'roughnecks');
        assert.equal(wikilinkTarget('[[roughnecks|Roughnecks]]'), 'roughnecks');
        assert.equal(wikilinkTarget('roughnecks'), 'roughnecks');
    });

    test('valuesMatchRelation compares by target, not raw string', () => {
        assert.equal(valuesMatchRelation('[[roughnecks]]', 'roughnecks'), true);
        assert.equal(valuesMatchRelation('[[roughnecks|Roughnecks]]', '[[roughnecks]]'), true);
        assert.equal(valuesMatchRelation('[[roughnecks]]', '[[alpha]]'), false);
    });

    test('pickOperation requires exactly one of value/add/clear', () => {
        assert.equal(pickOperation({ value: 'x', add: null, clear: false }), 'value');
        assert.equal(pickOperation({ value: null, add: 'x', clear: false }), 'add');
        assert.equal(pickOperation({ value: null, add: null, clear: true }), 'clear');
        assert.equal(pickOperation({ value: 'x', add: 'y', clear: false }), null);
        assert.equal(pickOperation({ value: null, add: null, clear: false }), null);
    });

    test('buildFieldOperation "value" mode trims whitespace before comparing and writing', () => {
        // Regression: the value branch used to skip trim() entirely (String(rawValue)
        // with no .trim()), unlike the old writeFieldSync it replaced — meaning a
        // padded API/CLI input would report an untrimmed oldValue/newValue in the
        // mutation event and the "changed" comparison, even though the actual
        // written file content ends up trimmed via YAML serialization either way.
        const content = '---\nid: a\ntype: contact\nstatus: old\n---\n';
        const result = buildFieldOperation(content, 'status', 'value', '  active  ');
        assert.equal(result.newValue, 'active');
        assert.match(result.nextContent, /status: active/);
    });

    test('buildFieldOperation "value" mode reports changed:false when trimmed input matches the current value', () => {
        const content = '---\nid: a\ntype: contact\nstatus: active\n---\n';
        const result = buildFieldOperation(content, 'status', 'value', '  active  ');
        assert.equal(result.changed, false);
    });

    test('buildFieldOperation "add" mode creates a list, is idempotent, and rejects a scalar field', () => {
        const fresh = buildFieldOperation('---\nid: a\ntype: mission\n---\n', 'unit', 'add', 'roughnecks');
        assert.deepEqual(fresh.newValue, ['[[roughnecks]]']);

        const already = '---\nid: a\ntype: mission\nunit:\n  - "[[roughnecks]]"\n---\n';
        const dup = buildFieldOperation(already, 'unit', 'add', 'roughnecks');
        assert.equal(dup.changed, false);

        const scalar = '---\nid: a\ntype: mission\nstatus: active\n---\n';
        assert.throws(() => buildFieldOperation(scalar, 'status', 'add', 'roughnecks'), /scalar value/);
    });

    test('buildFieldOperation "clear" mode removes the field', () => {
        const content = '---\nid: a\ntype: contact\nstatus: active\n---\n';
        const result = buildFieldOperation(content, 'status', 'clear', null);
        assert.equal(result.newValue, null);
        assert.doesNotMatch(result.nextContent, /status:/);
    });

    test('buildFieldOperation refuses to touch id', () => {
        assert.throws(() => buildFieldOperation('---\nid: a\ntype: contact\n---\n', 'id', 'value', 'b'), /rename/);
    });

    test('operationFromApiFieldValue maps { add } to add mode, empty/null to clear, anything else to value', () => {
        assert.deepEqual(operationFromApiFieldValue({ add: 'roughnecks' }), { operation: 'add', value: 'roughnecks' });
        assert.deepEqual(operationFromApiFieldValue(null), { operation: 'clear', value: null });
        assert.deepEqual(operationFromApiFieldValue(''), { operation: 'clear', value: null });
        assert.deepEqual(operationFromApiFieldValue('active'), { operation: 'value', value: 'active' });
    });

});
