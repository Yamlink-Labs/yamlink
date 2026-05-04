'use strict';

function buildGraphClientRenderScript() {
    return `let activeLayout = null;

function computeDepths(cy, centerId) {
  if (!centerId) { cy.nodes().forEach(n => n.data('depth', 0)); return; }
  const depths = {}; depths[centerId] = 0;
  const queue = [centerId];
  while (queue.length) {
    const id = queue.shift();
    const node = cy.getElementById(id);
    if (!node || !node.length) continue;
    node.neighborhood().nodes().forEach(n => {
      const nid = n.id();
      if (depths[nid] === undefined) { depths[nid] = (depths[id] || 0) + 1; queue.push(nid); }
    });
  }
  cy.nodes().forEach(n => { const d = depths[n.id()]; n.data('depth', d === undefined ? 99 : d); });
}

function runLayout() {
  const cy = S.cy;
  if (!cy || !cy.nodes().length) return;
  if (activeLayout) { try { activeLayout.stop(); } catch (_) {} activeLayout = null; }
  const pl = S.payload;
  const isLocal = pl && pl.mode === 'local' && pl.centerNodeId;

  if (isLocal) {
    computeDepths(cy, pl.centerNodeId);
    try {
      activeLayout = cy.layout({
        name: 'concentric',
        animate: false,
        fit: true, padding: 100,
        minNodeSpacing: 110,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        startAngle: 3 / 2 * Math.PI,
        concentric: n => Math.max(0, 10 - (n.data('depth') || 0)),
        levelWidth: () => 1
      });
      activeLayout.run();
    } catch (e) { activeLayout = null; }
    try { cy.fit(undefined, 80); } catch (_) {}
    return;
  }

  try {
    activeLayout = cy.layout({
      name: 'cose',
      animate: false,
      fit: true,
      padding: 64,
      nodeRepulsion: 10000,
      idealEdgeLength: 160,
      edgeElasticity: 80,
      gravity: 0.2,
      nestingFactor: 0.8,
      componentSpacing: 140,
      numIter: 1400,
      avoidOverlap: true,
      nodeDimensionsIncludeLabels: true,
      randomize: false,
      initialTemp: 140,
      coolingFactor: 0.96,
      minTemp: 1
    });
    activeLayout.run();
  } catch (e) { activeLayout = null; }
  try { cy.fit(undefined, 80); } catch (_) {}
}

function renderPayload(payload) {
  S.payload = payload;
  E.btnLocal.classList.toggle('on', payload.mode === 'local');
  E.btnVault.classList.toggle('on', payload.mode === 'vault');
  E.depthSel.value = String(payload.depth || 1);
  E.depthGroup.style.display = payload.mode === 'vault' ? 'none' : 'flex';

  if (payload.mode === 'vault') {
    E.modeHelp.textContent = 'Explorer starts with the strongest connected notes in the vault. Pick a note to focus it, then expand outward from there.';
  } else {
    const depth = Number(payload.depth || 1);
    E.modeHelp.textContent = depth === 1
      ? 'Direct links shows the current note and the notes linked directly to it.'
      : depth === 2
        ? 'Extended links adds a second layer of notes linked to those direct notes.'
        : 'Broad links adds a third layer so you can see the widest local view around the current note.';
  }

  const s = payload.model.summary;
  E.statusbar.textContent = (payload.mode === 'vault' ? 'Explorer' : 'Local') + ' · ' + s.nodeCount + ' nodes · ' + s.edgeCount + ' edges · ' + s.typeCount + ' types  ·  ' + BUILD;

  const showEmpty = payload.noCenter || s.nodeCount === 0;
  E.empty.classList.toggle('show', showEmpty);
  if (payload.noCenter) {
    E.emptyTitle.textContent = 'No active note';
    E.emptyDesc.innerHTML = 'Open a Markdown note then press <b>Current Note</b>,<br>or switch to Explorer mode.';
  } else {
    E.emptyTitle.textContent = 'No graph nodes';
    E.emptyDesc.innerHTML = 'Open a Yamlink note with links,<br>or switch to Explorer mode.';
  }

  renderSidebar(payload);

  let cy;
  try { cy = ensureCy(); } catch (e) { return; }

  const newHash = payload.model.elements.filter(e => !e.data.source).map(e => e.data.id).sort().join(',');
  const changed = newHash !== S.lastHash;
  S.lastHash = newHash;

  if (changed || payload.forceLayout) {
    if (activeLayout) { try { activeLayout.stop(); } catch(_) {} activeLayout = null; }
    try { cy.elements().stop(true, true); } catch(_) {}
    if (changed) {
      cy.batch(() => {
        cy.elements().remove();
        cy.add(payload.model.elements);
      });
    }
    cy.batch(() => {
      cy.elements().removeClass('center');
      const focusId = payload.mode === 'vault'
        ? (payload.selectedNodeId || (payload.model.topNodes[0] && payload.model.topNodes[0].id) || null)
        : payload.centerNodeId;
      if (focusId) {
        const cn = cy.getElementById(focusId);
        if (cn && cn.length) cn.addClass('center');
      }
    });
    if (s.nodeCount > 0) {
      runLayout();
      const pulseId = payload.mode === 'vault'
        ? (payload.selectedNodeId || (payload.model.topNodes[0] && payload.model.topNodes[0].id) || null)
        : payload.centerNodeId;
      if (pulseId) {
        const cid = pulseId;
        setTimeout(() => { const n = S.cy && S.cy.getElementById(cid); if (n && n.length) pulse(n); }, 80);
      }
    }
  } else {
    cy.batch(() => {
      cy.elements().removeClass('center');
      const focusId = payload.mode === 'vault'
        ? (payload.selectedNodeId || (payload.model.topNodes[0] && payload.model.topNodes[0].id) || null)
        : payload.centerNodeId;
      if (focusId) {
        const cn = cy.getElementById(focusId);
        if (cn && cn.length) cn.addClass('center');
      }
    });
  }

  if (payload.mode === 'local') {
    S.selectedId = payload.selectedNodeId || payload.centerNodeId || null;
  } else if (payload.mode === 'vault' && payload.selectedNodeId) {
    S.selectedId = payload.selectedNodeId;
  } else if (S.selectedId) {
    const stillVisible = payload.model.elements.some(e => e.data && !e.data.source && e.data.id === S.selectedId);
    if (!stillVisible) {
      S.selectedId = null;
    }
  }

  if (S.selectedId) selectNode(S.selectedId);
  else if (payload.selectedNodeId) selectNode(payload.selectedNodeId);
  else if (payload.mode === 'vault' && payload.model.topNodes && payload.model.topNodes[0]) selectNode(payload.model.topNodes[0].id);
  applySearch();
}

E.btnLocal.addEventListener('click',   () => vsc.postMessage({ type:'setMode', mode:'local' }));
E.btnVault.addEventListener('click',   () => vsc.postMessage({ type:'setMode', mode:'vault' }));
E.btnReveal.addEventListener('click',  () => vsc.postMessage({ type:'revealActive' }));
E.depthSel.addEventListener('change',  () => vsc.postMessage({ type:'setDepth', depth:+E.depthSel.value }));
E.searchInp.addEventListener('input',  () => { S.searchTerm = E.searchInp.value; applySearch(); });
E.btnZoomIn.addEventListener('click',  () => S.cy && S.cy.zoom(S.cy.zoom() * 1.3));
E.btnZoomOut.addEventListener('click', () => S.cy && S.cy.zoom(S.cy.zoom() * 0.77));
E.btnZoomFit.addEventListener('click', () => S.cy && S.cy.fit(undefined, 60));

document.addEventListener('keydown', e => {
  if (e.target === E.searchInp) return;
  switch (e.key) {
    case 'Escape': clearSel(); break;
    case 'Enter':  if (S.selectedId) vsc.postMessage({ type:'openNode',   id:S.selectedId }); break;
    case 'f': case 'F': if (S.selectedId) vsc.postMessage({ type:'focusNode',  id:S.selectedId }); break;
    case 'e': case 'E': if (S.selectedId) vsc.postMessage({ type:'expandNode', id:S.selectedId }); break;
    case '/': e.preventDefault(); E.searchInp.focus(); break;
  }
});

window.addEventListener('message', e => {
  const m = e.data;
  if (m && m.type === 'updateGraph') renderPayload(m.payload);
});
window.addEventListener('error', e => {
  const msg = (e && e.message) || '';
  if (/Cannot read prop.*'name'|reading "name"/.test(msg)) return;
  if (msg) vsc.postMessage({ type:'bootStatus', level:'error', text:msg });
});
window.addEventListener('unhandledrejection', e => {
  vsc.postMessage({ type:'bootStatus', level:'error', text:String((e && e.reason) || 'rejection') });
});

vsc.postMessage({ type:'webviewReady' });`;
}

module.exports = {
    buildGraphClientRenderScript
};
