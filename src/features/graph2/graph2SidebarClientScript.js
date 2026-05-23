'use strict';

function buildGraph2SidebarClientScript() {
    return `
const vscode = acquireVsCodeApi();
let graphRenderer = null;
let latestPayload = null;
let selectedNodeId = null;

function post(type, data) {
  vscode.postMessage(Object.assign({ type }, data || {}));
}

const countBadge = document.getElementById('countBadge');
const nodeBar = document.getElementById('nodeBar');
const nodeBarLabel = document.getElementById('nodeBarLabel');

function showNodeBar(nodeId, label) {
  selectedNodeId = nodeId;
  if (nodeBarLabel) nodeBarLabel.textContent = label || nodeId;
  if (nodeBar) nodeBar.classList.add('show');
}

function dismissNodeBar() {
  selectedNodeId = null;
  if (nodeBar) nodeBar.classList.remove('show');
}

function syncScopeButtons(scope) {
  document.querySelectorAll('[data-scope]').forEach(function(btn) {
    btn.classList.toggle('on', btn.dataset.scope === scope);
  });
}

function render(payload) {
  latestPayload = payload;
  if (!payload.selectedNodeId) {
    selectedNodeId = null;
    dismissNodeBar();
  }
  const elements = (payload.model && payload.model.elements) || [];
  const nodeCount = elements.filter(function(e) { return e && e.data && e.data.id && !e.data.source; }).length;
  const edgeCount = elements.filter(function(e) { return e && e.data && e.data.source; }).length;
  if (countBadge) {
    var scope = payload.scope || 'vault';
    var localScopes = scope === 'local' || scope === 'neighborhood';
    if (nodeCount === 0 && localScopes) {
      countBadge.textContent = 'Open a note to see its graph';
    } else {
      countBadge.textContent = nodeCount + ' notes · ' + edgeCount + ' links';
    }
  }
  syncScopeButtons(payload.scope || 'vault');

  const canvas = document.getElementById('graph2Canvas');
  if (!canvas) return;

  if (!graphRenderer && window.YamlinkGraph2Renderer) {
    graphRenderer = window.YamlinkGraph2Renderer.mount(canvas, {
      onNodeSelect: function(nodeId, nodeData) {
        var label = (nodeData && nodeData.label) ? nodeData.label : nodeId;
        showNodeBar(nodeId, label);
      },
      onNodeOpen: function(nodeId) { post('openNode', { id: nodeId }); }
    });
  }
  if (graphRenderer && graphRenderer.update) {
    graphRenderer.update(payload);
  }
}

var exploreBtn = document.getElementById('exploreBtn');
if (exploreBtn) {
  exploreBtn.addEventListener('click', function() {
    if (selectedNodeId) post('exploreNode', { id: selectedNodeId });
  });
}

var openNodeBtn = document.getElementById('openNodeBtn');
if (openNodeBtn) {
  openNodeBtn.addEventListener('click', function() {
    if (selectedNodeId) post('openNode', { id: selectedNodeId });
  });
}

var dismissNodeBtn = document.getElementById('dismissNodeBtn');
if (dismissNodeBtn) {
  dismissNodeBtn.addEventListener('click', function() { dismissNodeBar(); });
}

document.querySelectorAll('[data-scope]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    post('setScope', { scope: btn.dataset.scope });
  });
});

var currentBtn = document.getElementById('currentBtn');
if (currentBtn) {
  currentBtn.addEventListener('click', function() {
    post('focusCurrent');
  });
}

var fitBtn = document.getElementById('fitBtn');
if (fitBtn) {
  fitBtn.addEventListener('click', function() {
    if (graphRenderer && graphRenderer.fit) graphRenderer.fit();
  });
}

window.addEventListener('message', function(event) {
  var message = event.data || {};
  if (message.type === 'graph2:update') {
    render(message.payload);
  }
});

post('graph2:ready');
`;
}

module.exports = { buildGraph2SidebarClientScript };
