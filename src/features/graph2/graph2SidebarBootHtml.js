'use strict';

const crypto = require('crypto');
const vscode = require('vscode');
const { buildGraph2SidebarClientScript } = require('./graph2SidebarClientScript');

const SIDEBAR_STYLES = `
:root{
  --bg:var(--vscode-editor-background,#131313);
  --surface:var(--vscode-sideBar-background,#181b20);
  --border:var(--vscode-panel-border,#2a3038);
  --text:var(--vscode-editor-foreground,#dbe2ea);
  --mid:var(--vscode-descriptionForeground,#95a1ac);
  --accent2:#6eb3f0;
  --sans:'Segoe UI',system-ui,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{
  background:
    radial-gradient(circle at 22% 18%,rgba(110,179,240,.08),transparent 28%),
    radial-gradient(circle at 82% 74%,rgba(163,113,247,.08),transparent 26%),
    var(--bg);
  font:12px/1.4 var(--sans);
  color:var(--text)
}
.shell{display:flex;flex-direction:column;height:100vh;overflow:hidden}
.toolbar{
  flex-shrink:0;display:flex;align-items:center;gap:5px;flex-wrap:wrap;
  padding:6px 7px;
  background:
    linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.01)),
    color-mix(in srgb,var(--surface) 96%, transparent);
  border-bottom:1px solid var(--border)
}
.scope-btn{
  padding:2px 9px;border-radius:7px;
  border:1px solid var(--border);
  background:transparent;color:var(--mid);
  font:inherit;font-size:11px;cursor:pointer;
  transition:background .1s,color .1s,border-color .1s
}
.scope-btn:hover{color:var(--text)}
.scope-btn.on{
  background:rgba(110,179,240,.14);
  border-color:rgba(110,179,240,.4);
  color:var(--accent2)
}
.icon-btn{
  width:22px;height:22px;
  border-radius:5px;border:1px solid var(--border);
  background:transparent;color:var(--text);
  font-size:13px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:background .1s
}
.icon-btn:hover{background:rgba(255,255,255,.07)}
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
  background:rgba(110,179,240,.14);
  border-color:rgba(110,179,240,.4);
  color:var(--accent2)
}
#graph2Canvas{flex:1;min-height:0;position:relative}
.react-flow{height:100%!important}
.react-flow__controls{
  box-shadow:0 8px 24px rgba(0,0,0,.28);
  border-radius:10px;
  overflow:hidden
}
`;

function buildGraph2SidebarBootHtml(webview, extensionUri) {
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
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${csp}; style-src 'unsafe-inline' ${csp}; img-src data: ${csp};">
<title>Yamlink Graph</title>
<style>${SIDEBAR_STYLES}</style>
<link rel="stylesheet" href="${reactFlowCssUri}">
</head>
<body>
<div class="shell">
  <div class="toolbar">
    <button class="scope-btn" data-scope="local" title="Focus on current note and its direct connections">Local</button>
    <button class="scope-btn on" data-scope="vault" title="Full vault — all notes as a constellation">Vault</button>
    <button class="icon-btn" id="currentBtn" title="Center on current note">◎</button>
    <button class="icon-btn" id="fitBtn" title="Fit all nodes">⊙</button>
    <span class="count" id="countBadge"></span>
  </div>
  <div class="node-bar" id="nodeBar">
    <span class="node-bar-label" id="nodeBarLabel"></span>
    <button class="node-bar-btn primary" id="exploreBtn" title="Open focused local graph for this note">Explore →</button>
    <button class="node-bar-btn" id="openNodeBtn" title="Open this note in the editor">Open</button>
    <button class="node-bar-btn" id="dismissNodeBtn" title="Dismiss">✕</button>
  </div>
  <div id="graph2Canvas"></div>
</div>
<script nonce="${nonce}" src="${reactFlowJsUri}"></script>
<script nonce="${nonce}">${buildGraph2SidebarClientScript()}</script>
</body>
</html>`;
}

module.exports = { buildGraph2SidebarBootHtml };
