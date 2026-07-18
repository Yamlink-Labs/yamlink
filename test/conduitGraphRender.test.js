'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    buildNeighborhoodGraph,
    projectPositionsToGrid,
    resolveCollisions,
    rasterizeEdge,
    renderGraphGrid,
    placeLabels,
    applyLabels,
    assignTypeColors,
    buildSpatialGraphView
} = require('../src/conduit/graphRender');

describe('conduit graphRender — buildNeighborhoodGraph', () => {
    test('builds a node per outbound/inbound target plus the center, deduped', () => {
        const { nodes, edges } = buildNeighborhoodGraph('rico', [
            { field: 'unit', to: 'roughnecks', toType: 'unit' }
        ], [
            { field: 'commander', from: 'mission-klendathu', fromType: 'mission' }
        ]);
        assert.deepEqual(nodes.map((n) => n.id).sort(), ['mission-klendathu', 'rico', 'roughnecks']);
        assert.deepEqual(
            edges.sort((a, b) => a.source.localeCompare(b.source)),
            [
                { source: 'mission-klendathu', target: 'rico' },
                { source: 'rico', target: 'roughnecks' }
            ]
        );
    });

    test('a mutual link (same note both outbound and inbound) is deduped to one node', () => {
        const { nodes } = buildNeighborhoodGraph('rico', [
            { field: 'sees', to: 'carmen', toType: 'character' }
        ], [
            { field: 'mentions', from: 'carmen', fromType: 'character' }
        ]);
        assert.equal(nodes.filter((n) => n.id === 'carmen').length, 1);
    });

    test('ignores a self-referencing edge', () => {
        const { nodes, edges } = buildNeighborhoodGraph('rico', [
            { field: 'self', to: 'rico', toType: 'character' }
        ], []);
        assert.deepEqual(nodes.map((n) => n.id), ['rico']);
        assert.deepEqual(edges, []);
    });

    test('center node always gets the highest weight', () => {
        const { nodes } = buildNeighborhoodGraph('rico', [{ field: 'x', to: 'a' }], []);
        const center = nodes.find((n) => n.id === 'rico');
        const other = nodes.find((n) => n.id === 'a');
        assert.ok(center.weight > other.weight);
    });
});

describe('conduit graphRender — projectPositionsToGrid', () => {
    test('a single node lands at the grid center', () => {
        const result = projectPositionsToGrid({ a: { x: 10, y: -5 } }, { cols: 40, rows: 20 });
        assert.deepEqual(result.a, { row: 10, col: 20 });
    });

    test('preserves relative shape instead of independently stretching X and Y', () => {
        // A perfect square in layout space (100x100) should stay roughly
        // square-proportioned after the char-aspect correction, not stretch
        // to fill a wide-and-short grid unevenly.
        const positions = {
            tl: { x: -50, y: -50 }, tr: { x: 50, y: -50 },
            bl: { x: -50, y: 50 }, br: { x: 50, y: 50 }
        };
        const result = projectPositionsToGrid(positions, { cols: 100, rows: 100, charAspect: 0.5 });
        const width = result.tr.col - result.tl.col;
        const height = result.bl.row - result.tl.row;
        // Same physical distance in both axes of the source data — after
        // char-aspect correction, the row-span should be roughly half the
        // col-span (since rows are "taller" than columns are "wide").
        assert.ok(Math.abs(height - width / 2) <= 1, `expected height ~= width/2, got width=${width} height=${height}`);
    });

    test('clamps positions to stay within the grid bounds', () => {
        const result = projectPositionsToGrid({
            a: { x: 0, y: 0 }, b: { x: 100000, y: 100000 }
        }, { cols: 10, rows: 10 });
        for (const id of ['a', 'b']) {
            assert.ok(result[id].row >= 0 && result[id].row < 10);
            assert.ok(result[id].col >= 0 && result[id].col < 10);
        }
    });

    test('empty input produces no positions', () => {
        assert.deepEqual(projectPositionsToGrid({}, { cols: 40, rows: 20 }), {});
    });
});

describe('conduit graphRender — resolveCollisions', () => {
    test('two nodes at the identical cell get separated, not overwritten', () => {
        const { positions, overflowCount } = resolveCollisions({
            a: { row: 5, col: 5 },
            b: { row: 5, col: 5 }
        }, { cols: 20, rows: 20 });
        assert.notDeepEqual(positions.a, positions.b);
        assert.equal(overflowCount, 0);
    });

    test('a cell surrounded solid within the search radius overflows rather than looping forever', () => {
        // Fill every cell in a tiny 1x1 grid, then try to place a second node.
        const { positions, overflowCount } = resolveCollisions({
            a: { row: 0, col: 0 },
            b: { row: 0, col: 0 }
        }, { cols: 1, rows: 1, maxSearchRadius: 2 });
        assert.equal(Object.keys(positions).length, 1);
        assert.equal(overflowCount, 1);
    });

    test('no collision means positions pass through unchanged', () => {
        const { positions, overflowCount } = resolveCollisions({
            a: { row: 1, col: 1 },
            b: { row: 5, col: 8 }
        }, { cols: 20, rows: 20 });
        assert.deepEqual(positions, { a: { row: 1, col: 1 }, b: { row: 5, col: 8 } });
        assert.equal(overflowCount, 0);
    });
});

describe('conduit graphRender — rasterizeEdge', () => {
    test('a horizontal line picks the horizontal character', () => {
        const cells = rasterizeEdge({ row: 5, col: 0 }, { row: 5, col: 6 });
        assert.ok(cells.every((c) => c.char === '─'));
        assert.ok(cells.every((c) => c.row === 5));
    });

    test('a vertical line picks the vertical character', () => {
        const cells = rasterizeEdge({ row: 0, col: 5 }, { row: 6, col: 5 });
        assert.ok(cells.every((c) => c.char === '│'));
        assert.ok(cells.every((c) => c.col === 5));
    });

    test('a down-right diagonal picks the backslash character', () => {
        const cells = rasterizeEdge({ row: 0, col: 0 }, { row: 6, col: 6 });
        assert.ok(cells.every((c) => c.char === '╲'));
    });

    test('a down-left diagonal picks the forward-slash character', () => {
        const cells = rasterizeEdge({ row: 0, col: 6 }, { row: 6, col: 0 });
        assert.ok(cells.every((c) => c.char === '╱'));
    });

    test('adjacent cells (no room between endpoints) produce no intermediate cells', () => {
        assert.deepEqual(rasterizeEdge({ row: 0, col: 0 }, { row: 0, col: 1 }), []);
    });

    test('identical from/to cells produce no cells', () => {
        assert.deepEqual(rasterizeEdge({ row: 3, col: 3 }, { row: 3, col: 3 }), []);
    });
});

describe('conduit graphRender — renderGraphGrid', () => {
    test('renders an exact expected grid for a small fixed graph', () => {
        const { lines, hitMap } = renderGraphGrid({
            nodePositions: { a: { row: 0, col: 0 }, b: { row: 0, col: 4 } },
            nodeChars: { a: '◉', b: '○' },
            edges: [{ source: 'a', target: 'b' }],
            cols: 5,
            rows: 1
        });
        assert.deepEqual(lines, ['◉───○']);
        assert.deepEqual(hitMap, { '0,0': 'a', '0,4': 'b' });
    });

    test('nodes are drawn on top of edges, never occluded', () => {
        const { lines } = renderGraphGrid({
            nodePositions: { a: { row: 0, col: 0 }, b: { row: 0, col: 2 } },
            nodeChars: { a: '◉', b: '○' },
            edges: [{ source: 'a', target: 'b' }],
            cols: 3,
            rows: 1
        });
        assert.equal(lines[0][0], '◉');
        assert.equal(lines[0][2], '○');
    });

    test('an edge referencing a node with no position is skipped, not thrown', () => {
        assert.doesNotThrow(() => renderGraphGrid({
            nodePositions: { a: { row: 0, col: 0 } },
            nodeChars: { a: '◉' },
            edges: [{ source: 'a', target: 'missing' }],
            cols: 5,
            rows: 1
        }));
    });

    test('empty grid is all blank space', () => {
        const { lines } = renderGraphGrid({ nodePositions: {}, nodeChars: {}, edges: [], cols: 3, rows: 2 });
        assert.deepEqual(lines, ['   ', '   ']);
    });
});

describe('conduit graphRender — placeLabels', () => {
    test('places a label two columns right of its node by default', () => {
        const placements = placeLabels(
            { center: { row: 0, col: 0 }, a: { row: 0, col: 10 } },
            { a: 'roughnecks' },
            { centerNodeId: 'center', cols: 40, rows: 5 }
        );
        assert.deepEqual(placements.a, { row: 0, col: 12, text: 'roughnecks' });
    });

    test('never places a label for the center node — it is already named in the screen header', () => {
        const placements = placeLabels(
            { center: { row: 0, col: 5 } },
            { center: 'johnny-rico' },
            { centerNodeId: 'center', cols: 40, rows: 5 }
        );
        assert.deepEqual(placements, {});
    });

    test('falls back to the left when there is no room on the right', () => {
        const placements = placeLabels(
            { center: { row: 0, col: 0 }, a: { row: 0, col: 38 } },
            { a: 'far-right-note' },
            { centerNodeId: 'center', cols: 40, rows: 5 }
        );
        assert.equal(placements.a.row, 0);
        assert.ok(placements.a.col < 38, 'label should land to the left of the node, not overflow the grid');
    });

    test('skips a label entirely rather than overlapping another node — no corrupted, overlapping text', () => {
        // 'a' sits at the very left edge (left fallback goes out of bounds),
        // and 'b' sits immediately where 'a's right-side label would need to
        // start — vertical fallbacks are also occupied, so 'a' must be skipped.
        const placements = placeLabels(
            {
                center: { row: 2, col: 5 },
                a: { row: 2, col: 0 },
                b: { row: 2, col: 2 },
                topBlock: { row: 1, col: 0 },
                bottomBlock: { row: 3, col: 0 }
            },
            { a: 'a-note', b: 'b-note', topBlock: 't', bottomBlock: 'b' },
            { centerNodeId: 'center', cols: 20, rows: 6 }
        );
        assert.equal(placements.a, undefined, 'a should be skipped — no room on either side');
    });

    test('vertical nodes can place their label above or below instead of only left/right', () => {
        const placements = placeLabels(
            { center: { row: 5, col: 10 }, a: { row: 1, col: 10 }, blocker: { row: 1, col: 2 } },
            { a: 'top-node', blocker: 'blocker' },
            { centerNodeId: 'center', cols: 30, rows: 12 }
        );
        assert.ok(placements.a.row !== 1, 'expected vertical placement to move off the node row when horizontal space is poor');
    });

    test('long labels are truncated to maxLabelWidth', () => {
        const placements = placeLabels(
            { center: { row: 0, col: 0 }, a: { row: 0, col: 5 } },
            { a: 'a-very-long-note-identifier-that-does-not-fit' },
            { centerNodeId: 'center', cols: 60, rows: 5, maxLabelWidth: 10 }
        );
        assert.equal(placements.a.text.length, 10);
        assert.ok(placements.a.text.endsWith('…'));
    });

    test('a node placed off-grid (out of row bounds) is skipped, not thrown', () => {
        assert.doesNotThrow(() => placeLabels(
            { center: { row: 0, col: 0 }, a: { row: 99, col: 5 } },
            { a: 'ghost' },
            { centerNodeId: 'center', cols: 40, rows: 5 }
        ));
    });
});

describe('conduit graphRender — applyLabels', () => {
    test('overlays label text onto the grid without mutating the input', () => {
        const lines = ['○    ○', '      '];
        const result = applyLabels(lines, { a: { row: 0, col: 2, text: 'hi' } });
        assert.equal(result[0], '○ hi ○');
        assert.deepEqual(lines, ['○    ○', '      '], 'input lines must not be mutated');
    });

    test('a placement outside the grid bounds is silently skipped', () => {
        const lines = ['○'];
        assert.doesNotThrow(() => applyLabels(lines, { a: { row: 5, col: 0, text: 'x' } }));
    });
});

describe('conduit graphRender — buildSpatialGraphView (full pipeline smoke test)', () => {
    test('produces a rendered grid with the right dimensions and a populated hit map', () => {
        const view = buildSpatialGraphView({
            centerNodeId: 'rico',
            outbound: [{ field: 'unit', to: 'roughnecks', toType: 'unit' }],
            inbound: [{ field: 'commander', from: 'mission-klendathu', fromType: 'mission' }],
            cols: 40,
            rows: 15
        });
        assert.equal(view.lines.length, 15);
        assert.ok(view.lines.every((line) => line.length === 40));
        assert.deepEqual(new Set(Object.values(view.hitMap)), new Set(['rico', 'mission-klendathu', 'roughnecks']));
        assert.equal(view.overflowCount, 0);
    });

    test('a note with no connections at all still renders — just the center node, alone', () => {
        const view = buildSpatialGraphView({ centerNodeId: 'lonely', outbound: [], inbound: [], cols: 20, rows: 10 });
        assert.equal(Object.keys(view.hitMap).length, 1);
        assert.ok(view.lines.join('').includes('lonely'));
    });

    test('neighbor nodes get real name labels rendered directly into the grid, not just an anonymous dot', () => {
        const view = buildSpatialGraphView({
            centerNodeId: 'rico',
            outbound: [{ field: 'unit', to: 'roughnecks', toType: 'unit' }],
            inbound: [],
            cols: 40,
            rows: 10
        });
        assert.ok(view.lines.join('\n').includes('roughnecks'), 'expected the neighbor label to actually appear in the rendered grid');
        assert.equal(view.labeledCount, 1);
        assert.equal(view.unlabeledCount, 0);
    });

    test('labeledCount + unlabeledCount always accounts for every neighbor (never silently loses one)', () => {
        const outbound = Array.from({ length: 6 }, (_, i) => ({ field: 'f' + i, to: 'n' + i, toType: 'x' }));
        const view = buildSpatialGraphView({ centerNodeId: 'rico', outbound, inbound: [], cols: 30, rows: 10 });
        assert.equal(view.labeledCount + view.unlabeledCount, 6);
    });

    test('busy maps distribute visible labels and make hidden neighbors explicit', () => {
        const view = buildSpatialGraphView({
            centerNodeId: 'rico',
            outbound: [
                { field: 'unit', to: 'roughnecks', toType: 'unit' },
                { field: 'mission', to: 'mission-klendathu', toType: 'mission' },
                { field: 'body', to: 'planet-p', toType: 'mission' },
                { field: 'body', to: 'fleet', toType: 'unit' },
                { field: 'body', to: 'report', toType: 'dossier' },
                { field: 'body', to: 'briefing', toType: 'dashboard' }
            ],
            inbound: [
                { field: 'commander', from: 'carmen-ibanez', fromType: 'character' },
                { field: 'body', from: 'dizzy-flores', fromType: 'character' },
                { field: 'body', from: 'carl-jenkins', fromType: 'character' },
                { field: 'body', from: 'syntax-reference', fromType: 'dashboard' }
            ],
            cols: 60,
            rows: 20
        });
        const joined = view.lines.join('\n');
        assert.equal(view.labeledCount, 8);
        assert.equal(view.unlabeledCount, 2);
        const occupiedRows = view.lines
            .map((line, index) => /\[[1-8]\] [←→↔]/.test(line) ? index : -1)
            .filter((index) => index >= 0);
        assert.ok(new Set(occupiedRows).size > 2);
        assert.ok(joined.includes('more connections hidden'));
    });

    test('long left-side labels do not erase their own connector dot', () => {
        const view = buildSpatialGraphView({
            centerNodeId: 'rico',
            outbound: [
                { field: 'body', to: 'a-mutual-left-anchor', toType: 'character' },
                { field: 'body', to: 'b-mutual-right-anchor', toType: 'character' },
                { field: 'body', to: 'c-mutual-right-anchor', toType: 'character' },
                { field: 'body', to: 'd-mutual-right-anchor', toType: 'character' },
                { field: 'body', to: 'e-mutual-right-anchor', toType: 'character' },
                { field: 'body', to: 'f-mutual-left-anchor', toType: 'character' },
                { field: 'body', to: 'g-mutual-left-anchor', toType: 'character' },
                { field: 'body', to: 'brain-bug-intelligence', toType: 'dossier' }
            ],
            inbound: [
                { field: 'body', from: 'a-mutual-left-anchor', fromType: 'character' },
                { field: 'body', from: 'b-mutual-right-anchor', fromType: 'character' },
                { field: 'body', from: 'c-mutual-right-anchor', fromType: 'character' },
                { field: 'body', from: 'd-mutual-right-anchor', fromType: 'character' },
                { field: 'body', from: 'e-mutual-right-anchor', fromType: 'character' },
                { field: 'body', from: 'f-mutual-left-anchor', fromType: 'character' },
                { field: 'body', from: 'g-mutual-left-anchor', fromType: 'character' },
                { field: 'body', from: 'brain-bug-intelligence', fromType: 'dossier' }
            ],
            cols: 70,
            rows: 20
        });
        const labelLine = view.lines.find((line) => line.includes('brain-bug'));
        assert.ok(labelLine);
        assert.ok(labelLine.includes('●'), labelLine);
    });
});

describe('conduit graphRender — assignTypeColors', () => {
    test('gives each distinct type its own color, in first-seen order', () => {
        const colors = assignTypeColors([{ type: 'character' }, { type: 'mission' }, { type: 'character' }]);
        assert.equal(colors.size, 2);
        assert.ok(colors.get('character'));
        assert.ok(colors.get('mission'));
        assert.notEqual(colors.get('character'), colors.get('mission'));
    });

    test('records with no type are ignored, not assigned a color', () => {
        const colors = assignTypeColors([{ type: '' }, { }, { type: 'character' }]);
        assert.equal(colors.size, 1);
        assert.ok(colors.get('character'));
    });

    test('wraps around the palette once there are more distinct types than colors', () => {
        const records = Array.from({ length: 9 }, (_, i) => ({ type: 'type-' + i }));
        const colors = assignTypeColors(records);
        assert.equal(colors.size, 9);
        // 8-color palette, so the 9th type must reuse the 1st type's color.
        assert.equal(colors.get('type-8'), colors.get('type-0'));
    });

    test('empty input produces an empty map', () => {
        assert.equal(assignTypeColors([]).size, 0);
    });
});

describe('conduit graphRender — buildSpatialGraphView legend and label colors', () => {
    test('produces one legend entry per distinct connected type, each with a real color', () => {
        const view = buildSpatialGraphView({
            centerNodeId: 'rico',
            outbound: [{ field: 'unit', to: 'roughnecks', toType: 'unit' }],
            inbound: [{ field: 'commander', from: 'mission-klendathu', fromType: 'mission' }],
            cols: 70,
            rows: 20
        });
        assert.equal(view.legend.length, 2);
        const types = view.legend.map((entry) => entry.type).sort();
        assert.deepEqual(types, ['mission', 'unit']);
        assert.ok(view.legend.every((entry) => /^#[0-9a-f]{6}$/i.test(entry.color)));
    });

    test('a neighbor with no known type contributes no legend entry and no label color', () => {
        const view = buildSpatialGraphView({
            centerNodeId: 'rico',
            outbound: [{ field: 'unit', to: 'mystery-note' }],
            inbound: [],
            cols: 70,
            rows: 20
        });
        assert.equal(view.legend.length, 0);
        assert.equal(view.labelColors.length, 0);
    });

    test('every labelColors span slices out exactly the neighbor\'s own name, nothing more', () => {
        const view = buildSpatialGraphView({
            centerNodeId: 'rico',
            outbound: [{ field: 'unit', to: 'roughnecks', toType: 'unit' }],
            inbound: [{ field: 'commander', from: 'mission-klendathu', fromType: 'mission' }],
            cols: 70,
            rows: 20
        });
        assert.equal(view.labelColors.length, 2);
        for (const span of view.labelColors) {
            const line = view.lines[span.row];
            const slice = line.slice(span.col, span.col + span.length);
            // The name may be truncated with a trailing '…' when the anchor's
            // label lane is narrower than the full id — the span must still
            // be exactly the (possibly truncated) name, not the marker/index
            // prefix or anything from the evidence line below it.
            const isRoughnecks = 'roughnecks'.startsWith(slice.replace(/…$/, ''));
            const isMission = 'mission-klendathu'.startsWith(slice.replace(/…$/, ''));
            assert.ok(
                isRoughnecks || isMission,
                `expected the colored span to be exactly a (possibly truncated) neighbor name, got ${JSON.stringify(slice)}`
            );
        }
    });
});
