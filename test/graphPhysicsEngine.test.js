'use strict';

// Tests for the single canonical x-graph force layout (src/features/graph/
// graphPhysicsEngine.js), shared by the Graph Workspace panel, the graph
// sidebar, and Conduit's terminal graph. No existing test file covered this
// module before — these were added alongside a real, user-reported bug fix
// (dragStart's reheat + dragEnd's no-op combining to make a single drag
// visibly "vibrate" the whole graph for several seconds, confirmed and
// reproduced before being fixed).
//
// run()/dragStart()/dragEnd() are driven by requestAnimationFrame/
// cancelAnimationFrame, which don't exist in Node — a manual, queue-based
// stub replaces them so tests can deterministically control exactly how
// many animation frames have elapsed (pumpFrames), including interleaving a
// dragEnd() call between frames, which a real browser's timing never lets a
// test do reliably.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let frameQueue = [];
function rafStub(fn) {
    frameQueue.push(fn);
    return frameQueue.length;
}
function cafStub() { /* frames are only ever consumed via pumpFrames below */ }

/** Runs queued animation frames one at a time, up to `maxFrames`, stopping early once the queue empties (the layout settled). @returns {number} frames actually run */
function pumpFrames(maxFrames = 3000) {
    let ran = 0;
    while (frameQueue.length && ran < maxFrames) {
        const due = frameQueue;
        frameQueue = [];
        for (const fn of due) fn();
        ran++;
    }
    return ran;
}

let SimpleLayout;

describe('graph force layout (SimpleLayout) — drag reheat', () => {
    beforeEach(() => {
        frameQueue = [];
        global.requestAnimationFrame = rafStub;
        global.cancelAnimationFrame = cafStub;
        delete require.cache[require.resolve('../src/features/graph/graphPhysicsEngine')];
        ({ SimpleLayout } = require('../src/features/graph/graphPhysicsEngine'));
    });

    afterEach(() => {
        delete global.requestAnimationFrame;
        delete global.cancelAnimationFrame;
    });

    /** A small hub-and-spoke graph: n0 connects to every other node. */
    function starGraph(count = 20) {
        const nodes = [];
        const edges = [];
        for (let i = 0; i < count; i++) nodes.push({ id: `n${i}`, group: 'default', weight: 0.3, edges: [] });
        for (let i = 1; i < count; i++) edges.push({ source: 'n0', target: `n${i}` });
        return { nodes, edges };
    }

    test('a quick drag + immediate release settles in well under a second of frames, not several seconds', () => {
        const { nodes, edges } = starGraph();
        const layout = new SimpleLayout(() => {}, () => {});
        layout.settleSync(nodes, edges); // reach a resting state, like a graph that already finished loading

        layout.dragStart('n1');
        layout.dragEnd('n1');
        const frames = pumpFrames();

        // Before the fix this was 134 frames (~2.2s at 60fps) for this exact
        // scenario, confirmed by reverting the fix and re-running this same
        // measurement. A real, larger vault's graph showed an even longer
        // tail (the user's own report: "~4 seconds"). 90 frames (1.5s) is a
        // generous ceiling — comfortably above the fixed behavior's actual
        // ~31 frames, but nowhere near the old multi-second tail.
        assert.ok(frames < 90, `expected the settle tail to be short after a quick release, got ${frames} frames`);
    });

    test('dragStart never reheats past the quality tier\'s own prewarmAlpha ceiling', () => {
        const { nodes, edges } = starGraph();
        const layout = new SimpleLayout(() => {}, () => {});
        layout.settleSync(nodes, edges);

        layout.dragStart('n1');
        // The very first frame already applied one decay step
        // (alpha *= alphaDecay) before this is observable, so the ceiling
        // check allows for exactly that one step rather than the raw
        // pre-decay value.
        assert.ok(layout._alpha <= layout._quality.prewarmAlpha, `reheat exceeded the tier's prewarmAlpha ceiling: ${layout._alpha} > ${layout._quality.prewarmAlpha}`);
    });

    test('an uninterrupted drag (never released) still settles on its own — reheating does not create a permanent animation loop', () => {
        const { nodes, edges } = starGraph();
        const layout = new SimpleLayout(() => {}, () => {});
        layout.settleSync(nodes, edges);

        layout.dragStart('n1');
        const frames = pumpFrames();
        assert.ok(frames > 0, 'expected the reheated run() loop to actually tick at least once');
        assert.ok(frames < 3000, 'expected the loop to settle on its own rather than running forever');
        assert.equal(frameQueue.length, 0, 'no frame should remain scheduled once settled');
    });

    test('dragEnd leaves alpha unchanged if it is already below the clamp (never re-heats on release)', () => {
        const { nodes, edges } = starGraph();
        const layout = new SimpleLayout(() => {}, () => {});
        layout.settleSync(nodes, edges);
        const restingAlpha = layout._alpha;
        layout.dragEnd('n1'); // no prior dragStart — should be a pure clamp-down, never up
        assert.ok(layout._alpha <= restingAlpha);
    });

    test('a dropped node stays exactly where placed — dragEnd does not unpin it', () => {
        const { nodes, edges } = starGraph();
        const layout = new SimpleLayout(() => {}, () => {});
        layout.settleSync(nodes, edges);

        layout.dragStart('n1');
        layout.drag('n1', 500, 500);
        layout.dragEnd('n1');
        pumpFrames();

        const i = layout._idx.get('n1');
        const node = layout._nodes[i];
        assert.equal(node.x, 500);
        assert.equal(node.y, 500);
    });

    test('dragging a node only moves it and its direct neighbors — a real, reported follow-up bug: capping the reheat alpha (above) was not enough on its own, since every force loop still applied to every node whenever alpha > 0. A leaf node two hops away must stay exactly at rest.', () => {
        // n0 is the hub, connected to every leaf — n1..n19 are NOT directly
        // connected to each other, only to n0. Dragging n5 should move n5
        // itself and its one direct neighbor (n0), but n1 (reachable from
        // n5 only via n0, two hops away) must not move at all.
        const { nodes, edges } = starGraph();
        const layout = new SimpleLayout(() => {}, () => {});
        layout.settleSync(nodes, edges);

        const n1Before = { ...layout._nodes[layout._idx.get('n1')] };

        layout.dragStart('n5');
        layout.drag('n5', 900, 900);
        pumpFrames(1);

        const n1After = layout._nodes[layout._idx.get('n1')];
        assert.equal(n1After.x, n1Before.x, 'a node two hops from the drag must not move on x');
        assert.equal(n1After.y, n1Before.y, 'a node two hops from the drag must not move on y');
        assert.equal(n1After.vx, 0);
        assert.equal(n1After.vy, 0);

        // The direct neighbor (the hub, n0) SHOULD respond — that's the
        // actual point of reheating on drag.
        const hub = layout._nodes[layout._idx.get('n0')];
        assert.ok(hub.vx !== 0 || hub.vy !== 0, 'the dragged node\'s direct neighbor should still visibly respond');
    });

    test('_dragAffected is reset to null on a fresh init() — a full graph rebuild is never accidentally scoped by stale drag state from a previous note', () => {
        const { nodes, edges } = starGraph();
        const layout = new SimpleLayout(() => {}, () => {});
        layout.settleSync(nodes, edges);
        layout.dragStart('n1');
        assert.ok(layout._dragAffected instanceof Set);
        layout.settleSync(nodes, edges); // calls init() internally
        assert.equal(layout._dragAffected, null);
    });
});

describe('graph force layout (SimpleLayout) — cluster-anchor ring, and the removed per-node orbit-snap force', () => {
    beforeEach(() => {
        frameQueue = [];
        global.requestAnimationFrame = rafStub;
        global.cancelAnimationFrame = cafStub;
        delete require.cache[require.resolve('../src/features/graph/graphPhysicsEngine')];
        ({ SimpleLayout } = require('../src/features/graph/graphPhysicsEngine'));
    });

    afterEach(() => {
        delete global.requestAnimationFrame;
        delete global.cancelAnimationFrame;
    });

    test('non-primary cluster anchors are placed on a ring around the origin, not scattered freely', () => {
        // Enough distinct, cross-connected hub nodes to force multiple clusters
        // (see _buildGraph: the clusterCount for a small vault is derived from
        // sqrt(node count), so this needs a reasonably sized, multi-hub graph).
        const nodes = [];
        const edges = [];
        const hubCount = 6;
        for (let h = 0; h < hubCount; h++) {
            nodes.push({ id: `hub${h}`, group: 'default', weight: 1, edges: [] });
            for (let m = 0; m < 10; m++) {
                const id = `hub${h}-m${m}`;
                nodes.push({ id, group: 'default', weight: 0.2, edges: [] });
                edges.push({ source: `hub${h}`, target: id });
            }
        }
        const layout = new SimpleLayout(() => {}, () => {});
        layout.settleSync(nodes, edges);

        const anchors = [...layout._clusterAnchors.values()];
        assert.ok(anchors.length >= 2, 'expected more than one cluster anchor for this multi-hub graph');
        const primary = anchors[0];
        assert.equal(primary.x, 0);
        assert.equal(primary.y, 0);
        // Every non-primary anchor sits at some radius from the origin — by
        // construction (_buildGraph seeds them at `ringRadius * cos/sin(angle)`,
        // then a mini force-sim nudges them further while a 1% pull keeps them
        // bounded) rather than at arbitrary, unbounded positions.
        for (const anchor of anchors.slice(1)) {
            const r = Math.hypot(anchor.x, anchor.y);
            assert.ok(r > 0, 'a non-primary anchor should not sit exactly on the origin');
            assert.ok(Number.isFinite(r) && r < 100000, `anchor radius looks unbounded: ${r}`);
        }
    });

    test('anchorAngle/orbitRadius are still computed deterministically, but now seed ONLY the starting position, not an ongoing per-tick force', () => {
        const nodes = [
            { id: 'hub', group: 'default', weight: 1, edges: [] },
            { id: 'member', group: 'default', weight: 0.2, edges: [] }
        ];
        const edges = [{ source: 'hub', target: 'member' }];
        const layout = new SimpleLayout(() => {}, () => {});
        layout.settleSync(nodes, edges);

        const i = layout._idx.get('member');
        const member = layout._nodes[i];
        assert.ok(member.orbitRadius > 0, 'a non-anchor member must have a nonzero orbit radius used for its starting seed position');
        // member.anchorAngle is a fixed hash of the node id (_hashAngle), not
        // derived from live topology/similarity — same angle every settle,
        // since it only ever seeds the initial position deterministically.
        const layout2 = new SimpleLayout(() => {}, () => {});
        layout2.settleSync(nodes, edges);
        const member2 = layout2._nodes[layout2._idx.get('member')];
        assert.equal(member.anchorAngle, member2.anchorAngle, 'orbit angle should be a deterministic hash of the id, not randomized per layout instance');
    });

    test('a node\'s final settled position is NOT pulled back to its precomputed orbit-seed point — a real, reported issue where this continuous "orbit snap" force, combined with charge repulsion, visibly crystallized the whole layout into a rigid grid/lattice rather than reading as organic', () => {
        const nodes = [];
        const edges = [];
        // A denser hub-and-spoke graph gives charge repulsion + spring forces
        // real room to settle somewhere other than the orbit-seed point —
        // a 2-node graph settles too close to its only possible position to
        // prove anything either way.
        const hubCount = 4;
        for (let h = 0; h < hubCount; h++) {
            nodes.push({ id: `hub${h}`, group: 'default', weight: 1, edges: [] });
            for (let m = 0; m < 8; m++) {
                const id = `hub${h}-m${m}`;
                nodes.push({ id, group: 'default', weight: 0.2, edges: [] });
                edges.push({ source: `hub${h}`, target: id });
                // Cross-links so members don't just settle in isolation.
                if (m > 0) edges.push({ source: `hub${h}-m${m - 1}`, target: id });
            }
        }
        const layout = new SimpleLayout(() => {}, () => {});
        const pos = layout.settleSync(nodes, edges);

        let maxDistFromOrbitSeed = 0;
        for (const id of Object.keys(pos)) {
            const node = layout._nodes[layout._idx.get(id)];
            if (node.id === node.clusterId) continue; // the anchor itself always has orbitRadius 0
            const anchor = layout._clusterAnchors.get(node.clusterId) || { x: 0, y: 0 };
            const seedX = anchor.x + Math.cos(node.anchorAngle) * node.orbitRadius;
            const seedY = anchor.y + Math.sin(node.anchorAngle) * node.orbitRadius;
            const dist = Math.hypot(pos[id].x - seedX, pos[id].y - seedY);
            if (dist > maxDistFromOrbitSeed) maxDistFromOrbitSeed = dist;
        }
        // If the old per-tick orbit-snap force were still active, every node
        // would settle close to its own seed point by construction. Asserting
        // real drift away from it proves the force has no ongoing effect —
        // final rest position is driven by actual repulsion/springs/anchor
        // pull instead.
        assert.ok(maxDistFromOrbitSeed > 20, `expected real drift away from the orbit-seed point, got max ${maxDistFromOrbitSeed.toFixed(2)}`);
    });
});
