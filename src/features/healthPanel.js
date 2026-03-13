const vscode = require('vscode');
const { getIndex, getFieldsCache } = require('../core/index');
const { getGraphStats, isOrphan } = require('../core/graph');
const { getRegistry, getRegistryStats } = require('../registries/typeRegistry');
const { getSchemaStats } = require('../registries/schemaRegistry');
const { getBrokenCount } = require('../diagnostics/diagnostics');

const SYSTEM_TYPES = new Set(['schema', 'dashboard', 'template']);

let panel = null;

function openHealthPanel(context) {
    if (panel) {
        panel.reveal(vscode.ViewColumn.One);
        updatePanel();
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'yamlink.healthPanel',
        'Vault Health',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    panel.webview.onDidReceiveMessage(message => {
        const idIndex = getIndex();

        // Open a node file
        if (message.command === 'openNode') {
            const filePath = idIndex.get(message.id);
            if (filePath) {
                vscode.workspace.openTextDocument(filePath).then(doc => {
                    vscode.window.showTextDocument(doc, { preview: false });
                });
            }
        }

        // Open !view panel for a type
        if (message.command === 'openView') {
            const { openViewPanel } = require('./viewPanel');
            openViewPanel(context, `# ${message.label}\n\n${message.query}\n`);
        }

        // Open VS Code Problems panel for broken links
        if (message.command === 'openProblems') {
            vscode.commands.executeCommand('workbench.actions.view.problems');
        }

        // Open !view * for all nodes
        if (message.command === 'openAllNodes') {
            const { openViewPanel } = require('./viewPanel');
            openViewPanel(context, '# All Nodes\n\n!view *\n');
        }

    }, null, context.subscriptions);

    panel.onDidDispose(() => { panel = null; }, null, context.subscriptions);

    updatePanel();
}

function updatePanel() {
    if (!panel) return;
    panel.webview.html = buildHtml(collectStats());
}

// ─────────────────────────────────────────────────────────────────
// collectStats
// ─────────────────────────────────────────────────────────────────
function collectStats() {
    const idIndex       = getIndex();
    const fieldsCache   = getFieldsCache();
    const graphStats    = getGraphStats();
    const registryStats = getRegistryStats();
    const schemaStats   = getSchemaStats();
    const brokenCount   = getBrokenCount();
    const registry      = getRegistry();

    const orphans = [];
    for (const id of idIndex.keys()) {
        if (!isOrphan(id)) continue;
        const fields   = fieldsCache.get(id);
        const nodeType = (fields?.type || '').trim().toLowerCase();
        if (SYSTEM_TYPES.has(nodeType)) continue;
        orphans.push(id);
    }

    const types = [...registry.entries()]
        .map(([type, ids]) => ({
            type,
            count: ids.size,
            nodes: [...ids].sort()
        }))
        .sort((a, b) => b.count - a.count);

    const density = idIndex.size > 0
        ? (graphStats.totalEdges / idIndex.size).toFixed(2)
        : '0.00';

    return {
        nodes:       idIndex.size,
        edges:       graphStats.totalEdges,
        broken:      brokenCount,
        orphans:     orphans.sort(),
        types,
        schemas:     schemaStats.schemas,
        uniqueTypes: registryStats.uniqueTypes,
        density
    };
}

// ─────────────────────────────────────────────────────────────────
// buildHtml
// ─────────────────────────────────────────────────────────────────
function buildHtml(stats) {
    const healthScore = computeHealthScore(stats);
    const healthColor = healthScore >= 80 ? '#4ec9b0' : healthScore >= 50 ? '#e5a96a' : '#f47474';
    const healthLabel = healthScore >= 80 ? 'Healthy' : healthScore >= 50 ? 'Fair' : 'Needs attention';

    const typeSections = stats.types.length > 0
        ? stats.types.map(({ type, count, nodes }) => {
            const nodePills = nodes.map(id =>
                `<span class="node-pill" data-id="${id}">${id}</span>`
            ).join('');

            const orphanCount = nodes.filter(id => stats.orphans.includes(id)).length;
            const orphanNote  = orphanCount > 0
                ? `<span class="type-orphan-note">${orphanCount} unlinked</span>`
                : '';

            return `
            <div class="type-block">
                <div class="type-header" data-type="${type}">
                    <div class="type-header-left">
                        <span class="type-chevron">▸</span>
                        <span class="type-label">${type}</span>
                        ${orphanNote}
                    </div>
                    <div class="type-header-right">
                        <span class="type-count">${count} node${count !== 1 ? 's' : ''}</span>
                        <button class="view-btn" data-query="!view ${type}" data-label="${type}">
                            View all →
                        </button>
                    </div>
                </div>
                <div class="type-body" id="body-${type}">
                    <div class="node-pills">${nodePills}</div>
                </div>
            </div>`;
        }).join('')
        : `<div class="empty-section">No typed nodes in vault yet.</div>`;

    const orphanSection = stats.orphans.length > 0
        ? stats.orphans.map(id =>
            `<span class="node-pill orphan-pill" data-id="${id}">${id}</span>`
          ).join('')
        : `<span class="empty-section">Every node is connected. Great vault hygiene.</span>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vault Health</title>
<style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
        --bg:       var(--vscode-editor-background, #131313);
        --surface:  var(--vscode-sideBar-background, #1a1a1a);
        --surface2: var(--vscode-input-background, #202020);
        --border:   var(--vscode-panel-border, #252525);
        --border2:  #2e2e2e;
        --text:     var(--vscode-editor-foreground, #d0d0d0);
        --dim:      var(--vscode-disabledForeground, #4a4a4a);
        --mid:      var(--vscode-descriptionForeground, #7a7a7a);
        --accent:   #4fc4a0;
        --warn:     #e5a96a;
        --danger:   #f47474;
        --link:     var(--vscode-textLink-foreground, #6eb3f0);
        --mono:     'IBM Plex Mono', monospace;
        --sans:     'IBM Plex Sans', sans-serif;
    }

    body {
        background: var(--bg);
        color: var(--text);
        font-family: var(--sans);
        font-size: 13px;
        line-height: 1.5;
        min-height: 100vh;
    }

    /* ── Header ── */
    .header {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 24px 32px 20px;
        border-bottom: 1px solid var(--border);
        background: var(--surface);
    }

    .header-score {
        font-family: var(--mono);
        font-size: 36px;
        font-weight: 300;
        color: var(--text);
        letter-spacing: -0.02em;
        line-height: 1;
    }

    .header-divider {
        width: 1px;
        height: 36px;
        background: var(--border2);
    }

    .header-meta {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .header-title {
        font-family: var(--sans);
        font-size: 15px;
        font-weight: 500;
        color: var(--text);
        letter-spacing: 0.01em;
    }

    .header-sub {
        font-family: var(--mono);
        font-size: 10px;
        color: var(--mid);
        letter-spacing: 0.06em;
    }

    .health-badge {
        font-family: var(--mono);
        font-size: 10px;
        padding: 3px 10px;
        border-radius: 20px;
        border: 1px solid;
        letter-spacing: 0.08em;
        font-weight: 400;
    }

    .header-timestamp {
        margin-left: auto;
        font-family: var(--mono);
        font-size: 10px;
        color: var(--dim);
        letter-spacing: 0.06em;
    }

    /* ── Stats strip ── */
    .stats-strip {
        display: flex;
        border-bottom: 1px solid var(--border);
        background: var(--surface);
    }

    .stat-cell {
        flex: 1;
        padding: 16px 24px;
        border-right: 1px solid var(--border);
        position: relative;
    }

    .stat-cell:last-child { border-right: none; }

    .stat-cell.clickable {
        cursor: pointer;
        transition: background 0.12s;
    }

    .stat-cell.clickable:hover { background: var(--surface2); }

    .stat-cell.clickable:hover .stat-lbl { color: var(--mid); }

    .stat-cell.clickable .stat-num {
        transition: color 0.12s;
    }

    /* Hover accent on clickable neutrals */
    .stat-cell.clickable:not(.has-warning):not(.has-caution):hover .stat-num {
        color: var(--link);
    }

    .stat-cell.has-warning::after {
        content: '';
        position: absolute;
        bottom: 0; left: 0; right: 0;
        height: 2px;
        background: var(--danger);
    }

    .stat-cell.has-caution::after {
        content: '';
        position: absolute;
        bottom: 0; left: 0; right: 0;
        height: 2px;
        background: var(--warn);
    }

    .stat-num {
        font-family: var(--mono);
        font-size: 22px;
        font-weight: 300;
        color: var(--text);
        letter-spacing: -0.01em;
        line-height: 1;
        margin-bottom: 5px;
    }

    .stat-num.danger { color: var(--danger); }
    .stat-num.warn   { color: var(--warn); }
    .stat-num.good   { color: var(--accent); }

    .stat-lbl {
        font-family: var(--mono);
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--dim);
        transition: color 0.12s;
    }

    .stat-hint {
        font-family: var(--sans);
        font-size: 10px;
        color: var(--mid);
        margin-top: 3px;
        font-style: italic;
    }

    .stat-action {
        font-family: var(--mono);
        font-size: 9px;
        color: var(--accent);
        margin-top: 4px;
        letter-spacing: 0.04em;
        opacity: 0.7;
        transition: opacity 0.12s;
    }

    .stat-cell.clickable:hover .stat-action { opacity: 1; }

    /* ── Main content ── */
    .content {
        padding: 0 32px 40px;
        max-width: 900px;
    }

    .section { margin-top: 32px; }

    .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--border);
    }

    .section-title {
        font-family: var(--mono);
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--mid);
    }

    .section-count {
        font-family: var(--mono);
        font-size: 9px;
        color: var(--dim);
        letter-spacing: 0.08em;
    }

    /* ── Type blocks ── */
    .type-block {
        border: 1px solid var(--border);
        border-radius: 3px;
        margin-bottom: 6px;
        overflow: hidden;
        transition: border-color 0.12s;
    }

    .type-block:hover { border-color: var(--border2); }

    .type-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 11px 16px;
        cursor: pointer;
        background: var(--surface);
        user-select: none;
        transition: background 0.1s;
    }

    .type-header:hover { background: var(--surface2); }

    .type-header-left {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .type-chevron {
        font-size: 9px;
        color: var(--dim);
        transition: transform 0.15s;
        display: inline-block;
    }

    .type-block.open .type-chevron { transform: rotate(90deg); }

    .type-label {
        font-family: var(--mono);
        font-size: 12px;
        color: var(--link);
        letter-spacing: 0.04em;
    }

    .type-orphan-note {
        font-family: var(--mono);
        font-size: 9px;
        color: var(--warn);
        background: rgba(229,169,106,0.08);
        border: 1px solid rgba(229,169,106,0.2);
        border-radius: 10px;
        padding: 1px 7px;
        letter-spacing: 0.04em;
    }

    .type-header-right {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .type-count {
        font-family: var(--mono);
        font-size: 10px;
        color: var(--mid);
        letter-spacing: 0.04em;
    }

    .view-btn {
        font-family: var(--mono);
        font-size: 10px;
        color: var(--accent);
        background: rgba(79,196,160,0.08);
        border: 1px solid rgba(79,196,160,0.2);
        border-radius: 2px;
        padding: 3px 9px;
        cursor: pointer;
        letter-spacing: 0.04em;
        transition: background 0.12s;
        white-space: nowrap;
    }

    .view-btn:hover { background: rgba(79,196,160,0.18); }

    .type-body {
        display: none;
        padding: 12px 16px 14px;
        border-top: 1px solid var(--border);
        background: var(--bg);
    }

    .type-block.open .type-body { display: block; }

    /* ── Node pills ── */
    .node-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .node-pill {
        font-family: var(--mono);
        font-size: 11px;
        color: var(--text);
        background: var(--surface);
        border: 1px solid var(--border2);
        border-radius: 2px;
        padding: 3px 9px;
        cursor: pointer;
        transition: all 0.1s;
        letter-spacing: 0.02em;
    }

    .node-pill:hover {
        border-color: var(--link);
        color: var(--link);
        background: rgba(110,179,240,0.06);
    }

    .orphan-pill {
        color: var(--warn);
        border-color: rgba(229,169,106,0.25);
        background: rgba(229,169,106,0.05);
    }

    .orphan-pill:hover {
        border-color: var(--warn);
        background: rgba(229,169,106,0.12);
    }

    .empty-section {
        font-family: var(--sans);
        font-size: 12px;
        color: var(--dim);
        font-style: italic;
        padding: 8px 0;
    }
</style>
</head>
<body>

<div class="header">
    <div class="header-score">${healthScore}<span style="font-size:16px;color:var(--mid)">%</span></div>
    <div class="header-divider"></div>
    <div class="header-meta">
        <div class="header-title">Vault Health</div>
        <div class="header-sub">${stats.nodes} nodes · ${stats.uniqueTypes} types · density ${stats.density}</div>
    </div>
    <span class="health-badge" style="color:${healthColor}; border-color:${healthColor}44; background:${healthColor}11">
        ${healthLabel}
    </span>
    <div class="header-timestamp">Snapshot · ${new Date().toLocaleTimeString()}</div>
</div>

<div class="stats-strip">
    <div class="stat-cell clickable" data-action="openAllNodes" title="View all nodes">
        <div class="stat-num">${stats.nodes}</div>
        <div class="stat-lbl">Nodes</div>
        <div class="stat-action">View all →</div>
    </div>
    <div class="stat-cell">
        <div class="stat-num">${stats.edges}</div>
        <div class="stat-lbl">Edges</div>
        <div class="stat-hint">${stats.density} avg per node</div>
    </div>
    <div class="stat-cell clickable ${stats.broken > 0 ? 'has-warning' : ''}" data-action="openProblems" title="Open Problems panel">
        <div class="stat-num ${stats.broken > 0 ? 'danger' : 'good'}">${stats.broken}</div>
        <div class="stat-lbl">Broken Links</div>
        ${stats.broken > 0
            ? '<div class="stat-hint">Open diagnostics to fix</div><div class="stat-action">Open Problems →</div>'
            : '<div class="stat-hint">All links resolve</div>'}
    </div>
    <div class="stat-cell clickable ${stats.orphans.length > 0 ? 'has-caution' : ''}" data-action="scrollOrphans" title="Jump to orphan nodes">
        <div class="stat-num ${stats.orphans.length > 0 ? 'warn' : 'good'}">${stats.orphans.length}</div>
        <div class="stat-lbl">Orphan Nodes</div>
        ${stats.orphans.length > 0
            ? '<div class="stat-hint">Nodes with no connections</div><div class="stat-action">Jump to list →</div>'
            : '<div class="stat-hint">No isolated nodes</div>'}
    </div>
    <div class="stat-cell clickable" data-action="scrollTypes" title="Jump to entity types">
        <div class="stat-num">${stats.uniqueTypes}</div>
        <div class="stat-lbl">Types</div>
        <div class="stat-action">Jump to list →</div>
    </div>
    <div class="stat-cell">
        <div class="stat-num">${stats.schemas}</div>
        <div class="stat-lbl">Schemas</div>
        <div class="stat-hint">${stats.schemas === 0 ? 'None defined yet' : `${stats.schemas} active`}</div>
    </div>
</div>

<div class="content">

    <div class="section" id="section-types">
        <div class="section-header">
            <span class="section-title">Entity Types</span>
            <span class="section-count">${stats.types.length} type${stats.types.length !== 1 ? 's' : ''}</span>
        </div>
        ${typeSections}
    </div>

    ${stats.orphans.length > 0 ? `
    <div class="section" id="section-orphans">
        <div class="section-header">
            <span class="section-title">Orphan Nodes</span>
            <span class="section-count" style="color:var(--warn)">${stats.orphans.length} unlinked</span>
        </div>
        <div class="node-pills">${orphanSection}</div>
    </div>` : ''}

</div>

<script>
    const vscode = acquireVsCodeApi();

    // ── Stat card clicks ──
    document.querySelectorAll('.stat-cell[data-action]').forEach(cell => {
        cell.addEventListener('click', () => {
            const action = cell.dataset.action;

            if (action === 'openAllNodes') {
                vscode.postMessage({ command: 'openAllNodes' });
            }
            if (action === 'openProblems') {
                vscode.postMessage({ command: 'openProblems' });
            }
            if (action === 'scrollOrphans') {
                const el = document.getElementById('section-orphans');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            if (action === 'scrollTypes') {
                const el = document.getElementById('section-types');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    // ── Node pill → open file ──
    document.addEventListener('click', e => {
        const pill = e.target.closest('.node-pill');
        if (pill) {
            e.stopPropagation();
            vscode.postMessage({ command: 'openNode', id: pill.dataset.id });
            return;
        }

        const btn = e.target.closest('.view-btn');
        if (btn) {
            e.stopPropagation();
            vscode.postMessage({ command: 'openView', query: btn.dataset.query, label: btn.dataset.label });
            return;
        }

        const header = e.target.closest('.type-header');
        if (header) {
            const block = header.closest('.type-block');
            block.classList.toggle('open');
        }
    });
</script>

</body>
</html>`;
}

function computeHealthScore(stats) {
    if (stats.nodes === 0) return 100;
    const brokenPenalty = Math.min(50, stats.broken * 10);
    const orphanPenalty = Math.min(30, Math.round(stats.orphans.length / stats.nodes * 30));
    return Math.max(0, 100 - brokenPenalty - orphanPenalty);
}

module.exports = { openHealthPanel, updatePanel };