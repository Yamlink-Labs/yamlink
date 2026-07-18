'use strict';

function _clientBodySetup() {
    return `
const vsc = acquireVsCodeApi();

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  renderer: null, layout: null, payload: null, selectedId: null,
  searchTerm: '', typeFilters: new Set(), primaryTypeFilter: '', ctxId: null, lastHash: '',
  pendingLayoutHash: '', lastSettledLayoutHash: '', lastCameraSettleKey: '',
  hasRenderedGraph: false, nextCameraSettleDuration: 0,
  timelapse: {
    active: false, loading: false, playing: false, direction: 1,
    frames: [], index: 0, currentFrame: null,
    tween: null, tweenRaf: null, playTimer: null, cinematicPos: null,
  },
};
const layers = { semantic: false, health: false };
let labelMode = 'auto'; // 'auto' | 'all' | 'none' — see Canvas2DRenderer.setLabelMode

const TK = {
  person:'person', contact:'person', character:'person',
  mission:'event', event:'event', session:'event',
  note:'artifact', source:'artifact', document:'artifact',
  schema:'schema', task:'task', project:'container', unit:'container',
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const g = id => document.getElementById(id);
const E = {
  gc: g('graph-container'),
  tip: g('tip'), ctx: g('ctx'), empty: g('empty'), statusbar: g('statusbar'),
  modeHelp: g('modeHelp'), emptyTitle: g('emptyTitle'), emptyDesc: g('emptyDesc'),
  tipName: g('tipName'), tipType: g('tipType'), tipOut: g('tipOut'), tipIn: g('tipIn'), tipDeg: g('tipDeg'),
  ctxOpen: g('ctxOpen'), ctxFocus: g('ctxFocus'), ctxExpd: g('ctxExpd'),
  btnLocal: g('btnLocal'), btnVault: g('btnVault'), btnReveal: g('btnReveal'), btnReset: g('btnReset'),
  depthGroup: g('depthGroup'), depthSel: g('depthSel'), typeSel: g('typeSel'), searchInp: g('searchInp'),
  btnZoomIn: g('btnZoomIn'), btnZoomFit: g('btnZoomFit'), btnZoomOut: g('btnZoomOut'),
  btnSemantic: g('btnSemantic'), btnHealth: g('btnHealth'), btnLabels: g('btnLabels'),
  selCard: g('selCard'), typeChips: g('typeChips'), topNodes: g('topNodes'), relList: g('relList'), tagList: g('tagList'),
  btnTimelapse: g('btnTimelapse'), timelapseBar: g('timelapseBar'), btnTimelapsePlay: g('btnTimelapsePlay'),
  btnTimelapseRewind: g('btnTimelapseRewind'),
  timelapseScrub: g('timelapseScrub'), timelapseLabel: g('timelapseLabel'), btnTimelapseExit: g('btnTimelapseExit'),
};

// ── Mouse pos (for tooltip positioning relative to graph container) ────────────
let mpos = { x: 0, y: 0 };
if (E.gc) E.gc.addEventListener('mousemove', ev => { mpos = { x: ev.offsetX, y: ev.offsetY }; });

// ── HTML escape ───────────────────────────────────────────────────────────────
function h(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Simple force layout (no d3-force dependency) ──────────────────────────────
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
      const orbitX = anchor.x + Math.cos(nd.anchorAngle) * nd.orbitRadius;
      const orbitY = anchor.y + Math.sin(nd.anchorAngle) * nd.orbitRadius;
      nd.vx += (orbitX - nd.x) * a * this._quality.orbitSnap;
      nd.vy += (orbitY - nd.y) * a * this._quality.orbitSnap;
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
    for (const nd of nodes) {
      if (this._pinned.has(nd.id)) { nd.vx = 0; nd.vy = 0; continue; }
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
      return { clusterCount: 10, prewarmTicks: 55, prewarmAlpha: 0.16, maxTicks: 180, minAlpha: 0.016, alphaDecay: 0.964, cellSize: 220, charge: 820, idealDistance: 76, springStrength: 0.17, centerPull: 0.0026, damping: 0.84, ringRadiusMin: 420, ringRadiusScale: 26, orbitBase: 116, orbitClusterScale: 14, orbitRankStep: 18, orbitWeightStep: 24, orbitSnap: 0.022, anchorPull: 0.07, memberPull: 0.0065 };
    }
    if (count >= 1200) {
      return { clusterCount: 9, prewarmTicks: 75, prewarmAlpha: 0.14, maxTicks: 240, minAlpha: 0.012, alphaDecay: 0.972, cellSize: 200, charge: 900, idealDistance: 86, springStrength: 0.19, centerPull: 0.0034, damping: 0.82, ringRadiusMin: 360, ringRadiusScale: 23, orbitBase: 104, orbitClusterScale: 13, orbitRankStep: 17, orbitWeightStep: 22, orbitSnap: 0.023, anchorPull: 0.074, memberPull: 0.007 };
    }
    if (count >= 500) {
      return { clusterCount: 8, prewarmTicks: 40, prewarmAlpha: 0.12, maxTicks: 300, minAlpha: 0.009, alphaDecay: 0.978, cellSize: 180, charge: 980, idealDistance: 102, springStrength: 0.21, centerPull: 0.0042, damping: 0.8, ringRadiusMin: 300, ringRadiusScale: 21, orbitBase: 92, orbitClusterScale: 12, orbitRankStep: 16, orbitWeightStep: 20, orbitSnap: 0.024, anchorPull: 0.076, memberPull: 0.0075 };
    }
    return { clusterCount: Math.max(1, Math.min(8, Math.round(Math.sqrt(Math.max(1, count)) / 4))), prewarmTicks: 150, prewarmAlpha: 0.10, maxTicks: 400, minAlpha: 0.005, alphaDecay: 0.985, cellSize: 170, charge: 1100, idealDistance: count > 300 ? 108 : 126, springStrength: 0.22, centerPull: 0.006, damping: 0.78, ringRadiusMin: 260, ringRadiusScale: 18, orbitBase: 80, orbitClusterScale: 10, orbitRankStep: 14, orbitWeightStep: 18, orbitSnap: 0.025, anchorPull: 0.08, memberPull: 0.008 };
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

  dragStart(id) { this._pinned.add(id); }
  drag(id, x, y) {
    const i = this._idx.get(id);
    if (i !== undefined) { const n = this._nodes[i]; n.x = x; n.y = y; n.vx = 0; n.vy = 0; }
  }
  dragEnd(id) { this._pinned.delete(id); }
  destroy() { if (this._raf) cancelAnimationFrame(this._raf); }
}

// ── Renderer + layout factory ─────────────────────────────────────────────────
`;
}

function _clientBodyRendering() {
    return `function ensureRenderer() {
  if (S.renderer) return S.renderer;
  if (!E.gc) { vsc.postMessage({ type:'bootStatus', level:'error', text:'graph container not found' }); return null; }

  S.renderer = new Canvas2DRenderer(E.gc, {
    onNodeClick: (id) => {
      const prev = S.selectedId;
      S.selectedId = (id === prev) ? null : (id || null);
      S.renderer.setSelected(S.selectedId);
      updateSelCard();
      updateTopNodeHighlights();
      if (S.selectedId) vsc.postMessage({ type:'openNode', id: S.selectedId });
    },
    onNodeHover: (id, node) => {
      if (id && node) {
        const det = S.payload && S.payload.model.nodeDetails && S.payload.model.nodeDetails[id];
        showTip({ id, label: node.label, type: node.type || node.kind || 'unknown', degree: node.edges ? node.edges.length : 0 }, det);
      } else {
        hideTip();
      }
    },
    onNodeContextMenu: (id, node, cx, cy) => {
      S.ctxId = id;
      S.selectedId = id;
      S.renderer.setSelected(id);
      updateSelCard(); updateTopNodeHighlights();
      vsc.postMessage({ type:'selectNode', id });
      showCtx(cx, cy);
    },
    onNodeDragStart: id  => S.layout && S.layout.dragStart(id),
    onNodeDrag:      (id, x, y) => S.layout && S.layout.drag(id, x, y),
    onNodeDragEnd:   id  => S.layout && S.layout.dragEnd(id),
  });

  S.layout = new SimpleLayout(
    pos => S.renderer.updatePositions(pos),
    pos => {
      if (pos) S.renderer.updatePositions(pos);
      settleCameraAfterLayout();
      updateStatus();
    }
  );

  const ro = new ResizeObserver(entries => {
    const e = entries[0];
    if (e && S.renderer) S.renderer.resize(e.contentRect.width, e.contentRect.height);
  });
  ro.observe(E.gc);

  S.renderer.setLayer('semantic', layers.semantic);
  S.renderer.setLayer('health',   layers.health);
  S.renderer.setLabelMode(labelMode);

  return S.renderer;
}

function toggleLayer(name) {
  layers[name] = !layers[name];
  if (S.renderer) S.renderer.setLayer(name, layers[name]);
  const btn = name === 'semantic' ? E.btnSemantic : E.btnHealth;
  if (btn) btn.classList.toggle('on', layers[name]);
}

const LABEL_MODE_ORDER = ['auto', 'all', 'none'];
const LABEL_MODE_TEXT = { auto: 'Labels: Auto', all: 'Labels: All', none: 'Labels: Off' };
function cycleLabelMode() {
  const idx = LABEL_MODE_ORDER.indexOf(labelMode);
  labelMode = LABEL_MODE_ORDER[(idx + 1) % LABEL_MODE_ORDER.length];
  if (S.renderer) S.renderer.setLabelMode(labelMode);
  if (E.btnLabels) {
    E.btnLabels.textContent = LABEL_MODE_TEXT[labelMode];
    E.btnLabels.classList.toggle('on', labelMode !== 'auto');
  }
}

function loadGraph(graphData) {
  const r = ensureRenderer();
  if (!r) return;
  const pos = S.layout.settleSync(graphData.nodes, graphData.edges);
  r.load(graphData);
  r.updatePositions(pos);
  S.nextCameraSettleDuration = S.hasRenderedGraph ? 180 : 0;
  settleCameraAfterLayout();
  S.hasRenderedGraph = true;
  updateStatus();
}

function settleCameraAfterLayout() {
  if (!S.renderer || !S.payload) return;
  const layoutHash = S.pendingLayoutHash || S.lastHash || '';
  const duration = Number.isFinite(S.nextCameraSettleDuration) ? S.nextCameraSettleDuration : 180;
  if (S.payload.mode === 'local' && S.payload.centerNodeId) {
    const settleKey = 'local:' + S.payload.centerNodeId + ':1.28';
    if (settleKey === S.lastCameraSettleKey && layoutHash === S.lastSettledLayoutHash) return;
    S.renderer.focusNode(S.payload.centerNodeId, {
      zoom: 1.28,
      preserveHigherZoom: true,
      duration,
    });
    S.lastCameraSettleKey = settleKey;
    S.lastSettledLayoutHash = layoutHash;
    return;
  }
  if (S.payload.mode === 'vault' && S.payload.selectedNodeId) {
    const settleKey = 'vault:' + S.payload.selectedNodeId + ':1.08';
    if (settleKey === S.lastCameraSettleKey && layoutHash === S.lastSettledLayoutHash) return;
    S.renderer.focusNode(S.payload.selectedNodeId, {
      zoom: 1.08,
      preserveHigherZoom: true,
      duration,
    });
    S.lastCameraSettleKey = settleKey;
    S.lastSettledLayoutHash = layoutHash;
    return;
  }
  const settleKey = 'fit:' + S.payload.mode;
  if (settleKey === S.lastCameraSettleKey && layoutHash === S.lastSettledLayoutHash) return;
  S.renderer.fitView({ duration, padding: 72, maxZoom: 1.9 });
  S.lastCameraSettleKey = settleKey;
  S.lastSettledLayoutHash = layoutHash;
}

// ── Status bar ────────────────────────────────────────────────────────────────
function updateStatus() {
  if (!S.payload) return;
  const s = S.payload.model.summary;
  const sr = s.strongestRelation ? (' · strongest: ' + s.strongestRelation) : '';
  E.statusbar.textContent = (S.payload.mode === 'vault' ? 'Explorer' : 'Local') +
    ' · ' + s.nodeCount + ' nodes · ' + s.edgeCount + ' edges · ' + s.typeCount + ' types' + sr +
    '  ·  ' + BUILD;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
`;
}

function _clientBodyTooltipsAndContextMenu() {
    return `function showTip(data, det) {
  E.tipName.textContent = data.label || data.id;
  E.tipType.textContent = data.type  || 'unknown';
  E.tipOut.textContent  = det ? det.outgoing.length : 0;
  E.tipIn.textContent   = det ? det.incoming.length : 0;
  E.tipDeg.textContent  = data.degree || 0;
  const tw = 224;
  const cw = E.gc ? E.gc.clientWidth : 400;
  let lx = mpos.x + 14;
  if (lx + tw > cw - 8) lx = mpos.x - tw - 14;
  E.tip.style.left = lx + 'px';
  E.tip.style.top  = Math.max(8, mpos.y - 44) + 'px';
  E.tip.classList.add('show');
}
function hideTip() { E.tip.classList.remove('show'); }

// ── Context menu ──────────────────────────────────────────────────────────────
function showCtx(cx, cy) {
  const r = E.gc ? E.gc.getBoundingClientRect() : { left: 0, top: 0 };
  E.ctx.style.left = (cx - r.left) + 'px';
  E.ctx.style.top  = (cy - r.top)  + 'px';
  E.ctx.classList.add('show');
  if (E.ctxOpen) E.ctxOpen.focus();
}
function hideCtx() { E.ctx.classList.remove('show'); }

document.addEventListener('click', ev => { if (!E.ctx.contains(ev.target)) hideCtx(); });
E.ctxOpen.addEventListener('click',  () => { if (S.ctxId) vsc.postMessage({ type:'openNode',   id:S.ctxId }); hideCtx(); });
E.ctxFocus.addEventListener('click', () => { if (S.ctxId) vsc.postMessage({ type:'focusNode',  id:S.ctxId }); hideCtx(); });
E.ctxExpd.addEventListener('click',  () => { if (S.ctxId) vsc.postMessage({ type:'expandNode', id:S.ctxId }); hideCtx(); });

// ── Selection ─────────────────────────────────────────────────────────────────
`;
}

function _clientBodySelection() {
    return `function selectNode(id) {
  S.selectedId = id;
  if (S.renderer) {
    S.renderer.setSelected(id);
  }
  updateSelCard(); updateTopNodeHighlights();
}
function clearSel() {
  S.selectedId = null;
  if (S.renderer) S.renderer.setSelected(null);
  updateSelCard(); updateTopNodeHighlights();
}

function getKeyboardNodeOrder() {
  const r = S.renderer;
  if (!r || !r._nodeMap) return [];
  return [...r._nodeMap.keys()].sort((a, b) => {
    const na = r._nodeMap.get(a) || {};
    const nb = r._nodeMap.get(b) || {};
    const wa = Number(na.weight || 0);
    const wb = Number(nb.weight || 0);
    if (wb !== wa) return wb - wa;
    return String(a).localeCompare(String(b));
  });
}

function focusSelectedNode(id) {
  const r = S.renderer;
  if (!r || !id) return;
  S.selectedId = id;
  r.setSelected(id);
  if (typeof r.focusNode === 'function') {
    r.focusNode(id, { preserveHigherZoom: true, duration: 180 });
  }
  updateSelCard();
  updateTopNodeHighlights();
}

function cycleKeyboardSelection(direction) {
  const order = getKeyboardNodeOrder();
  if (!order.length) return;
  const currentId = (S.renderer && S.renderer._selectedId) || S.selectedId || null;
  const currentIndex = currentId ? order.indexOf(currentId) : -1;
  const nextIndex = currentIndex === -1
    ? (direction > 0 ? 0 : order.length - 1)
    : (currentIndex + direction + order.length) % order.length;
  focusSelectedNode(order[nextIndex]);
}

function findDirectionalNode(direction) {
  const r = S.renderer;
  if (!r || !r._nodeMap || !r._positions) return null;
  const currentId = r._selectedId || S.selectedId || null;
  if (!currentId) return null;
  const current = r._positions[currentId];
  if (!current) return null;

  let bestId = null;
  let bestDistance = Infinity;
  for (const [id] of r._nodeMap.entries()) {
    if (id === currentId) continue;
    const pos = r._positions[id];
    if (!pos) continue;
    const dx = pos.x - current.x;
    const dy = pos.y - current.y;
    if (direction === 'left') {
      if (dx >= 0 || Math.abs(dy) >= Math.abs(dx) * 1.5) continue;
    } else if (direction === 'right') {
      if (dx <= 0 || Math.abs(dy) >= Math.abs(dx) * 1.5) continue;
    } else if (direction === 'up') {
      if (dy >= 0 || Math.abs(dx) >= Math.abs(dy) * 1.5) continue;
    } else if (direction === 'down') {
      if (dy <= 0 || Math.abs(dx) >= Math.abs(dy) * 1.5) continue;
    }
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = id;
    }
  }
  return bestId;
}

function handleDirectionalSelection(direction) {
  const nextId = findDirectionalNode(direction);
  if (nextId) focusSelectedNode(nextId);
}

// ── Search / filter ───────────────────────────────────────────────────────────
`;
}

function _clientBodySearchAndFilter() {
    return `function applySearch() {
  if (S.renderer) S.renderer.setSearch(S.searchTerm.trim());
}
function applyFilter() {
  if (!S.renderer) return;
  const at = new Set(S.typeFilters);
  if (S.primaryTypeFilter) at.add(S.primaryTypeFilter);
  if (!at.size) { S.renderer.setFilter(null); return; }
  S.renderer.setFilter(at);
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function nodeColor(id) {
  if (!S.payload) return '#8b949e';
  const el = S.payload.model.elements.find(e => e.data && e.data.id === id && !e.data.source);
  return (el && el.data.color) || '#8b949e';
}

function updateTopNodeHighlights() {
  E.topNodes.querySelectorAll('[data-id]').forEach(b => {
    const on = b.dataset.id === S.selectedId;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function updateSelCard() {
  const id = S.selectedId;
  if (!id || !S.payload) { E.selCard.innerHTML = '<div class="sel-empty">Pick a node to inspect it.</div>'; return; }
  const el = S.payload.model.elements.find(e => e.data && e.data.id === id && !e.data.source);
  if (!el) return;
  const d = el.data;
  const det = S.payload.model.nodeDetails && S.payload.model.nodeDetails[id];
  const out = det ? det.outgoing.length : 0;
  const inc = det ? det.incoming.length : 0;
  const tags = det && det.tags ? det.tags : [];
  const topRel  = det && det.relationSummary  && det.relationSummary[0]  ? det.relationSummary[0]  : null;
  const topType = det && det.connectedTypes   && det.connectedTypes[0]   ? det.connectedTypes[0]   : null;
  const isFocus  = !!(S.payload && S.payload.centerNodeId === id);
  const canExpand = !!(det && det.hiddenNeighborCount > 0);
  E.selCard.innerHTML =
    '<div class="sel-hdr">' +
      '<div class="sel-dot" style="background:' + h(d.color||'#8b949e') + '"></div>' +
      '<div class="sel-meta">' +
        '<div class="sel-name">' + h(d.label||d.id) + '</div>' +
        '<div class="sel-type">' + h(d.type||'unknown') + '</div>' +
        (isFocus ? '<div class="sel-note">Current focus</div>' : '') +
      '</div>' +
    '</div>' +
    '<div class="sel-stats">' +
      '<div class="sel-stat"><b>' + out + '</b>outgoing</div>' +
      '<div class="sel-stat"><b>' + inc + '</b>incoming</div>' +
      '<div class="sel-stat"><b>' + (d.degree||0) + '</b>total</div>' +
      '<div class="sel-stat"><b>' + ((det && det.hubScore)||d.hubScore||0) + '</b>signal<span class="help-tip" title="How structurally significant this note is here -- combines its connection weight, how many different kinds of relations it uses, how many different note types it connects to, how many of those connections are strong (named, not just body mentions), and its tag count. Higher = more central to this neighborhood, not just more linked.">?</span></div>' +
    '</div>' +
    (topRel || topType || tags.length
      ? '<div class="sel-type" style="margin:-2px 0 10px;">' +
          (topRel  ? 'Strongest: '     + h(topRel.field) + ' · ' : '') +
          (topType ? 'Most connected: ' + h(topType.type) : '') +
        '</div>'
      : '') +
    (tags.length
      ? '<div class="chips" style="margin-bottom:10px;">' + tags.slice(0,4).map(t =>
          '<span class="chip on"><span class="chip-dot" style="background:var(--accent3)"></span>#' + h(t) + '</span>'
        ).join('') + '</div>'
      : '') +
    '<div class="act-row">' +
      '<button class="btn pri" id="aOpen">Open</button>' +
      '<button class="btn" id="aFocus"' + (isFocus ? ' disabled' : '') + '>' + (isFocus ? 'Centered' : 'Focus') + '</button>' +
      '<button class="btn" id="aExpd"' + (canExpand ? '' : ' disabled') + '>' + (canExpand ? 'Expand +' + det.hiddenNeighborCount : 'Expanded') + '</button>' +
    '</div>';
  g('aOpen')  && g('aOpen').addEventListener('click',  () => vsc.postMessage({ type:'openNode',   id }));
  g('aFocus') && !isFocus  && g('aFocus').addEventListener('click', () => vsc.postMessage({ type:'focusNode',  id }));
  g('aExpd')  && canExpand && g('aExpd').addEventListener('click',  () => vsc.postMessage({ type:'expandNode', id }));
}

`;
}

function _clientBodySidebarAndPayload() {
    return `function renderSidebar(payload) {
  const focusMode = g('focusMode'), focusName = g('focusName');
  const centerEl = payload.centerNodeId
    ? payload.model.elements.find(e => e.data && e.data.id === payload.centerNodeId && !e.data.source)
    : null;
  if (focusMode) focusMode.textContent = payload.mode === 'vault' ? 'Explorer' : 'Local';
  if (focusName) {
    const selEl = payload.selectedNodeId
      ? payload.model.elements.find(e => e.data && e.data.id === payload.selectedNodeId && !e.data.source)
      : null;
    focusName.textContent = payload.mode === 'vault'
      ? (selEl ? selEl.data.label : 'Top connected notes')
      : centerEl ? centerEl.data.label : 'No active note';
  }
  const sbTitle = g('sbTitle');
  if (sbTitle) {
    sbTitle.textContent = payload.mode === 'vault' ? 'Vault Explorer'
      : (payload.centerNodeId && centerEl ? centerEl.data.label : 'Local Graph');
  }
  const sbDesc = g('sbDesc');
  if (sbDesc) {
    sbDesc.textContent = payload.mode === 'vault'
      ? 'Explorer ranks notes by structural signal, not just raw degree. Strong named relations, type diversity, and shared tags matter most.'
      : payload.centerNodeId
        ? 'Nearby linked notes around this note. Use Depth to widen the local view.'
        : 'Open a Markdown note then press Current Note to see its links.';
  }

  E.typeChips.innerHTML = (payload.model.types || []).map(t =>
    '<button class="chip' + (S.typeFilters.has(t.type) ? ' on' : '') + '" type="button" data-t="' + h(t.type) + '" aria-pressed="' + (S.typeFilters.has(t.type) ? 'true' : 'false') + '" aria-label="Toggle ' + h(t.type) + '">' +
      '<span class="chip-dot" style="background:' + h(t.color) + '"></span>' +
      h(t.type) + ' <span style="color:var(--mid)">' + t.count + '</span>' +
    '</button>'
  ).join('');
  E.typeChips.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => {
      const t = c.dataset.t;
      if (S.typeFilters.has(t)) S.typeFilters.delete(t); else S.typeFilters.add(t);
      c.classList.toggle('on');
      c.setAttribute('aria-pressed', c.classList.contains('on') ? 'true' : 'false');
      applyFilter();
    });
  });

  if (E.typeSel) {
    const prev = S.primaryTypeFilter || '';
    E.typeSel.innerHTML = '<option value="">All types</option>' + (payload.model.types || []).map(t =>
      '<option value="' + h(t.type) + '"' + (prev === t.type ? ' selected' : '') + '>' + h(t.type) + ' (' + t.count + ')</option>'
    ).join('');
    E.typeSel.value = prev;
  }

  E.topNodes.innerHTML = (payload.model.topNodes || []).map(n =>
    '<button class="nrow' + (n.id === S.selectedId ? ' on' : '') + '" type="button" data-id="' + h(n.id) + '" aria-pressed="' + (n.id === S.selectedId ? 'true' : 'false') + '" aria-label="Focus ' + h(n.label) + '">' +
      '<span class="nrow-dot" style="background:' + h(nodeColor(n.id)) + '"></span>' +
      '<span class="nrow-info">' +
        '<span class="nrow-name">' + h(n.label) + '</span>' +
        '<span class="nrow-sub">'  + h(n.type) + ' · signal ' + h(String(n.hubScore)) + (n.tagCount ? ' · #' + h(String(n.tagCount)) + ' tags' : '') + '</span>' +
      '</span>' +
      '<span class="nrow-deg">' + n.weightedDegree + '</span>' +
    '</button>'
  ).join('');
  E.topNodes.querySelectorAll('[data-id]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.id;
      selectNode(id);
      vsc.postMessage({ type:'selectNode', id });
    });
  });

  E.relList.innerHTML = (payload.model.relations || []).map(r =>
    '<div class="rrow">' +
      '<span class="rdot" style="background:' + h(r.color) + '"></span>' +
      '<span class="rname">' + h(r.field) + '</span>' +
      '<span class="rcnt">'  + r.totalWeight + '</span>' +
    '</div>'
  ).join('');

  const tagList = g('tagList');
  if (tagList) {
    tagList.innerHTML = (payload.model.topTags || []).length
      ? payload.model.topTags.map(t =>
          '<span class="chip"><span class="chip-dot" style="background:var(--accent3)"></span>#' + h(t.tag) + ' <span style="color:var(--mid)">' + t.count + '</span></span>'
        ).join('')
      : '<span class="sel-empty">No repeated themes yet.</span>';
  }

  updateSelCard();
}

// ── Main render ───────────────────────────────────────────────────────────────
function renderPayload(payload) {
  const previousCenterId = S.payload && S.payload.centerNodeId ? S.payload.centerNodeId : null;
  const previousSelectedId = S.payload && S.payload.selectedNodeId ? S.payload.selectedNodeId : null;
  S.payload = payload;
  const focusChanged = previousCenterId !== (payload.centerNodeId || null)
    || previousSelectedId !== (payload.selectedNodeId || null);
  if (focusChanged) {
    S.lastCameraSettleKey = '';
    S.lastSettledLayoutHash = '';
  }

  // Toolbar
  E.btnLocal.classList.toggle('on', payload.mode === 'local');
  E.btnVault.classList.toggle('on', payload.mode === 'vault');
  E.btnLocal.setAttribute('aria-pressed', payload.mode === 'local' ? 'true' : 'false');
  E.btnVault.setAttribute('aria-pressed', payload.mode === 'vault' ? 'true' : 'false');
  E.depthSel.value = String(payload.depth || 1);
  E.depthGroup.style.display = payload.mode === 'vault' ? 'none' : 'flex';

  // Mode help
  if (payload.mode === 'vault') {
    E.modeHelp.textContent = 'Explorer starts with the strongest connected notes in the vault. Pick a note to focus it, then expand outward.';
  } else {
    const depth = Number(payload.depth || 1);
    E.modeHelp.textContent = depth === 1
      ? 'Direct links shows the current note and the notes linked directly to it.'
      : depth === 2
        ? 'Extended links adds a second layer of notes linked to those direct notes.'
        : 'Broad links adds a third layer so you can see the widest local view around the current note.';
  }

  // Status
  updateStatus();

  // Empty state
  const s = payload.model.summary;
  const showEmpty = payload.noCenter || s.nodeCount === 0;
  E.empty.classList.toggle('show', showEmpty);
  if (payload.noCenter) {
    E.emptyTitle.textContent = 'No active note';
    E.emptyDesc.innerHTML = 'Open a Markdown note then press <b>Current Note</b>,<br>or switch to Explorer mode.';
  } else {
    E.emptyTitle.textContent = 'No graph nodes';
    E.emptyDesc.innerHTML = 'Open a Yamlink note with meaningful links,<br>or switch to Explorer mode.';
  }

  renderSidebar(payload);

  if (!payload.graphData || !payload.graphData.nodes.length) return;

  const nodeHash = payload.graphData.nodes.map(n => n.id).sort().join(',');
  const edgeHash = payload.graphData.edges.map(e => e.source + '->' + e.target + ':' + (e.field || '')).sort().join(',');
  const newHash = nodeHash + '|' + edgeHash;
  const changed = newHash !== S.lastHash;
  S.lastHash = newHash;

  if (changed || payload.forceLayout) {
    S.pendingLayoutHash = newHash;
    loadGraph(payload.graphData);
  } else if (focusChanged && S.renderer) {
    S.pendingLayoutHash = newHash;
    S.nextCameraSettleDuration = 180;
    settleCameraAfterLayout();
  }

  // Sync selection
  const selId = payload.mode === 'local'
    ? (payload.selectedNodeId || payload.centerNodeId || null)
    : (payload.selectedNodeId || S.selectedId || null);
  if (selId !== S.selectedId) S.selectedId = selId;
  if (S.selectedId && S.renderer) {
    S.renderer.setSelected(S.selectedId);
    updateSelCard(); updateTopNodeHighlights();
  }

  applySearch();
  applyFilter();
}

// ── Button listeners ──────────────────────────────────────────────────────────
E.btnLocal.addEventListener('click',  () => vsc.postMessage({ type:'setMode',  mode:'local' }));
E.btnVault.addEventListener('click',  () => vsc.postMessage({ type:'setMode',  mode:'vault' }));
E.btnReveal.addEventListener('click', () => vsc.postMessage({ type:'revealActive' }));
E.depthSel.addEventListener('change', () => vsc.postMessage({ type:'setDepth', depth:+E.depthSel.value }));
E.typeSel.addEventListener('change',  () => { S.primaryTypeFilter = E.typeSel.value || ''; applyFilter(); });
E.searchInp.addEventListener('input', () => { S.searchTerm = E.searchInp.value; applySearch(); });
E.btnZoomIn.addEventListener('click',  () => S.renderer && S.renderer.zoomBy(1.3));
E.btnZoomOut.addEventListener('click', () => S.renderer && S.renderer.zoomBy(0.77));
E.btnZoomFit.addEventListener('click', () => S.renderer && S.renderer.fitView({ duration: 220, padding: 72, maxZoom: 1.9 }));
if (E.btnSemantic) E.btnSemantic.addEventListener('click', () => toggleLayer('semantic'));
if (E.btnHealth)   E.btnHealth.addEventListener('click',   () => toggleLayer('health'));
if (E.btnLabels)   E.btnLabels.addEventListener('click',   cycleLabelMode);
// help-tip badges live inside Semantic/Health's own <button> (for layout
// simplicity) — without this, clicking the "?" to read its tooltip would
// also toggle the parent button's layer as an unwanted side effect.
document.querySelectorAll('.help-tip').forEach(el => el.addEventListener('click', ev => ev.stopPropagation()));
E.btnReset.addEventListener('click', () => {
  S.searchTerm = ''; S.typeFilters.clear(); S.primaryTypeFilter = '';
  E.searchInp.value = '';
  if (E.typeSel) E.typeSel.value = '';
  if (S.renderer) { S.renderer.setSearch(''); S.renderer.setFilter(null); }
  if (S.selectedId) selectNode(S.selectedId);
  if (S.payload) renderSidebar(S.payload);
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', ev => {
  if (E.ctx.classList.contains('show') && ev.key === 'Escape') { hideCtx(); return; }
  const tag = ev.target && ev.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  switch (ev.key) {
    case 'Tab':
      ev.preventDefault();
      cycleKeyboardSelection(ev.shiftKey ? -1 : 1);
      break;
    case 'ArrowLeft':
      ev.preventDefault();
      handleDirectionalSelection('left');
      break;
    case 'ArrowRight':
      ev.preventDefault();
      handleDirectionalSelection('right');
      break;
    case 'ArrowUp':
      ev.preventDefault();
      handleDirectionalSelection('up');
      break;
    case 'ArrowDown':
      ev.preventDefault();
      handleDirectionalSelection('down');
      break;
    case 'Escape':
      clearSel();
      break;
    case 'Enter':
      if (S.selectedId) vsc.postMessage({ type:'openNode',   id:S.selectedId });
      break;
    case 'f': case 'F': if (S.selectedId) vsc.postMessage({ type:'focusNode',  id:S.selectedId }); break;
    case 'e': case 'E': if (S.selectedId) vsc.postMessage({ type:'expandNode', id:S.selectedId }); break;
    case '/': ev.preventDefault(); E.searchInp.focus(); break;
  }
});

// ── VSCode message bus ────────────────────────────────────────────────────────
window.addEventListener('message', ev => {
  const m = ev.data;
  if (m && m.type === 'updateGraph') {
    // A live rebuild (vault mutation elsewhere, file watcher, etc.) can post
    // an update at any time — while time-lapse is showing a historical frame,
    // applying it would silently overwrite the canvas out from under the
    // scrubber. Keep the payload current for when the user exits, but don't
    // render it until then.
    S.payload = m.payload;
    if (!S.timelapse.active) renderPayload(m.payload);
  }
  if (m && m.type === 'timelapseData') onTimelapseData(m.payload);
});
window.addEventListener('error', ev => {
  const msg = (ev && ev.message) || '';
  if (/Cannot read prop.*'name'|reading "name"/.test(msg)) return;
  if (msg) vsc.postMessage({ type:'bootStatus', level:'error', text:msg });
});
window.addEventListener('unhandledrejection', ev => {
  vsc.postMessage({ type:'bootStatus', level:'error', text:String((ev && ev.reason) || 'rejection') });
});

vsc.postMessage({ type:'webviewReady' });
`;
}

function _clientBodyTimelapse() {
    return `// ── x-graph time-lapse ────────────────────────────────────────────────────────
// Frames arrive precomputed from the extension host (see graphTimelapse.js) —
// this is purely playback: settle each frame's layout synchronously, then
// tween the *rendered* positions from the previous frame to the new one so
// motion reads as continuous growth rather than a slideshow of re-layouts.
const TIMELAPSE_TWEEN_MS = 1800;
const TIMELAPSE_STEP_MS = 2100;
const TIMELAPSE_FIT_MS = 850;
// Real inline SVGs for play/pause/rewind, matching the icons baked into the
// boot HTML's initial button markup (graphBootHtml.js) — swapped in here via
// innerHTML since these buttons toggle state at runtime. Emoji (▶ ⏸ ⏪) read
// as unpolished/inconsistent across OS font stacks next to this panel's other
// plain-glyph controls.
const ICON_PLAY = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M1 0.6 L9 5 L1 9.4 Z"/></svg>';
const ICON_PAUSE = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="0.6" width="2.8" height="8.8"/><rect x="6.2" y="0.6" width="2.8" height="8.8"/></svg>';
const ICON_REWIND = '<svg width="12" height="10" viewBox="0 0 12 10" fill="currentColor"><path d="M6 0.4 L0.4 5 L6 9.6 Z"/><path d="M11.6 0.4 L6 5 L11.6 9.6 Z"/></svg>';

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutSine(t) {
  return Math.sin((Math.PI / 2) * Math.max(0, Math.min(1, t)));
}

function timelapseRevealAlpha(t, order, total) {
  const spread = total > 1 ? Math.min(0.42, total * 0.018) : 0;
  const delay = total > 1 ? (order / Math.max(1, total - 1)) * spread : 0.08;
  const local = Math.max(0, Math.min(1, (t - delay) / Math.max(0.001, 1 - delay)));
  return easeInOutCubic(local);
}

function formatTimelapseDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (_) {
    return iso;
  }
}

function updateTimelapseUI() {
  const tl = S.timelapse;
  if (!E.timelapseBar) return;
  if (tl.loading) {
    if (E.timelapseLabel) E.timelapseLabel.textContent = 'Reconstructing history…';
    return;
  }
  if (!tl.frames.length) {
    if (E.timelapseLabel) E.timelapseLabel.textContent = 'Not enough recorded history yet.';
    return;
  }
  const frame = tl.frames[tl.index];
  if (E.timelapseLabel) {
    E.timelapseLabel.textContent = formatTimelapseDate(frame.timestamp) +
      (tl.index === tl.frames.length - 1 ? ' (now)' : '') +
      '  ·  ' + frame.nodes.length + ' notes';
  }
  if (E.timelapseScrub) E.timelapseScrub.value = String(tl.index);
  const playingForward = tl.playing && tl.direction !== -1;
  const playingBackward = tl.playing && tl.direction === -1;
  if (E.btnTimelapsePlay) {
    E.btnTimelapsePlay.innerHTML = playingForward ? ICON_PAUSE : ICON_PLAY;
    E.btnTimelapsePlay.setAttribute('aria-label', playingForward ? 'Pause time-lapse' : 'Play time-lapse');
  }
  if (E.btnTimelapseRewind) {
    E.btnTimelapseRewind.innerHTML = playingBackward ? ICON_PAUSE : ICON_REWIND;
    E.btnTimelapseRewind.setAttribute('aria-label', playingBackward ? 'Pause time-lapse' : 'Play time-lapse backward');
  }
  if (E.timelapseBar) {
    E.timelapseBar.title = tl.source === 'git'
      ? 'Reconstructed from real git history — includes both frontmatter relations and body-text links.'
      : 'This vault has no git history to reconstruct from, so only frontmatter-declared relations are shown — links written in note body text cannot be replayed without git.';
  }
  // The regular statusbar otherwise keeps showing whatever mode/counts were
  // on screen before time-lapse was opened — replace it with the frame's own
  // counts so it doesn't read as stale/contradictory next to the scrub bar.
  if (E.statusbar) {
    E.statusbar.textContent = 'Time-lapse · ' + frame.nodes.length + ' notes · ' + frame.edges.length + ' links' +
      (frame.incomplete ? ' · some notes predate full history' : '');
  }
}

function timelapseEdgeKey(e) {
  return e.source + '|' + e.target + '|' + (e.field || '');
}

function timelapseVisibilityMasks(stageNodeIds, stageEdgeKeys, currentNodeIds, currentEdgeKeys) {
  const nodeMask = new Map();
  for (const id of stageNodeIds || []) {
    if (!currentNodeIds.has(id)) nodeMask.set(id, 0);
  }
  const edgeMask = new Map();
  for (const key of stageEdgeKeys || []) {
    if (!currentEdgeKeys.has(key)) edgeMask.set(key, 0);
  }
  return { nodeMask, edgeMask };
}

function prepareTimelapseStage() {
  const tl = S.timelapse;
  const r = ensureRenderer();
  if (!r || !S.layout || !tl.frames.length) return;
  const finalFrame = tl.frames[tl.frames.length - 1];
  tl.restoreLayoutPositions = S.layout && S.layout._lastPositions ? new Map(S.layout._lastPositions) : null;
  const finalPos = S.layout.settleSync(finalFrame.nodes, finalFrame.edges);
  r.load(finalFrame);
  r.updatePositions(finalPos);
  r.setNodeAlphaOverrides(new Map(finalFrame.nodes.map((n) => [n.id, 0])));
  r.setEdgeAlphaOverrides(new Map(finalFrame.edges.map((e) => [timelapseEdgeKey(e), 0])));
  r.fitView({ duration: 0, padding: 116, maxZoom: 1.45 });
  tl.stagePositions = Object.assign({}, finalPos);
  tl.stageFrame = finalFrame;
  tl.stageNodeIds = finalFrame.nodes.map((n) => n.id);
  tl.stageEdgeKeys = finalFrame.edges.map(timelapseEdgeKey);
  tl.stagePrepared = true;
}

function timelapseSpawnPositions(frame, targetPos, previousPos) {
  const spawned = {};
  const center = (() => {
    const vals = Object.values(previousPos || {});
    if (!vals.length) return { x: 0, y: 0 };
    return {
      x: vals.reduce((sum, p) => sum + p.x, 0) / vals.length,
      y: vals.reduce((sum, p) => sum + p.y, 0) / vals.length,
    };
  })();
  for (const node of frame.nodes || []) {
    if (previousPos[node.id]) continue;
    const neighborPositions = [];
    for (const edge of frame.edges || []) {
      const neighborId = edge.source === node.id ? edge.target : (edge.target === node.id ? edge.source : null);
      if (!neighborId) continue;
      const neighbor = previousPos[neighborId] || targetPos[neighborId];
      if (neighbor) neighborPositions.push(neighbor);
    }
    if (neighborPositions.length) {
      const anchor = neighborPositions.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
      spawned[node.id] = { x: anchor.x / neighborPositions.length, y: anchor.y / neighborPositions.length };
      continue;
    }
    const target = targetPos[node.id] || center;
    const angle = node.id.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) * 0.017;
    spawned[node.id] = {
      x: target.x + Math.cos(angle) * 24,
      y: target.y + Math.sin(angle) * 24,
    };
  }
  return spawned;
}

function stepTimelapseTween(now) {
  const tl = S.timelapse;
  const tw = tl.tween;
  if (!tw || !S.renderer) return;
  const t = Math.min(1, (now - tw.start) / tw.duration);
  const eased = easeInOutCubic(t);
  // Fade-in alpha deliberately does NOT reuse the position easing above: a
  // cubic ease-out is already ~66% of the way to full opacity by t=0.3, so a
  // fading-in node reads as an instant "pop" rather than a fade — most of the
  // visible change happens in the first fraction of the tween. Linear alpha
  // spreads the reveal evenly across the whole duration instead.
  const newNodeCount = tw.newNodeIds.length;
  const newEdgeCount = tw.newEdgeKeys.length;
  const pos = Object.assign({}, tw.stagePositions);
  const nodeAlphaOverrides = new Map();
  for (const id of tw.stageNodeIds) {
    if (!tw.currentNodeIds.has(id)) {
      nodeAlphaOverrides.set(id, 0);
      continue;
    }
    const to = tw.toPos[id];
    const from = tw.fromPos[id] || tw.spawnPos[id];
    if (from) {
      pos[id] = { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
    }
    const newNodeOrder = tw.newNodeOrder.get(id);
    if (newNodeOrder !== undefined) nodeAlphaOverrides.set(id, timelapseRevealAlpha(t, newNodeOrder, newNodeCount));
  }
  const edgeAlphaOverrides = new Map();
  for (const key of tw.stageEdgeKeys) {
    if (!tw.currentEdgeKeys.has(key)) {
      edgeAlphaOverrides.set(key, 0);
      continue;
    }
    const newEdgeOrder = tw.newEdgeOrder.get(key);
    if (newEdgeOrder !== undefined) edgeAlphaOverrides.set(key, timelapseRevealAlpha(t, newEdgeOrder, newEdgeCount));
  }
  S.renderer.updatePositions(pos);
  S.renderer.setNodeAlphaOverrides(nodeAlphaOverrides);
  S.renderer.setEdgeAlphaOverrides(edgeAlphaOverrides);
  if (t < 1) {
    tl.tweenRaf = requestAnimationFrame(stepTimelapseTween);
  } else {
    tl.tween = null;
    tl.tweenRaf = null;
    const masks = timelapseVisibilityMasks(tw.stageNodeIds, tw.stageEdgeKeys, tw.currentNodeIds, tw.currentEdgeKeys);
    S.renderer.setNodeAlphaOverrides(masks.nodeMask);
    S.renderer.setEdgeAlphaOverrides(masks.edgeMask);
    S.timelapse.cinematicPos = Object.assign({}, tw.toPos);
  }
}

function goToTimelapseFrame(index, opts) {
  opts = opts || {};
  const tl = S.timelapse;
  if (!tl.frames.length) return;
  const r = ensureRenderer();
  if (!r || !S.layout) return;
  const clamped = Math.max(0, Math.min(tl.frames.length - 1, index));
  const frame = tl.frames[clamped];
  const hadPrevious = !!tl.currentFrame;
  // On the very first frame shown, there's nothing to tween from — treat
  // every node/edge as newly-appeared so it fades in from nothing rather
  // than the whole reconstructed graph popping in at once.
  const prevPositions = hadPrevious ? Object.assign({}, tl.cinematicPos || Object.fromEntries(S.layout._lastPositions)) : {};
  const prevEdgeKeys = hadPrevious ? new Set(tl.currentFrame.edges.map(timelapseEdgeKey)) : new Set();

  if (tl.tweenRaf) { cancelAnimationFrame(tl.tweenRaf); tl.tweenRaf = null; }
  tl.tween = null;

  const toPos = tl.stagePositions
    ? Object.fromEntries(frame.nodes.map((n) => [n.id, tl.stagePositions[n.id]]).filter((entry) => !!entry[1]))
    : S.layout.settleSync(frame.nodes, frame.edges);
  if (!tl.stageFrame) r.load(frame);
  // Set real positions synchronously, before the tween's first animation
  // frame — otherwise fitView() (called below) and the very first paint see
  // whatever positions were left over from the previous view, not this
  // frame's actual layout.
  r.updatePositions(tl.stagePositions || toPos);
  tl.index = clamped;
  tl.currentFrame = frame;
  const currentNodeIds = new Set(frame.nodes.map((n) => n.id));
  const currentEdgeKeys = new Set(frame.edges.map(timelapseEdgeKey));

  if (opts.animate === false) {
    // Explicit non-animated jump (scrubbing) — snap directly, no fade.
    const masks = timelapseVisibilityMasks(
      tl.stageNodeIds || frame.nodes.map((n) => n.id),
      tl.stageEdgeKeys || frame.edges.map(timelapseEdgeKey),
      currentNodeIds,
      currentEdgeKeys
    );
    r.setNodeAlphaOverrides(masks.nodeMask);
    r.setEdgeAlphaOverrides(masks.edgeMask);
    tl.cinematicPos = Object.assign({}, toPos);
  } else {
    const spawnPos = timelapseSpawnPositions(frame, toPos, prevPositions);
    const initialPos = {};
    for (const n of frame.nodes) {
      initialPos[n.id] = prevPositions[n.id] || spawnPos[n.id] || toPos[n.id];
    }
    // Also set alpha to 0 for new nodes/edges synchronously, so there's no
    // one-frame flash at full opacity before the tween's first rAF tick.
    const initialNodeAlpha = new Map();
    const newNodeIds = [];
    for (const id of (tl.stageNodeIds || frame.nodes.map((n) => n.id))) {
      if (!currentNodeIds.has(id)) {
        initialNodeAlpha.set(id, 0);
      } else if (!prevPositions[id]) {
        initialNodeAlpha.set(id, 0);
        newNodeIds.push(id);
      }
    }
    for (const n of frame.nodes) {
      if (!prevPositions[n.id] && !newNodeIds.includes(n.id)) {
        initialNodeAlpha.set(n.id, 0);
        newNodeIds.push(n.id);
      }
    }
    const initialEdgeAlpha = new Map();
    const newEdgeKeys = [];
    for (const key of (tl.stageEdgeKeys || frame.edges.map(timelapseEdgeKey))) {
      if (!currentEdgeKeys.has(key)) {
        initialEdgeAlpha.set(key, 0);
      } else if (!prevEdgeKeys.has(key)) {
        initialEdgeAlpha.set(key, 0);
        newEdgeKeys.push(key);
      }
    }
    r.setNodeAlphaOverrides(initialNodeAlpha);
    r.setEdgeAlphaOverrides(initialEdgeAlpha);
    tl.tween = {
      fromPos: prevPositions, spawnPos, toPos, frameNodes: frame.nodes, frameEdges: frame.edges, prevEdgeKeys,
      stagePositions: tl.stagePositions || toPos,
      stageNodeIds: tl.stageNodeIds || frame.nodes.map((n) => n.id),
      stageEdgeKeys: tl.stageEdgeKeys || frame.edges.map(timelapseEdgeKey),
      currentNodeIds,
      currentEdgeKeys,
      newNodeIds, newEdgeKeys,
      newNodeOrder: new Map(newNodeIds.map((id, i) => [id, i])),
      newEdgeOrder: new Map(newEdgeKeys.map((key, i) => [key, i])),
      start: performance.now(), duration: opts.duration || TIMELAPSE_TWEEN_MS
    };
    r.updatePositions(initialPos);
    tl.tweenRaf = requestAnimationFrame(stepTimelapseTween);
  }
  if (opts.animate === false && !opts.preserveCamera) r.fitView({ duration: hadPrevious ? TIMELAPSE_FIT_MS : 0, padding: 116, maxZoom: 1.45 });
  updateTimelapseUI();
}

function pauseTimelapse() {
  const tl = S.timelapse;
  tl.playing = false;
  if (tl.playTimer) { clearTimeout(tl.playTimer); tl.playTimer = null; }
  updateTimelapseUI();
}

function scheduleNextTimelapseFrame() {
  const tl = S.timelapse;
  if (!tl.playing) return;
  tl.playTimer = setTimeout(() => {
    if (!tl.playing) return;
    const nextIndex = tl.index + (tl.direction || 1);
    if (nextIndex < 0 || nextIndex > tl.frames.length - 1) {
      pauseTimelapse();
      return;
    }
    goToTimelapseFrame(nextIndex);
    scheduleNextTimelapseFrame();
  }, TIMELAPSE_STEP_MS);
}

function playTimelapse(direction) {
  const tl = S.timelapse;
  if (!tl.frames.length) return;
  tl.direction = direction === -1 ? -1 : 1;
  let wrapped = false;
  if (tl.direction > 0 && tl.index >= tl.frames.length - 1) { tl.index = 0; wrapped = true; }
  if (tl.direction < 0 && tl.index <= 0) { tl.index = tl.frames.length - 1; wrapped = true; }
  tl.playing = true;
  updateTimelapseUI();
  if (wrapped) goToTimelapseFrame(tl.index, { animate: false, preserveCamera: true });
  scheduleNextTimelapseFrame();
}

function toggleTimelapsePlay() {
  const tl = S.timelapse;
  if (tl.playing && tl.direction !== -1) pauseTimelapse();
  else playTimelapse(1);
}

function toggleTimelapseRewind() {
  const tl = S.timelapse;
  if (tl.playing && tl.direction === -1) pauseTimelapse();
  else playTimelapse(-1);
}

function onTimelapseData(payload) {
  const tl = S.timelapse;
  tl.loading = false;
  if (E.timelapseBar) E.timelapseBar.removeAttribute('aria-busy');
  tl.source = (payload && payload.source) || 'mutation-log';
  tl.frames = (payload && payload.frames) || [];
  tl.index = 0;
  tl.direction = 1;
  tl.currentFrame = null;
  tl.cinematicPos = null;
  tl.stagePositions = null;
  tl.stagePrepared = false;
  tl.stageFrame = null;
  tl.stageNodeIds = null;
  tl.stageEdgeKeys = null;
  tl.restoreLayoutPositions = null;
  if (!tl.frames.length) { updateTimelapseUI(); return; }
  // Land on the earliest checkpoint first, faded in from nothing — this is
  // meant to read as "here's how the vault grew," so the first thing you see
  // should be the sparse beginning, not the full current graph. Press Play
  // (or drag the scrubber) to watch it grow forward from here.
  const lastIndex = tl.frames.length - 1;
  if (E.timelapseScrub) {
    E.timelapseScrub.max = String(Math.max(0, lastIndex));
    E.timelapseScrub.value = '0';
  }
  prepareTimelapseStage();
  goToTimelapseFrame(0, { animate: true });
}

function enterTimelapse() {
  const tl = S.timelapse;
  tl.active = true;
  tl.loading = true;
  if (E.btnTimelapse) E.btnTimelapse.classList.add('on');
  if (E.modeHelp) E.modeHelp.style.display = 'none';
  if (E.timelapseBar) { E.timelapseBar.style.display = 'flex'; E.timelapseBar.setAttribute('aria-busy', 'true'); }
  // A type/search filter left active from the live view would otherwise
  // silently carry over into the historical reconstruction and hide most of
  // it — time-lapse always shows the full reconstructed graph, unfiltered.
  // Restored on exit by renderPayload()'s own applySearch()/applyFilter() calls.
  if (S.renderer) { S.renderer.setFilter(null); S.renderer.setSearch(''); }
  // A selected/hovered node left over from the live view keeps _isDimmed()'s
  // focus-dimming active (everything not connected to it drops to ~12%
  // opacity) — that's the real reason time-lapse could look permanently
  // faded regardless of the fade-in tween: the tween's alpha multiplies on
  // top of an already-dim baseline. Time-lapse has no concept of a focused
  // node, so clear it outright; restored on exit via renderPayload().
  S.selectedId = null;
  if (S.renderer) S.renderer.setSelected(null);
  updateTimelapseUI();
  vsc.postMessage({ type: 'requestTimelapse' });
}

function exitTimelapse() {
  const tl = S.timelapse;
  pauseTimelapse();
  if (tl.tweenRaf) { cancelAnimationFrame(tl.tweenRaf); tl.tweenRaf = null; }
  tl.tween = null;
  tl.active = false;
  tl.stagePositions = null;
  tl.stagePrepared = false;
  tl.stageFrame = null;
  tl.stageNodeIds = null;
  tl.stageEdgeKeys = null;
  if (S.layout && tl.restoreLayoutPositions) S.layout._lastPositions = new Map(tl.restoreLayoutPositions);
  tl.restoreLayoutPositions = null;
  if (E.btnTimelapse) E.btnTimelapse.classList.remove('on');
  if (E.modeHelp) E.modeHelp.style.display = '';
  if (E.timelapseBar) E.timelapseBar.style.display = 'none';
  if (S.renderer) { S.renderer.setNodeAlphaOverrides(new Map()); S.renderer.setEdgeAlphaOverrides(new Map()); }
  S.lastCameraSettleKey = '';
  S.lastSettledLayoutHash = '';
  S.nextCameraSettleDuration = 0;
  S.hasRenderedGraph = false;
  // renderPayload() skips reloading the renderer when the live payload's
  // hash hasn't changed since it was last shown — true here, since nothing
  // about the live graph changed while time-lapse was open. But time-lapse
  // overwrote the renderer's actual node/edge data with historical frames in
  // between, so that dedup check must be defeated on exit or the last
  // historical frame stays stuck on screen permanently.
  S.lastHash = '';
  if (S.payload) renderPayload(S.payload);
}

function toggleTimelapse() {
  if (S.timelapse.active) exitTimelapse();
  else enterTimelapse();
}

if (E.btnTimelapse) E.btnTimelapse.addEventListener('click', toggleTimelapse);
if (E.btnTimelapseExit) E.btnTimelapseExit.addEventListener('click', exitTimelapse);
if (E.btnTimelapsePlay) E.btnTimelapsePlay.addEventListener('click', toggleTimelapsePlay);
if (E.btnTimelapseRewind) E.btnTimelapseRewind.addEventListener('click', toggleTimelapseRewind);
if (E.timelapseScrub) {
  E.timelapseScrub.addEventListener('input', () => {
    pauseTimelapse();
    goToTimelapseFrame(+E.timelapseScrub.value, { animate: true, duration: 220 });
  });
}
`;
}

module.exports = {
    _clientBodySetup,
    _clientBodyRendering,
    _clientBodyTooltipsAndContextMenu,
    _clientBodySelection,
    _clientBodySearchAndFilter,
    _clientBodySidebarAndPayload,
    _clientBodyTimelapse,
};
