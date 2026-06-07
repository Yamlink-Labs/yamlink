'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    classifyScalarValue,
    resolveQueryFunctionValue,
    compareScalarValues,
    parseCondition,
    parseWhereGroup
} = require('../src/engine/queryParser');

describe('classifyScalarValue', () => {
    test('classifies integers and decimals as number', () => {
        assert.equal(classifyScalarValue('42'), 'number');
        assert.equal(classifyScalarValue('-7'), 'number');
        assert.equal(classifyScalarValue('3.14'), 'number');
    });

    test('classifies boolean literals', () => {
        assert.equal(classifyScalarValue('true'), 'boolean');
        assert.equal(classifyScalarValue('false'), 'boolean');
    });

    test('classifies ISO date strings as date', () => {
        assert.equal(classifyScalarValue('2026-05-28'), 'date');
    });

    test('classifies date function calls as date', () => {
        assert.equal(classifyScalarValue('today()'), 'date');
        assert.equal(classifyScalarValue('days-from-now(7)'), 'date');
    });

    test('classifies plain text as string', () => {
        assert.equal(classifyScalarValue('active'), 'string');
        assert.equal(classifyScalarValue(''), 'string');
    });
});

describe('resolveQueryFunctionValue', () => {
    test('returns null for non-function input', () => {
        assert.equal(resolveQueryFunctionValue('active'), null);
        assert.equal(resolveQueryFunctionValue('2026-05-28'), null);
    });

    test('today() resolves to a YYYY-MM-DD string', () => {
        const result = resolveQueryFunctionValue('today()');
        assert.ok(result);
        assert.equal(result.valueKind, 'date');
        assert.match(result.value, /^\d{4}-\d{2}-\d{2}$/);
    });

    test('days-from-now(7) resolves to a date 7 days out', () => {
        const result = resolveQueryFunctionValue('days-from-now(7)');
        assert.ok(result);
        assert.equal(result.valueKind, 'date');
        assert.match(result.value, /^\d{4}-\d{2}-\d{2}$/);
    });

    test('days-ago(3) resolves to a date in the past', () => {
        const today = resolveQueryFunctionValue('today()').value;
        const result = resolveQueryFunctionValue('days-ago(3)');
        assert.ok(result);
        assert.ok(result.value < today);
    });

    test('returns null for unknown function names', () => {
        assert.equal(resolveQueryFunctionValue('unknown()'), null);
        assert.equal(resolveQueryFunctionValue('today(extra)'), null);
    });
});

describe('compareScalarValues', () => {
    test('compares numbers numerically', () => {
        assert.ok(compareScalarValues('10', '9', 'number') > 0);
        assert.ok(compareScalarValues('2', '10', 'number') < 0);
        assert.equal(compareScalarValues('5', '5', 'number'), 0);
    });

    test('compares dates lexicographically via ISO form', () => {
        assert.ok(compareScalarValues('2026-06-01', '2026-05-28', 'date') > 0);
        assert.ok(compareScalarValues('2026-01-01', '2026-12-31', 'date') < 0);
    });

    test('compares booleans (true > false)', () => {
        assert.ok(compareScalarValues('true', 'false', 'boolean') > 0);
        assert.ok(compareScalarValues('false', 'true', 'boolean') < 0);
    });

    test('falls back to locale string compare for unknown kind', () => {
        assert.ok(compareScalarValues('b', 'a', 'string') > 0);
        assert.equal(compareScalarValues('x', 'x', 'string'), 0);
    });
});

describe('parseCondition', () => {
    test('#tag shorthand maps to __yamlink_tags contains', () => {
        const c = parseCondition('#urgent');
        assert.equal(c.field, '__yamlink_tags');
        assert.equal(c.op, 'contains');
        assert.equal(c.value, 'urgent');
        assert.equal(c.tagShorthand, true);
    });

    test('field contains "value" (quoted)', () => {
        const c = parseCondition('name contains "johnny rico"');
        assert.equal(c.field, 'name');
        assert.equal(c.op, 'contains');
        assert.equal(c.value, 'johnny rico');
    });

    test('field contains value (unquoted)', () => {
        const c = parseCondition('body contains plasma');
        assert.equal(c.field, 'body');
        assert.equal(c.op, 'contains');
        assert.equal(c.value, 'plasma');
    });

    test('field is empty', () => {
        const c = parseCondition('date is empty');
        assert.equal(c.field, 'date');
        assert.equal(c.op, 'empty');
    });

    test('field is not empty', () => {
        const c = parseCondition('owner is not empty');
        assert.equal(c.op, 'exists');
        assert.equal(c.field, 'owner');
    });

    test('field exists', () => {
        const c = parseCondition('commander exists');
        assert.equal(c.op, 'exists');
        assert.equal(c.field, 'commander');
    });

    test('field = [[relation]]', () => {
        const c = parseCondition('commander = [[lt-rasczak]]');
        assert.equal(c.op, 'eq');
        assert.equal(c.valueKind, 'relation');
        assert.equal(c.value, 'lt-rasczak');
    });

    test('field != [[relation]]', () => {
        const c = parseCondition('type != [[contact]]');
        assert.equal(c.op, 'neq');
        assert.equal(c.valueKind, 'relation');
    });

    test('comparison operators (>=, <=, >, <)', () => {
        assert.equal(parseCondition('score >= 10').op, 'gte');
        assert.equal(parseCondition('score <= 5').op, 'lte');
        assert.equal(parseCondition('score > 0').op, 'gt');
        assert.equal(parseCondition('score < 100').op, 'lt');
    });

    test('field != scalar', () => {
        const c = parseCondition('status != done');
        assert.equal(c.op, 'neq');
        assert.equal(c.field, 'status');
        assert.equal(c.value, 'done');
    });

    test('field = val1 or val2 produces in operator', () => {
        const c = parseCondition('status = active or blocked');
        assert.equal(c.op, 'in');
        assert.deepEqual(c.values, ['active', 'blocked']);
    });

    test('field = scalar (plain eq)', () => {
        const c = parseCondition('type = contact');
        assert.equal(c.op, 'eq');
        assert.equal(c.field, 'type');
        assert.equal(c.value, 'contact');
    });

    test('wildcard * field normalises to any', () => {
        const c = parseCondition('* contains rico');
        assert.equal(c.field, 'any');
        assert.equal(c.op, 'contains');
    });

    test('returns null for unrecognised input', () => {
        assert.equal(parseCondition(''), null);
        assert.equal(parseCondition('gibberish!!!'), null);
    });
});

describe('parseWhereGroup', () => {
    test('single condition returns one-element group', () => {
        const g = parseWhereGroup('type = contact');
        assert.equal(g.conditions.length, 1);
        assert.equal(g.conditions[0].op, 'eq');
    });

    test('OR expression produces multiple conditions', () => {
        const g = parseWhereGroup('status = active or status = blocked');
        assert.equal(g.conditions.length, 2);
        assert.ok(g.conditions.every(c => c.field === 'status'));
    });

    test('returns null for empty input', () => {
        assert.equal(parseWhereGroup(''), null);
        assert.equal(parseWhereGroup(null), null);
    });
});
