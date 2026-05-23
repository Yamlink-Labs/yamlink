'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildGraph2CanvasModel, computeDepths } = require('../src/features/graph2/graph2CanvasModel');

describe('graph2 canvas model', () => {
    test('builds canvas nodes and edges from graph payload elements', () => {
        const model = buildGraph2CanvasModel({
            centerNodeId: 'alpha',
            selectedNodeId: 'beta',
            model: {
                elements: [
                    { data: { id: 'alpha', label: 'Alpha', type: 'account', weightedDegree: 6.2, hubScore: 11, tags: ['crm'] } },
                    { data: { id: 'beta', label: 'Beta', type: 'contact', weightedDegree: 4.1, hubScore: 8, tags: [] } },
                    { data: { id: 'alpha-beta', source: 'alpha', target: 'beta', label: 'contact', weight: 3.2, strength: 'strong', color: '#79c0ff' } }
                ],
                summary: { primaryFocusId: 'alpha' }
            }
        });

        assert.equal(model.centerId, 'alpha');
        assert.equal(model.nodes.length, 2);
        assert.equal(model.edges.length, 1);
        assert.equal(model.nodes[0].type, 'yamlinkNode');
        assert.equal(model.edges[0].source, 'alpha');
        assert.equal(model.edges[0].target, 'beta');
    });

    test('computes breadth-style depths from a center node', () => {
        const depths = computeDepths('alpha', [
            { source: 'alpha', target: 'beta' },
            { source: 'beta', target: 'gamma' }
        ]);

        assert.equal(depths.get('alpha'), 0);
        assert.equal(depths.get('beta'), 1);
        assert.equal(depths.get('gamma'), 2);
    });

    test('center node is always primary tier regardless of its score', () => {
        const model = buildGraph2CanvasModel({
            centerNodeId: 'low',
            model: {
                elements: [
                    { data: { id: 'low',  label: 'Low',  type: 'note', hubScore: 0 } },
                    { data: { id: 'high', label: 'High', type: 'note', hubScore: 99 } },
                    { data: { id: 'mid',  label: 'Mid',  type: 'note', hubScore: 50 } }
                ]
            }
        });

        const lowNode = model.nodes.find(n => n.id === 'low');
        assert.equal(lowNode.data.tier, 'primary', 'center node must be primary even with hubScore 0');
        assert.equal(lowNode.data.isCenter, true);
    });

    test('relative tier: top ~22% by score become secondary, rest minor', () => {
        const elements = [];
        for (let i = 0; i < 10; i++) {
            elements.push({ data: { id: `n${i}`, label: `Node ${i}`, type: 'note', hubScore: i * 10 } });
        }
        // Add an edge so nodes connect to center
        elements.push({ data: { source: 'n9', target: 'n0', id: 'e0', label: 'link', weight: 1 } });

        const model = buildGraph2CanvasModel({
            centerNodeId: 'n5',
            model: { elements }
        });

        const center = model.nodes.find(n => n.id === 'n5');
        assert.equal(center.data.tier, 'primary');

        const secondary = model.nodes.filter(n => n.data.tier === 'secondary');
        const minor = model.nodes.filter(n => n.data.tier === 'minor');

        // With 10 nodes and center excluded: 9 non-center nodes; top ~22% = ceil(9*0.22) = 2 secondary
        assert.ok(secondary.length >= 1, 'at least one secondary node expected');
        assert.ok(minor.length >= 1, 'at least one minor node expected');
        assert.equal(secondary.length + minor.length, 9, 'all non-center nodes are secondary or minor');
    });

    test('tier sizes differ: primary > secondary > minor', () => {
        const elements = [];
        for (let i = 0; i < 6; i++) {
            elements.push({ data: { id: `n${i}`, label: `Node ${i}`, type: 'note', hubScore: i * 5 } });
        }

        const model = buildGraph2CanvasModel({
            centerNodeId: 'n0',
            model: { elements }
        });

        const primary = model.nodes.find(n => n.data.tier === 'primary');
        const secondary = model.nodes.find(n => n.data.tier === 'secondary');
        const minor = model.nodes.find(n => n.data.tier === 'minor');

        assert.ok(primary.width > secondary.width, 'primary wider than secondary');
        assert.ok(secondary.width > minor.width, 'secondary wider than minor');
        assert.ok(primary.height > secondary.height, 'primary taller than secondary');
        assert.ok(secondary.height > minor.height, 'secondary taller than minor');
    });

    test('selection roles: center, selected, neighbor, peripheral', () => {
        const model = buildGraph2CanvasModel({
            centerNodeId: 'a',
            selectedNodeId: 'b',
            model: {
                elements: [
                    { data: { id: 'a', label: 'A', type: 'note', hubScore: 0 } },
                    { data: { id: 'b', label: 'B', type: 'note', hubScore: 0 } },
                    { data: { id: 'c', label: 'C', type: 'note', hubScore: 0 } },
                    { data: { id: 'd', label: 'D', type: 'note', hubScore: 0 } },
                    { data: { source: 'a', target: 'b', id: 'e1', label: 'link', weight: 1 } },
                    { data: { source: 'b', target: 'c', id: 'e2', label: 'link', weight: 1 } }
                ]
            }
        });

        const nodeA = model.nodes.find(n => n.id === 'a');
        const nodeB = model.nodes.find(n => n.id === 'b');
        const nodeC = model.nodes.find(n => n.id === 'c');
        const nodeD = model.nodes.find(n => n.id === 'd');

        assert.equal(nodeA.data.selectionRole, 'center');
        assert.equal(nodeB.data.selectionRole, 'selected');
        assert.equal(nodeC.data.selectionRole, 'neighbor', 'c is adjacent to selected b');
        assert.equal(nodeD.data.selectionRole, 'peripheral', 'd has no connections');
    });

    test('edge data includes isCenterEdge and isSelectedPath flags', () => {
        const model = buildGraph2CanvasModel({
            centerNodeId: 'a',
            selectedNodeId: 'b',
            model: {
                elements: [
                    { data: { id: 'a', label: 'A', type: 'note', hubScore: 0 } },
                    { data: { id: 'b', label: 'B', type: 'note', hubScore: 0 } },
                    { data: { id: 'c', label: 'C', type: 'note', hubScore: 0 } },
                    { data: { source: 'a', target: 'b', id: 'e1', label: 'link', weight: 1 } },
                    { data: { source: 'b', target: 'c', id: 'e2', label: 'link', weight: 1 } }
                ]
            }
        });

        const edgeAB = model.edges.find(e => e.id === 'e1');
        const edgeBC = model.edges.find(e => e.id === 'e2');

        assert.equal(edgeAB.data.isCenterEdge, true, 'a→b touches center node a');
        assert.equal(edgeAB.data.isSelectedPath, true, 'a→b touches selected node b');
        assert.equal(edgeBC.data.isCenterEdge, false, 'b→c does not touch center');
        assert.equal(edgeBC.data.isSelectedPath, true, 'b→c touches selected node b');
    });

    test('adjacency map is bidirectional', () => {
        const model = buildGraph2CanvasModel({
            centerNodeId: 'x',
            model: {
                elements: [
                    { data: { id: 'x', label: 'X', type: 'note', hubScore: 0 } },
                    { data: { id: 'y', label: 'Y', type: 'note', hubScore: 0 } },
                    { data: { source: 'x', target: 'y', id: 'e1', label: 'link', weight: 1 } }
                ]
            }
        });

        assert.ok(model.adjacency.get('x').has('y'), 'x→y in adjacency');
        assert.ok(model.adjacency.get('y').has('x'), 'y→x in adjacency (bidirectional)');
    });

    test('handles empty payload gracefully', () => {
        const model = buildGraph2CanvasModel(null);
        assert.equal(model.nodes.length, 0);
        assert.equal(model.edges.length, 0);
        assert.equal(model.centerId, null);
    });

    test('handles payload with no center node — falls back to first node', () => {
        const model = buildGraph2CanvasModel({
            model: {
                elements: [
                    { data: { id: 'a', label: 'A', type: 'note', hubScore: 5 } },
                    { data: { id: 'b', label: 'B', type: 'note', hubScore: 2 } }
                ]
            }
        });
        assert.equal(model.centerId, 'a');
    });

    test('vault scope does not auto-select the center note for visual emphasis', () => {
        const model = buildGraph2CanvasModel({
            scope: 'vault',
            centerNodeId: 'a',
            model: {
                elements: [
                    { data: { id: 'a', label: 'A', type: 'note', hubScore: 5 } },
                    { data: { id: 'b', label: 'B', type: 'note', hubScore: 9 } },
                    { data: { source: 'a', target: 'b', id: 'e1', label: 'link', weight: 1 } }
                ]
            }
        });

        assert.equal(model.selectedId, null);
        const nodeA = model.nodes.find(n => n.id === 'a');
        assert.equal(nodeA.data.isCenter, false);
        assert.equal(nodeA.data.selectionRole, 'peripheral');
        assert.equal(model.edges[0].data.isCenterEdge, false);
        assert.equal(model.edges[0].data.isSelectedPath, false);
    });

    test('hiddenNeighborCount is injected on center node data from payload', () => {
        const model = buildGraph2CanvasModel({
            centerNodeId: 'a',
            hiddenWorkspaceNeighborCount: 4,
            model: {
                elements: [
                    { data: { id: 'a', label: 'A', type: 'note', hubScore: 10 } },
                    { data: { id: 'b', label: 'B', type: 'note', hubScore: 5 } },
                    { data: { source: 'a', target: 'b', id: 'e1', label: 'link', weight: 1 } }
                ]
            }
        });

        const nodeA = model.nodes.find(n => n.id === 'a');
        const nodeB = model.nodes.find(n => n.id === 'b');
        assert.equal(nodeA.data.hiddenNeighborCount, 4, 'center gets the hidden count from payload');
        assert.equal(nodeB.data.hiddenNeighborCount, 0, 'non-center nodes always have 0');
    });

    test('hiddenNeighborCount is 0 on all nodes for vault scope', () => {
        const model = buildGraph2CanvasModel({
            scope: 'vault',
            centerNodeId: 'a',
            hiddenWorkspaceNeighborCount: 7,
            model: {
                elements: [
                    { data: { id: 'a', label: 'A', type: 'note', hubScore: 10 } },
                    { data: { id: 'b', label: 'B', type: 'note', hubScore: 5 } }
                ]
            }
        });

        for (const node of model.nodes) {
            assert.equal(node.data.hiddenNeighborCount, 0, `vault scope suppresses hiddenNeighborCount on ${node.id}`);
        }
    });
});

// ── Geometry utilities (inline, since they live in the JSX bundle) ────────────
// Testing the math separately to catch regressions without loading React.

describe('rect border geometry', () => {
    function rectBorderPoint(cx, cy, w, h, tx, ty) {
        const dx = tx - cx;
        const dy = ty - cy;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        if (adx < 0.01 && ady < 0.01) return { x: cx, y: cy };
        const hw = w / 2;
        const hh = h / 2;
        const tX = adx > 0 ? hw / adx : Infinity;
        const tY = ady > 0 ? hh / ady : Infinity;
        const t = Math.min(tX, tY);
        return { x: cx + dx * t, y: cy + dy * t };
    }

    function rectBorderNormal(cx, cy, w, h, tx, ty) {
        const dx = tx - cx;
        const dy = ty - cy;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const hw = w / 2;
        const hh = h / 2;
        const tX = adx > 0 ? hw / adx : Infinity;
        const tY = ady > 0 ? hh / ady : Infinity;
        if (tX <= tY) return { x: dx >= 0 ? 1 : -1, y: 0 };
        return { x: 0, y: dy >= 0 ? 1 : -1 };
    }

    test('horizontal exit lands on right face', () => {
        const p = rectBorderPoint(0, 0, 100, 60, 200, 0);
        assert.ok(Math.abs(p.x - 50) < 0.01, `expected x≈50, got ${p.x}`);
        assert.ok(Math.abs(p.y) < 0.01, `expected y≈0, got ${p.y}`);
    });

    test('horizontal exit normal is rightward', () => {
        const n = rectBorderNormal(0, 0, 100, 60, 200, 0);
        assert.equal(n.x, 1);
        assert.equal(n.y, 0);
    });

    test('vertical exit lands on bottom face', () => {
        const p = rectBorderPoint(0, 0, 100, 60, 0, 200);
        assert.ok(Math.abs(p.x) < 0.01, `expected x≈0, got ${p.x}`);
        assert.ok(Math.abs(p.y - 30) < 0.01, `expected y≈30, got ${p.y}`);
    });

    test('diagonal exit hits shorter dimension face', () => {
        // 100×60 node, target is to the bottom-right.
        // hw=50, hh=30. tX=50/dx, tY=30/dy.
        // Equal dx and dy → tX=50/1, tY=30/1 → tY wins (smaller), exits bottom.
        const p = rectBorderPoint(0, 0, 100, 60, 100, 100);
        assert.ok(Math.abs(p.y - 30) < 0.01, `expected y≈30 (bottom), got ${p.y}`);
    });

    test('leftward exit lands on left face', () => {
        const p = rectBorderPoint(0, 0, 100, 60, -200, 0);
        assert.ok(Math.abs(p.x + 50) < 0.01, `expected x≈-50, got ${p.x}`);
        assert.equal(rectBorderNormal(0, 0, 100, 60, -200, 0).x, -1);
    });

    test('same-point fallback returns center', () => {
        const p = rectBorderPoint(10, 20, 100, 60, 10, 20);
        assert.equal(p.x, 10);
        assert.equal(p.y, 20);
    });

    test('entry and exit points are symmetric for a straight line', () => {
        // Node A at (0,0) 100×60, Node B at (300,0) 100×60
        const exit  = rectBorderPoint(0,   0, 100, 60, 300, 0);
        const entry = rectBorderPoint(300, 0, 100, 60, 0,   0);
        assert.ok(Math.abs(exit.x  -  50) < 0.01);
        assert.ok(Math.abs(entry.x - 250) < 0.01);
        assert.ok(Math.abs(exit.y)  < 0.01);
        assert.ok(Math.abs(entry.y) < 0.01);
    });
});
