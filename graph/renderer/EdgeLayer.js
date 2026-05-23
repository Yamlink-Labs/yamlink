/**
 * EdgeLayer — renders all graph edges onto a single PIXI.Graphics object.
 *
 * Coordinates are raw world-space. Camera transform is applied to the parent
 * container by GraphRenderer, not here.
 *
 * @module graph/renderer/EdgeLayer
 */

import * as PIXI from 'pixi.js';
import { EDGE_COLORS } from '../core/schema.js';

const STRENGTH_ALPHA = { strong: 0.55, medium: 0.28, weak: 0.10 };
const STRENGTH_WIDTH = { strong: 1.8,  medium: 0.9,  weak: 0.5  };
const ALPHA_DIM      = 0.04;
const ARROW_LEN      = 8;
const ARROW_W        = 4;

export class EdgeLayer {
  /**
   * @param {PIXI.Container} container
   * @param {import('../core/SelectionModel').SelectionModel} selection
   */
  constructor(container, selection) {
    this._gfx = new PIXI.Graphics();
    container.addChildAt(this._gfx, 0); // always behind nodes

    this._selection  = selection;
    /** @type {object[]} */
    this._edges      = [];
    /** @type {Record<string, {x:number,y:number}>} */
    this._positions  = {};
    this._lod        = 'node';
    this._dirty      = true;

    selection.onChanged(() => { this._dirty = true; });
  }

  load(edges) {
    this._edges = edges;
    this._dirty = true;
  }

  updatePositions(positions) {
    this._positions = positions;
    this._dirty     = true;
  }

  setLOD(lod) {
    if (this._lod !== lod) {
      this._lod   = lod;
      this._dirty = true;
    }
  }

  render() {
    if (!this._dirty) return;
    this._dirty = false;

    const g   = this._gfx;
    const lod = this._lod;
    g.clear();

    // Suppress all edges in cluster mode
    if (lod === 'cluster') return;

    const sel      = this._selection;
    const active   = sel.focusedId ?? sel.hoveredId;
    const hasFocus = active != null;

    for (const edge of this._edges) {
      const sp = this._positions[edge.source];
      const tp = this._positions[edge.target];
      if (!sp || !tp) continue;

      const isActive = hasFocus && (edge.source === active || edge.target === active);
      const alpha = hasFocus
        ? (isActive ? (STRENGTH_ALPHA[edge.strength] ?? 0.25) : ALPHA_DIM)
        : (STRENGTH_ALPHA[edge.strength] ?? 0.2);

      const color = isActive ? 0xc5ffbf : (EDGE_COLORS[edge.strength] ?? 0x666b72);
      const width = STRENGTH_WIDTH[edge.strength] ?? 0.9;

      g.lineStyle(width, color, alpha);
      g.moveTo(sp.x, sp.y);
      g.lineTo(tp.x, tp.y);

      // Arrowhead for directed strong edges in detail LOD
      if (lod === 'detail' && edge.directed && edge.strength !== 'weak' && isActive) {
        this._drawArrow(g, sp, tp, color, alpha);
      }
    }
  }

  destroy() {
    this._gfx.destroy();
  }

  // ─── private ────────────────────────────────────────────────────────────────

  _drawArrow(g, src, tgt, color, alpha) {
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    const tip   = { x: tgt.x - ux * 3, y: tgt.y - uy * 3 };
    const base  = { x: tip.x - ux * ARROW_LEN, y: tip.y - uy * ARROW_LEN };
    const left  = { x: base.x - uy * ARROW_W,  y: base.y + ux * ARROW_W  };
    const right = { x: base.x + uy * ARROW_W,  y: base.y - ux * ARROW_W  };
    g.lineStyle(0);
    g.beginFill(color, alpha * 1.4);
    g.moveTo(tip.x, tip.y);
    g.lineTo(left.x, left.y);
    g.lineTo(right.x, right.y);
    g.closePath();
    g.endFill();
  }
}
