'use strict';

/**
 * Generates the inline <script type="module"> for the sidebar x-graph webview.
 * Imports Canvas2DRenderer only (no d3-force). Physics via inline SimpleLayout.
 *
 * @param {string} rendererUri  - webview URI string for Canvas2DRenderer.js
 */
function buildGraph2SidebarXGraphScript(rendererUri) {
    return (
        'import { Canvas2DRenderer } from \'' + rendererUri + '\';\n' +
        _sidebarBody()
    );
}

function _sidebarBody() { return `
const vsc = acquireVsCodeApi();

// ── State ─────────────────────────────────────────────────────────────────────
let renderer = null;
let layout   = null;
let selectedId = null;
let lastHash     = '';
let lastNodeHash = '';
let lastScope    = '';
const layers = { semantic: false, health: false };

// ── SimpleLayout (vanilla JS, no d3-force) ────────────────────────────────────
class SimpleLayout {
  constructor(onPos, onSettled) {
    this._onPos = onPos; this._onSettled = onSettled;
    this._nodes = []; this._edges = []; this._idx = new Map();
    this._clusterAnchors = new Map(); this._clusterMeta = new Map();
    this._pinned = new Set(); this._raf = null; this._alpha = 0; this._iter = 0;
    this._quality = this._qualityProfile(0);
    this._lastPositions = new Map();
  }

  init(nodeData, edgeData) {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    this._alpha = 1; this._iter = 0;
    this._quality = this._qualityProfile(nodeData.length);
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
        id: n.id, clusterId, anchorAngle: angle, orbitRadius: radius,
        weight: n.weight || 0,
        x: usePrev ? prev.x : (seededX + (Math.random() * 2 - 1) * 16),
        y: usePrev ? prev.y : (seededY + (Math.random() * 2 - 1) * 16),
        vx: 0, vy: 0
      };
    });
  }

  run() {
    if (this._raf) cancelAnimationFrame(this._raf);
    // Pre-warm synchronously to eliminate the "big bang" jitter on first frame.
    while (this._alpha > this._quality.prewarmAlpha && this._iter < this._quality.prewarmTicks) {
      this._alpha *= this._quality.alphaDecay; this._step(this._alpha); this._iter++;
    }
    const tick = () => {
      this._alpha *= this._quality.alphaDecay; this._iter++;
      this._step(this._alpha);
      const converged = this._iter > 30 && (this._maxDeltaSq || 0) < 0.04;
      const done = this._alpha < this._quality.minAlpha || this._iter >= this._quality.maxTicks || converged;
      const pos = {}; for (const n of this._nodes) pos[n.id] = { x:n.x, y:n.y };
      this._rememberPositions(pos);
      if (done) { this._raf = null; this._onSettled && this._onSettled(pos); }
      else { this._onPos && this._onPos(pos); this._raf = requestAnimationFrame(tick); }
    };
    this._raf = requestAnimationFrame(tick);
  }

  _step(a) {
    const nodes = this._nodes, charge = this._quality.charge, cellSize = this._quality.cellSize;
    const grid = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      const gx = Math.floor(nd.x / cellSize), gy = Math.floor(nd.y / cellSize);
      const key = gx + ',' + gy;
      let bucket = grid.get(key);
      if (!bucket) { bucket = []; grid.set(key, bucket); }
      bucket.push(i);
    }
    for (let i = 0; i < nodes.length; i++) {
      const src = nodes[i];
      const gx = Math.floor(src.x / cellSize), gy = Math.floor(src.y / cellSize);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get((gx + ox) + ',' + (gy + oy));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const dst = nodes[j];
            const dx = dst.x - src.x, dy = dst.y - src.y;
            const f = charge * a / (dx*dx + dy*dy + 16);
            src.vx -= dx * f; src.vy -= dy * f;
            dst.vx += dx * f; dst.vy += dy * f;
          }
        }
      }
    }
    const ideal = this._quality.idealDistance;
    for (const e of this._edges) {
      const si = this._idx.get(e.source), ti = this._idx.get(e.target);
      if (si === undefined || ti === undefined) continue;
      const s = nodes[si], t = nodes[ti];
      const dx = t.x-s.x, dy = t.y-s.y, dist = Math.sqrt(dx*dx+dy*dy)||1;
      const f = (dist-ideal)*a*this._quality.springStrength/dist;
      if (!this._pinned.has(s.id)) { s.vx += dx*f; s.vy += dy*f; }
      if (!this._pinned.has(t.id)) { t.vx -= dx*f; t.vy -= dy*f; }
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
      nd.vx -= nd.x * this._quality.centerPull * (1 + (nd.weight || 0) * 1.5) * a;
      nd.vy -= nd.y * this._quality.centerPull * (1 + (nd.weight || 0) * 1.5) * a;
    }
    let maxDeltaSq = 0;
    for (const nd of nodes) {
      if (this._pinned.has(nd.id)) { nd.vx=0; nd.vy=0; continue; }
      nd.vx *= this._quality.damping; nd.vy *= this._quality.damping; nd.x += nd.vx; nd.y += nd.vy;
      const dsq = nd.vx * nd.vx + nd.vy * nd.vy;
      if (dsq > maxDeltaSq) maxDeltaSq = dsq;
    }
    this._maxDeltaSq = maxDeltaSq;
  }

  _buildGraph(nodeData, edgeData) {
    const adjacency = new Map();
    const degrees = new Map();
    for (const n of nodeData) {
      adjacency.set(n.id, new Set());
      const degree = (n.edges && n.edges.length) ? n.edges.length : 0;
      degrees.set(n.id, degree * 1.25 + (n.weight || 0) * 12);
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
    if (anchors.length === 1) {
      clusterAnchors.set(anchors[0], { x: 0, y: 0 });
    } else {
      clusterAnchors.set(anchors[0], { x: 0, y: 0 });
      const ringRadius = Math.max(this._quality.ringRadiusMin, Math.sqrt(nodeData.length) * this._quality.ringRadiusScale);
      for (let i = 1; i < anchors.length; i++) {
        const angle = i * 2.39996; // golden angle — avoids uniform ring spacing
        const r = ringRadius * (0.35 + 0.65 * Math.sqrt(i / anchors.length));
        clusterAnchors.set(anchors[i], { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
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
        if (score > bestScore) { bestScore = score; bestCluster = anchorId; }
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
      members.slice().sort((a, b) => (degrees.get(b) || 0) - (degrees.get(a) || 0)).forEach((id, index) => clusterRank.set(id, index));
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
    return { nodeCluster, clusterAnchors, clusterMeta, clusterRank };
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
    if (count >= 1200) {
      return { clusterCount: 9, prewarmTicks: 58, prewarmAlpha: 0.15, maxTicks: 180, minAlpha: 0.016, alphaDecay: 0.965, cellSize: 210, charge: 760, idealDistance: 70, springStrength: 0.17, centerPull: 0.0028, damping: 0.84, ringRadiusMin: 320, ringRadiusScale: 21, orbitBase: 86, orbitClusterScale: 12, orbitRankStep: 15, orbitWeightStep: 18, orbitSnap: 0.022, anchorPull: 0.07, memberPull: 0.0065 };
    }
    if (count >= 500) {
      return { clusterCount: 8, prewarmTicks: 35, prewarmAlpha: 0.12, maxTicks: 260, minAlpha: 0.011, alphaDecay: 0.973, cellSize: 190, charge: 900, idealDistance: 88, springStrength: 0.19, centerPull: 0.0037, damping: 0.82, ringRadiusMin: 280, ringRadiusScale: 19, orbitBase: 78, orbitClusterScale: 11, orbitRankStep: 14, orbitWeightStep: 17, orbitSnap: 0.023, anchorPull: 0.074, memberPull: 0.007 };
    }
    return { clusterCount: Math.max(1, Math.min(8, Math.round(Math.sqrt(Math.max(1, count)) / 4))), prewarmTicks: 150, prewarmAlpha: 0.10, maxTicks: 400, minAlpha: 0.005, alphaDecay: 0.985, cellSize: 170, charge: 1050, idealDistance: count > 300 ? 100 : 118, springStrength: 0.22, centerPull: 0.006, damping: 0.78, ringRadiusMin: 220, ringRadiusScale: 16, orbitBase: 72, orbitClusterScale: 10, orbitRankStep: 12, orbitWeightStep: 14, orbitSnap: 0.025, anchorPull: 0.08, memberPull: 0.008 };
  }

  _rememberPositions(pos) {
    this._lastPositions = new Map(Object.entries(pos));
  }

  dragStart(id) { this._pinned.add(id); }
  drag(id,x,y) { const i=this._idx.get(id); if(i!==undefined){const n=this._nodes[i];n.x=x;n.y=y;n.vx=0;n.vy=0;} }
  dragEnd(id)   { this._pinned.delete(id); }
  destroy()     { if (this._raf) cancelAnimationFrame(this._raf); }
}

// ── Renderer factory ──────────────────────────────────────────────────────────
function ensureRenderer() {
  if (renderer) return renderer;
  const container = document.getElementById('graph-container');
  if (!container) return null;

  renderer = new Canvas2DRenderer(container, {
    onNodeClick: (id, node) => {
      selectedId = (id === selectedId) ? null : (id || null);
      renderer.setSelected(selectedId);
      updateNodeBar(selectedId, node);
      if (selectedId) vsc.postMessage({ type:'openNode', id: selectedId });
    },
    onNodeContextMenu: (id, node) => {
      if (id) {
        selectedId = id;
        renderer.setSelected(id);
        updateNodeBar(id, node);
        vsc.postMessage({ type:'openNode', id });
      }
    },
    onNodeDragStart: id  => layout && layout.dragStart(id),
    onNodeDrag:      (id,x,y) => layout && layout.drag(id,x,y),
    onNodeDragEnd:   id  => layout && layout.dragEnd(id),
  });

  layout = new SimpleLayout(
    pos => renderer.updatePositions(pos),
    pos => {
      if (pos) renderer.updatePositions(pos);
      if (selectedId) {
        renderer.focusNode(selectedId, {
          zoom: 1.08,
          preserveHigherZoom: true,
          duration: 0,
        });
      } else {
        renderer.fitView({ duration: 0, padding: 56, maxZoom: 1.85 });
      }
    }
  );

  new ResizeObserver(entries => {
    const e = entries[0];
    if (e && renderer) renderer.resize(e.contentRect.width, e.contentRect.height);
  }).observe(container);

  // Re-apply current layer state to new renderer instance
  renderer.setLayer('semantic', layers.semantic);
  renderer.setLayer('health',   layers.health);

  return renderer;
}

// ── Node bar ─────────────────────────────────────────────────────────────────
function updateNodeBar(id, node) {
  const bar = document.getElementById('nodeBar');
  const label = document.getElementById('nodeBarLabel');
  if (!bar) return;
  if (id) {
    if (label) label.textContent = (node && node.label) || id;
    bar.classList.add('show');
  } else {
    bar.classList.remove('show');
  }
}

function getKeyboardNodeOrder() {
  if (!renderer || !renderer._nodeMap) return [];
  return [...renderer._nodeMap.keys()].sort((a, b) => {
    const na = renderer._nodeMap.get(a) || {};
    const nb = renderer._nodeMap.get(b) || {};
    const wa = Number(na.weight || 0);
    const wb = Number(nb.weight || 0);
    if (wb !== wa) return wb - wa;
    return String(a).localeCompare(String(b));
  });
}

function focusSelectedNode(id) {
  if (!renderer || !id) return;
  selectedId = id;
  renderer.setSelected(id);
  if (typeof renderer.focusNode === 'function') {
    renderer.focusNode(id, { preserveHigherZoom: true, duration: 180 });
  }
  updateNodeBar(id, renderer._nodeMap ? renderer._nodeMap.get(id) : null);
}

function cycleKeyboardSelection(direction) {
  const order = getKeyboardNodeOrder();
  if (!order.length) return;
  const currentId = (renderer && renderer._selectedId) || selectedId || null;
  const currentIndex = currentId ? order.indexOf(currentId) : -1;
  const nextIndex = currentIndex === -1
    ? (direction > 0 ? 0 : order.length - 1)
    : (currentIndex + direction + order.length) % order.length;
  focusSelectedNode(order[nextIndex]);
}

function findDirectionalNode(direction) {
  if (!renderer || !renderer._nodeMap || !renderer._positions) return null;
  const currentId = renderer._selectedId || selectedId || null;
  if (!currentId) return null;
  const current = renderer._positions[currentId];
  if (!current) return null;

  let bestId = null;
  let bestDistance = Infinity;
  for (const [id] of renderer._nodeMap.entries()) {
    if (id === currentId) continue;
    const pos = renderer._positions[id];
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

// ── Layer toggles ─────────────────────────────────────────────────────────────
function toggleLayer(name) {
  layers[name] = !layers[name];
  if (renderer) renderer.setLayer(name, layers[name]);
  const btn = document.getElementById(name + 'Btn');
  if (btn) btn.classList.toggle('on', layers[name]);
}

// ── Main render ───────────────────────────────────────────────────────────────
function render(payload) {
  // Scope buttons
  document.querySelectorAll('[data-scope]').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.scope === (payload.scope || 'vault'));
  });

  // Count badge
  const badge = document.getElementById('countBadge');
  if (badge) {
    const nc = payload.model.summary.nodeCount;
    const ec = payload.model.summary.edgeCount;
    const localScope = payload.scope === 'local' || payload.scope === 'neighborhood';
    if (nc === 0 && localScope) {
      badge.textContent = 'Open a note to see its graph';
    } else {
      badge.textContent = nc + ' notes · ' + ec + ' links';
    }
  }

  if (!payload.graphData || !payload.graphData.nodes.length) return;

  const nodeHash = payload.graphData.nodes.map(n => n.id).sort().join(',');
  const edgeHash = payload.graphData.edges.map(e => e.source + '->' + e.target).sort().join(',');
  const newHash  = nodeHash + '|' + edgeHash;
  const changed  = newHash !== lastHash;
  const newScope = payload.scope || 'vault';
  const scopeChanged = newScope !== lastScope;
  lastHash  = newHash;
  lastScope = newScope;

  if (changed) {
    const r = ensureRenderer();
    if (!r) return;
    if (nodeHash !== lastNodeHash) {
      layout.init(payload.graphData.nodes, payload.graphData.edges);
    }
    r.load(payload.graphData);
    if (nodeHash !== lastNodeHash) {
      layout.run();
    }
    lastNodeHash = nodeHash;
  } else if (scopeChanged && renderer) {
    // Scope switched but data unchanged — re-center the view so the button feels responsive
    renderer.fitView({ duration: 200, padding: 56, maxZoom: 1.85 });
  }

  if (selectedId && renderer) renderer.setSelected(selectedId);
}

// ── Event listeners ───────────────────────────────────────────────────────────
document.querySelectorAll('[data-scope]').forEach(btn => {
  btn.addEventListener('click', () => vsc.postMessage({ type:'setScope', scope: btn.dataset.scope }));
});

const currentBtn = document.getElementById('currentBtn');
if (currentBtn) currentBtn.addEventListener('click', () => vsc.postMessage({ type:'focusCurrent' }));

const fitBtn = document.getElementById('fitBtn');
if (fitBtn) fitBtn.addEventListener('click', () => renderer && renderer.fitView({ duration: 200, padding: 56, maxZoom: 1.85 }));

const semanticBtn = document.getElementById('semanticBtn');
if (semanticBtn) semanticBtn.addEventListener('click', () => toggleLayer('semantic'));

const healthBtn = document.getElementById('healthBtn');
if (healthBtn) healthBtn.addEventListener('click', () => toggleLayer('health'));

const exploreBtn = document.getElementById('exploreBtn');
if (exploreBtn) exploreBtn.addEventListener('click', () => {
  if (selectedId) vsc.postMessage({ type:'exploreNode', id: selectedId });
});

const openNodeBtn = document.getElementById('openNodeBtn');
if (openNodeBtn) openNodeBtn.addEventListener('click', () => {
  if (selectedId) vsc.postMessage({ type:'openNode', id: selectedId });
});

const dismissNodeBtn = document.getElementById('dismissNodeBtn');
if (dismissNodeBtn) dismissNodeBtn.addEventListener('click', () => {
  selectedId = null;
  if (renderer) renderer.setSelected(null);
  updateNodeBar(null, null);
});

document.addEventListener('keydown', ev => {
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
    case 'Enter':
      if (selectedId) vsc.postMessage({ type:'openNode', id: selectedId });
      break;
    case 'Escape':
      selectedId = null;
      if (renderer) renderer.setSelected(null);
      updateNodeBar(null, null);
      break;
  }
});

window.addEventListener('message', ev => {
  const m = ev.data;
  if (m && m.type === 'graph2:update') render(m.payload);
});
window.addEventListener('error', ev => {
  const msg = (ev && ev.message) || '';
  if (msg) vsc.postMessage({ type:'bootStatus', level:'error', text: msg });
});
window.addEventListener('unhandledrejection', ev => {
  vsc.postMessage({ type:'bootStatus', level:'error', text: String((ev && ev.reason) || 'rejection') });
});

vsc.postMessage({ type:'graph2:ready' });
`; }

module.exports = { buildGraph2SidebarXGraphScript };
