// src/features/entityHub.js
// Entity Hub — rich backlink panel for a single focused node
//
// Opens beside the active editor whenever a Yamlink node is focused.
// Groups all inbound edges by relation field and renders each group
// as a compact, sortable table using the same CSS vocabulary as viewPanel.js.
//
// Data sources (all in-memory — zero disk reads):
//   getBacklinks(id)  → [{ field, sourceId }]
//   getFieldsCache()  → id → parsed frontmatter fields
//   getIndex()        → id → filePath  (for click-to-open)
//   getPathIndex()    → filePath → id  (to resolve active file)
//
// Trigger: onDidChangeActiveTextEditor (wired in extension.js)
// Browser JS: src/features/entityHubScript.js

'use strict';

const vscode  = require('vscode');
const crypto  = require('crypto');
const { getBacklinks }              = require('../core/graph');
const { getIndex, getPathIndex, getFieldsCache } = require('../core/index');

// Fields suppressed from section tables — always shown as the id column or noise
const SKIP_FIELDS = new Set(['id', 'created']);

let panel   = null;
let _extUri = null;
let _lastId = null; // track last rendered node so refresh() can re-render

// ─────────────────────────────────────────────────────────────────
// Public API — called from extension.js
// ─────────────────────────────────────────────────────────────────

// Open or refresh the hub for the currently active editor.
// Call this on every onDidChangeActiveTextEditor event.
function syncEntityHub(context) {
    _extUri = context.extensionUri;

    const editor = vscode.window.activeTextEditor;

    // Not a markdown file — show empty state without closing the panel
    if (!editor || editor.document.languageId !== 'markdown') {
        if (panel) renderEmpty('—');
        return;
    }

    const filePath = editor.document.uri.fsPath;
    const id       = getPathIndex().get(filePath) ?? null;

    // Not a Yamlink node
    if (!id) {
        if (panel) renderEmpty('not a node');
        return;
    }

    _lastId = id;
    _ensurePanel(context);
    renderHub(id);
}

// Called after every buildIndex() so the panel reflects fresh data
function refreshEntityHub() {
    if (panel && _lastId) renderHub(_lastId);
}

// ─────────────────────────────────────────────────────────────────
// Internal — panel lifecycle
// ─────────────────────────────────────────────────────────────────

function _ensurePanel(context) {
    if (panel) return;

    panel = vscode.window.createWebviewPanel(
        'yamlink.entityHub',
        'Hub',
        vscode.ViewColumn.Beside,
        {
            enableScripts:           true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'src', 'features')
            ]
        }
    );

    panel.webview.onDidReceiveMessage(function (msg) {
        if (msg.command === 'openNode') {
            const fp = getIndex().get(msg.id);
            if (fp) {
                vscode.workspace.openTextDocument(fp).then(function (doc) {
                    vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
                });
            }
        }
    }, null, context.subscriptions);

    panel.onDidDispose(function () { panel = null; }, null, context.subscriptions);
}

// ─────────────────────────────────────────────────────────────────
// renderHub — group backlinks and build full HTML
// ─────────────────────────────────────────────────────────────────

function renderHub(nodeId) {
    if (!panel) return;

    const backlinks   = getBacklinks(nodeId);
    const fieldsCache = getFieldsCache();
    const idIndex     = getIndex();

    panel.title = nodeId + ' · hub';

    // ── Group backlinks by field, skip stale edges ──
    const groups = new Map(); // field → [{ sourceId, fields, filePath }]

    for (const { field, sourceId } of backlinks) {
        const filePath = idIndex.get(sourceId);
        if (!filePath) continue; // source deleted since last index — skip gracefully

        const fields = fieldsCache.get(sourceId);
        if (!fields) continue;

        if (!groups.has(field)) groups.set(field, []);
        groups.get(field).push({ sourceId, fields, filePath });
    }

    if (groups.size === 0) {
        panel.webview.html = buildEmptyHtml(nodeId);
        return;
    }

    // ── Sort: relational fields first, body links last ──
    const sortedGroups = new Map(
        [...groups.entries()].sort(function (a, b) {
            if (a[0] === 'body') return 1;
            if (b[0] === 'body') return -1;
            return a[0].localeCompare(b[0]);
        })
    );

    panel.webview.html = buildHtml(nodeId, sortedGroups, idIndex);
}

function renderEmpty(label) {
    if (!panel) return;
    panel.title = 'Hub';
    panel.webview.html = buildEmptyHtml(label);
}

// ─────────────────────────────────────────────────────────────────
// buildHtml — full webview document
// ─────────────────────────────────────────────────────────────────

function buildHtml(nodeId, groups, idIndex) {
    const scriptUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(_extUri, 'src', 'features', 'entityHubScript.js')
    );
    const nonce = crypto.randomBytes(16).toString('hex');
    const csp   = panel.webview.cspSource;

    const totalLinks   = [...groups.values()].reduce((n, rows) => n + rows.length, 0);
    const allIds       = [...idIndex.keys()];
    const idOpts       = allIds.map(id => '<option value="' + esc(id) + '">').join('');
    const sectionHtml  = [...groups.entries()].map(([field, rows]) => buildSection(field, rows)).join('\n');

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};">
<style>
/* ── Reset ── */
*{box-sizing:border-box;margin:0;padding:0}

/* ── Base ── */
body{
    background:var(--vscode-editor-background,#141414);
    color:var(--vscode-editor-foreground,#c8c8c8);
    font-family:'IBM Plex Sans',sans-serif;
    font-size:13px;
    height:100vh;
    display:flex;
    flex-direction:column;
    overflow:hidden;
}

/* ── Hub header ── */
.hub-header{
    display:flex;
    align-items:baseline;
    gap:12px;
    padding:13px 20px 11px;
    background:var(--vscode-sideBar-background,#1a1a1a);
    border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);
    flex-shrink:0;
}
.hub-node{
    font-family:'IBM Plex Mono',monospace;
    font-size:13px;
    color:var(--vscode-textLink-foreground,#6eb3f0);
    cursor:pointer;
    letter-spacing:.02em;
}
.hub-node:hover{text-decoration:underline}
.hub-meta{
    font-family:'IBM Plex Mono',monospace;
    font-size:10px;
    color:#555;
    letter-spacing:.04em;
}

/* ── Search bar ── */
.hub-searchbar{
    display:flex;
    align-items:center;
    gap:8px;
    padding:7px 20px;
    background:var(--vscode-sideBar-background,#1a1a1a);
    border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);
    flex-shrink:0;
}
.hub-search{
    flex:1;
    background:var(--vscode-editor-background,#141414);
    border:1px solid var(--vscode-panel-border,#2a2a2a);
    border-radius:2px;
    padding:4px 10px;
    font-family:'IBM Plex Mono',monospace;
    font-size:11px;
    color:var(--vscode-editor-foreground,#c8c8c8);
    outline:none;
}
.hub-search:focus{border-color:var(--vscode-textLink-foreground,#6eb3f0)}
.hub-search::placeholder{color:#555}
.hub-searchcount{
    font-family:'IBM Plex Mono',monospace;
    font-size:10px;
    color:#555;
    white-space:nowrap;
}
.hub-searchcount strong{color:#4fc4a0}

/* ── Scrollable body ── */
.hub-body{
    flex:1;
    overflow-y:auto;
    padding-bottom:8px;
}
.hub-body::-webkit-scrollbar{width:4px}
.hub-body::-webkit-scrollbar-thumb{
    background:var(--vscode-panel-border,#2a2a2a);
    border-radius:2px;
}

/* ── Sections ── */
.hub-section{
    border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);
}
.hub-section-header{
    display:flex;
    align-items:center;
    gap:9px;
    padding:9px 20px;
    cursor:pointer;
    user-select:none;
    background:var(--vscode-sideBar-background,#1a1a1a);
}
.hub-section-header:hover{background:rgba(255,255,255,.02)}
.hub-chevron{
    font-size:8px;
    color:#555;
    transition:transform .12s;
    display:inline-block;
    width:10px;
    flex-shrink:0;
}
.hub-section.open .hub-chevron{transform:rotate(90deg)}
.hub-field{
    font-family:'IBM Plex Mono',monospace;
    font-size:11px;
    color:var(--vscode-textLink-foreground,#6eb3f0);
    letter-spacing:.04em;
}
.hub-field-dim{
    font-family:'IBM Plex Mono',monospace;
    font-size:11px;
    color:#555;
    letter-spacing:.04em;
    font-style:italic;
}
.hub-section-body-links .hub-section-header{
    background:transparent;
}
.hub-count{
    font-family:'IBM Plex Mono',monospace;
    font-size:9px;
    color:#555;
    background:rgba(255,255,255,.06);
    border-radius:10px;
    padding:1px 7px;
}
.hub-section-body{
    display:none;
    padding:2px 20px 14px;
}
.hub-section.open .hub-section-body{display:block}

/* ── Tables — same vocabulary as viewPanel ── */
table{width:100%;border-collapse:collapse;margin-top:8px}
thead th.col-id{width:1%}
thead th{
    font-family:'IBM Plex Mono',monospace;
    font-size:10px;
    text-transform:uppercase;
    letter-spacing:.1em;
    color:#555;
    padding:7px 10px;
    text-align:left;
    border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);
    white-space:nowrap;
    user-select:none;
    position:sticky;
    top:0;
    background:var(--vscode-editor-background,#141414);
    z-index:1;
    cursor:pointer;
}
thead th:hover{color:#888}
thead th.sorted{color:#4fc4a0}
.sarr{opacity:.4;margin-left:3px;font-size:9px}
thead th.sorted .sarr{opacity:1}
tbody tr{border-bottom:1px solid var(--vscode-panel-border,#2a2a2a)}
tbody tr:hover{background:rgba(255,255,255,.03)}
tbody td{padding:8px 10px;font-size:12px;vertical-align:middle}
.cell-id{
    font-family:'IBM Plex Mono',monospace;
    font-size:11px;
    color:var(--vscode-textLink-foreground,#6eb3f0);
    white-space:nowrap;
    cursor:pointer;
}
.cell-id:hover{text-decoration:underline}
.cell-empty{color:#555;font-style:italic}
.cell-rel{
    font-family:'IBM Plex Mono',monospace;
    font-size:11px;
    color:#4fc4a0;
    background:rgba(79,196,160,.08);
    border:1px solid rgba(79,196,160,.2);
    border-radius:2px;
    padding:2px 7px;
    display:inline-block;
    white-space:nowrap;
    cursor:pointer;
    margin:1px 2px 1px 0;
}
.cell-rel:hover{background:rgba(79,196,160,.16)}

/* ── Live bar ── */
.live-bar{
    display:flex;
    align-items:center;
    justify-content:flex-end;
    gap:6px;
    padding:5px 20px;
    border-top:1px solid var(--vscode-panel-border,#2a2a2a);
    background:var(--vscode-sideBar-background,#1a1a1a);
    font-family:'IBM Plex Mono',monospace;
    font-size:10px;
    color:#555;
    flex-shrink:0;
}
.ldot{
    width:6px;
    height:6px;
    border-radius:50%;
    background:#4fc4a0;
    animation:pulse 2s infinite;
}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
</style>
</head><body>

<datalist id="yids">${idOpts}</datalist>

<div class="hub-header">
    <span class="hub-node" data-id="${esc(nodeId)}">${esc(nodeId)}</span>
    <span class="hub-meta">${totalLinks} inbound · ${groups.size} relation${groups.size !== 1 ? 's' : ''}</span>
</div>

<div class="hub-searchbar">
    <input class="hub-search" id="hubsearch" type="text" placeholder="Search all sections…">
    <span class="hub-searchcount"><strong id="visible-count">${totalLinks}</strong> of ${totalLinks}</span>
</div>

<div class="hub-body">
${sectionHtml}
</div>

<div class="live-bar">
    <div class="ldot"></div>
    <span id="jsstatus" style="color:#555">js loading…</span>
</div>

<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
}

// ─────────────────────────────────────────────────────────────────
// buildSection — one collapsible group (field + table of source nodes)
// ─────────────────────────────────────────────────────────────────

function buildSection(field, rows) {
    const isBody = field === 'body';

    // Derive columns from the union of fields across all rows in this group.
    // id is always first; SKIP_FIELDS are suppressed; remainder sorted alpha.
    const fieldSet = new Set();
    for (const { fields } of rows) {
        for (const key of Object.keys(fields)) {
            if (!SKIP_FIELDS.has(key)) fieldSet.add(key);
        }
    }
    const columns = ['id', ...Array.from(fieldSet).sort()];

    const headerCells = columns.map(function (col) {
        var cls = col === 'id' ? ' class="col-id"' : '';
        return '<th' + cls + ' data-col="' + esc(col) + '">' + esc(col) + ' <span class="sarr">↕</span></th>';
    }).join('');

    const bodyRows = rows.map(function ({ sourceId, fields }) {
        const cells = columns.map(function (col) {
            if (col === 'id') {
                return '<td class="cell-id" data-id="' + esc(sourceId) + '">' + esc(sourceId) + '</td>';
            }
            const val = fields[col] || '';
            if (!val) return '<td class="cell-empty">—</td>';

            const rels = [...val.matchAll(/\[\[([^\]]+)\]\]/g)]
                .filter(function (m) { return m[1].trim().length > 0; });
            if (rels.length === 1) {
                const rid = rels[0][1].trim();
                return '<td><span class="cell-rel" data-id="' + esc(rid) + '">' + esc(rid) + '</span></td>';
            }
            if (rels.length > 1) {
                return '<td>' + rels.map(function (m) {
                    return '<span class="cell-rel" data-id="' + esc(m[1]) + '">' + esc(m[1]) + '</span>';
                }).join('') + '</td>';
            }
            return '<td>' + esc(val) + '</td>';
        }).join('');

        return '<tr>' + cells + '</tr>';
    }).join('');

    // body links: start collapsed, label dimmed to signal lower priority
    const sectionClass = isBody ? 'hub-section hub-section-body-links' : 'hub-section open';
    const fieldLabel   = isBody
        ? '<span class="hub-field hub-field-dim">body mentions</span>'
        : '<span class="hub-field">' + esc(field) + '</span>';

    return [
        '<div class="' + sectionClass + '" data-field="' + esc(field) + '">',
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">&#9658;</span>',
        '        ' + fieldLabel,
        '        <span class="hub-count">' + rows.length + '</span>',
        '    </div>',
        '    <div class="hub-section-body">',
        '        <table>',
        '            <thead><tr>' + headerCells + '</tr></thead>',
        '            <tbody>' + bodyRows + '</tbody>',
        '        </table>',
        '    </div>',
        '</div>'
    ].join('\n');
}

// ─────────────────────────────────────────────────────────────────
// buildEmptyHtml — shown when node has no backlinks or is not a node
// ─────────────────────────────────────────────────────────────────

function buildEmptyHtml(label) {
    return [
        '<!DOCTYPE html><html><head><meta charset="UTF-8">',
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">',
        '<style>',
        '*{margin:0;padding:0;box-sizing:border-box}',
        'body{background:var(--vscode-editor-background,#141414);color:#888;font-family:\'IBM Plex Mono\',monospace;height:100vh;display:flex;flex-direction:column}',
        '.hub-header{padding:13px 20px 11px;background:var(--vscode-sideBar-background,#1a1a1a);border-bottom:1px solid #2a2a2a;font-size:13px;color:#555;letter-spacing:.02em}',
        '.center{flex:1;display:flex;align-items:center;justify-content:center;font-size:11px;color:#555}',
        '</style></head><body>',
        '<div class="hub-header">' + esc(label) + '</div>',
        '<div class="center">No inbound links to this node</div>',
        '</body></html>'
    ].join('\n');
}

// ─────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

module.exports = { syncEntityHub, refreshEntityHub };