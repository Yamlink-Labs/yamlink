'use strict';

function buildGraphClientCyScript() {
    return `function ensureCy() {
  if (S.cy) return S.cy;
  if (typeof cytoscape !== 'function') {
    vsc.postMessage({ type:'bootStatus', level:'error', text:'cytoscape library failed to load' });
    throw new Error('cytoscape not loaded');
  }
  S.cy = cytoscape({
    container: E.graph, elements: [],
    wheelSensitivity: 0.22, minZoom: 0.06, maxZoom: 5,
    style: [

      /* ── Base node ────────────────────────────────────────────────── */
      { selector: 'node', style: {
        'shape': 'ellipse',
        'background-color': 'data(color)',
        'background-opacity': 0.88,
        'border-width': 2.5,
        'border-color': 'data(color)',
        'border-opacity': 0.65,
        'width':  'mapData(hubScore, 0, 32, 26, 64)',
        'height': 'mapData(hubScore, 0, 32, 26, 64)',
        'shadow-blur': 14,
        'shadow-color': 'data(color)',
        'shadow-opacity': 0.32,
        'shadow-offset-x': 0,
        'shadow-offset-y': 0,
        'label': 'data(label)',
        'text-valign': 'bottom',
        'text-margin-y': 9,
        'text-wrap': 'ellipsis',
        'text-max-width': 112,
        'color': '#d4dce6',
        'font-size': 11,
        'font-weight': 600,
        'font-family': "'Segoe UI', system-ui, sans-serif",
        'text-background-color': '#0c1117',
        'text-background-opacity': 0.78,
        'text-background-padding': '3px',
        'z-index': 4,
        'transition-property': 'opacity, border-opacity, border-width, background-opacity',
        'transition-duration': '160ms'
      }},

      /* ── Depth 2+ — secondary, visually recessed ────────────────── */
      { selector: 'node[depth >= 2]', style: {
        'width':  'mapData(hubScore, 0, 32, 13, 30)',
        'height': 'mapData(hubScore, 0, 32, 13, 30)',
        'background-opacity': 0.48,
        'border-width': 1.5,
        'border-opacity': 0.28,
        'shadow-blur': 5,
        'shadow-opacity': 0.10,
        'font-size': 9,
        'font-weight': 400,
        'color': '#6a7a8a',
        'text-background-opacity': 0.45,
        'z-index': 2
      }},

      /* ── Hover ───────────────────────────────────────────────────── */
      { selector: 'node:hover', style: {
        'background-opacity': 1,
        'border-opacity': 1,
        'border-width': 3.5,
        'shadow-blur': 32,
        'shadow-opacity': 0.72,
        'z-index': 10
      }},

      /* ── Selected — clearly dominant ─────────────────────────────── */
      { selector: 'node.sel', style: {
        'width':  'mapData(hubScore, 0, 32, 46, 84)',
        'height': 'mapData(hubScore, 0, 32, 46, 84)',
        'background-opacity': 1,
        'border-width': 5,
        'border-color': '#4fc4a0',
        'border-opacity': 1,
        'shadow-blur': 60,
        'shadow-color': '#4fc4a0',
        'shadow-opacity': 1,
        'overlay-color': '#4fc4a0',
        'overlay-opacity': 0.05,
        'overlay-padding': 14,
        'color': '#9ef0d0',
        'font-size': 12,
        'font-weight': 700,
        'text-background-color': '#061a10',
        'text-background-opacity': 0.96,
        'text-background-padding': '4px',
        'z-index': 20
      }},

      /* ── Center / focus node ─────────────────────────────────────── */
      { selector: 'node.center', style: {
        'width': 76,
        'height': 76,
        'background-opacity': 1,
        'border-width': 5,
        'border-color': '#6eb3f0',
        'border-opacity': 1,
        'shadow-blur': 64,
        'shadow-color': '#6eb3f0',
        'shadow-opacity': 0.95,
        'overlay-color': '#6eb3f0',
        'overlay-opacity': 0.08,
        'overlay-padding': 14,
        'color': '#b0d8ff',
        'font-size': 13,
        'font-weight': 700,
        'text-background-color': '#060f1e',
        'text-background-opacity': 0.96,
        'text-background-padding': '5px',
        'z-index': 16
      }},

      /* ── Focus neighbors ─────────────────────────────────────────── */
      { selector: 'node.focus-neighbor', style: {
        'background-opacity': 1,
        'border-width': 2.5,
        'border-color': '#e5a96a',
        'border-opacity': 0.92,
        'shadow-blur': 24,
        'shadow-color': '#e5a96a',
        'shadow-opacity': 0.48,
        'z-index': 12
      }},

      /* ── Search highlight ────────────────────────────────────────── */
      { selector: 'node.search-hi', style: {
        'border-color': '#e5a96a',
        'border-width': 3,
        'border-opacity': 1,
        'shadow-color': '#e5a96a',
        'shadow-blur': 26,
        'shadow-opacity': 0.68
      }},

      /* ── Dimmed ──────────────────────────────────────────────────── */
      { selector: 'node.dim', style: {
        'opacity': 0.07,
        'transition-property': 'opacity',
        'transition-duration': '200ms'
      }},

      /* ── Base edge ───────────────────────────────────────────────── */
      { selector: 'edge', style: {
        'curve-style': 'bezier',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': 'data(color)',
        'arrow-scale': 1.2,
        'line-color': 'data(color)',
        'width': 'mapData(weight, 0.85, 3.4, 1.2, 4.2)',
        'opacity': 'mapData(weight, 0.85, 3.4, 0.2, 0.78)',
        'label': '',
        'z-index': 1,
        'transition-property': 'opacity, width',
        'transition-duration': '160ms'
      }},

      /* ── Weak / mention edges — dashed, subdued ──────────────────── */
      { selector: "edge[strength = 'weak']", style: {
        'line-style': 'dashed',
        'line-dash-pattern': [5, 4],
        'arrow-scale': 0.85,
        'opacity': 'mapData(weight, 0.85, 1.5, 0.1, 0.26)'
      }},

      /* ── Strong relation edges — solid, prominent ────────────────── */
      { selector: "edge[strength = 'strong']", style: {
        'arrow-scale': 1.35,
        'opacity': 'mapData(weight, 3.2, 5.0, 0.68, 0.92)'
      }},

      /* ── Selected edges ──────────────────────────────────────────── */
      { selector: 'edge.sel', style: {
        'opacity': 0.92,
        'width': 3,
        'line-style': 'solid',
        'z-index': 2
      }},

      /* ── Dimmed edges ────────────────────────────────────────────── */
      { selector: 'edge.dim', style: {
        'opacity': 0.04,
        'transition-property': 'opacity',
        'transition-duration': '200ms'
      }}
    ]
  });
  bindCyEvents();
  return S.cy;
}

function bindCyEvents() {
  const cy = S.cy;
  cy.on('tap', 'node', evt => {
    const id = evt.target.id();
    selectNode(id);
    vsc.postMessage({ type:'selectNode', id });
  });
  cy.on('dbltap', 'node', evt => vsc.postMessage({ type:'openNode', id:evt.target.id() }));
  cy.on('tap', evt => { if (evt.target === cy) clearSel(); });
  cy.on('mouseover', 'node', evt => showTip(evt.target.data(), evt.renderedPosition));
  cy.on('mouseout',  'node', ()  => hideTip());
  cy.on('drag',      'node', ()  => hideTip());
  cy.on('cxttap', 'node', evt => {
    const id = evt.target.id();
    S.ctxId = id;
    selectNode(id);
    vsc.postMessage({ type:'selectNode', id });
    showCtx(evt.originalEvent.clientX, evt.originalEvent.clientY);
  });
  E.graph.addEventListener('contextmenu', e => e.preventDefault());
}`;
}

module.exports = {
    buildGraphClientCyScript
};
