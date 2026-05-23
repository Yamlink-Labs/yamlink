/**
 * LabelManager — LOD-aware text labels above graph nodes.
 *
 * Labels are PIXI.Text objects pooled to avoid GC pressure.
 * They are only visible in 'detail' LOD, fade in/out via alpha.
 *
 * @module graph/renderer/LabelManager
 */

import * as PIXI from 'pixi.js';

const STYLE = new PIXI.TextStyle({
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 11,
  fill: 0xdddddd,
  align: 'center',
  dropShadow: true,
  dropShadowColor: 0x000000,
  dropShadowBlur: 4,
  dropShadowAlpha: 0.7,
  dropShadowDistance: 0,
});

const STYLE_SELECTED = new PIXI.TextStyle({
  ...STYLE._original ?? {},
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 11,
  fill: 0xffffff,
  fontWeight: '600',
  dropShadow: true,
  dropShadowColor: 0x000000,
  dropShadowBlur: 6,
  dropShadowAlpha: 0.9,
  dropShadowDistance: 0,
});

const LABEL_OFFSET_Y  = 14;   // px above node center
const FADE_SPEED      = 0.08; // alpha per frame toward target
const MAX_LABEL_CHARS = 28;

export class LabelManager {
  /**
   * @param {PIXI.Container} container
   * @param {import('../core/SelectionModel').SelectionModel} selection
   */
  constructor(container, selection) {
    this._container = container;
    this._selection = selection;
    /** @type {Map<string, PIXI.Text>} */
    this._labels = new Map();
    /** @type {PIXI.Text[]} */
    this._pool = [];
    this._lod = 'node';
    this._targetAlpha = 0;
    this._currentAlpha = 0;
  }

  load(nodes) {
    // Return all existing label sprites to pool
    for (const [, sprite] of this._labels) {
      sprite.visible = false;
      this._pool.push(sprite);
    }
    this._labels.clear();

    for (const node of nodes) {
      const sprite = this._acquire();
      sprite.text = _truncate(node.label ?? node.id ?? '');
      this._labels.set(node.id, sprite);
    }
  }

  updatePositions(positions, hitAreas) {
    for (const [id, sprite] of this._labels) {
      const pos = positions[id];
      const hit = hitAreas?.get(id);
      if (!pos) continue;
      const r = hit ? hit.r : 9;
      sprite.x = pos.x;
      sprite.y = pos.y - r - LABEL_OFFSET_Y;
    }
  }

  setLOD(lod) {
    this._lod = lod;
    this._targetAlpha = lod === 'detail' ? 1 : 0;
  }

  /** Call each frame. Returns true if any label alpha changed (needs re-render). */
  render() {
    const target = this._targetAlpha;
    let changed = false;

    if (Math.abs(this._currentAlpha - target) > 0.005) {
      this._currentAlpha += (target - this._currentAlpha) * FADE_SPEED;
      if (Math.abs(this._currentAlpha - target) < 0.01) this._currentAlpha = target;
      changed = true;
    }

    const alpha = this._currentAlpha;
    const visible = alpha > 0.02;
    const sel = this._selection;

    for (const [id, sprite] of this._labels) {
      sprite.visible = visible;
      if (!visible) continue;

      const boosted = sel.isHovered(id) || sel.isSelected(id) || sel.isFocused(id);
      sprite.alpha = boosted ? Math.min(1, alpha + 0.3) : alpha;
      sprite.style = boosted ? STYLE_SELECTED : STYLE;
      sprite.anchor.set(0.5, 1);
    }

    return changed;
  }

  destroy() {
    for (const [, sprite] of this._labels) sprite.destroy();
    for (const sprite of this._pool) sprite.destroy();
    this._labels.clear();
    this._pool.length = 0;
  }

  // ─── pool ──────────────────────────────────────────────────────────────────

  _acquire() {
    if (this._pool.length > 0) {
      const sprite = this._pool.pop();
      sprite.visible = true;
      this._container.addChild(sprite);
      return sprite;
    }
    const sprite = new PIXI.Text('', STYLE);
    sprite.anchor.set(0.5, 1);
    sprite.resolution = window.devicePixelRatio ?? 1;
    this._container.addChild(sprite);
    return sprite;
  }
}

function _truncate(str) {
  if (str.length <= MAX_LABEL_CHARS) return str;
  return str.slice(0, MAX_LABEL_CHARS - 1) + '…';
}
