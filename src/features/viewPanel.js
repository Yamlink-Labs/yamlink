// src/features/viewPanel.js
// VS Code wiring: webview lifecycle, message routing, HTML shell + CSS
// Query logic lives in src/engine/query.js
// Browser JS lives in src/features/viewPanelScript.js

const vscode = require('vscode');
const fs     = require('fs');
const path   = require('path');
const { getIndex, buildIndex } = require('../core/index');
const { parseAllViewQueries, parseViewQuery, runQuery, buildQueryString } = require('../engine/query');

let panel              = null;
let lastQuery          = null;
let onCompleteCallback = null;
let _extUri            = null;
let _panelState        = null; // { activeTab, searches: [], sorts: [] } — persisted across renders

// ─────────────────────────────────────────────────────────────────
// openViewPanel — entry point called from extension.js
// ─────────────────────────────────────────────────────────────────
function openViewPanel(context, documentText, onComplete) {
    const queries = parseAllViewQueries(documentText);
    if (!queries) return;

    lastQuery = queries;
    _extUri   = context.extensionUri;
    if (onComplete) onCompleteCallback = onComplete;

    // Build index if empty (e.g. first open after reload, before any save)
    if (getIndex().size === 0 && vscode.workspace.workspaceFolders) {
        buildIndex(vscode.workspace.workspaceFolders);
    }

    if (!panel) {
        _panelState = null; // fresh state for new panel

        panel = vscode.window.createWebviewPanel(
            'yamlink.viewPanel',
            'Yamlink View',
            vscode.ViewColumn.Beside,
            {
                enableScripts:           true,
                retainContextWhenHidden: true,
                localResourceRoots:      [vscode.Uri.joinPath(context.extensionUri, 'src', 'features')]
            }
        );

        panel.webview.onDidReceiveMessage(function (msg) {
            if (msg.command === 'openNode') {
                const fp = getIndex().get(msg.id);
                if (fp) vscode.workspace.openTextDocument(fp)
                    .then(doc => vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false }));
            }
            if (msg.command === 'editCell') {
                const ok = writeFieldValue(msg.filePath, msg.field, msg.value);
                if (ok && typeof onCompleteCallback === 'function') onCompleteCallback();
            }
            // Webview sends its current UI state just before a re-render wipes it
            if (msg.command === 'saveState') {
                _panelState = msg.state;
            }
        }, null, context.subscriptions);

        panel.onDidDispose(function () { panel = null; _panelState = null; }, null, context.subscriptions);

        panel.onDidChangeViewState(function (e) {
            if (e.webviewPanel.visible) renderPanel(lastQuery);
        }, null, context.subscriptions);
    }

    renderPanel(queries);
}

function refreshViewPanel() {
    if (panel && lastQuery) renderPanel(lastQuery);
}

// ─────────────────────────────────────────────────────────────────
// renderPanel — rebuilds full HTML and sets panel.webview.html
// Nonce generated here in Node — safe, never inside the webview
// ─────────────────────────────────────────────────────────────────
function renderPanel(queries) {
    if (!panel) return;

    const queryList = Array.isArray(queries) ? queries : [queries];
    const first     = queryList[0];

    panel.title = queryList.length > 1
        ? 'View · ' + queryList.length + ' blocks'
        : first.label || (first.type === '*' ? 'View · all nodes' : 'View · ' + first.type);

    // External script URI — loaded as trusted vscode-webview-resource
    const scriptUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(_extUri, 'src', 'features', 'viewPanelScript.js')
    );

    // Nonce generated in Node — interpolated into HTML before browser sees it
    const nonce = require('crypto').randomBytes(16).toString('hex');
    const csp   = panel.webview.cspSource;

    if (getIndex().size === 0) {
        panel.webview.html = buildEmptyHtml(queryList, scriptUri, nonce, csp);
        setTimeout(function () {
            if (panel && getIndex().size > 0) renderPanel(queries);
        }, 800);
        return;
    }

    panel.webview.html = buildHtml(queryList, scriptUri, nonce, csp, _panelState);
}

// ─────────────────────────────────────────────────────────────────
// buildHtml — HTML shell + CSS + data tables + external script tag
// ─────────────────────────────────────────────────────────────────
function buildHtml(queryList, scriptUri, nonce, csp, panelState) {
    const allIds = [...getIndex().keys()];
    const idOpts = allIds.map(id => '<option value="' + esc(id) + '">').join('');

    const activeTab = (panelState && panelState.activeTab != null) ? panelState.activeTab : 0;

    const tabBtns = queryList.map(function (q, i) {
        const label = esc(q.label || (q.type === '*' ? 'All nodes' : q.type));
        return '<button class="tab-btn' + (i === activeTab ? ' active' : '') + '" data-tab="' + i + '">' + label + '</button>';
    }).join('');

    const panels = queryList.map(function (q, i) {
        const tabState = panelState && panelState.tabs ? (panelState.tabs[i] || {}) : {};
        try   { return buildPanel(q, i, activeTab, tabState); }
        catch (e) { return '<div class="tab-panel" data-tab="' + i + '" style="display:' + (i===activeTab?'flex':'none') + ';padding:20px;color:#e5a96a;">Error: ' + esc(e.message) + '</div>'; }
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--vscode-editor-background,#141414);color:var(--vscode-editor-foreground,#c8c8c8);font-family:'IBM Plex Sans',sans-serif;font-size:13px;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.tabbar{display:flex;background:var(--vscode-sideBar-background,#1a1a1a);border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);flex-shrink:0;overflow-x:auto}
.tabbar::-webkit-scrollbar{height:0}
.tab-btn{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.04em;color:#888;background:none;border:none;border-bottom:2px solid transparent;padding:10px 18px;cursor:pointer;white-space:nowrap;flex-shrink:0}
.tab-btn:hover{color:var(--vscode-editor-foreground,#c8c8c8)}
.tab-btn.active{color:#4fc4a0;border-bottom-color:#4fc4a0}
.tab-panel{flex:1;flex-direction:column;overflow:hidden;min-height:0;display:none}
.tab-panel.active{display:flex}
.filterbar{display:flex;align-items:center;gap:6px;padding:7px 20px;border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);background:var(--vscode-sideBar-background,#1a1a1a);flex-shrink:0;flex-wrap:wrap}
.flabel{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.1em}
.chip{font-family:'IBM Plex Mono',monospace;font-size:10px;padding:3px 8px;border-radius:2px;border:1px solid var(--vscode-panel-border,#2a2a2a);color:#888;cursor:pointer;background:none;display:flex;align-items:center;gap:5px}
.chip:hover,.chip.active{border-color:#4fc4a0;color:#4fc4a0;background:rgba(79,196,160,.08)}
.chip-n{background:rgba(255,255,255,.08);border-radius:10px;padding:0 5px;font-size:9px;color:#555}
.chip.active .chip-n{color:#4fc4a0}
.fsearch{margin-left:auto;background:var(--vscode-editor-background,#141414);border:1px solid var(--vscode-panel-border,#2a2a2a);border-radius:2px;padding:4px 10px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--vscode-editor-foreground,#c8c8c8);width:180px;outline:none}
.fsearch:focus{border-color:var(--vscode-textLink-foreground,#6eb3f0)}
.fsearch::placeholder{color:#555}
.fcount{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#555;white-space:nowrap;padding-left:8px;border-left:1px solid var(--vscode-panel-border,#2a2a2a)}
.fcount strong{color:#4fc4a0}
.table-wrap{flex:1;overflow:auto;padding:0 20px 20px}
.table-wrap::-webkit-scrollbar{width:4px;height:4px}
.table-wrap::-webkit-scrollbar-thumb{background:var(--vscode-panel-border,#2a2a2a);border-radius:2px}
table{width:100%;border-collapse:collapse;margin-top:12px}
thead th{font-family:'IBM Plex Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#555;padding:8px 10px;text-align:left;border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);cursor:pointer;white-space:nowrap;user-select:none;position:sticky;top:0;background:var(--vscode-editor-background,#141414);z-index:1}
thead th.col-id{width:1%}
thead th:hover{color:#888}
thead th.sorted{color:#4fc4a0}
.sarr{opacity:.4;margin-left:3px;font-size:9px}
thead th.sorted .sarr{opacity:1}
tbody tr{border-bottom:1px solid var(--vscode-panel-border,#2a2a2a)}
tbody tr:hover{background:rgba(255,255,255,.03)}
tbody td{padding:9px 10px;font-size:12px;vertical-align:middle}
.cell-id{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--vscode-textLink-foreground,#6eb3f0);white-space:nowrap;cursor:pointer}
.cell-id:hover{text-decoration:underline}
.cell-empty{color:#555;font-style:italic}
.cell-rel{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#4fc4a0;background:rgba(79,196,160,.08);border:1px solid rgba(79,196,160,.2);border-radius:2px;padding:2px 7px;display:inline-block;white-space:nowrap;cursor:pointer;margin:1px 2px 1px 0}
.cell-rel:hover{background:rgba(79,196,160,.16)}
.empty-state{text-align:center;color:#555;font-style:italic;padding:40px 0;font-size:12px}
.cell-editable{cursor:text}
.cell-editable:hover:not(.editing){background:rgba(255,255,255,.025)}
.editing{background:rgba(79,196,160,.06)!important}
.cell-saved{animation:cellflash .7s ease-out forwards}
@keyframes cellflash{0%{background:rgba(79,196,160,.28)}100%{background:transparent}}
.cell-input{background:var(--vscode-sideBar-background,#1a1a1a);border:1px solid #4fc4a0;border-radius:2px;color:var(--vscode-editor-foreground,#c8c8c8);font-family:'IBM Plex Sans',sans-serif;font-size:12px;padding:4px 8px;width:100%;outline:none;box-sizing:border-box}
.live-bar{display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:5px 20px;border-top:1px solid var(--vscode-panel-border,#2a2a2a);background:var(--vscode-sideBar-background,#1a1a1a);font-family:'IBM Plex Mono',monospace;font-size:10px;color:#555;flex-shrink:0}
.ldot{width:6px;height:6px;border-radius:50%;background:#4fc4a0;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
</style>
</head><body>
<datalist id="yids">${idOpts}</datalist>
<div class="tabbar">${tabBtns}</div>
${panels}
<div class="live-bar"><div class="ldot"></div><span id="jsstatus" style="color:#555">js loading…</span></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
}

function buildEmptyHtml(queryList, scriptUri, nonce, csp) {
    const tabBtns = queryList.map(function (q, i) {
        const label = esc(q.label || (q.type === '*' ? 'All nodes' : q.type));
        return '<button class="tab-btn' + (i===0?' active':'') + '">' + label + '</button>';
    }).join('');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:var(--vscode-editor-background,#141414);color:#888;font-family:'IBM Plex Mono',monospace;height:100vh;display:flex;flex-direction:column}.tabbar{display:flex;background:var(--vscode-sideBar-background,#1a1a1a);border-bottom:1px solid #2a2a2a}.tab-btn{font-size:11px;padding:10px 18px;border:none;border-bottom:2px solid transparent;color:#888;background:none}.tab-btn.active{color:#4fc4a0;border-bottom-color:#4fc4a0}.center{flex:1;display:flex;align-items:center;justify-content:center;font-size:12px;gap:8px;flex-direction:column}.hint{font-size:11px;color:#4fc4a0;opacity:.6}</style>
</head><body><div class="tabbar">${tabBtns}</div>
<div class="center"><p>Index not ready</p><span class="hint">Save any .md file · panel refreshes automatically</span></div>
</body></html>`;
}

// ─────────────────────────────────────────────────────────────────
// buildPanel — one tab panel's HTML (filterbar + table)
// ─────────────────────────────────────────────────────────────────
function buildPanel(query, idx, activeTab, tabState) {
    const { rows, columns, types } = runQuery(query);
    const isActive    = idx === activeTab;
    const savedSearch = (tabState && tabState.search) ? tabState.search : '';
    const savedSort   = (tabState && tabState.sort)   ? tabState.sort   : null;

    // Apply saved sort to row order before rendering
    if (savedSort) {
        rows.sort(function (a, b) {
            var av = (a.fields[savedSort.col] || a.id || '').toLowerCase();
            var bv = (b.fields[savedSort.col] || b.id || '').toLowerCase();
            return savedSort.asc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
    }

    const headerCells = columns.map(function (col) {
        var isSorted = savedSort && savedSort.col === col;
        var cls      = (col === 'id' ? 'col-id' : '') + (isSorted ? (col === 'id' ? ' sorted' : 'sorted') : '');
        var arrow    = isSorted ? (savedSort.asc ? '↑' : '↓') : '↕';
        return '<th' + (cls.trim() ? ' class="' + cls.trim() + '"' : '') + ' data-col="' + esc(col) + '">' + esc(col) + ' <span class="sarr">' + arrow + '</span></th>';
    }).join('');

    const bodyRows = rows.length > 0
        ? rows.map(function (row) {
            const cells = columns.map(function (col) {
                if (col === 'id') return '<td class="cell-id" data-id="' + esc(row.id) + '">' + esc(row.id) + '</td>';
                const val = row.fields[col] || '';
                if (!val) return '<td class="cell-empty cell-editable" data-filepath="' + esc(row.filePath) + '" data-field="' + esc(col) + '" data-value="">—</td>';
                const rels = [...val.matchAll(/\[\[([^\]]+)\]\]/g)];
                if (rels.length === 1) {
                    const rid = rels[0][1];
                    return '<td class="cell-editable" data-filepath="' + esc(row.filePath) + '" data-field="' + esc(col) + '" data-value="' + esc(rid) + '" data-relation="true"><span class="cell-rel" data-id="' + esc(rid) + '">' + esc(rid) + '</span></td>';
                }
                if (rels.length > 1) {
                    return '<td title="Multi-value field — edit the source file to modify">' + rels.map(function (m) { return '<span class="cell-rel" data-id="' + esc(m[1]) + '">' + esc(m[1]) + '</span>'; }).join('') + '</td>';
                }
                return '<td class="cell-text cell-editable" data-filepath="' + esc(row.filePath) + '" data-field="' + esc(col) + '" data-value="' + esc(val) + '">' + esc(val) + '</td>';
            }).join('');
            var hidden = savedSearch && !(
                row.id.toLowerCase().includes(savedSearch.toLowerCase()) ||
                Object.values(row.fields).join(' ').toLowerCase().includes(savedSearch.toLowerCase())
            );
            return '<tr data-type="' + esc(row.nodeType) + '"' + (hidden ? ' style="display:none"' : '') + '>' + cells + '</tr>';
        }).join('')
        : '<tr><td colspan="' + columns.length + '" class="empty-state">No nodes found.</td></tr>';

    var visibleCount = savedSearch
        ? rows.filter(function(r) {
            return r.id.toLowerCase().includes(savedSearch.toLowerCase()) ||
                   Object.values(r.fields).join(' ').toLowerCase().includes(savedSearch.toLowerCase());
          }).length
        : rows.length;

    const chips = '<button class="chip active" data-filter="all">All <span class="chip-n">' + rows.length + '</span></button>'
        + types.map(function (t) {
            return '<button class="chip" data-filter="type:' + t + '">' + esc(t) + ' <span class="chip-n">' + rows.filter(function(r){return r.nodeType===t;}).length + '</span></button>';
        }).join('');

    return '<div class="tab-panel' + (isActive ? ' active' : '') + '" data-tab="' + idx + '" style="display:' + (isActive ? 'flex' : 'none') + '">'
        + '<div class="filterbar"><span class="flabel">Filter</span>' + chips
        + '<input class="fsearch" type="text" placeholder="Search…" value="' + esc(savedSearch) + '">'
        + '<span class="fcount"><strong>' + visibleCount + '</strong> result' + (visibleCount !== 1 ? 's' : '') + '</span></div>'
        + '<div class="table-wrap"><table><thead><tr>' + headerCells + '</tr></thead><tbody>' + bodyRows + '</tbody></table></div>'
        + '</div>';
}

// ─────────────────────────────────────────────────────────────────
// writeFieldValue — writes a field value back to frontmatter on disk
// ─────────────────────────────────────────────────────────────────
function writeFieldValue(filePath, field, newValue) {
    if (field === 'id') return false;
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) { return false; }
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const d1 = content.indexOf('---');
    if (d1 === -1) return false;
    const d2 = content.indexOf('---', d1 + 3);
    if (d2 === -1) return false;
    const before = content.slice(0, d1 + 3);
    const fm     = content.slice(d1 + 3, d2);
    const after  = content.slice(d2);
    const re     = new RegExp('^([ \\t]*' + escRe(field) + ':[ \\t]*)(.*)$', 'm');
    if (re.test(fm)) {
        try { fs.writeFileSync(filePath, before + fm.replace(re, '$1' + newValue) + after, 'utf8'); return true; }
        catch (e) { return false; }
    }
    // Field absent — append before closing ---
    const newFm = fm.replace(/\n?$/, '\n' + field + ': ' + newValue + '\n');
    try { fs.writeFileSync(filePath, before + newFm + after, 'utf8'); return true; }
    catch (e) { return false; }
}

function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escRe(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { openViewPanel, refreshViewPanel, parseAllViewQueries, parseViewQuery, writeFieldValue };