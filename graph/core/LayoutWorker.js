/**
 * graph-core/LayoutWorker.js
 *
 * Main-thread proxy for the layout Web Worker.
 * Abstracts the message protocol — callers just call .init(), .run(), etc.
 *
 * The workerUrl is passed in so the embed layer controls where the bundle lives
 * (different paths for docs site vs. VS Code webview vs. Atomix).
 */
export class LayoutWorker {
  /**
   * @param {string} workerUrl - absolute or relative URL to graph-layout-worker.js
   */
  constructor(workerUrl) {
    this._worker      = new Worker(workerUrl);
    this._onPositions = null;
    this._onSettled   = null;

    this._worker.onmessage = ({ data }) => {
      if (data.type === 'POSITIONS' && this._onPositions) {
        this._onPositions(data.positions, data.alpha);
      }
      if (data.type === 'SETTLED' && this._onSettled) {
        this._onSettled(data.positions);
      }
    };

    this._worker.onerror = (err) => {
      console.error('[LayoutWorker] worker error:', err);
    };
  }

  /** @param {(positions: Array<{id,x,y}>, alpha: number) => void} cb */
  onPositions(cb) { this._onPositions = cb; return this; }

  /** @param {(positions: Array<{id,x,y}>) => void} cb */
  onSettled(cb) { this._onSettled = cb; return this; }

  /**
   * Send the full graph to the worker and prepare the simulation.
   * Does NOT start ticking — call .run() after.
   */
  init(nodes, edges) {
    this._worker.postMessage({ type: 'INIT', nodes, edges });
    return this;
  }

  /**
   * Start the simulation.
   * @param {number} [alpha=1] - simulation heat (1 = fully hot, 0 = frozen)
   */
  run(alpha = 1) {
    this._worker.postMessage({ type: 'RUN', alpha });
    return this;
  }

  stop() {
    this._worker.postMessage({ type: 'STOP' });
    return this;
  }

  tick() {
    this._worker.postMessage({ type: 'TICK' });
    return this;
  }

  pin(nodeId, x, y) {
    this._worker.postMessage({ type: 'PIN', nodeId, x, y });
    return this;
  }

  unpin(nodeId) {
    this._worker.postMessage({ type: 'UNPIN', nodeId });
    return this;
  }

  dragStart(nodeId) {
    this._worker.postMessage({ type: 'DRAG_START', nodeId });
    return this;
  }

  drag(nodeId, x, y) {
    this._worker.postMessage({ type: 'PIN', nodeId, x, y });
    return this;
  }

  dragEnd(nodeId) {
    this._worker.postMessage({ type: 'UNPIN', nodeId });
    return this;
  }

  /**
   * Incremental update — add/remove nodes/edges without full restart.
   * @param {{ nodes?: GraphNode[], edges?: GraphEdge[] }} added
   * @param {{ nodeIds?: string[], edgeIds?: string[] }} removed
   */
  update(added = {}, removed = {}) {
    this._worker.postMessage({ type: 'UPDATE', added, removed });
    return this;
  }

  destroy() {
    this._worker.terminate();
  }
}
