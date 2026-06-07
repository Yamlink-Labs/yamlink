/**
 * InlineLayout — runs d3-force on the main thread (no Web Worker).
 * Identical physics to layout-worker-src.js but runs via d3's built-in
 * requestAnimationFrame timer. Zero CORS issues, works on file://.
 *
 * API mirrors LayoutWorker so createGraph() can swap them transparently.
 */

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from 'd3-force';

export class InlineLayout {
  constructor() {
    this._onPositionsCb = null;
    this._onSettledCb   = null;
    this._simulation    = null;
    this._nodes         = [];
  }

  onPositions(cb) { this._onPositionsCb = cb; return this; }
  onSettled(cb)   { this._onSettledCb   = cb; return this; }

  init(nodeData, edgeData) {
    if (this._simulation) this._simulation.stop();

    // Same semantic scatter as the worker
    const groups     = [...new Set(nodeData.map(n => n.group))];
    const groupAngle = new Map(groups.map((g, i) => [g, (i / groups.length) * Math.PI * 2]));

    this._nodes = nodeData.map(n => {
      const angle = groupAngle.get(n.group) ?? 0;
      const r = 200 + Math.random() * 80;
      return {
        ...n,
        x:  Math.cos(angle) * r + (Math.random() - 0.5) * 60,
        y:  Math.sin(angle) * r + (Math.random() - 0.5) * 60,
        vx: 0,
        vy: 0,
      };
    });

    const edges = edgeData.map(e => ({ ...e }));

    const linkForce = forceLink(edges)
      .id(d => d.id)
      .distance(d => d.strength === 'strong' ? 60 : d.strength === 'weak' ? 180 : 110)
      .strength(d => d.strength === 'strong' ? 0.7 : d.strength === 'weak' ? 0.08 : 0.35);

    this._simulation = forceSimulation(this._nodes)
      .force('link',    linkForce)
      .force('charge',  forceManyBody().strength(n => -280 * (0.3 + (n.weight ?? 0))))
      .force('center',  forceCenter(0, 0).strength(0.04))
      .force('collide', forceCollide().radius(n => 10 + (n.weight ?? 0) * 20 + 10).strength(0.7))
      .alphaDecay(0.012)
      .velocityDecay(0.38)
      .on('tick', () => this._emit())
      .on('end',  () => { this._emit(); this._onSettledCb?.(); });

    // d3-force auto-starts. Stop here; caller controls start via run().
    this._simulation.stop();
  }

  run() {
    this._simulation?.restart();
  }

  stop() {
    this._simulation?.stop();
  }

  // ── Drag API (mirrors LayoutWorker) ────────────────────────────────────────

  dragStart(id) {
    if (!this._simulation) return;
    this._simulation.alphaTarget(0.3).restart();
  }

  drag(id, x, y) {
    const node = this._nodes.find(n => n.id === id);
    if (node) { node.fx = x; node.fy = y; }
  }

  dragEnd(id) {
    const node = this._nodes.find(n => n.id === id);
    if (node) { node.fx = null; node.fy = null; }
    this._simulation?.alphaTarget(0);
  }

  destroy() {
    this._simulation?.stop();
    this._simulation = null;
  }

  _emit() {
    if (!this._onPositionsCb) return;
    const positions = {};
    for (const n of this._nodes) positions[n.id] = { x: n.x, y: n.y };
    this._onPositionsCb(positions);
  }
}
