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

    _contextNodeId = extractCanonicalIdFromFrontmatter(contextText || documentText);
    if (!blocks) {
        lastBlocks = null;
        panel.title = 'Yamlink Graph';
        panel.webview.html = buildEmptyHtml('no-block');
        panel.reveal(vscode.ViewColumn.Beside, false);
        return;
    }

    lastBlocks = blocks;
    renderGraph(blocks);
    panel.reveal(vscode.ViewColumn.Beside, false);
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
        panel.webview.html = buildEmptyHtml('no-results');
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
        '#3e7cb1', '#2f9d8f', '#d98f3d', '#c96d78',
        '#6f78d8', '#5a95b8', '#7aa05a', '#9b7fbe'
    ];
    const shapes = ['ellipse', 'round-rectangle', 'diamond', 'hexagon', 'tag', 'vee'];
    const relationPalette = [
        '#5f8d85', '#627db6', '#a88459', '#a2767d',
        '#7c79ad', '#6d8fa2', '#82946e', '#907ba9'
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
    const adjacency = new Map();
    for (const edge of edges) {
        degreeMap.set(edge.data.source, (degreeMap.get(edge.data.source) || 0) + 1);
        degreeMap.set(edge.data.target, (degreeMap.get(edge.data.target) || 0) + 1);
        if (!adjacency.has(edge.data.source)) adjacency.set(edge.data.source, new Set());
        if (!adjacency.has(edge.data.target)) adjacency.set(edge.data.target, new Set());
        adjacency.get(edge.data.source).add(edge.data.target);
        adjacency.get(edge.data.target).add(edge.data.source);
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

    const relationSummaries = {};
    for (const edge of edges) {
        const field = edge.data.label;
        relationSummaries[field] = relationSummaries[field] || { incoming: 0, outgoing: 0 };
        relationSummaries[field].outgoing++;
    }

    const nodeDetails = {};
    for (const row of rows) {
        const id = row.id;
        const outgoing = edges
            .filter((edge) => edge.data.source === id)
            .map((edge) => {
                const target = rowById.get(edge.data.target);
                return {
                    id: edge.data.target,
                    label: target?.fields?.name || target?.fields?.title || edge.data.target,
                    type: target?.nodeType || 'unknown',
                    edge: edge.data.label,
                    color: edge.data.color
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label));

        const incoming = edges
            .filter((edge) => edge.data.target === id)
            .map((edge) => {
                const source = rowById.get(edge.data.source);
                return {
                    id: edge.data.source,
                    label: source?.fields?.name || source?.fields?.title || edge.data.source,
                    type: source?.nodeType || 'unknown',
                    edge: edge.data.label,
                    color: edge.data.color
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label));

        const relationCounts = new Map();
        const connectedTypes = new Map();
        for (const item of outgoing.concat(incoming)) {
            relationCounts.set(item.edge, (relationCounts.get(item.edge) || 0) + 1);
            connectedTypes.set(item.type, (connectedTypes.get(item.type) || 0) + 1);
        }

        nodeDetails[id] = {
            id,
            label: row.fields.name || row.fields.title || id,
            type: row.nodeType || 'unknown',
            degree: degreeMap.get(id) || 0,
            isContext: id === contextNodeId,
            outgoing,
            incoming,
            relationSummary: Array.from(relationCounts.entries())
                .map(([field, count]) => ({ field, count, color: relationColors[field] }))
                .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field))
                .slice(0, 6),
            connectedTypes: Array.from(connectedTypes.entries())
                .map(([type, count]) => ({ type, count, color: typeColors[type], shape: typeShapes[type] }))
                .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
                .slice(0, 6)
        };
    }

    const unvisited = new Set(rows.map((row) => row.id));
    let largestCluster = [];
    while (unvisited.size) {
        const [start] = unvisited;
        const queue = [start];
        const cluster = [];
        unvisited.delete(start);
        while (queue.length) {
            const current = queue.shift();
            cluster.push(current);
            const neighbors = adjacency.get(current) || new Set();
            for (const neighbor of neighbors) {
                if (!unvisited.has(neighbor)) continue;
                unvisited.delete(neighbor);
                queue.push(neighbor);
            }
        }
        if (cluster.length > largestCluster.length) largestCluster = cluster;
    }

    const primaryFocusId = contextNodeId && rowById.has(contextNodeId)
        ? contextNodeId
        : (topNodes[0]?.id || null);

    return {
        elements: [...nodes, ...edges],
        summary: {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            typeCount: types.length,
            contextId: contextNodeId || null,
            primaryFocusId,
            largestClusterSize: largestCluster.length || nodes.length
        },
        types,
        relations,
        topNodes,
        nodeDetails
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
  --yl-link:#6eb3f0;
  --yl-accent:#4fc4a0;
  --yl-warm:#d4a164;
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--yl-link) 10%, transparent), transparent 28%),
    radial-gradient(circle at bottom right, color-mix(in srgb, var(--yl-accent) 6%, transparent), transparent 30%),
    linear-gradient(180deg, color-mix(in srgb, var(--vscode-sideBar-background, #141821) 94%, #091018 6%), var(--vscode-editor-background, #11141a));
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
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--vscode-sideBar-background,#131720) 96%, transparent),
      color-mix(in srgb, var(--vscode-editorWidget-background,#171d28) 90%, transparent));
  backdrop-filter:blur(12px);
}
.title-wrap{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.eyebrow{
  font-size:10px;
  font-weight:700;
  letter-spacing:.12em;
  text-transform:uppercase;
  color:var(--yl-warm);
}
.title{
  font-size:17px;
  font-weight:700;
  line-height:1.08;
  color:var(--vscode-editor-foreground,#eef2f7);
}
.subtitle{
  color:color-mix(in srgb, var(--vscode-descriptionForeground,#92a0b3) 92%, transparent);
  font-size:11px;
}
.summary{display:flex;gap:8px;flex-wrap:wrap}
.stat{
  min-width:84px;
  padding:8px 10px;
  border-radius:16px;
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--vscode-editorWidget-background,#1a2230) 94%, transparent),
      color-mix(in srgb, var(--vscode-editor-background,#10141d) 96%, transparent));
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
  gap:6px;
  padding:7px 10px;
  border-bottom:1px solid color-mix(in srgb, var(--vscode-panel-border,#283140) 82%, transparent);
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--vscode-editorWidget-background,#171d28) 94%, transparent),
      color-mix(in srgb, var(--vscode-editor-background,#131821) 92%, transparent));
  flex-wrap:wrap;
}
.shortcut-hint{
  margin-left:auto;
  font-size:10px;
  letter-spacing:.04em;
  color:color-mix(in srgb, var(--vscode-descriptionForeground,#8da2bc) 92%, transparent);
  white-space:nowrap;
}
.shortcut-hint kbd{
  font:inherit;
  font-weight:700;
  color:var(--vscode-editor-foreground,#d7dfeb);
}
.map-key{
  width:100%;
  display:flex;
  flex-wrap:wrap;
  gap:5px;
  align-items:center;
}
.key-chip{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:3px 7px;
  border-radius:999px;
  background:color-mix(in srgb, var(--vscode-input-background,#111721) 82%, transparent);
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 70%, transparent);
  color:var(--vscode-descriptionForeground,#a2b0c4);
  font-size:10px;
}
.search{
  flex:1;
  min-width:200px;
  background:color-mix(in srgb, var(--vscode-input-background,#10151f) 92%, transparent);
  border:1px solid color-mix(in srgb, var(--vscode-input-border,#2d3543) 85%, transparent);
  border-radius:999px;
  color:var(--vscode-input-foreground,#d6dbe2);
  padding:7px 11px;
  outline:none;
}
.search:focus{
  border-color:var(--vscode-focusBorder,#4fc4a0);
  box-shadow:0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder,#4fc4a0) 55%, transparent);
}
.tool-btn{
  background:color-mix(in srgb, var(--vscode-button-secondaryBackground,var(--vscode-input-background,#111721)) 78%, transparent);
  color:var(--vscode-editor-foreground,#d7dfeb);
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 85%, transparent);
  border-radius:999px;
  padding:6px 9px;
  font:inherit;
  cursor:pointer;
  white-space:nowrap;
  transition:background-color .14s ease,border-color .14s ease,color .14s ease,transform .14s ease;
}
.tool-btn:hover,.tool-btn.active{
  color:var(--vscode-editor-foreground,#eef2f7);
  border-color:color-mix(in srgb, var(--yl-link) 64%, var(--vscode-panel-border,#2d3543));
  background:color-mix(in srgb, var(--yl-link) 16%, var(--vscode-button-secondaryBackground,transparent));
  transform:translateY(-1px);
}
.tool-btn:disabled{
  opacity:.55;
  cursor:default;
}
.graph-stage{
  position:relative;
  min-height:0;
  background:
    radial-gradient(circle at center, color-mix(in srgb, var(--vscode-textBlockQuote-background,#1a2431) 10%, transparent), transparent 50%),
    linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background,#12161d) 97%, transparent), color-mix(in srgb, var(--vscode-sideBar-background,#11151d) 98%, transparent));
}
#cy{
  position:absolute;
  inset:0;
}
.canvas-empty{
  position:absolute;
  left:16px;
  right:16px;
  bottom:16px;
  max-width:420px;
  padding:12px 14px;
  border:1px dashed color-mix(in srgb, var(--vscode-panel-border,#293241) 84%, transparent);
  border-radius:14px;
  background:color-mix(in srgb, var(--vscode-editorWidget-background,#161d28) 94%, transparent);
  color:var(--vscode-descriptionForeground,#90a1b8);
  box-shadow:0 10px 24px rgba(0,0,0,.16);
  z-index:3;
}
.canvas-empty[hidden]{display:none}
.canvas-empty-title{
  font-size:12px;
  font-weight:700;
  color:var(--vscode-editor-foreground,#eef2f7);
  margin-bottom:4px;
}
.canvas-empty-copy{
  font-size:11px;
  line-height:1.55;
}
.node-card{
  width:100%;
  padding:10px 12px;
  border-radius:14px;
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 82%, transparent);
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--vscode-editorWidget-background,#19202c) 98%, transparent),
      color-mix(in srgb, var(--vscode-editor-background,#11161d) 98%, transparent)),
    radial-gradient(circle at top right, color-mix(in srgb, var(--vscode-button-background,#0e7490) 12%, transparent), transparent 46%);
  box-shadow:0 10px 24px rgba(0,0,0,0.14);
}
.node-card[hidden]{display:none}
.node-card-header{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:10px;
  margin-bottom:8px;
}
.node-card-title{
  margin:0;
  font-size:15px;
  font-weight:700;
  color:var(--vscode-editor-foreground,#eef2f7);
}
.node-card-meta{
  margin:2px 0 0;
  font-size:11px;
  color:var(--vscode-descriptionForeground,#90a1b8);
}
.node-card-close{
  width:28px;
  height:28px;
  border-radius:999px;
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 78%, transparent);
  background:color-mix(in srgb, var(--vscode-button-secondaryBackground,var(--vscode-input-background,#111721)) 82%, transparent);
  color:var(--vscode-editor-foreground,#dde5f0);
  cursor:pointer;
  font:inherit;
}
.node-card-close:hover{
  border-color:color-mix(in srgb, var(--vscode-button-background,#0e7490) 64%, var(--vscode-panel-border,#2d3543));
  background:color-mix(in srgb, var(--vscode-button-background,#0e7490) 16%, var(--vscode-button-secondaryBackground,transparent));
}
.node-card-grid{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
  margin-bottom:8px;
}
.node-card-stat{
  padding:0;
  border:none;
  background:none;
  min-width:auto;
}
.node-card-stat-label{
  display:inline;
  font-size:10px;
  letter-spacing:.12em;
  text-transform:uppercase;
  color:var(--vscode-descriptionForeground,#90a1b8);
  margin-bottom:0;
}
.node-card-stat-value{
  display:inline;
  margin-left:6px;
  font-size:13px;
  font-weight:700;
  color:var(--vscode-editor-foreground,#eef2f7);
}
.node-card-section{
  margin-top:8px;
}
.node-card-section-title{
  margin:0 0 6px;
  font-size:10px;
  font-weight:700;
  letter-spacing:.12em;
  text-transform:uppercase;
  color:var(--vscode-descriptionForeground,#8da2bc);
}
.node-card-links{
  display:flex;
  flex-direction:column;
  gap:5px;
}
.node-card-link{
  display:grid;
  grid-template-columns:1fr auto;
  gap:8px;
  padding:7px 9px;
  border-radius:10px;
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 70%, transparent);
  background:color-mix(in srgb, var(--vscode-input-background,#111721) 88%, transparent);
}
.node-card-link-main{min-width:0}
.node-card-link-label{
  font-size:11px;
  font-weight:600;
  color:var(--vscode-editor-foreground,#eef2f7);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.node-card-link-sub{
  margin-top:2px;
  font-size:10px;
  color:var(--vscode-descriptionForeground,#90a1b8);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.node-card-actions{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-top:8px;
}
.sidebar{
  min-width:280px;
  border-left:1px solid color-mix(in srgb, var(--vscode-panel-border,#283140) 82%, transparent);
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--vscode-sideBar-background,#11161f) 99%, transparent),
      color-mix(in srgb, var(--vscode-editorWidget-background,#161c28) 99%, transparent));
  display:flex;
  flex-direction:column;
  min-height:0;
}
.sidebar-scroll{
  padding:10px;
  overflow:auto;
  display:flex;
  flex-direction:column;
  gap:8px;
}
.panel-card{
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 78%, transparent);
  border-radius:16px;
  padding:9px 10px;
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--vscode-editorWidget-background,#19202c) 99%, transparent),
      color-mix(in srgb, var(--vscode-editor-background,#11161d) 99%, transparent));
  box-shadow:0 6px 18px rgba(0,0,0,0.08);
}
.panel-card[hidden]{display:none}
.card-title{
  font-size:11px;
  font-weight:700;
  letter-spacing:.12em;
  text-transform:uppercase;
  color:var(--vscode-descriptionForeground,#8da2bc);
  margin:0 0 7px;
}
.type-grid{display:flex;flex-wrap:wrap;gap:6px}
.type-chip{
  border:none;
  background:color-mix(in srgb, var(--vscode-input-background,#111721) 92%, transparent);
  color:var(--vscode-editor-foreground,#dae3ef);
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 78%, transparent);
  border-radius:999px;
  padding:4px 8px;
  font:inherit;
  display:flex;
  align-items:center;
  gap:7px;
  cursor:pointer;
  transition:background-color .14s ease,border-color .14s ease,color .14s ease,transform .14s ease;
}
.type-chip:hover,.type-chip.active{
  border-color:color-mix(in srgb, var(--yl-link) 64%, var(--vscode-panel-border,#2d3543));
  background:color-mix(in srgb, var(--yl-link) 12%, var(--vscode-input-background,#111721));
  transform:translateY(-1px);
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
.node-list{display:flex;flex-direction:column;gap:5px}
.node-list-item{
  width:100%;
  text-align:left;
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 78%, transparent);
  border-radius:14px;
  background:color-mix(in srgb, var(--vscode-input-background,#111721) 92%, transparent);
  color:var(--vscode-editor-foreground,#dde5f0);
  padding:7px 9px;
  cursor:pointer;
  transition:background-color .14s ease,border-color .14s ease,transform .14s ease;
}
.node-list-item:hover{
  border-color:color-mix(in srgb, var(--yl-link) 70%, var(--vscode-panel-border,#2d3543));
  background:color-mix(in srgb, var(--yl-link) 8%, var(--vscode-input-background,#111721));
  transform:translateY(-1px);
}
.node-list-item.active{
  border-color:color-mix(in srgb, var(--yl-link) 78%, var(--vscode-panel-border,#2d3543));
  background:color-mix(in srgb, var(--yl-link) 12%, var(--vscode-input-background,#111721));
}
.relation-chip:hover,.relation-chip.active{
  border-color:color-mix(in srgb, var(--yl-warm) 62%, var(--vscode-panel-border,#2d3543));
  background:color-mix(in srgb, var(--yl-warm) 13%, var(--vscode-input-background,#111721));
}
.node-list-main{display:block;font-weight:600;margin-bottom:3px}
.node-list-meta{display:block;color:var(--vscode-descriptionForeground,#90a1b8);font-size:11px}
.selected-node-card .node-card{
  padding:0;
  border:none;
  background:none;
  box-shadow:none;
}
.selected-node-card .node-card-header{
  margin-bottom:8px;
}
.selected-node-card .node-card-grid{
  margin-bottom:8px;
}
.selected-node-card .node-card-actions .tool-btn{
  padding:5px 9px;
}
.link-list{display:flex;flex-direction:column;gap:8px}
.mini-chip-row{
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  margin-bottom:8px;
}
.mini-chip{
  display:inline-flex;
  align-items:center;
  gap:7px;
  padding:4px 8px;
  border-radius:999px;
  border:1px solid color-mix(in srgb, var(--vscode-panel-border,#2d3543) 78%, transparent);
  background:color-mix(in srgb, var(--vscode-editorWidget-background,#1b2230) 90%, transparent);
  color:var(--vscode-editor-foreground,#dde5f0);
  font-size:10px;
}
.mini-chip strong{
  font-weight:700;
  color:var(--vscode-editor-foreground,#eef2f7);
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
  .shortcut-hint{width:100%;margin-left:0}
}
@media (max-width: 720px){
  .shell{grid-template-columns:minmax(0,1fr)}
  .toolbar{grid-column:1;flex-wrap:wrap}
  .summary{width:100%}
  .sidebar{display:none}
  .node-card-grid{
    grid-template-columns:repeat(3, minmax(0,1fr));
  }
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
        <button class="tool-btn" id="btnFit" title="Fit visible graph (F)">Fit</button>
        <button class="tool-btn" id="btnReset" title="Reset graph (R)">Reset</button>
        <button class="tool-btn" id="btnContext" title="Focus active note (N)"${model.summary.contextId ? '' : ' disabled'}>Focus note</button>
        <button class="tool-btn" id="btnLabels" title="Toggle edge labels (L)">Edge labels</button>
        <div class="shortcut-hint">Shortcuts: <kbd>/</kbd> search · <kbd>F</kbd> fit · <kbd>R</kbd> reset · <kbd>L</kbd> labels · <kbd>Esc</kbd> clear</div>
      </div>
      <div class="graph-stage" id="graphStage" tabindex="0">
        <div id="cy"></div>
        <div class="canvas-empty" id="canvasEmpty" hidden>
          <div class="canvas-empty-title" id="canvasEmptyTitle">Nothing visible right now</div>
          <div class="canvas-empty-copy" id="canvasEmptyCopy">Clear the current search or filter to bring the graph back into view.</div>
        </div>
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

        <section class="panel-card selected-node-card" id="selectedNodeCard" hidden>
          <h2 class="card-title">Selected node</h2>
          <div class="node-card" id="nodeCard" hidden>
            <div class="node-card-header">
              <div>
                <h3 class="node-card-title" id="cardTitle"></h3>
                <p class="node-card-meta" id="cardMeta"></p>
              </div>
              <button class="node-card-close" id="cardCloseBtn" aria-label="Clear selection">×</button>
            </div>
            <div class="node-card-grid">
              <div class="node-card-stat">
                <span class="node-card-stat-label">Connections</span>
                <span class="node-card-stat-value" id="cardDegree"></span>
              </div>
              <div class="node-card-stat">
                <span class="node-card-stat-label">Outbound</span>
                <span class="node-card-stat-value" id="cardOutgoing"></span>
              </div>
              <div class="node-card-stat">
                <span class="node-card-stat-label">Inbound</span>
                <span class="node-card-stat-value" id="cardIncoming"></span>
              </div>
            </div>
            <div class="mini-chip-row" id="cardRelations"></div>
            <div class="mini-chip-row" id="cardTypes"></div>
            <div class="node-card-section">
              <div class="node-card-links" id="cardLinks"></div>
            </div>
            <div class="node-card-actions">
              <button class="tool-btn" id="cardOpenNodeBtn">Open note</button>
            </div>
          </div>
        </section>

        <section class="panel-card" id="mostConnectedCard">
          <h2 class="card-title">Most connected</h2>
          <div class="node-list" id="topNodes">${topNodesHtml}</div>
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
const NODE_DETAILS = ${JSON.stringify(model.nodeDetails)};
const INITIAL_STATE = ${JSON.stringify(panelState || {})};

let labelsVisible = false;
let activeType = null;
let activeRelation = null;
let selectedNodeId = SUMMARY.contextId
  ? (INITIAL_STATE.selectedNodeId || SUMMARY.contextId || null)
  : null;
const themeStyles = getComputedStyle(document.body);
const THEME = {
  text: themeStyles.getPropertyValue('--vscode-editor-foreground').trim() || '#dde5f0',
  mutedText: themeStyles.getPropertyValue('--vscode-descriptionForeground').trim() || '#90a1b8',
  panel: themeStyles.getPropertyValue('--vscode-editorWidget-background').trim() || '#1b2230',
  border: themeStyles.getPropertyValue('--vscode-panel-border').trim() || '#2d3543',
  accent: themeStyles.getPropertyValue('--vscode-button-background').trim() || '#0e7490',
  input: themeStyles.getPropertyValue('--vscode-input-background').trim() || '#111721'
};

function rgba(hex, alpha){
  const value = (hex || '').replace('#', '').trim();
  if (value.length !== 6) return 'rgba(17,23,33,' + alpha + ')';
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

const LAYOUT_CONFIG = {
  nodeRepulsion: 32000,
  idealEdgeLength: 265,
  edgeElasticity: 150,
  gravity: 0.1,
  componentSpacing: 180,
  spacingFactor: 1.24,
  fitPadding: 76,
  focusPadding: 88,
  searchPadding: 104
};

function createLayoutOptions(randomize = false){
  return {
    name: 'cose',
    animate: true,
    animationDuration: 460,
    randomize,
    nodeRepulsion: () => LAYOUT_CONFIG.nodeRepulsion,
    idealEdgeLength: () => LAYOUT_CONFIG.idealEdgeLength,
    edgeElasticity: () => LAYOUT_CONFIG.edgeElasticity,
    componentSpacing: LAYOUT_CONFIG.componentSpacing,
    spacingFactor: LAYOUT_CONFIG.spacingFactor,
    nodeDimensionsIncludeLabels: true,
    gravity: LAYOUT_CONFIG.gravity,
    fit: true,
    padding: LAYOUT_CONFIG.fitPadding
  };
}

const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: ELEMENTS,
  style: [
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)',
        'shape': 'data(shape)',
        'width': 'mapData(degree, 0, 8, 44, 76)',
        'height': 'mapData(degree, 0, 8, 44, 76)',
        'label': 'data(label)',
        'color': THEME.text,
        'font-family': 'Segoe UI, system-ui, sans-serif',
        'font-size': '12px',
        'font-weight': 600,
        'text-wrap': 'wrap',
        'text-max-width': 128,
        'text-valign': 'bottom',
        'text-margin-y': 10,
        'text-background-color': rgba(THEME.panel, 0.94),
        'text-background-opacity': 1,
        'text-background-padding': 4,
        'text-border-radius': 12,
        'border-width': 3,
        'border-color': rgba(THEME.border, 0.8),
        'shadow-blur': 16,
        'shadow-color': rgba(THEME.input, 0.35),
        'shadow-opacity': 0.28,
        'shadow-offset-y': 5,
        'overlay-opacity': 0
      }
    },
    {
      selector: 'node[?isContext]',
      style: {
        'border-width': 4,
        'border-color': THEME.text,
        'shadow-blur': 20,
        'shadow-color': THEME.accent,
        'shadow-opacity': 0.26
      }
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 5,
        'border-color': THEME.accent,
        'shadow-blur': 28,
        'shadow-color': THEME.accent,
        'shadow-opacity': 0.52,
        'z-index': 12
      }
    },
    {
      selector: 'node.neighbor',
      style: {
        'border-width': 4,
        'border-color': THEME.accent,
        'shadow-blur': 20,
        'shadow-color': THEME.accent,
        'shadow-opacity': 0.22,
        'z-index': 9
      }
    },
    {
      selector: 'edge',
      style: {
        'curve-style': 'unbundled-bezier',
        'width': 1.55,
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.96,
        'label': '',
        'font-family': 'Segoe UI, system-ui, sans-serif',
        'font-size': '11px',
        'font-weight': 600,
        'color': THEME.text,
        'text-background-color': rgba(THEME.panel, 0.94),
        'text-background-opacity': 0.94,
        'text-background-padding': 4,
        'text-border-radius': 8,
        'text-rotation': 'autorotate',
        'opacity': 0.42,
        'overlay-opacity': 0
      }
    },
    {
      selector: 'edge.labelled, edge:selected, edge.neighbor',
      style: {
        'label': 'data(label)',
        'width': 2.95,
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)',
        'arrow-scale': 1.18,
        'text-background-color': rgba(THEME.panel, 0.98),
        'text-background-opacity': 0.98,
        'text-background-padding': 5,
        'opacity': 0.96,
        'z-index': 7
      }
    },
    {
      selector: 'edge.neighbor',
      style: {
        'width': 3.1,
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)',
        'source-endpoint': 'outside-to-node',
        'target-endpoint': 'outside-to-node',
        'opacity': 1,
        'z-index': 6
      }
    },
    {
      selector: '.muted',
      style: { 'opacity': 0.09 }
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
  layout: createLayoutOptions(true),
  minZoom: 0.18,
  maxZoom: 4,
  wheelSensitivity: 0.24
});

const searchInput = document.getElementById('search');
const btnFit = document.getElementById('btnFit');
const btnReset = document.getElementById('btnReset');
const btnContext = document.getElementById('btnContext');
const btnLabels = document.getElementById('btnLabels');
const graphStage = document.getElementById('graphStage');
const canvasEmpty = document.getElementById('canvasEmpty');
const canvasEmptyTitle = document.getElementById('canvasEmptyTitle');
const canvasEmptyCopy = document.getElementById('canvasEmptyCopy');
const typeLegend = document.getElementById('typeLegend');
const relationLegend = document.getElementById('relationLegend');
const selectedNodeCard = document.getElementById('selectedNodeCard');
const mostConnectedCard = document.getElementById('mostConnectedCard');
const nodeCard = document.getElementById('nodeCard');
const cardTitle = document.getElementById('cardTitle');
const cardMeta = document.getElementById('cardMeta');
const cardDegree = document.getElementById('cardDegree');
const cardOutgoing = document.getElementById('cardOutgoing');
const cardIncoming = document.getElementById('cardIncoming');
const cardRelations = document.getElementById('cardRelations');
const cardTypes = document.getElementById('cardTypes');
const cardLinks = document.getElementById('cardLinks');
const cardOpenNodeBtn = document.getElementById('cardOpenNodeBtn');
const cardCloseBtn = document.getElementById('cardCloseBtn');

function esc(text){
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function runLayout(randomize = false){
  cy.layout(createLayoutOptions(randomize)).run();
}

function getPrimaryFocusId(){
  if (selectedNodeId && cy.getElementById(selectedNodeId).length) return selectedNodeId;
  if (SUMMARY.contextId && cy.getElementById(SUMMARY.contextId).length) return SUMMARY.contextId;
  return null;
}

function getVisibleGraphElements(){
  const visible = cy.elements(':visible');
  return visible.length ? visible : cy.elements();
}

function syncSelectedNodeUi(id){
  document.querySelectorAll('.node-list-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.node === id);
  });
}

function setSelectedNode(id){
  selectedNodeId = id || null;
  syncSelectedNodeUi(selectedNodeId);
  vscode.postMessage({ command: 'saveState', state: { selectedNodeId: selectedNodeId } });
}

function syncEdgeContext(){
  cy.edges().removeClass('neighbor');
  if (labelsVisible) {
    cy.edges().addClass('labelled');
  } else {
    cy.edges().removeClass('labelled');
  }
  if (!selectedNodeId) return;
  const node = cy.getElementById(selectedNodeId);
  if (!node || !node.length) return;
  const connected = node.connectedEdges();
  connected.addClass('neighbor');
  if (!labelsVisible) connected.addClass('labelled');
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
  if (center) cy.animate({ fit: { eles: neighborhood, padding: LAYOUT_CONFIG.focusPadding }, duration: 320 });
  setSelectedNode(id);
  syncEdgeContext();
  renderInspector(node);
}

function renderChipRow(items, formatter){
  if (!items.length) return '<div class="empty-copy">Nothing notable in this graph slice yet.</div>';
  return items.map((item) => formatter(item)).join('');
}

function renderCardLinks(items){
  if (!items.length) {
    return '<div class="empty-copy">No visible relationships in this graph slice.</div>';
  }
  return items.slice(0, 4).map((item) => (
    '<div class="node-card-link">' +
      '<div class="node-card-link-main">' +
        '<div class="node-card-link-label">' + esc(item.label) + '</div>' +
        '<div class="node-card-link-sub">' + esc(item.edge) + ' · ' + esc(item.type) + '</div>' +
      '</div>' +
      '<span class="type-dot" style="background:' + esc(item.color || THEME.accent) + '"></span>' +
    '</div>'
  )).join('');
}

function renderNodeCard(data, details){
  if (!data) {
    nodeCard.hidden = true;
    selectedNodeCard.hidden = true;
    mostConnectedCard.hidden = false;
    return;
  }
  selectedNodeCard.hidden = false;
  mostConnectedCard.hidden = true;
  const outgoing = details.outgoing || [];
  const incoming = details.incoming || [];
  const keyLinks = outgoing.slice(0, 1).concat(incoming.slice(0, 1));
  nodeCard.hidden = false;
  cardTitle.textContent = data.label;
  cardMeta.textContent = data.type + ' · ' + data.id;
  cardDegree.textContent = String(data.degree);
  cardOutgoing.textContent = String(outgoing.length);
  cardIncoming.textContent = String(incoming.length);
  cardRelations.innerHTML = renderChipRow(details.relationSummary || [], (item) => (
    '<span class="mini-chip"><span class="type-dot" style="background:' + esc(item.color || THEME.accent) + '"></span>' +
    esc(item.field) + ' <strong>' + esc(item.count) + '</strong></span>'
  ));
  cardTypes.innerHTML = renderChipRow(details.connectedTypes || [], (item) => (
    '<span class="mini-chip"><span class="type-dot" data-shape="' + esc(item.shape || 'ellipse') + '" style="background:' + esc(item.color || THEME.accent) + '"></span>' +
    esc(item.type) + ' <strong>' + esc(item.count) + '</strong></span>'
  ));
  cardLinks.innerHTML = renderCardLinks(keyLinks);
  cardOpenNodeBtn.onclick = () => vscode.postMessage({ command: 'openNode', id: data.id });
}

function renderInspector(node){
  if (!node || !node.length) {
    renderNodeCard(null, null);
    syncSelectedNodeUi(null);
    return;
  }
  const data = node.data();
  const details = NODE_DETAILS[data.id] || { outgoing: [], incoming: [], relationSummary: [], connectedTypes: [] };
  renderNodeCard(data, details);
  syncSelectedNodeUi(data.id);
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
  cy.fit(getVisibleGraphElements(), LAYOUT_CONFIG.fitPadding - 28);
  updateCanvasEmptyState();
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
  cy.fit(getVisibleGraphElements(), LAYOUT_CONFIG.fitPadding - 28);
  updateCanvasEmptyState();
}

function applySearch(term){
  const q = String(term || '').trim().toLowerCase();
  if (!q) {
    cy.elements().removeClass('muted neighbor');
    if (selectedNodeId && cy.getElementById(selectedNodeId).length) {
      focusNode(selectedNodeId, false);
      updateCanvasEmptyState();
      return;
    }
    syncEdgeContext();
    if (selectedNodeId) renderInspector(cy.getElementById(selectedNodeId));
    updateCanvasEmptyState();
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
  if (!labelsVisible) {
    cy.edges().removeClass('labelled');
    matches.connectedEdges().addClass('labelled');
  }
  if (matches.length) {
    const first = matches[0];
    first.select();
    renderInspector(first);
    setSelectedNode(first.id());
    cy.animate({ fit: { eles: matches.closedNeighborhood(), padding: LAYOUT_CONFIG.searchPadding }, duration: 280 });
  }
  updateCanvasEmptyState();
}

cy.on('tap', 'node', (event) => {
  focusNode(event.target.id());
});

cy.on('select', 'node', (event) => {
  renderInspector(event.target);
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
  setSelectedNode(null);
  syncEdgeContext();
  renderInspector(null);
});

cy.on('layoutstop', () => {
  if (!selectedNodeId || nodeCard.hidden) return;
  const node = cy.getElementById(selectedNodeId);
  if (node && node.length) positionNodeCard(node);
});

cardCloseBtn.addEventListener('click', () => {
  cy.elements().removeClass('muted neighbor');
  cy.elements().unselect();
  setSelectedNode(null);
  syncEdgeContext();
  renderInspector(null);
  updateCanvasEmptyState();
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

function resetGraphView(){
  searchInput.value = '';
  activeType = null;
  activeRelation = null;
  document.querySelectorAll('.type-chip').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll('.relation-chip').forEach((item) => item.classList.remove('active'));
  cy.elements().removeClass('muted hiddenType hiddenRelation labelled neighbor');
  btnLabels.classList.remove('active');
  labelsVisible = false;
  setSelectedNode(null);
  renderInspector(null);
  runLayout(true);
}

function updateCanvasEmptyState(){
  const visibleNodes = cy.nodes(':visible');
  if (visibleNodes.length > 0) {
    canvasEmpty.hidden = true;
    return;
  }

  let title = 'Nothing visible right now';
  let copy = 'Clear the current search or filter to bring the graph back into view.';
  if (searchInput.value.trim()) {
    title = 'No nodes match this search';
    copy = 'Try a broader name, id, or type search, or press Esc to clear the current graph state.';
  } else if (activeType || activeRelation) {
    title = 'Current filters hide this graph';
    copy = 'Reset the graph or relax the active type/relation filter to see nodes again.';
  }

  canvasEmptyTitle.textContent = title;
  canvasEmptyCopy.textContent = copy;
  canvasEmpty.hidden = false;
}

searchInput.addEventListener('input', () => applySearch(searchInput.value));
btnFit.addEventListener('click', () => cy.fit(getVisibleGraphElements(), LAYOUT_CONFIG.fitPadding - 28));
btnReset.addEventListener('click', resetGraphView);
btnLabels.addEventListener('click', () => {
  labelsVisible = !labelsVisible;
  btnLabels.classList.toggle('active', labelsVisible);
  syncEdgeContext();
});
btnContext.addEventListener('click', () => {
  if (!SUMMARY.contextId) return;
  focusNode(SUMMARY.contextId);
});

function handleGraphKeydown(event) {
  const target = event.target;
  const tagName = target && target.tagName ? target.tagName.toLowerCase() : '';
  const editable = target && (target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select');

  if (event.key === 'Escape') {
    if (searchInput.value.trim() || selectedNodeId || activeType || activeRelation || labelsVisible) {
      event.preventDefault();
      resetGraphView();
    }
    return;
  }

  if (!editable && event.key === '/') {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }

  if (editable) return;

  const key = String(event.key || '').toLowerCase();
  if (key === 'f') {
    event.preventDefault();
    btnFit.click();
    return;
  }
  if (key === 'r') {
    event.preventDefault();
    btnReset.click();
    return;
  }
  if (key === 'l') {
    event.preventDefault();
    btnLabels.click();
    return;
  }
  if (key === 'n' && SUMMARY.contextId && !btnContext.disabled) {
    event.preventDefault();
    btnContext.click();
    return;
  }
  if (key === 'o' && selectedNodeId) {
    event.preventDefault();
    vscode.postMessage({ command: 'openNode', id: selectedNodeId });
  }
}

window.addEventListener('keydown', handleGraphKeydown, true);
document.addEventListener('keydown', handleGraphKeydown, true);
graphStage.addEventListener('pointerdown', () => graphStage.focus());

const initialFocusId = getPrimaryFocusId();
if (initialFocusId) {
  cy.one('layoutstop', () => {
    focusNode(initialFocusId, true);
    updateCanvasEmptyState();
  });
} else {
  cy.one('layoutstop', () => {
    cy.fit(getVisibleGraphElements(), LAYOUT_CONFIG.fitPadding);
    renderInspector(null);
    updateCanvasEmptyState();
  });
}
</script>
</body>
</html>`;
}

function buildEmptyHtml(reason = 'no-results') {
    const states = {
        'no-block': {
            title: 'No yamlink-graph block in this note',
            copy: 'Add a ```yamlink-graph fence with one or more !view queries, then open the graph again to map that part of the vault.'
        },
        'no-results': {
            title: 'No nodes matched this graph query',
            copy: 'Broaden the query, remove a strict filter, or run the graph on a note whose yamlink-graph block targets a denser part of the vault.'
        }
    };
    const state = states[reason] || states['no-results'];
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
    <h1>${esc(state.title)}</h1>
    <p>${esc(state.copy)}</p>
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
