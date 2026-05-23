'use strict';

const vscode = require('vscode');
const { perfTracker } = require('../../runtime/performanceTracker');
const { getIndex, getVaultGeneration } = require('../../core/indexService');
const { runQuery, buildQueryString } = require('../../engine/query');
const { getCachedQueryResult } = require('../../engine/queryCache');
const { getSchema } = require('../../registries/schemaRegistry');
const { isDateLike, getTodayIsoLocal } = require('../../core/date');

function repairUiText(text) {
    return String(text ?? '')
        .replace(/Â·/g, '-')
        .replace(/â€¢/g, '&bull;')
        .replace(/â†©/g, '&#8617;')
        .replace(/â€”/g, '-')
        .replace(/â€™/g, "'")
        .replace(/â€¦/g, '...');
}

function renderPanel({ panel, queries, extensionUri, panelState, preferredTab = null, contextNodeId = null }) {
    if (!panel) return;
    const queryList = Array.isArray(queries) ? queries : [queries];
    const first = queryList[0];
    panel.title = queryList.length > 1
        ? `View · ${queryList.length} blocks`
        : (first.label || (first.type === '*' ? 'View · all nodes' : 'View · ' + first.type));
    panel.title = repairUiText(panel.title);
    const stateScriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'features', 'viewPanelStateRuntime.js'));
    const valueRuntimeScriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'features', 'viewPanelValueRuntime.js'));
    const editRuntimeScriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'features', 'viewPanelEditRuntime.js'));
    const uiRuntimeScriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'features', 'viewPanelUiRuntime.js'));
    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'features', 'viewPanelScript.js'));
    const nonce = require('crypto').randomBytes(16).toString('hex');
    const csp = panel.webview.cspSource;
    if (getIndex().size === 0) {
        panel.webview.html = repairUiText(buildEmptyHtml(queryList));
        return;
    }
    panel.webview.html = perfTracker.measureSync('view.buildHtml', {
        queryCount: queryList.length
    }, () => repairUiText(buildHtml(queryList, stateScriptUri, valueRuntimeScriptUri, editRuntimeScriptUri, uiRuntimeScriptUri, scriptUri, nonce, csp, panelState, preferredTab, contextNodeId)));
}

function buildHtml(queryList, stateScriptUri, valueRuntimeScriptUri, editRuntimeScriptUri, uiRuntimeScriptUri, scriptUri, nonce, csp, panelState, preferredTab = null, contextNodeId = null) {
    const allIds = [...getIndex().keys()];
    const idOpts = allIds.map(id => `<option value="${esc(id)}">`).join('');
    const activeTab = (preferredTab !== null && preferredTab !== undefined)
        ? Math.min(preferredTab, queryList.length - 1)
        : (panelState?.activeTab ?? 0);
    const tabBtns = queryList
        .map((q, i) => `<button class="tab-btn${i === activeTab ? ' active' : ''}" data-tab="${i}">${esc(q.label || (q.type === '*' ? 'All nodes' : q.type))}</button>`)
        .join('');
    const panels = queryList
        .map((q, i) => buildPanel(q, i, activeTab, panelState?.tabs?.[i] || {}, contextNodeId))
        .join('\n');

    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
--yl-bg:var(--vscode-editor-background,#141414);
--yl-bg-elevated:var(--vscode-sideBar-background,#1a1a1a);
--yl-bg-widget:var(--vscode-input-background,#111318);
--yl-bg-hover:var(--vscode-list-hoverBackground,rgba(255,255,255,.03));
--yl-bg-selected:var(--vscode-list-activeSelectionBackground,rgba(79,196,160,.10));
--yl-text:var(--vscode-editor-foreground,#c8c8c8);
--yl-text-muted:var(--vscode-descriptionForeground,#8b949e);
--yl-text-strong:var(--vscode-foreground,#e6edf3);
--yl-border:var(--vscode-panel-border,#2a2a2a);
--yl-border-strong:var(--vscode-input-border,#30363d);
--yl-accent:var(--vscode-textLink-foreground,#4fc4a0);
--yl-accent-strong:var(--vscode-focusBorder,#4fc4a0);
--yl-accent-contrast:var(--vscode-textLink-activeForeground,#7ae3c2);
--yl-warn:var(--vscode-editorWarning-foreground,#e5a96a);
--yl-id:color-mix(in srgb, var(--yl-accent) 62%, var(--vscode-textPreformat-foreground,#8e7df2));
--yl-toolbar-bg:color-mix(in srgb, var(--yl-bg-elevated) 86%, var(--yl-bg));
--yl-toolbar-border:color-mix(in srgb, var(--yl-border) 82%, transparent);
--yl-control-bg:color-mix(in srgb, var(--yl-bg-widget) 88%, transparent);
--yl-control-bg-hover:color-mix(in srgb, var(--yl-bg-widget) 72%, var(--yl-bg-hover));
--yl-control-border:color-mix(in srgb, var(--yl-border-strong) 82%, transparent);
--yl-control-muted:color-mix(in srgb, var(--yl-text) 76%, var(--yl-text-muted));
--yl-chip-active-bg:color-mix(in srgb, var(--yl-accent) 16%, var(--yl-bg-widget));
--yl-chip-active-border:color-mix(in srgb, var(--yl-accent) 56%, var(--yl-border-strong));
--yl-search-bg:color-mix(in srgb, var(--yl-bg-widget) 92%, var(--yl-bg));
--yl-search-border:color-mix(in srgb, var(--yl-border-strong) 88%, transparent);
--yl-success-bg:color-mix(in srgb, var(--yl-accent) 12%, transparent);
--yl-success-border:color-mix(in srgb, var(--yl-accent) 30%, transparent);
--yl-success-strong:color-mix(in srgb, var(--yl-accent) 80%, white);
--yl-warn-bg:color-mix(in srgb, var(--yl-warn) 12%, transparent);
--yl-warn-border:color-mix(in srgb, var(--yl-warn) 32%, transparent);
}
body.vscode-light{
--yl-bg-hover:color-mix(in srgb, var(--yl-accent) 4%, var(--vscode-list-hoverBackground,rgba(31,35,40,.028)));
--yl-bg-selected:color-mix(in srgb, var(--yl-accent) 9%, var(--yl-bg));
--yl-toolbar-bg:color-mix(in srgb, var(--yl-bg-elevated) 54%, white);
--yl-toolbar-border:color-mix(in srgb, var(--yl-border) 74%, transparent);
--yl-control-bg:color-mix(in srgb, var(--yl-bg-widget) 22%, white);
--yl-control-bg-hover:color-mix(in srgb, var(--yl-accent) 5%, var(--yl-bg-widget));
--yl-control-border:color-mix(in srgb, var(--yl-border-strong) 46%, transparent);
--yl-control-muted:color-mix(in srgb, var(--yl-text) 74%, var(--yl-text-muted));
--yl-chip-active-bg:color-mix(in srgb, var(--yl-accent) 11%, white);
--yl-chip-active-border:color-mix(in srgb, var(--yl-accent) 42%, var(--yl-border));
--yl-search-bg:color-mix(in srgb, var(--yl-bg-widget) 18%, white);
--yl-search-border:color-mix(in srgb, var(--yl-border-strong) 36%, transparent);
--yl-success-bg:color-mix(in srgb, var(--yl-accent) 9%, white);
--yl-success-border:color-mix(in srgb, var(--yl-accent) 28%, var(--yl-border));
--yl-success-strong:color-mix(in srgb, var(--yl-accent) 84%, black);
--yl-warn-bg:color-mix(in srgb, var(--yl-warn) 8%, white);
--yl-warn-border:color-mix(in srgb, var(--yl-warn) 24%, var(--yl-border));
}
body{background:var(--yl-bg);color:var(--yl-text);font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.tabbar{display:flex;background:var(--yl-bg-elevated);border-bottom:1px solid var(--yl-border);flex-shrink:0;overflow-x:auto}
.tab-btn{font-family:inherit;font-size:12px;color:var(--yl-text-muted);background:none;border:none;border-bottom:2px solid transparent;padding:10px 16px;cursor:pointer;white-space:nowrap}
.tab-btn.active{color:var(--yl-accent);border-bottom-color:var(--yl-accent)}
.tab-panel{flex:1;display:none;flex-direction:column;min-height:0}
.tab-panel.active{display:flex}
.view-shell{display:flex;flex-direction:column;min-height:0;flex:1}
.query-hero{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;margin:8px 16px 0;padding:8px 10px;border:1px solid color-mix(in srgb, var(--yl-toolbar-border) 82%, transparent);border-radius:10px;background:linear-gradient(180deg, color-mix(in srgb, var(--yl-toolbar-bg) 82%, transparent), color-mix(in srgb, var(--yl-bg) 98%, transparent));box-shadow:inset 0 1px 0 color-mix(in srgb, white 3%, transparent)}
.query-hero-top{display:flex;align-items:center;gap:10px;min-width:0}
.query-hero-title{font-size:12px;font-weight:700;color:var(--yl-text-strong);letter-spacing:.01em}
.query-hero-subtle{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:999px;border:1px solid var(--yl-control-border);background:var(--yl-control-bg);color:var(--yl-text-muted);font-size:11px}
.query-hero-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.query-hero-badge,.metric-card-value.badge{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:999px;border:1px solid var(--yl-control-border);background:var(--yl-control-bg);color:var(--yl-text);font-size:11px;font-weight:600}
.query-hero-query{display:flex;align-items:center;gap:8px;min-width:0;padding:6px 10px;border:1px solid var(--yl-search-border);border-radius:8px;background:linear-gradient(180deg, color-mix(in srgb, var(--yl-search-bg) 94%, transparent), color-mix(in srgb, var(--yl-bg) 98%, transparent))}
.query-hero-query-label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--yl-text-muted);flex-shrink:0}
.query-hero-query code{display:block;white-space:nowrap;overflow:auto;color:var(--yl-text-strong);font-family:Consolas,'Courier New',monospace;font-size:12px;min-width:0}
.query-hero-query code .q-from{color:var(--yl-text-muted)}
.query-hero-query code .q-where{color:var(--yl-accent);font-weight:700}
.query-hero-query code .q-sort,.query-hero-query code .q-limit{color:var(--yl-warn)}
.query-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:0;margin:8px 16px 0;padding:0 2px;border-top:1px solid color-mix(in srgb, var(--yl-toolbar-border) 62%, transparent);border-bottom:1px solid color-mix(in srgb, var(--yl-toolbar-border) 62%, transparent);background:transparent;overflow:visible}
.filterbar{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--yl-toolbar-border);background:linear-gradient(180deg, color-mix(in srgb, var(--yl-toolbar-bg) 92%, transparent), color-mix(in srgb, var(--yl-bg) 96%, transparent));flex-wrap:wrap}
.chip-group,.action-group,.status-group{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.chip-group{margin-right:4px}
.action-group{gap:7px}
.status-group{margin-left:auto;justify-content:flex-end}
.toolbar-group{display:flex;align-items:center;gap:8px;padding:8px 14px;min-width:0;position:relative;border-right:1px solid color-mix(in srgb, var(--yl-toolbar-border) 62%, transparent);border-bottom:none}
.toolbar-group:last-child{border-right:none}
.toolbar-group-label{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--yl-text-muted);flex-shrink:0}
.toolbar-group-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.toolbar-chip-stack{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.yl-icon{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;color:var(--yl-text-muted);flex-shrink:0}
.yl-icon svg{width:14px;height:14px;stroke:currentColor;stroke-width:1.45;fill:none;stroke-linecap:round;stroke-linejoin:round}
.btn,.chip,.col-move{background:var(--yl-control-bg);border:1px solid var(--yl-control-border);border-radius:999px;color:var(--yl-control-muted);padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit;transition:background-color .14s ease,border-color .14s ease,color .14s ease,transform .14s ease,box-shadow .14s ease}
.btn:hover,.chip:hover,.col-move:hover{background:var(--yl-control-bg-hover);border-color:color-mix(in srgb, var(--yl-accent) 34%, var(--yl-control-border));color:var(--yl-text);transform:translateY(-1px)}
.chip{font-weight:600}
.chip.active{background:var(--yl-chip-active-bg);border-color:var(--yl-chip-active-border);color:var(--yl-accent);box-shadow:0 0 0 1px color-mix(in srgb, var(--yl-accent) 16%, transparent) inset}
.btn.refine-btn{background:color-mix(in srgb, var(--yl-accent) 12%, var(--yl-control-bg));border-color:color-mix(in srgb, var(--yl-accent) 34%, var(--yl-control-border));color:var(--yl-text-strong)}
.btn.refine-btn:hover{background:color-mix(in srgb, var(--yl-accent) 17%, var(--yl-control-bg-hover));border-color:color-mix(in srgb, var(--yl-accent) 48%, var(--yl-control-border));color:var(--yl-accent)}
.btn.export-btn,.btn.columns-btn{color:var(--yl-text-muted)}
.btn.export-btn:hover,.btn.columns-btn:hover,.btn.reset-btn:hover{color:var(--yl-text)}
.col-move{padding:2px 6px;font-size:10px;border-radius:6px}
.col-move[disabled]{opacity:.35;cursor:default}
.fsearch{min-width:220px;background:var(--yl-search-bg);border:1px solid var(--yl-search-border);border-radius:10px;padding:6px 11px;color:var(--yl-text-strong);outline:none;font:inherit;box-shadow:inset 0 1px 0 color-mix(in srgb, var(--yl-bg) 45%, transparent)}
.fsearch:focus{border-color:color-mix(in srgb, var(--yl-accent-strong) 76%, var(--yl-search-border));box-shadow:0 0 0 1px color-mix(in srgb, var(--yl-accent) 24%, transparent), inset 0 1px 0 color-mix(in srgb, var(--yl-bg) 45%, transparent)}
.fcount{font-size:12px;color:var(--yl-text-muted);white-space:nowrap}
.metrics-strip{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:center;margin:8px 16px 0;padding:0}
.metrics-card{display:flex;align-items:center;gap:14px;min-width:0;color:var(--yl-text-muted);font-size:12px}
.quick-fields-card{display:flex;align-items:center;gap:12px;min-width:0}
.metric-card{display:flex;align-items:center;gap:6px;padding:0;border-right:none}
.metric-card-label{display:none}
.metric-card-value{font-size:12px;font-weight:700;color:var(--yl-text-strong)}
.metric-card-sub{font-size:12px;color:var(--yl-text-muted)}
.quick-fields-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-start;flex:1 1 auto;min-width:0}
.quick-fields-search{display:flex;align-items:center;justify-content:flex-end;flex:0 0 240px;min-width:0}
.quick-field-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;border:1px solid var(--yl-control-border);background:var(--yl-control-bg);color:var(--yl-text);font-size:12px;font-weight:600;cursor:pointer;transition:background-color .14s ease,border-color .14s ease,color .14s ease,transform .14s ease}
.quick-field-btn:hover{background:var(--yl-control-bg-hover);border-color:color-mix(in srgb, var(--yl-accent) 34%, var(--yl-control-border));color:var(--yl-accent);transform:translateY(-1px)}
.table-summary{display:none;padding:4px 16px 0;color:var(--yl-text-muted);font-size:12px}
.table-filters{display:none;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 16px 0}
.table-pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:8px 16px 0}
.table-pagination[hidden]{display:none}
.table-pagination-group{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.table-pagination-label{font-size:12px;color:var(--yl-text-muted)}
.table-pagination-select{background:var(--yl-search-bg);border:1px solid var(--yl-search-border);border-radius:10px;padding:5px 10px;color:var(--yl-text-strong);font:inherit}
.table-pagination-status{font-size:12px;color:var(--yl-text-muted)}
.table-pagination-btn{background:var(--yl-control-bg);border:1px solid var(--yl-control-border);border-radius:999px;color:var(--yl-control-muted);padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit;transition:background-color .14s ease,border-color .14s ease,color .14s ease,transform .14s ease,box-shadow .14s ease}
.table-pagination-btn:hover{background:var(--yl-control-bg-hover);border-color:color-mix(in srgb, var(--yl-accent) 34%, var(--yl-control-border));color:var(--yl-text);transform:translateY(-1px)}
.table-pagination-btn[disabled]{opacity:.4;cursor:default;transform:none}
.filter-pill{display:inline-flex;align-items:center;gap:8px;padding:4px 10px;border-radius:999px;border:1px solid var(--yl-control-border);background:var(--yl-control-bg);color:var(--yl-text);font-size:11px}
.filter-pill-label{color:var(--yl-text-muted);text-transform:uppercase;letter-spacing:.06em;font-size:10px}
.filter-pill button{border:none;background:none;color:var(--yl-text-muted);cursor:pointer;font:inherit;padding:0}
.filter-pill button:hover{color:var(--yl-warn)}
.no-visible-state{display:none;padding:16px;color:var(--yl-text-muted);border-bottom:1px solid var(--yl-border)}
.no-visible-state .reset-btn{margin-left:8px}
.col-menu-item{display:flex;gap:8px;align-items:center;padding:3px 0}
.table-wrap{flex:1;overflow:auto;padding:0 16px 16px}
.toolbar-menu{display:none;position:absolute;background:var(--yl-bg-widget);border:1px solid var(--yl-border-strong);border-radius:8px;padding:10px;z-index:10;max-height:240px;overflow:auto}
.table-wrap table{width:max-content;min-width:100%;border-collapse:collapse;margin-top:6px}
.table-wrap thead th{position:sticky;top:0;background:var(--yl-bg);font-size:11px;color:var(--yl-text-muted);text-transform:uppercase;letter-spacing:.08em;padding:9px 10px;text-align:left;border-bottom:1px solid var(--yl-border);white-space:nowrap;cursor:pointer;position:sticky}
.table-wrap thead th[data-col]{cursor:grab;user-select:none}
.table-wrap thead th[data-col].dragging{opacity:.45}
.table-wrap thead th[data-col].drag-over{box-shadow:inset 2px 0 0 var(--yl-accent)}
.table-wrap thead th[data-col].drag-over-after{box-shadow:inset -2px 0 0 var(--yl-accent)}
.th-head{display:flex;align-items:center;gap:8px;min-width:0}
.th-label{display:block;overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;padding-right:2px}
.th-tools{display:inline-flex;align-items:center;gap:4px;flex-shrink:0}
.th-filter-btn{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:1px solid transparent;border-radius:999px;background:transparent;color:var(--yl-text-muted);cursor:pointer;font:inherit;font-size:11px}
.th-filter-btn:hover,.th-filter-btn.active{background:var(--yl-control-bg-hover);border-color:color-mix(in srgb, var(--yl-accent) 32%, var(--yl-control-border));color:var(--yl-accent)}
.th-filter-btn.has-filter{color:var(--yl-accent)}
.th-filter-menu{display:none;position:absolute;top:calc(100% - 2px);right:8px;min-width:200px;max-width:280px;max-height:240px;overflow:auto;padding:10px;border:1px solid var(--yl-border-strong);border-radius:12px;background:var(--yl-bg-widget);box-shadow:0 12px 24px rgba(0,0,0,.24);z-index:5}
.th-filter-menu.open{display:block}
.th-filter-title{font-size:10px;color:var(--yl-text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
.th-filter-option{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;color:var(--yl-text)}
.th-filter-option input{accent-color:var(--yl-accent)}
.th-filter-empty{font-size:11px;color:var(--yl-text-muted);padding:4px 0}
.th-filter-actions{display:flex;justify-content:flex-end;margin-top:8px}
.th-filter-clear{border:none;background:none;color:var(--yl-text-muted);cursor:pointer;font:inherit;font-size:11px}
.th-filter-clear:hover{color:var(--yl-warn)}
.col-resizer{position:absolute;top:0;right:-3px;width:8px;height:100%;cursor:col-resize;z-index:2}
.col-resizer:hover,.col-resizer.active{background:color-mix(in srgb, var(--yl-accent) 28%, transparent)}
.table-wrap tbody td{padding:8px 10px;border-bottom:1px solid var(--yl-border);font-size:12px;vertical-align:middle}
.table-wrap tbody tr:hover{background:var(--yl-bg-hover)}
.cell-id{color:var(--yl-id);cursor:pointer;font-weight:600}
.cell-rel,.cell-bool{display:inline-flex;align-items:center;padding:4px 9px;border-radius:999px;white-space:nowrap;cursor:pointer;font-size:11px;font-weight:600;letter-spacing:.01em}
.cell-rel{background:linear-gradient(180deg, color-mix(in srgb, var(--yl-success-bg) 84%, transparent), color-mix(in srgb, var(--yl-accent) 6%, var(--yl-success-bg)));border:1px solid var(--yl-success-border);color:var(--yl-success-strong);box-shadow:inset 0 1px 0 color-mix(in srgb, white 45%, transparent)}
.cell-bool{border:1px solid var(--yl-success-border);background:linear-gradient(180deg, color-mix(in srgb, var(--yl-success-bg) 88%, transparent), color-mix(in srgb, var(--yl-accent) 5%, var(--yl-success-bg)));color:var(--yl-success-strong)}
.cell-bool.true{border-color:var(--yl-success-border);background:linear-gradient(180deg, color-mix(in srgb, var(--yl-success-bg) 88%, transparent), color-mix(in srgb, var(--yl-accent) 5%, var(--yl-success-bg)));color:var(--yl-success-strong)}
.cell-bool.false,.cell-bool.pending{border-color:var(--yl-warn-border);background:var(--yl-warn-bg);color:var(--yl-warn)}
.cell-bool.overdue{border-color:color-mix(in srgb, #ff6b6b 42%, var(--yl-border));background:color-mix(in srgb, #ff6b6b 12%, transparent);color:#ff9a9a}
.cell-empty{color:var(--yl-text-muted);font-style:italic}
.cell-editable{cursor:text}
.cell-input,.cell-select{width:100%;background:var(--yl-search-bg);border:1px solid color-mix(in srgb, var(--yl-accent) 44%, var(--yl-search-border));border-radius:10px;padding:6px 8px;color:var(--yl-text-strong);font:inherit;box-shadow:0 0 0 1px color-mix(in srgb, var(--yl-accent) 12%, transparent)}
.cell-selected{outline:2px solid color-mix(in srgb, var(--yl-accent) 46%, transparent);outline-offset:-2px;background:var(--yl-bg-selected)}
.cell-dirty{box-shadow:inset 0 0 0 999px color-mix(in srgb, var(--yl-accent) 8%, transparent)}
.live-bar{display:flex;justify-content:space-between;gap:8px;padding:6px 16px;border-top:1px solid var(--yl-border);background:var(--yl-bg-elevated);color:var(--yl-text-muted);font-size:11px}
.live-status{color:var(--yl-text-muted)}
.live-status.error{color:var(--yl-warn)}
.live-status.success{color:var(--yl-accent-contrast)}
.hidden-col{display:none}
.empty-state{padding:36px 20px;text-align:center}
.empty-state-title{font-size:13px;font-weight:600;color:var(--yl-text);margin-bottom:8px}
.empty-state-copy{font-size:12px;color:var(--yl-text-muted);line-height:1.7;max-width:520px;margin:0 auto}
.empty-state-copy code{background:var(--yl-bg-widget);border:1px solid var(--yl-border-strong);border-radius:6px;padding:1px 5px;color:var(--yl-text-strong)}
.warning-card{margin:12px 16px 0;padding:14px 16px;border:1px solid var(--yl-warn-border);border-radius:14px;background:linear-gradient(180deg, color-mix(in srgb, var(--yl-warn-bg) 90%, transparent), color-mix(in srgb, var(--yl-bg-widget) 88%, transparent));box-shadow:inset 0 1px 0 color-mix(in srgb, white 18%, transparent)}
.warning-card-header{display:flex;align-items:center;gap:8px;margin-bottom:8px;color:var(--yl-warn)}
.warning-card-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:999px;background:color-mix(in srgb, var(--yl-warn) 22%, transparent);font-size:11px;font-weight:700}
.warning-card-title{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.warning-card-copy{font-size:12px;line-height:1.6;color:var(--yl-text)}
.warning-card-list{margin:10px 0 0 18px;color:var(--yl-text-muted);line-height:1.65}
.warning-card-list li+li{margin-top:4px}
.warning-card-tip{margin-top:10px;font-size:12px;line-height:1.6;color:var(--yl-text-muted)}
.warning-card-tip code{background:var(--yl-bg-widget);border:1px solid var(--yl-border-strong);border-radius:6px;padding:1px 5px;color:var(--yl-text-strong)}
.warning{padding:8px 16px;color:var(--yl-warn);font-size:12px}
.cell-actions-header{width:28px;padding:0;border-bottom:1px solid var(--yl-border)}
.cell-actions{width:28px;padding:2px 4px;text-align:center;vertical-align:middle}
.revert-row-btn{background:none;border:none;color:var(--yl-text-muted);cursor:pointer;font-size:14px;padding:2px 4px;border-radius:4px;line-height:1;opacity:0;transition:opacity .15s}
tr:hover .revert-row-btn{opacity:1}
.revert-row-btn:hover{color:var(--yl-warn);background:var(--yl-warn-bg)}
.cell-task-done{width:60px;padding:10px;border-bottom:1px solid var(--yl-border);vertical-align:middle;text-align:center;cursor:pointer}
.cell-task-done:hover .cell-bool{border-color:var(--yl-accent)}
body.vscode-light .btn,body.vscode-light .chip,body.vscode-light .fsearch{box-shadow:none}
body.vscode-light .btn.refine-btn{color:color-mix(in srgb, var(--yl-accent) 68%, var(--yl-text))}
body.vscode-light .chip.active{color:color-mix(in srgb, var(--yl-accent) 80%, var(--yl-text))}
body.vscode-light .live-bar{background:color-mix(in srgb, var(--yl-bg-elevated) 58%, white)}
@media (max-width: 1240px){
.query-hero{grid-template-columns:1fr}
.query-hero-meta{justify-content:flex-start}
.query-toolbar{padding:0}
.metrics-strip{grid-template-columns:1fr}
.metrics-card{flex-wrap:wrap}
.quick-fields-card{justify-content:flex-start;min-width:0;flex-wrap:wrap}
.quick-fields-search{flex:1 1 220px;justify-content:flex-start}
}
@media (max-width: 1080px){
.query-toolbar{row-gap:0}
}
@media (max-width: 860px){
.query-toolbar{display:flex}
.toolbar-group{width:100%;border-right:none;padding-left:0;padding-right:0}
.metrics-card{width:100%;flex-wrap:wrap}
}
</style></head><body>
<datalist id="yids">${idOpts}</datalist>
<div class="tabbar">${tabBtns}</div>
${panels}
<div class="live-bar"><span>Double-click editable cells | click booleans twice to toggle | click relation pills to open</span></div>
<script nonce="${nonce}" src="${stateScriptUri}"></script>
<script nonce="${nonce}" src="${valueRuntimeScriptUri}"></script>
<script nonce="${nonce}" src="${editRuntimeScriptUri}"></script>
<script nonce="${nonce}" src="${uiRuntimeScriptUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
}

function buildEmptyHtml(queryList) {
    const tabBtns = queryList
        .map((q, i) => `<button class="tab-btn${i === 0 ? ' active' : ''}">${esc(q.label || (q.type === '*' ? 'All nodes' : q.type))}</button>`)
        .join('');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>:root{--yl-bg:var(--vscode-editor-background,#141414);--yl-bg-elevated:var(--vscode-sideBar-background,#1a1a1a);--yl-bg-widget:var(--vscode-input-background,#111318);--yl-text:var(--vscode-editor-foreground,#c8c8c8);--yl-text-muted:var(--vscode-descriptionForeground,#8b949e);--yl-border:var(--vscode-panel-border,#2a2a2a);--yl-border-strong:var(--vscode-input-border,#30363d);--yl-accent:var(--vscode-textLink-foreground,#4fc4a0)}body{background:var(--yl-bg);color:var(--yl-text-muted);font-family:'Segoe UI',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}.tabbar{display:flex;border-bottom:1px solid var(--yl-border);background:var(--yl-bg-elevated)}.tab-btn{padding:10px 16px;background:none;border:none;color:var(--yl-text-muted)}.tab-btn.active{color:var(--yl-accent);border-bottom:2px solid var(--yl-accent)}.center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px}.msg{font-size:13px;color:var(--yl-text);text-align:center;line-height:1.6}.hint{font-size:11px;color:var(--yl-text-muted);text-align:center;line-height:1.6}.hint code{background:var(--yl-bg-widget);border:1px solid var(--yl-border-strong);padding:1px 5px;border-radius:4px;color:var(--yl-text)}</style></head><body><div class="tabbar">${tabBtns}</div><div class="center"><div class="msg">No indexed nodes found.</div><div class="hint">Add an <code>id:</code> field to your Markdown files and save to index them,<br>then run the view again.</div></div></body></html>`;
}

function analyseColumns(rows, columns, query) {
    const schema = query && query.type && query.type !== '*' && query.type !== 'tasks'
        ? getSchema(query.type)
        : null;
    const meta = {};
    for (const col of columns) {
        if (col === 'id') {
            meta[col] = { kind: 'id' };
            continue;
        }
        const schemaField = schema?.fields?.[col] || null;
        const rawValues = rows.map(r => String(r.fields[col] ?? '').trim()).filter(Boolean);
        const unique = [...new Set(rawValues)];
        const schemaOptions = Array.isArray(schemaField?.options) ? schemaField.options : [];
        const isRelation = schemaField?.type === 'relation' || unique.some(v => /\[\[[^\]]+\]\]/.test(v));
        const isBoolean = schemaField?.type === 'boolean' || (unique.length > 0 && unique.every(v => ['true', 'false'].includes(v.toLowerCase())));
        const isNumber = schemaField?.type === 'number' || (unique.length > 0 && unique.every(v => /^-?\d+(?:\.\d+)?$/.test(v)));
        const isDate = schemaField?.type === 'date' || (unique.length > 0 && unique.every(v => isDateLike(v)));
        const isDropdown = schemaOptions.length > 0 || (!isRelation && !isBoolean && !isNumber && !isDate && unique.length >= 2 && unique.length <= 6 && unique.every(v => v.length <= 30 && !/^\d+(?:\.\d+)?$/.test(v)));
        meta[col] = {
            kind: isRelation ? 'relation' : isBoolean ? 'boolean' : isNumber ? 'number' : isDate ? 'date' : isDropdown ? 'dropdown' : 'text',
            options: schemaOptions.length > 0 ? schemaOptions : (isDropdown ? unique : [])
        };
    }
    return meta;
}

function applySavedColumnOrder(columns, savedOrder) {
    if (!Array.isArray(savedOrder) || savedOrder.length === 0) return columns;
    const ordered = [];
    const seen = new Set();
    for (const col of savedOrder) {
        if (columns.includes(col) && !seen.has(col)) {
            ordered.push(col);
            seen.add(col);
        }
    }
    for (const col of columns) {
        if (!seen.has(col)) ordered.push(col);
    }
    return ordered;
}

function normalizeSavedSort(sort) {
    if (!sort || typeof sort !== 'object') return null;
    const field = String(sort.field || sort.col || '').trim();
    if (!field) return null;
    const direction = sort.direction === 'desc' || sort.asc === false ? 'desc' : 'asc';
    return { field, direction };
}

function getRowFieldValue(row, field) {
    if (!row) return '';
    return field === 'id' ? row.id : String(row.fields?.[field] ?? '');
}

function collectColumnFilterValues(rows, field, kind) {
    return Array.from(new Set(rows
        .map((row) => normaliseTableDisplayValue(kind, getRowFieldValue(row, field)))
        .filter((value) => String(value || '').trim())))
        .sort((a, b) => String(a).localeCompare(String(b)));
}

function sortRowsForSavedSort(rows, sort, meta) {
    const savedSort = normalizeSavedSort(sort);
    if (!savedSort) return rows.slice();
    const kind = meta?.[savedSort.field]?.kind || 'text';
    return rows.slice().sort((a, b) => {
        const av = normaliseTableDisplayValue(kind, getRowFieldValue(a, savedSort.field));
        const bv = normaliseTableDisplayValue(kind, getRowFieldValue(b, savedSort.field));
        if (kind === 'number') {
            return savedSort.direction === 'asc'
                ? Number(av || 0) - Number(bv || 0)
                : Number(bv || 0) - Number(av || 0);
        }
        const as = String(av || '').toLowerCase();
        const bs = String(bv || '').toLowerCase();
        return savedSort.direction === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
}

function formatQueryHeroText(queryText) {
    const text = esc(String(queryText || ''));
    return text
        .replace(/\b(FROM)\b/g, '<span class="q-from">$1</span>')
        .replace(/\b(WHERE|AND|OR)\b/g, '<span class="q-where">$1</span>')
        .replace(/\b(SORT|LIMIT|SELECT)\b/g, '<span class="q-sort">$1</span>');
}

function buildQuickFieldList(columns) {
    return (Array.isArray(columns) ? columns : [])
        .filter((col) => col && col !== 'id')
        .slice(0, 4);
}

function buildMetricCards({ rowCount, fieldCount }) {
    return [
        { icon: 'records', label: 'Rows', value: String(rowCount), sub: rowCount === 1 ? 'visible row' : 'visible rows' },
        { icon: 'fields', label: 'Fields', value: String(fieldCount), sub: fieldCount === 1 ? 'active column' : 'active columns' }
    ].map((metric) => `<div class="metric-card">${iconGlyph(metric.icon)}<div class="metric-card-value">${esc(metric.value)}</div><div class="metric-card-sub">${esc(metric.sub)}</div></div>`).join('');
}

function getTaskStatusPresentation(row, todayIso) {
    const rawDone = String(row?.fields?.done ?? '').toLowerCase();
    const isDone = rawDone === 'true';
    if (isDone) {
        return { key: 'true', label: 'Done', sortValue: 'done', filterValue: 'done', className: 'true' };
    }
    const due = normaliseTableDisplayValue('date', row?.fields?.date ?? '');
    if (due && todayIso && due < todayIso) {
        return { key: 'overdue', label: 'Overdue', sortValue: 'overdue', filterValue: 'overdue', className: 'overdue' };
    }
    return { key: 'false', label: 'Not done', sortValue: 'not done', filterValue: 'not done', className: 'pending' };
}

function iconGlyph(name) {
    const icons = {
        query: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5h10M3 8h7M3 12.5h6" /></svg>',
        scope: '<svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="4" rx="4.5" ry="2.5"/><path d="M3.5 4v4c0 1.4 2 2.5 4.5 2.5s4.5-1.1 4.5-2.5V4"/><path d="M3.5 8v4c0 1.4 2 2.5 4.5 2.5s4.5-1.1 4.5-2.5V8"/></svg>',
        view: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="M5 6.5h6M5 9h4"/></svg>',
        filters: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11l-4 4.5v3l-3 1v-4z"/></svg>',
        layout: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M7.75 3v10M2.5 8h11"/></svg>',
        export: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7"/><path d="M5.5 7.5 8 10l2.5-2.5"/><path d="M3 12.5h10"/></svg>',
        records: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h10"/><circle cx="4.5" cy="4" r=".8"/><circle cx="4.5" cy="8" r=".8"/><circle cx="4.5" cy="12" r=".8"/></svg>',
        fields: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h10"/><path d="M6 2.5v11M10 2.5v11"/></svg>',
        search: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="3.5"/><path d="M10 10 13.5 13.5"/></svg>'
    };
    const svg = icons[name] || icons.query;
    return `<span class="yl-icon yl-icon-${esc(name)}">${svg}</span>`;
}

function buildPanel(query, idx, activeTab, tabState, contextNodeId) {
    const queryText = buildQueryString(query);
    const vaultGeneration = getVaultGeneration();
    const todayIso = getTodayIsoLocal();
    const result = perfTracker.measureSync('view.runQuery', {
        type: query?.type || '*',
        incoming: query?.incoming ? 'yes' : 'no',
        budgetMs: 50
    }, () => getCachedQueryResult(queryText, vaultGeneration, todayIso, () => runQuery(query, contextNodeId || null)));
    const isActive = idx === activeTab;
    if (!result.success) {
        return `<div class="tab-panel${isActive ? ' active' : ''}" data-tab="${idx}" style="display:${isActive ? 'flex' : 'none'}"><div class="warning">• ${esc(result.error || 'Unknown error')}</div></div>`;
    }

    const { rows, types, warnings } = result;

    if (result.groupBy) {
        const groupField = result.groupBy;
        const groups = result.groups || [];
        const warningBanner = warnings.length ? buildWarningBanner(query, warnings) : '';
        const groupBodyRows = groups.length
            ? groups.map(g => `<tr><td>${g.key === '' ? '<span class="cell-empty">-</span>' : esc(g.key)}</td><td>${g.count}</td></tr>`).join('')
            : `<tr><td colspan="2" class="empty-state">${buildTableEmptyState(query, warnings)}</td></tr>`;
        return `<div class="tab-panel${isActive ? ' active' : ''}" data-tab="${idx}" style="display:${isActive ? 'flex' : 'none'}">${warningBanner}<div class="filterbar"><div class="chip-group"></div><div class="action-group"><button class="btn export-btn" data-format="csv">Export CSV</button><button class="btn export-btn" data-format="json">Export JSON</button></div><div class="status-group"><span class="fcount"><strong>${groups.length}</strong> group${groups.length !== 1 ? 's' : ''}</span></div></div><div class="table-wrap"><table><colgroup><col><col style="width:80px"></colgroup><thead><tr><th>${esc(groupField)}</th><th>count</th></tr></thead><tbody>${groupBodyRows}</tbody></table></div></div>`;
    }

    const columns = applySavedColumnOrder(result.columns, tabState.columnOrder);
    const meta = analyseColumns(rows, columns, query);
    const savedSearch = tabState.search || '';
    const savedSort = normalizeSavedSort(tabState.sort);
    const savedFilter = tabState.filter || 'all';
    const savedPage = Math.max(1, Number(tabState.page || 1));
    const savedPageSize = Math.max(0, Number(tabState.pageSize || 50));
    const hiddenCols = new Set(tabState.hiddenCols || []);

    const sortedRows = sortRowsForSavedSort(rows, savedSort, meta);

    const warningBanner = warnings.length ? buildWarningBanner(query, warnings) : '';
    const chips = `<button class="chip${savedFilter === 'all' ? ' active' : ''}" data-filter="all">All</button>` + types.map(t => `<button class="chip${savedFilter === `type:${t}` ? ' active' : ''}" data-filter="type:${esc(t)}">${esc(t)}</button>`).join('');
    const colMenu = columns.map((col, index) => `<label class="col-menu-item"><input type="checkbox" data-col-toggle="${esc(col)}" ${hiddenCols.has(col) ? '' : 'checked'}> <span>${esc(col)}</span><button class="col-move" data-col-move="left" data-col="${esc(col)}" ${index === 0 ? 'disabled' : ''}>&larr;</button><button class="col-move" data-col-move="right" data-col="${esc(col)}" ${index === columns.length - 1 ? 'disabled' : ''}>&rarr;</button></label>`).join('');
    const columnWidths = tabState.columnWidths || {};
    const quickFields = buildQuickFieldList(columns);
    const scopeLabel = query.incoming ? 'Incoming' : (query.type === '*' ? 'Vault' : query.type);
    const viewLabel = query.label || (query.type === '*' ? 'All notes' : query.type);
    const metricsCardHtml = buildMetricCards({
        rowCount: rows.length,
        fieldCount: columns.length
    });
    const quickFieldHtml = quickFields.length
        ? quickFields.map((field) => `<button type="button" class="quick-field-btn" data-quick-field="${esc(field)}">${esc(field)}</button>`).join('')
        : '';
    const colGroup = `<colgroup>${columns.map(col => {
        const width = Number(columnWidths[col]);
        const style = Number.isFinite(width) && width >= 120 ? ` style="width:${width}px"` : '';
        return `<col data-col="${esc(col)}"${style}>`;
    }).join('')}<col class="col-actions" style="width:28px"></colgroup>`;
    const headerCells = columns.map(col => {
        const cellMeta = meta[col] || { kind: 'text' };
        cellMeta.filterOptions = collectColumnFilterValues(sortedRows, col, cellMeta.kind);
        const sortedClass = savedSort && savedSort.field === col ? 'sorted' : '';
        const ascAttr = savedSort && savedSort.field === col ? ` data-asc="${savedSort.direction === 'asc' ? 'true' : 'false'}"` : '';
        const width = Number(columnWidths[col]);
        const style = Number.isFinite(width) && width >= 120 ? ` style="width:${width}px"` : '';
        const filterMenu = cellMeta.filterOptions.length
            ? `<div class="th-filter-menu" data-col-filter-menu="${esc(col)}"><div class="th-filter-title">${esc(col)}</div>${cellMeta.filterOptions.map((value) => `<label class="th-filter-option"><input type="checkbox" data-col-filter-value="${esc(col)}" value="${esc(value)}"> <span>${esc(value)}</span></label>`).join('')}<div class="th-filter-actions"><button type="button" class="th-filter-clear" data-col-filter-clear="${esc(col)}">Clear</button></div></div>`
            : `<div class="th-filter-menu" data-col-filter-menu="${esc(col)}"><div class="th-filter-title">${esc(col)}</div><div class="th-filter-empty">No values</div></div>`;
        const headerLabel = query.type === 'tasks' && col === 'done' ? 'status' : col;
        return `<th draggable="true" data-col="${esc(col)}" data-kind="${esc(cellMeta.kind)}"${ascAttr}${style} class="${[hiddenCols.has(col) ? 'hidden-col' : '', sortedClass].filter(Boolean).join(' ')}" title="Drag to reorder"><div class="th-head"><span class="th-label">${esc(headerLabel)}</span><span class="th-tools"><span class="sarr">↕</span><button type="button" class="th-filter-btn" data-col-filter-toggle="${esc(col)}" aria-label="Filter ${esc(headerLabel)}">▾</button></span></div>${filterMenu}<span class="col-resizer" data-col-resizer="${esc(col)}" title="Resize column"></span></th>`;
    }).join('') + `<th class="cell-actions-header"></th>`;

    const bodyRows = sortedRows.length
        ? sortedRows.map((row, rowIndex) => {
            const cells = columns.map(col => {
                const cellMeta = meta[col] || { kind: 'text', options: [] };
                const raw = col === 'id' ? row.id : String(row.fields[col] ?? '');
                const display = normaliseTableDisplayValue(cellMeta.kind, raw);
                const hiddenClass = hiddenCols.has(col) ? ' hidden-col' : '';
                const filterAttr = ` data-filter-value="${esc(display)}"`;
                const sortAttr = ` data-sort-value="${esc(display)}"`;

                if (col === 'id') {
                    return `<td class="cell-id${hiddenClass}" data-id="${esc(row.id)}" data-filter-value="${esc(row.id)}" data-sort-value="${esc(row.id)}">${esc(row.id)}</td>`;
                }

                if (row.nodeType === 'tasks') {
                    if (col === 'done') {
                        const status = getTaskStatusPresentation(row, todayIso);
                        const lineNum = String(row.fields.line || '0');
                        return `<td class="cell-task-done${hiddenClass}" data-filepath="${esc(row.filePath)}" data-line="${esc(lineNum)}" data-value="${esc(status.key)}" data-filter-value="${esc(status.filterValue)}" data-sort-value="${esc(status.sortValue)}"><span class="cell-bool ${esc(status.className)}">${esc(status.label)}</span></td>`;
                    }
                    return `<td class="${hiddenClass}"${filterAttr}${sortAttr}>${raw ? esc(display) : '<span class="cell-empty">-</span>'}</td>`;
                }

                if (!raw) {
                    return `<td class="cell-empty cell-editable${hiddenClass}" data-edit-mode="text" data-filepath="${esc(row.filePath)}" data-field="${esc(col)}" data-value="">-</td>`;
                }
                if (cellMeta.kind === 'relation') {
                    const rels = [...raw.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
                    if (rels.length === 1) {
                        return `<td class="cell-editable${hiddenClass}" data-edit-mode="relation" data-filepath="${esc(row.filePath)}" data-field="${esc(col)}" data-value="${esc(rels[0])}"><span class="cell-rel" data-id="${esc(rels[0])}">${esc(rels[0])}</span></td>`;
                    }
                    return `<td class="${hiddenClass}"${filterAttr}${sortAttr}>${rels.map(r => `<span class="cell-rel" data-id="${esc(r)}">${esc(r)}</span>`).join(' ')}</td>`;
                }
                if (cellMeta.kind === 'boolean') {
                    const isTrue = raw.toLowerCase() === 'true';
                    return `<td class="cell-editable${hiddenClass}" data-edit-mode="boolean" data-filepath="${esc(row.filePath)}" data-field="${esc(col)}" data-value="${esc(raw)}"${filterAttr}${sortAttr}><span class="cell-bool ${isTrue ? 'true' : 'false'}">${isTrue ? 'True' : 'False'}</span></td>`;
                }
                if (cellMeta.kind === 'dropdown') {
                    return `<td class="cell-editable${hiddenClass}" data-edit-mode="dropdown" data-options="${esc(JSON.stringify(cellMeta.options))}" data-filepath="${esc(row.filePath)}" data-field="${esc(col)}" data-value="${esc(display)}"${filterAttr}${sortAttr}>${esc(display)}</td>`;
                }
                const editMode = cellMeta.kind === 'number' || cellMeta.kind === 'date' ? cellMeta.kind : 'text';
                return `<td class="cell-editable${hiddenClass}" data-edit-mode="${editMode}" data-filepath="${esc(row.filePath)}" data-field="${esc(col)}" data-value="${esc(display)}"${filterAttr}${sortAttr}>${esc(display)}</td>`;
            }).join('');

            const matchesSearch = !savedSearch || row.id.toLowerCase().includes(savedSearch.toLowerCase()) || Object.values(row.fields).join(' ').toLowerCase().includes(savedSearch.toLowerCase());
            const matchesFilter = savedFilter === 'all' || row.nodeType === savedFilter.slice(5);
            const hidden = !(matchesSearch && matchesFilter);
            const revertCell = `<td class="cell-actions"><button class="revert-row-btn" data-filepath="${esc(row.filePath)}" title="Revert row changes">↩</button></td>`;
            return `<tr data-type="${esc(row.nodeType)}" data-row-index="${rowIndex}" ${hidden ? 'style="display:none"' : ''}>${cells}${revertCell}</tr>`;
        }).join('')
        : `<tr><td colspan="${columns.length + 1}" class="empty-state">${buildTableEmptyState(query, warnings)}</td></tr>`;

    return `<div class="tab-panel${isActive ? ' active' : ''}" data-tab="${idx}" data-column-filters="${esc(JSON.stringify(tabState.columnFilters || {}))}" data-current-page="${savedPage}" data-page-size="${savedPageSize}" style="display:${isActive ? 'flex' : 'none'}"><div class="view-shell">${warningBanner}
<div class="query-hero"><div class="query-hero-top"><div class="query-hero-title">Table View</div><div class="query-hero-subtle">${esc(viewLabel)}</div></div><div class="query-hero-query"><span class="query-hero-query-label">${iconGlyph('query')}Query</span><code>${formatQueryHeroText(queryText)}</code></div><div class="query-hero-meta"><span class="query-hero-badge">${esc(scopeLabel)}</span><span class="query-hero-badge">${rows.length} row${rows.length === 1 ? '' : 's'}</span></div></div>
<div class="query-toolbar">
<div class="toolbar-group group-scope"><div class="toolbar-group-label">${iconGlyph('scope')}Scope</div><div class="toolbar-group-row"><div class="toolbar-chip-stack">${chips}</div></div></div>
<div class="toolbar-group group-view"><div class="toolbar-group-label">${iconGlyph('view')}View</div><div class="toolbar-group-row"><button class="btn report-btn">Open report</button><button class="btn reset-btn">Reset view</button></div></div>
<div class="toolbar-group group-filters"><div class="toolbar-group-label">${iconGlyph('filters')}Filters</div><div class="toolbar-group-row"><button class="btn refine-btn" data-query-index="${idx}">Refine view</button><button class="btn filter-selection-btn">Filter by selection</button><button class="btn exclude-selection-btn">Exclude selection</button><button class="btn clear-column-filters-btn">Clear quick filters</button></div></div>
<div class="toolbar-group group-layout"><div class="toolbar-group-label">${iconGlyph('layout')}Layout</div><div class="toolbar-group-row"><button class="btn columns-btn">Columns</button></div><div class="toolbar-menu">${colMenu}</div></div>
<div class="toolbar-group group-export"><div class="toolbar-group-label">${iconGlyph('export')}Export</div><div class="toolbar-group-row"><button class="btn export-btn" data-format="csv">CSV</button><button class="btn export-btn" data-format="json">JSON</button><button class="btn export-btn" data-format="pdf">PDF</button></div></div>
</div>
<div class="metrics-strip"><div class="metrics-card">${metricsCardHtml}</div><div class="quick-fields-card"><div class="quick-fields-row">${quickFieldHtml}</div><div class="quick-fields-search">${iconGlyph('search')}<input class="fsearch" type="text" placeholder="Search records..." value="${esc(savedSearch)}"></div></div></div>
<div class="table-summary"></div>
<div class="table-filters"></div>
<div class="table-pagination" hidden><div class="table-pagination-group"><button class="table-pagination-btn" data-page-nav="prev">Previous</button><span class="table-pagination-status">Page 1 of 1</span><button class="table-pagination-btn" data-page-nav="next">Next</button></div><div class="table-pagination-group"><span class="table-pagination-label">Rows per page</span><select class="table-pagination-select" data-page-size><option value="50"${savedPageSize === 50 ? ' selected' : ''}>50</option><option value="100"${savedPageSize === 100 ? ' selected' : ''}>100</option><option value="200"${savedPageSize === 200 ? ' selected' : ''}>200</option><option value="0"${savedPageSize === 0 ? ' selected' : ''}>All</option></select></div></div>
<div class="no-visible-state">No visible rows match the current search or filter. <button class="btn reset-btn">Reset view</button></div>
<div class="table-wrap"><table>${colGroup}<thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div></div></div>`;
}

function buildEmptyStateHint(query, warnings) {
    const warningState = classifyQueryWarnings(warnings);
    if (warningState.severity === 'query-issue') {
        return `${warningState.primary} ${warningState.tip}`;
    }
    if (warningState.severity === 'query-warning') {
        return warningState.primary;
    }
    const wheres = query.wheres && query.wheres.length > 0 ? query.wheres : (query.where ? [query.where] : []);
    if (wheres.some(cond => cond.field === 'id')) {
        return 'Check that the target note is saved and the id matches exactly.';
    }
    return `Try a broader query first, for example: ${buildQueryString({ ...query, type: '*', wheres: [], where: null })}`;
}

function buildTableEmptyState(query, warnings) {
    const title = buildTableEmptyStateTitle(query, warnings);
    const hint = buildEmptyStateHint(query, warnings);
    return `<div class="empty-state-title">${esc(title)}</div><div class="empty-state-copy">${escapeHintForHtml(hint)}</div>`;
}

function buildTableEmptyStateTitle(query, warnings) {
    const warningState = classifyQueryWarnings(warnings);
    if (warningState.severity === 'query-issue') return 'This query needs attention.';
    if (warningState.severity === 'query-warning') return 'This view needs a quick query check.';
    const wheres = query.wheres && query.wheres.length > 0 ? query.wheres : (query.where ? [query.where] : []);
    if (wheres.some(cond => cond.field === 'id')) {
        return 'The target note was not found in this view.';
    }
    if (query.incoming) {
        return 'No notes link here yet.';
    }
    if (query.type === 'tasks') {
        return 'No tasks matched this view.';
    }
    return 'No rows matched this view.';
}

function escapeHintForHtml(text) {
    return esc(String(text)).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function classifyQueryWarnings(warnings) {
    const items = Array.isArray(warnings)
        ? warnings.map(w => String(w || '').trim()).filter(Boolean)
        : [];
    if (items.length === 0) {
        return { severity: 'none', primary: '', items: [], tip: '' };
    }

    const lower = items.map(item => item.toLowerCase());
    const hasCrossFieldOr = lower.some(item => item.includes('cross-field or'));
    const hasUnsupported = lower.some(item => item.includes('not supported'));
    const hasParseIssue = lower.some(item =>
        item.includes('invalid')
        || item.includes('parse')
        || item.includes('syntax')
        || item.includes('unknown operator')
        || item.includes('could not')
    );

    if (hasCrossFieldOr) {
        return {
            severity: 'query-issue',
            primary: 'Yamlink does not support cross-field `or` yet.',
            items,
            tip: 'Keep each view to one field family, use multiple `where` lines with `and`, or split the logic into separate views.'
        };
    }

    if (hasUnsupported || hasParseIssue) {
        return {
            severity: 'query-issue',
            primary: 'Yamlink only understood part of this view.',
            items,
            tip: 'Use the simple one-line form for quick filters, or the multi-line power-user form with `select`, `where`, `sort`, and `limit`.'
        };
    }

    return {
        severity: 'query-warning',
        primary: items[0],
        items,
        tip: 'Review the query clauses and try a simpler filter first.'
    };
}

function buildWarningBanner(query, warnings) {
    const warningState = classifyQueryWarnings(warnings);
    if (warningState.severity === 'none') return '';
    const title = warningState.severity === 'query-issue' ? 'Query issue' : 'Query note';
    const intro = warningState.primary || 'This view needs a quick check.';
    const details = warningState.items.length
        ? `<ul class="warning-card-list">${warningState.items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`
        : '';
    const tip = warningState.tip ? `<div class="warning-card-tip">${escapeHintForHtml(warningState.tip)}</div>` : '';
    return `<div class="warning-card" data-warning-severity="${warningState.severity}"><div class="warning-card-header"><span class="warning-card-badge">!</span><span class="warning-card-title">${esc(title)}</span></div><div class="warning-card-copy">${escapeHintForHtml(intro)}</div>${details}${tip}</div>`;
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function normaliseTableDisplayValue(kind, value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (kind === 'date') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString().slice(0, 10);
        }
    }
    if (kind === 'boolean') {
        return raw.toLowerCase() === 'true' ? 'true' : 'false';
    }
    return raw;
}

module.exports = {
    repairUiText,
    renderPanel,
    normaliseTableDisplayValue,
    normalizeSavedSort,
    sortRowsForSavedSort,
    formatQueryHeroText,
    buildQuickFieldList,
    getTaskStatusPresentation,
    buildTableEmptyStateTitle,
    buildEmptyStateHint,
    classifyQueryWarnings,
    buildWarningBanner
};
