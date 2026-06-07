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
const layers = { semantic: false, health: false };

// ── SimpleLayout (vanilla JS, no d3-force) ────────────────────────────────────
class SimpleLayout {
  constructor(onPos, onSettled) {
    this._onPos = onPos; this._onSettled = onSettled;
    this._nodes = []; this._edges = []; this._idx = new Map();
    this._pinned = new Set(); this._raf = null; this._alpha = 0; this._iter = 0;
  }

  init(nodeData, edgeData) {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    this._alpha = 1; this._iter = 0;
    const spread = Math.max(200, Math.sqrt(nodeData.length) * 110);
    this._nodes = nodeData.map(n => ({
      id: n.id, x: (Math.random()*2-1)*spread, y: (Math.random()*2-1)*spread, vx:0, vy:0
    }));
    this._edges = edgeData;
    this._idx   = new Map(this._nodes.map((n,i) => [n.id, i]));
  }

  run() {
    if (this._raf) cancelAnimationFrame(this._raf);
    // Pre-warm synchronously to eliminate the "big bang" jitter on first frame.
    while (this._alpha > 0.4 && this._iter < 80) {
      this._alpha *= 0.985; this._step(this._alpha); this._iter++;
    }
    const tick = () => {
      this._alpha *= 0.985; this._iter++;
      const done = this._alpha < 0.005 || this._iter >= 320;
      this._step(this._alpha);
      const pos = {}; for (const n of this._nodes) pos[n.id] = { x:n.x, y:n.y };
      if (done) { this._raf = null; this._onSettled && this._onSettled(pos); }
      else { this._onPos && this._onPos(pos); this._raf = requestAnimationFrame(tick); }
    };
    this._raf = requestAnimationFrame(tick);
  }

  _step(a) {
    const nodes = this._nodes, n = nodes.length, charge = 1800;
    for (let i = 0; i < n; i++) {
      for (let j = i+1; j < n; j++) {
        const dx = nodes[j].x-nodes[i].x, dy = nodes[j].y-nodes[i].y;
        const f  = charge * a / (dx*dx + dy*dy + 0.1);
        nodes[i].vx -= dx*f; nodes[i].vy -= dy*f;
        nodes[j].vx += dx*f; nodes[j].vy += dy*f;
      }
    }
    const ideal = 120;
    for (const e of this._edges) {
      const si = this._idx.get(e.source), ti = this._idx.get(e.target);
      if (si === undefined || ti === undefined) continue;
      const s = nodes[si], t = nodes[ti];
      const dx = t.x-s.x, dy = t.y-s.y, dist = Math.sqrt(dx*dx+dy*dy)||1;
      const f = (dist-ideal)*a*0.3/dist;
      if (!this._pinned.has(s.id)) { s.vx += dx*f; s.vy += dy*f; }
      if (!this._pinned.has(t.id)) { t.vx -= dx*f; t.vy -= dy*f; }
    }
    for (const nd of nodes) {
      if (this._pinned.has(nd.id)) continue;
      nd.vx -= nd.x*0.04*a; nd.vy -= nd.y*0.04*a;
    }
    for (const nd of nodes) {
      if (this._pinned.has(nd.id)) { nd.vx=0; nd.vy=0; continue; }
      nd.vx *= 0.65; nd.vy *= 0.65; nd.x += nd.vx; nd.y += nd.vy;
    }
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
    pos => { if (pos) renderer.updatePositions(pos); renderer.fitView(); }
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
  lastHash = newHash;

  if (changed) {
    const r = ensureRenderer();
    if (!r) return;
    r.load(payload.graphData);
    if (nodeHash !== lastNodeHash) {
      layout.init(payload.graphData.nodes, payload.graphData.edges);
      layout.run();
    }
    lastNodeHash = nodeHash;
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
if (fitBtn) fitBtn.addEventListener('click', () => renderer && renderer.fitView());

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
