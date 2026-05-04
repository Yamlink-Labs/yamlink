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
    wheelSensitivity: 0.25, minZoom: 0.08, maxZoom: 4,
    style: [
      { selector:'node', style:{
          'background-color':'data(color)', 'background-opacity':0.88,
          'label':'data(label)', 'text-valign':'bottom', 'text-margin-y':10,
          'text-wrap':'ellipsis', 'text-max-width':96,
          'color':'#c9d1d9', 'font-size':11, 'font-weight':500,
          'border-width':1.5, 'border-color':'data(color)', 'border-opacity':0.32,
          'width':'mapData(degree, 0, 14, 26, 52)', 'height':'mapData(degree, 0, 14, 26, 52)',
          'shadow-blur':10, 'shadow-color':'data(color)', 'shadow-opacity':0.2,
          'shadow-offset-x':0, 'shadow-offset-y':0,
          'transition-property':'opacity, border-opacity, border-width, background-opacity',
          'transition-duration':'180ms'
      }},
      { selector:'node:hover', style:{
          'background-opacity':1, 'border-opacity':0.82, 'border-width':2,
          'shadow-blur':18, 'shadow-opacity':0.5, 'z-index':10
      }},
      { selector:'node.sel', style:{
          'border-width':4, 'border-color':'#4fc4a0', 'border-opacity':1,
          'background-opacity':1, 'shadow-blur':34, 'shadow-color':'#4fc4a0', 'shadow-opacity':0.92,
          'text-background-color':'#0f1419', 'text-background-opacity':0.92, 'text-background-padding':'4px',
          'text-border-color':'#4fc4a0', 'text-border-width':1, 'text-border-opacity':0.85,
          'font-weight':700, 'font-size':12, 'z-index':20
      }},
      { selector:'node.center', style:{
          'border-width':5, 'border-color':'#6eb3f0', 'border-opacity':1,
          'shadow-blur':42, 'shadow-color':'#6eb3f0', 'shadow-opacity':0.95,
          'overlay-color':'#6eb3f0', 'overlay-opacity':0.08, 'overlay-padding':10,
          'text-background-color':'#0f1419', 'text-background-opacity':0.82, 'text-background-padding':'5px',
          'text-border-color':'#6eb3f0', 'text-border-width':1, 'text-border-opacity':0.7,
          'font-size':12, 'font-weight':700, 'z-index':16
      }},
      { selector:'node.focus-neighbor', style:{
          'border-width':2.5, 'border-color':'#e5a96a', 'border-opacity':0.9,
          'background-opacity':0.96, 'shadow-blur':18, 'shadow-color':'#e5a96a', 'shadow-opacity':0.36,
          'z-index':12
      }},
      { selector:'node.dim', style:{
          'opacity':0.12,
          'transition-property':'opacity', 'transition-duration':'200ms'
      }},
      { selector:'node.search-hi', style:{
          'border-color':'#e5a96a', 'border-width':2.5, 'border-opacity':1
      }},
      { selector:'edge', style:{
          'curve-style':'bezier', 'target-arrow-shape':'vee',
          'target-arrow-color':'data(color)', 'arrow-scale':0.9,
          'line-color':'data(color)', 'width':1.5, 'opacity':0.5, 'label':'',
          'transition-property':'opacity, width', 'transition-duration':'180ms'
      }},
      { selector:'edge.sel', style:{
          'opacity':1, 'width':2.5, 'label':'data(label)',
          'font-size':10, 'color':'#95a1ac',
          'text-background-opacity':0, 'text-border-opacity':0, 'z-index':5
      }},
      { selector:'edge.dim', style:{
          'opacity':0.05,
          'transition-property':'opacity', 'transition-duration':'200ms'
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
