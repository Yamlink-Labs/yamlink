'use strict';

const { SimpleLayout } = require('../graph/graphPhysicsEngine');

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
let lastPayload  = null;
let hasRenderedGraph = false;
let pendingLayoutHash = '';
let lastSettledLayoutHash = '';
let lastCameraSettleKey = '';
let nextCameraSettleDuration = 0;
let suppressNextSettledCamera = false;
const layers = { semantic: false, health: false };
let labelMode = 'auto'; // 'auto' | 'all' | 'none' — see Canvas2DRenderer.setLabelMode

// ── SimpleLayout (vanilla JS, no d3-force) ────────────────────────────────────
// Canonical source: src/features/graph/graphPhysicsEngine.js — injected here as
// literal text via Function.prototype.toString() so this webview script always
// stays byte-identical to the one real copy of the class (gains the containment
// clamp, 4th quality tier, and richer _buildGraph() return shape that this
// sidebar's old hand-typed copy had drifted out of sync with).
${SimpleLayout.toString()}

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
    onNodeDragStart: id  => {
      suppressNextSettledCamera = true;
      if (layout) layout.dragStart(id);
    },
    onNodeDrag:      (id,x,y) => layout && layout.drag(id,x,y),
    onNodeDragEnd:   id  => layout && layout.dragEnd(id),
  });

  layout = new SimpleLayout(
    pos => renderer.updatePositions(pos),
    pos => {
      if (pos) renderer.updatePositions(pos);
      if (suppressNextSettledCamera) {
        suppressNextSettledCamera = false;
        return;
      }
      settleCameraAfterLayout();
    }
  );

  new ResizeObserver(entries => {
    const e = entries[0];
    if (e && renderer) renderer.resize(e.contentRect.width, e.contentRect.height);
  }).observe(container);

  // Re-apply current layer state to new renderer instance
  renderer.setLayer('semantic', layers.semantic);
  renderer.setLayer('health',   layers.health);
  renderer.setLabelMode(labelMode);
  renderer.setHoverFocus(hoverFocusEnabled);

  return renderer;
}

function settleCameraAfterLayout() {
  if (!renderer) return;
  const layoutHash = pendingLayoutHash || lastHash || '';
  const duration = Number.isFinite(nextCameraSettleDuration) ? nextCameraSettleDuration : 180;
  if (selectedId) {
    const settleKey = 'selected:' + selectedId + ':1.08';
    if (settleKey === lastCameraSettleKey && layoutHash === lastSettledLayoutHash) return;
    renderer.focusNode(selectedId, {
      zoom: 1.08,
      preserveHigherZoom: true,
      duration,
    });
    lastCameraSettleKey = settleKey;
    lastSettledLayoutHash = layoutHash;
    return;
  }
  const settleKey = 'fit:' + (lastScope || 'vault');
  if (settleKey === lastCameraSettleKey && layoutHash === lastSettledLayoutHash) return;
  renderer.fitView({ duration, padding: 56, maxZoom: 1.85 });
  lastCameraSettleKey = settleKey;
  lastSettledLayoutHash = layoutHash;
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

const LABEL_MODE_ORDER = ['auto', 'all', 'none'];
function cycleLabelMode() {
  const idx = LABEL_MODE_ORDER.indexOf(labelMode);
  labelMode = LABEL_MODE_ORDER[(idx + 1) % LABEL_MODE_ORDER.length];
  if (renderer) renderer.setLabelMode(labelMode);
  const btn = document.getElementById('labelsBtn');
  if (btn) {
    btn.classList.toggle('on', labelMode !== 'auto');
    btn.title = 'Node labels: ' + labelMode + '. Click to cycle Auto -> All -> Off.';
  }
}

let hoverFocusEnabled = false; // off by default — see Canvas2DRenderer.setHoverFocus
function toggleHoverFocus() {
  hoverFocusEnabled = !hoverFocusEnabled;
  if (renderer) renderer.setHoverFocus(hoverFocusEnabled);
  const btn = document.getElementById('hoverFocusBtn');
  if (btn) {
    btn.classList.toggle('on', hoverFocusEnabled);
    btn.setAttribute('aria-pressed', hoverFocusEnabled ? 'true' : 'false');
  }
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
    if (typeof layout.clearPins === 'function') layout.clearPins();
    pendingLayoutHash = newHash;
    const pos = layout.settleSync(payload.graphData.nodes, payload.graphData.edges);
    r.load(payload.graphData);
    r.updatePositions(pos);
    nextCameraSettleDuration = hasRenderedGraph ? 180 : 0;
    settleCameraAfterLayout();
    hasRenderedGraph = true;
    lastNodeHash = nodeHash;
  } else if (scopeChanged && renderer) {
    // Scope switched but data unchanged — re-center the view so the button feels responsive
    pendingLayoutHash = newHash;
    nextCameraSettleDuration = 200;
    lastCameraSettleKey = '';
    lastSettledLayoutHash = '';
    settleCameraAfterLayout();
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

const labelsBtn = document.getElementById('labelsBtn');
if (labelsBtn) labelsBtn.addEventListener('click', cycleLabelMode);

const hoverFocusBtn = document.getElementById('hoverFocusBtn');
if (hoverFocusBtn) hoverFocusBtn.addEventListener('click', toggleHoverFocus);

// help-tip badges live inside Semantic/Health's own <button> (layout
// simplicity) — without this, clicking the "?" to read its tooltip would
// also toggle the parent button's layer as an unwanted side effect.
document.querySelectorAll('.help-tip').forEach(el => el.addEventListener('click', ev => ev.stopPropagation()));

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

// ── Time-lapse ────────────────────────────────────────────────────────────────
// Frames arrive precomputed from the extension host. Playback keeps one fixed
// final-stage graph loaded and reveals historical nodes/edges with alpha masks.
const TL_TWEEN_MS = 1800;
const TL_STEP_MS = 2100;
// Real inline SVGs for play/pause/rewind, matching the boot HTML's initial
// button markup (graph2SidebarBootHtml.js) — swapped in via innerHTML since
// these buttons toggle state at runtime.
const ICON_PLAY = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M1 0.6 L9 5 L1 9.4 Z"/></svg>';
const ICON_PAUSE = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="0.6" width="2.8" height="8.8"/><rect x="6.2" y="0.6" width="2.8" height="8.8"/></svg>';
const ICON_REWIND = '<svg width="12" height="10" viewBox="0 0 12 10" fill="currentColor"><path d="M6 0.4 L0.4 5 L6 9.6 Z"/><path d="M11.6 0.4 L6 5 L11.6 9.6 Z"/></svg>';
const tl = {
  active: false, loading: false, playing: false, direction: 1,
  frames: [], index: 0, currentFrame: null,
  tween: null, tweenRaf: null, playTimer: null,
  stagePositions: null, stageNodeIds: null, stageEdgeKeys: null, stageFrame: null,
  cinematicPos: null, restoreLayoutPositions: null
};

function tlFormatDate(iso) {
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch (_) { return iso; }
}

function tlUpdateUI() {
  const bar = document.getElementById('timelapseBar');
  const label = document.getElementById('timelapseLabel');
  const scrub = document.getElementById('timelapseScrub');
  const playBtn = document.getElementById('timelapsePlayBtn');
  const rewindBtn = document.getElementById('timelapseRewindBtn');
  if (!bar) return;
  if (tl.loading) { if (label) label.textContent = 'Reconstructing…'; return; }
  if (!tl.frames.length) { if (label) label.textContent = 'Not enough history yet.'; return; }
  const frame = tl.frames[tl.index];
  if (label) {
    label.textContent = tlFormatDate(frame.timestamp) + (tl.index === tl.frames.length - 1 ? ' (now)' : '') + ' · ' + frame.nodes.length;
  }
  if (scrub) scrub.value = String(tl.index);
  const playingForward = tl.playing && tl.direction !== -1;
  const playingBackward = tl.playing && tl.direction === -1;
  if (playBtn) { playBtn.innerHTML = playingForward ? ICON_PAUSE : ICON_PLAY; playBtn.setAttribute('aria-label', playingForward ? 'Pause' : 'Play'); }
  if (rewindBtn) { rewindBtn.innerHTML = playingBackward ? ICON_PAUSE : ICON_REWIND; rewindBtn.setAttribute('aria-label', playingBackward ? 'Pause' : 'Play backward'); }
  const badge = document.getElementById('countBadge');
  if (badge) badge.textContent = frame.nodes.length + ' notes · ' + frame.edges.length + ' links (time-lapse)';
  bar.title = tl.source === 'git'
    ? 'Reconstructed from real git history — includes both frontmatter relations and body-text links.'
    : 'This vault has no git history to reconstruct from, so only frontmatter-declared relations are shown.';
}

function tlEaseInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function tlRevealAlpha(t, order, total) {
  const spread = total > 1 ? Math.min(0.42, total * 0.018) : 0;
  const delay = total > 1 ? (order / Math.max(1, total - 1)) * spread : 0.08;
  const local = Math.max(0, Math.min(1, (t - delay) / Math.max(0.001, 1 - delay)));
  return tlEaseInOutCubic(local);
}

function tlVisibilityMasks(stageNodeIds, stageEdgeKeys, currentNodeIds, currentEdgeKeys) {
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

function tlPrepareStage() {
  const r = ensureRenderer();
  if (!r || !layout || !tl.frames.length) return;
  const finalFrame = tl.frames[tl.frames.length - 1];
  tl.restoreLayoutPositions = layout && layout._lastPositions ? new Map(layout._lastPositions) : null;
  const finalPos = layout.settleSync(finalFrame.nodes, finalFrame.edges);
  r.load(finalFrame);
  r.updatePositions(finalPos);
  r.setNodeAlphaOverrides(new Map(finalFrame.nodes.map((n) => [n.id, 0])));
  r.setEdgeAlphaOverrides(new Map(finalFrame.edges.map((e) => [tlEdgeKey(e), 0])));
  r.fitView({ duration: 0, padding: 64, maxZoom: 1.65 });
  tl.stagePositions = Object.assign({}, finalPos);
  tl.stageFrame = finalFrame;
  tl.stageNodeIds = finalFrame.nodes.map((n) => n.id);
  tl.stageEdgeKeys = finalFrame.edges.map(tlEdgeKey);
}

function tlSpawnPositions(frame, targetPos, previousPos) {
  const spawned = {};
  const vals = Object.values(previousPos || {});
  const center = vals.length
    ? { x: vals.reduce((sum, p) => sum + p.x, 0) / vals.length, y: vals.reduce((sum, p) => sum + p.y, 0) / vals.length }
    : { x: 0, y: 0 };
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
    spawned[node.id] = { x: target.x + Math.cos(angle) * 18, y: target.y + Math.sin(angle) * 18 };
  }
  return spawned;
}

function tlStepTween(now) {
  const tw = tl.tween;
  if (!tw || !renderer) return;
  const t = Math.min(1, (now - tw.start) / tw.duration);
  const eased = tlEaseInOutCubic(t);
  const pos = Object.assign({}, tw.stagePositions);
  const alphaOverrides = new Map();
  for (const id of tw.stageNodeIds) {
    if (!tw.currentNodeIds.has(id)) {
      alphaOverrides.set(id, 0);
      continue;
    }
    const to = tw.toPos[id];
    const from = tw.fromPos[id] || tw.spawnPos[id];
    if (from) {
      pos[id] = { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
    }
    const newOrder = tw.newNodeOrder.get(id);
    if (newOrder !== undefined) alphaOverrides.set(id, tlRevealAlpha(t, newOrder, tw.newNodeIds.length));
  }
  const edgeAlphaOverrides = new Map();
  for (const key of tw.stageEdgeKeys) {
    if (!tw.currentEdgeKeys.has(key)) {
      edgeAlphaOverrides.set(key, 0);
      continue;
    }
    const newOrder = tw.newEdgeOrder.get(key);
    if (newOrder !== undefined) edgeAlphaOverrides.set(key, tlRevealAlpha(t, newOrder, tw.newEdgeKeys.length));
  }
  renderer.updatePositions(pos);
  renderer.setNodeAlphaOverrides(alphaOverrides);
  renderer.setEdgeAlphaOverrides(edgeAlphaOverrides);
  if (t < 1) {
    tl.tweenRaf = requestAnimationFrame(tlStepTween);
  } else {
    tl.tween = null; tl.tweenRaf = null;
    const masks = tlVisibilityMasks(tw.stageNodeIds, tw.stageEdgeKeys, tw.currentNodeIds, tw.currentEdgeKeys);
    renderer.setNodeAlphaOverrides(masks.nodeMask);
    renderer.setEdgeAlphaOverrides(masks.edgeMask);
    tl.cinematicPos = Object.assign({}, tw.toPos);
  }
}

function tlEdgeKey(e) {
  return e.source + '|' + e.target + '|' + (e.field || '');
}

function tlGoToFrame(index, opts) {
  opts = opts || {};
  if (!tl.frames.length) return;
  const r = ensureRenderer();
  if (!r || !layout) return;
  const clamped = Math.max(0, Math.min(tl.frames.length - 1, index));
  const frame = tl.frames[clamped];
  const hadPrevious = !!tl.currentFrame;
  // First frame ever shown: nothing to tween from — every node/edge fades in
  // from nothing instead of the whole reconstructed graph popping in at once.
  const prevPositions = hadPrevious ? Object.assign({}, tl.cinematicPos || Object.fromEntries(layout._lastPositions)) : {};
  const prevEdgeKeys = hadPrevious ? new Set(tl.currentFrame.edges.map(tlEdgeKey)) : new Set();

  if (tl.tweenRaf) { cancelAnimationFrame(tl.tweenRaf); tl.tweenRaf = null; }
  tl.tween = null;

  const toPos = tl.stagePositions
    ? Object.fromEntries(frame.nodes.map((n) => [n.id, tl.stagePositions[n.id]]).filter((entry) => !!entry[1]))
    : layout.settleSync(frame.nodes, frame.edges);
  if (!tl.stageFrame) r.load(frame);
  r.updatePositions(tl.stagePositions || toPos);
  tl.index = clamped;
  tl.currentFrame = frame;
  const currentNodeIds = new Set(frame.nodes.map((n) => n.id));
  const currentEdgeKeys = new Set(frame.edges.map(tlEdgeKey));

  if (opts.animate === false) {
    const masks = tlVisibilityMasks(
      tl.stageNodeIds || frame.nodes.map((n) => n.id),
      tl.stageEdgeKeys || frame.edges.map(tlEdgeKey),
      currentNodeIds,
      currentEdgeKeys
    );
    r.setNodeAlphaOverrides(masks.nodeMask);
    r.setEdgeAlphaOverrides(masks.edgeMask);
    tl.cinematicPos = Object.assign({}, toPos);
  } else {
    const spawnPos = tlSpawnPositions(frame, toPos, prevPositions);
    const initialPos = {};
    for (const n of frame.nodes) initialPos[n.id] = prevPositions[n.id] || spawnPos[n.id] || toPos[n.id];
    const initialNodeAlpha = new Map();
    const newNodeIds = [];
    for (const id of (tl.stageNodeIds || frame.nodes.map((n) => n.id))) {
      if (!currentNodeIds.has(id)) initialNodeAlpha.set(id, 0);
      else if (!prevPositions[id]) { initialNodeAlpha.set(id, 0); newNodeIds.push(id); }
    }
    const initialEdgeAlpha = new Map();
    const newEdgeKeys = [];
    for (const key of (tl.stageEdgeKeys || frame.edges.map(tlEdgeKey))) {
      if (!currentEdgeKeys.has(key)) initialEdgeAlpha.set(key, 0);
      else if (!prevEdgeKeys.has(key)) { initialEdgeAlpha.set(key, 0); newEdgeKeys.push(key); }
    }
    r.setNodeAlphaOverrides(initialNodeAlpha);
    r.setEdgeAlphaOverrides(initialEdgeAlpha);

    tl.tween = {
      fromPos: prevPositions, spawnPos, toPos, frameNodes: frame.nodes, frameEdges: frame.edges, prevEdgeKeys,
      stagePositions: tl.stagePositions || toPos,
      stageNodeIds: tl.stageNodeIds || frame.nodes.map((n) => n.id),
      stageEdgeKeys: tl.stageEdgeKeys || frame.edges.map(tlEdgeKey),
      currentNodeIds,
      currentEdgeKeys,
      newNodeIds,
      newEdgeKeys,
      newNodeOrder: new Map(newNodeIds.map((id, i) => [id, i])),
      newEdgeOrder: new Map(newEdgeKeys.map((key, i) => [key, i])),
      start: performance.now(), duration: opts.duration || TL_TWEEN_MS
    };
    r.updatePositions(Object.assign({}, tl.stagePositions || toPos, initialPos));
    tl.tweenRaf = requestAnimationFrame(tlStepTween);
  }
  tlUpdateUI();
}

function tlPause() {
  tl.playing = false;
  if (tl.playTimer) { clearTimeout(tl.playTimer); tl.playTimer = null; }
  tlUpdateUI();
}

function tlScheduleNext() {
  if (!tl.playing) return;
  tl.playTimer = setTimeout(() => {
    if (!tl.playing) return;
    const nextIndex = tl.index + (tl.direction || 1);
    if (nextIndex < 0 || nextIndex > tl.frames.length - 1) { tlPause(); return; }
    tlGoToFrame(nextIndex);
    tlScheduleNext();
  }, TL_STEP_MS);
}

function tlPlay(direction) {
  if (!tl.frames.length) return;
  tl.direction = direction === -1 ? -1 : 1;
  let wrapped = false;
  if (tl.direction > 0 && tl.index >= tl.frames.length - 1) { tl.index = 0; wrapped = true; }
  if (tl.direction < 0 && tl.index <= 0) { tl.index = tl.frames.length - 1; wrapped = true; }
  tl.playing = true;
  tlUpdateUI();
  if (wrapped) tlGoToFrame(tl.index, { animate: false });
  tlScheduleNext();
}

function tlTogglePlay() { if (tl.playing && tl.direction !== -1) tlPause(); else tlPlay(1); }
function tlToggleRewind() { if (tl.playing && tl.direction === -1) tlPause(); else tlPlay(-1); }

function tlOnData(payload) {
  tl.loading = false;
  tl.source = (payload && payload.source) || 'mutation-log';
  tl.frames = (payload && payload.frames) || [];
  tl.index = 0;
  tl.direction = 1;
  tl.currentFrame = null;
  tl.stagePositions = null;
  tl.stageNodeIds = null;
  tl.stageEdgeKeys = null;
  tl.stageFrame = null;
  tl.cinematicPos = null;
  if (!tl.frames.length) { tlUpdateUI(); return; }
  // Land on the earliest checkpoint, faded in from nothing — Play/scrub grow
  // it forward from there, matching the "watch it grow" story.
  const lastIndex = tl.frames.length - 1;
  const scrub = document.getElementById('timelapseScrub');
  if (scrub) { scrub.max = String(Math.max(0, lastIndex)); scrub.value = '0'; }
  tlPrepareStage();
  tlGoToFrame(0, { animate: true });
}

function tlEnter() {
  tl.active = true;
  tl.loading = true;
  const btn = document.getElementById('timelapseBtn');
  if (btn) btn.classList.add('on');
  const bar = document.getElementById('timelapseBar');
  if (bar) bar.classList.add('show');
  if (renderer) { renderer.setFilter(null); }
  // A selected node left over from the live view keeps _isDimmed()'s
  // focus-dimming active (everything not connected to it drops to ~12%
  // opacity) — the real reason time-lapse could look permanently faded
  // regardless of the fade-in tween. Time-lapse has no focused node; clear it.
  selectedId = null;
  if (renderer) renderer.setSelected(null);
  tlUpdateUI();
  vsc.postMessage({ type: 'requestTimelapse' });
}

function tlExit() {
  tlPause();
  if (tl.tweenRaf) { cancelAnimationFrame(tl.tweenRaf); tl.tweenRaf = null; }
  tl.tween = null;
  tl.active = false;
  tl.stagePositions = null;
  tl.stageNodeIds = null;
  tl.stageEdgeKeys = null;
  tl.stageFrame = null;
  if (layout && tl.restoreLayoutPositions) layout._lastPositions = new Map(tl.restoreLayoutPositions);
  tl.restoreLayoutPositions = null;
  const btn = document.getElementById('timelapseBtn');
  if (btn) btn.classList.remove('on');
  const bar = document.getElementById('timelapseBar');
  if (bar) bar.classList.remove('show');
  if (renderer) { renderer.setNodeAlphaOverrides(new Map()); renderer.setEdgeAlphaOverrides(new Map()); }
  lastHash = ''; lastNodeHash = ''; lastScope = '';
  pendingLayoutHash = '';
  lastCameraSettleKey = '';
  lastSettledLayoutHash = '';
  nextCameraSettleDuration = 0;
  suppressNextSettledCamera = false;
  if (lastPayload) render(lastPayload);
}

function tlToggle() { if (tl.active) tlExit(); else tlEnter(); }

const timelapseBtn = document.getElementById('timelapseBtn');
if (timelapseBtn) timelapseBtn.addEventListener('click', tlToggle);
const timelapsePlayBtn = document.getElementById('timelapsePlayBtn');
if (timelapsePlayBtn) timelapsePlayBtn.addEventListener('click', tlTogglePlay);
const timelapseRewindBtn = document.getElementById('timelapseRewindBtn');
if (timelapseRewindBtn) timelapseRewindBtn.addEventListener('click', tlToggleRewind);
const timelapseScrubEl = document.getElementById('timelapseScrub');
if (timelapseScrubEl) {
  timelapseScrubEl.addEventListener('input', () => {
    tlPause();
    tlGoToFrame(+timelapseScrubEl.value, { animate: true, duration: 220 });
  });
}

window.addEventListener('message', ev => {
  const m = ev.data;
  if (m && m.type === 'graph2:update') {
    // Same reasoning as the main graph panel: don't let a live rebuild
    // silently overwrite the canvas while a historical time-lapse frame is
    // showing. Keep it for when the user exits time-lapse.
    lastPayload = m.payload;
    if (!tl.active) render(m.payload);
  }
  if (m && m.type === 'graph2:timelapseData') tlOnData(m.payload);
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
