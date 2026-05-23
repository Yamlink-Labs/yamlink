'use strict';

function buildGraph2ClientScript() {
    return `
const vscode = acquireVsCodeApi();

const els = {
  sourceSel: document.getElementById('sourceSel'),
  nodeCapInp: document.getElementById('nodeCapInp'),
  currentScope: document.getElementById('currentScope'),
  currentSource: document.getElementById('currentSource'),
  currentSummary: document.getElementById('currentSummary'),
  heroMeta: document.getElementById('heroMeta'),
  stats: document.getElementById('stats'),
  topNodes: document.getElementById('topNodes'),
  filtersUsed: document.getElementById('filtersUsed'),
  facetsTypes: document.getElementById('facetsTypes'),
  facetsRelations: document.getElementById('facetsRelations'),
  facetsTags: document.getElementById('facetsTags'),
  insights: document.getElementById('insights'),
  nodeList: document.getElementById('nodeList'),
  queryText: document.getElementById('queryText'),
  graph2Canvas: document.getElementById('graph2Canvas'),
  canvasEmpty: document.getElementById('canvasEmpty'),
  searchInp: document.getElementById('searchInp'),
  fitBtn: document.getElementById('fitBtn'),
  currentBtn: document.getElementById('currentBtn'),
  resetFiltersBtn: document.getElementById('resetFiltersBtn'),
  selectionCard: document.getElementById('selectionCard'),
  clusterList: document.getElementById('clusterList'),
  isolateBtn: document.getElementById('isolateBtn'),
  hideUnrelatedBtn: document.getElementById('hideUnrelatedBtn'),
  showAllBtn: document.getElementById('showAllBtn'),
  queryPanel: document.getElementById('queryPanel'),
  customPanel: document.getElementById('customPanel'),
  chipList: document.getElementById('chipList'),
  customInp: document.getElementById('customInp'),
  focusControls: document.getElementById('focusControls'),
  exploreControls: document.getElementById('exploreControls'),
  connectionStatus: document.getElementById('connectionStatus'),
  showMoreBtn: document.getElementById('showMoreBtn'),
  sourceHint: document.getElementById('sourceHint')
};

const scopeButtons = Array.from(document.querySelectorAll('[data-scope]'));
let latestPayload = null;
let selectedId = null;
let isolateMode = false;
let hideUnrelatedMode = false;
let graphRenderer = null;
let currentDisplayPayload = null;
let customNodeIds = [];

function post(type, payload = {}) {
  vscode.postMessage({ type, ...payload });
}

function bind() {
  const applyControls = () => {
    post('applyControls', {
      source: els.sourceSel.value,
      nodeCap: els.nodeCapInp ? Number(els.nodeCapInp.value || 0) : undefined,
      queryText: els.queryText ? els.queryText.value : '',
      customNodeIds: [...customNodeIds]
    });
  };

  scopeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      syncSourceScopeUI(els.sourceSel.value, button.dataset.scope);
      post('setScope', { scope: button.dataset.scope });
    });
  });

  els.sourceSel.addEventListener('change', () => {
    syncSourceScopeUI(els.sourceSel.value, getCurrentScope());
    applyControls();
  });
  if (els.nodeCapInp) {
    els.nodeCapInp.addEventListener('change', applyControls);
  }
  if (els.queryText) {
    els.queryText.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        applyControls();
      }
    });
  }
  if (els.showMoreBtn) {
    els.showMoreBtn.addEventListener('click', () => post('showMoreWorkspace'));
  }

  if (els.customInp) {
    els.customInp.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addChip(els.customInp.value);
        els.customInp.value = '';
      } else if (event.key === 'Backspace' && !els.customInp.value && customNodeIds.length) {
        removeChip(customNodeIds.length - 1);
      }
    });
    els.customInp.addEventListener('paste', (event) => {
      event.preventDefault();
      const text = (event.clipboardData || window.clipboardData).getData('text');
      text.split(/[\\s,]+/).filter(Boolean).forEach((id) => addChip(id));
    });
  }

  els.searchInp.addEventListener('input', applySearch);
  els.fitBtn.addEventListener('click', () => {
    if (graphRenderer && graphRenderer.fit) graphRenderer.fit();
  });
  els.currentBtn.addEventListener('click', () => {
    els.sourceSel.value = 'current';
    scopeButtons.forEach((b) => b.classList.toggle('on', b.dataset.scope === 'neighborhood'));
    syncSourceScopeUI('current', 'neighborhood');
    post('focusCurrent');
  });
  els.resetFiltersBtn.addEventListener('click', () => {
    isolateMode = false;
    hideUnrelatedMode = false;
    if (els.searchInp) els.searchInp.value = '';
    syncQuickActionState();
    post('resetFilters');
  });
  els.isolateBtn.addEventListener('click', () => {
    isolateMode = !isolateMode;
    hideUnrelatedMode = false;
    applySelectionVisibility();
    syncQuickActionState();
  });
  els.hideUnrelatedBtn.addEventListener('click', () => {
    hideUnrelatedMode = !hideUnrelatedMode;
    isolateMode = false;
    applySelectionVisibility();
    syncQuickActionState();
  });
  els.showAllBtn.addEventListener('click', () => {
    isolateMode = false;
    hideUnrelatedMode = false;
    applySelectionVisibility();
    syncQuickActionState();
  });
}

function getCurrentScope() {
  const active = scopeButtons.find((button) => button.classList.contains('on'));
  return active ? active.dataset.scope : 'neighborhood';
}

const SCOPE_HINTS = {
  neighborhood: 'Shows the current note and its strongest direct connections. Use Show more to reveal additional links.',
  vault:        'Shows all notes in the vault as a dot constellation. Click any dot to inspect it and see its connections.'
};

const SOURCE_HINTS = {
  current: 'Start from the current note and inspect its connections.',
  query: 'Build the graph from a view query result and the relationships it exposes.',
  custom: 'Build a graph from note IDs you choose manually, then refine it with filters.'
};

function syncSourceScopeUI(source, scope) {
  const showQuery = source === 'query';
  const showCustom = source === 'custom';
  const isFocus = scope !== 'vault' && scope !== 'domain';
  if (els.queryPanel) els.queryPanel.classList.toggle('visible', showQuery);
  if (els.customPanel) els.customPanel.classList.toggle('visible', showCustom);
  if (els.focusControls) els.focusControls.style.display = isFocus ? '' : 'none';
  if (els.exploreControls) els.exploreControls.style.display = isFocus ? 'none' : '';
  const hint = document.getElementById('scopeHint');
  if (hint) hint.textContent = SCOPE_HINTS[scope] || SCOPE_HINTS['neighborhood'];
  if (els.sourceHint) els.sourceHint.textContent = SOURCE_HINTS[source] || SOURCE_HINTS.current;
}

function renderChips() {
  if (!els.chipList) return;
  els.chipList.innerHTML = customNodeIds.map((id, i) =>
    '<span class="chip">' + escapeHtml(id) +
    '<button class="chip-remove" data-chip-idx="' + i + '" title="Remove">\xd7</button>' +
    '</span>'
  ).join('');
  els.chipList.querySelectorAll('[data-chip-idx]').forEach((button) => {
    button.addEventListener('click', () => {
      removeChip(Number(button.dataset.chipIdx));
    });
  });
}

function addChip(rawId) {
  const id = String(rawId || '').trim().replace(/,+$/, '').trim();
  if (!id || customNodeIds.includes(id)) return;
  customNodeIds.push(id);
  renderChips();
}

function removeChip(index) {
  customNodeIds.splice(index, 1);
  renderChips();
}

function render(payload) {
  latestPayload = payload;
  // When the server drives a new center (active note changed), clear the
  // client-side selection so the incoming centerNodeId takes focus instead
  // of the previously-selected node overriding it.
  const prevCenterId = currentDisplayPayload?.centerNodeId ?? null;
  if (payload.centerNodeId !== prevCenterId) {
    selectedId = payload.selectedNodeId || payload.centerNodeId || null;
  }
  currentDisplayPayload = buildDisplayPayload(payload);
  const summary = currentDisplayPayload.model.summary || {};
  const centerNode = findNodeById(payload.centerNodeId) || findNodeById(payload.selectedNodeId);
  const centerLabel = centerNode ? centerNode.label : 'current scope';
  const scopeLabel = (payload.scope === 'vault' || payload.scope === 'domain') ? 'Explore' : 'Focus';
  els.currentScope.textContent = scopeLabel;
  els.currentSource.textContent = formatTitle(payload.source);
  if (payload.empty) {
    els.currentSummary.textContent = 'No notes found. Open a Markdown note or switch to Explore mode.';
  } else if (payload.scope === 'vault' || payload.scope === 'domain') {
    els.currentSummary.textContent = 'Exploring ' + (summary.nodeCount || 0) + ' notes from the vault.';
  } else {
    const hidden = payload.hiddenWorkspaceNeighborCount || 0;
    const suffix = hidden > 0 ? ' (' + hidden + ' more available)' : '';
    els.currentSummary.textContent = 'Focused on ' + centerLabel + suffix + '.';
  }
  els.heroMeta.textContent = payload.empty
    ? '0 nodes · 0 edges'
    : summary.nodeCount + ' nodes · ' + summary.edgeCount + ' edges · ' + summary.typeCount + ' types';

  els.sourceSel.value = payload.source;
  if (els.nodeCapInp) els.nodeCapInp.value = String(payload.nodeCap);
  if (els.queryText) els.queryText.value = payload.queryText || '';

  // Map internal scope names to the two visible mode buttons.
  const displayScope = (payload.scope === 'vault' || payload.scope === 'domain') ? 'vault' : 'neighborhood';
  scopeButtons.forEach((button) => {
    button.classList.toggle('on', button.dataset.scope === displayScope);
  });
  syncSourceScopeUI(payload.source, payload.scope);

  // Connection status for Focus mode.
  const isFocus = payload.scope !== 'vault' && payload.scope !== 'domain';
  if (isFocus && els.connectionStatus) {
    const visibleNeighbors = Math.max(0, (summary.nodeCount || 0) - 1);
    const hidden = payload.hiddenWorkspaceNeighborCount || 0;
    if (hidden > 0) {
      els.connectionStatus.textContent = 'Showing ' + visibleNeighbors + ' connection' + (visibleNeighbors === 1 ? '' : 's') + ' · ' + hidden + ' not shown';
      if (els.showMoreBtn) els.showMoreBtn.style.display = '';
    } else {
      els.connectionStatus.textContent = visibleNeighbors > 0
        ? 'Showing all ' + visibleNeighbors + ' connection' + (visibleNeighbors === 1 ? '' : 's')
        : 'No connections found for this note.';
      if (els.showMoreBtn) els.showMoreBtn.style.display = 'none';
    }
  }

  renderStats(summary);
  renderTopNodes(currentDisplayPayload.model.topNodes || []);
  renderFacets(payload.facets || {});
  renderFilters(payload.filters || {});
  renderClusters(payload);
  renderGraph(currentDisplayPayload);
  syncQuickActionState();
}

function renderStats(summary) {
  els.stats.innerHTML = [
    statCard(summary.nodeCount || 0, 'nodes'),
    statCard(summary.edgeCount || 0, 'edges'),
    statCard(summary.typeCount || 0, 'types'),
    statCard(summary.largestClusterSize || 0, 'largest cluster')
  ].join('');
}

function renderTopNodes(nodes) {
  if (!els.topNodes) return;
  if (!nodes.length) {
    els.topNodes.innerHTML = '<div class="empty">No ranked nodes in this scope yet.</div>';
    return;
  }
  els.topNodes.innerHTML = nodes.map((node) => {
    return '<div class="item">' +
      '<div class="item-top"><span class="item-title">' + escapeHtml(node.label) + '</span><button class="btn" data-open="' + escapeHtml(node.id) + '">Open</button></div>' +
      '<div class="item-sub">' + escapeHtml(node.type) + ' · signal ' + escapeHtml(String(node.hubScore || 0)) + '</div>' +
      '<div class="item-actions"><button class="btn" data-focus="' + escapeHtml(node.id) + '">Highlight node</button><button class="btn" data-reroot="' + escapeHtml(node.id) + '">Center graph here</button></div>' +
      '</div>';
  }).join('');
  bindActions(els.topNodes);
}

function renderNodeList(nodes) {
  if (!els.nodeList) return;
  if (!nodes.length) {
    els.nodeList.innerHTML = '<div class="empty">No nodes visible yet.</div>';
    return;
  }
  els.nodeList.innerHTML = nodes.map((node) => {
    return '<div class="item">' +
      '<div class="item-top"><span class="item-title">' + escapeHtml(node.label) + '</span><button class="btn" data-open="' + escapeHtml(node.id) + '">Open</button></div>' +
      '<div class="item-sub">' + escapeHtml(node.type) + ' · weighted ' + escapeHtml(String(node.weightedDegree || 0)) + '</div>' +
      '<div class="item-actions"><button class="btn" data-focus="' + escapeHtml(node.id) + '">Focus</button></div>' +
      '</div>';
  }).join('');
  bindActions(els.nodeList);
}

function renderFacets(facets) {
  els.facetsTypes.innerHTML = renderFacetPills(
    facets.types || [],
    latestPayload.filters.types || [],
    'type',
    (entry) => entry.type + ' (' + entry.count + ')',
    'No types'
  );
  els.facetsRelations.innerHTML = renderFacetPills(
    facets.relations || [],
    latestPayload.filters.relationTypes || [],
    'relation',
    (entry) => entry.field + ' (' + entry.count + ')',
    'No relations'
  );
  els.facetsTags.innerHTML = renderFacetPills(
    facets.tags || [],
    latestPayload.filters.tags || [],
    'tag',
    (entry) => '#' + entry.tag + ' (' + entry.count + ')',
    'No tags',
    'tag'
  );
  bindFacetButtons();
}

function renderFilters(filters) {
  const pills = [];
  if ((filters.types || []).length) pills.push({ label: 'types: ' + filters.types.join(', '), on: true });
  if ((filters.relationTypes || []).length) pills.push({ label: 'relations: ' + filters.relationTypes.join(', '), on: true });
  if ((filters.tags || []).length) pills.push({ label: 'tags: ' + filters.tags.join(', '), on: true });
  if (filters.hideWeakMentions) pills.push({ label: 'hide weak mentions', on: true });
  if (filters.hideOrphans) pills.push({ label: 'hide orphans', on: true });
  if (filters.hideArchived) pills.push({ label: 'hide archived', on: true });
  els.filtersUsed.innerHTML = renderPills(pills, 'No dataset filters applied yet.');

  // Badge counts non-default filters (hideArchived is default-on, excluded from count).
  const activeCount = (filters.types || []).length +
    (filters.relationTypes || []).length +
    (filters.tags || []).length +
    (filters.hideWeakMentions ? 1 : 0) +
    (filters.hideOrphans ? 1 : 0);
  const badge = document.getElementById('filterBadge');
  if (badge) {
    badge.textContent = String(activeCount);
    badge.hidden = activeCount === 0;
  }
  if (els.resetFiltersBtn) {
    els.resetFiltersBtn.classList.toggle('pri', activeCount > 0);
  }
}

function renderClusters(payload) {
  const types = (payload.facets.types || []).slice(0, 6);
  const tags = (payload.facets.tags || []).slice(0, 4);
  const items = [];
  types.forEach((entry) => {
    items.push(
      '<span class="cluster-chip">' +
      '<span class="cluster-dot"></span>' +
      '<span>' + escapeHtml(entry.type) + ' (' + escapeHtml(String(entry.count)) + ')</span>' +
      '</span>'
    );
  });
  tags.forEach((entry) => {
    items.push(
      '<span class="cluster-chip">' +
      '<span class="cluster-dot" style="background:#a371f7"></span>' +
      '<span class="tag">#' + escapeHtml(entry.tag) + ' (' + escapeHtml(String(entry.count)) + ')</span>' +
      '</span>'
    );
  });
  els.clusterList.innerHTML = items.length ? items.join('') : '<div class="empty">No clusters to summarize yet.</div>';
}

function renderGraph(payload) {
  const elements = payload.model.elements || [];
  const nodeCount = elements.filter((entry) => entry && entry.data && entry.data.id && !entry.data.source).length;
  const isVaultScope = payload.scope === 'vault' || payload.scope === 'domain';
  els.canvasEmpty.style.display = nodeCount ? 'none' : 'grid';
  if (!nodeCount) {
    // Do NOT push empty elements to the renderer — calling update([]) can leave
    // the React Flow canvas in a broken state that won't recover on the next update.
    // The empty-state overlay is shown above the (preserved) previous canvas instead.
    return;
  }

  selectedId = payload.selectedNodeId || (!isVaultScope ? payload.centerNodeId : null) || null;
  ensureReactFlowRenderer();
  graphRenderer.update(payload);
  renderSelectionCard(selectedId || null);
}

function ensureReactFlowRenderer() {
  if (!window.YamlinkGraph2Renderer || !els.graph2Canvas) return false;
  if (!graphRenderer) {
    graphRenderer = window.YamlinkGraph2Renderer.mount(els.graph2Canvas, {
      onNodeSelect: (nodeId) => {
        selectedId = nodeId;
        renderSelectionCard(nodeId);
      },

      onNodeOpen: (nodeId) => {
        post('openNode', { id: nodeId });
      }
    });
  }
  graphRenderer.setCallbacks({
    onNodeSelect: (nodeId) => {
      selectedId = nodeId;
      renderSelectionCard(nodeId);
    },
    onNodeOpen: (nodeId) => {
      post('openNode', { id: nodeId });
    }
  });
  return true;
}

function focusNode(nodeId, centerGraph) {
  if (!latestPayload) return;
  selectedId = nodeId;
  renderSelectionCard(nodeId);
  // selectNode updates highlighting without triggering re-layout.
  if (graphRenderer && graphRenderer.selectNode) graphRenderer.selectNode(nodeId);
  if (centerGraph !== false && graphRenderer && graphRenderer.fit) graphRenderer.fit();
  applySelectionVisibility();
  syncQuickActionState();
}

function renderPills(items, emptyText) {
  if (!items.length) return '<div class="empty">' + escapeHtml(emptyText) + '</div>';
  return '<div class="pills">' + items.map((item) => {
    const cls = ['pill'];
    if (item.on) cls.push('on');
    if (item.className) cls.push(item.className);
    return '<span class="' + cls.join(' ') + '">' + escapeHtml(item.label) + '</span>';
  }).join('') + '</div>';
}

function renderFacetPills(items, activeValues, facetKind, formatter, emptyText, extraClass) {
  if (!items.length) return '<div class="empty">' + escapeHtml(emptyText) + '</div>';
  const activeSet = new Set((activeValues || []).map((value) => String(value).toLowerCase()));
  return '<div class="pills">' + items.map((item) => {
    const rawValue = item.type || item.field || item.tag || '';
    const cls = ['pill', 'btnish'];
    if (extraClass) cls.push(extraClass);
    if (activeSet.has(String(rawValue).toLowerCase())) cls.push('on');
    return '<button class="' + cls.join(' ') + '" data-facet-kind="' + facetKind + '" data-facet-value="' + escapeHtml(String(rawValue)) + '">' + escapeHtml(formatter(item)) + '</button>';
  }).join('') + '</div>';
}

function bindActions(root) {
  root.querySelectorAll('[data-open]').forEach((button) => {
    button.addEventListener('click', () => {
      post('openNode', { id: button.dataset.open });
    });
  });
  root.querySelectorAll('[data-focus]').forEach((button) => {
    button.addEventListener('click', () => {
      focusNode(button.dataset.focus, true);
    });
  });
  root.querySelectorAll('[data-reroot]').forEach((button) => {
    button.addEventListener('click', () => {
      post('setCenter', { id: button.dataset.reroot });
    });
  });
}

function bindFacetButtons() {
  document.querySelectorAll('[data-facet-kind]').forEach((button) => {
    button.addEventListener('click', () => {
      post('toggleFilter', {
        facetKind: button.dataset.facetKind,
        value: button.dataset.facetValue
      });
    });
  });
}

function statCard(value, label) {
  return '<div class="stat"><b>' + escapeHtml(String(value)) + '</b><span>' + escapeHtml(label) + '</span></div>';
}

function formatTitle(value) {
  const raw = String(value || '');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'graph2:update') {
    // Reset transient overlay modes on every server-driven update. These modes are
    // client-side display overrides; they should not persist across server payloads
    // (e.g. filter toggle, scope change, note switch) or they fight server filters.
    isolateMode = false;
    hideUnrelatedMode = false;
    syncQuickActionState();
    render(message.payload);
  }
});

function applySearch() {
  if (!latestPayload) return;
  const term = String(els.searchInp.value || '').trim().toLowerCase();
  if (term) {
    const firstMatch = findFirstMatchingNodeId(latestPayload, term);
    if (firstMatch) selectedId = firstMatch;
  }
  render(latestPayload);
  if (graphRenderer && graphRenderer.fit) graphRenderer.fit();
}

function renderSelectionCard(nodeId) {
  const payload = currentDisplayPayload || latestPayload;
  if (!payload || !nodeId) {
    els.selectionCard.innerHTML = '<div class="empty">Select a node to inspect it.</div>';
    return;
  }
  const details = payload.model.nodeDetails && payload.model.nodeDetails[nodeId];
  const node = findNodeById(nodeId, payload);
  if (!details || !node) {
    els.selectionCard.innerHTML = '<div class="empty">Select a node to inspect it.</div>';
    return;
  }

  const strongest = (details.strongestLinks || [])[0];
  const tags = Array.isArray(details.tags) ? details.tags : [];
  const connectedTypes = details.connectedTypes || [];
  const connectedTypeSummary = connectedTypes.slice(0, 3).map((entry) => entry.type + ' (' + entry.count + ')').join(', ');

  els.selectionCard.innerHTML =
    '<div class="selection-card-primary">' +
      '<div class="item-top"><span class="item-title">' + escapeHtml(node.label) + '</span><button class="btn toolbar-btn toolbar-btn-accent" data-open="' + escapeHtml(node.id) + '">Open</button></div>' +
      '<div class="item-sub">' + escapeHtml(node.type) + '</div>' +
      '<div class="detail-grid">' +
        detailStat(details.outgoing.length, 'outgoing') +
        detailStat(details.incoming.length, 'incoming') +
        detailStat(node.weightedDegree || 0, 'signal') +
        detailStat(details.hiddenNeighborCount || 0, 'hidden neighbors') +
      '</div>' +
      '<div class="selection-actions">' +
        '<button class="btn toolbar-btn" data-reroot="' + escapeHtml(node.id) + '">Center graph here</button>' +
        '<button class="btn toolbar-btn toolbar-btn-muted" data-open="' + escapeHtml(node.id) + '">Open note</button>' +
      '</div>' +
    '</div>' +
    '<div class="list compact" style="margin-top:10px">' +
      '<div class="item muted"><div class="item-title">Strongest link</div><div class="item-sub">' + escapeHtml(formatStrongestLink(strongest)) + '</div></div>' +
      '<details class="selection-fold item muted"><summary>Connected types</summary><div class="item-sub">' + escapeHtml(connectedTypeSummary || 'None yet') + '</div></details>' +
      '<details class="selection-fold item muted"><summary>Tags</summary><div class="item-sub">' + escapeHtml(tags.length ? tags.map((tag) => '#' + tag).join(', ') : 'No tags') + '</div></details>' +
    '</div>';
  bindActions(els.selectionCard);
}

function detailStat(value, label) {
  return '<div class="detail-stat"><b>' + escapeHtml(String(value)) + '</b><span>' + escapeHtml(label) + '</span></div>';
}

function formatStrongestLink(link) {
  if (!link) return 'No strong relation yet';
  const target = link.targetId || link.sourceId || '';
  return link.label + ' → ' + target;
}

function findNodeById(nodeId, payloadArg) {
  const payload = payloadArg || latestPayload;
  if (!payload) return null;
  const entry = (payload.model.elements || []).find((element) => element && element.data && element.data.id === nodeId && !element.data.source);
  return entry ? entry.data : null;
}

function applySelectionVisibility() {
  if (!latestPayload) return;
  currentDisplayPayload = buildDisplayPayload(latestPayload);
  renderGraph(currentDisplayPayload);
  renderSelectionCard(selectedId || currentDisplayPayload?.selectedNodeId || null);
  if (graphRenderer && graphRenderer.fit) graphRenderer.fit();
}

function syncQuickActionState() {
  els.isolateBtn.classList.toggle('pri', isolateMode);
  els.hideUnrelatedBtn.classList.toggle('pri', hideUnrelatedMode);
}

function buildDisplayPayload(payload) {
  if (!payload) return payload;
  const term = String(els.searchInp?.value || '').trim().toLowerCase();
  const elements = payload.model.elements || [];
  const nodes = elements.map((element) => element.data).filter((data) => data && data.id && !data.source);
  const edges = elements.map((element) => element.data).filter((data) => data && data.source && data.target);
  const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  }

  let allowedNodeIds = new Set(nodes.map((node) => node.id));
  const isBroadScope = payload.scope === 'vault' || payload.scope === 'domain';
  let focusId = isBroadScope
    ? (selectedId || payload.selectedNodeId || null)
    : (selectedId || payload.selectedNodeId || payload.centerNodeId || nodes[0]?.id || null);

  if (term) {
    const matched = nodes
      .filter((node) => [node.label, node.id, node.type].some((value) => String(value || '').toLowerCase().includes(term)))
      .map((node) => node.id);
    const searchSet = new Set();
    for (const id of matched) {
      searchSet.add(id);
      for (const neighborId of adjacency.get(id) || []) searchSet.add(neighborId);
    }
    allowedNodeIds = intersectSets(allowedNodeIds, searchSet);
  }

  if (isolateMode && focusId) {
    // Isolate: show only the focus node and its direct 1-hop neighbors.
    const localSet = new Set([focusId, ...(adjacency.get(focusId) || [])]);
    allowedNodeIds = intersectSets(allowedNodeIds, localSet);
  } else if (hideUnrelatedMode && focusId) {
    // Hide unrelated: BFS from focus to include all reachable nodes (connected component).
    const reachable = new Set([focusId]);
    const queue = [focusId];
    while (queue.length) {
      const current = queue.shift();
      for (const nId of adjacency.get(current) || []) {
        if (!reachable.has(nId)) { reachable.add(nId); queue.push(nId); }
      }
    }
    allowedNodeIds = intersectSets(allowedNodeIds, reachable);
  }

  const visibleNodes = nodes.filter((node) => allowedNodeIds.has(node.id));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
  const visibleTypes = new Set(visibleNodes.map((node) => node.type));
  if (focusId && !visibleNodeIds.has(focusId)) {
    focusId = visibleNodes[0]?.id || null;
  }

  return {
    ...payload,
    selectedNodeId: focusId,
    model: {
      ...payload.model,
      elements: [
        ...visibleNodes.map((node) => ({ data: node })),
        ...visibleEdges.map((edge) => ({ data: edge }))
      ],
      topNodes: visibleNodes
        .map((node) => ({
          id: node.id,
          label: node.label,
          type: node.type,
          degree: node.degree,
          weightedDegree: node.weightedDegree,
          hubScore: node.hubScore,
          tagCount: node.tagCount
        }))
        .sort((a, b) => Number(b.hubScore || 0) - Number(a.hubScore || 0) || Number(b.weightedDegree || 0) - Number(a.weightedDegree || 0) || String(a.label || '').localeCompare(String(b.label || '')))
        .slice(0, 8),
      summary: {
        ...payload.model.summary,
        nodeCount: visibleNodes.length,
        edgeCount: visibleEdges.length,
        typeCount: visibleTypes.size,
        largestClusterSize: computeLargestClusterSize(visibleNodes.map((node) => node.id), visibleEdges),
        strongestRelation: summarizeStrongestRelation(visibleEdges)
      },
      nodeDetails: filterNodeDetails(payload.model.nodeDetails || {}, visibleNodeIds, visibleEdges)
    }
  };
}

function filterNodeDetails(detailsMap, visibleNodeIds, visibleEdges) {
  const byNode = {};
  for (const [nodeId, details] of Object.entries(detailsMap)) {
    if (!visibleNodeIds.has(nodeId)) continue;
    byNode[nodeId] = {
      ...details,
      outgoing: (details.outgoing || []).filter((edge) => visibleEdges.some((candidate) => candidate.source === nodeId && candidate.target === edge.targetId && candidate.label === edge.label)),
      incoming: (details.incoming || []).filter((edge) => visibleEdges.some((candidate) => candidate.target === nodeId && candidate.source === edge.sourceId && candidate.label === edge.label)),
      strongestLinks: (details.strongestLinks || []).filter((edge) => visibleEdges.some((candidate) =>
        (candidate.source === nodeId && candidate.target === edge.targetId && candidate.label === edge.label) ||
        (candidate.target === nodeId && candidate.source === edge.sourceId && candidate.label === edge.label)
      ))
    };
  }
  return byNode;
}

function summarizeStrongestRelation(edges) {
  const totals = new Map();
  for (const edge of edges) {
    const key = String(edge.label || '');
    totals.set(key, (totals.get(key) || 0) + Number(edge.weight || 0));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked[0]?.[0] || null;
}

function computeLargestClusterSize(nodeIds, edges) {
  const adjacency = new Map(nodeIds.map((id) => [id, new Set()]));
  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  }
  const visited = new Set();
  let largest = 0;
  for (const id of nodeIds) {
    if (visited.has(id)) continue;
    let count = 0;
    const stack = [id];
    visited.add(id);
    while (stack.length) {
      const current = stack.pop();
      count += 1;
      for (const nextId of adjacency.get(current) || []) {
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        stack.push(nextId);
      }
    }
    largest = Math.max(largest, count);
  }
  return largest;
}

function findFirstMatchingNodeId(payload, term) {
  const nodes = (payload.model.elements || [])
    .map((element) => element.data)
    .filter((data) => data && data.id && !data.source);
  const match = nodes.find((node) => [node.label, node.id, node.type].some((value) => String(value || '').toLowerCase().includes(term)));
  return match ? match.id : null;
}

function intersectSets(left, right) {
  return new Set([...left].filter((value) => right.has(value)));
}

window.__graph2post = post;
bind();
post('graph2:ready');
`;
}

module.exports = {
    buildGraph2ClientScript
};
