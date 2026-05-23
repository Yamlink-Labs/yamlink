'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
    clearGraph,
    registerEdges,
    removeEdgesForSource,
    getEdges,
    getBacklinks,
    getGraphStats,
    isOrphan
} = require('../src/core/graph');

describe('graph — basic operations', () => {
    beforeEach(() => clearGraph());

    test('empty graph has zero stats', () => {
        const stats = getGraphStats();
        assert.equal(stats.nodes, 0);
        assert.equal(stats.totalEdges, 0);
        assert.equal(stats.totalBacklinks, 0);
    });

    test('registerEdges adds outbound edges', () => {
        registerEdges('rico', [
            { field: 'unit', targetId: 'roughnecks' },
            { field: 'mentor', targetId: 'rasczak' }
        ]);
        const edges = getEdges('rico');
        assert.equal(edges.length, 2);
        assert.ok(edges.some(e => e.field === 'unit' && e.targetId === 'roughnecks'));
        assert.ok(edges.some(e => e.field === 'mentor' && e.targetId === 'rasczak'));
    });

    test('registerEdges builds inbound edges on targets', () => {
        registerEdges('rico', [{ field: 'unit', targetId: 'roughnecks' }]);
        const backlinks = getBacklinks('roughnecks');
        assert.equal(backlinks.length, 1);
        assert.equal(backlinks[0].field, 'unit');
        assert.equal(backlinks[0].sourceId, 'rico');
    });

    test('multiple sources pointing to same target accumulate backlinks', () => {
        registerEdges('rico',   [{ field: 'unit', targetId: 'roughnecks' }]);
        registerEdges('carmen', [{ field: 'unit', targetId: 'roughnecks' }]);
        const backlinks = getBacklinks('roughnecks');
        assert.equal(backlinks.length, 2);
    });

    test('getEdges returns empty array for unknown node', () => {
        assert.deepEqual(getEdges('nobody'), []);
    });

    test('getBacklinks returns empty array for node with no inbound', () => {
        registerEdges('rico', [{ field: 'unit', targetId: 'roughnecks' }]);
        assert.deepEqual(getBacklinks('rico'), []);
    });

    test('isOrphan returns true when node has no edges at all', () => {
        assert.equal(isOrphan('lonely'), true);
    });

    test('isOrphan returns false when node has outbound edges', () => {
        registerEdges('rico', [{ field: 'unit', targetId: 'roughnecks' }]);
        assert.equal(isOrphan('rico'), false);
    });

    test('isOrphan returns false when node has only inbound edges', () => {
        registerEdges('rico', [{ field: 'unit', targetId: 'roughnecks' }]);
        assert.equal(isOrphan('roughnecks'), false);
    });

    test('getGraphStats counts nodes and edges correctly', () => {
        registerEdges('rico',   [{ field: 'unit', targetId: 'roughnecks' }, { field: 'friend', targetId: 'carmen' }]);
        registerEdges('carmen', [{ field: 'unit', targetId: 'roughnecks' }]);
        const stats = getGraphStats();
        assert.equal(stats.nodes, 2);
        assert.equal(stats.totalEdges, 3);
        assert.equal(stats.totalBacklinks, 2); // roughnecks (2 sources), carmen (1 source) = 2 target nodes with inbound
    });

    test('registerEdges with empty array does not add a node entry', () => {
        registerEdges('rico', []);
        assert.deepEqual(getEdges('rico'), []);
        assert.equal(getGraphStats().nodes, 0);
    });

    test('clearGraph removes all edges and backlinks', () => {
        registerEdges('rico', [{ field: 'unit', targetId: 'roughnecks' }]);
        clearGraph();
        assert.deepEqual(getEdges('rico'), []);
        assert.deepEqual(getBacklinks('roughnecks'), []);
        assert.equal(getGraphStats().totalEdges, 0);
    });
});

describe('graph — removeEdgesForSource', () => {
    beforeEach(() => clearGraph());

    test('removeEdgesForSource clears outbound edges for that node', () => {
        registerEdges('rico', [{ field: 'unit', targetId: 'roughnecks' }]);
        removeEdgesForSource('rico');
        assert.deepEqual(getEdges('rico'), []);
    });

    test('removeEdgesForSource cleans up backlinks on targets', () => {
        registerEdges('rico', [{ field: 'unit', targetId: 'roughnecks' }]);
        removeEdgesForSource('rico');
        assert.deepEqual(getBacklinks('roughnecks'), []);
    });

    test('removeEdgesForSource only removes the specified source, leaves others intact', () => {
        registerEdges('rico',   [{ field: 'unit', targetId: 'roughnecks' }]);
        registerEdges('carmen', [{ field: 'unit', targetId: 'roughnecks' }]);
        removeEdgesForSource('rico');
        const backlinks = getBacklinks('roughnecks');
        assert.equal(backlinks.length, 1);
        assert.equal(backlinks[0].sourceId, 'carmen');
    });

    test('removeEdgesForSource on unknown node is a no-op', () => {
        assert.doesNotThrow(() => removeEdgesForSource('nobody'));
    });

    test('re-registering after remove produces correct state', () => {
        registerEdges('rico', [{ field: 'unit', targetId: 'roughnecks' }]);
        removeEdgesForSource('rico');
        registerEdges('rico', [{ field: 'unit', targetId: 'roughnecks' }, { field: 'friend', targetId: 'carmen' }]);
        assert.equal(getEdges('rico').length, 2);
        assert.equal(getBacklinks('roughnecks').length, 1);
    });
});
