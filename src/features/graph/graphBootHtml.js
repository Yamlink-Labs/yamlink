'use strict';

const crypto = require('crypto');
const { GRAPH_BOOT_STYLES } = require('./graphBootStyles');
const { buildGraphClientXGraphScript } = require('./graphClientXGraphScript');

/**
 * @param {import('vscode').Webview} webview
 * @param {import('vscode').Uri}     extensionUri
 * @param {string}                   rendererUri  - webview URI string for Canvas2DRenderer.js
 */
function buildBootHtml(webview, extensionUri, rendererUri) {
    const nonce     = crypto.randomBytes(16).toString('hex');
    const csp       = webview.cspSource;
    const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');

    const clientScript = buildGraphClientXGraphScript(rendererUri, buildTime);

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
    <div id="graph-container" role="img" aria-label="Knowledge graph canvas"></div>

    <div class="toolbar" role="toolbar" aria-label="Graph controls">
      <button id="btnLocal" class="btn seg" type="button" aria-pressed="true">Local</button>
      <button id="btnVault" class="btn seg" type="button" aria-pressed="false">Explorer</button>
      <div class="focus-pill">
        <span id="focusMode" class="focus-mode">Local</span>
        <span id="focusName" class="focus-name" aria-live="polite">No focus</span>
      </div>
      <span id="depthGroup" class="toolbar-advanced" style="display:flex;align-items:center;gap:6px">
        <span class="t-sep"></span>
        <label class="t-label" for="depthSel">Depth</label>
        <select id="depthSel" class="inp" title="How many layers of linked notes to show around the focused note" aria-label="Graph depth">
          <option value="1">Direct links (1 layer)</option>
          <option value="2">Extended links (2 layers)</option>
          <option value="3">Broad links (3 layers)</option>
        </select>
        <span class="t-sep"></span>
      </span>
      <span id="typeGroup" class="toolbar-advanced" style="display:flex;align-items:center;gap:6px">
        <label class="t-label" for="typeSel">Type</label>
        <select id="typeSel" class="inp" title="Filter the graph to one note type" aria-label="Graph type filter">
          <option value="">All types</option>
        </select>
        <span class="t-sep"></span>
      </span>
      <label class="sr-only" for="searchInp">Search graph nodes</label>
      <input id="searchInp" class="inp toolbar-advanced" type="search" placeholder="Search nodes…" aria-label="Search graph nodes">
      <button id="btnReset" class="btn" type="button" title="Clear all filters">Reset</button>
      <span class="t-sep toolbar-advanced"></span>
      <button id="btnReveal" class="btn toolbar-advanced" type="button" title="Switch to Local mode and centre the graph on your currently open note">↺ Current Note</button>
      <span class="t-sep"></span>
      <button id="btnSemantic" class="layer-btn" type="button" title="Toggle semantic edge colouring by relation type">Semantic</button>
      <button id="btnHealth"   class="layer-btn" type="button" title="Toggle lifecycle and drift health rings on nodes">Health</button>
    </div>
    <div id="modeHelp" class="mode-help" role="status" aria-live="polite">Local shows the current note, then adds one layer of linked notes around it.</div>

    <div class="zoom-wrap">
      <button id="btnZoomIn"  class="btn sq" type="button" title="Zoom in"       aria-label="Zoom in">+</button>
      <button id="btnZoomFit" class="btn sq" type="button" title="Fit all"        aria-label="Fit graph to view" style="font-size:12px">⊙</button>
      <button id="btnZoomOut" class="btn sq" type="button" title="Zoom out"       aria-label="Zoom out">−</button>
    </div>
    <div id="statusbar" class="statusbar" role="status" aria-live="polite">Loading…</div>

    <div id="tip" class="tip">
      <div id="tipName" class="tip-name"></div>
      <div id="tipType" class="tip-type"></div>
      <div class="tip-row">
        <span class="tip-stat">Out <b id="tipOut">0</b></span>
        <span class="tip-stat">In <b id="tipIn">0</b></span>
        <span class="tip-stat">Links <b id="tipDeg">0</b></span>
      </div>
    </div>

    <div id="ctx" class="ctx" role="menu" aria-label="Graph node actions">
      <button class="ctx-item" id="ctxOpen"  type="button" role="menuitem"><span class="ctx-ic">→</span>Open Note</button>
      <button class="ctx-item" id="ctxFocus" type="button" role="menuitem"><span class="ctx-ic">◎</span>Focus Graph</button>
      <button class="ctx-item" id="ctxExpd"  type="button" role="menuitem"><span class="ctx-ic">⊕</span>Expand</button>
    </div>

    <div id="empty" class="empty" role="status" aria-live="polite">
      <div class="empty-icon">◎</div>
      <div id="emptyTitle" class="empty-title">No graph nodes</div>
      <div id="emptyDesc"  class="empty-desc">Open a Yamlink note with links,<br>or switch to Explorer mode.</div>
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

<script type="module" nonce="${nonce}">${clientScript}</script>
</body>
</html>`;
}

module.exports = {
    buildBootHtml
};
