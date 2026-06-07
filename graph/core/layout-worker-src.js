/**
 * graph-core/layout-worker-src.js
 *
 * Runs inside a Web Worker. Owns the force simulation.
 * Receives graph data on INIT, streams position updates back to main thread.
 *
 * Phase 1: d3-force (JS, single-threaded within the worker)
 * Phase 2: WASM-accelerated physics (drop-in swap, same protocol)
 */

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
} from 'd3-force';

let simulation = null;
let nodes      = [];
let tickHandle = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function nodeRadius(n) {
  return 10 + (n.weight ?? 0) * 20;
}

function postPositions(settled = false) {
  self.postMessage({
    type:      settled ? 'SETTLED' : 'POSITIONS',
    positions: nodes.map(n => ({ id: n.id, x: n.x, y: n.y })),
    alpha:     simulation ? simulation.alpha() : 0,
  });
}

// ── Simulation ────────────────────────────────────────────────────────────────

function buildSimulation(nodeData, edgeData) {
  if (simulation) { clearTimeout(tickHandle); simulation.stop(); }

  // Scatter initial positions by group to help semantic clustering
  const groups = [...new Set(nodeData.map(n => n.group))];
  const groupAngle = new Map(groups.map((g, i) => [g, (i / groups.length) * Math.PI * 2]));

  nodes = nodeData.map(n => {
    const angle = groupAngle.get(n.group) ?? 0;
    const r = 200 + Math.random() * 80;
    return {
      ...n,
      x:  n.x ?? Math.cos(angle) * r + (Math.random() - 0.5) * 60,
      y:  n.y ?? Math.sin(angle) * r + (Math.random() - 0.5) * 60,
      vx: 0,
      vy: 0,
    };
  });

  const edges = edgeData.map(e => ({ ...e }));

  const linkForce = forceLink(edges)
    .id(d => d.id)
    .distance(d => {
      const base = d.strength === 'strong' ? 60 : d.strength === 'weak' ? 180 : 110;
      return base;
    })
    .strength(d => d.strength === 'strong' ? 0.7 : d.strength === 'weak' ? 0.08 : 0.35);

  // Semantic gravity: pull nodes toward their group centroid
  const groupCentroid = (axis) => forceX(n => {
    const angle = groupAngle.get(n.group) ?? 0;
    return axis === 'x'
      ? Math.cos(angle) * 220
      : Math.sin(angle) * 220;
  }).strength(0.04);

  simulation = forceSimulation(nodes)
    .force('link',    linkForce)
    .force('charge',  forceManyBody().strength(n => -280 * (0.3 + (n.weight ?? 0))))
    .force('center',  forceCenter(0, 0).strength(0.04))
    .force('collide', forceCollide().radius(n => nodeRadius(n) + 10).strength(0.7))
    .force('groupX',  groupCentroid('x'))
    .force('groupY',  groupCentroid('y'))
    .alphaDecay(0.012)
    .velocityDecay(0.38)
    .stop();
}

// ── Tick loop (runs in worker, posts results ~60fps) ──────────────────────────

function tick() {
  if (!simulation) return;
  simulation.tick();
  postPositions(false);

  if (simulation.alpha() > simulation.alphaMin()) {
    tickHandle = setTimeout(tick, 16);
  } else {
    postPositions(true); // settled
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = ({ data }) => {
  switch (data.type) {

    case 'INIT':
      buildSimulation(data.nodes, data.edges);
      break;

    case 'RUN':
      if (!simulation) break;
      clearTimeout(tickHandle);
      simulation.alpha(data.alpha ?? 1).restart();
      tick();
      break;

    case 'STOP':
      clearTimeout(tickHandle);
      if (simulation) simulation.stop();
      break;

    case 'TICK':
      if (simulation) { simulation.tick(); postPositions(false); }
      break;

    case 'DRAG_START': {
      if (!simulation) break;
      clearTimeout(tickHandle);
      simulation.alphaTarget(0.3);
      tick();
      break;
    }

    case 'PIN': {
      const n = nodes.find(n => n.id === data.nodeId);
      if (n) { n.fx = data.x; n.fy = data.y; }
      break;
    }

    case 'UNPIN': {
      const n = nodes.find(n => n.id === data.nodeId);
      if (n) { n.fx = null; n.fy = null; }
      if (simulation) simulation.alphaTarget(0).alpha(0.25).restart();
      clearTimeout(tickHandle);
      tick();
      break;
    }

    case 'UPDATE': {
      // Incremental add/remove without full restart
      const { added = {}, removed = {} } = data;
      if (removed.nodeIds?.length) {
        const rm = new Set(removed.nodeIds);
        nodes = nodes.filter(n => !rm.has(n.id));
        simulation.nodes(nodes);
      }
      if (added.nodes?.length) {
        for (const n of added.nodes) {
          nodes.push({ ...n, x: (Math.random() - 0.5) * 400, y: (Math.random() - 0.5) * 400, vx: 0, vy: 0 });
        }
        simulation.nodes(nodes);
        simulation.alpha(0.3).restart();
        clearTimeout(tickHandle);
        tick();
      }
      break;
    }
  }
};
