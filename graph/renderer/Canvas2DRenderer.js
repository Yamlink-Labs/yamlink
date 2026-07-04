/**
 * Canvas2DRenderer — lightweight 2D canvas graph renderer.
 * No Pixi.js, no WebGL. Just a single <canvas> + requestAnimationFrame.
 *
 * Layer system (additive, independent channels):
 *   layer 'semantic' — typed edge colours, strength dashing, direction arrows
 *   layer 'health'   — lifecycle-state and drift-state rings on nodes
 *
 * Extra surfaces:
 *   setFilter(Set<string>)  — show only nodes whose .kind is in the set
 *   setSearch(string)       — dim non-matching nodes, ring-highlight matches
 */

const KIND_COLORS = {
  person:    '#5ecfbe',
  event:     '#e7a85a',
  artifact:  '#c5ffbf',
  schema:    '#c49bf0',
  task:      '#ff429f',
  container: '#9bb4ff',
  default:   '#8899aa',
};

// Semantic layer — relation field name → colour
const FIELD_CATEGORY_COLORS = {
  person:     '#5ecfbe', mentor:    '#5ecfbe', author:    '#5ecfbe',
  contact:    '#5ecfbe', owner:     '#5ecfbe', manager:   '#5ecfbe',
  supervisor: '#5ecfbe', colleague: '#5ecfbe', creator:   '#5ecfbe',
  project:    '#e7a85a', team:      '#e7a85a', unit:      '#e7a85a',
  parent:     '#e7a85a', workspace: '#e7a85a', group:     '#e7a85a',
  topic:      '#c49bf0', theme:     '#c49bf0', area:      '#c49bf0',
  tag:        '#c49bf0', category:  '#c49bf0', subject:   '#c49bf0',
  event:      '#ff429f', session:   '#ff429f', mission:   '#ff429f', meeting: '#ff429f',
};

// Health layer — lifecycle state → ring colour
const LIFECYCLE_RING_COLORS = {
  hub:          '#4fc4a0',
  consolidated: '#3fb950',
  growing:      '#e7a85a',
  draft:        '#8899aa',
  stale:        '#ff6b6b',
};

// Health layer — drift state → ring colour (takes precedence over lifecycle)
const DRIFT_RING_COLORS = {
  'minor-drift': '#ffd93d',
  'drifting':    '#ff9a3c',
  'outlier':     '#ff6b6b',
};

const BG        = '#0d0d14';
const DIM_ALPHA = 0.12;

export class Canvas2DRenderer {
  constructor(container, opts = {}) {
    this._opts      = opts;
    this._container = container;

    const w = opts.width  || container.clientWidth  || 900;
    const h = opts.height || container.clientHeight || 600;

    this._canvas = document.createElement('canvas');
    this._dpr    = window.devicePixelRatio || 1;
    this._canvas.style.width   = '100%';
    this._canvas.style.height  = '100%';
    this._canvas.style.display = 'block';
    this._resize(w, h);
    container.appendChild(this._canvas);

    this._ctx = this._canvas.getContext('2d');

    // Camera
    this._cam = { x: w / 2, y: h / 2, zoom: 1 };
    this._camTween = null;

    // Graph data
    /** @type {Map<string, object>} */
    this._nodeMap   = new Map();
    /** @type {object[]} */
    this._edges     = [];
    /** @type {Record<string, {x:number,y:number}>} */
    this._positions = {};
    this._spatialIndex = new Map();
    this._spatialCellSize = 140;

    // Interaction
    this._hoveredId   = null;
    this._selectedId  = null;
    this._drag        = null;  // camera pan drag
    this._nodeDrag    = null;  // node drag { id }
    this._pendingNodeDrag = null;
    this._pointerDown = null;
    this._panMomentum = null;

    // Layer / filter / search
    this._layers           = { semantic: false, health: false };
    this._filterKinds      = null;   // null = show all; Set<string>
    this._filteredIdsCache = null;   // null = no filter active
    this._searchQuery      = '';

    // Render
    this._animId = null;
    this._dirty  = true;

    this._setupPointerEvents();
    this._loop();
    opts.onReady?.();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  load(graphData) {
    this._nodeMap.clear();
    for (const n of graphData.nodes) this._nodeMap.set(n.id, n);
    this._edges = graphData.edges;
    // Degree map — used for edge density culling at medium zoom on large graphs
    this._nodeDegree = new Map();
    // Adjacency sets — O(1) "is this node connected to X" lookups (focus dimming)
    this._connectedIds = new Map();
    for (const e of graphData.edges) {
      this._nodeDegree.set(e.source, (this._nodeDegree.get(e.source) || 0) + 1);
      this._nodeDegree.set(e.target, (this._nodeDegree.get(e.target) || 0) + 1);
      if (!this._connectedIds.has(e.source)) this._connectedIds.set(e.source, new Set());
      if (!this._connectedIds.has(e.target)) this._connectedIds.set(e.target, new Set());
      this._connectedIds.get(e.source).add(e.target);
      this._connectedIds.get(e.target).add(e.source);
    }
    this._rebuildFilterCache();
    this._rebuildSpatialIndex();
    this._dirty = true;
  }

  updatePositions(positions) {
    this._positions = positions;
    this._rebuildSpatialIndex();
    this._dirty = true;
  }

  resize(w, h) {
    this._flushCameraTween();
    const prevW = this._canvas.width  / this._dpr;
    const prevH = this._canvas.height / this._dpr;
    const centerWorldX = prevW > 0 ? (prevW / 2 - this._cam.x) / this._cam.zoom : 0;
    const centerWorldY = prevH > 0 ? (prevH / 2 - this._cam.y) / this._cam.zoom : 0;
    this._resize(w, h);
    if (prevW > 0 && prevH > 0) {
      this._cam.x = w / 2 - centerWorldX * this._cam.zoom;
      this._cam.y = h / 2 - centerWorldY * this._cam.zoom;
    }
    this._dirty = true;
  }

  fitView(opts = {}) {
    this._flushCameraTween();
    const positions = Object.values(this._positions);
    if (!positions.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { x, y } of positions) {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    const pad = Number.isFinite(opts.padding) ? opts.padding : 60;
    const vw  = this._canvas.width  / this._dpr;
    const vh  = this._canvas.height / this._dpr;
    const scaleX = (vw - pad * 2) / (maxX - minX || 1);
    const scaleY = (vh - pad * 2) / (maxY - minY || 1);
    const maxZoom = Number.isFinite(opts.maxZoom) ? opts.maxZoom : 2;
    const minZoom = Number.isFinite(opts.minZoom) ? opts.minZoom : 0.05;
    const zoom = Math.max(minZoom, Math.min(scaleX, scaleY, maxZoom));
    this._animateCameraTo({
      zoom,
      x: vw / 2 - ((minX + maxX) / 2) * zoom,
      y: vh / 2 - ((minY + maxY) / 2) * zoom,
    }, opts.duration ?? 180);
  }

  /**
   * Toggle a named layer. names: 'semantic' | 'health'
   * Layers are additive and independent — both can be on simultaneously.
   */
  setLayer(name, enabled) {
    if (name in this._layers) {
      this._layers[name] = !!enabled;
      this._dirty = true;
    }
  }

  getLayer(name) {
    return this._layers[name] ?? false;
  }

  /**
   * Show only nodes whose .group (exact type name) is in the provided Set.
   * Pass null to clear the filter and show all nodes.
   * @param {Set<string>|null} types
   */
  setFilter(types) {
    this._filterKinds = (types instanceof Set && types.size > 0) ? types : null;
    this._rebuildFilterCache();
    this._dirty = true;
  }

  /**
   * Dim all nodes that don't match the query. Empty string clears search.
   * Matching is substring on node label (case-insensitive).
   * @param {string} query
   */
  setSearch(query) {
    this._searchQuery = String(query || '').toLowerCase().trim();
    this._dirty = true;
  }

  destroy() {
    cancelAnimationFrame(this._animId);
    this._camTween = null;
    this._canvas.remove();
  }

  /** Zoom by a factor, centred on the canvas centre. */
  zoomBy(factor) {
    this._flushCameraTween();
    const w  = this._canvas.width  / this._dpr;
    const h  = this._canvas.height / this._dpr;
    this._zoomAt(factor, w / 2, h / 2, { animate: true, duration: 120 });
  }

  /** Programmatically set the selected node (without firing click callbacks). */
  setSelected(id) {
    this._selectedId = id || null;
    this._dirty = true;
  }

  focusNode(id, opts = {}) {
    if (!id) return;
    const pos = this._positions[id];
    const node = this._nodeMap.get(id);
    if (!pos || !node) return;
    this._flushCameraTween();
    const vw = this._canvas.width / this._dpr;
    const vh = this._canvas.height / this._dpr;
    const currentZoom = this._cam.zoom;
    const preferredZoom = Number.isFinite(opts.zoom)
      ? opts.zoom
      : ((node.weight ?? 0) > 0.65 ? 1.15 : 1.35);
    const maxZoom = Number.isFinite(opts.maxZoom) ? opts.maxZoom : 2.4;
    const minZoom = Number.isFinite(opts.minZoom) ? opts.minZoom : 0.35;
    const zoom = opts.preserveHigherZoom ? Math.max(currentZoom, preferredZoom) : preferredZoom;
    const targetZoom = Math.max(minZoom, Math.min(maxZoom, zoom));
    this._animateCameraTo({
      zoom: targetZoom,
      x: vw / 2 - pos.x * targetZoom,
      y: vh / 2 - pos.y * targetZoom,
    }, opts.duration ?? 180);
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  _loop() {
    this._animId = requestAnimationFrame(() => this._loop());
    const now = performance.now();
    const dt = this._lastFrameTime ? (now - this._lastFrameTime) : 16.67;
    this._lastFrameTime = now;
    if (this._camTween) {
      this._stepCameraTween(now);
      this._dirty = true;
    }
    if (this._panMomentum) {
      this._stepPanMomentum(dt);
      this._dirty = true;
    }
    if (!this._dirty) return;
    this._dirty = false;
    this._draw();
  }

  _draw() {
    const ctx  = this._ctx;
    const dpr  = this._dpr;
    const cw   = this._canvas.width;
    const ch   = this._canvas.height;
    const { x: cx, y: cy, zoom } = this._cam;
    const w    = cw / dpr;
    const h    = ch / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);

    const focusId  = (this._nodeDrag && this._nodeDrag.id) || this._hoveredId || this._selectedId;
    const hasFocus = !!focusId;
    const hasSearch = this._searchQuery.length > 0;

    // ── Cluster super-node view (zoom-out aggregation for 400+ node graphs) ──
    // Below this zoom threshold individual nodes collapse into cluster bubbles.
    if (zoom < 0.22 && this._nodeMap.size >= 400) {
      this._drawClusterSuperNodes(ctx, zoom, focusId);
      ctx.restore();
      // (cache populated by the call above; safe for this frame's hit-testing)
      // Hint overlay in screen-space (after restoring world transform)
      ctx.save();
      ctx.scale(this._dpr, this._dpr);
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(136,153,170,0.50)';
      ctx.fillText('Zoom in to explore individual notes  ·  Click a bubble to zoom in', w / 2, h - 12);
      ctx.restore();
      return;
    }
    // Not in cluster-super-node view this frame — invalidate the cache so a
    // stray click can never hit-test against stale bubble positions from a
    // previous cluster-view frame.
    this._superNodeCache = null;

    // ── Cluster hulls (semantic layer only) ───────────────────────────────────
    // Soft convex-hull outlines around clusters, drawn behind edges/nodes.
    // Reuses the semantic-layer toggle rather than a dedicated one — this was
    // shipped as part of the Sugar physics/visual overhaul but the call site
    // was dropped in a later refactor; the geometry itself was always complete.
    if (this._layers.semantic && zoom >= 0.06) {
      this._drawClusterHulls(ctx, zoom, focusId, hasFocus);
    }

    // ── Edge pass (batched by style bucket) ──────────────────────────────────
    // Below zoom 0.06 nodes are sub-pixel dots — skip edges entirely.
    if (zoom >= 0.06) {
      if (this._layers.semantic) {
        this._drawEdgesBatchedSemantic(ctx, zoom, focusId, hasFocus);
      } else {
        this._drawEdgesBatchedBase(ctx, zoom, focusId, hasFocus);
      }
    }

    // ── Node pass ────────────────────────────────────────────────────────────
    if (zoom < (this._nodeMap.size >= 500 ? 0.17 : 0.10) && this._nodeMap.size > 200) {
      // Dot mode: batch fillRect by color — ~10× faster than arc() at extreme zoom-out
      const dotBuckets = new Map();
      for (const [id, node] of this._nodeMap) {
        const pos = this._positions[id];
        if (!pos || !this._isVisible(id) || !this._isInView(pos, 3 / zoom, zoom)) continue;
        const dimmed = this._isDimmed(id, focusId, hasFocus, hasSearch);
        const ck = dimmed ? '__dim' : (KIND_COLORS[node.kind] ?? KIND_COLORS.default);
        if (!dotBuckets.has(ck)) dotBuckets.set(ck, []);
        dotBuckets.get(ck).push(pos);
      }
      const dotR = 1.6 / zoom;
      for (const [ck, pts] of dotBuckets) {
        ctx.fillStyle   = ck === '__dim' ? 'rgba(136,153,170,0.15)' : ck;
        ctx.globalAlpha = ck === '__dim' ? DIM_ALPHA : 0.75;
        for (const p of pts) ctx.fillRect(p.x - dotR, p.y - dotR, dotR * 2, dotR * 2);
      }
      ctx.globalAlpha = 1;
      // Hovered / selected still gets a proper circle even in dot mode
      for (const id of [this._hoveredId, this._selectedId]) {
        if (!id) continue;
        const node = this._nodeMap.get(id);
        const pos  = this._positions[id];
        if (!node || !pos) continue;
        const r = this._nodeRadiusForZoom(node, zoom);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 5 / zoom, 0, Math.PI * 2);
        ctx.strokeStyle = id === this._selectedId ? 'rgba(196,155,240,0.5)' : 'rgba(255,255,255,0.3)';
        ctx.lineWidth   = 1.5 / zoom;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fillStyle   = KIND_COLORS[node.kind] ?? KIND_COLORS.default;
        ctx.globalAlpha = 1;
        ctx.fill();
      }
    } else {
    for (const [id, node] of this._nodeMap) {
      const pos = this._positions[id];
      if (!pos || !this._isVisible(id)) continue;
      const r = this._nodeRadiusForZoom(node, zoom);
      if (!this._isInView(pos, r + 6, zoom)) continue;

      const isHovered  = id === this._hoveredId;
      const isSelected = id === this._selectedId;
      const isActive   = isHovered || isSelected;
      const dimmed     = this._isDimmed(id, focusId, hasFocus, hasSearch);
      const color      = KIND_COLORS[node.kind] ?? KIND_COLORS.default;

      // Health ring — drawn first so it sits behind the node circle
      if (this._layers.health && !dimmed) {
        this._drawHealthRing(ctx, node, pos, r, zoom);
      }

      // Hover / selection glow
      if (isActive) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 5 / zoom, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected ? 'rgba(196,155,240,0.5)' : 'rgba(255,255,255,0.3)';
        ctx.lineWidth   = 1.5 / zoom;
        ctx.stroke();
      }

      // Node fill
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle   = dimmed ? 'rgba(136,153,170,0.15)' : color;
      ctx.globalAlpha = dimmed ? DIM_ALPHA : (isActive ? 1 : 0.85);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (zoom < 0.46 && (node.weight ?? 0) >= 0.78 && !dimmed) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 4 / zoom, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();
      }

      // Hub accent dot
      if ((node.weight ?? 0) > 0.6 && !dimmed) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 3 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fill();
      }

      if (zoom < 0.58 && (node.bridgeScore ?? 0) > 0.2 && !dimmed) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + (5 / zoom), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(231,168,90,0.24)';
        ctx.lineWidth = ((node.bridgeScore ?? 0) > 0.55 ? 1.4 : 1) / zoom;
        ctx.stroke();
      }

      // Search match ring
      if (hasSearch && !dimmed) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 3 / zoom, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffd93d';
        ctx.lineWidth   = 1.5 / zoom;
        ctx.globalAlpha = 0.9;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    } // end else (dot mode)

    // ── Label pass (LOD — density drops at low zoom) ──────────────────────────
    const labelProfile = this._labelProfile(zoom);
    const zoomFade     = Math.min(1, Math.max(0, (zoom - labelProfile.minZoom) / 0.05));
    if (zoomFade > 0) {
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font         = `${11 / zoom}px Inter, system-ui, sans-serif`;

      for (const [id, node] of this._nodeMap) {
        const pos = this._positions[id];
        if (!pos || !this._isVisible(id)) continue;
        if (!this._isInView(pos, 30, zoom)) continue;

        const isActive = id === this._hoveredId || id === this._selectedId;
        const dimmed   = this._isDimmed(id, focusId, hasFocus, hasSearch);
        if (dimmed && !isActive) continue;
        if (!this._shouldRenderLabel(node, id, zoom, isActive, hasFocus, hasSearch, labelProfile)) continue;
        const alpha = this._labelAlpha(node, id, zoom, focusId, hasFocus, hasSearch) * zoomFade;
        if (alpha <= 0) continue;

        const r     = this._nodeRadiusForZoom(node, zoom);
        const label = this._truncate(node.label || id, labelProfile.maxLabelLength);

        ctx.fillStyle   = isActive ? `rgba(255,255,255,${zoomFade.toFixed(3)})` : `rgba(200,210,220,${alpha.toFixed(3)})`;
        ctx.shadowColor = '#000';
        ctx.shadowBlur  = 4;
        ctx.fillText(label, pos.x, pos.y - r - 4 / zoom);
        ctx.shadowBlur  = 0;
      }
    }

    ctx.restore();
  }

  // ── Edge drawing (batched) ────────────────────────────────────────────────

  /**
   * Base mode: bucket edges into active / inactive — 2 stroke() calls total.
   */
  _drawEdgesBatchedBase(ctx, zoom, focusId, hasFocus) {
    // Two buckets: active (highlight) and inactive
    const activePts   = [];
    const inactivePts = [];
    const strideProfile = this._edgeStrideProfile(zoom);
    const nodeCount = this._nodeMap.size;
    // Degree cutoff: on large graphs at medium zoom, skip leaf-to-leaf edges to
    // reduce visual spaghetti. Only edges where at least one endpoint has enough
    // connections are shown. Threshold scales with zoom — tighter when zoomed out.
    const useDegCull = nodeCount >= 400 && zoom < 0.72;
    const degCutoff  = zoom < 0.48 ? 4 : 3;
    let activeSeen = 0;
    let inactiveSeen = 0;

    for (const edge of this._edges) {
      const sp = this._positions[edge.source];
      const tp = this._positions[edge.target];
      if (!sp || !tp) continue;
      if (!this._isVisible(edge.source) || !this._isVisible(edge.target)) continue;
      if (!this._isInView(sp, 2, zoom) && !this._isInView(tp, 2, zoom)) continue;

      const isActive = hasFocus && (edge.source === focusId || edge.target === focusId);
      if (useDegCull && !isActive) {
        const sd = this._nodeDegree.get(edge.source) || 0;
        const td = this._nodeDegree.get(edge.target) || 0;
        if (sd < degCutoff && td < degCutoff) continue;
      }
      if (isActive) {
        activeSeen++;
        if ((activeSeen - 1) % strideProfile.active !== 0) continue;
        activePts.push(sp.x, sp.y, tp.x, tp.y);
      } else {
        inactiveSeen++;
        if ((inactiveSeen - 1) % strideProfile.inactive !== 0) continue;
        inactivePts.push(sp.x, sp.y, tp.x, tp.y);
      }
    }

    if (inactivePts.length) {
      const alpha = hasFocus ? 0.04 : 0.2;
      ctx.beginPath();
      for (let i = 0; i < inactivePts.length; i += 4) {
        ctx.moveTo(inactivePts[i], inactivePts[i + 1]);
        ctx.lineTo(inactivePts[i + 2], inactivePts[i + 3]);
      }
      ctx.strokeStyle = `rgba(136,153,170,${alpha})`;
      ctx.lineWidth   = 0.8 / zoom;
      ctx.stroke();
    }

    if (activePts.length) {
      ctx.beginPath();
      for (let i = 0; i < activePts.length; i += 4) {
        ctx.moveTo(activePts[i], activePts[i + 1]);
        ctx.lineTo(activePts[i + 2], activePts[i + 3]);
      }
      ctx.strokeStyle = 'rgba(197,255,191,0.5)';
      ctx.lineWidth   = 1.5 / zoom;
      ctx.stroke();
    }
  }

  /**
   * Semantic mode: bucket by (color, lineWidth, isDashed) key.
   * In practice ~6-12 buckets (one per source kind × strength).
   * Arrowheads are per-edge fills drawn after the line batches.
   */
  _drawEdgesBatchedSemantic(ctx, zoom, focusId, hasFocus) {
    // lineBuckets: key → { color, lw, isDashed, alpha, segments[] }
    const lineBuckets = new Map();
    // arrowQueue: entries for directed arrowheads
    const arrowQueue  = [];
    const strideProfile = this._edgeStrideProfile(zoom);
    const nodeCount = this._nodeMap.size;
    const useDegCull = nodeCount >= 400 && zoom < 0.72;
    const degCutoff  = zoom < 0.48 ? 4 : 3;
    let activeSeen = 0;
    let inactiveSeen = 0;

    for (const edge of this._edges) {
      const sp = this._positions[edge.source];
      const tp = this._positions[edge.target];
      if (!sp || !tp) continue;
      if (!this._isVisible(edge.source) || !this._isVisible(edge.target)) continue;
      if (!this._isInView(sp, 2, zoom) && !this._isInView(tp, 2, zoom)) continue;

      const isActive = hasFocus && (edge.source === focusId || edge.target === focusId);
      if (useDegCull && !isActive) {
        const sd = this._nodeDegree.get(edge.source) || 0;
        const td = this._nodeDegree.get(edge.target) || 0;
        if (sd < degCutoff && td < degCutoff) continue;
      }
      const dimmed   = hasFocus && !isActive;
      if (isActive) {
        activeSeen++;
        if ((activeSeen - 1) % strideProfile.active !== 0) continue;
      } else {
        inactiveSeen++;
        if ((inactiveSeen - 1) % strideProfile.inactive !== 0) continue;
      }
      const srcNode  = this._nodeMap.get(edge.source);
      const tgtNode  = this._nodeMap.get(edge.target);
      const srcCluster = srcNode?.clusterId || null;
      const tgtCluster = tgtNode?.clusterId || null;
      const isBridge = !!srcCluster && !!tgtCluster && srcCluster !== tgtCluster;
      let alpha    = dimmed ? 0.04 : (isActive ? 0.8 : 0.45);
      const rSrc     = srcNode ? this._nodeRadius(srcNode) : 6;
      const rTgt     = tgtNode ? this._nodeRadius(tgtNode) : 6;

      const dx  = tp.x - sp.x;
      const dy  = tp.y - sp.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) continue;

      const ux = dx / len;
      const uy = dy / len;

      const arrowLen = 7 / zoom;
      const x1 = sp.x + ux * rSrc;
      const y1 = sp.y + uy * rSrc;
      const x2 = tp.x - ux * (rTgt + arrowLen);
      const y2 = tp.y - uy * (rTgt + arrowLen);

      const fieldColor   = this._fieldColor(edge.field);
      const srcKindColor = srcNode ? (KIND_COLORS[srcNode.kind] ?? KIND_COLORS.default) : null;
      const baseColor    = fieldColor
        ?? (edge.strength === 'strong' ? '#5ecfbe' : (srcKindColor ?? '#8899aa'));
      let lw           = (edge.strength === 'strong' ? 1.5 : 0.9) / zoom;
      const isDashed     = edge.strength === 'weak';
      if (isBridge && zoom < 0.72 && !dimmed) {
        alpha = Math.min(0.72, alpha + 0.12);
        lw *= zoom < 0.46 ? 1.22 : 1.12;
      }

      const key = `${baseColor}|${lw.toFixed(3)}|${isDashed ? 1 : 0}|${alpha.toFixed(2)}|${isBridge ? 1 : 0}`;
      if (!lineBuckets.has(key)) {
        lineBuckets.set(key, { color: baseColor, lw, isDashed, alpha, pts: [], isBridge });
      }
      lineBuckets.get(key).pts.push(x1, y1, x2, y2);

      if (!dimmed && edge.directed !== false && zoom >= strideProfile.arrowMinZoom) {
        arrowQueue.push({ ux, uy, rTgt, tp, arrowLen, color: baseColor, alpha });
      }
    }

    // Draw line batches
    for (const b of lineBuckets.values()) {
      ctx.save();
      ctx.globalAlpha = b.alpha;
      if (b.isDashed) ctx.setLineDash([4 / zoom, 4 / zoom]);
      ctx.lineCap = b.isBridge ? 'round' : 'butt';
      ctx.beginPath();
      for (let i = 0; i < b.pts.length; i += 4) {
        ctx.moveTo(b.pts[i], b.pts[i + 1]);
        ctx.lineTo(b.pts[i + 2], b.pts[i + 3]);
      }
      ctx.strokeStyle = b.color;
      ctx.lineWidth   = b.lw;
      ctx.stroke();
      ctx.restore();
    }

    // Draw arrowheads individually (fills, can't easily batch mixed colors)
    const hw = 3 / zoom;
    for (const a of arrowQueue) {
      const tipX = a.tp.x - a.ux * a.rTgt;
      const tipY = a.tp.y - a.uy * a.rTgt;
      const px   = -a.uy;
      const py   =  a.ux;
      ctx.save();
      ctx.globalAlpha = a.alpha;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - a.ux * a.arrowLen + px * hw, tipY - a.uy * a.arrowLen + py * hw);
      ctx.lineTo(tipX - a.ux * a.arrowLen - px * hw, tipY - a.uy * a.arrowLen - py * hw);
      ctx.closePath();
      ctx.fillStyle = a.color;
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Health ring ───────────────────────────────────────────────────────────

  _drawHealthRing(ctx, node, pos, r, zoom) {
    const lc = node.lifecycleState;
    const dr = node.driftState;

    // Drift overrides lifecycle when both are present
    const color = (dr && DRIFT_RING_COLORS[dr])
      ? DRIFT_RING_COLORS[dr]
      : (lc ? LIFECYCLE_RING_COLORS[lc] : null);

    if (!color) return;

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r + 4 / zoom, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2 / zoom;
    ctx.globalAlpha = 0.75;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ── Pointer events ────────────────────────────────────────────────────────

  _setupPointerEvents() {
    const c = this._canvas;
    const DRAG_THRESHOLD = 4;

    c.addEventListener('pointerdown', e => {
      const w   = this._toWorld(e);
      const hit = this._hitTest(w.x, w.y);
      this._pointerDown = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);

      if (hit) {
        // Defer node drag until the pointer actually moves enough. This keeps
        // simple clicks from feeling like accidental grabs.
        this._camTween = null;
        this._panMomentum = null;
        this._pendingNodeDrag = {
          id: hit,
          startX: e.clientX,
          startY: e.clientY,
        };
        c.style.cursor = 'pointer';
      } else {
        // Canvas pan
        this._camTween = null;
        this._panMomentum = null;
        const now = performance.now();
        this._drag = {
          startX: e.clientX,
          startY: e.clientY,
          camX: this._cam.x,
          camY: this._cam.y,
          lastX: e.clientX,
          lastY: e.clientY,
          lastT: now,
          vx: 0,
          vy: 0,
        };
        c.style.cursor = 'grabbing';
      }
    });

    c.addEventListener('pointermove', e => {
      if (this._pendingNodeDrag && !this._nodeDrag) {
        const dx = e.clientX - this._pendingNodeDrag.startX;
        const dy = e.clientY - this._pendingNodeDrag.startY;
        if (Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD) {
          this._nodeDrag = { id: this._pendingNodeDrag.id };
          this._pendingNodeDrag = null;
          this._opts.onNodeDragStart?.(this._nodeDrag.id);
          c.style.cursor = 'grabbing';
        }
      }

      if (this._nodeDrag) {
        const w = this._toWorld(e);
        this._positions[this._nodeDrag.id] = { x: w.x, y: w.y };
        this._opts.onNodeDrag?.(this._nodeDrag.id, w.x, w.y);
        this._dirty = true;
        return;
      }

      if (this._drag) {
        this._cam.x = this._drag.camX + (e.clientX - this._drag.startX);
        this._cam.y = this._drag.camY + (e.clientY - this._drag.startY);
        const now = performance.now();
        const dt = Math.max(1, now - this._drag.lastT);
        this._drag.vx = (e.clientX - this._drag.lastX) / dt;
        this._drag.vy = (e.clientY - this._drag.lastY) / dt;
        this._drag.lastX = e.clientX;
        this._drag.lastY = e.clientY;
        this._drag.lastT = now;
        this._dirty = true;
        return;
      }

      const w   = this._toWorld(e);
      const hit = this._hitTest(w.x, w.y);
      if (hit !== this._hoveredId) {
        this._hoveredId = hit;
        this._opts.onNodeHover?.(hit, hit ? this._nodeMap.get(hit) : null);
        c.style.cursor = hit ? 'pointer' : 'default';
        this._dirty = true;
      }
    });

    c.addEventListener('pointerup', e => {
      if (this._nodeDrag) {
        const dragId  = this._nodeDrag.id;
        const pd      = this._pointerDown;
        const isClick = pd && Math.abs(e.clientX - pd.x) < DRAG_THRESHOLD && Math.abs(e.clientY - pd.y) < DRAG_THRESHOLD;
        const w       = this._toWorld(e);
        this._opts.onNodeDragEnd?.(dragId, w.x, w.y);
        this._nodeDrag    = null;
        this._pendingNodeDrag = null;
        this._finishPointerInteraction(e.pointerId);
        if (isClick) {
          this._selectedId = dragId === this._selectedId ? null : dragId;
          this._opts.onNodeClick?.(dragId, this._nodeMap.get(dragId) ?? null);
          this._dirty = true;
        }
        return;
      }

      if (this._pendingNodeDrag) {
        const hit = this._pendingNodeDrag.id;
        this._pendingNodeDrag = null;
        this._finishPointerInteraction(e.pointerId);
        this._selectedId = hit === this._selectedId ? null : hit;
        this._opts.onNodeClick?.(hit, this._nodeMap.get(hit) ?? null);
        this._dirty = true;
        return;
      }

      const d = this._pointerDown;
      const drag = this._drag;
      this._drag        = null;
      this._finishPointerInteraction(e.pointerId);
      if (drag) {
        const movedX = e.clientX - drag.startX;
        const movedY = e.clientY - drag.startY;
        const movedEnough = Math.abs(movedX) >= DRAG_THRESHOLD || Math.abs(movedY) >= DRAG_THRESHOLD;
        const speed = Math.hypot(drag.vx || 0, drag.vy || 0);
        if (movedEnough && speed > 0.02) {
          const maxMomentum = 42;
          this._panMomentum = {
            vx: Math.max(-maxMomentum, Math.min(maxMomentum, drag.vx * 16)),
            vy: Math.max(-maxMomentum, Math.min(maxMomentum, drag.vy * 16)),
          };
        }
      }
      if (d && Math.abs(e.clientX - d.x) < DRAG_THRESHOLD && Math.abs(e.clientY - d.y) < DRAG_THRESHOLD) {
        const w   = this._toWorld(e);
        // In cluster view, clicks zoom into the tapped bubble instead of selecting a node
        if (this._cam.zoom < 0.22 && this._nodeMap.size >= 400) {
          const cid = this._hitTestSuperNode(w.x, w.y);
          if (cid) {
            this.focusNode(cid, { zoom: 0.45, duration: 280 });
            this._dirty = true;
            return;
          }
        }
        const hit = this._hitTest(w.x, w.y);
        this._selectedId = hit === this._selectedId ? null : hit;
        this._opts.onNodeClick?.(hit, hit ? this._nodeMap.get(hit) : null);
        this._dirty = true;
      }
    });

    const cancelInteraction = e => {
      this._pendingNodeDrag = null;
      this._nodeDrag = null;
      this._drag = null;
      this._panMomentum = null;
      this._finishPointerInteraction(e.pointerId);
      this._dirty = true;
    };

    c.addEventListener('pointercancel', cancelInteraction);
    c.addEventListener('lostpointercapture', () => {
      if (!this._drag && !this._nodeDrag && !this._pendingNodeDrag) return;
      this._pendingNodeDrag = null;
      this._nodeDrag = null;
      this._drag = null;
      this._pointerDown = null;
      c.style.cursor = this._hoveredId ? 'pointer' : 'default';
      this._dirty = true;
    });

    c.addEventListener('pointerleave', () => {
      if (this._hoveredId) {
        this._hoveredId = null;
        this._opts.onNodeHover?.(null, null);
        c.style.cursor = 'default';
        this._dirty = true;
      }
    });

    c.addEventListener('wheel', e => {
      e.preventDefault();
      const rect   = c.getBoundingClientRect();
      const sx     = e.clientX - rect.left;
      const sy     = e.clientY - rect.top;
      const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? rect.height : 1);
      const delta  = Math.max(-240, Math.min(240, e.deltaY * unit));
      const sensitivity = e.ctrlKey ? 0.0021 : 0.00135;
      const factor = Math.exp(-delta * sensitivity);
      this._panMomentum = null;
      this._zoomAt(factor, sx, sy, { animate: false });
    }, { passive: false });

    c.addEventListener('dblclick', e => {
      const w = this._toWorld(e);
      const hit = this._hitTest(w.x, w.y);
      if (hit) {
        this.focusNode(hit, { preserveHigherZoom: true, duration: 180 });
        return;
      }
      this.fitView({ duration: 220, padding: 64, maxZoom: 1.95 });
    });

    c.addEventListener('contextmenu', e => {
      e.preventDefault();
      const w   = this._toWorld(e);
      const hit = this._hitTest(w.x, w.y);
      if (hit) this._opts.onNodeContextMenu?.(hit, this._nodeMap.get(hit), e.clientX, e.clientY);
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Returns true if the world-space point (with radius r) is within the viewport. */
  _isInView(pos, r, zoom) {
    const w  = this._canvas.width  / this._dpr;
    const h  = this._canvas.height / this._dpr;
    const sx = pos.x * zoom + this._cam.x;
    const sy = pos.y * zoom + this._cam.y;
    const sr = r * zoom;
    return sx + sr > 0 && sx - sr < w && sy + sr > 0 && sy - sr < h;
  }

  _resize(w, h) {
    this._canvas.width  = Math.round(w * this._dpr);
    this._canvas.height = Math.round(h * this._dpr);
    this._canvas.style.width  = w + 'px';
    this._canvas.style.height = h + 'px';
  }

  _zoomAt(factor, sx, sy, opts = {}) {
    this._flushCameraTween();
    const target = this._cameraAfterZoom(factor, sx, sy);
    if (opts.animate) {
      this._animateCameraTo(target, opts.duration ?? 90);
      return;
    }
    this._cam = target;
    this._dirty = true;
  }

  _cameraAfterZoom(factor, sx, sy) {
    const zoom = Math.max(0.05, Math.min(8, this._cam.zoom * factor));
    const wx = (sx - this._cam.x) / this._cam.zoom;
    const wy = (sy - this._cam.y) / this._cam.zoom;
    return {
      zoom,
      x: sx - wx * zoom,
      y: sy - wy * zoom,
    };
  }

  _animateCameraTo(target, duration = 150) {
    const from = { x: this._cam.x, y: this._cam.y, zoom: this._cam.zoom };
    const to = {
      x: Number.isFinite(target.x) ? target.x : from.x,
      y: Number.isFinite(target.y) ? target.y : from.y,
      zoom: Number.isFinite(target.zoom) ? target.zoom : from.zoom,
    };

    if (duration <= 0) {
      this._cam = to;
      this._camTween = null;
      this._dirty = true;
      return;
    }

    this._camTween = {
      start: performance.now(),
      duration,
      from,
      to,
    };
    this._dirty = true;
  }

  _stepCameraTween(now) {
    if (!this._camTween) return;
    const { start, duration, from, to } = this._camTween;
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    this._cam.x = from.x + (to.x - from.x) * eased;
    this._cam.y = from.y + (to.y - from.y) * eased;
    this._cam.zoom = from.zoom + (to.zoom - from.zoom) * eased;
    if (t >= 1) this._camTween = null;
  }

  _flushCameraTween(now = performance.now()) {
    if (!this._camTween) return;
    this._stepCameraTween(now);
    this._camTween = null;
  }

  _stepPanMomentum(dt = 16.67) {
    if (!this._panMomentum) return;
    this._cam.x += this._panMomentum.vx;
    this._cam.y += this._panMomentum.vy;
    // Decay is a per-16.67ms-frame factor; normalize to actual elapsed time so
    // momentum doesn't decay faster on higher refresh-rate displays.
    const decay = Math.pow(0.88, dt / 16.67);
    this._panMomentum.vx *= decay;
    this._panMomentum.vy *= decay;
    if (Math.abs(this._panMomentum.vx) < 0.05 && Math.abs(this._panMomentum.vy) < 0.05) {
      this._panMomentum = null;
    }
  }

  _finishPointerInteraction(pointerId) {
    this._pointerDown = null;
    if (Number.isFinite(pointerId) && this._canvas.hasPointerCapture(pointerId)) {
      this._canvas.releasePointerCapture(pointerId);
    }
    this._canvas.style.cursor = this._hoveredId ? 'pointer' : 'default';
  }

  _nodeRadius(node) {
    const edgeCount = node.edges?.length ?? 0;
    return 5 + (node.weight ?? 0) * 8 + Math.log1p(edgeCount) * 2;
  }

  _nodeRadiusForZoom(node, zoom) {
    const base = this._nodeRadius(node);
    const weight = node.weight ?? 0;
    if (zoom >= 0.9) return base;
    if (zoom >= 0.58) {
      return base * (weight >= 0.68 ? 0.96 : 0.88);
    }
    if (zoom >= 0.38) {
      return base * (weight >= 0.82 ? 0.9 : (weight >= 0.55 ? 0.78 : 0.64));
    }
    return base * (weight >= 0.86 ? 0.82 : (weight >= 0.62 ? 0.62 : 0.46));
  }

  _hitTest(wx, wy) {
    let best = null, bestD = Infinity;
    const cellSize = this._spatialCellSize || 140;
    const gx = Math.floor(wx / cellSize);
    const gy = Math.floor(wy / cellSize);
    const candidates = [];
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = this._spatialIndex.get((gx + ox) + ',' + (gy + oy));
        if (bucket) candidates.push(...bucket);
      }
    }
    for (const id of candidates) {
      const node = this._nodeMap.get(id);
      if (!node) continue;
      if (!this._isVisible(id)) continue;
      const pos = this._positions[id];
      if (!pos) continue;
      const r  = this._nodeRadius(node) + 4;
      if (!this._isInView(pos, r + 4, this._cam.zoom)) continue;
      const dx = wx - pos.x, dy = wy - pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r && d2 < bestD) { bestD = d2; best = id; }
    }
    return best;
  }

  _toWorld(e) {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - this._cam.x) / this._cam.zoom,
      y: (e.clientY - rect.top  - this._cam.y) / this._cam.zoom,
    };
  }

  _isConnectedTo(id, focusId) {
    return this._connectedIds.get(id)?.has(focusId) ?? false;
  }

  _isVisible(id) {
    return this._filteredIdsCache === null || this._filteredIdsCache.has(id);
  }

  _isDimmed(id, focusId, hasFocus, hasSearch) {
    if (hasSearch) return !this._isSearchMatch(this._nodeMap.get(id));
    if (hasFocus) {
      const isActive = id === this._hoveredId || id === this._selectedId;
      return !isActive && !this._isConnectedTo(id, focusId);
    }
    return false;
  }

  _isSearchMatch(node) {
    if (!node || !this._searchQuery) return true;
    const label = (node.label || node.id || '').toLowerCase();
    return label.includes(this._searchQuery);
  }

  _labelAlpha(node, id, zoom, focusId, hasFocus, hasSearch) {
    if (id === this._hoveredId || id === this._selectedId || (this._nodeDrag && id === this._nodeDrag.id)) {
      return 1;
    }
    const weight = node.weight ?? 0;
    if (hasSearch && !this._isSearchMatch(node)) {
      return 0;
    }
    if (hasFocus && !this._isConnectedTo(id, focusId)) {
      return 0;
    }
    if (zoom >= 1.35) {
      return 0.82;
    }
    if (zoom >= 0.95) {
      if (weight >= 0.15) return 0.76;
      return 0.46;
    }
    if (zoom >= 0.7) {
      if (weight >= 0.45) return 0.7;
      if (weight >= 0.25) return 0.42;
      return 0;
    }
    if (zoom >= 0.48) {
      if (weight >= 0.62) return 0.62;
      return 0;
    }
    return weight >= 0.78 ? 0.56 : 0;
  }

  _shouldRenderLabel(node, id, zoom, isActive, hasFocus, hasSearch, profile) {
    if (isActive || hasFocus || hasSearch) return true;
    const weight = node.weight ?? 0;
    if (weight >= profile.alwaysShowWeight) return true;
    if (zoom >= profile.fullDensityZoom) return true;
    if (weight < profile.minWeight) return false;
    if (profile.hashStride <= 1) return true;
    return (this._hashInt(id) % profile.hashStride) === 0;
  }

  _labelProfile(zoom) {
    const nodeCount = this._nodeMap.size;
    if (nodeCount >= 2200) {
      if (zoom >= 1.1) return { minZoom: 0.24, fullDensityZoom: 1.25, minWeight: 0.18, alwaysShowWeight: 0.82, hashStride: 1, maxLabelLength: 22 };
      if (zoom >= 0.7) return { minZoom: 0.24, fullDensityZoom: 1.25, minWeight: 0.4, alwaysShowWeight: 0.84, hashStride: 2, maxLabelLength: 20 };
      return { minZoom: 0.34, fullDensityZoom: 1.25, minWeight: 0.68, alwaysShowWeight: 0.9, hashStride: 5, maxLabelLength: 18 };
    }
    if (nodeCount >= 1200) {
      if (zoom >= 1.05) return { minZoom: 0.24, fullDensityZoom: 1.2, minWeight: 0.16, alwaysShowWeight: 0.8, hashStride: 1, maxLabelLength: 23 };
      if (zoom >= 0.65) return { minZoom: 0.24, fullDensityZoom: 1.2, minWeight: 0.34, alwaysShowWeight: 0.82, hashStride: 2, maxLabelLength: 21 };
      return { minZoom: 0.32, fullDensityZoom: 1.2, minWeight: 0.6, alwaysShowWeight: 0.88, hashStride: 4, maxLabelLength: 19 };
    }
    if (nodeCount >= 500) {
      if (zoom >= 0.95) return { minZoom: 0.26, fullDensityZoom: 1.05, minWeight: 0.14, alwaysShowWeight: 0.76, hashStride: 1, maxLabelLength: 24 };
      if (zoom >= 0.58) return { minZoom: 0.26, fullDensityZoom: 1.05, minWeight: 0.26, alwaysShowWeight: 0.8, hashStride: 2, maxLabelLength: 22 };
      return { minZoom: 0.3, fullDensityZoom: 1.05, minWeight: 0.48, alwaysShowWeight: 0.86, hashStride: 3, maxLabelLength: 20 };
    }
    return { minZoom: 0.28, fullDensityZoom: 0.95, minWeight: 0, alwaysShowWeight: 1, hashStride: 1, maxLabelLength: 24 };
  }

  _rebuildFilterCache() {
    if (!this._filterKinds) {
      this._filteredIdsCache = null;
      return;
    }
    this._filteredIdsCache = new Set();
    for (const [id, node] of this._nodeMap) {
      if (this._filterKinds.has(node.group ?? node.kind)) this._filteredIdsCache.add(id);
    }
  }

  _rebuildSpatialIndex() {
    const buckets = new Map();
    const cellSize = this._spatialCellSize;
    for (const [id] of this._nodeMap) {
      const pos = this._positions[id];
      if (!pos) continue;
      const gx = Math.floor(pos.x / cellSize);
      const gy = Math.floor(pos.y / cellSize);
      const key = gx + ',' + gy;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = [];
        buckets.set(key, bucket);
      }
      bucket.push(id);
    }
    this._spatialIndex = buckets;
  }

  _edgeStrideProfile(zoom) {
    const edgeCount = this._edges.length;
    if (zoom >= 0.92 || edgeCount < 900) return { active: 1, inactive: 1, arrowMinZoom: 0.32 };
    if (zoom < 0.10) {
      return { active: edgeCount > 3000 ? 16 : 10, inactive: edgeCount > 3000 ? 40 : 24, arrowMinZoom: 1.0 };
    }
    if (zoom >= 0.62) {
      return { active: 1, inactive: edgeCount > 3600 ? 4 : (edgeCount > 1800 ? 2 : 1), arrowMinZoom: 0.4 };
    }
    if (zoom >= 0.4) {
      return { active: edgeCount > 4200 ? 2 : 1, inactive: edgeCount > 4200 ? 10 : (edgeCount > 2200 ? 6 : 3), arrowMinZoom: 0.5 };
    }
    return { active: edgeCount > 4200 ? 3 : 2, inactive: edgeCount > 4200 ? 18 : (edgeCount > 2200 ? 12 : 8), arrowMinZoom: 0.62 };
  }

  _hashInt(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  _fieldColor(field) {
    if (!field) return null;
    return FIELD_CATEGORY_COLORS[field.toLowerCase()] ?? null;
  }

  _truncate(str, max) {
    return str.length <= max ? str : str.slice(0, max - 1) + '…';
  }

  // ── Cluster super-node view ───────────────────────────────────────────────

  _drawClusterSuperNodes(ctx, zoom, focusId) {
    // Group visible nodes by clusterId, compute centroids
    const clusters = new Map(); // clusterId → { pts, kind, label, ids }
    for (const [id, node] of this._nodeMap) {
      const pos = this._positions[id];
      if (!pos || !this._isVisible(id)) continue;
      const cid = node.clusterId || id;
      if (!clusters.has(cid)) {
        clusters.set(cid, { pts: [], kind: null, label: null, ids: [] });
      }
      const c = clusters.get(cid);
      c.pts.push(pos);
      c.ids.push(id);
      if (id === cid) { c.kind = node.kind || 'default'; c.label = node.label || id; }
    }

    // Build inter-cluster edge counts
    const icCounts = new Map(); // "a|b" → count
    for (const edge of this._edges) {
      const sn = this._nodeMap.get(edge.source);
      const tn = this._nodeMap.get(edge.target);
      if (!sn || !tn) continue;
      const sc = sn.clusterId || edge.source;
      const tc = tn.clusterId || edge.target;
      if (sc === tc) continue;
      const key = sc < tc ? sc + '\x00' + tc : tc + '\x00' + sc;
      icCounts.set(key, (icCounts.get(key) || 0) + 1);
    }

    // Compute super-node layout: centroid + radius
    const superNodes = [];
    this._superNodeCache = []; // for hit testing: [{cx,cy,r,cid}]
    const superNodeMap = new Map(); // cid → {cx,cy,r}
    for (const [cid, c] of clusters) {
      if (!c.pts.length) continue;
      let sx = 0, sy = 0;
      for (const p of c.pts) { sx += p.x; sy += p.y; }
      const cx = sx / c.pts.length;
      const cy = sy / c.pts.length;
      const count = c.ids.length;
      const r = Math.max(26, Math.min(56, 16 + Math.sqrt(count) * 2.6));
      const isFocusCluster = focusId ? c.ids.includes(focusId) : false;
      superNodes.push({ cid, cx, cy, r, count, kind: c.kind || 'default', label: c.label || cid, isFocusCluster });
      this._superNodeCache.push({ cx, cy, r, cid });
      superNodeMap.set(cid, { cx, cy, r });
    }

    // Draw inter-cluster connectors
    ctx.lineCap = 'round';
    for (const [key, count] of icCounts) {
      const sep = key.indexOf('\x00');
      const aId = key.slice(0, sep);
      const bId = key.slice(sep + 1);
      const a = superNodeMap.get(aId);
      const b = superNodeMap.get(bId);
      if (!a || !b) continue;
      const alpha = Math.min(0.45, 0.06 + count * 0.018);
      ctx.beginPath();
      ctx.moveTo(a.cx, a.cy);
      ctx.lineTo(b.cx, b.cy);
      ctx.strokeStyle = `rgba(136,153,170,${alpha.toFixed(2)})`;
      ctx.lineWidth = 1.2 / zoom;
      ctx.stroke();
    }

    // Draw super-nodes
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const sn of superNodes) {
      const color = KIND_COLORS[sn.kind] ?? KIND_COLORS.default;

      // Focus ring
      if (sn.isFocusCluster) {
        ctx.beginPath();
        ctx.arc(sn.cx, sn.cy, sn.r + 5 / zoom, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(196,155,240,0.5)';
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();
      }

      // Filled circle
      ctx.beginPath();
      ctx.arc(sn.cx, sn.cy, sn.r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = sn.isFocusCluster ? 0.92 : 0.72;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Stroke ring
      ctx.beginPath();
      ctx.arc(sn.cx, sn.cy, sn.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();

      // Count label
      ctx.font = `bold ${Math.round(11 / zoom)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.92;
      ctx.fillText(String(sn.count), sn.cx, sn.cy);
      ctx.globalAlpha = 1;

      // Hub label below
      const hubLabel = this._truncate(sn.label, 14);
      ctx.font = `${Math.round(8 / zoom)}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(200,210,220,0.72)';
      ctx.fillText(hubLabel, sn.cx, sn.cy + sn.r + 3 / zoom);
      ctx.textBaseline = 'middle';
    }

  }

  _hitTestSuperNode(wx, wy) {
    if (!this._superNodeCache) return null;
    let best = null, bestD = Infinity;
    for (const sn of this._superNodeCache) {
      const dx = wx - sn.cx, dy = wy - sn.cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < sn.r * 1.4 && d < bestD) { bestD = d; best = sn.cid; }
    }
    return best;
  }

  // ── Cluster hulls ─────────────────────────────────────────────────────────

  _drawClusterHulls(ctx, zoom, focusId, hasFocus) {
    const clusters = new Map();
    for (const [id, node] of this._nodeMap) {
      if (!node.clusterId) continue;
      const pos = this._positions[id];
      if (!pos || !this._isVisible(id)) continue;
      if (!clusters.has(node.clusterId)) {
        clusters.set(node.clusterId, { pts: [], hubKind: null });
      }
      const entry = clusters.get(node.clusterId);
      entry.pts.push(pos);
      if (id === node.clusterId) entry.hubKind = node.kind;
    }

    const focusClusterId = focusId ? (this._nodeMap.get(focusId) || {}).clusterId : null;

    for (const [clusterId, { pts, hubKind }] of clusters) {
      if (pts.length < 3) continue;

      const isFocused = hasFocus && clusterId === focusClusterId;
      const isDimmed  = hasFocus && !isFocused;
      const color     = KIND_COLORS[hubKind] ?? KIND_COLORS.default;
      const hull      = this._convexHull(pts);
      if (hull.length < 3) continue;

      // Expand each hull point outward from the centroid by a fixed world-space pad
      const cx  = hull.reduce((s, p) => s + p.x, 0) / hull.length;
      const cy  = hull.reduce((s, p) => s + p.y, 0) / hull.length;
      const pad = 26;
      const exp = hull.map(p => {
        const dx = p.x - cx, dy = p.y - cy;
        const d  = Math.sqrt(dx * dx + dy * dy) || 1;
        return { x: p.x + dx / d * pad, y: p.y + dy / d * pad };
      });

      // Smoothed polygon: quadratic bezier through midpoints, hull pts as control pts
      const n = exp.length;
      ctx.beginPath();
      ctx.moveTo((exp[0].x + exp[1].x) / 2, (exp[0].y + exp[1].y) / 2);
      for (let i = 0; i < n; i++) {
        const cur  = exp[(i + 1) % n];
        const next = exp[(i + 2) % n];
        ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2);
      }
      ctx.closePath();

      ctx.fillStyle   = color;
      ctx.globalAlpha = isDimmed ? 0.025 : (isFocused ? 0.10 : 0.06);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.globalAlpha = isDimmed ? 0.06  : (isFocused ? 0.22 : 0.13);
      ctx.lineWidth   = (isFocused ? 1.5 : 1) / zoom;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  _convexHull(pts) {
    if (pts.length <= 2) return pts.slice();
    let pivot = pts[0];
    for (const p of pts) {
      if (p.y < pivot.y || (p.y === pivot.y && p.x < pivot.x)) pivot = p;
    }
    const rest = pts
      .filter(p => p !== pivot)
      .sort((a, b) => {
        const ca = Math.atan2(a.y - pivot.y, a.x - pivot.x);
        const cb = Math.atan2(b.y - pivot.y, b.x - pivot.x);
        return ca !== cb ? ca - cb
          : Math.hypot(a.x - pivot.x, a.y - pivot.y) - Math.hypot(b.x - pivot.x, b.y - pivot.y);
      });
    const hull = [pivot];
    for (const p of rest) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2], b = hull[hull.length - 1];
        if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) <= 0) hull.pop();
        else break;
      }
      hull.push(p);
    }
    return hull;
  }
}
