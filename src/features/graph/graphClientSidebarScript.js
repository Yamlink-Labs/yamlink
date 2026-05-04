'use strict';

function buildGraphClientSidebarScript() {
    return `function nodeColor(id) {
  if (!S.payload) return '#8b949e';
  const el = S.payload.model.elements.find(e => e.data && e.data.id === id && !e.data.source);
  return (el && el.data.color) || '#8b949e';
}

function updateSelCard() {
  const id = S.selectedId;
  if (!id || !S.payload) {
    E.selCard.innerHTML = '<div class="sel-empty">Pick a node to inspect it.</div>';
    return;
  }
  const el = S.payload.model.elements.find(e => e.data && e.data.id === id && !e.data.source);
  if (!el) return;
  const d = el.data;
  const det = S.payload.model.nodeDetails && S.payload.model.nodeDetails[id];
  const out = det ? det.outgoing.length : 0;
  const inc = det ? det.incoming.length  : 0;
  E.selCard.innerHTML =
    '<div class="sel-hdr">' +
      '<div class="sel-dot" style="background:' + h(d.color||'#8b949e') + '"></div>' +
      '<div class="sel-meta">' +
        '<div class="sel-name">' + h(d.label||d.id) + '</div>' +
        '<div class="sel-type">' + h(d.type||'unknown') + '</div>' +
        (S.payload && S.payload.centerNodeId === id ? '<div class="sel-note">Current focus</div>' : '') +
      '</div>' +
    '</div>' +
    '<div class="sel-stats">' +
      '<div class="sel-stat"><b>' + out + '</b>outgoing</div>' +
      '<div class="sel-stat"><b>' + inc + '</b>incoming</div>' +
      '<div class="sel-stat"><b>' + (d.degree||0) + '</b>total</div>' +
    '</div>' +
    '<div class="act-row">' +
      '<button class="btn pri" id="aOpen">Open</button>' +
      '<button class="btn" id="aFocus">Focus</button>' +
      '<button class="btn" id="aExpd">Expand</button>' +
    '</div>';
  g('aOpen')  && g('aOpen').addEventListener('click',  () => vsc.postMessage({ type:'openNode',   id }));
  g('aFocus') && g('aFocus').addEventListener('click', () => vsc.postMessage({ type:'focusNode',  id }));
  g('aExpd')  && g('aExpd').addEventListener('click',  () => vsc.postMessage({ type:'expandNode', id }));
}

function renderSidebar(payload) {
  const focusMode = g('focusMode');
  const focusName = g('focusName');
  const centerEl = payload.centerNodeId
    ? payload.model.elements.find(e => e.data && e.data.id === payload.centerNodeId && !e.data.source)
    : null;
  if (focusMode) {
    focusMode.textContent = payload.mode === 'vault' ? 'Explorer' : 'Local';
  }
  if (focusName) {
    focusName.textContent = payload.mode === 'vault'
      ? (payload.selectedNode ? payload.selectedNode.label : 'Top connected notes')
      : centerEl
        ? centerEl.data.label
        : 'No active note';
  }
  const sbTitle = g('sbTitle');
  if (sbTitle) {
    if (payload.mode === 'vault') {
      sbTitle.textContent = 'Vault Explorer';
    } else if (payload.centerNodeId) {
      sbTitle.textContent = centerEl ? centerEl.data.label : 'Local Graph';
    } else {
      sbTitle.textContent = 'Local Graph';
    }
  }
  const sbDesc = g('sbDesc');
  if (sbDesc) {
    sbDesc.textContent = payload.mode === 'vault'
      ? 'Explorer shows the broader vault shape. Start from the strongest hubs, then pick a note to focus or open it.'
      : payload.centerNodeId
        ? 'Nearby linked notes around this note. Use Depth to show wider link layers. Click Focus on any node to re-centre.'
        : 'Open a Markdown note then press Current Note to see its links.';
  }

  E.typeChips.innerHTML = (payload.model.types || []).map(t =>
    '<button class="chip' + (S.typeFilters.has(t.type) ? ' on' : '') + '" data-t="' + h(t.type) + '">' +
      '<span class="chip-dot" style="background:' + h(t.color) + '"></span>' +
      h(t.type) + ' <span style="color:var(--mid)">' + t.count + '</span>' +
    '</button>'
  ).join('');
  E.typeChips.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => {
      const t = c.dataset.t;
      if (S.typeFilters.has(t)) S.typeFilters.delete(t); else S.typeFilters.add(t);
      c.classList.toggle('on');
      applyTypeFilter();
    });
  });

  E.topNodes.innerHTML = (payload.model.topNodes || []).map(n =>
    '<button class="nrow' + (n.id === S.selectedId ? ' on' : '') + '" data-id="' + h(n.id) + '">' +
      '<span class="nrow-dot" style="background:' + h(nodeColor(n.id)) + '"></span>' +
      '<span class="nrow-info">' +
        '<span class="nrow-name">' + h(n.label) + '</span>' +
        '<span class="nrow-sub">'  + h(n.type)  + '</span>' +
      '</span>' +
      '<span class="nrow-deg">' + n.degree + '</span>' +
    '</button>'
  ).join('');
  E.topNodes.querySelectorAll('[data-id]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.id;
      S.selectedId = id;
      selectNode(id);
      vsc.postMessage({ type:'selectNode', id });
    });
  });

  E.relList.innerHTML = (payload.model.relations || []).map(r =>
    '<div class="rrow">' +
      '<span class="rdot" style="background:' + h(r.color) + '"></span>' +
      '<span class="rname">' + h(r.field) + '</span>' +
      '<span class="rcnt">' + r.count + '</span>' +
    '</div>'
  ).join('');

  updateSelCard();
}`;
}

module.exports = {
    buildGraphClientSidebarScript
};
