/**
 * NodeLayer — renders all graph nodes onto a single PIXI.Graphics object.
 *
 * Supports three LOD tiers:
 *   cluster  — small filled circles, no detail
 *   node     — full-size circles with type color, hub dot
 *   detail   — same as node (labels handled separately by LabelManager)
 *
 * @module graph/renderer/NodeLayer
 */

import * as PIXI from 'pixi.js';
import { KIND_COLORS, LOD_THRESHOLDS } from '../core/schema.js';

// Radius constants
const R_CLUSTER   = 4;
const R_BASE      = 9;
const R_HUB_EXTRA = 4;   // added to base for high-weight hubs
const R_GLOW      = 5;   // extra radius for glow ring
const R_HUB_DOT   = 3;   // center accent dot radius

// Alpha constants
const ALPHA_DIMMED   = 0.18;
const ALPHA_NORMAL   = 1.0;
const ALPHA_GLOW     = 0.35;

// Colors
const COLOR_HOVER_RING    = 0xffffff;
const COLOR_SELECTED_RING = 0xc49bf0;  // lavender
const COLOR_FOCUSED_RING  = 0xc5ffbf;  // mint
const COLOR_HUB_DOT       = 0xffffff;
const COLOR_ORPHAN        = 0x444455;

export class NodeLayer {
  /**
   * @param {PIXI.Container} container  - parent container
   * @param {import('../core/SelectionModel').SelectionModel} selection
   */
  constructor(container, selection) {
    this._gfx = new PIXI.Graphics();
    container.addChild(this._gfx);

    this._selection = selection;
    /** @type {Map<string, import('../core/schema').GraphNode>} */
    this._nodes = new Map();
    /** @type {Map<string, {x:number, y:number}>} */
    this._positions = new Map();
    this._lod = 'node';
    this._dirty = true;

    selection.onChanged(() => { this._dirty = true; });
  }

  /** Replace the full node set. */
  load(nodes) {
    this._nodes.clear();
    for (const n of nodes) this._nodes.set(n.id, n);
    this._dirty = true;
  }

  /** Update positions from worker tick. */
  updatePositions(positions) {
    for (const [id, pos] of Object.entries(positions)) {
      this._positions.set(id, pos);
    }
    this._dirty = true;
  }

  setLOD(lod) {
    if (this._lod !== lod) {
      this._lod = lod;
      this._dirty = true;
    }
  }

  markDirty() {
    this._dirty = true;
  }

  isDirty() {
    return this._dirty;
  }

  /**
   * Called each frame. Returns a Map<id, {x,y,r}> for hit testing.
   * @returns {Map<string, {x:number,y:number,r:number}>}
   */
  render() {
    if (!this._dirty) return this._hitAreas;
    this._dirty = false;

    const g = this._gfx;
    g.clear();

    const sel  = this._selection;
    const lod  = this._lod;
    const hasFocus = sel.hoveredId != null || sel.focusedId != null;
    const focusId  = sel.focusedId ?? sel.hoveredId;

    /** @type {Map<string, {x:number,y:number,r:number}>} */
    const hitAreas = new Map();

    for (const [id, node] of this._nodes) {
      const pos = this._positions.get(id);
      if (!pos) continue;

      const { x, y } = pos;
      const isHovered  = sel.isHovered(id);
      const isSelected = sel.isSelected(id);
      const isFocused  = sel.isFocused(id);
      const isConnected = focusId ? _isConnected(node, focusId) : false;

      const dimmed = hasFocus && !isHovered && !isSelected && !isFocused && !isConnected;

      if (lod === 'cluster') {
        this._drawCluster(g, node, x, y, dimmed);
        hitAreas.set(id, { x, y, r: R_CLUSTER * 2 });
      } else {
        const r = this._nodeRadius(node);
        this._drawNode(g, node, x, y, r, isHovered, isSelected, isFocused, dimmed);
        hitAreas.set(id, { x, y, r: r + R_GLOW });
      }
    }

    this._hitAreas = hitAreas;
    return hitAreas;
  }

  // ─── private ────────────────────────────────────────────────────────────────

  _nodeRadius(node) {
    const weight = node.weight ?? 0;
    return R_BASE + (weight > 0.6 ? R_HUB_EXTRA * weight : 0);
  }

  _nodeColor(node) {
    if (node.isOrphan) return COLOR_ORPHAN;
    const kind = node.kind ?? 'default';
    return KIND_COLORS[kind] ?? KIND_COLORS.default;
  }

  _drawCluster(g, node, x, y, dimmed) {
    const color = this._nodeColor(node);
    g.beginFill(color, dimmed ? ALPHA_DIMMED : 0.85);
    g.drawCircle(x, y, R_CLUSTER);
    g.endFill();
  }

  _drawNode(g, node, x, y, r, isHovered, isSelected, isFocused, dimmed) {
    const color = this._nodeColor(node);
    const alpha = dimmed ? ALPHA_DIMMED : ALPHA_NORMAL;

    // Outer glow ring (hover / selected / focused)
    if (isHovered || isSelected || isFocused) {
      const ringColor = isFocused
        ? COLOR_FOCUSED_RING
        : isSelected
          ? COLOR_SELECTED_RING
          : COLOR_HOVER_RING;
      g.lineStyle(1.5, ringColor, ALPHA_GLOW);
      g.beginFill(0, 0);
      g.drawCircle(x, y, r + R_GLOW);
      g.endFill();
      g.lineStyle(0);
    }

    // Main circle
    g.beginFill(color, alpha);
    g.drawCircle(x, y, r);
    g.endFill();

    // Hub accent dot for high-weight nodes
    if ((node.weight ?? 0) > 0.6 && !dimmed) {
      g.beginFill(COLOR_HUB_DOT, 0.55);
      g.drawCircle(x, y, R_HUB_DOT);
      g.endFill();
    }
  }

  destroy() {
    this._gfx.destroy();
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function _isConnected(node, focusId) {
  if (!node.edges) return false;
  return node.edges.some(e => e.target === focusId || e.source === focusId);
}
