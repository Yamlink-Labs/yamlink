'use strict';
const fs = require('fs');
const path = require('path');

const vscode = require('vscode');
const crypto = require('crypto');
const HUB_CSS = fs.readFileSync(path.join(__dirname, 'entityHub.css'), 'utf8');
const {
    buildActionSection,
    buildBlockBacklinkSection,
    buildCompactRelationTableSection,
    buildDocumentSection,
    buildEmptySection,
    buildEntityHubEmptyHtml,
    buildEntityHubErrorHtml,
    buildHistorySection,
    buildKeyValueSection,
    buildNoteArcSection,
    buildStaleConnectedSection,
    buildSummarySection,
    buildTaskSection,
    buildTimelineSection,
    buildUnlinkedMentionsSection,
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
    idIndex,
    historyGroups,
    historyCount,
    historyArc,
    historySessions,
    historyEvolution,
    unlinkedMentions,
    noteArc,
    documentData,
    blockBacklinks,
    staleConnectedNotes
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
    const noteArcSection = buildNoteArcSection(noteArc);
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
    const blockBacklinkHtml = buildBlockBacklinkSection(blockBacklinks || []);
    const unlinkedMentionsHtml = buildUnlinkedMentionsSection(unlinkedMentions || []);
    const taskHtml = taskSections.length
        ? taskSections.map(section => buildTaskSection(section.label, section.rows)).join('\n')
        : buildEmptySection('tasks', 'No task activity tied to this note.', 'Add Markdown tasks in this note or mention this node from another task to track work here.');
    const timelineHtml = buildTimelineSection(timelineRows);
    const historyHtml = buildHistorySection(historyGroups || [], historyCount || 0, historyArc || [], historySessions || [], historyEvolution || null);
    const documentHtml = buildDocumentSection(documentData);
    const staleConnectedHtml = buildStaleConnectedSection(staleConnectedNotes || []);

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};">
<style>${HUB_CSS}</style></head><body>
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
    <label class="sr-only" for="hubsearch">Search the current note report tab</label>
    <input class="hub-search" id="hubsearch" type="text" placeholder="Search this tab..." aria-describedby="visible-count-label">
    <span class="hub-searchcount" id="visible-count-label"><strong id="visible-count">${totalRows}</strong> of ${totalRows}</span>
</div>
<div class="hub-tabs" role="tablist">
    <button class="hub-tab-btn" id="hub-tab-overview" data-tab="overview" role="tab" aria-controls="tab-overview">Overview</button>
    <button class="hub-tab-btn" id="hub-tab-links" data-tab="links" role="tab" aria-controls="tab-links">Links</button>
    <button class="hub-tab-btn" id="hub-tab-tasks" data-tab="tasks" role="tab" aria-controls="tab-tasks">Tasks</button>
    <button class="hub-tab-btn" id="hub-tab-views" data-tab="views" role="tab" aria-controls="tab-views">Views</button>
    <button class="hub-tab-btn" id="hub-tab-history" data-tab="history" role="tab" aria-controls="tab-history">History</button>
    <button class="hub-tab-btn" id="hub-tab-document" data-tab="document" role="tab" aria-controls="tab-document">Document</button>
</div>
<div class="hub-body">
    <div class="hub-tab-pane" id="tab-overview" role="tabpanel" aria-labelledby="hub-tab-overview">
${summarySection}
${noteArcSection}
${vaultPositionSection}
${vaultDiagnosticSection}
${staleConnectedHtml}
    </div>
    <div class="hub-tab-pane" id="tab-links" role="tabpanel" aria-labelledby="hub-tab-links">
${outgoingSections}
${incomingSections}
${bodyMentionSections}
${blockBacklinkHtml}
${unlinkedMentionsHtml}
    </div>
    <div class="hub-tab-pane" id="tab-tasks" role="tabpanel" aria-labelledby="hub-tab-tasks">
${taskHtml}
${timelineHtml}
    </div>
    <div class="hub-tab-pane" id="tab-views" role="tabpanel" aria-labelledby="hub-tab-views">
${nextViewsSection}
    </div>
    <div class="hub-tab-pane" id="tab-history" role="tabpanel" aria-labelledby="hub-tab-history">
${historyHtml}
    </div>
    <div class="hub-tab-pane" id="tab-document" role="tabpanel" aria-labelledby="hub-tab-document">
${documentHtml}
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
