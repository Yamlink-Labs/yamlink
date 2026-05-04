'use strict';

const { computeHealthScore } = require('./healthStats');

function buildHealthHtml(stats) {
    if (stats.nodes === 0) {
        return [
            '<!DOCTYPE html><html><head><meta charset="UTF-8">',
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">',
            '<style>*{margin:0;padding:0;box-sizing:border-box}body{background:var(--vscode-editor-background,#141414);color:#888;font-family:\'Segoe UI\',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px}.title{font-size:14px;font-weight:600;color:#c8c8c8}.msg{font-size:12px;color:#6f7781;text-align:center;line-height:1.6}.hint{font-size:11px;color:#555;text-align:center;line-height:1.7}code{background:#1e2126;padding:1px 5px;border-radius:4px;font-size:10px}</style>',
            '</head><body>',
            '<div class="title">Vault Health</div>',
            '<div class="msg">No nodes indexed yet.</div>',
            '<div class="hint">Open a Markdown file and add frontmatter with an <code>id:</code> field to create your first node.<br>Example: <code>id: my-first-note</code></div>',
            '</body></html>'
        ].join('\n');
    }

    const healthScore = computeHealthScore(stats);
    const healthColor = healthScore >= 80 ? '#4ec9b0' : healthScore >= 50 ? '#e5a96a' : '#f47474';
    const healthLabel = healthScore >= 80 ? 'Healthy' : healthScore >= 50 ? 'Fair' : 'Needs attention';
    const updatedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const riskLabel = stats.broken > 0
        ? 'Broken links need attention'
        : stats.orphans.length > 0
            ? 'A few nodes need stronger connections'
            : stats.nodes <= 3
                ? 'Early vault, clean start'
                : 'Structure looks cohesive';

    const typeSections = stats.types.length > 0
        ? stats.types.map(({ type, count, nodes }) => {
            const nodePills = nodes.map(id =>
                `<span class="node-pill" data-id="${id}">${id}</span>`
            ).join('');

            const orphanCount = nodes.filter(id => stats.orphans.includes(id)).length;
            const orphanNote = orphanCount > 0
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
        : `<div class="empty-section"><div class="empty-title">No typed nodes yet.</div><div class="empty-copy">Add a <code>type:</code> field to your nodes to turn Vault Health into a clearer system map.</div></div>`;

    const orphanSection = stats.orphans.length > 0
        ? stats.orphans.map(id =>
            `<span class="node-pill orphan-pill" data-id="${id}">${id}</span>`
        ).join('')
        : `<div class="empty-section"><div class="empty-title">No orphan nodes.</div><div class="empty-copy">Every indexed node has at least one connection. This part of the vault is structurally healthy.</div></div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vault Health</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
        --bg:       var(--vscode-editor-background, #131313);
        --surface:  var(--vscode-sideBar-background, #181b20);
        --surface2: var(--vscode-editorWidget-background, #1f242b);
        --surface3: var(--vscode-input-background, #13171c);
        --border:   var(--vscode-panel-border, #2a3038);
        --border2:  rgba(255,255,255,.08);
        --text:     var(--vscode-editor-foreground, #dbe2ea);
        --dim:      var(--vscode-disabledForeground, #69727d);
        --mid:      var(--vscode-descriptionForeground, #95a1ac);
        --accent:   #4fc4a0;
        --accent2:  #6eb3f0;
        --accent3:  #e5a96a;
        --warn:     #e5a96a;
        --danger:   #f47474;
        --link:     var(--vscode-textLink-foreground, #6eb3f0);
        --sans:     'Segoe UI', system-ui, sans-serif;
    }

    body {
        background:
            radial-gradient(circle at top left, color-mix(in srgb, var(--link) 7%, transparent), transparent 28%),
            radial-gradient(circle at bottom right, color-mix(in srgb, var(--accent) 6%, transparent), transparent 30%),
            var(--bg);
        color: var(--text);
        font-family: var(--sans);
        font-size: 13px;
        line-height: 1.5;
        min-height: 100vh;
    }

    .header {
        display: grid;
        grid-template-columns: minmax(0, 1.5fr) minmax(220px, .9fr);
        gap: 16px;
        padding: 20px 22px 16px;
        border-bottom: 1px solid var(--border);
        background:
            radial-gradient(circle at top left, rgba(110,179,240,.12), transparent 34%),
            radial-gradient(circle at top right, rgba(79,196,160,.08), transparent 28%),
            linear-gradient(180deg, color-mix(in srgb, var(--surface) 98%, transparent), color-mix(in srgb, var(--surface2) 48%, var(--surface)));
    }

    .header-main { display: flex; flex-direction: column; gap: 12px; }
    .eyebrow { font-size: 11px; color: var(--accent3); letter-spacing: .12em; text-transform: uppercase; font-weight: 700; }
    .hero-row { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; }
    .header-title { font-size: 23px; line-height: 1.08; font-weight: 750; letter-spacing: -0.03em; }
    .header-sub { font-size: 13px; color: var(--mid); max-width: 720px; }
    .health-badge { font-size: 11px; padding: 6px 11px; border-radius: 999px; border: 1px solid; letter-spacing: 0.05em; font-weight: 700; align-self: center; }
    .header-side { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; align-content: start; }
    .hero-card { border: 1px solid var(--border); border-radius: 14px; background: color-mix(in srgb, var(--surface2) 86%, transparent); padding: 11px 12px; box-shadow: 0 6px 18px rgba(0,0,0,.08); }
    .hero-card-label { font-size: 10px; color: var(--dim); text-transform: uppercase; letter-spacing: .1em; margin-bottom: 8px; font-weight: 700; }
    .hero-card-value { font-size: 24px; line-height: 1; font-weight: 760; letter-spacing: -.03em; }
    .hero-card-note { margin-top: 8px; font-size: 12px; color: var(--mid); }

    .stats-strip { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 7px; padding: 12px 22px 0; }
    .stat-cell { padding: 11px 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface2); position: relative; }
    .stat-cell.clickable { cursor: pointer; transition: transform .12s, border-color .12s, background .12s; }
    .stat-cell.clickable:hover { background: color-mix(in srgb, var(--surface2) 86%, var(--accent2) 14%); border-color: rgba(110,179,240,.28); transform: translateY(-1px); }
    .stat-cell.clickable:hover .stat-lbl { color: var(--mid); }
    .stat-cell.clickable .stat-num { transition: color 0.12s; }
    .stat-cell.clickable:not(.has-warning):not(.has-caution):hover .stat-num { color: var(--link); }
    .stat-cell.has-warning::after { content: ""; position: absolute; inset: auto 12px 0 12px; height: 3px; background: var(--danger); border-radius: 999px; }
    .stat-cell.has-caution::after { content: ""; position: absolute; inset: auto 12px 0 12px; height: 3px; background: var(--warn); border-radius: 999px; }
    .stat-num { font-size: 24px; font-weight: 760; color: var(--text); letter-spacing: -0.03em; line-height: 1; margin-bottom: 6px; }
    .stat-num.danger { color: var(--danger); }
    .stat-num.warn { color: var(--warn); }
    .stat-num.good { color: var(--accent); }
    .stat-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.11em; color: var(--dim); transition: color 0.12s; font-weight: 700; }
    .stat-hint { font-size: 12px; color: var(--mid); margin-top: 6px; }
    .stat-action { font-size: 11px; color: var(--accent2); margin-top: 6px; opacity: 0.7; transition: opacity 0.12s; font-weight: 600; }
    .stat-cell.clickable:hover .stat-action { opacity: 1; }

    .content { padding: 16px 22px 28px; max-width: 1240px; }
    .section { margin-top: 20px; }
    .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
    .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--mid); font-weight: 700; }
    .section-count { font-size: 11px; color: var(--dim); letter-spacing: 0.05em; }

    .type-block { border: 1px solid var(--border); border-radius: 14px; margin-bottom: 7px; overflow: hidden; transition: border-color 0.12s, transform .12s; background: var(--surface2); box-shadow: 0 6px 18px rgba(0,0,0,.06); }
    .type-block:hover { border-color: var(--border2); transform: translateY(-1px); }
    .type-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; cursor: pointer; background: transparent; user-select: none; transition: background 0.1s; }
    .type-header:hover { background: rgba(255,255,255,.03); }
    .type-header-left { display: flex; align-items: center; gap: 10px; }
    .type-chevron { font-size: 10px; color: var(--dim); transition: transform 0.15s; display: inline-block; }
    .type-block.open .type-chevron { transform: rotate(90deg); }
    .type-label { font-size: 14px; color: var(--link); font-weight: 700; }
    .type-orphan-note { font-size: 11px; color: var(--warn); background: rgba(229,169,106,0.08); border: 1px solid rgba(229,169,106,0.2); border-radius: 999px; padding: 3px 8px; }
    .type-header-right { display: flex; align-items: center; gap: 10px; }
    .type-count { font-size: 12px; color: var(--mid); letter-spacing: 0.01em; }
    .view-btn { font-size: 12px; color: var(--accent2); background: rgba(110,179,240,0.08); border: 1px solid rgba(110,179,240,0.22); border-radius: 999px; padding: 5px 10px; cursor: pointer; transition: background 0.12s; white-space: nowrap; font-weight: 600; }
    .view-btn:hover { background: rgba(110,179,240,0.18); border-color: rgba(110,179,240,0.34); }
    .type-body { display: none; padding: 0 12px 12px; border-top: 1px solid var(--border); background: transparent; }
    .type-block.open .type-body { display: block; }

    .node-pills { display: flex; flex-wrap: wrap; gap: 5px; }
    .node-pill { font-size: 11px; color: var(--text); background: var(--surface3); border: 1px solid var(--border); border-radius: 999px; padding: 5px 9px; cursor: pointer; transition: all 0.1s; line-height: 1; }
    .node-pill:hover { border-color: var(--link); color: var(--link); background: rgba(110,179,240,0.08); }
    .orphan-pill { color: var(--warn); border-color: rgba(229,169,106,0.25); background: rgba(229,169,106,0.05); }
    .orphan-pill:hover { border-color: var(--warn); background: rgba(229,169,106,0.12); }
    .empty-section { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; color: var(--dim); }
    .empty-title { font-size: 12px; font-weight: 700; color: var(--text); }
    .empty-copy { font-size: 12px; color: var(--mid); line-height: 1.55; }
    .empty-copy code { background: color-mix(in srgb, var(--surface2) 86%, transparent); border: 1px solid var(--border2); border-radius: 6px; padding: 1px 5px; font-size: 11px; color: var(--text); }

    @media (max-width: 1080px) {
        .header { grid-template-columns: 1fr; }
        .stats-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .header-side { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
        .header, .content, .stats-strip { padding-left: 14px; padding-right: 14px; }
        .stats-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); padding-top: 12px; }
        .type-header { align-items: start; flex-direction: column; gap: 8px; }
        .hero-row { flex-direction: column; align-items: flex-start; }
        .type-header-right { width: 100%; justify-content: space-between; }
        .section-header { flex-direction: column; align-items: flex-start; gap: 6px; }
    }
    @media (max-width: 520px) {
        .header, .content, .stats-strip { padding-left: 12px; padding-right: 12px; }
        .stats-strip { grid-template-columns: 1fr; }
        .header-side { grid-template-columns: 1fr; }
        .header-title { font-size: 20px; }
        .header-sub { font-size: 12px; }
        .hero-card-value, .stat-num { font-size: 20px; }
        .type-header-right { flex-direction: column; align-items: flex-start; gap: 7px; }
        .view-btn { width: 100%; text-align: center; }
    }
</style>
</head>
<body>

<div class="header">
    <div class="header-main">
        <div class="eyebrow">Vault Health</div>
        <div class="hero-row">
            <div class="header-title">Your vault is ${healthLabel.toLowerCase()}</div>
            <span class="health-badge" style="color:${healthColor}; border-color:${healthColor}44; background:${healthColor}11">
                ${healthLabel}
            </span>
        </div>
        <div class="header-sub">${riskLabel}. This snapshot covers ${stats.nodes} nodes, ${stats.edges} links, ${stats.uniqueTypes} types, and ${stats.schemas} schema${stats.schemas === 1 ? '' : 's'}.</div>
    </div>
    <div class="header-side">
        <div class="hero-card">
            <div class="hero-card-label">Health score</div>
            <div class="hero-card-value">${healthScore}<span style="font-size:14px;color:var(--mid);margin-left:2px">%</span></div>
            <div class="hero-card-note">Updated at ${updatedAt}</div>
        </div>
        <div class="hero-card">
            <div class="hero-card-label">Connection density</div>
            <div class="hero-card-value">${stats.density}</div>
            <div class="hero-card-note">Average links per node</div>
        </div>
    </div>
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

module.exports = {
    buildHealthHtml
};
