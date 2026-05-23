'use strict';

const crypto = require('crypto');
const vscode = require('vscode');
const { GRAPH2_BOOT_STYLES } = require('./graph2BootStyles');
const { buildGraph2ClientScript } = require('./graph2ClientScript');

function buildGraph2BootHtml(webview, extensionUri) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const csp = webview.cspSource;
    const reactFlowJsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'src', 'features', 'vendor', 'graph2-reactflow.js')
    );
    const reactFlowCssUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'src', 'features', 'vendor', 'graph2-reactflow.css')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${csp}; style-src 'unsafe-inline' ${csp}; img-src data: ${csp};">
<title>Yamlink Graph 2.0</title>
<style>${GRAPH2_BOOT_STYLES}</style>
<link rel="stylesheet" href="${reactFlowCssUri}">
</head>
<body>
<div class="frame">
  <header class="topbar">
    <div class="topbar-left">
      <div class="topbar-title">${graphTitleIcon()}<span>Yamlink · Graph</span></div>
    </div>
    <div class="topbar-right">
      <span class="topbar-hint">Scoped graph workspace</span>
    </div>
  </header>
  <div class="app">
    <aside class="panel">
      <div class="panel-scroll">
        <div class="eyebrow">Graph Context</div>
        <h1 class="title">Graph 2.0</h1>
        <p class="sub">Scoped, query-aware graph workspace.</p>
        <div class="panel-sticky">
          <div class="section">
            <h3>Source</h3>
            <div class="card grid">
              <label>
                <span class="label">Source</span>
                <select id="sourceSel" class="inp">
                  <option value="current">Current note</option>
                  <option value="query">Query-defined</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <p id="sourceHint" class="scope-hint">Start from the current note and inspect its connections.</p>
              <div id="queryPanel" class="src-panel">
                <span class="label">Query <span class="label-hint">⌘↵ to apply</span></span>
                <textarea id="queryText" class="inp" rows="3" placeholder="type:mission&#10;where commander = [[johnny-rico]]"></textarea>
              </div>
              <div id="customPanel" class="src-panel">
                <span class="label">Custom nodes <span class="label-hint">Enter to add</span></span>
                <div class="chip-field" id="chipField">
                  <div id="chipList"></div>
                  <input id="customInp" class="chip-inp" type="text" placeholder="node-id">
                </div>
              </div>
            </div>
          </div>

          <div class="section">
            <h3>Mode</h3>
            <div class="scope-segments">
              <button class="btn scope-btn" data-scope="neighborhood" title="Focus — current note and its strongest direct connections. Use Show more to expand."><span class="scope-name">Focus</span></button>
              <button class="btn scope-btn" data-scope="vault" title="Explore — all notes in the vault as a constellation. Click any dot to inspect it."><span class="scope-name">Explore</span></button>
            </div>
            <p id="scopeHint" class="scope-hint"></p>
          </div>

          <div class="section">
            <h3>Search</h3>
            <input id="searchInp" class="inp" type="search" placeholder="Search visible nodes">
          </div>

          <div id="focusControls" class="section" style="display:none">
            <h3>Connections</h3>
            <div class="card grid compact-grid">
              <p id="connectionStatus" class="scope-hint" style="margin:0"></p>
              <button id="showMoreBtn" class="btn" style="display:none">Show more connections</button>
            </div>
          </div>

          <div id="exploreControls" class="section" style="display:none">
            <h3>Visible notes</h3>
            <div class="card grid compact-grid">
              <label>
                <span class="label">Cap <span class="label-hint">max notes to load</span></span>
                <input id="nodeCapInp" class="inp" type="number" min="20" max="2000" step="1">
              </label>
            </div>
          </div>
        </div>

        <details class="accordion section">
          <summary>Advanced Filters <span id="filterBadge" class="filter-badge" hidden></span></summary>
          <div class="card grid">
            <div>
              <span class="label">Node types</span>
              <div id="facetsTypes"></div>
            </div>
            <div>
              <span class="label">Relation types</span>
              <div id="facetsRelations"></div>
            </div>
            <div>
              <span class="label">Tags</span>
              <div id="facetsTags"></div>
            </div>
            <div>
              <span class="label">Active</span>
              <div id="filtersUsed"></div>
            </div>
          </div>
        </details>
      </div>
    </aside>

    <main class="center">
      <div class="hero">
        <div class="hero-top">
          <div>
            <div class="eyebrow">Current Graph</div>
            <div class="hero-title"><span id="currentScope">Neighborhood</span> · <span id="currentSource">Current</span></div>
          </div>
          <div class="hero-meta" id="heroMeta">0 nodes · 0 edges</div>
        </div>
        <p class="sub" id="currentSummary">Scoped slice with the new graph model.</p>
        <div class="hero-controls hero-controls-secondary">
          <button id="fitBtn" class="btn toolbar-btn toolbar-btn-strong">Fit canvas</button>
          <button id="currentBtn" class="btn toolbar-btn toolbar-btn-accent">Current note</button>
          <button id="resetFiltersBtn" class="btn toolbar-btn toolbar-btn-muted">Reset filters</button>
        </div>
        <div id="stats" class="stats"></div>
      </div>

      <div class="canvas">
        <div class="canvas-card">
          <div class="graph-shell">
            <div id="graph2Canvas"></div>
            <div id="canvasEmpty" class="canvas-empty">
              <div>
                <strong>No visible nodes</strong>
                Graph 2.0 will render here once the current scope returns visible notes.
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <aside class="panel right">
      <div class="panel-scroll">
        <div class="section">
          <h3>Selection</h3>
          <div id="selectionCard" class="card"></div>
        </div>
        <div class="section">
          <h3>Quick Actions</h3>
          <div class="card">
            <div class="mini-actions">
              <button id="isolateBtn" class="btn">Isolate</button>
              <button id="hideUnrelatedBtn" class="btn">Hide unrelated</button>
              <button id="showAllBtn" class="btn">Show all</button>
            </div>
          </div>
        </div>
        <div class="section">
          <h3>Clusters</h3>
          <div id="clusterList" class="cluster-chips"></div>
        </div>

      </div>
    </aside>
  </div>
</div>
<script nonce="${nonce}" src="${reactFlowJsUri}"></script>
<script nonce="${nonce}">${buildGraph2ClientScript()}</script>
</body>
</html>`;
}

function graphTitleIcon() {
    return `<span class="topbar-glyph" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
        <circle cx="4" cy="4" r="1.9" />
        <circle cx="12" cy="4" r="1.9" />
        <circle cx="8" cy="12" r="1.9" />
        <path d="M5.7 5.1 7.1 9M10.3 5.1 8.9 9M5.9 4h4.2" />
      </svg>
    </span>`;
}

module.exports = {
    buildGraph2BootHtml
};
