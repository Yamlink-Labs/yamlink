'use strict';

function buildGraphClientInteractionScript() {
    return `function selectNode(id) {
  S.selectedId = id;
  const cy = S.cy;
  if (!cy) return;
  cy.elements().removeClass('sel dim focus-neighbor');
  if (!id) { updateSelCard(); return; }
  const node = cy.getElementById(id);
  if (!node || !node.length) { S.selectedId = null; updateSelCard(); return; }
  const hood = node.closedNeighborhood();
  cy.elements().not(hood).addClass('dim');
  hood.nodes().not(node).addClass('focus-neighbor');
  node.addClass('sel');
  hood.edges().addClass('sel');
  const bb = node.renderedBoundingBox();
  const cw = E.graph.clientWidth, ch = E.graph.clientHeight, mg = 80;
  if (bb.x1 < mg || bb.x2 > cw - mg || bb.y1 < mg || bb.y2 > ch - mg) {
    cy.animate({ center:{ eles:node } }, { duration:300, easing:'ease-out' });
  }
  updateSelCard();
}

function clearSel() {
  S.selectedId = null;
  if (S.cy) S.cy.elements().removeClass('sel dim focus-neighbor');
  updateSelCard();
}

function showTip(data, pos) {
  E.tipName.textContent = data.label || data.id;
  E.tipType.textContent = data.type || 'unknown';
  const d = S.payload && S.payload.model.nodeDetails && S.payload.model.nodeDetails[data.id];
  E.tipOut.textContent = d ? d.outgoing.length : 0;
  E.tipIn.textContent  = d ? d.incoming.length  : 0;
  E.tipDeg.textContent = data.degree || 0;
  const tw = 224;
  const cw = E.graph.clientWidth;
  let lx = pos.x + 14;
  if (lx + tw > cw - 8) lx = pos.x - tw - 14;
  E.tip.style.left = lx + 'px';
  E.tip.style.top  = Math.max(8, pos.y - 44) + 'px';
  E.tip.classList.add('show');
}

function hideTip() { E.tip.classList.remove('show'); }

function showCtx(cx, cy2) {
  const r = E.graph.getBoundingClientRect();
  E.ctx.style.left = (cx - r.left) + 'px';
  E.ctx.style.top  = (cy2 - r.top) + 'px';
  E.ctx.classList.add('show');
}

function hideCtx() { E.ctx.classList.remove('show'); }

document.addEventListener('click', e => { if (!E.ctx.contains(e.target)) hideCtx(); });
E.ctxOpen.addEventListener('click',  () => { if (S.ctxId) vsc.postMessage({ type:'openNode',   id:S.ctxId }); hideCtx(); });
E.ctxFocus.addEventListener('click', () => { if (S.ctxId) vsc.postMessage({ type:'focusNode',  id:S.ctxId }); hideCtx(); });
E.ctxExpd.addEventListener('click',  () => { if (S.ctxId) vsc.postMessage({ type:'expandNode', id:S.ctxId }); hideCtx(); });

function applySearch() {
  const cy = S.cy;
  if (!cy) return;
  const term = S.searchTerm.trim().toLowerCase();
  cy.elements().removeClass('search-hi dim');
  if (!term) {
    if (S.selectedId) selectNode(S.selectedId);
    return;
  }
  cy.nodes().forEach(n => {
    const d = n.data();
    const hit = [d.label, d.id, d.type].some(v => String(v || '').toLowerCase().includes(term));
    if (hit) n.addClass('search-hi'); else n.addClass('dim');
  });
  cy.edges().forEach(e => {
    if (e.source().hasClass('dim') && e.target().hasClass('dim')) e.addClass('dim');
  });
}

function applyTypeFilter() {
  const cy = S.cy;
  if (!cy) return;
  const activeTypes = new Set(S.typeFilters);
  if (S.primaryTypeFilter) activeTypes.add(S.primaryTypeFilter);
  if (!activeTypes.size) { cy.elements().removeClass('dim'); applySearch(); return; }
  cy.elements().removeClass('dim');
  cy.nodes().forEach(n => { if (!activeTypes.has(n.data('type'))) n.addClass('dim'); });
  cy.edges().forEach(e => {
    if (e.source().hasClass('dim') || e.target().hasClass('dim')) e.addClass('dim');
  });
  if (S.selectedId) {
    const selected = cy.getElementById(S.selectedId);
    if (selected && selected.length) {
      selected.removeClass('dim');
      selected.closedNeighborhood().edges().removeClass('dim');
      selected.closedNeighborhood().nodes().removeClass('dim');
      selected.closedNeighborhood().nodes().not(selected).addClass('focus-neighbor');
      selected.addClass('sel');
    }
  }
  applySearch();
}

function pulse(node) {
  if (!node || !node.length) return;
  try {
    node.animate(
      { style:{ 'shadow-blur':44, 'shadow-opacity':0.9 } },
      { duration:280, easing:'ease-out', complete:() => {
          try { if (node.cy && node.cy()) node.animate({ style:{ 'shadow-blur':26, 'shadow-opacity':0.55 } }, { duration:380, easing:'ease-in' }); } catch(_) {}
      }}
    );
  } catch(_) {}
}

function h(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}`;
}

module.exports = {
    buildGraphClientInteractionScript
};
