'use strict';
const fs = require('fs');
const path = require('path');

const vscode = require('vscode');
const VIEW_CSS = fs.readFileSync(path.join(__dirname, 'viewPanel.css'), 'utf8');
const { perfTracker } = require('../../runtime/performanceTracker');
const { getIndex, getVaultGeneration } = require('../../core/indexService');
const { runQuery, buildQueryString } = require('../../engine/query');
const { getCachedQueryResult } = require('../../engine/queryCache');
const { getTodayIsoLocal } = require('../../core/date');
const { getEdges } = require('../../core/graph');
const { getRegistry } = require('../../registries/typeRegistry');
const {
    esc,
    repairUiText,
    normaliseTableDisplayValue,
    normalizeSavedSort,
    getRowFieldValue,
    applySavedColumnOrder,
    analyseColumns,
    collectColumnFilterValues,
    sortRowsForSavedSort,
    getTaskStatusPresentation,
    buildQuickFieldList,
    classifyQueryWarnings,
    buildTableEmptyStateTitle,
    buildEmptyStateHint
} = require('./viewTableLogic');

const LARGE_RESULT_THRESHOLD = 500;
const MATRIX_MAX_ROWS = 100;
const MATRIX_MAX_COLS = 50;
const SYSTEM_TYPES_MATRIX = new Set(['schema', 'dashboard', 'template']);

function buildMatrixGrid(rowNotes, colNotes, rowType, colType) {
    const visibleRows = rowNotes.slice(0, MATRIX_MAX_ROWS);
    const visibleCols = colNotes.slice(0, MATRIX_MAX_COLS);

    const colIdSet = new Set(visibleCols.map(c => c.id));
    const rowIdSet = new Set(visibleRows.map(r => r.id));
    const connected = new Set();
    for (const row of visibleRows) {
        for (const edge of (getEdges(row.id) || [])) {
            if (colIdSet.has(edge.targetId)) connected.add(`${row.id}\x00${edge.targetId}`);
        }
    }
    for (const col of visibleCols) {
        for (const edge of (getEdges(col.id) || [])) {
            if (rowIdSet.has(edge.targetId)) connected.add(`${edge.targetId}\x00${col.id}`);
        }
    }

    if (visibleRows.length === 0) return `<div class="matrix-empty">No ${esc(rowType)} notes found. Broaden your query to populate the rows.</div>`;
    if (visibleCols.length === 0) return `<div class="matrix-empty">No <strong>${esc(colType)}</strong> notes found in the vault. Add notes with <code>type: ${esc(colType)}</code> and they will appear as columns.</div>`;

    const connectedCount = connected.size;
    const truncateNote = (rowNotes.length > MATRIX_MAX_ROWS || colNotes.length > MATRIX_MAX_COLS)
        ? `<div class="matrix-truncate">Showing first ${visibleRows.length} ${esc(rowType)} rows \xd7 ${visibleCols.length} ${esc(colType)} columns. Use a <code>where</code> clause to narrow further.</div>`
        : '';

    const colHeaders = visibleCols.map(col =>
        `<th class="matrix-col-head" data-id="${esc(col.id)}" title="${esc(col.id)}">${esc(col.id)}</th>`
    ).join('');

    const bodyRows = visibleRows.map(row => {
        const cells = visibleCols.map(col => {
            const linked = connected.has(`${row.id}\x00${col.id}`);
            return `<td class="matrix-cell${linked ? ' linked' : ''}" data-row="${esc(row.id)}" data-col="${esc(col.id)}">${linked ? '●' : ''}</td>`;
        }).join('');
        return `<tr><th class="matrix-row-head" data-id="${esc(row.id)}" title="${esc(row.id)}">${esc(row.id)}</th>${cells}</tr>`;
    }).join('');

    return `${truncateNote}<div class="matrix-summary">${visibleRows.length} ${esc(rowType)} \xd7 ${visibleCols.length} ${esc(colType)} — ${connectedCount} connection${connectedCount !== 1 ? 's' : ''}</div><div class="matrix-wrap"><table class="matrix-table"><thead><tr><th class="matrix-corner"><span class="matrix-corner-row">${esc(rowType)}</span><span class="matrix-corner-col">${esc(colType)} →</span></th>${colHeaders}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
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
        .map((q, i) => `<button class="tab-btn${i === activeTab ? ' active' : ''}" id="tab-btn-${i}" data-tab="${i}" role="tab" aria-controls="tab-panel-${i}" aria-selected="${i === activeTab ? 'true' : 'false'}" tabindex="${i === activeTab ? '0' : '-1'}">${esc(q.label || (q.type === '*' ? 'All nodes' : q.type))}</button>`)
        .join('');
    const panels = queryList
        .map((q, i) => buildPanel(q, i, activeTab, panelState?.tabs?.[i] || {}, contextNodeId))
        .join('\n');

    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};">
<style>${VIEW_CSS}</style></head><body>
<datalist id="yids">${idOpts}</datalist>
<div class="tabbar" role="tablist" aria-label="View query tabs">${tabBtns}</div>
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
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>:root{--yl-bg:var(--vscode-editor-background,#141414);--yl-bg-elevated:var(--vscode-sideBar-background,#1a1a1a);--yl-bg-widget:var(--vscode-input-background,#111318);--yl-text:var(--vscode-editor-foreground,#c8c8c8);--yl-text-muted:var(--vscode-descriptionForeground,#8b949e);--yl-border:var(--vscode-panel-border,#2a2a2a);--yl-border-strong:var(--vscode-input-border,#30363d);--yl-accent:#5ECFBE}body{background:var(--yl-bg);color:var(--yl-text-muted);font-family:'Segoe UI',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}.tabbar{display:flex;border-bottom:1px solid var(--yl-border);background:var(--yl-bg-elevated)}.tab-btn{padding:10px 16px;background:none;border:none;color:var(--yl-text-muted)}.tab-btn.active{color:var(--yl-accent);border-bottom:2px solid var(--yl-accent)}.center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px}.msg{font-size:13px;color:var(--yl-text);text-align:center;line-height:1.6}.hint{font-size:11px;color:var(--yl-text-muted);text-align:center;line-height:1.6}.hint code{background:var(--yl-bg-widget);border:1px solid var(--yl-border-strong);padding:1px 5px;border-radius:4px;color:var(--yl-text)}</style></head><body><div class="tabbar">${tabBtns}</div><div class="center"><div class="msg">No indexed nodes found.</div><div class="hint">Add an <code>id:</code> field to your Markdown files and save to index them,<br>then run the view again.</div></div></body></html>`;
}

function formatQueryHeroText(text) {
    const escaped = esc(String(text || ''));
    return escaped
        .replace(/\b(FROM)\b/g, '<span class="q-from">$1</span>')
        .replace(/\b(WHERE|AND|OR)\b/g, '<span class="q-where">$1</span>')
        .replace(/\b(SORT|LIMIT|SELECT)\b/g, '<span class="q-sort">$1</span>');
}

function buildQuickFieldHtml(columns) {
    const fields = buildQuickFieldList(columns);
    return fields.length
        ? fields.map((field) => `<button type="button" class="quick-field-btn" data-quick-field="${esc(field)}">${esc(field)}</button>`).join('')
        : '';
}

function buildMetricCards({ rowCount, fieldCount }) {
    return [
        { icon: 'records', label: 'Rows', value: String(rowCount), sub: rowCount === 1 ? 'visible row' : 'visible rows' },
        { icon: 'fields', label: 'Fields', value: String(fieldCount), sub: fieldCount === 1 ? 'active column' : 'active columns' }
    ].map((metric) => `<div class="metric-card">${iconGlyph(metric.icon)}<div class="metric-card-value">${esc(metric.value)}</div><div class="metric-card-sub">${esc(metric.sub)}</div></div>`).join('');
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

function escapeHintForHtml(text) {
    return esc(String(text)).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function buildTableEmptyState(query, warnings) {
    const title = buildTableEmptyStateTitle(query, warnings);
    const hint = buildEmptyStateHint(query, warnings);
    return `<div class="empty-state-title">${esc(title)}</div><div class="empty-state-copy">${escapeHintForHtml(hint)}</div>`;
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

    const isLargeResult = sortedRows.length > LARGE_RESULT_THRESHOLD;
    let displayRows = sortedRows;
    let totalFilteredRows = sortedRows.length;

    if (isLargeResult) {
        const term = savedSearch.toLowerCase();
        if (term) {
            displayRows = displayRows.filter(row =>
                row.id.toLowerCase().includes(term) ||
                Object.values(row.fields).join(' ').toLowerCase().includes(term)
            );
        }
        if (savedFilter !== 'all') {
            displayRows = displayRows.filter(row => row.nodeType === savedFilter.slice(5));
        }
        for (const [col, filterRule] of Object.entries(tabState.columnFilters || {})) {
            if (!filterRule || !Array.isArray(filterRule.values) || !filterRule.values.length) continue;
            const filterSet = new Set(filterRule.values.map(v => String(v).trim().toLowerCase()));
            displayRows = displayRows.filter(row => {
                const cv = normaliseTableDisplayValue(meta[col]?.kind || 'text', getRowFieldValue(row, col)).toLowerCase();
                return filterRule.mode === 'exclude' ? !filterSet.has(cv) : filterSet.has(cv);
            });
        }
        totalFilteredRows = displayRows.length;
        if (savedPageSize > 0) {
            const totalPages = Math.max(1, Math.ceil(totalFilteredRows / savedPageSize));
            const safePage = Math.max(1, Math.min(savedPage, totalPages));
            displayRows = displayRows.slice((safePage - 1) * savedPageSize, safePage * savedPageSize);
        }
    }

    const warningBanner = warnings.length ? buildWarningBanner(query, warnings) : '';
    const chips = `<button class="chip${savedFilter === 'all' ? ' active' : ''}" data-filter="all">All</button>` + types.map(t => `<button class="chip${savedFilter === `type:${t}` ? ' active' : ''}" data-filter="type:${esc(t)}">${esc(t)}</button>`).join('');
    const colMenu = columns.map((col, index) => `<label class="col-menu-item"><input type="checkbox" data-col-toggle="${esc(col)}" ${hiddenCols.has(col) ? '' : 'checked'}> <span>${esc(col)}</span><button class="col-move" data-col-move="left" data-col="${esc(col)}" ${index === 0 ? 'disabled' : ''}>&larr;</button><button class="col-move" data-col-move="right" data-col="${esc(col)}" ${index === columns.length - 1 ? 'disabled' : ''}>&rarr;</button></label>`).join('');
    const columnWidths = tabState.columnWidths || {};
    const quickFieldHtml = buildQuickFieldHtml(columns);
    const scopeLabel = query.incoming ? 'Incoming' : (query.type === '*' ? 'Vault' : query.type);
    const viewLabel = query.label || (query.type === '*' ? 'All notes' : query.type);
    const metricsCardHtml = buildMetricCards({ rowCount: rows.length, fieldCount: columns.length });
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
        const headerLabel = query.type === 'tasks' && col === 'done' ? 'status' : col;
        const filterMenu = cellMeta.filterOptions.length
            ? `<div class="th-filter-menu" data-col-filter-menu="${esc(col)}" role="dialog" aria-label="Filter ${esc(headerLabel)}" hidden><div class="th-filter-title">${esc(col)}</div>${cellMeta.filterOptions.map((value) => `<label class="th-filter-option"><input type="checkbox" data-col-filter-value="${esc(col)}" value="${esc(value)}"> <span>${esc(value)}</span></label>`).join('')}<div class="th-filter-actions"><button type="button" class="th-filter-clear" data-col-filter-clear="${esc(col)}">Clear</button></div></div>`
            : `<div class="th-filter-menu" data-col-filter-menu="${esc(col)}" role="dialog" aria-label="Filter ${esc(headerLabel)}" hidden><div class="th-filter-title">${esc(col)}</div><div class="th-filter-empty">No values</div></div>`;
        return `<th draggable="true" data-col="${esc(col)}" data-kind="${esc(cellMeta.kind)}"${ascAttr}${style} class="${[hiddenCols.has(col) ? 'hidden-col' : '', sortedClass].filter(Boolean).join(' ')}" title="Drag to reorder"><div class="th-head"><span class="th-label">${esc(headerLabel)}</span><span class="th-tools"><span class="sarr">↕</span><button type="button" class="th-filter-btn" data-col-filter-toggle="${esc(col)}" aria-label="Filter ${esc(headerLabel)}" aria-haspopup="dialog" aria-expanded="false">▾</button></span></div>${filterMenu}<span class="col-resizer" data-col-resizer="${esc(col)}" title="Resize column"></span></th>`;
    }).join('') + `<th class="cell-actions-header"></th>`;

    const rowsToRender = isLargeResult ? displayRows : sortedRows;
    const bodyRows = rowsToRender.length
        ? rowsToRender.map((row, rowIndex) => {
            const cells = columns.map(col => {
                const cellMeta = meta[col] || { kind: 'text', options: [] };
                const raw = col === 'id' ? row.id : String(row.fields[col] ?? '');
                const display = normaliseTableDisplayValue(cellMeta.kind, raw);
                const hiddenClass = hiddenCols.has(col) ? ' hidden-col' : '';
                const filterAttr = ` data-filter-value="${esc(display)}"`;
                const sortAttr = ` data-sort-value="${esc(display)}"`;

                if (col === 'id') {
                    return `<td class="${hiddenClass}" data-filter-value="${esc(row.id)}" data-sort-value="${esc(row.id)}"><button type="button" class="cell-id" data-id="${esc(row.id)}" aria-label="Open note ${esc(row.id)}">${esc(row.id)}</button></td>`;
                }

                if (row.nodeType === 'tasks') {
                    if (col === 'done') {
                        const status = getTaskStatusPresentation(row, todayIso);
                        const lineNum = String(row.fields.line || '0');
                        return `<td class="cell-task-done${hiddenClass}" data-filepath="${esc(row.filePath)}" data-line="${esc(lineNum)}" data-value="${esc(status.key)}" data-filter-value="${esc(status.filterValue)}" data-sort-value="${esc(status.sortValue)}" role="button" tabindex="0" aria-pressed="${status.key === 'done' ? 'true' : 'false'}" aria-label="Mark task as ${status.key === 'done' ? 'not done' : 'done'}"><span class="cell-bool ${esc(status.className)}">${esc(status.label)}</span></td>`;
                    }
                    return `<td class="${hiddenClass}"${filterAttr}${sortAttr}>${raw ? esc(display) : '<span class="cell-empty">-</span>'}</td>`;
                }

                if (!raw) {
                    return `<td class="cell-empty cell-editable${hiddenClass}" data-edit-mode="text" data-filepath="${esc(row.filePath)}" data-field="${esc(col)}" data-value="">-</td>`;
                }
                if (cellMeta.kind === 'relation') {
                    const rels = [...raw.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
                    if (rels.length === 1) {
                        return `<td class="cell-editable${hiddenClass}" data-edit-mode="relation" data-filepath="${esc(row.filePath)}" data-field="${esc(col)}" data-value="${esc(rels[0])}"><button type="button" class="cell-rel" data-id="${esc(rels[0])}" aria-label="Open related note ${esc(rels[0])}">${esc(rels[0])}</button></td>`;
                    }
                    return `<td class="${hiddenClass}"${filterAttr}${sortAttr}>${rels.map(r => `<button type="button" class="cell-rel" data-id="${esc(r)}" aria-label="Open related note ${esc(r)}">${esc(r)}</button>`).join(' ')}</td>`;
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

            let hidden = false;
            if (!isLargeResult) {
                const matchesSearch = !savedSearch || row.id.toLowerCase().includes(savedSearch.toLowerCase()) || Object.values(row.fields).join(' ').toLowerCase().includes(savedSearch.toLowerCase());
                const matchesFilter = savedFilter === 'all' || row.nodeType === savedFilter.slice(5);
                hidden = !(matchesSearch && matchesFilter);
            }
            const revertCell = `<td class="cell-actions"><button class="revert-row-btn" data-filepath="${esc(row.filePath)}" title="Revert row changes">↩</button></td>`;
            return `<tr data-type="${esc(row.nodeType)}" data-row-index="${rowIndex}" ${hidden ? 'style="display:none"' : ''}>${cells}${revertCell}</tr>`;
        }).join('')
        : `<tr><td colspan="${columns.length + 1}" class="empty-state">${buildTableEmptyState(query, warnings)}</td></tr>`;

    // ── Matrix layout ──────────────────────────────────────────────────────────
    const isMatrixMode = tabState.layout === 'matrix';
    const matrixColType = tabState.matrixColType || '';
    const allVaultTypes = [...getRegistry().keys()].filter(t => !SYSTEM_TYPES_MATRIX.has(t.toLowerCase())).sort();
    const matrixColOptions = allVaultTypes.map(t =>
        `<option value="${esc(t)}"${t === matrixColType ? ' selected' : ''}>${esc(t)}</option>`
    ).join('');
    const layoutToggleBtns = `<div class="layout-toggle" role="group" aria-label="Layout mode"><button class="layout-btn${!isMatrixMode ? ' active' : ''}" data-layout-btn="table" aria-pressed="${!isMatrixMode}">Table</button><button class="layout-btn${isMatrixMode ? ' active' : ''}" data-layout-btn="matrix" aria-pressed="${isMatrixMode}">Matrix</button></div>`;
    const matrixPickerHtml = isMatrixMode
        ? `<div class="matrix-col-picker"><span class="matrix-col-label">Columns</span><select class="matrix-col-select" data-matrix-col-select aria-label="Matrix column type"><option value="">Pick a type…</option>${matrixColOptions}</select></div>`
        : '';
    const layoutGroupHtml = isMatrixMode
        ? `<div class="toolbar-group group-layout"><div class="toolbar-group-label">${iconGlyph('layout')}Layout</div><div class="toolbar-group-row">${layoutToggleBtns}${matrixPickerHtml}</div></div>`
        : `<div class="toolbar-group group-layout"><div class="toolbar-group-label">${iconGlyph('layout')}Layout</div><div class="toolbar-group-row">${layoutToggleBtns}<button class="btn columns-btn" type="button" aria-haspopup="dialog" aria-expanded="false">Columns</button></div><div class="toolbar-menu" role="dialog" aria-label="Choose visible columns" hidden>${colMenu}</div></div>`;

    if (isMatrixMode) {
        let matrixContent = '';
        if (!matrixColType) {
            matrixContent = `<div class="matrix-prompt"><div class="matrix-prompt-title">Choose column type</div><div class="matrix-prompt-copy">Use the Columns picker in the Layout section to choose what appears as columns. Each row will be a <strong>${esc(query.type || 'note')}</strong>, each column a note of the chosen type, and each ● marks a connection between them.</div></div>`;
        } else {
            const colQueryText = buildQueryString(/** @type {any} */({ type: matrixColType }));
            const colResult = getCachedQueryResult(colQueryText + '\x00mx', vaultGeneration, todayIso, () => runQuery(/** @type {any} */({ type: matrixColType }), null));
            const colRows = colResult.success ? colResult.rows : [];
            matrixContent = buildMatrixGrid(rows, colRows, query.type || '*', matrixColType);
        }
        return `<div class="tab-panel${isActive ? ' active' : ''}" id="tab-panel-${idx}" role="tabpanel" aria-labelledby="tab-btn-${idx}" data-tab="${idx}" data-layout="matrix" data-matrix-col-type="${esc(matrixColType)}" data-column-filters="${esc(JSON.stringify(tabState.columnFilters || {}))}" data-current-page="1" data-page-size="50" style="display:${isActive ? 'flex' : 'none'}"${isActive ? '' : ' hidden'}><div class="view-shell">${warningBanner}
<div class="query-hero"><div class="query-hero-top"><div class="query-hero-title">Matrix View</div><div class="query-hero-subtle">${esc(viewLabel)}${matrixColType ? ` \xd7 ${esc(matrixColType)}` : ''}</div></div><div class="query-hero-query"><span class="query-hero-query-label">${iconGlyph('query')}Query</span><code>${formatQueryHeroText(queryText)}</code></div><div class="query-hero-meta"><span class="query-hero-badge">${esc(scopeLabel)}</span><span class="query-hero-badge">${rows.length} row${rows.length === 1 ? '' : 's'}</span></div></div>
<div class="query-toolbar">
<div class="toolbar-group group-view"><div class="toolbar-group-label">${iconGlyph('view')}View</div><div class="toolbar-group-row"><button class="btn report-btn">Open report</button><button class="btn reset-btn">Reset view</button></div></div>
<div class="toolbar-group group-filters"><div class="toolbar-group-label">${iconGlyph('filters')}Filters</div><div class="toolbar-group-row"><button class="btn refine-btn" data-query-index="${idx}">Refine view</button></div></div>
${layoutGroupHtml}
</div>
${matrixContent}</div></div>`;
    }

    return `<div class="tab-panel${isActive ? ' active' : ''}" id="tab-panel-${idx}" role="tabpanel" aria-labelledby="tab-btn-${idx}" data-tab="${idx}" data-layout="table" data-matrix-col-type="" data-column-filters="${esc(JSON.stringify(tabState.columnFilters || {}))}" data-current-page="${savedPage}" data-page-size="${savedPageSize}"${isLargeResult ? ` data-large-result="true" data-total-filtered-rows="${totalFilteredRows}"` : ''} style="display:${isActive ? 'flex' : 'none'}"${isActive ? '' : ' hidden'}><div class="view-shell">${warningBanner}
<div class="query-hero"><div class="query-hero-top"><div class="query-hero-title">Table View</div><div class="query-hero-subtle">${esc(viewLabel)}</div></div><div class="query-hero-query"><span class="query-hero-query-label">${iconGlyph('query')}Query</span><code>${formatQueryHeroText(queryText)}</code></div><div class="query-hero-meta"><span class="query-hero-badge">${esc(scopeLabel)}</span><span class="query-hero-badge">${rows.length} row${rows.length === 1 ? '' : 's'}</span></div></div>
<div class="query-toolbar">
<div class="toolbar-group group-scope"><div class="toolbar-group-label">${iconGlyph('scope')}Scope</div><div class="toolbar-group-row"><div class="toolbar-chip-stack">${chips}</div></div></div>
<div class="toolbar-group group-view"><div class="toolbar-group-label">${iconGlyph('view')}View</div><div class="toolbar-group-row"><button class="btn report-btn">Open report</button><button class="btn reset-btn">Reset view</button></div></div>
<div class="toolbar-group group-filters"><div class="toolbar-group-label">${iconGlyph('filters')}Filters</div><div class="toolbar-group-row"><button class="btn refine-btn" data-query-index="${idx}">Refine view</button><button class="btn filter-selection-btn">Filter by selection</button><button class="btn exclude-selection-btn">Exclude selection</button><button class="btn clear-column-filters-btn">Clear quick filters</button></div></div>
${layoutGroupHtml}
<div class="toolbar-group group-export"><div class="toolbar-group-label">${iconGlyph('export')}Export</div><div class="toolbar-group-row"><button class="btn export-btn" data-format="csv">CSV</button><button class="btn export-btn" data-format="json">JSON</button><button class="btn export-btn" data-format="pdf">PDF</button></div></div>
</div>
<div class="metrics-strip"><div class="metrics-card">${metricsCardHtml}</div><div class="quick-fields-card"><div class="quick-fields-row">${quickFieldHtml}</div><div class="quick-fields-search">${iconGlyph('search')}<input class="fsearch" type="text" placeholder="Search records..." value="${esc(savedSearch)}" aria-label="Search table records"></div></div></div>
<div class="table-summary"></div>
<div class="table-filters"></div>
<div class="table-pagination" hidden><div class="table-pagination-group"><button class="table-pagination-btn" data-page-nav="prev">Previous</button><span class="table-pagination-status">Page 1 of 1</span><button class="table-pagination-btn" data-page-nav="next">Next</button></div><div class="table-pagination-group"><span class="table-pagination-label">Rows per page</span><select class="table-pagination-select" data-page-size><option value="50"${savedPageSize === 50 ? ' selected' : ''}>50</option><option value="100"${savedPageSize === 100 ? ' selected' : ''}>100</option><option value="200"${savedPageSize === 200 ? ' selected' : ''}>200</option><option value="0"${savedPageSize === 0 ? ' selected' : ''}>All</option></select></div></div>
<div class="no-visible-state">No visible rows match the current search or filter. <button class="btn reset-btn">Reset view</button></div>
<div class="table-wrap"><table>${colGroup}<thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div></div></div>`;
}

module.exports = {
    renderPanel,
    formatQueryHeroText,
    buildWarningBanner,
    buildMatrixGrid
};
