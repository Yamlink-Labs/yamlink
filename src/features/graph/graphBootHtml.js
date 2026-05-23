'use strict';

const crypto = require('crypto');
const vscode = require('vscode');
const { GRAPH_BOOT_STYLES } = require('./graphBootStyles');
const { buildGraphClientScript } = require('./graphClientScript');

function buildBootHtml(webview, extensionUri) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const cytoscapeUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'src', 'features', 'vendor', 'cytoscape.min.js')
    );
    const csp = webview.cspSource;
    const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${csp}; style-src 'unsafe-inline'; img-src data: ${csp};">
<title>Yamlink Graph</title>
<style>${GRAPH_BOOT_STYLES}</style>
</head>
<body>
<div class="app">
  <div class="canvas-wrap">
    <div id="graph"></div>

    <div class="toolbar">
      <button id="btnLocal" class="btn seg">Local</button>
      <button id="btnVault" class="btn seg">Explorer</button>
      <div class="focus-pill">
        <span id="focusMode" class="focus-mode">Local</span>
        <span id="focusName" class="focus-name">No focus</span>
      </div>
      <span id="depthGroup" class="toolbar-advanced" style="display:flex;align-items:center;gap:6px">
        <span class="t-sep"></span>
        <span class="t-label">Depth</span>
        <select id="depthSel" class="inp" title="How many layers of linked notes to show around the focused note">
          <option value="1">Direct links (1 layer)</option>
          <option value="2">Extended links (2 layers)</option>
          <option value="3">Broad links (3 layers)</option>
        </select>
        <span class="t-sep"></span>
      </span>
      <span id="typeGroup" class="toolbar-advanced" style="display:flex;align-items:center;gap:6px">
        <span class="t-label">Type</span>
        <select id="typeSel" class="inp" title="Filter the graph to one note type">
          <option value="">All types</option>
        </select>
        <span class="t-sep"></span>
      </span>
      <input id="searchInp" class="inp toolbar-advanced" type="search" placeholder="Search nodes…">
      <button id="btnReset" class="btn" title="Clear all filters">Reset</button>
      <span class="t-sep toolbar-advanced"></span>
      <button id="btnReveal" class="btn toolbar-advanced" title="Switch to Local mode and centre the graph on your currently open note">↺ Current Note</button>
    </div>
    <div id="modeHelp" class="mode-help">Local shows the current note, then adds one layer of linked notes around it.</div>

    <div class="zoom-wrap">
      <button id="btnZoomIn"  class="btn sq" title="Zoom in">+</button>
      <button id="btnZoomFit" class="btn sq" title="Fit all" style="font-size:12px">⊙</button>
      <button id="btnZoomOut" class="btn sq" title="Zoom out">−</button>
    </div>
    <div id="statusbar" class="statusbar">Loading…</div>

    <div id="tip" class="tip">
      <div id="tipName" class="tip-name"></div>
      <div id="tipType" class="tip-type"></div>
      <div class="tip-row">
        <span class="tip-stat">Out <b id="tipOut">0</b></span>
        <span class="tip-stat">In <b id="tipIn">0</b></span>
        <span class="tip-stat">Links <b id="tipDeg">0</b></span>
      </div>
    </div>

    <div id="ctx" class="ctx">
      <div class="ctx-item" id="ctxOpen" ><span class="ctx-ic">→</span>Open Note</div>
      <div class="ctx-item" id="ctxFocus"><span class="ctx-ic">◎</span>Focus Graph</div>
      <div class="ctx-item" id="ctxExpd" ><span class="ctx-ic">⊕</span>Expand</div>
    </div>

    <div id="empty" class="empty">
      <div class="empty-icon">◎</div>
      <div id="emptyTitle" class="empty-title">No graph nodes</div>
      <div id="emptyDesc" class="empty-desc">Open a Yamlink note with links,<br>or switch to Explorer mode.</div>
    </div>
  </div>

  <aside class="sidebar">
    <div class="sb-header">
      <div class="sb-eyebrow">Knowledge Graph</div>
      <div class="sb-title" id="sbTitle">Graph</div>
      <div id="sbDesc" class="sb-desc"></div>
    </div>
    <div class="sb-scroll">
      <div class="card">
        <div class="card-hd">Selected</div>
        <div id="selCard"><div class="sel-empty">Pick a node to inspect it.</div></div>
      </div>
      <div class="card">
        <div class="card-hd">Types</div>
        <div id="typeChips" class="chips"></div>
      </div>
      <div class="card">
        <div class="card-hd">Themes</div>
        <div id="tagList" class="chips"></div>
      </div>
      <div class="card">
        <div class="card-hd">Most Connected</div>
        <div id="topNodes" class="nlist"></div>
      </div>
      <div class="card">
        <div class="card-hd">Relations</div>
        <div id="relList" class="rlist"></div>
      </div>
    </div>
  </aside>
</div>

<script nonce="${nonce}" src="${cytoscapeUri}"></script>
<script nonce="${nonce}">${buildGraphClientScript(buildTime)}</script>
</body>
</html>`;
}

module.exports = {
    buildBootHtml
};
