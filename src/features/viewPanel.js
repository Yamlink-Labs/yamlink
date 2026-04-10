const vscode = require('vscode');
const fs = require('fs');
const { getIndex, buildIndex, updateSingleFile, invalidateFileCache } = require('../core/index');
const { parseAllViewQueries, parseViewQuery, runQuery, buildQueryString } = require('../engine/query');
const { writeFieldValue } = require('../core/writeField');
const { getSchema } = require('../registries/schemaRegistry');
const { isDateLike } = require('../core/date');
const { extractCanonicalIdFromFrontmatter } = require('../core/id');
const { buildViewExportModel, exportViewPdf } = require('../export/pdf');

let panel = null;
let lastQuery = null;
let onCompleteCallback = null;
let _extUri = null;
let _panelState = null;
let _contextNodeId = null;
let _sourceDocumentPath = null;
let _viewPanelStateListener = null;

function notifyViewPanelStateChange() {
    if (typeof _viewPanelStateListener === 'function') {
        _viewPanelStateListener({
            open: !!panel,
            sourceDocumentPath: _sourceDocumentPath
        });
    }
}

function openViewPanel(context, documentText, onComplete, sourceDocumentPath = null) {
    const queries = parseAllViewQueries(documentText);
    if (!queries) return;

    lastQuery = queries;
    _extUri = context.extensionUri;
    _contextNodeId = extractIdFromText(documentText);
    _sourceDocumentPath = sourceDocumentPath || null;
    if (onComplete) onCompleteCallback = onComplete;

    if (getIndex().size === 0 && vscode.workspace.workspaceFolders) {
        buildIndex(vscode.workspace.workspaceFolders);
    }

    if (!panel) {
        _panelState = null;
        panel = vscode.window.createWebviewPanel('yamlink.viewPanel', 'Yamlink View', vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'src', 'features')]
        });

        panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'openNode') {
                const fp = getIndex().get(msg.id);
                if (fp) {
                    const doc = await vscode.workspace.openTextDocument(fp);
                    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
                }
                return;
            }

            if (msg.command === 'editCell') {
                const ok = await writeFieldValue(msg.filePath, msg.field, msg.value);
                if (ok) syncIndexAfterWrite(msg.filePath);
                panel?.webview.postMessage({ command: 'editResult', ok, requestId: msg.requestId });
                if (ok) {
                    if (typeof onCompleteCallback === 'function') onCompleteCallback();
                    refreshViewPanel();
                }
                return;
            }

            if (msg.command === 'editCellsBulk') {
                const edits = Array.isArray(msg.edits) ? msg.edits : [];
                const results = [];
                let anySuccess = false;
                for (const edit of edits) {
                    const ok = await writeFieldValue(edit.filePath, edit.field, edit.value);
                    if (ok) {
                        anySuccess = true;
                        syncIndexAfterWrite(edit.filePath);
                    }
                    results.push({ requestId: edit.requestId, ok });
                }
                panel?.webview.postMessage({ command: 'bulkEditResult', results, source: msg.source || 'user' });
                if (anySuccess) {
                    if (typeof onCompleteCallback === 'function') onCompleteCallback();
                    refreshViewPanel();
                }
                return;
            }

            if (msg.command === 'saveState') {
                _panelState = msg.state;
                return;
            }

            if (msg.command === 'export') {
                await exportQueryResult(msg.format, msg.queryIndex, msg.visibleColumns || null);
                return;
            }

            if (msg.command === 'refineQuery') {
                if (!_sourceDocumentPath) {
                    vscode.window.showInformationMessage('Yamlink: This view was not opened from a note, so there is no source block to refine.');
                    return;
                }
                const doc = await vscode.workspace.openTextDocument(_sourceDocumentPath);
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
                await vscode.commands.executeCommand('yamlink.refineViewBlockAtIndex', doc, msg.queryIndex);
                const updatedQueries = parseAllViewQueries(doc.getText());
                if (updatedQueries) {
                    lastQuery = updatedQueries;
                    renderPanel(updatedQueries);
                }
                return;
            }
        }, null, context.subscriptions);

        panel.onDidDispose(() => {
            panel = null;
            _panelState = null;
            _sourceDocumentPath = null;
            notifyViewPanelStateChange();
        }, null, context.subscriptions);

        panel.onDidChangeViewState((e) => {
            if (e.webviewPanel.visible) renderPanel(lastQuery);
        }, null, context.subscriptions);
    }

    renderPanel(queries);
    notifyViewPanelStateChange();
}

function syncIndexAfterWrite(filePath) {
    if (!filePath) return;
    invalidateFileCache(filePath);
    const result = updateSingleFile(filePath, { force: true });
    if (result.needsFull && vscode.workspace.workspaceFolders) {
        buildIndex(vscode.workspace.workspaceFolders);
    }
}

function refreshViewPanel() {
    if (panel && lastQuery) renderPanel(lastQuery);
}

async function exportQueryResult(format, queryIndex, visibleColumns) {
    if (!lastQuery || !lastQuery[queryIndex]) return;
    const result = runQuery(lastQuery[queryIndex], _contextNodeId || null);
    if (!result.success) {
        vscode.window.showErrorMessage(result.error || 'Could not export view');
        return;
    }
    const columns = Array.isArray(visibleColumns) && visibleColumns.length ? visibleColumns : result.columns;
    const rows = result.rows.map(row => {
        const out = {};
        for (const col of columns) out[col] = col === 'id' ? row.id : (row.fields[col] ?? '');
        return out;
    });

    const uri = await vscode.window.showSaveDialog({
        filters: format === 'csv'
            ? { CSV: ['csv'] }
            : format === 'json'
                ? { JSON: ['json'] }
                : { PDF: ['pdf'] },
        saveLabel: format === 'csv' ? 'Export CSV' : format === 'json' ? 'Export JSON' : 'Export PDF'
    });
    if (!uri) return;

    if (format === 'pdf') {
        const model = buildViewExportModel(lastQuery[queryIndex], _contextNodeId || null);
        model.columns = columns;
        model.rows = rows;
        exportViewPdf(uri.fsPath, model);
        vscode.window.showInformationMessage(`Yamlink: Exported ${rows.length} row${rows.length === 1 ? '' : 's'} to PDF`);
        return;
    }

    const content = format === 'csv' ? toCsv(columns, rows) : JSON.stringify(rows, null, 2);
    fs.writeFileSync(uri.fsPath, content, 'utf8');
    vscode.window.showInformationMessage(`Yamlink: Exported ${rows.length} row${rows.length === 1 ? '' : 's'} to ${format.toUpperCase()}`);
}

function toCsv(columns, rows) {
    const esc = (v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = columns.map(esc).join(',');
    const body = rows.map(r => columns.map(c => esc(r[c])).join(',')).join('\n');
    return header + '\n' + body;
}

function renderPanel(queries) {
    if (!panel) return;
    const queryList = Array.isArray(queries) ? queries : [queries];
    const first = queryList[0];
    panel.title = queryList.length > 1
        ? `View · ${queryList.length} blocks`
        : (first.label || (first.type === '*' ? 'View · all nodes' : 'View · ' + first.type));
    const stateScriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(_extUri, 'src', 'features', 'viewPanelStateRuntime.js'));
    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(_extUri, 'src', 'features', 'viewPanelScript.js'));
    const nonce = require('crypto').randomBytes(16).toString('hex');
    const csp = panel.webview.cspSource;
    if (getIndex().size === 0) {
        panel.webview.html = buildEmptyHtml(queryList);
        return;
    }
    panel.webview.html = buildHtml(queryList, stateScriptUri, scriptUri, nonce, csp, _panelState);
}

function buildHtml(queryList, stateScriptUri, scriptUri, nonce, csp, panelState) {
    const allIds = [...getIndex().keys()];
    const idOpts = allIds.map(id => `<option value="${esc(id)}">`).join('');
    const activeTab = panelState?.activeTab ?? 0;
    const tabBtns = queryList
        .map((q, i) => `<button class="tab-btn${i === activeTab ? ' active' : ''}" data-tab="${i}">${esc(q.label || (q.type === '*' ? 'All nodes' : q.type))}</button>`)
        .join('');
    const panels = queryList
        .map((q, i) => buildPanel(q, i, activeTab, panelState?.tabs?.[i] || {}, _contextNodeId))
        .join('\n');

    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--vscode-editor-background,#141414);color:var(--vscode-editor-foreground,#c8c8c8);font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.tabbar{display:flex;background:var(--vscode-sideBar-background,#1a1a1a);border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);flex-shrink:0;overflow-x:auto}
.tab-btn{font-family:inherit;font-size:12px;color:#9aa0a6;background:none;border:none;border-bottom:2px solid transparent;padding:10px 16px;cursor:pointer;white-space:nowrap}
.tab-btn.active{color:#4fc4a0;border-bottom-color:#4fc4a0}
.tab-panel{flex:1;display:none;flex-direction:column;min-height:0}
.tab-panel.active{display:flex}
.filterbar{display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);background:var(--vscode-sideBar-background,#1a1a1a);flex-wrap:wrap}
.btn,.chip,.col-move{background:#1e2126;border:1px solid #30363d;border-radius:999px;color:#c8c8c8;padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit}
.btn:hover,.chip:hover,.chip.active,.col-move:hover{border-color:#4fc4a0;color:#4fc4a0}
.col-move{padding:2px 6px;font-size:10px;border-radius:6px}
.col-move[disabled]{opacity:.35;cursor:default}
.fsearch{margin-left:auto;min-width:180px;background:#111318;border:1px solid #30363d;border-radius:8px;padding:6px 10px;color:#ddd;outline:none;font:inherit}
.fcount{font-size:12px;color:#8b949e}
.table-summary{display:none;padding:8px 16px 0;color:#8b949e;font-size:12px}
.table-wrap{flex:1;overflow:auto;padding:0 16px 16px}
.toolbar-menu{display:none;position:absolute;background:#111318;border:1px solid #30363d;border-radius:8px;padding:10px;z-index:10;max-height:240px;overflow:auto}
.table-wrap table{width:max-content;min-width:100%;border-collapse:collapse;margin-top:12px}
.table-wrap thead th{position:sticky;top:0;background:var(--vscode-editor-background,#141414);font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.08em;padding:10px;text-align:left;border-bottom:1px solid #2a2a2a;white-space:nowrap;cursor:pointer;position:sticky}
.table-wrap thead th[data-col]{cursor:grab;user-select:none}
.table-wrap thead th[data-col].dragging{opacity:.45}
.table-wrap thead th[data-col].drag-over{box-shadow:inset 2px 0 0 #4fc4a0}
.table-wrap thead th[data-col].drag-over-after{box-shadow:inset -2px 0 0 #4fc4a0}
.th-label{display:block;overflow:hidden;text-overflow:ellipsis;padding-right:10px}
.col-resizer{position:absolute;top:0;right:-3px;width:8px;height:100%;cursor:col-resize;z-index:2}
.col-resizer:hover,.col-resizer.active{background:rgba(79,196,160,.28)}
.table-wrap tbody td{padding:10px;border-bottom:1px solid #23262b;font-size:12px;vertical-align:middle}
.table-wrap tbody tr:hover{background:rgba(255,255,255,.03)}
.cell-id{color:#6eb3f0;cursor:pointer;font-weight:600}
.cell-rel{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;background:rgba(79,196,160,.12);border:1px solid rgba(79,196,160,.35);color:#7ae3c2;white-space:nowrap;cursor:pointer}
.cell-bool{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;border:1px solid #355b4d;background:rgba(79,196,160,.12);color:#7ae3c2}
.cell-bool.false{border-color:#4b3b2f;background:rgba(229,169,106,.09);color:#e5a96a}
.cell-empty{color:#666;font-style:italic}
.cell-editable{cursor:text}
.cell-input,.cell-select{width:100%;background:#111318;border:1px solid #4fc4a0;border-radius:8px;padding:6px 8px;color:#e6edf3;font:inherit}
.cell-selected{outline:2px solid rgba(79,196,160,.75);outline-offset:-2px;background:rgba(79,196,160,.08)}
.live-bar{display:flex;justify-content:space-between;gap:8px;padding:6px 16px;border-top:1px solid #2a2a2a;background:#1a1a1a;color:#8b949e;font-size:11px}
.live-status{color:#8b949e}
.live-status.error{color:#e5a96a}
.live-status.success{color:#7ae3c2}
.hidden-col{display:none}
.empty-state{padding:36px 20px;text-align:center}
.empty-state-title{font-size:13px;font-weight:600;color:#c8c8c8;margin-bottom:8px}
.empty-state-copy{font-size:12px;color:#8b949e;line-height:1.7;max-width:520px;margin:0 auto}
.empty-state-copy code{background:#1e2126;border:1px solid #30363d;border-radius:6px;padding:1px 5px;color:#d8dee9}
.warning{padding:8px 16px;color:#e5a96a;font-size:12px}
.cell-actions-header{width:28px;padding:0;border-bottom:1px solid #2a2a2a}
.cell-actions{width:28px;padding:2px 4px;text-align:center;vertical-align:middle}
.revert-row-btn{background:none;border:none;color:#444;cursor:pointer;font-size:14px;padding:2px 4px;border-radius:4px;line-height:1;opacity:0;transition:opacity .15s}
tr:hover .revert-row-btn{opacity:1}
.revert-row-btn:hover{color:#e5a96a;background:rgba(229,169,106,.12)}
</style></head><body>
<datalist id="yids">${idOpts}</datalist>
<div class="tabbar">${tabBtns}</div>
${panels}
<div class="live-bar"><span>Double-click editable cells | click booleans twice to toggle | click relation pills to open</span></div>
<script nonce="${nonce}" src="${stateScriptUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
}

function buildEmptyHtml(queryList) {
    const tabBtns = queryList
        .map((q, i) => `<button class="tab-btn${i === 0 ? ' active' : ''}">${esc(q.label || (q.type === '*' ? 'All nodes' : q.type))}</button>`)
        .join('');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{background:#141414;color:#888;font-family:'Segoe UI',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}.tabbar{display:flex;border-bottom:1px solid #2a2a2a}.tab-btn{padding:10px 16px;background:none;border:none;color:#888}.tab-btn.active{color:#4fc4a0;border-bottom:2px solid #4fc4a0}.center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px}.msg{font-size:13px;color:#6f7781;text-align:center;line-height:1.6}.hint{font-size:11px;color:#555;text-align:center;line-height:1.6}</style></head><body><div class="tabbar">${tabBtns}</div><div class="center"><div class="msg">No indexed nodes found.</div><div class="hint">Add an <code style="background:#1e2126;padding:1px 5px;border-radius:4px">id:</code> field to your Markdown files and save to index them,<br>then run the view again.</div></div></body></html>`;
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
    const colMenu = columns.map((col, index) => `<label style="display:flex;gap:8px;align-items:center;padding:3px 0"><input type="checkbox" data-col-toggle="${esc(col)}" ${hiddenCols.has(col) ? '' : 'checked'}> <span>${esc(col)}</span><button class="col-move" data-col-move="left" data-col="${esc(col)}" ${index === 0 ? 'disabled' : ''}>&larr;</button><button class="col-move" data-col-move="right" data-col="${esc(col)}" ${index === columns.length - 1 ? 'disabled' : ''}>&rarr;</button></label>`).join('');
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

    return `<div class="tab-panel${isActive ? ' active' : ''}" data-tab="${idx}" style="display:${isActive ? 'flex' : 'none'}">${warningBanner}
<div class="filterbar"><span>${chips}</span><button class="btn refine-btn" data-query-index="${idx}">Refine view</button><button class="btn reset-btn">Reset view</button><button class="btn columns-btn">Columns</button><button class="btn export-btn" data-format="csv">Export CSV</button><button class="btn export-btn" data-format="json">Export JSON</button><button class="btn export-btn" data-format="pdf">Export PDF</button><input class="fsearch" type="text" placeholder="Search..." value="${esc(savedSearch)}"><span class="fcount" data-total-rows="${rows.length}"><strong>${rows.length}</strong> rows</span><div class="toolbar-menu">${colMenu}</div></div>
<div class="table-summary"></div>
<div class="no-visible-state" style="display:none;padding:16px;color:#8b949e;border-bottom:1px solid #23262b">No visible rows match the current search or filter. <button class="btn reset-btn" style="margin-left:8px">Reset view</button></div>
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
    if (query.direction === 'incoming') {
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

function extractIdFromText(text) {
    return extractCanonicalIdFromFrontmatter(text);
}

function isViewPanelOpen() { return panel !== null; }
function closeViewPanel() { if (panel) panel.dispose(); }
function getOpenViewDocumentPath() { return _sourceDocumentPath; }
function setViewPanelStateListener(listener) { _viewPanelStateListener = listener; }

module.exports = {
    openViewPanel,
    refreshViewPanel,
    isViewPanelOpen,
    closeViewPanel,
    getOpenViewDocumentPath,
    setViewPanelStateListener,
    parseAllViewQueries,
    parseViewQuery,
    writeFieldValue,
    normaliseTableDisplayValue,
    extractIdFromText
};
