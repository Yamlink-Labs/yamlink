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

    // Graph data
    /** @type {Map<string, object>} */
    this._nodeMap   = new Map();
    /** @type {object[]} */
    this._edges     = [];
    /** @type {Record<string, {x:number,y:number}>} */
    this._positions = {};

    // Interaction
    this._hoveredId   = null;
    this._selectedId  = null;
    this._drag        = null;  // camera pan drag
    this._nodeDrag    = null;  // node drag { id }
    this._pointerDown = null;

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
    this._rebuildFilterCache();
    this._dirty = true;
  }

  updatePositions(positions) {
    this._positions = positions;
    this._dirty = true;
  }

  resize(w, h) {
    const prevW = this._canvas.width  / this._dpr;
    const prevH = this._canvas.height / this._dpr;
    this._resize(w, h);
    // Scale camera proportionally so the view stays centred after a dimension change.
    // This handles the common case where the container starts at 0 (sidebar not yet laid
    // out), the fallback 900×600 camera is set, then ResizeObserver fires with the real size.
    if (prevW > 0 && prevH > 0) {
      this._cam.x = this._cam.x * w / prevW;
      this._cam.y = this._cam.y * h / prevH;
    }
    this._dirty = true;
  }

  fitView() {
    const positions = Object.values(this._positions);
    if (!positions.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { x, y } of positions) {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    const pad = 60;
    const vw  = this._canvas.width  / this._dpr;
    const vh  = this._canvas.height / this._dpr;
    const scaleX = (vw - pad * 2) / (maxX - minX || 1);
    const scaleY = (vh - pad * 2) / (maxY - minY || 1);
    this._cam.zoom = Math.min(scaleX, scaleY, 2);
    this._cam.x = vw / 2 - ((minX + maxX) / 2) * this._cam.zoom;
    this._cam.y = vh / 2 - ((minY + maxY) / 2) * this._cam.zoom;
    this._dirty = true;
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
   * Show only nodes whose .kind is in the provided Set.
   * Pass null to clear the filter and show all nodes.
   * @param {Set<string>|null} kinds
   */
  setFilter(kinds) {
    this._filterKinds = (kinds instanceof Set && kinds.size > 0) ? kinds : null;
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
    this._canvas.remove();
  }

  /** Zoom by a factor, centred on the canvas centre. */
  zoomBy(factor) {
    const w  = this._canvas.width  / this._dpr;
    const h  = this._canvas.height / this._dpr;
    const cx = w / 2, cy = h / 2;
    const wx = (cx - this._cam.x) / this._cam.zoom;
    const wy = (cy - this._cam.y) / this._cam.zoom;
    this._cam.zoom = Math.max(0.05, Math.min(8, this._cam.zoom * factor));
    this._cam.x = cx - wx * this._cam.zoom;
    this._cam.y = cy - wy * this._cam.zoom;
    this._dirty = true;
  }

  /** Programmatically set the selected node (without firing click callbacks). */
  setSelected(id) {
    this._selectedId = id || null;
    this._dirty = true;
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  _loop() {
    this._animId = requestAnimationFrame(() => this._loop());
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

    const focusId  = this._hoveredId || this._selectedId;
    const hasFocus = !!focusId;
    const hasSearch = this._searchQuery.length > 0;

    // ── Edge pass (batched by style bucket) ──────────────────────────────────
    if (this._layers.semantic) {
      this._drawEdgesBatchedSemantic(ctx, zoom, focusId, hasFocus);
    } else {
      this._drawEdgesBatchedBase(ctx, zoom, focusId, hasFocus);
    }

    // ── Node pass ────────────────────────────────────────────────────────────
    for (const [id, node] of this._nodeMap) {
      const pos = this._positions[id];
      if (!pos || !this._isVisible(id)) continue;
      if (!this._isInView(pos, this._nodeRadius(node) + 6, zoom)) continue;

      const isHovered  = id === this._hoveredId;
      const isSelected = id === this._selectedId;
      const isActive   = isHovered || isSelected;
      const dimmed     = this._isDimmed(id, focusId, hasFocus, hasSearch);
      const r          = this._nodeRadius(node);
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

      // Hub accent dot
      if ((node.weight ?? 0) > 0.6 && !dimmed) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 3 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fill();
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

    // ── Label pass (LOD — density drops at low zoom) ──────────────────────────
    if (zoom > 0.4) {
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font         = `${11 / zoom}px Inter, system-ui, sans-serif`;
      // Weight threshold rises as zoom decreases — only hubs/selected shown when zoomed out
      const weightThreshold = zoom > 1.2 ? 0 : zoom > 0.7 ? 0.3 : 0.6;

      for (const [id, node] of this._nodeMap) {
        const pos = this._positions[id];
        if (!pos || !this._isVisible(id)) continue;
        if (!this._isInView(pos, 30, zoom)) continue;

        const isActive = id === this._hoveredId || id === this._selectedId;
        const dimmed   = this._isDimmed(id, focusId, hasFocus, hasSearch);
        if (dimmed && !isActive) continue;
        if (!isActive && (node.weight ?? 0) < weightThreshold) continue;

        const r     = this._nodeRadius(node);
        const label = this._truncate(node.label || id, 24);

        ctx.fillStyle   = isActive ? '#ffffff' : 'rgba(200,210,220,0.75)';
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

    for (const edge of this._edges) {
      const sp = this._positions[edge.source];
      const tp = this._positions[edge.target];
      if (!sp || !tp) continue;
      if (!this._isVisible(edge.source) || !this._isVisible(edge.target)) continue;
      if (!this._isInView(sp, 2, zoom) && !this._isInView(tp, 2, zoom)) continue;

      const isActive = hasFocus && (edge.source === focusId || edge.target === focusId);
      (isActive ? activePts : inactivePts).push(sp.x, sp.y, tp.x, tp.y);
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

    for (const edge of this._edges) {
      const sp = this._positions[edge.source];
      const tp = this._positions[edge.target];
      if (!sp || !tp) continue;
      if (!this._isVisible(edge.source) || !this._isVisible(edge.target)) continue;
      if (!this._isInView(sp, 2, zoom) && !this._isInView(tp, 2, zoom)) continue;

      const isActive = hasFocus && (edge.source === focusId || edge.target === focusId);
      const dimmed   = hasFocus && !isActive;
      const alpha    = dimmed ? 0.04 : (isActive ? 0.8 : 0.45);

      const srcNode  = this._nodeMap.get(edge.source);
      const tgtNode  = this._nodeMap.get(edge.target);
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
      const lw           = (edge.strength === 'strong' ? 1.5 : 0.9) / zoom;
      const isDashed     = edge.strength === 'weak';

      const key = `${baseColor}|${lw.toFixed(3)}|${isDashed ? 1 : 0}|${alpha.toFixed(2)}`;
      if (!lineBuckets.has(key)) {
        lineBuckets.set(key, { color: baseColor, lw, isDashed, alpha, pts: [] });
      }
      lineBuckets.get(key).pts.push(x1, y1, x2, y2);

      if (!dimmed && edge.directed !== false) {
        arrowQueue.push({ ux, uy, rTgt, tp, arrowLen, color: baseColor, alpha });
      }
    }

    // Draw line batches
    for (const b of lineBuckets.values()) {
      ctx.save();
      ctx.globalAlpha = b.alpha;
      if (b.isDashed) ctx.setLineDash([4 / zoom, 4 / zoom]);
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

    c.addEventListener('pointerdown', e => {
      const w   = this._toWorld(e);
      const hit = this._hitTest(w.x, w.y);
      this._pointerDown = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);

      if (hit) {
        // Node drag — pin the node and heat up the simulation
        this._nodeDrag = { id: hit };
        this._opts.onNodeDragStart?.(hit);
        c.style.cursor = 'grabbing';
      } else {
        // Canvas pan
        this._drag = { startX: e.clientX, startY: e.clientY, camX: this._cam.x, camY: this._cam.y };
      }
    });

    c.addEventListener('pointermove', e => {
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
        const w = this._toWorld(e);
        this._opts.onNodeDragEnd?.(this._nodeDrag.id, w.x, w.y);
        this._nodeDrag    = null;
        this._pointerDown = null;
        c.releasePointerCapture(e.pointerId);
        c.style.cursor = this._hoveredId ? 'pointer' : 'default';
        return;
      }

      const d = this._pointerDown;
      this._drag        = null;
      this._pointerDown = null;
      c.releasePointerCapture(e.pointerId);
      if (d && Math.abs(e.clientX - d.x) < 4 && Math.abs(e.clientY - d.y) < 4) {
        const w   = this._toWorld(e);
        const hit = this._hitTest(w.x, w.y);
        this._selectedId = hit === this._selectedId ? null : hit;
        this._opts.onNodeClick?.(hit, hit ? this._nodeMap.get(hit) : null);
        this._dirty = true;
      }
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
      const factor = 1 - e.deltaY * 0.001;
      const wx     = (sx - this._cam.x) / this._cam.zoom;
      const wy     = (sy - this._cam.y) / this._cam.zoom;
      this._cam.zoom = Math.max(0.05, Math.min(8, this._cam.zoom * factor));
      this._cam.x    = sx - wx * this._cam.zoom;
      this._cam.y    = sy - wy * this._cam.zoom;
      this._dirty    = true;
    }, { passive: false });

    c.addEventListener('dblclick', () => this.fitView());

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

  _nodeRadius(node) {
    const edgeCount = node.edges?.length ?? 0;
    return 5 + (node.weight ?? 0) * 8 + Math.log1p(edgeCount) * 2;
  }

  _hitTest(wx, wy) {
    let best = null, bestD = Infinity;
    for (const [id, node] of this._nodeMap) {
      if (!this._isVisible(id)) continue;
      const pos = this._positions[id];
      if (!pos) continue;
      const r  = this._nodeRadius(node) + 4;
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
    const node = this._nodeMap.get(id);
    return node?.edges?.some(e => e.target === focusId || e.source === focusId) ?? false;
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

  _rebuildFilterCache() {
    if (!this._filterKinds) {
      this._filteredIdsCache = null;
      return;
    }
    this._filteredIdsCache = new Set();
    for (const [id, node] of this._nodeMap) {
      if (this._filterKinds.has(node.kind)) this._filteredIdsCache.add(id);
    }
  }

  _fieldColor(field) {
    if (!field) return null;
    return FIELD_CATEGORY_COLORS[field.toLowerCase()] ?? null;
  }

  _truncate(str, max) {
    return str.length <= max ? str : str.slice(0, max - 1) + '…';
  }
}
