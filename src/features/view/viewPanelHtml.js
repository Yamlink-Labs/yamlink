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
const CHART_PALETTE = ['#5ECFBE', '#E7A85A', '#C5FFBF', '#C49BF0', '#FF429F', '#9BB4FF', '#8899AA'];

function serialiseForInlineScript(value) {
    return JSON.stringify(value).replace(/<\//g, '<\\/');
}

function getChartColor(index) {
    return CHART_PALETTE[index % CHART_PALETTE.length];
}

function getTypeColorMap(types) {
    const ordered = (types || []).slice().sort();
    const map = new Map();
    ordered.forEach((type, index) => {
        map.set(type, getChartColor(index));
    });
    return map;
}

function buildInfoCardHtml(title, copy) {
    return `<div class="chart-info-card"><div class="chart-info-title">${esc(title)}</div><div class="chart-info-copy">${copy}</div></div>`;
}

function coerceScatterValue(raw, kind) {
    if (raw == null || raw === '') return null;
    if (kind === 'number') {
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }
    if (kind === 'date') {
        const value = Date.parse(String(raw));
        return Number.isFinite(value) ? value : null;
    }
    return null;
}

function buildScatterAxisCandidates(columns, meta) {
    return columns.filter((field) => {
        if (field === 'id') return false;
        const kind = meta[field]?.kind || 'text';
        return kind === 'number' || kind === 'date';
    });
}

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
    const chartScriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'features', 'view', 'vendor', 'chart.umd.min.js'));
    const nonce = require('crypto').randomBytes(16).toString('hex');
    const csp = panel.webview.cspSource;
    if (getIndex().size === 0) {
        panel.webview.html = repairUiText(buildEmptyHtml(queryList));
        return;
    }
        panel.webview.html = perfTracker.measureSync('view.buildHtml', {
            queryCount: queryList.length
        }, () => repairUiText(buildHtml(queryList, stateScriptUri, valueRuntimeScriptUri, editRuntimeScriptUri, uiRuntimeScriptUri, scriptUri, chartScriptUri, nonce, csp, panelState, preferredTab, contextNodeId)));
}

function buildHtml(queryList, stateScriptUri, valueRuntimeScriptUri, editRuntimeScriptUri, uiRuntimeScriptUri, scriptUri, chartScriptUri, nonce, csp, panelState, preferredTab = null, contextNodeId = null) {
    const allIds = [...getIndex().keys()];
    const idOpts = allIds.map(id => `<option value="${esc(id)}">`).join('');
    const activeTab = (preferredTab !== null && preferredTab !== undefined)
        ? Math.min(preferredTab, queryList.length - 1)
        : (panelState?.activeTab ?? 0);
    const tabBtns = queryList
        .map((q, i) => `<button class="tab-btn${i === activeTab ? ' active' : ''}" id="tab-btn-${i}" data-tab="${i}" role="tab" aria-controls="tab-panel-${i}" aria-selected="${i === activeTab ? 'true' : 'false'}" tabindex="${i === activeTab ? '0' : '-1'}">${esc(q.label || (q.type === '*' ? 'All nodes' : q.type))}</button>`)
        .join('');
    const panels = queryList
        .map((q, i) => buildPanel(q, i, activeTab, panelState?.tabs?.[i] || {}, contextNodeId, nonce))
        .join('\n');

    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};">
<script nonce="${nonce}" src="${chartScriptUri}"></script>
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

function buildLayoutToggleButtons(activeLayout, opts = {}) {
    const layouts = [
        ['table', 'Table', false],
        ['matrix', 'Matrix', false],
        ['bar', 'Bar', false],
        ['scatter', 'Scatter', !!opts.scatterDisabled]
    ];
    return `<div class="layout-toggle" role="group" aria-label="Layout mode">${layouts.map(([layout, label, disabled]) =>
        `<button class="layout-btn${activeLayout === layout ? ' active' : ''}"${disabled ? ' disabled title="No numeric or date fields in this result"' : ''} data-layout-btn="${layout}" aria-pressed="${activeLayout === layout}">${label}</button>`
    ).join('')}</div>`;
}

function buildBarChartHtml({ idx, groups, groupField, nonce }) {
    if (!groupField || !Array.isArray(groups)) {
        return buildInfoCardHtml('Bar chart unavailable', 'Bar chart requires a <code>group by</code> clause.');
    }
    const labels = groups.map((group) => group.key === '' ? '(empty)' : group.key);
    const counts = groups.map((group) => group.count);
    const colors = groups.map((_, index) => getChartColor(index));
    const canvasId = `view-chart-bar-${idx}`;
    const config = {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: groupField,
                data: counts,
                backgroundColor: colors,
                borderColor: colors,
                borderWidth: 1.2,
                borderRadius: 10,
                borderSkipped: false,
                maxBarThickness: 42
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: labels.length > 8 ? 'y' : 'x',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#111318',
                    borderColor: 'rgba(94,207,190,0.22)',
                    borderWidth: 1,
                    titleColor: '#e6edf3',
                    bodyColor: '#c8c8c8',
                    displayColors: false
                }
            },
            scales: {
                x: {
                    ticks: { color: '#8b949e' },
                    grid: { color: 'rgba(136,153,170,0.14)' },
                    border: { color: 'rgba(136,153,170,0.22)' }
                },
                y: {
                    ticks: { color: '#8b949e' },
                    grid: { color: 'rgba(136,153,170,0.10)' },
                    border: { color: 'rgba(136,153,170,0.22)' }
                }
            }
        }
    };
    return `<div class="chart-surface"><div class="chart-surface-head"><div><div class="chart-surface-title">Bar chart</div><div class="chart-surface-copy">Grouped by <code>${esc(groupField)}</code> across ${groups.length} bucket${groups.length === 1 ? '' : 's'}.</div></div></div><div class="chart-canvas-wrap"><canvas id="${canvasId}" class="chart-canvas" aria-label="Bar chart for ${esc(groupField)}" role="img"></canvas></div></div><script nonce="${nonce}">(() => { const canvas = document.getElementById(${serialiseForInlineScript(canvasId)}); if (!canvas || !window.Chart) return; const ctx = canvas.getContext('2d'); new window.Chart(ctx, ${serialiseForInlineScript(config)}); })();</script>`;
}

function buildScatterChartHtml({ idx, rows, columns, meta, xField, yField, types, nonce }) {
    const axisFields = buildScatterAxisCandidates(columns, meta);
    if (!axisFields.length) {
        return buildInfoCardHtml('Scatter chart unavailable', 'Scatter chart needs numeric or date fields in the result.');
    }
    const selectedX = xField || axisFields[0] || '';
    const selectedY = yField || axisFields[1] || axisFields[0] || '';
    const picker = `<div class="scatter-axis-picker"><label class="scatter-axis-label">X axis <select data-scatter-axis="x" class="scatter-axis-select"><option value="">Choose field…</option>${axisFields.map((field) => `<option value="${esc(field)}"${field === selectedX ? ' selected' : ''}>${esc(field)}</option>`).join('')}</select></label><label class="scatter-axis-label">Y axis <select data-scatter-axis="y" class="scatter-axis-select"><option value="">Choose field…</option>${axisFields.map((field) => `<option value="${esc(field)}"${field === selectedY ? ' selected' : ''}>${esc(field)}</option>`).join('')}</select></label></div>`;
    const xKind = meta[selectedX]?.kind || 'text';
    const yKind = meta[selectedY]?.kind || 'text';
    if (!['number', 'date'].includes(xKind) || !['number', 'date'].includes(yKind)) {
        return `<div class="chart-surface"><div class="chart-surface-head"><div><div class="chart-surface-title">Scatter chart</div><div class="chart-surface-copy"><code>${esc(selectedX)}</code> and <code>${esc(selectedY)}</code> must be numeric or date fields.</div></div></div>${picker}</div>`;
    }

    const typeColors = getTypeColorMap(types.length ? types : [...new Set(rows.map((row) => row.nodeType || 'unknown'))]);
    const datasetsByType = new Map();
    for (const row of rows) {
        const xValue = coerceScatterValue(selectedX === 'id' ? row.id : row.fields[selectedX], xKind);
        const yValue = coerceScatterValue(selectedY === 'id' ? row.id : row.fields[selectedY], yKind);
        if (xValue == null || yValue == null) continue;
        const type = row.nodeType || 'unknown';
        if (!datasetsByType.has(type)) {
            const color = typeColors.get(type) || getChartColor(datasetsByType.size);
            datasetsByType.set(type, {
                label: type,
                data: [],
                backgroundColor: color,
                borderColor: color,
                pointRadius: 5,
                pointHoverRadius: 6
            });
        }
        datasetsByType.get(type).data.push({
            x: xValue,
            y: yValue,
            label: row.fields.name || row.fields.title || row.id,
            id: row.id
        });
    }
    const datasets = [...datasetsByType.values()].filter((dataset) => dataset.data.length);
    if (!datasets.length) {
        return `<div class="chart-surface"><div class="chart-surface-head"><div><div class="chart-surface-title">Scatter chart</div><div class="chart-surface-copy">No rows have values for both <code>${esc(selectedX)}</code> and <code>${esc(selectedY)}</code>.</div></div></div>${picker}</div>`;
    }
    const canvasId = `view-chart-scatter-${idx}`;
    const dataConfig = {
        datasets
    };
    const xIsDate = xKind === 'date';
    const yIsDate = yKind === 'date';
    return `<div class="chart-surface"><div class="chart-surface-head"><div><div class="chart-surface-title">Scatter chart</div><div class="chart-surface-copy">Plotting <code>${esc(selectedX)}</code> against <code>${esc(selectedY)}</code> across ${rows.length} row${rows.length === 1 ? '' : 's'}.</div></div>${picker}</div><div class="chart-canvas-wrap"><canvas id="${canvasId}" class="chart-canvas" aria-label="Scatter chart for ${esc(selectedX)} and ${esc(selectedY)}" role="img"></canvas></div></div><script nonce="${nonce}">(() => { const canvas = document.getElementById(${serialiseForInlineScript(canvasId)}); if (!canvas || !window.Chart) return; const ctx = canvas.getContext('2d'); new window.Chart(ctx, { type: 'scatter', data: ${serialiseForInlineScript(dataConfig)}, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#c8c8c8', usePointStyle: true, boxWidth: 10, boxHeight: 10 } }, tooltip: { backgroundColor: '#111318', borderColor: 'rgba(94,207,190,0.22)', borderWidth: 1, titleColor: '#e6edf3', bodyColor: '#c8c8c8', callbacks: { title(items) { return items[0]?.raw?.label || items[0]?.raw?.id || ''; }, label(context) { const raw = context.raw || {}; const xv = ${xIsDate} ? new Date(raw.x).toISOString().slice(0, 10) : raw.x; const yv = ${yIsDate} ? new Date(raw.y).toISOString().slice(0, 10) : raw.y; return ${serialiseForInlineScript(selectedX)} + ': ' + xv + ' · ' + ${serialiseForInlineScript(selectedY)} + ': ' + yv; } } } }, scales: { x: { ticks: { color: '#8b949e', callback(value) { return ${xIsDate} ? new Date(value).toISOString().slice(0, 10) : value; } }, grid: { color: 'rgba(136,153,170,0.14)' }, border: { color: 'rgba(136,153,170,0.22)' }, title: { display: true, text: ${serialiseForInlineScript(selectedX)}, color: '#8b949e' } }, y: { ticks: { color: '#8b949e', callback(value) { return ${yIsDate} ? new Date(value).toISOString().slice(0, 10) : value; } }, grid: { color: 'rgba(136,153,170,0.10)' }, border: { color: 'rgba(136,153,170,0.22)' }, title: { display: true, text: ${serialiseForInlineScript(selectedY)}, color: '#8b949e' } } } } }); })();</script>`;
}

function buildPanel(query, idx, activeTab, tabState, contextNodeId, nonce) {
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
    const activeLayout = ['table', 'matrix', 'bar', 'scatter'].includes(tabState.layout) ? tabState.layout : 'table';
    let layoutToggleBtns = buildLayoutToggleButtons(activeLayout, { scatterDisabled: !!result.groupBy });
    const scopeLabel = query.incoming ? 'Incoming' : (query.type === '*' ? 'Vault' : query.type);
    const viewLabel = query.label || (query.type === '*' ? 'All notes' : query.type);
    const heroTitle = {
        table: 'Table View',
        matrix: 'Matrix View',
        bar: 'Bar Chart',
        scatter: 'Scatter Plot'
    }[activeLayout] || 'Table View';
    const heroMetaCount = result.groupBy
        ? `${(result.groups || []).length} group${(result.groups || []).length === 1 ? '' : 's'}`
        : `${rows.length} row${rows.length === 1 ? '' : 's'}`;

    if (result.groupBy) {
        const groupField = result.groupBy;
        const groups = result.groups || [];
        const warningBanner = warnings.length ? buildWarningBanner(query, warnings) : '';
        const groupBodyRows = groups.length
            ? groups.map(g => `<tr><td>${g.key === '' ? '<span class="cell-empty">-</span>' : esc(g.key)}</td><td>${g.count}</td></tr>`).join('')
            : `<tr><td colspan="2" class="empty-state">${buildTableEmptyState(query, warnings)}</td></tr>`;
        const groupedLayoutHtml = activeLayout === 'bar'
            ? buildBarChartHtml({ idx, groups, groupField, nonce })
            : activeLayout === 'table'
                ? `<div class="table-wrap"><table><colgroup><col><col style="width:80px"></colgroup><thead><tr><th>${esc(groupField)}</th><th>count</th></tr></thead><tbody>${groupBodyRows}</tbody></table></div>`
                : buildInfoCardHtml(
                    activeLayout === 'scatter' ? 'Scatter chart unavailable' : 'Matrix view unavailable',
                    activeLayout === 'scatter'
                        ? 'Scatter chart works with row results. Use a standard <code>!view</code> result with numeric or date fields.'
                        : 'Matrix view works on row results, not grouped summaries.'
                );
        return `<div class="tab-panel${isActive ? ' active' : ''}" id="tab-panel-${idx}" role="tabpanel" aria-labelledby="tab-btn-${idx}" data-tab="${idx}" data-layout="${esc(activeLayout)}" data-matrix-col-type="" data-scatter-x="${esc(tabState.scatterX || '')}" data-scatter-y="${esc(tabState.scatterY || '')}" data-column-filters="${esc(JSON.stringify(tabState.columnFilters || {}))}" data-current-page="1" data-page-size="50" style="display:${isActive ? 'flex' : 'none'}"${isActive ? '' : ' hidden'}><div class="view-shell">${warningBanner}<div class="query-hero"><div class="query-hero-top"><div class="query-hero-title">${heroTitle}</div><div class="query-hero-subtle">${esc(viewLabel)}</div></div><div class="query-hero-query"><span class="query-hero-query-label">${iconGlyph('query')}Query</span><code>${formatQueryHeroText(queryText)}</code></div><div class="query-hero-meta"><span class="query-hero-badge">${esc(scopeLabel)}</span><span class="query-hero-badge">${heroMetaCount}</span></div></div><div class="query-toolbar"><div class="toolbar-group group-view"><div class="toolbar-group-label">${iconGlyph('view')}View</div><div class="toolbar-group-row"><button class="btn report-btn">Open report</button><button class="btn reset-btn">Reset view</button></div></div><div class="toolbar-group group-filters"><div class="toolbar-group-label">${iconGlyph('filters')}Filters</div><div class="toolbar-group-row"><button class="btn refine-btn" data-query-index="${idx}">Refine view</button></div></div><div class="toolbar-group group-layout"><div class="toolbar-group-label">${iconGlyph('layout')}Layout</div><div class="toolbar-group-row">${layoutToggleBtns}</div></div><div class="toolbar-group group-export"><div class="toolbar-group-label">${iconGlyph('export')}Export</div><div class="toolbar-group-row"><button class="btn export-btn" data-format="csv">CSV</button><button class="btn export-btn" data-format="json">JSON</button></div></div></div>${groupedLayoutHtml}</div></div>`;
    }

    const columns = applySavedColumnOrder(result.columns, tabState.columnOrder);
    const meta = analyseColumns(rows, columns, query);
    const hasNumericOrDate = Object.values(meta).some(m => m.kind === 'number' || m.kind === 'date');
    layoutToggleBtns = buildLayoutToggleButtons(activeLayout, { scatterDisabled: !hasNumericOrDate });
    const savedSearch = tabState.search || '';
    const savedSort = normalizeSavedSort(tabState.sort);
    const savedFilter = tabState.filter || 'all';
    const savedPage = Math.max(1, Number(tabState.page || 1));
    const savedPageSize = Math.max(0, Number(tabState.pageSize || 50));
    const hiddenCols = new Set(tabState.hiddenCols || []);
    const scatterX = tabState.scatterX || '';
    const scatterY = tabState.scatterY || '';
    const barGroupBy = tabState.barGroupBy || '';

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

    // ── Matrix / chart layout ─────────────────────────────────────────────────
    const isMatrixMode = activeLayout === 'matrix';
    const matrixColType = tabState.matrixColType || '';
    const allVaultTypes = [...getRegistry().keys()].filter(t => !SYSTEM_TYPES_MATRIX.has(t.toLowerCase())).sort();
    const matrixColOptions = allVaultTypes.map(t =>
        `<option value="${esc(t)}"${t === matrixColType ? ' selected' : ''}>${esc(t)}</option>`
    ).join('');
    const matrixPickerHtml = isMatrixMode
        ? `<div class="matrix-col-picker"><span class="matrix-col-label">Columns</span><select class="matrix-col-select" data-matrix-col-select aria-label="Matrix column type"><option value="">Pick a type…</option>${matrixColOptions}</select></div>`
        : '';
    const isBarMode = activeLayout === 'bar';
    const barGroupableFields = columns.filter(c => c !== 'id');
    const barPickerHtml = isBarMode
        ? `<div class="matrix-col-picker"><span class="matrix-col-label">Group by</span><select class="matrix-col-select" data-bar-group-select aria-label="Bar chart group field"><option value="">Pick a field…</option>${barGroupableFields.map(f => `<option value="${esc(f)}"${f === barGroupBy ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></div>`
        : '';
    const layoutGroupHtml = isMatrixMode
        ? `<div class="toolbar-group group-layout"><div class="toolbar-group-label">${iconGlyph('layout')}Layout</div><div class="toolbar-group-row">${layoutToggleBtns}${matrixPickerHtml}</div></div>`
        : activeLayout === 'table'
            ? `<div class="toolbar-group group-layout"><div class="toolbar-group-label">${iconGlyph('layout')}Layout</div><div class="toolbar-group-row">${layoutToggleBtns}<button class="btn columns-btn" type="button" aria-haspopup="dialog" aria-expanded="false">Columns</button></div><div class="toolbar-menu" role="dialog" aria-label="Choose visible columns" hidden>${colMenu}</div></div>`
            : isBarMode
                ? `<div class="toolbar-group group-layout"><div class="toolbar-group-label">${iconGlyph('layout')}Layout</div><div class="toolbar-group-row">${layoutToggleBtns}${barPickerHtml}</div></div>`
                : `<div class="toolbar-group group-layout"><div class="toolbar-group-label">${iconGlyph('layout')}Layout</div><div class="toolbar-group-row">${layoutToggleBtns}</div></div>`;

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
        return `<div class="tab-panel${isActive ? ' active' : ''}" id="tab-panel-${idx}" role="tabpanel" aria-labelledby="tab-btn-${idx}" data-tab="${idx}" data-layout="matrix" data-matrix-col-type="${esc(matrixColType)}" data-scatter-x="${esc(scatterX)}" data-scatter-y="${esc(scatterY)}" data-bar-group-by="${esc(barGroupBy)}" data-column-filters="${esc(JSON.stringify(tabState.columnFilters || {}))}" data-current-page="1" data-page-size="50" style="display:${isActive ? 'flex' : 'none'}"${isActive ? '' : ' hidden'}><div class="view-shell">${warningBanner}
<div class="query-hero"><div class="query-hero-top"><div class="query-hero-title">${heroTitle}</div><div class="query-hero-subtle">${esc(viewLabel)}${matrixColType ? ` \xd7 ${esc(matrixColType)}` : ''}</div></div><div class="query-hero-query"><span class="query-hero-query-label">${iconGlyph('query')}Query</span><code>${formatQueryHeroText(queryText)}</code></div><div class="query-hero-meta"><span class="query-hero-badge">${esc(scopeLabel)}</span><span class="query-hero-badge">${heroMetaCount}</span></div></div>
<div class="query-toolbar">
<div class="toolbar-group group-view"><div class="toolbar-group-label">${iconGlyph('view')}View</div><div class="toolbar-group-row"><button class="btn report-btn">Open report</button><button class="btn reset-btn">Reset view</button></div></div>
<div class="toolbar-group group-filters"><div class="toolbar-group-label">${iconGlyph('filters')}Filters</div><div class="toolbar-group-row"><button class="btn refine-btn" data-query-index="${idx}">Refine view</button></div></div>
${layoutGroupHtml}
</div>
${matrixContent}</div></div>`;
    }

    if (activeLayout === 'bar') {
        let chartHtml;
        if (barGroupBy) {
            const groupMap = new Map();
            for (const row of rows) {
                const key = String(row.fields[barGroupBy] ?? '');
                if (!groupMap.has(key)) groupMap.set(key, { key, count: 0 });
                groupMap.get(key).count++;
            }
            const groups = [...groupMap.values()].sort((a, b) => b.count - a.count);
            chartHtml = buildBarChartHtml({ idx, groups, groupField: barGroupBy, nonce });
        } else {
            chartHtml = buildInfoCardHtml('Pick a field to group by', 'Use the <strong>Group&nbsp;by</strong> picker in the toolbar above to choose how to bucket this result into bars.');
        }
        return `<div class="tab-panel${isActive ? ' active' : ''}" id="tab-panel-${idx}" role="tabpanel" aria-labelledby="tab-btn-${idx}" data-tab="${idx}" data-layout="bar" data-matrix-col-type="" data-scatter-x="${esc(scatterX)}" data-scatter-y="${esc(scatterY)}" data-bar-group-by="${esc(barGroupBy)}" data-column-filters="${esc(JSON.stringify(tabState.columnFilters || {}))}" data-current-page="1" data-page-size="50" style="display:${isActive ? 'flex' : 'none'}"${isActive ? '' : ' hidden'}><div class="view-shell">${warningBanner}<div class="query-hero"><div class="query-hero-top"><div class="query-hero-title">${heroTitle}</div><div class="query-hero-subtle">${esc(viewLabel)}</div></div><div class="query-hero-query"><span class="query-hero-query-label">${iconGlyph('query')}Query</span><code>${formatQueryHeroText(queryText)}</code></div><div class="query-hero-meta"><span class="query-hero-badge">${esc(scopeLabel)}</span><span class="query-hero-badge">${heroMetaCount}</span></div></div><div class="query-toolbar"><div class="toolbar-group group-view"><div class="toolbar-group-label">${iconGlyph('view')}View</div><div class="toolbar-group-row"><button class="btn report-btn">Open report</button><button class="btn reset-btn">Reset view</button></div></div><div class="toolbar-group group-filters"><div class="toolbar-group-label">${iconGlyph('filters')}Filters</div><div class="toolbar-group-row"><button class="btn refine-btn" data-query-index="${idx}">Refine view</button></div></div>${layoutGroupHtml}<div class="toolbar-group group-export"><div class="toolbar-group-label">${iconGlyph('export')}Export</div><div class="toolbar-group-row"><button class="btn export-btn" data-format="csv">CSV</button><button class="btn export-btn" data-format="json">JSON</button><button class="btn export-btn" data-format="pdf">PDF</button></div></div></div>${chartHtml}</div></div>`;
    }

    if (activeLayout === 'scatter') {
        const chartHtml = buildScatterChartHtml({
            idx,
            rows: sortedRows,
            columns,
            meta,
            xField: scatterX,
            yField: scatterY,
            types,
            nonce
        });
        return `<div class="tab-panel${isActive ? ' active' : ''}" id="tab-panel-${idx}" role="tabpanel" aria-labelledby="tab-btn-${idx}" data-tab="${idx}" data-layout="scatter" data-matrix-col-type="" data-scatter-x="${esc(scatterX)}" data-scatter-y="${esc(scatterY)}" data-bar-group-by="${esc(barGroupBy)}" data-column-filters="${esc(JSON.stringify(tabState.columnFilters || {}))}" data-current-page="1" data-page-size="50" style="display:${isActive ? 'flex' : 'none'}"${isActive ? '' : ' hidden'}><div class="view-shell">${warningBanner}<div class="query-hero"><div class="query-hero-top"><div class="query-hero-title">${heroTitle}</div><div class="query-hero-subtle">${esc(viewLabel)}</div></div><div class="query-hero-query"><span class="query-hero-query-label">${iconGlyph('query')}Query</span><code>${formatQueryHeroText(queryText)}</code></div><div class="query-hero-meta"><span class="query-hero-badge">${esc(scopeLabel)}</span><span class="query-hero-badge">${heroMetaCount}</span></div></div><div class="query-toolbar"><div class="toolbar-group group-view"><div class="toolbar-group-label">${iconGlyph('view')}View</div><div class="toolbar-group-row"><button class="btn report-btn">Open report</button><button class="btn reset-btn">Reset view</button></div></div><div class="toolbar-group group-filters"><div class="toolbar-group-label">${iconGlyph('filters')}Filters</div><div class="toolbar-group-row"><button class="btn refine-btn" data-query-index="${idx}">Refine view</button></div></div>${layoutGroupHtml}<div class="toolbar-group group-export"><div class="toolbar-group-label">${iconGlyph('export')}Export</div><div class="toolbar-group-row"><button class="btn export-btn" data-format="csv">CSV</button><button class="btn export-btn" data-format="json">JSON</button><button class="btn export-btn" data-format="pdf">PDF</button></div></div></div><div class="metrics-strip"><div class="metrics-card">${metricsCardHtml}</div></div>${chartHtml}</div></div>`;
    }

    return `<div class="tab-panel${isActive ? ' active' : ''}" id="tab-panel-${idx}" role="tabpanel" aria-labelledby="tab-btn-${idx}" data-tab="${idx}" data-layout="table" data-matrix-col-type="" data-scatter-x="${esc(scatterX)}" data-scatter-y="${esc(scatterY)}" data-bar-group-by="${esc(barGroupBy)}" data-column-filters="${esc(JSON.stringify(tabState.columnFilters || {}))}" data-current-page="${savedPage}" data-page-size="${savedPageSize}"${isLargeResult ? ` data-large-result="true" data-total-filtered-rows="${totalFilteredRows}"` : ''} style="display:${isActive ? 'flex' : 'none'}"${isActive ? '' : ' hidden'}><div class="view-shell">${warningBanner}
<div class="query-hero"><div class="query-hero-top"><div class="query-hero-title">${heroTitle}</div><div class="query-hero-subtle">${esc(viewLabel)}</div></div><div class="query-hero-query"><span class="query-hero-query-label">${iconGlyph('query')}Query</span><code>${formatQueryHeroText(queryText)}</code></div><div class="query-hero-meta"><span class="query-hero-badge">${esc(scopeLabel)}</span><span class="query-hero-badge">${heroMetaCount}</span></div></div>
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
    buildMatrixGrid,
    buildBarChartHtml,
    buildScatterChartHtml
};
