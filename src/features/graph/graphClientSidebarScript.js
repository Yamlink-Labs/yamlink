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
  const tags = det && det.tags ? det.tags : [];
  const topRelation = det && det.relationSummary && det.relationSummary[0] ? det.relationSummary[0] : null;
  const topConnectedType = det && det.connectedTypes && det.connectedTypes[0] ? det.connectedTypes[0] : null;
  const isCurrentFocus = !!(S.payload && S.payload.centerNodeId === id);
  const canExpand = !!(det && det.hiddenNeighborCount > 0);
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
      '<div class="sel-stat"><b>' + ((det && det.hubScore) || d.hubScore || 0) + '</b>signal</div>' +
    '</div>' +
    (topRelation || topConnectedType || tags.length
      ? '<div class="sel-type" style="margin:-2px 0 10px;">' +
          (topRelation ? ('Strongest relation: ' + h(topRelation.field) + ' · ') : '') +
          (topConnectedType ? ('Most connected type: ' + h(topConnectedType.type)) : '') +
        '</div>'
      : '') +
    (tags.length
      ? '<div class="chips" style="margin-bottom:10px;">' + tags.slice(0, 4).map(tag =>
          '<span class="chip on"><span class="chip-dot" style="background:var(--accent3)"></span>#' + h(tag) + '</span>'
        ).join('') + '</div>'
      : '') +
    '<div class="act-row">' +
      '<button class="btn pri" id="aOpen">Open</button>' +
      '<button class="btn" id="aFocus"' + (isCurrentFocus ? ' disabled' : '') + '>' + (isCurrentFocus ? 'Centered' : 'Focus') + '</button>' +
      '<button class="btn" id="aExpd"' + (canExpand ? '' : ' disabled') + '>' + (canExpand ? ('Expand +' + det.hiddenNeighborCount) : 'Expanded') + '</button>' +
    '</div>';
  g('aOpen')  && g('aOpen').addEventListener('click',  () => vsc.postMessage({ type:'openNode',   id }));
  g('aFocus') && !isCurrentFocus && g('aFocus').addEventListener('click', () => vsc.postMessage({ type:'focusNode',  id }));
  g('aExpd')  && canExpand && g('aExpd').addEventListener('click',  () => vsc.postMessage({ type:'expandNode', id }));
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
    const selectedEl = payload.selectedNodeId
      ? payload.model.elements.find(e => e.data && e.data.id === payload.selectedNodeId && !e.data.source)
      : null;
    focusName.textContent = payload.mode === 'vault'
      ? (selectedEl ? selectedEl.data.label : 'Top connected notes')
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
      ? 'Explorer ranks notes by structural signal, not just raw degree. Strong named relations, type diversity, and shared tags matter most.'
      : payload.centerNodeId
        ? 'Nearby linked notes around this note. Stronger named relations stand out more than loose mentions. Use Depth to widen the local view.'
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

  if (E.typeSel) {
    const previous = S.primaryTypeFilter || '';
    E.typeSel.innerHTML = '<option value="">All types</option>' + (payload.model.types || []).map(t =>
      '<option value="' + h(t.type) + '"' + (previous === t.type ? ' selected' : '') + '>' + h(t.type) + ' (' + t.count + ')</option>'
    ).join('');
    E.typeSel.value = previous;
  }

  E.topNodes.innerHTML = (payload.model.topNodes || []).map(n =>
    '<button class="nrow' + (n.id === S.selectedId ? ' on' : '') + '" data-id="' + h(n.id) + '">' +
      '<span class="nrow-dot" style="background:' + h(nodeColor(n.id)) + '"></span>' +
      '<span class="nrow-info">' +
        '<span class="nrow-name">' + h(n.label) + '</span>' +
        '<span class="nrow-sub">'  + h(n.type) + ' · signal ' + h(String(n.hubScore)) + (n.tagCount ? ' · #' + h(String(n.tagCount)) + ' tags' : '') + '</span>' +
      '</span>' +
      '<span class="nrow-deg">' + n.weightedDegree + '</span>' +
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
      '<span class="rcnt">' + r.totalWeight + '</span>' +
    '</div>'
  ).join('');

  const tagList = g('tagList');
  if (tagList) {
    tagList.innerHTML = (payload.model.topTags || []).length
      ? payload.model.topTags.map(t =>
          '<span class="chip"><span class="chip-dot" style="background:var(--accent3)"></span>#' + h(t.tag) + ' <span style="color:var(--mid)">' + t.count + '</span></span>'
        ).join('')
      : '<span class="sel-empty">No repeated themes yet.</span>';
  }

  updateSelCard();
}`;
}

module.exports = {
    buildGraphClientSidebarScript
};
