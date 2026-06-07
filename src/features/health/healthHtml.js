'use strict';

const fs = require('fs');
const path = require('path');
const { computeHealthScore } = require('./healthStats');

const HEALTH_CSS = fs.readFileSync(path.join(__dirname, 'healthPanel.css'), 'utf8');

/** @param {object} stats @param {function} escapeFn @returns {string} */
function buildSchemaSectionHtml(stats, escapeFn) {
    const e = escapeFn;
    const si = stats.schemaIntelligence;
    const hasAnySchema = stats.schemas > 0;

    if (!hasAnySchema) {
        return `
    <div class="section" id="section-schema">
        <div class="section-header">
            <span class="section-title">Schema Coverage</span>
            <span class="section-count">0 schemas</span>
        </div>
        <div class="empty-section">
            <div class="empty-title">No schemas defined yet.</div>
            <div class="empty-copy">Create a note with <code>type: schema</code> and a <code>target:</code> field to define expected structure for a note type. Yamlink will then show conformance analysis for that type here.</div>
        </div>
    </div>`;
    }

    // Coverage rows — one per schema type
    const coverageRows = (si?.coverage || []).map(({ type, total, conformant, nonConformant, requiredCount, notesWithMissing }) => {
        const pct = total > 0 && requiredCount > 0 ? Math.round(conformant / total * 100) : null;
        const pctColor = pct === null ? 'var(--dim)' : pct === 100 ? 'var(--accent)' : pct >= 75 ? 'var(--accent3)' : 'var(--danger)';
        const conformanceNote = requiredCount === 0
            ? `<span style="font-size:12px;color:var(--dim)">No required fields — schema defines shape only</span>`
            : pct === null
                ? `<span style="font-size:12px;color:var(--dim)">No notes of this type yet</span>`
                : `<span class="schema-pct" style="color:${pctColor}">${pct}%</span><span style="font-size:11px;color:var(--mid)">${conformant} of ${total} note${total !== 1 ? 's' : ''} have all required fields</span>`;
        const pills = notesWithMissing.map(n =>
            `<span class="node-pill drift-pill" data-id="${e(n.noteId)}" title="missing: ${e(n.missingFields.join(', '))}">${e(n.noteId)}</span>`
        ).join('');
        return `<div class="schema-coverage-row">
            <div class="schema-coverage-head">
                <span class="schema-type-label">${e(type)}</span>
                <div class="schema-coverage-meta">
                    ${total > 0 ? `<span class="type-count">${total} note${total !== 1 ? 's' : ''}</span>` : ''}
                    ${total > 0 ? `<button class="view-btn" data-query="!view ${e(type)}" data-label="${e(type)}">View all →</button>` : ''}
                </div>
            </div>
            <div class="schema-coverage-stats">${conformanceNote}</div>
            ${pills ? `<div class="node-pills" style="margin-top:8px">${pills}</div>` : ''}
        </div>`;
    }).join('');

    // Advisory: unschematized types with notes (only shown when ≥1 schema exists)
    const advisories = si?.advisories || [];
    const advisoryHtml = advisories.length > 0
        ? `<div class="schema-advisories">
            <div class="schema-advisories-label">Unschematized types</div>
            ${advisories.map(({ type, count }) =>
                `<div class="schema-advisory">
                    <span class="advisory-count">${count}</span>
                    <span class="advisory-text"><strong>${e(type)}</strong> note${count !== 1 ? 's' : ''} — no schema defined</span>
                    <button class="view-btn" data-query="!view ${e(type)}" data-label="${e(type)}">View →</button>
                </div>`
            ).join('')}
        </div>`
        : '';

    // Dangling relations: schema relation fields whose target type has no vault notes
    const dangling = si?.danglingRelations || [];
    const danglingHtml = dangling.length > 0
        ? `<div class="schema-advisories" style="margin-top:10px">
            <div class="schema-advisories-label" style="color:var(--warn)">Cross-schema warnings</div>
            ${dangling.map(({ schemaType, field, targetType }) =>
                `<div class="schema-advisory advisory-warn">
                    <span class="advisory-text">Schema <strong>${e(schemaType)}</strong> field <code>${e(field)}</code> targets <strong>${e(targetType)}</strong> — no notes of this type exist in the vault</span>
                </div>`
            ).join('')}
        </div>`
        : '';

    const coverageCount = si?.coverage?.length ?? 0;
    return `
    <div class="section" id="section-schema">
        <div class="section-header">
            <span class="section-title">Schema Coverage</span>
            <span class="section-count">${coverageCount} schema${coverageCount !== 1 ? 's' : ''} active</span>
        </div>
        ${coverageRows || `<div class="empty-section"><div class="empty-title">Schemas exist but no matching notes found.</div></div>`}
        ${advisoryHtml}
        ${danglingHtml}
    </div>`;
}

/** @param {object} stats @param {{ scriptUri?: string, nonce?: string, csp?: string }} [webview] */
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
        return `<span class="${cls}" data-id="${esc(note.noteId)}" title="${esc(tooltip)}">${esc(note.noteId)} · ${esc(note.driftLabel)}</span>`;
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
    const activityHtml = todayActivity.length > 0
        ? `<div class="activity-list">${todayActivity.map(({ noteId, count }) =>
            `<div class="activity-row" data-id="${esc(noteId)}"><span class="activity-id">${esc(noteId)}</span><span class="activity-count">${count} change${count === 1 ? '' : 's'}</span></div>`
        ).join('')}</div>`
        : `<div class="empty-section"><div class="empty-title">No mutations recorded today.</div><div class="empty-copy">Edit and save notes to start tracking today's vault activity here.</div></div>`;

    const lifecycleHighlights = (stats.lifecycle?.notes || [])
        .filter((note) => note.state === 'stale' || note.state === 'hub')
        .slice(0, 6)
        .map((note) => `<span class="node-pill ${note.state === 'stale' ? 'orphan-pill' : ''}" data-id="${note.id}" title="${esc(note.summary)}">${esc(note.id)} · ${esc(note.label)}</span>`)
        .join('');

    const hasTemplates = stats.templateDrift && stats.templateDrift.size > 0;
    const hasOrphans   = stats.orphans.length > 0;

    const tabNav = [
        { id: 'activity',    label: 'Activity' },
        { id: 'lifecycle',   label: 'Lifecycle' },
        { id: 'consistency', label: 'Consistency' },
        { id: 'schema',      label: 'Schema' },
        ...(hasTemplates ? [{ id: 'templates', label: 'Templates' }] : []),
        { id: 'types',       label: 'Types' },
        ...(hasOrphans   ? [{ id: 'orphans',   label: 'Orphans'   }] : []),
    ].map((t, i) =>
        `<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`
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
                <span class="section-title">Template Drift</span>
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
<style>${HEALTH_CSS}</style>
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
        <div class="stat-num ${stats.broken > 0 ? 'danger' : 'good'}">${stats.broken}</div>
        <div class="stat-lbl">Broken Links</div>
        ${stats.broken > 0
        ? '<div class="stat-hint">Open diagnostics to fix</div><div class="stat-action">Open Problems →</div>'
        : '<div class="stat-hint">All links resolve</div>'}
    </div>
    <div class="stat-cell clickable ${hasOrphans ? 'has-caution' : ''}" data-action="switchOrphans" title="Indexed notes with no inbound or outbound connections. Click to jump to the Orphans tab.">
        <div class="stat-num ${hasOrphans ? 'warn' : 'good'}">${stats.orphans.length}</div>
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
                <span class="section-title">Today's Activity</span>
                <span class="section-count">${todayActivity.length} note${todayActivity.length !== 1 ? 's' : ''} changed</span>
            </div>
            ${activityHtml}
        </div>
    </div>

    <div class="tab-panel tab-panel--hidden" data-tab="lifecycle" id="section-lifecycle">
        <div class="section">
            <div class="section-header">
                <span class="section-title">Lifecycle States</span>
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
                <span class="section-title">Type Consistency</span>
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
    </div>

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
