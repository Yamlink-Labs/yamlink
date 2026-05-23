import { LOD_THRESHOLDS } from './schema.js';

/**
 * Immutable viewport model. Owns zoom/pan state and all coordinate transforms.
 * Engine-agnostic — no DOM, no Pixi, no browser assumptions.
 */
export class Camera {
  constructor(viewW = 800, viewH = 600) {
    this.x    = viewW / 2;
    this.y    = viewH / 2;
    this.zoom = 1;
    this._viewW = viewW;
    this._viewH = viewH;
  }

  resize(w, h) {
    this._viewW = w;
    this._viewH = h;
  }

  /** Returns the {tx, ty, zoom} transform to apply to a world container. */
  getTransform() {
    return { tx: this.x, ty: this.y, zoom: this.zoom };
  }

  /** World → screen */
  worldToScreen(wx, wy) {
    return { x: wx * this.zoom + this.x, y: wy * this.zoom + this.y };
  }

  /** Screen → world */
  screenToWorld(sx, sy) {
    return { x: (sx - this.x) / this.zoom, y: (sy - this.y) / this.zoom };
  }

  pan(dx, dy) {
    this.x += dx;
    this.y += dy;
  }

  /**
   * Zoom centered on a screen point (so the world point under the cursor stays fixed).
   */
  zoomAt(factor, sx, sy, minZoom = 0.04, maxZoom = 10) {
    const wx = (sx - this.x) / this.zoom;
    const wy = (sy - this.y) / this.zoom;
    this.zoom = Math.max(minZoom, Math.min(maxZoom, this.zoom * factor));
    this.x = sx - wx * this.zoom;
    this.y = sy - wy * this.zoom;
  }

  /**
   * LOD level based on current zoom.
   * @returns {'cluster'|'node'|'detail'}
   */
  getLOD() {
    if (this.zoom < LOD_THRESHOLDS.CLUSTER_MAX) return 'cluster';
    if (this.zoom < LOD_THRESHOLDS.NODE_MAX)    return 'node';
    return 'detail';
  }

  /**
   * Fit camera so all nodes are visible, with padding.
   */
  fitBounds(minX, minY, maxX, maxY, viewW, viewH, padding = 0.12) {
    const rangeX = (maxX - minX) || 1;
    const rangeY = (maxY - minY) || 1;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.zoom = Math.min(1.4, viewW / rangeX, viewH / rangeY) * (1 - padding);
    this.x = viewW / 2 - cx * this.zoom;
    this.y = viewH / 2 - cy * this.zoom;
  }

  /** Serialisable snapshot for saved viewpoints. */
  snapshot() {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  restore({ x, y, zoom }) {
    this.x = x; this.y = y; this.zoom = zoom;
  }
}
