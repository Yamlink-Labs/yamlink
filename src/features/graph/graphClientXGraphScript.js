'use strict';

/**
 * Generates the inline <script type="module"> content for the x-graph webview.
 * Uses Canvas2DRenderer directly with a self-contained SimpleLayout (no d3-force).
 *
 * @param {string} rendererUri  - webview URI for graph/renderer/Canvas2DRenderer.js
 * @param {string} buildTime    - ISO timestamp injected as BUILD constant
 */
function buildGraphClientXGraphScript(rendererUri, buildTime) {
    return (
        'import { Canvas2DRenderer } from \'' + rendererUri + '\';\n' +
        'const BUILD = \'' + buildTime + '\';\n' +
        _clientBody()
    );
}

function _clientBody() { return `
const vsc = acquireVsCodeApi();

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  renderer: null, layout: null, payload: null, selectedId: null,
  searchTerm: '', typeFilters: new Set(), primaryTypeFilter: '', ctxId: null, lastHash: '',
};
const layers = { semantic: false, health: false };

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
  btnSemantic: g('btnSemantic'), btnHealth: g('btnHealth'),
  selCard: g('selCard'), typeChips: g('typeChips'), topNodes: g('topNodes'), relList: g('relList'), tagList: g('tagList'),
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
    this._pinned = new Set();
    this._raf = null;
    this._alpha = 0;
    this._iter = 0;
  }

  init(nodeData, edgeData) {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    this._alpha = 1;
    this._iter  = 0;
    const spread = Math.max(200, Math.sqrt(nodeData.length) * 120);
    this._nodes = nodeData.map(n => ({
      id: n.id,
      x:  (Math.random() * 2 - 1) * spread,
      y:  (Math.random() * 2 - 1) * spread,
      vx: 0, vy: 0,
    }));
    this._edges = edgeData;
    this._idx   = new Map(this._nodes.map((n, i) => [n.id, i]));
  }

  run() {
    if (this._raf) cancelAnimationFrame(this._raf);
    // Pre-warm: run synchronous ticks until alpha drops to ~0.4 so the first
    // rendered frame is already in a stable-ish layout (eliminates the "big bang"
    // jitter where nodes shoot across the canvas at full force).
    while (this._alpha > 0.4 && this._iter < 80) {
      this._alpha *= 0.985;
      this._step(this._alpha);
      this._iter++;
    }
    const tick = () => {
      this._alpha *= 0.985;
      this._iter++;
      const done = this._alpha < 0.005 || this._iter >= 320;
      this._step(this._alpha);
      const pos = {};
      for (const n of this._nodes) pos[n.id] = { x: n.x, y: n.y };
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
    const n = nodes.length;
    const charge = 1800;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const d2 = dx * dx + dy * dy + 0.1;
        const f  = charge * a / d2;
        nodes[i].vx -= dx * f; nodes[i].vy -= dy * f;
        nodes[j].vx += dx * f; nodes[j].vy += dy * f;
      }
    }
    const ideal = 130;
    for (const e of this._edges) {
      const si = this._idx.get(e.source), ti = this._idx.get(e.target);
      if (si === undefined || ti === undefined) continue;
      const s = nodes[si], t = nodes[ti];
      const dx = t.x - s.x, dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (dist - ideal) * a * 0.3 / dist;
      if (!this._pinned.has(s.id)) { s.vx += dx * f; s.vy += dy * f; }
      if (!this._pinned.has(t.id)) { t.vx -= dx * f; t.vy -= dy * f; }
    }
    for (const nd of nodes) {
      if (this._pinned.has(nd.id)) continue;
      nd.vx -= nd.x * 0.04 * a;
      nd.vy -= nd.y * 0.04 * a;
    }
    for (const nd of nodes) {
      if (this._pinned.has(nd.id)) { nd.vx = 0; nd.vy = 0; continue; }
      nd.vx *= 0.65; nd.vy *= 0.65;
      nd.x  += nd.vx; nd.y  += nd.vy;
    }
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
function ensureRenderer() {
  if (S.renderer) return S.renderer;
  if (!E.gc) { vsc.postMessage({ type:'bootStatus', level:'error', text:'graph container not found' }); return null; }

  S.renderer = new Canvas2DRenderer(E.gc, {
    onNodeClick: (id) => {
      const prev = S.selectedId;
      S.selectedId = (id === prev) ? null : (id || null);
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
      S.renderer.fitView();
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

  return S.renderer;
}

function toggleLayer(name) {
  layers[name] = !layers[name];
  if (S.renderer) S.renderer.setLayer(name, layers[name]);
  const btn = name === 'semantic' ? E.btnSemantic : E.btnHealth;
  if (btn) btn.classList.toggle('on', layers[name]);
}

function loadGraph(graphData) {
  const r = ensureRenderer();
  if (!r) return;
  r.load(graphData);
  S.layout.init(graphData.nodes, graphData.edges);
  S.layout.run();
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
function showTip(data, det) {
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
function selectNode(id) {
  S.selectedId = id;
  if (S.renderer) S.renderer.setSelected(id);
  updateSelCard(); updateTopNodeHighlights();
}
function clearSel() {
  S.selectedId = null;
  if (S.renderer) S.renderer.setSelected(null);
  updateSelCard(); updateTopNodeHighlights();
}

// ── Search / filter ───────────────────────────────────────────────────────────
function applySearch() {
  if (S.renderer) S.renderer.setSearch(S.searchTerm.trim());
}
function applyFilter() {
  if (!S.renderer) return;
  const at = new Set(S.typeFilters);
  if (S.primaryTypeFilter) at.add(S.primaryTypeFilter);
  if (!at.size) { S.renderer.setFilter(null); return; }
  const kinds = new Set();
  for (const t of at) kinds.add(TK[t.toLowerCase()] || 'default');
  S.renderer.setFilter(kinds);
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
      '<div class="sel-stat"><b>' + ((det && det.hubScore)||d.hubScore||0) + '</b>signal</div>' +
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

function renderSidebar(payload) {
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
  S.payload = payload;

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

  const newHash = payload.graphData.nodes.map(n => n.id).sort().join(',');
  const changed = newHash !== S.lastHash;
  S.lastHash = newHash;

  if (changed || payload.forceLayout) {
    loadGraph(payload.graphData);
  }

  // Sync selection
  const selId = payload.mode === 'local'
    ? (S.selectedId || payload.selectedNodeId || payload.centerNodeId || null)
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
E.btnZoomFit.addEventListener('click', () => S.renderer && S.renderer.fitView());
if (E.btnSemantic) E.btnSemantic.addEventListener('click', () => toggleLayer('semantic'));
if (E.btnHealth)   E.btnHealth.addEventListener('click',   () => toggleLayer('health'));
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
  if (ev.target === E.searchInp) return;
  switch (ev.key) {
    case 'Escape': clearSel(); break;
    case 'Enter': if (S.selectedId) vsc.postMessage({ type:'openNode',   id:S.selectedId }); break;
    case 'f': case 'F': if (S.selectedId) vsc.postMessage({ type:'focusNode',  id:S.selectedId }); break;
    case 'e': case 'E': if (S.selectedId) vsc.postMessage({ type:'expandNode', id:S.selectedId }); break;
    case '/': ev.preventDefault(); E.searchInp.focus(); break;
  }
});

// ── VSCode message bus ────────────────────────────────────────────────────────
window.addEventListener('message', ev => {
  const m = ev.data;
  if (m && m.type === 'updateGraph') renderPayload(m.payload);
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
`; }

module.exports = { buildGraphClientXGraphScript };
