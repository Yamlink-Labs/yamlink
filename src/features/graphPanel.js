'use strict';

const vscode = require('vscode');
const crypto = require('crypto');
const { getIndex } = require('../core/index');
const { getEdges } = require('../core/graph');
const { extractCanonicalIdFromFrontmatter } = require('../core/id');
const { parseAllViewQueries, runQuery } = require('../engine/query');

let panel = null;
let lastBlocks = null;
let _contextNodeId = null;
let _panelState = { selectedNodeId: null };

function parseGraphBlocks(text) {
    const blocks = [];
    const fenceRe = /```yamlink-graph\s*\n([\s\S]*?)```/g;
    let match;

    while ((match = fenceRe.exec(text)) !== null) {
        const inner = match[1].trim();
        const queries = parseAllViewQueries(inner);
        if (queries && queries.length > 0) blocks.push(...queries);
    }

    return blocks.length > 0 ? blocks : null;
}

function openGraphPanel(context, documentText, contextText) {
    const blocks = parseGraphBlocks(documentText);
    if (!blocks) return;

    lastBlocks = blocks;
    _contextNodeId = extractCanonicalIdFromFrontmatter(contextText || documentText);

    if (!panel) {
        panel = vscode.window.createWebviewPanel(
            'yamlink.graphPanel',
            'Yamlink Graph',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'openNode') {
                const fp = getIndex().get(msg.id);
                if (!fp) return;
                const doc = await vscode.workspace.openTextDocument(fp);
                await vscode.window.showTextDocument(doc, {
                    viewColumn: vscode.ViewColumn.One,
                    preview: false
                });
                return;
            }

            if (msg.command === 'saveState') {
                _panelState = Object.assign({}, _panelState, msg.state || {});
            }
        }, null, context.subscriptions);

        panel.onDidDispose(() => {
            panel = null;
            _panelState = { selectedNodeId: null };
        }, null, context.subscriptions);
    }

    renderGraph(blocks);
}

function refreshGraphPanel() {
    if (panel && lastBlocks) renderGraph(lastBlocks);
}

function renderGraph(blocks) {
    if (!panel) return;

    const rows = [];
    const seenIds = new Set();
    for (const query of blocks) {
        const result = runQuery(query, _contextNodeId || null);
        if (!result.success) continue;
        for (const row of result.rows) {
            if (seenIds.has(row.id)) continue;
            seenIds.add(row.id);
            rows.push(row);
        }
    }

    if (rows.length === 0) {
        panel.webview.html = buildEmptyHtml();
        return;
    }

    const model = buildGraphModel(rows, _contextNodeId);
    const nonce = crypto.randomBytes(16).toString('hex');
    const csp = panel.webview.cspSource;

    panel.title = blocks.length === 1
        ? `Graph · ${blocks[0].type === '*' ? 'all nodes' : blocks[0].type}`
        : `Graph · ${blocks.length} queries`;

    panel.webview.html = buildHtml(model, nonce, csp, _panelState);
}

function buildGraphModel(rows, contextNodeId) {
    const palette = [
        '#2ec4b6', '#4f7cff', '#ff9f43', '#ff6b6b',
        '#8b7dff', '#35b4ff', '#7bc96f', '#f4c95d'
    ];
    const shapes = ['ellipse', 'round-rectangle', 'diamond', 'hexagon', 'tag', 'vee'];
    const relationPalette = [
        '#2ec4b6', '#4f7cff', '#ff9f43', '#ff6b6b',
        '#8b7dff', '#35b4ff', '#7bc96f', '#f4c95d'
    ];
    const typeColors = {};
    const typeShapes = {};
    const relationColors = {};
    let colorIdx = 0;
    let relationIdx = 0;

    const rowById = new Map();
    const nodeIds = new Set();
    for (const row of rows) {
        rowById.set(row.id, row);
        nodeIds.add(row.id);
        const type = row.nodeType || 'unknown';
        if (!typeColors[type]) {
            typeColors[type] = palette[colorIdx % palette.length];
            typeShapes[type] = shapes[colorIdx % shapes.length];
            colorIdx++;
        }
    }

    const edges = [];
    const seenEdges = new Set();
    for (const row of rows) {
        const outbound = getEdges(row.id);
        for (const edge of outbound) {
            if (!edge || edge.field === 'body') continue;
            if (!nodeIds.has(edge.targetId)) continue;
            const edgeId = `${row.id}->${edge.targetId}->${edge.field}`;
            if (seenEdges.has(edgeId)) continue;
            seenEdges.add(edgeId);
            if (!relationColors[edge.field]) {
                relationColors[edge.field] = relationPalette[relationIdx % relationPalette.length];
                relationIdx++;
            }
            edges.push({
                data: {
                    id: edgeId,
                    source: row.id,
                    target: edge.targetId,
                    label: edge.field,
                    color: relationColors[edge.field]
                }
            });
        }
    }

    const degreeMap = new Map();
    for (const edge of edges) {
        degreeMap.set(edge.data.source, (degreeMap.get(edge.data.source) || 0) + 1);
        degreeMap.set(edge.data.target, (degreeMap.get(edge.data.target) || 0) + 1);
    }

    const nodes = rows.map((row) => {
        const type = row.nodeType || 'unknown';
        const degree = degreeMap.get(row.id) || 0;
        return {
            data: {
                id: row.id,
                label: row.fields.name || row.fields.title || row.id,
                type,
                color: typeColors[type],
                shape: typeShapes[type],
                degree,
                isContext: row.id === contextNodeId
            }
        };
    });

    const types = Object.entries(typeColors).map(([type, color]) => ({
        type,
        color,
        shape: typeShapes[type],
        count: rows.filter(row => (row.nodeType || 'unknown') === type).length
    })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

    const relations = Object.entries(relationColors).map(([field, color]) => ({
        field,
        color,
        count: edges.filter(edge => edge.data.label === field).length
    })).sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));

    const topNodes = rows
        .map(row => ({
            id: row.id,
            label: row.fields.name || row.fields.title || row.id,
            type: row.nodeType || 'unknown',
            degree: degreeMap.get(row.id) || 0
        }))
        .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
        .slice(0, 8);

    return {
        elements: [...nodes, ...edges],
        summary: {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            typeCount: types.length,
            contextId: contextNodeId || null
        },
        types,
        relations,
        topNodes
    };
}

function buildHtml(model, nonce, csp, panelState) {
    const typeLegendHtml = model.types.map((entry) =>
        `<button class="type-chip" data-type="${esc(entry.type)}"><span class="type-dot" data-shape="${esc(entry.shape)}" style="background:${entry.color}"></span>${esc(entry.type)}<span class="type-count">${entry.count}</span></button>`
    ).join('');

    const relationLegendHtml = model.relations.map((entry) =>
        `<button class="type-chip relation-chip" data-relation="${esc(entry.field)}"><span class="type-dot" style="background:${entry.color}"></span>${esc(entry.field)}<span class="type-count">${entry.count}</span></button>`
    ).join('');

    const mapKeyHtml = model.types.map((entry) =>
        `<span class="key-chip"><span class="type-dot" data-shape="${esc(entry.shape)}" style="background:${entry.color}"></span>${esc(entry.type)}</span>`
    ).join('');

    const topNodesHtml = model.topNodes.map((node) =>
        `<button class="node-list-item" data-node="${esc(node.id)}">
            <span class="node-list-main">${esc(node.label)}</span>
            <span class="node-list-meta">${esc(node.type)} · ${node.degree} link${node.degree === 1 ? '' : 's'}</span>
        </button>`
    ).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           style-src 'unsafe-inline';
           script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com ${csp};
           connect-src 'none';">
<style>
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--vscode-button-background, #0e7490) 12%, transparent), transparent 28%),
    linear-gradient(180deg, color-mix(in srgb, var(--vscode-sideBar-background, #141821) 92%, #081018 8%), var(--vscode-editor-background, #11141a));
  color:var(--vscode-editor-foreground,#d6dbe2);
  font-family:'Segoe UI',system-ui,sans-serif;
  font-size:13px;
  overflow:hidden;
}
.shell{
  display:grid;
  grid-template-columns:minmax(0,1fr) clamp(260px, 28vw, 340px);
  grid-template-rows:auto minmax(0,1fr);
  height:100%;
}
.toolbar{
  grid-column:1 / span 2;
  display:flex;
  align-items:center;
  gap:10px;
  padding:10px 14px;
  border-bottom:1px solid color-mix(in srgb, var(--vscode-panel-border,#283140) 85%, transparent);
  background:color-mix(in srgb, var(--vscode-sideBar-background,#131720) 92%, transparent);
  backdrop-filter:blur(10px);
}
.title-wrap{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.eyebrow{
  font-size:10px;
  font-weight:700;
  letter-spacing:.12em;
  text-transform:uppercase;
  color:var(--vscode-descriptionForeground,#8da2bc);
}
.title{
  font-size:18px;
  font-weight:700;
  line-height:1.05;
  color:var(--vscode-editor-foreground,#eef2f7);
}
.subtitle{
  color:var(--vscode-descriptionForeground,#92a0b3);
  font-size:11px;
}
.summary{display:flex;gap:8px;flex-wrap:wrap}
.stat{
  min-width:84px;
  padding:8px 10px;
  border-radius:14px;
  background:linear-gradient(180deg, color-mix(in srgb, var(--vscode-editorWidget-background,#1a2230) 92%, transparent), color-mix(in srgb, var(--vscode-editor-background,#10141d) 94%, transparent));
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 80%, transparent);
}
.stat-label{
  font-size:10px;
  font-weight:700;
  letter-spacing:.12em;
  text-transform:uppercase;
  color:var(--vscode-descriptionForeground,#8da2bc);
  margin-bottom:6px;
}
.stat-value{
  font-size:17px;
  font-weight:700;
  color:var(--vscode-editor-foreground,#eef2f7);
}
.canvas-wrap{
  min-width:0;
  min-height:0;
  display:grid;
  grid-template-rows:auto minmax(0,1fr);
}
.controls{
  display:flex;
  align-items:center;
  gap:8px;
  padding:8px 12px;
  border-bottom:1px solid color-mix(in srgb, var(--vscode-panel-border,#283140) 82%, transparent);
  background:color-mix(in srgb, var(--vscode-editorWidget-background,#171d28) 92%, transparent);
  flex-wrap:wrap;
}
.map-key{
  width:100%;
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  align-items:center;
}
.key-chip{
  display:inline-flex;
  align-items:center;
  gap:7px;
  padding:4px 8px;
  border-radius:999px;
  background:color-mix(in srgb, var(--vscode-input-background,#111721) 82%, transparent);
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 70%, transparent);
  color:var(--vscode-descriptionForeground,#a2b0c4);
  font-size:11px;
}
.search{
  flex:1;
  min-width:200px;
  background:color-mix(in srgb, var(--vscode-input-background,#10151f) 92%, transparent);
  border:1px solid color-mix(in srgb, var(--vscode-input-border,#2d3543) 85%, transparent);
  border-radius:999px;
  color:var(--vscode-input-foreground,#d6dbe2);
  padding:8px 12px;
  outline:none;
}
.search:focus{
  border-color:var(--vscode-focusBorder,#4fc4a0);
  box-shadow:0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder,#4fc4a0) 55%, transparent);
}
.tool-btn{
  background:transparent;
  color:var(--vscode-button-foreground,#d7dfeb);
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 85%, transparent);
  border-radius:999px;
  padding:7px 10px;
  font:inherit;
  cursor:pointer;
  white-space:nowrap;
}
.tool-btn:hover,.tool-btn.active{
  color:#e9fff7;
  border-color:#36c4a3;
  background:color-mix(in srgb, #36c4a3 14%, transparent);
}
.graph-stage{
  position:relative;
  min-height:0;
  background:
    radial-gradient(circle at center, color-mix(in srgb, var(--vscode-textBlockQuote-background,#1a2431) 12%, transparent), transparent 48%),
    linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background,#12161d) 96%, transparent), color-mix(in srgb, var(--vscode-sideBar-background,#11151d) 96%, transparent));
}
#cy{
  position:absolute;
  inset:0;
}
.hint-badge{
  position:absolute;
  left:18px;
  top:14px;
  bottom:auto;
  padding:6px 10px;
  border-radius:12px;
  background:color-mix(in srgb, var(--vscode-editorWidget-background,#151c28) 95%, transparent);
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 80%, transparent);
  color:var(--vscode-descriptionForeground,#90a1b8);
  font-size:11px;
  max-width:320px;
}
.sidebar{
  min-width:280px;
  border-left:1px solid color-mix(in srgb, var(--vscode-panel-border,#283140) 82%, transparent);
  background:linear-gradient(180deg, color-mix(in srgb, var(--vscode-sideBar-background,#11161f) 98%, transparent), color-mix(in srgb, var(--vscode-editorWidget-background,#161c28) 98%, transparent));
  display:flex;
  flex-direction:column;
  min-height:0;
}
.sidebar-scroll{
  padding:12px;
  overflow:auto;
  display:flex;
  flex-direction:column;
  gap:10px;
}
.panel-card{
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 78%, transparent);
  border-radius:16px;
  padding:12px;
  background:linear-gradient(180deg, color-mix(in srgb, var(--vscode-editorWidget-background,#19202c) 98%, transparent), color-mix(in srgb, var(--vscode-editor-background,#11161d) 98%, transparent));
}
.card-title{
  font-size:11px;
  font-weight:700;
  letter-spacing:.12em;
  text-transform:uppercase;
  color:var(--vscode-descriptionForeground,#8da2bc);
  margin:0 0 10px;
}
.type-grid{display:flex;flex-wrap:wrap;gap:8px}
.type-chip{
  border:none;
  background:color-mix(in srgb, var(--vscode-input-background,#111721) 92%, transparent);
  color:var(--vscode-editor-foreground,#dae3ef);
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 78%, transparent);
  border-radius:999px;
  padding:6px 9px;
  font:inherit;
  display:flex;
  align-items:center;
  gap:8px;
  cursor:pointer;
}
.type-chip:hover,.type-chip.active{
  border-color:#36c4a3;
  background:color-mix(in srgb, #36c4a3 14%, transparent);
}
.type-dot{width:9px;height:9px;border-radius:50%;display:inline-block}
.type-dot[data-shape="round-rectangle"]{border-radius:4px}
.type-dot[data-shape="diamond"]{border-radius:0;transform:rotate(45deg)}
.type-dot[data-shape="hexagon"]{clip-path:polygon(25% 5%,75% 5%,100% 50%,75% 95%,25% 95%,0 50%)}
.type-dot[data-shape="tag"]{clip-path:polygon(12% 0,100% 0,100% 100%,12% 100%,0 50%)}
.type-dot[data-shape="vee"]{clip-path:polygon(0 0,100% 0,72% 50%,100% 100%,0 100%,28% 50%)}
.type-count{
  padding:2px 7px;
  border-radius:999px;
  background:color-mix(in srgb, var(--vscode-badge-background,#213041) 90%, transparent);
  color:var(--vscode-badge-foreground,#d8e7ff);
  font-size:11px;
}
.node-list{display:flex;flex-direction:column;gap:8px}
.node-list-item{
  width:100%;
  text-align:left;
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 78%, transparent);
  border-radius:14px;
  background:color-mix(in srgb, var(--vscode-input-background,#111721) 92%, transparent);
  color:var(--vscode-editor-foreground,#dde5f0);
  padding:9px 10px;
  cursor:pointer;
}
.node-list-item:hover{border-color:#5fa8ff}
.relation-chip:hover,.relation-chip.active{border-color:#ffb55f;background:color-mix(in srgb, #ffb55f 14%, transparent)}
.node-list-main{display:block;font-weight:600;margin-bottom:4px}
.node-list-meta{display:block;color:var(--vscode-descriptionForeground,#90a1b8);font-size:12px}
.inspector-title{
  font-size:18px;
  font-weight:700;
  margin:0 0 6px;
  color:var(--vscode-editor-foreground,#eef2f7);
}
.inspector-meta{
  color:var(--vscode-descriptionForeground,#90a1b8);
  margin:0 0 10px;
  font-size:12px;
}
.inspector-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.pill{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:7px 10px;
  border-radius:999px;
  background:color-mix(in srgb, var(--vscode-input-background,#111721) 92%, transparent);
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 78%, transparent);
  color:var(--vscode-editor-foreground,#dde5f0);
}
.link-list{display:flex;flex-direction:column;gap:8px}
.section-heading{
  margin:0 0 8px;
  font-size:10px;
  font-weight:700;
  letter-spacing:.12em;
  text-transform:uppercase;
  color:var(--vscode-descriptionForeground,#8da2bc);
}
.link-row{
  display:grid;
  grid-template-columns:1fr auto;
  gap:10px;
  padding:10px 12px;
  border-radius:12px;
  background:color-mix(in srgb, var(--vscode-input-background,#111721) 88%, transparent);
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 72%, transparent);
}
.link-main{display:flex;flex-direction:column;gap:4px}
.link-label{font-weight:600}
.link-sub{font-size:12px;color:var(--vscode-descriptionForeground,#90a1b8)}
.link-edge{
  align-self:center;
  padding:3px 8px;
  border-radius:999px;
  background:color-mix(in srgb, #36c4a3 14%, transparent);
  color:#b9f5e6;
  font-size:11px;
}
.inspector-note{
  margin-top:10px;
  color:var(--vscode-descriptionForeground,#90a1b8);
  line-height:1.55;
}
.empty-copy{
  color:var(--vscode-descriptionForeground,#90a1b8);
  line-height:1.5;
}
@media (max-width: 1080px){
  .title{font-size:17px}
  .subtitle{display:none}
  .summary{margin-left:auto}
}
@media (max-width: 840px){
  .shell{grid-template-columns:minmax(0,1fr) 280px}
  .search{min-width:160px}
}
@media (max-width: 720px){
  .shell{grid-template-columns:minmax(0,1fr)}
  .toolbar{grid-column:1;flex-wrap:wrap}
  .summary{width:100%}
  .sidebar{display:none}
}
</style>
</head>
<body>
  <div class="shell">
    <div class="toolbar">
      <div class="title-wrap">
        <div class="eyebrow">Yamlink graph</div>
        <div class="title">Relationship map</div>
        <div class="subtitle">Read the structure of your query result, not just its rows.</div>
      </div>
      <div class="summary">
        <div class="stat"><div class="stat-label">Nodes</div><div class="stat-value">${model.summary.nodeCount}</div></div>
        <div class="stat"><div class="stat-label">Edges</div><div class="stat-value">${model.summary.edgeCount}</div></div>
        <div class="stat"><div class="stat-label">Types</div><div class="stat-value">${model.summary.typeCount}</div></div>
      </div>
    </div>

    <div class="canvas-wrap">
      <div class="controls">
        <div class="map-key">${mapKeyHtml}</div>
        <input id="search" class="search" type="search" placeholder="Search nodes by name, id, or type…" />
        <button class="tool-btn" id="btnFit">Fit</button>
        <button class="tool-btn" id="btnReset">Reset</button>
        <button class="tool-btn" id="btnContext"${model.summary.contextId ? '' : ' disabled'}>Focus note</button>
        <button class="tool-btn" id="btnLabels">Edge labels</button>
      </div>
      <div class="graph-stage">
        <div id="cy"></div>
        <div class="hint-badge">Click a node for details. Double-click a node to isolate its neighborhood.</div>
      </div>
    </div>

    <aside class="sidebar">
      <div class="sidebar-scroll">
        <section class="panel-card">
          <h2 class="card-title">Types</h2>
          <div class="type-grid" id="typeLegend">${typeLegendHtml}</div>
        </section>

        <section class="panel-card">
          <h2 class="card-title">Relations</h2>
          <div class="type-grid" id="relationLegend">${relationLegendHtml || '<div class="empty-copy">No relation edges in this graph slice.</div>'}</div>
        </section>

        <section class="panel-card">
          <h2 class="card-title">Most connected</h2>
          <div class="node-list" id="topNodes">${topNodesHtml}</div>
        </section>

        <section class="panel-card" id="inspector" style="flex:1">
          <h2 class="card-title">Inspector</h2>
          <div class="empty-copy" id="inspectorEmpty">Select a node to inspect its relationships, then open the note directly from here.</div>
          <div id="inspectorBody" hidden>
            <h3 class="inspector-title" id="nodeTitle"></h3>
            <p class="inspector-meta" id="nodeMeta"></p>
            <div class="inspector-actions">
              <span class="pill" id="nodeDegree"></span>
              <span class="pill" id="nodeType"></span>
            </div>
            <div class="link-list" id="outgoingList"></div>
            <div class="link-list" id="incomingList" style="margin-top:10px"></div>
            <p class="inspector-note" id="inspectorNote">Click a neighbor in the graph to keep traversing, or open this note in the editor.</p>
            <div class="inspector-actions" style="margin-top:14px">
              <button class="tool-btn" id="openNodeBtn">Open note</button>
            </div>
          </div>
        </section>
      </div>
    </aside>
  </div>

<script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.28.1/cytoscape.min.js"></script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const ELEMENTS = ${JSON.stringify(model.elements)};
const SUMMARY = ${JSON.stringify(model.summary)};
const TOP_NODES = ${JSON.stringify(model.topNodes)};
const RELATIONS = ${JSON.stringify(model.relations)};
const INITIAL_STATE = ${JSON.stringify(panelState || {})};

let labelsVisible = false;
let activeType = null;
let activeRelation = null;
let selectedNodeId = INITIAL_STATE.selectedNodeId || SUMMARY.contextId || null;

const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: ELEMENTS,
  style: [
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)',
        'shape': 'data(shape)',
        'width': 'mapData(degree, 0, 8, 42, 74)',
        'height': 'mapData(degree, 0, 8, 42, 74)',
        'label': 'data(label)',
        'color': '#eff6ff',
        'font-family': 'Segoe UI, system-ui, sans-serif',
        'font-size': '13px',
        'font-weight': 600,
        'text-wrap': 'wrap',
        'text-max-width': 140,
        'text-valign': 'bottom',
        'text-margin-y': 12,
        'text-background-color': 'rgba(11,17,25,0.9)',
        'text-background-opacity': 1,
        'text-background-padding': 5,
        'text-border-radius': 12,
        'border-width': 3,
        'border-color': 'rgba(255,255,255,0.18)',
        'shadow-blur': 18,
        'shadow-color': 'rgba(0,0,0,0.35)',
        'shadow-opacity': 0.35,
        'shadow-offset-y': 6,
        'overlay-opacity': 0
      }
    },
    {
      selector: 'node[?isContext]',
      style: {
        'border-width': 4,
        'border-color': '#ffffff',
        'shadow-blur': 18,
        'shadow-color': '#36c4a3',
        'shadow-opacity': 0.35
      }
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 5,
        'border-color': '#5fa8ff',
        'shadow-blur': 24,
        'shadow-color': '#5fa8ff',
        'shadow-opacity': 0.45
      }
    },
    {
      selector: 'node.neighbor',
      style: {
        'border-width': 4,
        'border-color': '#36c4a3',
        'shadow-blur': 18,
        'shadow-color': '#36c4a3',
        'shadow-opacity': 0.28
      }
    },
    {
      selector: 'edge',
      style: {
        'curve-style': 'unbundled-bezier',
        'width': 2,
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 1,
        'label': '',
        'font-family': 'Segoe UI, system-ui, sans-serif',
        'font-size': '11px',
        'color': '#c7f9eb',
        'text-background-color': '#0f1822',
        'text-background-opacity': 0.92,
        'text-background-padding': 4,
        'text-border-radius': 8,
        'text-rotation': 'autorotate',
        'opacity': 0.72,
        'overlay-opacity': 0
      }
    },
    {
      selector: 'edge.labelled, edge:selected',
      style: {
        'label': 'data(label)',
        'width': 2.5,
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)',
        'opacity': 1
      }
    },
    {
      selector: 'edge.neighbor',
      style: {
        'width': 3,
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)',
        'opacity': 1
      }
    },
    {
      selector: '.muted',
      style: { 'opacity': 0.14 }
    },
    {
      selector: '.hiddenType',
      style: { 'display': 'none' }
    },
    {
      selector: '.hiddenRelation',
      style: { 'display': 'none' }
    }
  ],
  layout: {
    name: 'cose',
    animate: true,
    animationDuration: 450,
    randomize: true,
    nodeRepulsion: () => 18000,
    idealEdgeLength: () => 195,
    edgeElasticity: () => 110,
    gravity: 0.16,
    fit: true,
    padding: 72
  },
  minZoom: 0.18,
  maxZoom: 4,
  wheelSensitivity: 0.24
});

const searchInput = document.getElementById('search');
const btnFit = document.getElementById('btnFit');
const btnReset = document.getElementById('btnReset');
const btnContext = document.getElementById('btnContext');
const btnLabels = document.getElementById('btnLabels');
const typeLegend = document.getElementById('typeLegend');
const relationLegend = document.getElementById('relationLegend');
const inspectorEmpty = document.getElementById('inspectorEmpty');
const inspectorBody = document.getElementById('inspectorBody');
const nodeTitle = document.getElementById('nodeTitle');
const nodeMeta = document.getElementById('nodeMeta');
const nodeDegree = document.getElementById('nodeDegree');
const nodeType = document.getElementById('nodeType');
const outgoingList = document.getElementById('outgoingList');
const incomingList = document.getElementById('incomingList');
const openNodeBtn = document.getElementById('openNodeBtn');
const inspectorNote = document.getElementById('inspectorNote');

function esc(text){
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function runLayout(randomize = false){
  cy.layout({
    name: 'cose',
    animate: true,
    animationDuration: 420,
    randomize,
    nodeRepulsion: () => 18000,
    idealEdgeLength: () => 195,
    edgeElasticity: () => 110,
    gravity: 0.16,
    fit: true,
    padding: 72
  }).run();
}

function focusNode(id, center = true){
  const node = cy.getElementById(id);
  if (!node || !node.length) return;
  cy.elements().removeClass('muted neighbor');
  node.select();
  const neighborhood = node.closedNeighborhood();
  neighborhood.removeClass('muted');
  neighborhood.connectedEdges().addClass('neighbor');
  neighborhood.connectedNodes().not(node).addClass('neighbor');
  cy.elements().not(neighborhood).addClass('muted');
  if (center) cy.animate({ fit: { eles: neighborhood, padding: 72 }, duration: 280 });
  renderInspector(node);
  selectedNodeId = id;
  vscode.postMessage({ command: 'saveState', state: { selectedNodeId: id } });
}

function renderLinkSection(title, items){
  if (!items.length) {
    return '<h2 class="section-heading">' + esc(title) + '</h2><div class="empty-copy">No relationships in this graph slice.</div>';
  }
  return '<h2 class="section-heading">' + esc(title) + '</h2>' + items.map((item) => (
    '<div class="link-row">' +
      '<div class="link-main">' +
        '<div class="link-label">' + esc(item.label) + '</div>' +
        '<div class="link-sub">' + esc(item.id) + ' · ' + esc(item.type) + '</div>' +
      '</div>' +
      '<div class="link-edge">' + esc(item.edge) + '</div>' +
    '</div>'
  )).join('');
}

function renderInspector(node){
  if (!node || !node.length) {
    inspectorBody.hidden = true;
    inspectorEmpty.hidden = false;
    return;
  }
  const data = node.data();
  const outgoing = node.outgoers('edge').map((edge) => {
    const target = edge.target().data();
    return { id: target.id, label: target.label, type: target.type, edge: edge.data('label') };
  }).sort((a,b) => a.label.localeCompare(b.label));
  const incoming = node.incomers('edge').map((edge) => {
    const source = edge.source().data();
    return { id: source.id, label: source.label, type: source.type, edge: edge.data('label') };
  }).sort((a,b) => a.label.localeCompare(b.label));

  inspectorEmpty.hidden = true;
  inspectorBody.hidden = false;
  nodeTitle.textContent = data.label;
  nodeMeta.textContent = data.id + ' · ' + data.type;
  nodeDegree.textContent = data.degree + ' connection' + (data.degree === 1 ? '' : 's');
  nodeType.textContent = data.type;
  outgoingList.innerHTML = renderLinkSection('Outgoing', outgoing);
  incomingList.innerHTML = renderLinkSection('Incoming', incoming);
  inspectorNote.textContent = data.isContext
    ? 'This is the active note in the editor. Use the graph to understand its immediate relationship cluster.'
    : 'This node is selected in the graph. Double-click it to isolate its neighborhood, or open it in the editor.';
  openNodeBtn.onclick = () => vscode.postMessage({ command: 'openNode', id: data.id });
}

function applyTypeFilter(nextType){
  activeType = nextType;
  document.querySelectorAll('.type-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.type === nextType);
  });
  cy.nodes().forEach((node) => {
    const matches = !nextType || node.data('type') === nextType;
    node.toggleClass('hiddenType', !matches);
  });
  cy.edges().forEach((edge) => {
    const visible = !edge.source().hasClass('hiddenType') && !edge.target().hasClass('hiddenType');
    edge.toggleClass('hiddenType', !visible);
  });
  cy.fit(cy.elements(':visible'), 54);
}

function applyRelationFilter(nextRelation){
  activeRelation = nextRelation;
  document.querySelectorAll('.relation-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.relation === nextRelation);
  });
  cy.edges().forEach((edge) => {
    const matches = !nextRelation || edge.data('label') === nextRelation;
    edge.toggleClass('hiddenRelation', !matches);
  });
  cy.nodes().forEach((node) => {
    const visible = !node.connectedEdges(':visible').empty();
    if (!nextRelation) {
      node.removeClass('hiddenRelation');
      return;
    }
    node.toggleClass('hiddenRelation', !visible);
  });
  cy.fit(cy.elements(':visible'), 54);
}

function applySearch(term){
  const q = String(term || '').trim().toLowerCase();
  if (!q) {
    cy.elements().removeClass('muted neighbor');
    if (selectedNodeId && cy.getElementById(selectedNodeId).length) {
      focusNode(selectedNodeId, false);
      return;
    }
    if (selectedNodeId) renderInspector(cy.getElementById(selectedNodeId));
    return;
  }
  cy.elements().removeClass('neighbor');
  cy.elements().addClass('muted');
  const matches = cy.nodes().filter((node) => {
    const data = node.data();
    return data.id.toLowerCase().includes(q)
      || data.label.toLowerCase().includes(q)
      || data.type.toLowerCase().includes(q);
  });
  matches.removeClass('muted');
  matches.connectedEdges().removeClass('muted');
  matches.connectedEdges().connectedNodes().removeClass('muted');
  matches.connectedEdges().addClass('neighbor');
  matches.connectedEdges().connectedNodes().addClass('neighbor');
  if (matches.length) {
    const first = matches[0];
    first.select();
    renderInspector(first);
    cy.animate({ fit: { eles: matches.closedNeighborhood(), padding: 90 }, duration: 260 });
  }
}

cy.on('tap', 'node', (event) => {
  focusNode(event.target.id());
});

cy.on('dbltap', 'node', (event) => {
  const node = event.target;
  cy.elements().addClass('muted');
  node.closedNeighborhood().removeClass('muted');
  focusNode(node.id(), false);
});

cy.on('tap', (event) => {
  if (event.target !== cy) return;
  if (searchInput.value.trim()) return;
  cy.elements().removeClass('muted neighbor');
  cy.elements().unselect();
  selectedNodeId = null;
  renderInspector(null);
  vscode.postMessage({ command: 'saveState', state: { selectedNodeId: null } });
});

document.querySelectorAll('.type-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const next = activeType === chip.dataset.type ? null : chip.dataset.type;
    document.querySelectorAll('.type-chip').forEach((item) => item.classList.remove('active'));
    if (next) chip.classList.add('active');
    applyTypeFilter(next);
  });
});

document.querySelectorAll('.relation-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const next = activeRelation === chip.dataset.relation ? null : chip.dataset.relation;
    document.querySelectorAll('.relation-chip').forEach((item) => item.classList.remove('active'));
    if (next) chip.classList.add('active');
    applyRelationFilter(next);
  });
});

document.querySelectorAll('.node-list-item').forEach((item) => {
  item.addEventListener('click', () => focusNode(item.dataset.node));
});

searchInput.addEventListener('input', () => applySearch(searchInput.value));
btnFit.addEventListener('click', () => cy.fit(cy.elements(':visible'), 54));
btnReset.addEventListener('click', () => {
  searchInput.value = '';
  activeType = null;
  activeRelation = null;
  document.querySelectorAll('.type-chip').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll('.relation-chip').forEach((item) => item.classList.remove('active'));
  cy.elements().removeClass('muted hiddenType hiddenRelation labelled neighbor');
  btnLabels.classList.remove('active');
  labelsVisible = false;
  runLayout(true);
});
btnLabels.addEventListener('click', () => {
  labelsVisible = !labelsVisible;
  btnLabels.classList.toggle('active', labelsVisible);
  cy.edges().toggleClass('labelled', labelsVisible);
});
btnContext.addEventListener('click', () => {
  if (!SUMMARY.contextId) return;
  focusNode(SUMMARY.contextId);
});

if (selectedNodeId && cy.getElementById(selectedNodeId).length) {
  focusNode(selectedNodeId, true);
} else if (SUMMARY.contextId && cy.getElementById(SUMMARY.contextId).length) {
  focusNode(SUMMARY.contextId, true);
} else if (TOP_NODES.length) {
  focusNode(TOP_NODES[0].id, true);
}
</script>
</body>
</html>`;
}

function buildEmptyHtml() {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{
  display:flex;
  align-items:center;
  justify-content:center;
  background:var(--vscode-editor-background,#11141a);
  color:var(--vscode-descriptionForeground,#91a0b5);
  font-family:'Segoe UI',system-ui,sans-serif;
}
.empty{
  max-width:380px;
  text-align:center;
  padding:24px;
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#293241) 80%, transparent);
  border-radius:18px;
  background:color-mix(in srgb, var(--vscode-editorWidget-background,#161d28) 94%, transparent);
}
.eyebrow{
  font-size:11px;
  font-weight:700;
  letter-spacing:.12em;
  text-transform:uppercase;
  margin-bottom:10px;
  color:var(--vscode-descriptionForeground,#8da2bc);
}
h1{margin:0 0 10px;font-size:24px;color:var(--vscode-editor-foreground,#eef2f7)}
p{margin:0;line-height:1.6}
</style></head><body>
  <div class="empty">
    <div class="eyebrow">Yamlink graph</div>
    <h1>No nodes matched this graph query</h1>
    <p>Broaden the query, remove a strict filter, or run the graph on a note whose yamlink-graph block targets a denser part of the vault.</p>
  </div>
</body></html>`;
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = {
    openGraphPanel,
    refreshGraphPanel,
    parseGraphBlocks,
    buildGraphModel
};
