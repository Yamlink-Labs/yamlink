/**
 * graph/index.js — Public API for the Yamlink Graph Engine.
 */

import { Canvas2DRenderer } from './renderer/Canvas2DRenderer.js';
import { InlineLayout }     from './core/InlineLayout.js';
import { LayoutWorker }     from './core/LayoutWorker.js';

export { adaptYamlinkModel, adaptDocsGraph } from './adapter-yamlink/index.js';
export { Canvas2DRenderer } from './renderer/Canvas2DRenderer.js';
export { InlineLayout }     from './core/InlineLayout.js';
export { LayoutWorker }     from './core/LayoutWorker.js';

/**
 * @param {{
 *   container:    HTMLElement,
 *   workerUrl?:   string,       // omit to use InlineLayout (file:// safe)
 *   width?:       number,
 *   height?:      number,
 *   onNodeClick?: (id, node) => void,
 *   onNodeHover?: (id, node) => void,
 *   onSettled?:   () => void,
 * }} opts
 */
export function createGraph(opts = {}) {
  const renderer = new Canvas2DRenderer(opts.container, {
    width:            opts.width,
    height:           opts.height,
    onNodeClick:      opts.onNodeClick,
    onNodeHover:      opts.onNodeHover,
    onNodeDragStart:  (id)       => layout?.dragStart?.(id),
    onNodeDrag:       (id, x, y) => layout?.drag?.(id, x, y),
    onNodeDragEnd:    (id)       => layout?.dragEnd?.(id),
  });

  let layout;

  if (opts.workerUrl) {
    const worker = new LayoutWorker(opts.workerUrl);
    worker.onPositions(posArr => {
      const positions = {};
      for (const p of posArr) positions[p.id] = { x: p.x, y: p.y };
      renderer.updatePositions(positions);
    });
    worker.onSettled(posArr => {
      if (posArr) {
        const positions = {};
        for (const p of posArr) positions[p.id] = { x: p.x, y: p.y };
        renderer.updatePositions(positions);
      }
      renderer.fitView();
      opts.onSettled?.();
    });
    layout = worker;
  } else {
    const il = new InlineLayout();
    il.onPositions(positions => renderer.updatePositions(positions));
    il.onSettled(() => { renderer.fitView(); opts.onSettled?.(); });
    layout = il;
  }

  return {
    load(graphData) {
      renderer.load(graphData);
      layout.init(graphData.nodes, graphData.edges);
      layout.run();
    },
    resize:    (w, h)      => renderer.resize(w, h),
    fitView:   ()          => renderer.fitView(),
    setLayer:  (name, on)  => renderer.setLayer(name, on),
    getLayer:  (name)      => renderer.getLayer(name),
    setFilter: (kinds)     => renderer.setFilter(kinds),
    setSearch: (query)     => renderer.setSearch(query),
    destroy:   ()          => { layout.destroy?.(); renderer.destroy(); },
    renderer,
    layout,
  };
}
