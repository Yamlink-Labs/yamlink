'use strict';

const vscode = require('vscode');
const { getIndex } = require('../../core/indexService');
const { runQuery, buildQueryString } = require('../../engine/query');
const { getSchema } = require('../../registries/schemaRegistry');
const { isDateLike } = require('../../core/date');

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
    panel.webview.html = repairUiText(buildHtml(queryList, stateScriptUri, valueRuntimeScriptUri, editRuntimeScriptUri, uiRuntimeScriptUri, scriptUri, nonce, csp, panelState, preferredTab, contextNodeId));
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
.filterbar{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--yl-toolbar-border);background:linear-gradient(180deg, color-mix(in srgb, var(--yl-toolbar-bg) 92%, transparent), color-mix(in srgb, var(--yl-bg) 96%, transparent));flex-wrap:wrap}
.chip-group,.action-group,.status-group{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.chip-group{margin-right:4px}
.action-group{gap:7px}
.status-group{margin-left:auto;justify-content:flex-end}
.btn,.chip,.col-move{background:var(--yl-control-bg);border:1px solid var(--yl-control-border);border-radius:999px;color:var(--yl-control-muted);padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit;transition:background-color .14s ease,border-color .14s ease,color .14s ease,transform .14s ease,box-shadow .14s ease}
.btn:hover,.chip:hover,.col-move:hover{background:var(--yl-control-bg-hover);border-color:color-mix(in srgb, var(--yl-accent) 34%, var(--yl-control-border));color:var(--yl-text);transform:translateY(-1px)}
.chip{font-weight:600}
.chip.active{background:var(--yl-chip-active-bg);border-color:var(--yl-chip-active-border);color:var(--yl-accent);box-shadow:0 0 0 1px color-mix(in srgb, var(--yl-accent) 16%, transparent) inset}
.btn.refine-btn{background:color-mix(in srgb, var(--yl-accent) 12%, var(--yl-control-bg));border-color:color-mix(in srgb, var(--yl-accent) 34%, var(--yl-control-border));color:var(--yl-text-strong)}
.btn.refine-btn:hover{background:color-mix(in srgb, var(--yl-accent) 17%, var(--yl-control-bg-hover));border-color:color-mix(in srgb, var(--yl-accent) 48%, var(--yl-control-border));color:var(--yl-accent)}
.btn.export-btn,.btn.columns-btn{color:var(--yl-text-muted)}
.btn.export-btn:hover,.btn.columns-btn:hover,.btn.reset-btn:hover{color:var(--yl-text)}
.col-move{padding:2px 6px;font-size:10px;border-radius:6px}
.col-move[disabled]{opacity:.35;cursor:default}
.fsearch{min-width:220px;background:var(--yl-search-bg);border:1px solid var(--yl-search-border);border-radius:12px;padding:7px 11px;color:var(--yl-text-strong);outline:none;font:inherit;box-shadow:inset 0 1px 0 color-mix(in srgb, var(--yl-bg) 45%, transparent)}
.fsearch:focus{border-color:color-mix(in srgb, var(--yl-accent-strong) 76%, var(--yl-search-border));box-shadow:0 0 0 1px color-mix(in srgb, var(--yl-accent) 24%, transparent), inset 0 1px 0 color-mix(in srgb, var(--yl-bg) 45%, transparent)}
.fcount{font-size:12px;color:var(--yl-text-muted);white-space:nowrap}
.table-summary{display:none;padding:8px 16px 0;color:var(--yl-text-muted);font-size:12px}
.table-filters{display:none;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 16px 0}
.filter-pill{display:inline-flex;align-items:center;gap:8px;padding:4px 10px;border-radius:999px;border:1px solid var(--yl-control-border);background:var(--yl-control-bg);color:var(--yl-text);font-size:11px}
.filter-pill-label{color:var(--yl-text-muted);text-transform:uppercase;letter-spacing:.06em;font-size:10px}
.filter-pill button{border:none;background:none;color:var(--yl-text-muted);cursor:pointer;font:inherit;padding:0}
.filter-pill button:hover{color:var(--yl-warn)}
.no-visible-state{display:none;padding:16px;color:var(--yl-text-muted);border-bottom:1px solid var(--yl-border)}
.no-visible-state .reset-btn{margin-left:8px}
.col-menu-item{display:flex;gap:8px;align-items:center;padding:3px 0}
.table-wrap{flex:1;overflow:auto;padding:0 16px 16px}
.toolbar-menu{display:none;position:absolute;background:var(--yl-bg-widget);border:1px solid var(--yl-border-strong);border-radius:8px;padding:10px;z-index:10;max-height:240px;overflow:auto}
.table-wrap table{width:max-content;min-width:100%;border-collapse:collapse;margin-top:12px}
.table-wrap thead th{position:sticky;top:0;background:var(--yl-bg);font-size:11px;color:var(--yl-text-muted);text-transform:uppercase;letter-spacing:.08em;padding:10px;text-align:left;border-bottom:1px solid var(--yl-border);white-space:nowrap;cursor:pointer;position:sticky}
.table-wrap thead th[data-col]{cursor:grab;user-select:none}
.table-wrap thead th:first-child{left:0;z-index:3;box-shadow:1px 0 0 color-mix(in srgb, var(--yl-border) 86%, transparent)}
.table-wrap thead th[data-col].dragging{opacity:.45}
.table-wrap thead th[data-col].drag-over{box-shadow:inset 2px 0 0 var(--yl-accent)}
.table-wrap thead th[data-col].drag-over-after{box-shadow:inset -2px 0 0 var(--yl-accent)}
.th-label{display:block;overflow:hidden;text-overflow:ellipsis;padding-right:10px}
.col-resizer{position:absolute;top:0;right:-3px;width:8px;height:100%;cursor:col-resize;z-index:2}
.col-resizer:hover,.col-resizer.active{background:color-mix(in srgb, var(--yl-accent) 28%, transparent)}
.table-wrap tbody td{padding:10px;border-bottom:1px solid var(--yl-border);font-size:12px;vertical-align:middle}
.table-wrap tbody td:first-child{position:sticky;left:0;background:inherit;z-index:2;box-shadow:1px 0 0 color-mix(in srgb, var(--yl-border) 86%, transparent)}
.table-wrap tbody tr:hover{background:var(--yl-bg-hover)}
.cell-id{color:var(--yl-id);cursor:pointer;font-weight:600}
.cell-rel,.cell-bool{display:inline-flex;align-items:center;padding:4px 9px;border-radius:999px;white-space:nowrap;cursor:pointer;font-size:11px;font-weight:600;letter-spacing:.01em}
.cell-rel{background:linear-gradient(180deg, color-mix(in srgb, var(--yl-success-bg) 84%, transparent), color-mix(in srgb, var(--yl-accent) 6%, var(--yl-success-bg)));border:1px solid var(--yl-success-border);color:var(--yl-success-strong);box-shadow:inset 0 1px 0 color-mix(in srgb, white 45%, transparent)}
.cell-bool{border:1px solid var(--yl-success-border);background:linear-gradient(180deg, color-mix(in srgb, var(--yl-success-bg) 88%, transparent), color-mix(in srgb, var(--yl-accent) 5%, var(--yl-success-bg)));color:var(--yl-success-strong)}
.cell-bool.false{border-color:var(--yl-warn-border);background:var(--yl-warn-bg);color:var(--yl-warn)}
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

function buildPanel(query, idx, activeTab, tabState, contextNodeId) {
    const result = runQuery(query, contextNodeId || null);
    const isActive = idx === activeTab;
    if (!result.success) {
        return `<div class="tab-panel${isActive ? ' active' : ''}" data-tab="${idx}" style="display:${isActive ? 'flex' : 'none'}"><div class="warning">• ${esc(result.error || 'Unknown error')}</div></div>`;
    }

    const { rows, types, warnings } = result;
    const columns = applySavedColumnOrder(result.columns, tabState.columnOrder);
    const meta = analyseColumns(rows, columns, query);
    const savedSearch = tabState.search || '';
    const savedSort = tabState.sort || null;
    const savedFilter = tabState.filter || 'all';
    const hiddenCols = new Set(tabState.hiddenCols || []);

    if (savedSort) {
        rows.sort((a, b) => {
            const av = String(savedSort.col === 'id' ? a.id : (a.fields[savedSort.col] ?? '')).toLowerCase();
            const bv = String(savedSort.col === 'id' ? b.id : (b.fields[savedSort.col] ?? '')).toLowerCase();
            return savedSort.asc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
    }

    const warningBanner = warnings.length
        ? `<div class="warning">${warnings.map(w => '&bull; ' + esc(w)).join('<br>')}</div>`
        : '';
    const chips = `<button class="chip${savedFilter === 'all' ? ' active' : ''}" data-filter="all">All</button>` + types.map(t => `<button class="chip${savedFilter === `type:${t}` ? ' active' : ''}" data-filter="type:${esc(t)}">${esc(t)}</button>`).join('');
    const colMenu = columns.map((col, index) => `<label class="col-menu-item"><input type="checkbox" data-col-toggle="${esc(col)}" ${hiddenCols.has(col) ? '' : 'checked'}> <span>${esc(col)}</span><button class="col-move" data-col-move="left" data-col="${esc(col)}" ${index === 0 ? 'disabled' : ''}>&larr;</button><button class="col-move" data-col-move="right" data-col="${esc(col)}" ${index === columns.length - 1 ? 'disabled' : ''}>&rarr;</button></label>`).join('');
    const columnWidths = tabState.columnWidths || {};
    const colGroup = `<colgroup>${columns.map(col => {
        const width = Number(columnWidths[col]);
        const style = Number.isFinite(width) && width >= 120 ? ` style="width:${width}px"` : '';
        return `<col data-col="${esc(col)}"${style}>`;
    }).join('')}<col class="col-actions" style="width:28px"></colgroup>`;
    const headerCells = columns.map(col => {
        const cellMeta = meta[col] || { kind: 'text' };
        const sortedClass = savedSort && savedSort.col === col ? 'sorted' : '';
        const ascAttr = savedSort && savedSort.col === col ? ` data-asc="${savedSort.asc ? 'true' : 'false'}"` : '';
        const width = Number(columnWidths[col]);
        const style = Number.isFinite(width) && width >= 120 ? ` style="width:${width}px"` : '';
        return `<th draggable="true" data-col="${esc(col)}" data-kind="${esc(cellMeta.kind)}"${ascAttr}${style} class="${[hiddenCols.has(col) ? 'hidden-col' : '', sortedClass].filter(Boolean).join(' ')}" title="Drag to reorder"><span class="th-label">${esc(col)}</span><span class="col-resizer" data-col-resizer="${esc(col)}" title="Resize column"></span></th>`;
    }).join('') + `<th class="cell-actions-header"></th>`;

    const bodyRows = rows.length
        ? rows.map((row, rowIndex) => {
            const cells = columns.map(col => {
                const cellMeta = meta[col] || { kind: 'text', options: [] };
                const raw = col === 'id' ? row.id : String(row.fields[col] ?? '');
                const display = normaliseTableDisplayValue(cellMeta.kind, raw);
                const hiddenClass = hiddenCols.has(col) ? ' hidden-col' : '';

                if (col === 'id') {
                    return `<td class="cell-id${hiddenClass}" data-id="${esc(row.id)}">${esc(row.id)}</td>`;
                }

                if (row.nodeType === 'tasks') {
                    if (col === 'done') {
                        const isDone = raw.toLowerCase() === 'true';
                        const lineNum = String(row.fields.line || '0');
                        return `<td class="cell-task-done${hiddenClass}" data-filepath="${esc(row.filePath)}" data-line="${esc(lineNum)}" data-value="${isDone ? 'true' : 'false'}"><span class="cell-bool ${isDone ? 'true' : 'false'}">${isDone ? 'True' : 'False'}</span></td>`;
                    }
                    return `<td class="${hiddenClass}">${raw ? esc(display) : '<span class="cell-empty">-</span>'}</td>`;
                }

                if (!raw) {
                    return `<td class="cell-empty cell-editable${hiddenClass}" data-edit-mode="text" data-filepath="${esc(row.filePath)}" data-field="${esc(col)}" data-value="">-</td>`;
                }
                if (cellMeta.kind === 'relation') {
                    const rels = [...raw.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
                    if (rels.length === 1) {
                        return `<td class="cell-editable${hiddenClass}" data-edit-mode="relation" data-filepath="${esc(row.filePath)}" data-field="${esc(col)}" data-value="${esc(rels[0])}"><span class="cell-rel" data-id="${esc(rels[0])}">${esc(rels[0])}</span></td>`;
                    }
                    return `<td class="${hiddenClass}">${rels.map(r => `<span class="cell-rel" data-id="${esc(r)}">${esc(r)}</span>`).join(' ')}</td>`;
                }
                if (cellMeta.kind === 'boolean') {
                    const isTrue = raw.toLowerCase() === 'true';
                    return `<td class="cell-editable${hiddenClass}" data-edit-mode="boolean" data-filepath="${esc(row.filePath)}" data-field="${esc(col)}" data-value="${esc(raw)}"><span class="cell-bool ${isTrue ? 'true' : 'false'}">${isTrue ? 'True' : 'False'}</span></td>`;
                }
                if (cellMeta.kind === 'dropdown') {
                    return `<td class="cell-editable${hiddenClass}" data-edit-mode="dropdown" data-options="${esc(JSON.stringify(cellMeta.options))}" data-filepath="${esc(row.filePath)}" data-field="${esc(col)}" data-value="${esc(display)}">${esc(display)}</td>`;
                }
                const editMode = cellMeta.kind === 'number' || cellMeta.kind === 'date' ? cellMeta.kind : 'text';
                return `<td class="cell-editable${hiddenClass}" data-edit-mode="${editMode}" data-filepath="${esc(row.filePath)}" data-field="${esc(col)}" data-value="${esc(display)}">${esc(display)}</td>`;
            }).join('');

            const matchesSearch = !savedSearch || row.id.toLowerCase().includes(savedSearch.toLowerCase()) || Object.values(row.fields).join(' ').toLowerCase().includes(savedSearch.toLowerCase());
            const matchesFilter = savedFilter === 'all' || row.nodeType === savedFilter.slice(5);
            const hidden = !(matchesSearch && matchesFilter);
            const revertCell = `<td class="cell-actions"><button class="revert-row-btn" data-filepath="${esc(row.filePath)}" title="Revert row changes">↩</button></td>`;
            return `<tr data-type="${esc(row.nodeType)}" data-row-index="${rowIndex}" ${hidden ? 'style="display:none"' : ''}>${cells}${revertCell}</tr>`;
        }).join('')
        : `<tr><td colspan="${columns.length + 1}" class="empty-state">${buildTableEmptyState(query, warnings)}</td></tr>`;

    return `<div class="tab-panel${isActive ? ' active' : ''}" data-tab="${idx}" data-column-filters="${esc(JSON.stringify(tabState.columnFilters || {}))}" style="display:${isActive ? 'flex' : 'none'}">${warningBanner}
<div class="filterbar"><div class="chip-group">${chips}</div><div class="action-group"><button class="btn refine-btn" data-query-index="${idx}">Refine view</button><button class="btn filter-selection-btn">Filter by selection</button><button class="btn exclude-selection-btn">Exclude selection</button><button class="btn report-btn">Open report</button><button class="btn clear-column-filters-btn">Clear quick filters</button><button class="btn reset-btn">Reset view</button><button class="btn columns-btn">Columns</button><button class="btn export-btn" data-format="csv">Export CSV</button><button class="btn export-btn" data-format="json">Export JSON</button><button class="btn export-btn" data-format="pdf">Export PDF</button></div><div class="status-group"><input class="fsearch" type="text" placeholder="Search..." value="${esc(savedSearch)}"><span class="fcount" data-total-rows="${rows.length}"><strong>${rows.length}</strong> rows</span></div><div class="toolbar-menu">${colMenu}</div></div>
<div class="table-summary"></div>
<div class="table-filters"></div>
<div class="no-visible-state">No visible rows match the current search or filter. <button class="btn reset-btn">Reset view</button></div>
<div class="table-wrap"><table>${colGroup}<thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div></div>`;
}

function buildEmptyStateHint(query, warnings) {
    if (warnings.length > 0) return warnings[0];
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
    if (warnings.length > 0) return 'This view needs a broader match.';
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
    buildTableEmptyStateTitle
};
