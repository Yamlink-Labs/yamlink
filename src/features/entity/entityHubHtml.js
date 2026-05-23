'use strict';

const vscode = require('vscode');
const crypto = require('crypto');
const {
    buildActionSection,
    buildCompactRelationTableSection,
    buildEmptySection,
    buildEntityHubEmptyHtml,
    buildEntityHubErrorHtml,
    buildKeyValueSection,
    buildSummarySection,
    buildTaskSection,
    buildTimelineSection,
    esc,
    splitSummaryRows
} = require('./entityHubSections');

function buildHubHtml({
    host,
    extensionUri,
    nodeId,
    incomingGroups,
    outgoingGroups,
    summaryRows,
    taskSections,
    timelineRows,
    suggestions,
    suggestionExplanation,
    recipes,
    vaultPositionRows,
    vaultDiagnosticRows,
    nodeFields,
    idIndex
}) {
    const webview = host.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'features', 'entityHubScript.js'));
    const nonce = crypto.randomBytes(16).toString('hex');
    const csp = webview.cspSource;
    const idOpts = [...idIndex.keys()].map(id => `<option value="${esc(id)}">`).join('');
    const totalRows = summaryRows.length
        + incomingGroups.reduce((n, g) => n + g.rows.length, 0)
        + outgoingGroups.reduce((n, g) => n + g.rows.length, 0)
        + taskSections.reduce((n, g) => n + g.rows.length, 0)
        + timelineRows.length
        + suggestions.length
        + recipes.length;
    const typeLabel = nodeFields.type ? String(nodeFields.type) : 'node';
    const createdLabel = String(nodeFields.created || '').trim();
    const statChips = [
        { label: 'type', value: typeLabel },
        { label: 'summary', value: String(summaryRows.length) },
        { label: 'tasks', value: String(taskSections.filter(s => s.label === 'tasks in this note').reduce((n, g) => n + g.rows.length, 0)) },
        { label: 'links', value: String(incomingGroups.reduce((n, g) => n + g.rows.length, 0) + outgoingGroups.reduce((n, g) => n + g.rows.length, 0)) }
    ];
    if (createdLabel) statChips.push({ label: 'created', value: createdLabel });

    const { primaryRows, secondaryRows } = splitSummaryRows(summaryRows);
    const summarySection = buildSummarySection(primaryRows, secondaryRows);
    const nextViewsSection = buildActionSection(nodeId, suggestions, recipes, suggestionExplanation);
    const vaultPositionSection = buildKeyValueSection('signals', 'vault-position', vaultPositionRows, false);
    const vaultDiagnosticSection = buildKeyValueSection('signal details', 'vault-position-details', vaultDiagnosticRows, false);
    const structuredOutgoingGroups = outgoingGroups.filter(group => group.field !== 'body');
    const bodyOutgoingGroups = outgoingGroups.filter(group => group.field === 'body');
    const structuredIncomingGroups = incomingGroups.filter(group => group.field !== 'body');
    const bodyIncomingGroups = incomingGroups.filter(group => group.field === 'body');
    const outgoingSections = structuredOutgoingGroups.length
        ? buildCompactRelationTableSection('outgoing relations', 'outgoing-links', structuredOutgoingGroups)
        : buildEmptySection('outgoing relations', 'No structured outbound relations yet.', 'Add frontmatter relations like <code>commander: [[johnny-rico]]</code> or <code>unit: [[roughnecks]]</code> to show what this note points to.');
    const incomingSections = structuredIncomingGroups.length
        ? buildCompactRelationTableSection('incoming relations', 'incoming-links', structuredIncomingGroups)
        : buildEmptySection('incoming relations', 'No structured inbound relations yet.', 'Structured links from other notes will appear here automatically once this note is referenced in frontmatter.');
    const bodyMentionSections = [
        bodyOutgoingGroups.length
            ? buildCompactRelationTableSection('body mentions from this note', 'outgoing-body-links', bodyOutgoingGroups, false)
            : '',
        bodyIncomingGroups.length
            ? buildCompactRelationTableSection('body mentions to this note', 'incoming-body-links', bodyIncomingGroups, false)
            : ''
    ].filter(Boolean).join('\n');
    const taskHtml = taskSections.length
        ? taskSections.map(section => buildTaskSection(section.label, section.rows)).join('\n')
        : buildEmptySection('tasks', 'No task activity tied to this note.', 'Add Markdown tasks in this note or mention this node from another task to track work here.');
    const timelineHtml = buildTimelineSection(timelineRows);

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};">
<style>
:root{--hub-pad:14px;--hub-gap:10px;--hub-accent:var(--vscode-charts-green,#4fc4a0);--hub-accent-rose:var(--vscode-charts-purple,#d78ad6);--hub-link:var(--vscode-textLink-foreground,#6eb3f0);--hub-chip-bg:color-mix(in srgb,var(--vscode-editorWidget-background,#1d2228) 92%,var(--hub-accent) 8%);--hub-chip-border:color-mix(in srgb,var(--vscode-panel-border,#2a2a2a) 84%,var(--hub-accent) 16%);--hub-chip-label:color-mix(in srgb,var(--vscode-descriptionForeground,#8b949e) 82%,var(--hub-accent) 18%);--hub-pill-bg:color-mix(in srgb,var(--vscode-editorWidget-background,#1d2228) 94%,var(--hub-accent) 6%);--hub-pill-border:color-mix(in srgb,var(--vscode-panel-border,#2a2a2a) 88%,var(--hub-accent) 12%)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--vscode-editor-background,#141414);color:var(--vscode-editor-foreground,#c8c8c8);font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;min-height:100vh;display:flex;flex-direction:column;overflow:auto}
.hub-header{display:flex;flex-direction:column;gap:9px;padding:12px var(--hub-pad);background:linear-gradient(180deg,rgba(110,179,240,.09),rgba(79,196,160,.03));border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);flex-shrink:0}
.hub-titleline{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.hub-nodewrap{display:flex;flex-direction:column;gap:4px;min-width:0}
.hub-label{font-size:10px;color:var(--vscode-descriptionForeground,#8b949e);letter-spacing:.08em;text-transform:uppercase}
.hub-node{font-size:15px;font-weight:700;color:var(--hub-link);cursor:pointer;letter-spacing:.01em;line-height:1.2;word-break:break-word}
.hub-node:hover{text-decoration:underline}
.hub-meta{font-size:11px;color:var(--vscode-descriptionForeground,#95a1ac);line-height:1.35}
.hub-chips{display:flex;flex-wrap:wrap;gap:6px}
.hub-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;background:var(--hub-chip-bg);border:1px solid var(--hub-chip-border);box-shadow:inset 0 1px 0 rgba(255,255,255,.02);font-size:11px;color:var(--vscode-editor-foreground,#d0d7de)}
.hub-chip-label{color:var(--hub-chip-label);text-transform:uppercase;letter-spacing:.07em;font-size:10px}
.hub-searchbar{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px var(--hub-pad);background:var(--vscode-sideBar-background,#1a1a1a);border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);flex-shrink:0}
.hub-search{flex:1;background:var(--vscode-editor-background,#141414);border:1px solid var(--vscode-panel-border,#2a2a2a);border-radius:8px;padding:7px 10px;font:inherit;font-size:12px;color:var(--vscode-editor-foreground,#c8c8c8);outline:none}
.hub-search:focus{border-color:var(--hub-link);box-shadow:0 0 0 1px rgba(110,179,240,.2)}
.hub-search::placeholder{color:var(--vscode-input-placeholderForeground,#888)}
.hub-searchcount{font-size:10px;color:var(--vscode-descriptionForeground,#6f7781);white-space:nowrap;letter-spacing:.06em;text-transform:uppercase}
.hub-searchcount strong{color:var(--hub-accent)}
.hub-body{flex:1;overflow-y:auto;padding:0 0 8px}
.hub-body::-webkit-scrollbar{width:4px}
.hub-body::-webkit-scrollbar-thumb{background:var(--vscode-panel-border,#2a2a2a);border-radius:2px}
.hub-section{border-bottom:1px solid var(--vscode-panel-border,#2a2a2a)}
.hub-section-header{display:flex;align-items:center;gap:8px;padding:8px var(--hub-pad);cursor:pointer;user-select:none;background:var(--vscode-sideBar-background,#1a1a1a)}
.hub-section-header:hover{background:var(--vscode-list-hoverBackground,rgba(100,100,100,.06))}
.hub-chevron{font-size:8px;color:var(--vscode-descriptionForeground,#888);transition:transform .12s;display:inline-block;width:10px;flex-shrink:0}
.hub-section.open .hub-chevron{transform:rotate(90deg)}
.hub-field{font-size:11px;font-weight:600;color:var(--hub-link);letter-spacing:.06em;text-transform:uppercase}
.hub-count{font-size:9px;color:var(--hub-chip-label);background:var(--hub-pill-bg);border:1px solid var(--hub-pill-border);border-radius:10px;padding:1px 7px;letter-spacing:.08em}
.hub-section-body{display:none;padding:4px var(--hub-pad) 10px}
.hub-section.open .hub-section-body{display:block}
.summary-grid{display:grid;grid-template-columns:minmax(88px,140px) minmax(0,1fr);gap:8px 12px;margin-top:8px}
.summary-key{font-size:10px;color:var(--vscode-descriptionForeground,#8b949e);text-transform:uppercase;letter-spacing:.08em;font-weight:600}
.summary-value{font-size:12px;color:var(--vscode-editor-foreground,#d0d7de);word-break:break-word}
.section-empty{display:flex;flex-direction:column;gap:6px;padding:10px 12px;margin-top:8px;border:1px dashed color-mix(in srgb, var(--vscode-panel-border,#2a2a2a) 86%, transparent);border-radius:12px;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.012))}
.section-empty-title{font-size:12px;font-weight:600;color:var(--vscode-editor-foreground,#d0d7de)}
.section-empty-copy{font-size:11px;line-height:1.5;color:var(--vscode-descriptionForeground,#95a1ac)}
.section-empty-list{margin:6px 0 0 16px;padding:0;display:flex;flex-direction:column;gap:4px}
.section-empty-list li{font-size:11px;line-height:1.4;color:var(--vscode-descriptionForeground,#95a1ac)}
.section-empty-copy code{background:rgba(255,255,255,.06);border-radius:5px;padding:1px 5px;font-size:10px;color:var(--vscode-editor-foreground,#d0d7de)}
.suggestion-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:8px}
.suggestion-row{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;align-items:start;padding:10px;border:1px solid var(--vscode-panel-border,#2a2a2a);border-radius:12px;background:linear-gradient(180deg,rgba(255,255,255,.02),rgba(255,255,255,.012))}
.suggestion-copy{display:flex;flex-direction:column;gap:4px;min-width:0}
.suggestion-title{font-size:12px;font-weight:600;color:var(--vscode-editor-foreground,#c8c8c8)}
.suggestion-query{font-size:11px;color:var(--vscode-descriptionForeground,#8b949e);word-break:break-word}
.suggestion-btn{border:1px solid rgba(110,179,240,.26);border-radius:999px;padding:6px 10px;background:rgba(110,179,240,.1);color:var(--hub-link);font:inherit;font-size:11px;font-weight:600;cursor:pointer;justify-self:start}
.suggestion-btn:hover{background:rgba(110,179,240,.18);border-color:rgba(110,179,240,.4)}
.suggestion-btn[disabled]{cursor:default;background:rgba(255,255,255,.06);color:#8b949e}
.suggestion-btn[disabled]:hover{background:rgba(255,255,255,.06)}
.suggestion-note{font-size:10px;color:var(--vscode-descriptionForeground,#6f7781);letter-spacing:.05em;text-transform:uppercase}
table{width:100%;border-collapse:collapse;margin-top:8px}
thead th.col-id{width:1%}
thead th{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#6f7781;padding:7px 10px;text-align:left;border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);white-space:nowrap;user-select:none;position:sticky;top:0;background:var(--vscode-editor-background,#141414);z-index:1;cursor:pointer;font-weight:600}
thead th:hover{color:#888}
thead th.sorted{color:var(--hub-accent)}
.sarr{opacity:.4;margin-left:3px;font-size:9px}
thead th.sorted .sarr{opacity:1}
tbody tr{border-bottom:1px solid var(--vscode-panel-border,#2a2a2a)}
tbody tr:hover{background:var(--vscode-list-hoverBackground,rgba(100,100,100,.06))}
tbody td{padding:8px 10px;font-size:12px;vertical-align:middle}
.cell-id{font-size:12px;color:var(--hub-link);white-space:nowrap;cursor:pointer;font-weight:600}
.cell-id:hover{text-decoration:underline}
.cell-empty{color:var(--vscode-disabledForeground,#888);font-style:italic}
.cell-rel{font-size:11px;color:var(--hub-accent);background:rgba(79,196,160,.08);border:1px solid rgba(79,196,160,.18);border-radius:999px;padding:2px 7px;display:inline-block;white-space:nowrap;cursor:pointer;margin:1px 2px 1px 0}
.cell-rel:hover{background:rgba(79,196,160,.14);border-color:rgba(79,196,160,.3)}
.hub-tabs{display:flex;background:var(--vscode-sideBar-background,#1a1a1a);border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);flex-shrink:0}
.hub-tab-btn{flex:1;background:none;border:none;border-bottom:2px solid transparent;padding:8px 2px 7px;font:inherit;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground,#6f7781);cursor:pointer;letter-spacing:.05em;text-transform:uppercase;transition:color .1s,border-color .1s;outline:none}
.hub-tab-btn:hover{color:var(--vscode-editor-foreground,#c8c8c8)}
.hub-tab-btn.active{color:var(--hub-accent);border-bottom-color:var(--hub-accent)}
.hub-tab-pane{display:none}
.hub-tab-pane.active{display:block}
@media (max-width:900px){.suggestion-list{grid-template-columns:1fr 1fr}.summary-grid{grid-template-columns:1fr}.hub-titleline{flex-direction:column;align-items:flex-start}}
@media (max-width:720px){:root{--hub-pad:12px}.hub-searchbar{grid-template-columns:1fr}.summary-key{font-size:9px}.summary-value{font-size:11px}.hub-meta{font-size:10px}.hub-chip{padding:3px 7px}.suggestion-list{grid-template-columns:1fr}.suggestion-btn{width:100%}.live-note{display:none}}
@media (max-width:640px){.hub-chips{gap:5px}.hub-searchcount{display:none}td,th{padding-left:8px;padding-right:8px}}
@media (max-width:460px){:root{--hub-pad:10px}.hub-node{font-size:14px}.hub-label{font-size:9px}.hub-chip{font-size:10px}.hub-tab-btn{font-size:10px;letter-spacing:.02em}.suggestion-title{font-size:11px}.suggestion-query{font-size:10px}.hub-field{font-size:10px}.hub-count{font-size:8px}}
</style></head><body>
<datalist id="yids">${idOpts}</datalist>
<div class="hub-header">
    <div class="hub-titleline">
        <div class="hub-nodewrap">
            <span class="hub-label">Note report</span>
            <span class="hub-node" data-id="${esc(nodeId)}">${esc(nodeId)}</span>
            <span class="hub-meta">${esc(typeLabel)} · ${incomingGroups.length} inbound group${incomingGroups.length === 1 ? '' : 's'} · ${outgoingGroups.length} outgoing group${outgoingGroups.length === 1 ? '' : 's'}</span>
        </div>
    </div>
    <div class="hub-chips">${statChips.map(function (chip) { return `<span class="hub-chip"><span class="hub-chip-label">${esc(chip.label)}</span><span>${esc(chip.value)}</span></span>`; }).join('')}</div>
</div>
<div class="hub-searchbar">
    <input class="hub-search" id="hubsearch" type="text" placeholder="Search this tab...">
    <span class="hub-searchcount"><strong id="visible-count">${totalRows}</strong> of ${totalRows}</span>
</div>
<div class="hub-tabs" role="tablist">
    <button class="hub-tab-btn" data-tab="overview" role="tab">Overview</button>
    <button class="hub-tab-btn" data-tab="links" role="tab">Links</button>
    <button class="hub-tab-btn" data-tab="tasks" role="tab">Tasks</button>
    <button class="hub-tab-btn" data-tab="views" role="tab">Views</button>
</div>
<div class="hub-body">
    <div class="hub-tab-pane" id="tab-overview" role="tabpanel">
${summarySection}
${vaultPositionSection}
${vaultDiagnosticSection}
    </div>
    <div class="hub-tab-pane" id="tab-links" role="tabpanel">
${outgoingSections}
${incomingSections}
${bodyMentionSections}
    </div>
    <div class="hub-tab-pane" id="tab-tasks" role="tabpanel">
${taskHtml}
${timelineHtml}
    </div>
    <div class="hub-tab-pane" id="tab-views" role="tabpanel">
${nextViewsSection}
    </div>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
}

module.exports = {
    buildHubHtml,
    buildEntityHubEmptyHtml,
    buildEntityHubErrorHtml
};
