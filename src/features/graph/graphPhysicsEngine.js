// @ts-nocheck -- this file runs in two contexts: as a real Node module
// (Conduit's require()) and as text embedded via .toString() into a webview
// <script> tag (the two panel generators), where it needs browser globals
// (requestAnimationFrame/cancelAnimationFrame) that don't exist in this
// project's Node-only tsconfig lib. tsconfig.json's `exclude` alone doesn't
// suppress this, since Conduit's real `require()` of this file pulls it back
// in for transitive type-checking.
'use strict';

// The single canonical force-directed layout engine for every x-graph surface:
// the Graph Workspace panel and sidebar (both webview script generators —
// SimpleLayout.toString() embeds this exact source as text into their
// generated <script> tags), and Conduit's terminal graph (a real Node module,
// requires this file directly). Previously three independently hand-maintained
// copies existed (src/features/graph/xgraphClientBody.js,
// src/features/graph2/graph2SidebarXGraphScript.js, src/conduit/simpleLayout.js)
// and had already drifted: the sidebar copy was missing the containment clamp
// in _step()/_buildGraph() (satellite/low-weight nodes could drift arbitrarily
// far off-screen — a real, already-fixed-elsewhere bug), the 2200+-node quality
// tier, and drag support. This file is now the one real source; the other three
// either `require()` it directly (Conduit) or embed its `.toString()`'d source
// into a webview script (the two panels) — so there is exactly one place this
// logic can be edited, and it is mechanically impossible for a consumer to
// silently fall behind the others again.
class SimpleLayout {
  constructor(onPos, onSettled) {
    this._onPos = onPos;
    this._onSettled = onSettled;
    this._nodes = [];
    this._edges = [];
    this._idx = new Map();
    this._clusterAnchors = new Map();
    this._clusterMeta = new Map();
    this._pinned = new Set();
    // Which nodes a live drag is allowed to actually move — the dragged node
    // itself plus its direct (1-hop) neighbors — or `null` when no drag is
    // active (every other call path — init()'s own settle, run()'s initial
    // settle, time-lapse's settleSync() — is a full, unrestricted solve and
    // must never be scoped). See dragStart()'s own comment for why this
    // exists: reheating alpha alone is NOT enough to keep a drag's visible
    // effect local, since every force loop in _step() iterates every node
    // unconditionally whenever alpha > 0 — a real, reported bug, confirmed
    // directly: dragging one node moved 150 completely unrelated, untouched
    // nodes in a disconnected part of a test graph on the very first tick.
    this._dragAffected = null;
    this._raf = null;
    this._alpha = 0;
    this._iter = 0;
    this._quality = this._qualityProfile(0);
    this._lastPositions = new Map();
  }

  init(nodeData, edgeData) {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    this._alpha = 1;
    this._iter  = 0;
    this._dragAffected = null; // a fresh full-graph solve is never drag-scoped
    this._quality = this._qualityProfile(nodeData.length);
    // Minor-change fast path: if < 8% of nodes are new, previous positions are a
    // good starting point — the graph barely needs to re-settle.
    if (this._lastPositions.size > 0) {
      const newCount = nodeData.filter(n => !this._lastPositions.has(n.id)).length;
      if (newCount / nodeData.length < 0.08) {
        this._quality = Object.assign({}, this._quality, {
          prewarmTicks: Math.min(this._quality.prewarmTicks, 12),
          maxTicks: Math.min(this._quality.maxTicks, 100),
        });
      }
    }
    this._edges = edgeData;
    this._idx   = new Map(nodeData.map((n, i) => [n.id, i]));
    const graph = this._buildGraph(nodeData, edgeData);
    this._clusterAnchors = graph.clusterAnchors;
    this._clusterMeta = graph.clusterMeta;
    this._nodes = nodeData.map(n => {
      const clusterId = graph.nodeCluster.get(n.id) || n.id;
      const anchor = graph.clusterAnchors.get(clusterId) || { x: 0, y: 0 };
      const localRank = graph.clusterRank.get(n.id) || 0;
      const angle = this._hashAngle(n.id);
      const clusterSize = (graph.clusterMeta.get(clusterId) || {}).size || 1;
      const radius = n.id === clusterId
        ? 0
        : this._quality.orbitBase
          + Math.sqrt(clusterSize) * this._quality.orbitClusterScale
          + localRank * this._quality.orbitRankStep
          + (1 - (n.weight || 0)) * this._quality.orbitWeightStep;
      const prev = this._lastPositions.get(n.id);
      const seededX = anchor.x + Math.cos(angle) * radius;
      const seededY = anchor.y + Math.sin(angle) * radius;
      const usePrev = !!prev && Number.isFinite(prev.x) && Number.isFinite(prev.y);
      // `anchorAngle`/`orbitRadius` only ever seed a reasonable STARTING
      // position (above, and only when there's no remembered previous
      // position to reuse) — a one-time hash-based spread so the very first
      // frame isn't every node stacked at the origin. A real, user-reported
      // issue previously had _step() ALSO pull every node back toward this
      // exact fixed point every single tick (a rigid "orbit snap" force),
      // which — combined with charge repulsion settling into equilibrium —
      // made the layout visibly crystallize into a grid/lattice rather than
      // read as organic, the same way many similarly-repelled particles in
      // a bounded 2D space naturally pack into a regular lattice once
      // nothing else perturbs them. Removed: cluster shape/formation now
      // comes only from _step()'s anchorPull/memberPull (pull toward the
      // cluster's center point, no fixed angle) plus real charge repulsion
      // and edge springs — closer to how Obsidian's own graph view works
      // (repel + link + center, no synthetic per-node target position).
      return {
        id: n.id,
        group: n.group || n.kind || 'default',
        weight: n.weight || 0,
        clusterId,
        anchorAngle: angle,
        orbitRadius: radius,
        x: usePrev ? prev.x : (seededX + (Math.random() * 2 - 1) * 18),
        y: usePrev ? prev.y : (seededY + (Math.random() * 2 - 1) * 18),
        vx: 0,
        vy: 0,
      };
    });
  }

  run() {
    if (this._raf) cancelAnimationFrame(this._raf);
    // Pre-warm: run synchronous ticks until alpha drops to ~0.4 so the first
    // rendered frame is already in a stable-ish layout (eliminates the "big bang"
    // jitter where nodes shoot across the canvas at full force).
    while (this._alpha > this._quality.prewarmAlpha && this._iter < this._quality.prewarmTicks) {
      this._alpha *= this._quality.alphaDecay;
      this._step(this._alpha);
      this._iter++;
    }
    const tick = () => {
      this._alpha *= this._quality.alphaDecay;
      this._iter++;
      this._step(this._alpha);
      const converged = this._iter > 30 && (this._maxDeltaSq || 0) < 0.04;
      const done = this._alpha < this._quality.minAlpha || this._iter >= this._quality.maxTicks || converged;
      const pos = {};
      for (const n of this._nodes) pos[n.id] = { x: n.x, y: n.y };
      this._rememberPositions(pos);
      if (done) {
        this._raf = null;
        this._onSettled && this._onSettled(pos);
      } else {
        this._onPos && this._onPos(pos);
        this._raf = requestAnimationFrame(tick);
      }
    };
    this._raf = requestAnimationFrame(tick);
  }

  _step(a) {
    const nodes = this._nodes;
    const cellSize = this._quality.cellSize;
    const charge = this._quality.charge;
    const grid = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      const gx = Math.floor(nd.x / cellSize);
      const gy = Math.floor(nd.y / cellSize);
      const key = gx + ',' + gy;
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(i);
    }
    for (let i = 0; i < nodes.length; i++) {
      const src = nodes[i];
      const gx = Math.floor(src.x / cellSize);
      const gy = Math.floor(src.y / cellSize);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get((gx + ox) + ',' + (gy + oy));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const dst = nodes[j];
            const dx = dst.x - src.x;
            const dy = dst.y - src.y;
            const d2 = dx * dx + dy * dy + 16;
            const f = charge * a / d2;
            src.vx -= dx * f;
            src.vy -= dy * f;
            dst.vx += dx * f;
            dst.vy += dy * f;
          }
        }
      }
    }
    const ideal = this._quality.idealDistance;
    for (const e of this._edges) {
      const si = this._idx.get(e.source), ti = this._idx.get(e.target);
      if (si === undefined || ti === undefined) continue;
      const s = nodes[si], t = nodes[ti];
      const dx = t.x - s.x, dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (dist - ideal) * a * this._quality.springStrength / dist;
      if (!this._pinned.has(s.id)) { s.vx += dx * f; s.vy += dy * f; }
      if (!this._pinned.has(t.id)) { t.vx -= dx * f; t.vy -= dy * f; }
    }
    for (const nd of nodes) {
      if (this._pinned.has(nd.id)) continue;
      const anchor = this._clusterAnchors.get(nd.clusterId) || { x: 0, y: 0 };
      const meta = this._clusterMeta.get(nd.clusterId) || { size: 1 };
      // No per-node "orbit snap" force here on purpose — see the comment on
      // `anchorAngle`/`orbitRadius` in init() for the full reasoning. Cluster
      // shape/formation still comes entirely from this same loop's
      // anchorPull/memberPull (pull toward the cluster's own center point,
      // no fixed angle) and the orbitTightness cohesion term just below,
      // plus real charge repulsion and edge springs from the rest of
      // _step() — the same forces Obsidian's own graph view relies on
      // (repel + link + a center pull), with nothing pinning any node to
      // one exact pre-computed point on a circle.
      nd.vx += (anchor.x - nd.x) * a * (nd.id === nd.clusterId ? this._quality.anchorPull : this._quality.memberPull);
      nd.vy += (anchor.y - nd.y) * a * (nd.id === nd.clusterId ? this._quality.anchorPull : this._quality.memberPull);
      const orbitTightness = Math.min(1.6, 0.75 + meta.size / 18);
      nd.vx -= (nd.x - anchor.x) * a * 0.0008 * orbitTightness;
      nd.vy -= (nd.y - anchor.y) * a * 0.0008 * orbitTightness;
      // Weight-aware: heavy/connected hubs feel stronger pull toward center,
      // peripheral notes float outward — produces organic radial depth.
      nd.vx -= nd.x * this._quality.centerPull * (1 + (nd.weight || 0) * 1.5) * a;
      nd.vy -= nd.y * this._quality.centerPull * (1 + (nd.weight || 0) * 1.5) * a;
    }
    let maxDeltaSq = 0;
    const maxR = this._maxRadius;
    const maxR2 = maxR * maxR;
    const dragAffected = this._dragAffected;
    for (const nd of nodes) {
      if (this._pinned.has(nd.id)) { nd.vx = 0; nd.vy = 0; continue; }
      // While a drag is active, only the dragged node and its direct
      // neighbors are allowed to actually move — see dragStart()'s own
      // comment for the full reasoning. Every force loop above this one
      // still computed something into every node's vx/vy regardless; this
      // is the one place that computed value is discarded for anything
      // outside the affected set, the same way a pinned node's already is.
      if (dragAffected && !dragAffected.has(nd.id)) { nd.vx = 0; nd.vy = 0; continue; }
      nd.vx *= this._quality.damping; nd.vy *= this._quality.damping;
      nd.x  += nd.vx; nd.y  += nd.vy;
      // Containment clamp — see the comment where this._maxRadius is set in
      // _buildGraph(). Prevents disconnected/low-weight satellites from drifting
      // arbitrarily far out under charge repulsion from the main cluster.
      if (maxR) {
        const d2 = nd.x * nd.x + nd.y * nd.y;
        if (d2 > maxR2) {
          const scale = maxR / Math.sqrt(d2);
          nd.x *= scale;
          nd.y *= scale;
        }
      }
      const dsq = nd.vx * nd.vx + nd.vy * nd.vy;
      if (dsq > maxDeltaSq) maxDeltaSq = dsq;
    }
    this._maxDeltaSq = maxDeltaSq;
  }

  _buildGraph(nodeData, edgeData) {
    const adjacency = new Map();
    const degrees = new Map();
    const degreeByNode = new Map();
    for (const n of nodeData) {
      adjacency.set(n.id, new Set());
      const degree = (n.edges && n.edges.length) ? n.edges.length : 0;
      const score = degree * 1.25 + (n.weight || 0) * 12;
      degreeByNode.set(n.id, degree);
      degrees.set(n.id, score);
    }
    for (const e of edgeData) {
      if (!adjacency.has(e.source) || !adjacency.has(e.target)) continue;
      adjacency.get(e.source).add(e.target);
      adjacency.get(e.target).add(e.source);
      degrees.set(e.source, (degrees.get(e.source) || 0) + 0.45);
      degrees.set(e.target, (degrees.get(e.target) || 0) + 0.45);
    }

    const sorted = nodeData.slice().sort((a, b) => (degrees.get(b.id) || 0) - (degrees.get(a.id) || 0));
    const clusterCount = this._quality.clusterCount;
    const anchors = sorted.slice(0, clusterCount).map(n => n.id);
    const clusterAnchors = new Map();
    const ringRadius = Math.max(this._quality.ringRadiusMin, Math.sqrt(nodeData.length) * this._quality.ringRadiusScale);
    // Hard containment bound: charge repulsion from a dense main cluster can push
    // low-weight/disconnected satellite components arbitrarily far outward, since
    // center-pull scales down with node weight. Cap how far any node can drift from
    // the origin so isolated fragments stay visually near the rest of the graph
    // instead of scattering into far corners. Generous multiplier — this should
    // only ever engage for genuinely runaway nodes, not normal cluster spread.
    this._maxRadius = ringRadius * 2.4;
    if (anchors.length === 1) {
      clusterAnchors.set(anchors[0], { x: 0, y: 0 });
    } else {
      clusterAnchors.set(anchors[0], { x: 0, y: 0 });
      for (let i = 1; i < anchors.length; i++) {
        const angle = i * 2.39996; // golden angle — avoids uniform ring spacing
        const r = ringRadius * (0.35 + 0.65 * Math.sqrt(i / anchors.length));
        clusterAnchors.set(anchors[i], {
          x: Math.cos(angle) * r,
          y: Math.sin(angle) * r,
        });
      }
    }

    const nodeCluster = new Map();
    const clusterMembers = new Map();
    const queue = [];
    for (const anchorId of anchors) {
      nodeCluster.set(anchorId, anchorId);
      queue.push(anchorId);
      clusterMembers.set(anchorId, [anchorId]);
    }

    while (queue.length) {
      const current = queue.shift();
      const clusterId = nodeCluster.get(current);
      const neighbors = adjacency.get(current) || [];
      for (const next of neighbors) {
        if (nodeCluster.has(next)) continue;
        nodeCluster.set(next, clusterId);
        clusterMembers.get(clusterId).push(next);
        queue.push(next);
      }
    }

    for (const n of nodeData) {
      if (nodeCluster.has(n.id)) continue;
      let bestCluster = anchors[0] || n.id;
      let bestScore = -Infinity;
      for (const anchorId of anchors) {
        const anchorNode = nodeData.find(item => item.id === anchorId);
        let score = 0;
        if (anchorNode && anchorNode.group === n.group) score += 4;
        score += (degrees.get(anchorId) || 0) * 0.04;
        const neighbors = adjacency.get(n.id);
        if (neighbors && neighbors.has(anchorId)) score += 6;
        if (score > bestScore) {
          bestScore = score;
          bestCluster = anchorId;
        }
      }
      nodeCluster.set(n.id, bestCluster);
      if (!clusterMembers.has(bestCluster)) clusterMembers.set(bestCluster, []);
      clusterMembers.get(bestCluster).push(n.id);
    }

    const clusterMeta = new Map();
    const clusterRank = new Map();
    const bridgeCounts = new Map();
    for (const anchorId of anchors) {
      const members = clusterMembers.get(anchorId) || [anchorId];
      clusterMeta.set(anchorId, { size: members.length });
      members
        .slice()
        .sort((a, b) => (degrees.get(b) || 0) - (degrees.get(a) || 0))
        .forEach((id, index) => clusterRank.set(id, index));
    }

    const icEdges = new Map();
    for (const e of edgeData) {
      const srcCluster = nodeCluster.get(e.source);
      const tgtCluster = nodeCluster.get(e.target);
      if (!srcCluster || !tgtCluster || srcCluster === tgtCluster) continue;
      bridgeCounts.set(e.source, (bridgeCounts.get(e.source) || 0) + 1);
      bridgeCounts.set(e.target, (bridgeCounts.get(e.target) || 0) + 1);
      const key = srcCluster < tgtCluster ? srcCluster + '|' + tgtCluster : tgtCluster + '|' + srcCluster;
      icEdges.set(key, (icEdges.get(key) || 0) + 1);
    }

    // Topology-aware anchor refinement: mini force-sim where cross-connected clusters
    // pull toward each other, producing an organic field instead of a rigid ring.
    if (anchors.length > 2) {
      const ringR = Math.max(this._quality.ringRadiusMin, Math.sqrt(nodeData.length) * this._quality.ringRadiusScale);
      const movable = anchors.slice(1);
      for (let iter = 0; iter < 32; iter++) {
        const a = 1 - iter / 32;
        for (let i = 0; i < movable.length; i++) {
          for (let j = i + 1; j < movable.length; j++) {
            const pa = clusterAnchors.get(movable[i]);
            const pb = clusterAnchors.get(movable[j]);
            const dx = pb.x - pa.x, dy = pb.y - pa.y;
            const d2 = dx * dx + dy * dy + 1;
            const f = ringR * ringR * 0.5 * a / d2;
            pa.x -= dx * f; pa.y -= dy * f;
            pb.x += dx * f; pb.y += dy * f;
          }
        }
        for (const [pair, cnt] of icEdges) {
          const sep = pair.indexOf('|');
          const ca = pair.slice(0, sep), cb = pair.slice(sep + 1);
          if (ca === anchors[0] || cb === anchors[0]) continue;
          const pa = clusterAnchors.get(ca);
          const pb = clusterAnchors.get(cb);
          if (!pa || !pb) continue;
          const dx = pb.x - pa.x, dy = pb.y - pa.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const ideal = ringR * 0.5;
          const str = Math.min(1, cnt / 6) * 0.1 * a;
          const f = (d - ideal) * str / d;
          pa.x += dx * f; pa.y += dy * f;
          pb.x -= dx * f; pb.y -= dy * f;
        }
        for (const id of movable) {
          const p = clusterAnchors.get(id);
          p.x *= (1 - 0.01 * a); p.y *= (1 - 0.01 * a);
        }
      }
    }

    for (const n of nodeData) {
      n.clusterId = nodeCluster.get(n.id) || null;
      n.clusterRank = clusterRank.get(n.id) || 0;
      const bridgeCount = bridgeCounts.get(n.id) || 0;
      n.bridgeCount = bridgeCount;
      n.bridgeScore = bridgeCount > 0 ? Math.min(1, bridgeCount / 4) : 0;
    }

    return { adjacency, degrees, nodeCluster, clusterAnchors, clusterMeta, clusterRank, degreeByNode };
  }

  _hashAngle(id) {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) / 4294967295) * Math.PI * 2;
  }

  _qualityProfile(count) {
    if (count >= 2200) {
      return { clusterCount: 10, prewarmTicks: 55, prewarmAlpha: 0.16, maxTicks: 180, minAlpha: 0.016, alphaDecay: 0.964, cellSize: 220, charge: 820, idealDistance: 76, springStrength: 0.17, centerPull: 0.0026, damping: 0.84, ringRadiusMin: 420, ringRadiusScale: 26, orbitBase: 116, orbitClusterScale: 14, orbitRankStep: 18, orbitWeightStep: 24, anchorPull: 0.07, memberPull: 0.0065 };
    }
    if (count >= 1200) {
      return { clusterCount: 9, prewarmTicks: 75, prewarmAlpha: 0.14, maxTicks: 240, minAlpha: 0.012, alphaDecay: 0.972, cellSize: 200, charge: 900, idealDistance: 86, springStrength: 0.19, centerPull: 0.0034, damping: 0.82, ringRadiusMin: 360, ringRadiusScale: 23, orbitBase: 104, orbitClusterScale: 13, orbitRankStep: 17, orbitWeightStep: 22, anchorPull: 0.074, memberPull: 0.007 };
    }
    if (count >= 500) {
      return { clusterCount: 8, prewarmTicks: 40, prewarmAlpha: 0.12, maxTicks: 300, minAlpha: 0.009, alphaDecay: 0.978, cellSize: 180, charge: 980, idealDistance: 102, springStrength: 0.21, centerPull: 0.0042, damping: 0.8, ringRadiusMin: 300, ringRadiusScale: 21, orbitBase: 92, orbitClusterScale: 12, orbitRankStep: 16, orbitWeightStep: 20, anchorPull: 0.076, memberPull: 0.0075 };
    }
    return { clusterCount: Math.max(1, Math.min(8, Math.round(Math.sqrt(Math.max(1, count)) / 4))), prewarmTicks: 150, prewarmAlpha: 0.10, maxTicks: 400, minAlpha: 0.005, alphaDecay: 0.985, cellSize: 170, charge: 1100, idealDistance: count > 300 ? 108 : 126, springStrength: 0.22, centerPull: 0.006, damping: 0.78, ringRadiusMin: 260, ringRadiusScale: 18, orbitBase: 80, orbitClusterScale: 10, orbitRankStep: 14, orbitWeightStep: 18, anchorPull: 0.08, memberPull: 0.008 };
  }

  _rememberPositions(pos) {
    this._lastPositions = new Map(Object.entries(pos));
  }

  // Synchronously fast-forwards the same physics used by init()/run() to a
  // settled layout and returns the final positions, without scheduling any
  // requestAnimationFrame ticks or touching the renderer. Used by x-graph
  // time-lapse: each historical frame's target positions are solved once up
  // front, then the caller tweens the *rendered* positions from the previous
  // frame's settled layout to this one — smooth motion, no physics jitter.
  // Reuses init()'s continuity seeding (existing nodes start from
  // _lastPositions) so consecutive frames naturally stay coherent.
  //
  // Conduit uses only this method (plus init()/_step()/_buildGraph() that it
  // calls into) — it never calls run()/dragStart()/drag()/dragEnd(), so those
  // referencing requestAnimationFrame (a browser/webview-only global) is safe:
  // JS doesn't resolve an identifier inside a function body until that function
  // actually runs, and Conduit never runs those ones.
  /**
   * @param {Array<object>} nodeData
   * @param {Array<{source: string, target: string}>} edgeData
   * @returns {Record<string, {x: number, y: number}>}
   */
  settleSync(nodeData, edgeData) {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    this.init(nodeData, edgeData);
    let iter = 0;
    while (this._alpha > this._quality.minAlpha && iter < this._quality.maxTicks) {
      this._alpha *= this._quality.alphaDecay;
      this._step(this._alpha);
      iter++;
      if (iter > 30 && (this._maxDeltaSq || 0) < 0.04) break;
    }
    const pos = {};
    for (const n of this._nodes) pos[n.id] = { x: n.x, y: n.y };
    this._rememberPositions(pos);
    return pos;
  }

  // Wakes the simulation back up so dragging a node visibly pulls its
  // connected neighbors via spring forces (Obsidian-style), instead of
  // moving in isolation. Normally the layout settles once via settleSync()
  // at load time and then sits fully static — there is no live loop running
  // at rest, so without this a drag would just relocate one node with
  // nothing left running to react to it. run() naturally stops itself again
  // once alpha decays back below threshold, so this doesn't leave a
  // permanent animation loop running after the drag settles.
  //
  // Reheat is capped at `prewarmAlpha`, not a flat 0.3 (a real, reported
  // bug: every node receives charge-repulsion/center-pull/orbit forces
  // whenever alpha > 0 — not just the dragged node's direct neighbors — so
  // reheating the WHOLE graph to 0.3, well above even the "big bang"
  // prewarm threshold every quality tier already treats as its own ceiling
  // for "visible but not jarring" motion, made a single drag visibly jolt
  // every node on screen, not just the ones connected to the drag, for the
  // ~250+ ticks (several seconds) it then took to decay back down.
  // `prewarmAlpha` is the same value run()'s own prewarm loop already uses
  // as "stable-ish enough to render the first frame" — reusing it here
  // keeps a drag's reheat consistent with that existing, tier-aware
  // definition of gentle, rather than inventing a second, much hotter one.
  //
  // Lowering the reheat ceiling (above) still wasn't enough on its own — a
  // real, confirmed follow-up report: capping *how strong* alpha gets
  // doesn't change *who* it's applied to. Every force loop in _step()
  // iterates every node unconditionally whenever alpha > 0, so even a
  // gentle reheat still visibly nudges completely unrelated, disconnected
  // nodes elsewhere in the vault (measured directly: 150 of 150 untouched
  // nodes in a test graph moved on the very first tick of one drag). Real
  // graphs are much bigger than one drag's area of relevance, so this read
  // as a persistent whole-canvas "vibration." `_dragAffected` is the fix:
  // while set, _step()'s final position-update loop treats any node NOT in
  // it exactly like a pinned one (force computation still happens into its
  // vx/vy — harmless, since it's never used — but position never updates),
  // so only the dragged node and its direct (1-hop) neighbors can actually
  // move. This is also exactly the set of nodes reheating was ever meant to
  // visibly affect ("dragging a node visibly pulls its connected
  // neighbors") — nothing further out was ever the intent.
  dragStart(id) {
    this._pinned.add(id);
    const affected = new Set([id]);
    for (const e of this._edges) {
      if (e.source === id) affected.add(e.target);
      else if (e.target === id) affected.add(e.source);
    }
    this._dragAffected = affected;
    this._alpha = Math.max(this._alpha, this._quality.prewarmAlpha);
    this._iter = 0;
    if (!this._raf) this.run();
  }
  drag(id, x, y) {
    const i = this._idx.get(id);
    if (i !== undefined) { const n = this._nodes[i]; n.x = x; n.y = y; n.vx = 0; n.vy = 0; }
  }
  clearPins() {
    this._pinned.clear();
  }
  // Deliberately does NOT unpin — _step()'s orbit/anchor forces pull every
  // node toward a fixed target computed once at init() time. Unpinning here
  // let those forces drag a just-released node back toward that stale
  // target once the reheated run() loop kept ticking, so a drop never
  // actually stayed put — it visibly crept back afterward. A dropped node
  // now stays exactly where placed (matches how Obsidian's drag behaves);
  // its neighbors still resettle around it via the same run() burst, which
  // is the actual point of reheating on drag. A future "release pin" action
  // (e.g. a dedicated key/context-menu item) can still explicitly call
  // dragStart→dragEnd's sibling unpin path if ever wanted — this method
  // just no longer does it implicitly on every drop.
  //
  // Also where the second half of the reheat bug lived: previously a
  // complete no-op, so releasing the mouse never shortened the already-
  // reheated decay — the whole tail (dozens to hundreds of ticks, several
  // seconds) always ran to completion regardless of how brief the drag
  // was, since this file has no concept of "stop reheating, we're done
  // interacting" — alpha decays at a fixed rate with nothing to tell it the
  // drag ended. Clamping alpha down here on release keeps a short, visible
  // settle (so the dropped node's neighbors still glide into their new
  // positions over a few frames) without the long, unbounded tail that made
  // even a single quick drag look like the whole graph kept moving on its
  // own for seconds afterward.
  dragEnd(_id) {
    this._alpha = Math.min(this._alpha, this._quality.minAlpha * 3);
  }
  destroy() { if (this._raf) cancelAnimationFrame(this._raf); }
}

module.exports = { SimpleLayout };
