'use strict';

const crypto = require('crypto');
const { GRAPH_BOOT_STYLES } = require('./graphBootStyles');
const { buildGraphClientXGraphScript } = require('./graphClientXGraphScript');

// Real inline SVG icons for the time-lapse transport controls, replacing the
// previous emoji (⏱ ⏪ ▶ ⏸) -- emoji rendering is inconsistent across OS/font
// stacks and reads as unpolished next to the rest of this panel's plain-glyph
// buttons (+ / − / ⊙ / ✕). `currentColor` fill/stroke follows the button's
// own text color automatically.
const ICON_TIMELAPSE = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.3"/><path d="M8 4.6 V8.2 L10.6 9.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_PLAY = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M1 0.6 L9 5 L1 9.4 Z"/></svg>';
const ICON_REWIND = '<svg width="12" height="10" viewBox="0 0 12 10" fill="currentColor"><path d="M6 0.4 L0.4 5 L6 9.6 Z"/><path d="M11.6 0.4 L6 5 L11.6 9.6 Z"/></svg>';

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
      <button id="btnSemantic" class="layer-btn" type="button">Semantic <span class="help-tip" title="Colors each connection line by its relation type (unit, homeworld, mention, etc.) instead of one flat color, and draws soft outlines around detected note clusters.">?</span></button>
      <button id="btnHealth"   class="layer-btn" type="button">Health <span class="help-tip" title="Draws a colored ring around each note: its lifecycle stage (draft / growing / consolidated / hub / stale) normally, or its drift state (minor drift / drifting / outlier) instead if the note has drifted from its type's usual pattern -- drift always wins when both apply.">?</span></button>
      <span class="t-sep"></span>
      <button id="btnLabels" class="layer-btn" type="button" title="Cycle node label visibility: Auto (smart density, hides labels as the graph gets crowded) -> All (show every visible label) -> Off (hide all labels).">Labels: Auto</button>
      <span class="t-sep"></span>
      <button id="btnTimelapse" class="layer-btn" type="button" title="Play back how this graph grew over time. Reconstructed from git history when available (includes body-text links); frontmatter relations only otherwise.">${ICON_TIMELAPSE} Time-lapse</button>
    </div>
    <div id="modeHelp" class="mode-help" role="status" aria-live="polite">Local shows the current note, then adds one layer of linked notes around it.</div>

    <div id="timelapseBar" class="timelapse-bar" style="display:none" role="group" aria-label="Time-lapse controls">
      <button id="btnTimelapseRewind" class="btn sq" type="button" aria-label="Play time-lapse backward" title="Play backward">${ICON_REWIND}</button>
      <button id="btnTimelapsePlay" class="btn sq" type="button" aria-label="Play time-lapse">${ICON_PLAY}</button>
      <input id="timelapseScrub" class="timelapse-range" type="range" min="0" max="0" value="0" step="1" aria-label="Scrub through vault history">
      <span id="timelapseLabel" class="timelapse-label">Reconstructing history…</span>
      <button id="btnTimelapseExit" class="btn sq" type="button" aria-label="Exit time-lapse" title="Return to the live graph">✕</button>
    </div>

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
        <div class="card-hd">Themes <span class="help-tip" title="The most repeated #tags among the notes currently visible in this view -- a quick read on recurring topics in this neighborhood, not just this one note.">?</span></div>
        <div id="tagList" class="chips"></div>
      </div>
      <div class="card">
        <div class="card-hd">Most Connected</div>
        <div id="topNodes" class="nlist"></div>
      </div>
      <div class="card">
        <div class="card-hd">Relations <span class="help-tip" title="Every distinct relation field (unit, mentor, mention, etc.) used by the connections currently visible, ranked by total connection weight -- which kinds of relationships carry the most weight in this view, not just which are most common.">?</span></div>
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
