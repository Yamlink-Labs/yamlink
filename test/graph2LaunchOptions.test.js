'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    buildRunGraphOptions,
    buildRunVaultGraphOptions
} = require('../src/features/graph2/graph2LaunchOptions');

describe('graph2 launch options', () => {
    test('run graph uses neighborhood scope when a markdown note is active', () => {
        assert.deepEqual(buildRunGraphOptions(true), {
            source: 'current',
            scope: 'neighborhood',
            depth: 2,
            nodeCap: 128
        });
    });

    test('run graph stays neighborhood-scoped when no markdown note is active', () => {
        assert.deepEqual(buildRunGraphOptions(false), {
            source: 'current',
            scope: 'neighborhood',
            depth: 2,
            nodeCap: 128
        });
    });

    test('run vault graph always opens a vault-scoped workspace', () => {
        assert.deepEqual(buildRunVaultGraphOptions(), {
            source: 'current',
            scope: 'vault',
            centerNodeId: null,
            selectedNodeId: null,
            depth: 2,
            nodeCap: 200
        });
    });
});
