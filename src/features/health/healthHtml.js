'use strict';

const fs = require('fs');
const path = require('path');
const { computeHealthScore } = require('./healthStats');
const { HELP_TEXT, helpTip } = require('./healthHelp');
const {
    buildEmergingPatternsHtml,
    buildIntelligenceHealthHtml,
    buildTopRelationshipsHtml
} = require('./healthIntelligenceHtml');
const { buildSchemaSectionHtml } = require('./healthSchemaHtml');
const { buildVaultProjectionsCardHtml, VAULT_PROJECTIONS_CSS } = require('./vaultProjectionsCard');

const HEALTH_CSS = fs.readFileSync(path.join(__dirname, 'healthPanel.css'), 'utf8');

/**
 * @param {object} stats
 * @param {{ scriptUri?: string, nonce?: string, csp?: string }} [options]
 * @returns {string}
 */
function buildHealthHtml(stats, { scriptUri, nonce, csp } = {}) {
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
    const driftSummary = stats.drift || null;
    const driftTotal = driftSummary?.total ?? 0;
    const driftCards = [
        ['onTrack', 'On Track', 'Looks normal for its type in this vault.', ''],
        ['minorDrift', 'Slightly unusual', 'A little different from similar notes, but not alarming.', ''],
        ['drifting', 'Missing structure', 'Noticeably diverging from how this type usually looks in the vault.', 'drift-warn'],
        ['outliers', 'Very unusual', 'Significantly different from similar notes and likely missing expected structure.', 'drift-danger']
    ].map(([key, label, title, colorClass]) => `
        <div class="lifecycle-card" title="${title}">
            <div class="lifecycle-count${colorClass ? ` ${colorClass}` : ''}">${driftSummary ? (driftSummary[key] || 0) : '—'}</div>
            <div class="lifecycle-label">${label}</div>
        </div>
    `).join('');
    const driftNeedsAttention = (driftSummary?.needsAttention || []).slice(0, 10);
    const driftPills = driftNeedsAttention.map(note => {
        const cls = note.driftLabel === 'outlier'
            ? 'node-pill outlier-pill'
            : 'node-pill drift-pill';
        const missing = (note.missingExpected || []).map(m => m.field).join(', ');
        const tooltip = missing
            ? `missing: ${missing} · score: ${note.driftScore}`
            : `score: ${note.driftScore}`;
        return `<span class="${cls}" data-id="${esc(note.noteId)}" title="${esc(tooltip)}">${esc(note.noteId)} · ${esc(note.driftLabelHuman || note.driftLabel)}</span>`;
    }).join('');

    const lifecycleCounts = stats.lifecycle?.counts || {};
    const lifecycleCards = [
        ['draft', 'Draft', 'Barely started: very little structure and no real relation pattern yet.'],
        ['growing', 'Growing', 'Taking shape: some structure exists, but the note is not complete for its kind yet.'],
        ['consolidated', 'Established', 'Looks complete and structurally typical for its kind.'],
        ['hub', 'Hub', 'A central note that many other notes point to.'],
        ['stale', 'Stale', 'Likely needs review because it has not moved recently or its dates are too far in the past.']
    ].map(([key, label, title]) => `
        <div class="lifecycle-card" title="${title}">
            <div class="lifecycle-count">${lifecycleCounts[key] || 0}</div>
            <div class="lifecycle-label">${label}</div>
        </div>
    `).join('');
    const todayActivity = stats.todayActivity || [];
    const todaySessions = stats.todaySessions || [];
    const todaySummary = stats.todaySummary || null;
    const todayBursts = stats.todayBursts || [];
    const summaryChips = todaySummary ? [
        ['notesCreated', 'note', 'notes'],
        ['fieldsAdded', 'field added', 'fields added'],
        ['relationsFormed', 'relation formed', 'relations formed'],
        ['relationsChanged', 'relation changed', 'relations changed'],
        ['tasksChanged', 'task changed', 'tasks changed'],
        ['completionsAccepted', 'completion accepted', 'completions accepted'],
        ['templateApplied', 'template applied', 'templates applied']
    ].filter(([key]) => todaySummary[key] > 0)
        .map(([key, singular, plural]) => `<span class="session-chip">${todaySummary[key]} ${todaySummary[key] === 1 ? singular : plural}</span>`)
        .join('')
        : '';
    const summaryStripHtml = summaryChips
        ? `<div class="session-meta" style="margin-bottom:12px">${summaryChips}</div>`
        : '';
    const burstHtml = todayBursts.length
        ? `<div class="intel-flag intel-flag--ok" style="margin-bottom:12px">⚡ Workflow burst detected: ${esc(todayBursts[0].type.replace(/_/g, ' '))} touching ${todayBursts[0].noteIds.length} notes within ${Math.round(todayBursts[0].windowMs / 1000)}s.</div>`
        : '';
    const activityHtml = todayActivity.length > 0
        ? `<div class="activity-list">${todayActivity.map(({ noteId, count }) =>
            `<div class="activity-row" data-id="${esc(noteId)}"><span class="activity-id">${esc(noteId)}</span><span class="activity-count">${count} change${count === 1 ? '' : 's'}</span></div>`
        ).join('')}</div>`
        : `<div class="empty-section"><div class="empty-title">No mutations recorded today.</div><div class="empty-copy">Edit and save notes to start tracking today's vault activity here.</div></div>`;
    const sessionHtml = todaySessions.length > 0
        ? `<div class="session-list">${todaySessions.map((session) =>
            `<div class="session-row"${session.primaryNoteId ? ` data-id="${esc(session.primaryNoteId)}"` : ''}>
                <div class="session-main">
                    <div class="session-summary">${esc(session.summary)}</div>
                    <div class="session-meta">
                        ${session.primaryTypeName ? `<span class="session-chip">${esc(session.primaryTypeName)}</span>` : ''}
                        <span class="session-chip">${esc(String(session.count || 0))} event${session.count === 1 ? '' : 's'}</span>
                        ${session.noteCount > 1 ? `<span class="session-chip">${esc(String(session.noteCount))} notes</span>` : ''}
                    </div>
                </div>
                <div class="session-time">${esc(session.relativeTime || '')}</div>
            </div>`
        ).join('')}</div>`
        : '';

    const lifecycleHighlights = (stats.lifecycle?.notes || [])
        .filter((note) => note.state === 'stale' || note.state === 'hub')
        .slice(0, 6)
        .map((note) => `<span class="node-pill ${note.state === 'stale' ? 'orphan-pill' : ''}" data-id="${note.id}" title="${esc(note.summary)}">${esc(note.id)} · ${esc(note.label)}</span>`)
        .join('');

    const hasTemplates = stats.templateDrift && stats.templateDrift.size > 0;
    const hasOrphans   = stats.orphans.length > 0;
    // Vault Projections is the only tab-content anywhere in Vault Health that
    // does real trend/forecast reasoning (Time-Engine-backed) — every other
    // tab is a snapshot-in-time classification. It used to be embedded at the
    // bottom of the Intelligence tab's card grid, after 4 other cards, which
    // buried it rather than showcasing it. Promoted to its own top-level tab
    // 2026-07-13 after direct user feedback that it needed real estate of
    // its own, not a scroll-past afterthought in someone else's tab.
    const hasProjections = !!stats.intelligenceHealth?.projections;

    const tabNav = [
        { id: 'activity',      label: 'Activity',      help: HELP_TEXT.activityTab },
        { id: 'lifecycle',     label: 'Lifecycle',     help: HELP_TEXT.lifecycleTab },
        { id: 'consistency',   label: 'Consistency',   help: HELP_TEXT.consistencyTab },
        { id: 'schema',        label: 'Schema',        help: HELP_TEXT.schemaTab },
        { id: 'intelligence',  label: 'Intelligence',  help: HELP_TEXT.intelligenceTab },
        ...(hasProjections ? [{ id: 'projections', label: 'Projections', help: HELP_TEXT.projectionsTab }] : []),
        ...(hasTemplates ? [{ id: 'templates', label: 'Templates', help: HELP_TEXT.templatesTab }] : []),
        { id: 'types',         label: 'Types',         help: HELP_TEXT.typesTab },
        ...(hasOrphans   ? [{ id: 'orphans',   label: 'Orphans', help: HELP_TEXT.orphansTab }] : []),
    ].map((t, i) =>
        `<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${t.id}" title="${esc(t.help)}">${t.label}</button>`
    ).join('');

    const templateDriftHtml = hasTemplates ? (() => {
        const totalDrift = [...stats.templateDrift.values()].reduce((n, b) => n + b.driftCount, 0);
        const rows = [...stats.templateDrift.entries()]
            .sort((a, b) => b[1].driftCount - a[1].driftCount)
            .map(([type, bucket]) => {
                const pills = bucket.notes.slice(0, 20).map(n =>
                    `<span class="node-pill drift-pill" data-id="${esc(n.noteId)}" title="missing: ${esc(n.missingFields.join(', '))}">${esc(n.noteId)}</span>`
                ).join('');
                const extra = bucket.notes.length > 20
                    ? `<span style="font-size:11px;color:var(--dim)">+${bucket.notes.length - 20} more</span>` : '';
                return `<div class="type-block open" style="margin-bottom:7px">
                    <div class="type-header">
                        <div class="type-header-left">
                            <span class="type-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></span>
                            <span class="type-label">${esc(type)}</span>
                        </div>
                        <div class="type-header-right">
                            <span class="type-orphan-note">${bucket.driftCount} note${bucket.driftCount !== 1 ? 's' : ''} missing fields</span>
                        </div>
                    </div>
                    <div class="type-body"><div class="node-pills" style="margin-top:4px">${pills}${extra}</div></div>
                </div>`;
            }).join('');
        return `<div class="section-header">
                <span class="section-title-row"><span class="section-title">Template Drift</span>${helpTip('templateDrift', esc)}</span>
                <span class="section-count" style="color:var(--warn)">${totalDrift} note${totalDrift !== 1 ? 's' : ''} missing template fields</span>
            </div>
            <div class="empty-copy" style="margin-bottom:12px;color:var(--mid);font-size:12px">These notes are missing fields defined in their <code>_templates/</code> definition. Click a note to open it, then use <em>Yamlink: Add missing template fields</em> to fix.</div>
            ${rows}`;
    })() : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vault Health</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};">
<style>${HEALTH_CSS}${VAULT_PROJECTIONS_CSS}</style>
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
        <div class="hero-card" title="A quick cleanliness score. Broken links and isolated notes lower this number.">
            <div class="hero-card-label">Health score</div>
            <div class="hero-card-value">${healthScore}<span style="font-size:14px;color:var(--mid);margin-left:2px">%</span></div>
            <div class="hero-card-note">Updated at ${updatedAt}</div>
        </div>
        <div class="hero-card" title="Average number of links per indexed note in the vault.">
            <div class="hero-card-label">Average connections</div>
            <div class="hero-card-value">${stats.density}</div>
            <div class="hero-card-note">Average links per note</div>
        </div>
    </div>
</div>

<div class="stats-strip">
    <div class="stat-cell clickable" data-action="openAllNodes" title="Every indexed Yamlink note in the vault. Click to view the full list.">
        <div class="stat-num">${stats.nodes}</div>
        <div class="stat-lbl">Nodes</div>
        <div class="stat-action">View all →</div>
    </div>
    <div class="stat-cell" title="Every note-to-note link Yamlink found, including body wikilinks and frontmatter relations.">
        <div class="stat-num">${stats.edges}</div>
        <div class="stat-lbl">Edges</div>
        <div class="stat-hint">${stats.density} avg per node</div>
    </div>
    <div class="stat-cell clickable ${stats.broken > 0 ? 'has-warning' : ''}" data-action="openProblems" title="Links that point to IDs that do not exist in the vault. Click to open Problems.">
        <div class="stat-num ${stats.broken > 0 ? 'danger' : 'good'}">${stats.broken}${stats.healthTrend?.brokenTrend === 'up' ? '<span class="trend-arrow trend-bad" title="More broken links than last week">↑</span>' : stats.healthTrend?.brokenTrend === 'down' ? '<span class="trend-arrow trend-good" title="Fewer broken links than last week">↓</span>' : ''}</div>
        <div class="stat-lbl">Broken Links</div>
        ${stats.broken > 0
        ? '<div class="stat-hint">Open diagnostics to fix</div><div class="stat-action">Open Problems →</div>'
        : '<div class="stat-hint">All links resolve</div>'}
    </div>
    <div class="stat-cell clickable ${hasOrphans ? 'has-caution' : ''}" data-action="switchOrphans" title="Indexed notes with no inbound or outbound connections. Click to jump to the Orphans tab.">
        <div class="stat-num ${hasOrphans ? 'warn' : 'good'}">${stats.orphans.length}${stats.healthTrend?.orphanTrend === 'up' ? '<span class="trend-arrow trend-bad" title="More orphans than last week">↑</span>' : stats.healthTrend?.orphanTrend === 'down' ? '<span class="trend-arrow trend-good" title="Fewer orphans than last week">↓</span>' : ''}</div>
        <div class="stat-lbl">Orphan Nodes</div>
        ${hasOrphans
        ? '<div class="stat-hint">Nodes with no connections</div><div class="stat-action">View orphans →</div>'
        : '<div class="stat-hint">No isolated nodes</div>'}
    </div>
    <div class="stat-cell clickable" data-action="switchTypes" title="How many different note categories (type values) are in the vault. Click to view the type list.">
        <div class="stat-num">${stats.uniqueTypes}</div>
        <div class="stat-lbl">Types</div>
        <div class="stat-action">View types →</div>
    </div>
    <div class="stat-cell clickable" data-action="switchSchema" title="Formal type-definition notes that define expected fields for note categories.">
        <div class="stat-num">${stats.schemas}</div>
        <div class="stat-lbl">Schemas</div>
        <div class="stat-hint">${stats.schemas === 0 ? 'None defined yet' : `${stats.schemas} active`}</div>
        ${stats.schemas > 0 ? '<div class="stat-action">View schema →</div>' : ''}
    </div>
</div>

<div class="tab-nav" role="tablist">${tabNav}</div>

<div class="content">

    <div class="tab-panel" data-tab="activity" id="section-activity">
        <div class="section">
            <div class="section-header">
                <span class="section-title-row"><span class="section-title">Today's Activity</span>${helpTip('todaysActivity', esc)}</span>
                <span class="section-count">${todayActivity.length} note${todayActivity.length !== 1 ? 's' : ''} changed</span>
            </div>
            ${summaryStripHtml}
            ${burstHtml}
            ${activityHtml}
            ${sessionHtml ? `<div class="section-header" style="margin-top:16px">
                <span class="section-title-row"><span class="section-title">Session Memory</span>${helpTip('sessionMemory', esc)}</span>
                <span class="section-count">${todaySessions.length} session${todaySessions.length === 1 ? '' : 's'}</span>
            </div>${sessionHtml}` : ''}
        </div>
    </div>

    <div class="tab-panel tab-panel--hidden" data-tab="lifecycle" id="section-lifecycle">
        <div class="section">
            <div class="section-header">
                <span class="section-title-row"><span class="section-title">Lifecycle States</span>${helpTip('lifecycleStates', esc)}</span>
                <span class="section-count">${Object.values(lifecycleCounts).reduce((sum, value) => sum + Number(value || 0), 0)} tracked</span>
            </div>
            <div class="lifecycle-grid">${lifecycleCards}</div>
            ${lifecycleHighlights
                ? `<div class="node-pills" style="margin-top:12px">${lifecycleHighlights}</div>`
                : '<div class="empty-section"><div class="empty-title">No standout lifecycle signals yet.</div><div class="empty-copy">As notes accumulate structure, Yamlink will surface which ones are still drafts, which ones are consolidating, and which ones are turning into hubs.</div></div>'}
        </div>
    </div>

    <div class="tab-panel tab-panel--hidden" data-tab="consistency" id="section-drift">
        <div class="section">
            <div class="section-header">
                <span class="section-title-row"><span class="section-title">Type Consistency</span>${helpTip('typeConsistency', esc)}</span>
                <span class="section-count">${driftTotal} analyzed</span>
            </div>
            ${driftTotal > 0 ? `
            <div class="lifecycle-grid drift-summary-grid">${driftCards}</div>
            ${driftPills
                ? `<div class="node-pills" style="margin-top:12px">${driftPills}</div>`
                : '<div class="empty-section" style="margin-top:12px"><div class="empty-title">All notes are on track.</div><div class="empty-copy">No notes are diverging from how their type is normally shaped in this vault.</div></div>'}
            ` : `<div class="empty-section"><div class="empty-title">Not enough data yet.</div><div class="empty-copy">Drift analysis requires at least 3 notes of the same type. Add more notes to start seeing structural patterns.</div></div>`}
        </div>
    </div>

    <div class="tab-panel tab-panel--hidden" data-tab="schema">
        ${buildSchemaSectionHtml(stats, esc)}
        ${buildEmergingPatternsHtml(stats, esc)}
    </div>

    <div class="tab-panel tab-panel--hidden" data-tab="intelligence" id="section-intelligence">
        ${buildIntelligenceHealthHtml(stats.intelligenceHealth, esc)}
        ${buildEmergingPatternsHtml(stats, esc)}
        ${buildTopRelationshipsHtml(stats, esc)}
    </div>

    ${hasProjections ? `
    <div class="tab-panel tab-panel--hidden" data-tab="projections" id="section-projections">
        <div class="section">${buildVaultProjectionsCardHtml(stats.intelligenceHealth.projections, esc)}</div>
    </div>` : ''}

    ${hasTemplates ? `
    <div class="tab-panel tab-panel--hidden" data-tab="templates" id="section-template-drift">
        <div class="section">${templateDriftHtml}</div>
    </div>` : ''}

    <div class="tab-panel tab-panel--hidden" data-tab="types" id="section-types">
        <div class="section">
            <div class="section-header">
                <span class="section-title">Entity Types</span>
                <span class="section-count">${stats.types.length} type${stats.types.length !== 1 ? 's' : ''}</span>
            </div>
            ${typeSections}
        </div>
    </div>

    ${hasOrphans ? `
    <div class="tab-panel tab-panel--hidden" data-tab="orphans" id="section-orphans">
        <div class="section">
            <div class="section-header">
                <span class="section-title">Orphan Nodes</span>
                <span class="section-count" style="color:var(--warn)">${stats.orphans.length} unlinked</span>
            </div>
            <div class="node-pills">${orphanSection}</div>
        </div>
    </div>` : ''}

</div>

<script nonce="${nonce}">
document.addEventListener('click', function (event) {
    const button = event.target.closest('[data-action="createSchemaFromCluster"]');
    if (!button) return;
    const fields = JSON.parse(button.dataset.fields || '[]');
    const type = button.dataset.type || '';
    const noteIds = JSON.parse(button.dataset.noteIds || '[]');
    acquireVsCodeApi().postMessage({
        command: 'createSchemaFromCluster',
        fields,
        type,
        noteIds
    });
});
</script>
<div id="heat-tooltip" class="heat-tooltip" role="tooltip" aria-hidden="true"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>

</body>
</html>`;
}

module.exports = {
    buildHealthHtml
};

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
