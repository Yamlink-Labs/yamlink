/**
 * GraphRenderer — Pixi.js application that orchestrates edge, node, and label layers.
 *
 * Owns:
 *   - PIXI.Application (WebGL canvas)
 *   - Camera (pan/zoom)
 *   - EdgeLayer, NodeLayer, LabelManager
 *   - Interaction handlers (pointer events, wheel)
 *   - Hit testing (O(n) for now; upgrade to quadtree at Phase 2)
 *
 * @module graph/renderer/GraphRenderer
 */

import * as PIXI from 'pixi.js';
import { Camera }         from '../core/Camera.js';
import { SelectionModel } from '../core/SelectionModel.js';
import { EdgeLayer }      from './EdgeLayer.js';
import { NodeLayer }      from './NodeLayer.js';
import { LabelManager }   from './LabelManager.js';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const WHEEL_SENSITIVITY = 0.001;
const CLICK_MOVE_THRESHOLD = 4; // px — distinguish click vs drag

export class GraphRenderer {
  /**
   * @param {HTMLElement} container
   * @param {{
   *   width?: number,
   *   height?: number,
   *   onNodeClick?: (id: string, node: object) => void,
   *   onNodeHover?: (id: string | null, node: object | null) => void,
   *   onReady?: () => void,
   * }} opts
   */
  constructor(container, opts = {}) {
    this._container = container;
    this._opts = opts;

    const w = opts.width  ?? container.clientWidth  ?? 800;
    const h = opts.height ?? container.clientHeight ?? 600;

    this._app = new PIXI.Application({
      width: w,
      height: h,
      backgroundColor: 0x0d0d14,
      antialias: true,
      resolution: window.devicePixelRatio ?? 1,
      autoDensity: true,
    });
    container.appendChild(this._app.view);

    // World container — camera transforms applied here
    this._world = new PIXI.Container();
    this._app.stage.addChild(this._world);

    this._camera    = new Camera(w, h);
    this._selection = new SelectionModel();

    // Layer order: edges → nodes → labels
    this._edgeLayer   = new EdgeLayer(this._world, this._selection);
    this._nodeLayer   = new NodeLayer(this._world, this._selection);
    const labelContainer = new PIXI.Container();
    this._world.addChild(labelContainer);
    this._labelMgr  = new LabelManager(labelContainer, this._selection);

    /** @type {Map<string, object>} id → node data */
    this._nodeMap = new Map();
    /** @type {Map<string, {x:number,y:number}>} latest positions from worker */
    this._positions = {};
    /** @type {Map<string, {x:number,y:number,r:number}>} hit areas from last NodeLayer render */
    this._hitAreas = new Map();

    this._setupInteraction();
    this._startRenderLoop();

    opts.onReady?.();
  }

  // ─── public API ─────────────────────────────────────────────────────────────

  /**
   * Load a full graph payload.
   * @param {{ nodes: object[], edges: object[] }} graphData
   */
  load(graphData) {
    const { nodes, edges } = graphData;

    this._nodeMap.clear();
    for (const n of nodes) this._nodeMap.set(n.id, n);

    this._edgeLayer.load(edges);
    this._nodeLayer.load(nodes);
    this._labelMgr.load(nodes);

    // Auto-fit on initial load
    this._fitToNodes();
  }

  /** Update positions from the layout worker tick. */
  updatePositions(positions) {
    this._positions = positions;
    this._nodeLayer.updatePositions(positions);
    this._edgeLayer.updatePositions(positions);
  }

  resize(w, h) {
    this._app.renderer.resize(w, h);
    this._camera.resize(w, h);
    this._nodeLayer.markDirty();
  }

  fitView() {
    this._fitToNodes();
  }

  /** Programmatically select a node by id. */
  selectNode(id) {
    this._selection.toggleSelected(id);
  }

  /** Clear all selection state. */
  clearSelection() {
    this._selection.clear();
  }

  destroy() {
    this._app.destroy(true, { children: true });
    this._edgeLayer.destroy();
    this._nodeLayer.destroy();
    this._labelMgr.destroy();
  }

  // ─── render loop ────────────────────────────────────────────────────────────

  _startRenderLoop() {
    this._app.ticker.add(() => this._render());
  }

  _render() {
    const lod = this._camera.getLOD();

    this._edgeLayer.setLOD(lod);
    this._nodeLayer.setLOD(lod);
    this._labelMgr.setLOD(lod);

    // Apply camera transform to world container
    const t = this._camera.getTransform();
    this._world.position.set(t.tx, t.ty);
    this._world.scale.set(t.zoom);

    // Render layers — NodeLayer returns updated hit areas
    this._edgeLayer.render();
    const hitAreas = this._nodeLayer.render();
    if (hitAreas) {
      this._hitAreas = hitAreas;
      this._labelMgr.updatePositions(this._positions, hitAreas);
    }
    this._labelMgr.render();
  }

  // ─── interaction ────────────────────────────────────────────────────────────

  _setupInteraction() {
    const view = this._app.view;

    // Pointer events
    let dragStart = null;
    let pointerDownPos = null;

    view.addEventListener('pointerdown', e => {
      dragStart = { x: e.clientX, y: e.clientY, ...this._camera.snapshot() };
      pointerDownPos = { x: e.clientX, y: e.clientY };
      view.setPointerCapture(e.pointerId);
    });

    view.addEventListener('pointermove', e => {
      if (dragStart) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        this._camera.restore(dragStart);
        this._camera.pan(dx, dy);
        return;
      }

      // Hover hit test
      const world = this._screenToWorld(e.clientX, e.clientY);
      const hovered = this._hitTest(world.x, world.y);
      const prev = this._selection.hoveredId;
      if (hovered !== prev) {
        this._selection.setHovered(hovered);
        const node = hovered ? this._nodeMap.get(hovered) : null;
        this._opts.onNodeHover?.(hovered, node);
        view.style.cursor = hovered ? 'pointer' : 'default';
      }
    });

    view.addEventListener('pointerup', e => {
      if (!dragStart || !pointerDownPos) { dragStart = null; return; }

      const dx = Math.abs(e.clientX - pointerDownPos.x);
      const dy = Math.abs(e.clientY - pointerDownPos.y);
      dragStart = null;
      pointerDownPos = null;

      if (dx < CLICK_MOVE_THRESHOLD && dy < CLICK_MOVE_THRESHOLD) {
        // It was a click
        const world = this._screenToWorld(e.clientX, e.clientY);
        const hit = this._hitTest(world.x, world.y);
        if (hit) {
          this._selection.toggleSelected(hit);
          this._selection.setFocused(hit);
          this._opts.onNodeClick?.(hit, this._nodeMap.get(hit));
        } else {
          this._selection.clear();
          this._opts.onNodeClick?.(null, null);
        }
      }

      view.releasePointerCapture(e.pointerId);
    });

    view.addEventListener('pointerleave', () => {
      dragStart = null;
      if (this._selection.hoveredId) {
        this._selection.setHovered(null);
        this._opts.onNodeHover?.(null, null);
        view.style.cursor = 'default';
      }
    });

    // Wheel zoom
    view.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = view.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = 1 - e.deltaY * WHEEL_SENSITIVITY;
      this._camera.zoomAt(factor, sx, sy, MIN_ZOOM, MAX_ZOOM);
    }, { passive: false });

    // Double-click to fit
    view.addEventListener('dblclick', () => this._fitToNodes());
  }

  _screenToWorld(clientX, clientY) {
    const rect = this._app.view.getBoundingClientRect();
    return this._camera.screenToWorld(clientX - rect.left, clientY - rect.top);
  }

  /** @returns {string|null} node id or null */
  _hitTest(wx, wy) {
    let best = null;
    let bestDist = Infinity;

    for (const [id, area] of this._hitAreas) {
      const dx = wx - area.x;
      const dy = wy - area.y;
      const d2 = dx * dx + dy * dy;
      const r2 = area.r * area.r;
      if (d2 <= r2 && d2 < bestDist) {
        bestDist = d2;
        best = id;
      }
    }

    return best;
  }

  _fitToNodes() {
    if (this._hitAreas.size === 0 && Object.keys(this._positions).length === 0) return;

    const positions = Object.values(this._positions);
    if (positions.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { x, y } of positions) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    const { width: vw, height: vh } = this._app.screen;
    this._camera.fitBounds(minX, minY, maxX, maxY, vw, vh, 80);
  }
}
