/**
 * Canvas2DRenderer — lightweight 2D canvas graph renderer.
 * No Pixi.js, no WebGL. Just a single <canvas> + requestAnimationFrame.
 *
 * Replaces EdgeLayer + NodeLayer + LabelManager + GraphRenderer.
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
    this._canvas.style.width  = '100%';
    this._canvas.style.height = '100%';
    this._canvas.style.display = 'block';
    this._resize(w, h);
    container.appendChild(this._canvas);

    this._ctx = this._canvas.getContext('2d');

    // Camera state
    this._cam = { x: w / 2, y: h / 2, zoom: 1 };

    // Graph data
    /** @type {Map<string, object>} */
    this._nodeMap   = new Map();
    /** @type {object[]} */
    this._edges     = [];
    /** @type {Record<string, {x:number,y:number}>} */
    this._positions = {};

    // Interaction state
    this._hoveredId  = null;
    this._selectedId = null;
    this._drag       = null;
    this._pointerDown = null;

    // Render state
    this._animId  = null;
    this._dirty   = true;

    this._setupPointerEvents();
    this._loop();

    opts.onReady?.();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  load(graphData) {
    this._nodeMap.clear();
    for (const n of graphData.nodes) this._nodeMap.set(n.id, n);
    this._edges = graphData.edges;
    this._dirty = true;
  }

  updatePositions(positions) {
    this._positions = positions;
    this._dirty = true;
  }

  resize(w, h) {
    this._resize(w, h);
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

  destroy() {
    cancelAnimationFrame(this._animId);
    this._canvas.remove();
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  _loop() {
    this._animId = requestAnimationFrame(() => this._loop());
    if (!this._dirty) return;
    this._dirty = false;
    this._draw();
  }

  _draw() {
    const ctx   = this._ctx;
    const dpr   = this._dpr;
    const cw    = this._canvas.width;
    const ch    = this._canvas.height;
    const { x: cx, y: cy, zoom } = this._cam;

    const w = cw / dpr;
    const h = ch / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);
    // Explicit dark clear — don't rely on CSS bleeding through canvas transparency
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    // Camera transform
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);

    const hasFocus = this._hoveredId || this._selectedId;

    // Draw edges
    for (const edge of this._edges) {
      const sp = this._positions[edge.source];
      const tp = this._positions[edge.target];
      if (!sp || !tp) continue;

      const isActive = hasFocus && (edge.source === hasFocus || edge.target === hasFocus);
      const alpha = hasFocus ? (isActive ? 0.5 : 0.04) : 0.2;

      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.strokeStyle = isActive ? 'rgba(197,255,191,' + alpha + ')' : 'rgba(136,153,170,' + alpha + ')';
      ctx.lineWidth   = isActive ? 1.5 / zoom : 0.8 / zoom;
      ctx.stroke();
    }

    // Draw nodes
    for (const [id, node] of this._nodeMap) {
      const pos = this._positions[id];
      if (!pos) continue;

      const { x, y } = pos;
      const isHovered  = id === this._hoveredId;
      const isSelected = id === this._selectedId;
      const isActive   = isHovered || isSelected;
      const isConnected = hasFocus ? this._isConnectedTo(id, hasFocus) : false;
      const dimmed = hasFocus && !isActive && !isConnected;

      const r  = this._nodeRadius(node);
      const color = KIND_COLORS[node.kind] ?? KIND_COLORS.default;

      // Glow ring for hover/selected
      if (isActive) {
        ctx.beginPath();
        ctx.arc(x, y, r + 5 / zoom, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected ? 'rgba(196,155,240,0.5)' : 'rgba(255,255,255,0.3)';
        ctx.lineWidth   = 1.5 / zoom;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = dimmed ? 'rgba(136,153,170,0.15)' : color;
      ctx.globalAlpha = dimmed ? DIM_ALPHA : (isActive ? 1 : 0.85);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Hub accent dot for high-weight nodes
      if ((node.weight ?? 0) > 0.6 && !dimmed) {
        ctx.beginPath();
        ctx.arc(x, y, 3 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fill();
      }
    }

    // Draw labels (only when zoomed in enough)
    if (zoom > 0.7) {
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font         = `${11 / zoom}px Inter, system-ui, sans-serif`;

      for (const [id, node] of this._nodeMap) {
        const pos = this._positions[id];
        if (!pos) continue;
        const isActive  = id === this._hoveredId || id === this._selectedId;
        const hasFocusLocal = this._hoveredId || this._selectedId;
        const isConn    = hasFocusLocal ? this._isConnectedTo(id, hasFocusLocal) : false;
        const dimmed    = hasFocusLocal && !isActive && !isConn;
        if (dimmed) continue;

        const r     = this._nodeRadius(node);
        const label = this._truncate(node.label || id, 24);

        ctx.fillStyle = isActive ? '#ffffff' : 'rgba(200,210,220,0.75)';
        ctx.shadowColor = '#000';
        ctx.shadowBlur  = 4;
        ctx.fillText(label, pos.x, pos.y - r - 4 / zoom);
        ctx.shadowBlur  = 0;
      }
    }

    ctx.restore();
  }

  // ── Pointer events ────────────────────────────────────────────────────────

  _setupPointerEvents() {
    const c = this._canvas;

    c.addEventListener('pointerdown', e => {
      this._drag = { startX: e.clientX, startY: e.clientY, camX: this._cam.x, camY: this._cam.y };
      this._pointerDown = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
    });

    c.addEventListener('pointermove', e => {
      if (this._drag) {
        this._cam.x = this._drag.camX + (e.clientX - this._drag.startX);
        this._cam.y = this._drag.camY + (e.clientY - this._drag.startY);
        this._dirty = true;
        return;
      }
      const w = this._toWorld(e);
      const hit = this._hitTest(w.x, w.y);
      if (hit !== this._hoveredId) {
        this._hoveredId = hit;
        this._opts.onNodeHover?.(hit, hit ? this._nodeMap.get(hit) : null);
        c.style.cursor = hit ? 'pointer' : 'default';
        this._dirty = true;
      }
    });

    c.addEventListener('pointerup', e => {
      const d = this._pointerDown;
      this._drag = null;
      this._pointerDown = null;
      c.releasePointerCapture(e.pointerId);

      if (d && Math.abs(e.clientX - d.x) < 4 && Math.abs(e.clientY - d.y) < 4) {
        const w = this._toWorld(e);
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
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = 1 - e.deltaY * 0.001;
      const wx = (sx - this._cam.x) / this._cam.zoom;
      const wy = (sy - this._cam.y) / this._cam.zoom;
      this._cam.zoom = Math.max(0.05, Math.min(8, this._cam.zoom * factor));
      this._cam.x = sx - wx * this._cam.zoom;
      this._cam.y = sy - wy * this._cam.zoom;
      this._dirty = true;
    }, { passive: false });

    c.addEventListener('dblclick', () => this.fitView());
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _resize(w, h) {
    this._canvas.width  = Math.round(w * this._dpr);
    this._canvas.height = Math.round(h * this._dpr);
    this._canvas.style.width  = w + 'px';
    this._canvas.style.height = h + 'px';
  }

  _nodeRadius(node) {
    return 6 + (node.weight ?? 0) * 10;
  }

  _hitTest(wx, wy) {
    let best = null, bestD = Infinity;
    for (const [id, node] of this._nodeMap) {
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

  _truncate(str, max) {
    return str.length <= max ? str : str.slice(0, max - 1) + '…';
  }
}
