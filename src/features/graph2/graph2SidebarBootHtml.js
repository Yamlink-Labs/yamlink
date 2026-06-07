'use strict';

const crypto = require('crypto');
const { buildGraph2SidebarXGraphScript } = require('./graph2SidebarXGraphScript');

const SIDEBAR_STYLES = `
:root{
  --bg:var(--vscode-editor-background,#131313);
  --surface:var(--vscode-sideBar-background,#181b20);
  --border:var(--vscode-panel-border,#2a3038);
  --text:var(--vscode-editor-foreground,#dbe2ea);
  --mid:var(--vscode-descriptionForeground,#95a1ac);
  --accent:#5ECFBE;
  --accent2:#C49BF0;
  --sans:'Segoe UI',system-ui,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{
  background:
    radial-gradient(circle at 22% 18%,rgba(196,155,240,.08),transparent 28%),
    radial-gradient(circle at 82% 74%,rgba(197,255,191,.08),transparent 26%),
    var(--bg);
  font:12px/1.4 var(--sans);
  color:var(--text)
}
.shell{display:flex;flex-direction:column;height:100vh;overflow:hidden}
.toolbar{
  flex-shrink:0;display:flex;align-items:center;gap:4px;flex-wrap:wrap;
  padding:5px 6px;
  background:
    linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.01)),
    color-mix(in srgb,var(--surface) 96%, transparent);
  border-bottom:1px solid var(--border)
}
.scope-btn{
  padding:2px 8px;border-radius:7px;
  border:1px solid var(--border);
  background:transparent;color:var(--mid);
  font:inherit;font-size:11px;cursor:pointer;
  transition:background .1s,color .1s,border-color .1s
}
.scope-btn:hover{color:var(--text)}
.scope-btn.on{
  background:rgba(196,155,240,.14);
  border-color:rgba(196,155,240,.4);
  color:var(--accent2)
}
.layer-btn{
  padding:2px 7px;border-radius:7px;
  border:1px solid var(--border);
  background:transparent;color:var(--mid);
  font:inherit;font-size:10px;cursor:pointer;white-space:nowrap;
  transition:background .1s,color .1s,border-color .1s
}
.layer-btn:hover{color:var(--text)}
.layer-btn.on{
  background:rgba(94,207,190,.14);
  border-color:rgba(94,207,190,.4);
  color:var(--accent)
}
.icon-btn{
  width:22px;height:22px;
  border-radius:5px;border:1px solid var(--border);
  background:transparent;color:var(--mid);
  font-size:13px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:background .1s,color .1s;flex-shrink:0
}
.icon-btn:hover{color:var(--text)}
.icon-btn:hover{background:rgba(255,255,255,.07)}
.t-sep{width:1px;height:14px;background:var(--border);flex-shrink:0}
.count{font-size:10px;color:var(--mid);margin-left:auto;white-space:nowrap}
.node-bar{
  flex-shrink:0;display:none;align-items:center;gap:5px;
  padding:4px 7px;
  background:var(--surface);
  border-bottom:1px solid var(--border);
  font-size:11px
}
.node-bar.show{display:flex}
.node-bar-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
.node-bar-btn{
  padding:2px 7px;border-radius:5px;
  border:1px solid var(--border);
  background:transparent;color:var(--mid);
  font:inherit;font-size:10px;cursor:pointer;white-space:nowrap;
  transition:background .1s,color .1s
}
.node-bar-btn:hover{color:var(--text);background:rgba(255,255,255,.07)}
.node-bar-btn.primary{
  background:rgba(196,155,240,.14);
  border-color:rgba(196,155,240,.4);
  color:var(--accent2)
}
#graph-container{flex:1;min-height:0;position:relative}
`;

/**
 * @param {import('vscode').Webview} webview
 * @param {import('vscode').Uri}     extensionUri   (unused — kept for signature compat)
 * @param {string}                   rendererUri
 */
function buildGraph2SidebarBootHtml(webview, extensionUri, rendererUri) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const csp   = webview.cspSource;

    const clientScript = buildGraph2SidebarXGraphScript(rendererUri);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${csp}; style-src 'unsafe-inline'; img-src data: ${csp};">
<title>Yamlink Graph</title>
<style>${SIDEBAR_STYLES}</style>
</head>
<body>
<div class="shell">
  <div class="toolbar">
    <button class="scope-btn" data-scope="local"  title="Focus on current note and its direct connections">Local</button>
    <button class="scope-btn on" data-scope="vault" title="Full vault — all notes as a constellation">Vault</button>
    <span class="t-sep"></span>
    <button class="icon-btn" id="currentBtn" title="Centre on current note" aria-label="Centre on current note"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg></button>
    <button class="icon-btn" id="fitBtn"     title="Fit all nodes"          aria-label="Fit all nodes"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
    <span class="t-sep"></span>
    <button class="layer-btn" id="semanticBtn" title="Toggle semantic edge colouring by relation type">Semantic</button>
    <button class="layer-btn" id="healthBtn"   title="Toggle lifecycle and drift health rings on nodes">Health</button>
    <span class="count" id="countBadge"></span>
  </div>
  <div class="node-bar" id="nodeBar">
    <span class="node-bar-label" id="nodeBarLabel"></span>
    <button class="node-bar-btn primary" id="exploreBtn"   title="Open focused local graph for this note">Explore →</button>
    <button class="node-bar-btn"         id="openNodeBtn"  title="Open this note in the editor">Open</button>
    <button class="node-bar-btn"         id="dismissNodeBtn" title="Dismiss"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </div>
  <div id="graph-container"></div>
</div>

<script type="module" nonce="${nonce}">${clientScript}</script>
</body>
</html>`;
}

module.exports = { buildGraph2SidebarBootHtml };
