'use strict';

const vscode = require('vscode');
const crypto = require('crypto');
const { getIndex, getPathIndex, getFieldsCache } = require('../core/index');
const {
    buildContextualQueryRecipes,
    buildEntityHubModel,
    getVisibleRelationColumns,
    getVisibleTaskColumns,
    extractRelations
} = require('./entityHubModel');

let sidebarView = null;
let _extUri = null;
let _lastId = null;
let _subscriptions = [];
let _syncTimer = null;
let _syncToken = 0;

function syncEntityHub(context, options = {}) {
    _extUri = context.extensionUri;
    const token = ++_syncToken;
    const immediate = options.immediate === true;

    clearTimeout(_syncTimer);
    const run = function () {
        if (token !== _syncToken) return;
        const editor = vscode.window.activeTextEditor;

        if (!editor || editor.document.languageId !== 'markdown') {
            renderEmpty('-');
            return;
        }

        const filePath = editor.document.uri.fsPath;
        const id = getPathIndex().get(filePath) ?? null;
        if (!id) {
            renderEmpty('not a node');
            return;
        }

        _lastId = id;
        renderHub(id);
    };

    if (immediate) {
        run();
        return;
    }
    _syncTimer = setTimeout(run, 80);
}

function refreshEntityHub() {
    if (sidebarView && _lastId) renderHub(_lastId);
}

function registerEntityHubView(context) {
    _extUri = context.extensionUri;
    const provider = {
        resolveWebviewView(view) {
            try {
                sidebarView = view;
                view.webview.options = {
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'src', 'features')]
                };
                disposeSubscriptions();
                _subscriptions = [
                    view.webview.onDidReceiveMessage(function (msg) {
                        if (msg.command === 'openNode') {
                            const fp = getIndex().get(msg.id);
                            if (!fp) return;
                            vscode.workspace.openTextDocument(fp).then(function (doc) {
                                vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
                            });
                            return;
                        }
                        if (msg.command === 'insertView') {
                            const fp = getIndex().get(msg.id);
                            if (!fp) return;
                            vscode.workspace.openTextDocument(fp).then(async function (doc) {
                                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
                                await vscode.commands.executeCommand('yamlink.insertViewBlock', doc, msg.queryText, msg.sourceType, msg.field, msg.id);
                            });
                        }
                    })
                ];

                const editor = vscode.window.activeTextEditor;
                const currentId = editor && editor.document.languageId === 'markdown'
                    ? getPathIndex().get(editor.document.uri.fsPath) ?? null
                    : null;

                if (currentId) {
                    _lastId = currentId;
                    renderHub(currentId);
                } else if (_lastId) {
                    renderHub(_lastId);
                } else {
                    renderEmpty('Select a Yamlink node to open its report');
                }
            } catch (error) {
                renderError('Note report failed to load', error);
            }
        }
    };

    context.subscriptions.push(vscode.window.registerWebviewViewProvider('yamlink.noteReport', provider));
}

function disposeSubscriptions() {
    for (const disposable of _subscriptions) {
        try { disposable.dispose(); } catch (_) {}
    }
    _subscriptions = [];
}

function getHost() {
    return sidebarView || null;
}

function renderHub(nodeId) {
    const host = getHost();
    if (!host) return;
    try {
        const idIndex = getIndex();
        const fieldsCache = getFieldsCache();
        const model = buildEntityHubModel(nodeId, idIndex, fieldsCache);
        const {
            nodeFields,
            incomingGroups,
            outgoingGroups,
            summaryRows,
            taskSections,
            timelineRows,
            suggestions,
            suggestionExplanation,
            recipes,
            vaultPositionRows
        } = model;

        if ('title' in host) host.title = `${nodeId} · report`;

        if (model.isEmpty) {
            host.webview.html = buildEmptyHtml(nodeId);
            return;
        }

        host.webview.html = buildHtml(nodeId, incomingGroups, outgoingGroups, summaryRows, taskSections, timelineRows, suggestions, suggestionExplanation, recipes, vaultPositionRows, nodeFields, idIndex);
    } catch (error) {
        renderError(`Could not render report for ${nodeId}`, error);
    }
}

function buildHtml(nodeId, incomingGroups, outgoingGroups, summaryRows, taskSections, timelineRows, suggestions, suggestionExplanation, recipes, vaultPositionRows, nodeFields, idIndex) {
    const host = getHost();
    const webview = host.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(_extUri, 'src', 'features', 'entityHubScript.js'));
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
        { label: 'tasks', value: String(taskSections.reduce((n, g) => n + g.rows.length, 0)) },
        { label: 'links', value: String(incomingGroups.reduce((n, g) => n + g.rows.length, 0) + outgoingGroups.reduce((n, g) => n + g.rows.length, 0)) }
    ];
    if (createdLabel) statChips.push({ label: 'created', value: createdLabel });

    const summarySection = buildSummarySection(summaryRows);
    const suggestionSection = buildSuggestionSection(nodeId, suggestions, suggestionExplanation);
    const recipeSection = buildRecipeSection(nodeId, recipes);
    const vaultPositionSection = buildKeyValueSection('vault position', 'vault-position', vaultPositionRows);
    const outgoingSections = outgoingGroups.length
        ? outgoingGroups.map(group => buildRelationSection(group.field, group.rows, group.direction)).join('\n')
        : buildEmptySection('outgoing links', 'No outbound links yet.', 'Add frontmatter relations or body wikilinks like <code>[[other-note]]</code> to show what this note points to.');
    const incomingSections = incomingGroups.length
        ? incomingGroups.map(group => buildRelationSection(group.field, group.rows, group.direction)).join('\n')
        : buildEmptySection('incoming links', 'Nothing links here yet.', 'Links from other notes will appear here automatically once this note is referenced.');
    const taskHtml = taskSections.length
        ? taskSections.map(section => buildTaskSection(section.label, section.rows)).join('\n')
        : buildEmptySection('tasks', 'No task activity tied to this note.', 'Add Markdown tasks in this note or mention this node from another task to track work here.');
    const timelineHtml = buildTimelineSection(timelineRows);

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};">
<style>
:root{--hub-pad:14px;--hub-gap:10px;--hub-accent:#4fc4a0;--hub-link:#6eb3f0;--hub-chip-bg:rgba(255,255,255,.045);--hub-chip-border:rgba(255,255,255,.09)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--vscode-editor-background,#141414);color:var(--vscode-editor-foreground,#c8c8c8);font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;min-height:100vh;display:flex;flex-direction:column;overflow:auto}
.hub-header{display:flex;flex-direction:column;gap:9px;padding:12px var(--hub-pad);background:linear-gradient(180deg,rgba(110,179,240,.09),rgba(79,196,160,.03));border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);flex-shrink:0}
.hub-titleline{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.hub-nodewrap{display:flex;flex-direction:column;gap:4px;min-width:0}
.hub-label{font-size:10px;color:#8b949e;letter-spacing:.08em;text-transform:uppercase}
.hub-node{font-size:15px;font-weight:700;color:var(--hub-link);cursor:pointer;letter-spacing:.01em;line-height:1.2;word-break:break-word}
.hub-node:hover{text-decoration:underline}
.hub-meta{font-size:11px;color:var(--vscode-descriptionForeground,#95a1ac);line-height:1.35}
.hub-chips{display:flex;flex-wrap:wrap;gap:6px}
.hub-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;background:var(--hub-chip-bg);border:1px solid var(--hub-chip-border);font-size:11px;color:var(--vscode-editor-foreground,#d0d7de)}
.hub-chip-label{color:#8b949e;text-transform:uppercase;letter-spacing:.07em;font-size:10px}
.hub-searchbar{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px var(--hub-pad);background:var(--vscode-sideBar-background,#1a1a1a);border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);flex-shrink:0}
.hub-search{flex:1;background:var(--vscode-editor-background,#141414);border:1px solid var(--vscode-panel-border,#2a2a2a);border-radius:8px;padding:7px 10px;font:inherit;font-size:12px;color:var(--vscode-editor-foreground,#c8c8c8);outline:none}
.hub-search:focus{border-color:var(--hub-link);box-shadow:0 0 0 1px rgba(110,179,240,.2)}
.hub-search::placeholder{color:#555}
.hub-searchcount{font-size:10px;color:#6f7781;white-space:nowrap;letter-spacing:.06em;text-transform:uppercase}
.hub-searchcount strong{color:var(--hub-accent)}
.hub-body{flex:1;overflow-y:auto;padding:0 0 8px}
.hub-body::-webkit-scrollbar{width:4px}
.hub-body::-webkit-scrollbar-thumb{background:var(--vscode-panel-border,#2a2a2a);border-radius:2px}
.hub-section{border-bottom:1px solid var(--vscode-panel-border,#2a2a2a)}
.hub-section-header{display:flex;align-items:center;gap:8px;padding:8px var(--hub-pad);cursor:pointer;user-select:none;background:var(--vscode-sideBar-background,#1a1a1a)}
.hub-section-header:hover{background:rgba(255,255,255,.02)}
.hub-chevron{font-size:8px;color:#555;transition:transform .12s;display:inline-block;width:10px;flex-shrink:0}
.hub-section.open .hub-chevron{transform:rotate(90deg)}
.hub-field{font-size:11px;font-weight:600;color:var(--hub-link);letter-spacing:.06em;text-transform:uppercase}
.hub-count{font-size:9px;color:#6f7781;background:rgba(255,255,255,.06);border-radius:10px;padding:1px 7px;letter-spacing:.08em}
.hub-section-body{display:none;padding:4px var(--hub-pad) 10px}
.hub-section.open .hub-section-body{display:block}
.summary-grid{display:grid;grid-template-columns:minmax(88px,140px) minmax(0,1fr);gap:8px 12px;margin-top:8px}
.summary-key{font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:.08em;font-weight:600}
.summary-value{font-size:12px;color:#d0d7de;word-break:break-word}
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
.suggestion-query{font-size:11px;color:#8b949e;word-break:break-word}
.suggestion-btn{border:1px solid rgba(110,179,240,.26);border-radius:999px;padding:6px 10px;background:rgba(110,179,240,.1);color:var(--hub-link);font:inherit;font-size:11px;font-weight:600;cursor:pointer;justify-self:start}
.suggestion-btn:hover{background:rgba(110,179,240,.18);border-color:rgba(110,179,240,.4)}
.suggestion-btn[disabled]{cursor:default;background:rgba(255,255,255,.06);color:#8b949e}
.suggestion-btn[disabled]:hover{background:rgba(255,255,255,.06)}
.suggestion-note{font-size:10px;color:#6f7781;letter-spacing:.05em;text-transform:uppercase}
table{width:100%;border-collapse:collapse;margin-top:8px}
thead th.col-id{width:1%}
thead th{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#6f7781;padding:7px 10px;text-align:left;border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);white-space:nowrap;user-select:none;position:sticky;top:0;background:var(--vscode-editor-background,#141414);z-index:1;cursor:pointer;font-weight:600}
thead th:hover{color:#888}
thead th.sorted{color:var(--hub-accent)}
.sarr{opacity:.4;margin-left:3px;font-size:9px}
thead th.sorted .sarr{opacity:1}
tbody tr{border-bottom:1px solid var(--vscode-panel-border,#2a2a2a)}
tbody tr:hover{background:rgba(255,255,255,.03)}
tbody td{padding:8px 10px;font-size:12px;vertical-align:middle}
.cell-id{font-size:12px;color:var(--hub-link);white-space:nowrap;cursor:pointer;font-weight:600}
.cell-id:hover{text-decoration:underline}
.cell-empty{color:#555;font-style:italic}
.cell-rel{font-size:11px;color:var(--hub-accent);background:rgba(79,196,160,.08);border:1px solid rgba(79,196,160,.18);border-radius:999px;padding:2px 7px;display:inline-block;white-space:nowrap;cursor:pointer;margin:1px 2px 1px 0}
.cell-rel:hover{background:rgba(79,196,160,.14);border-color:rgba(79,196,160,.3)}
.live-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px var(--hub-pad);border-top:1px solid var(--vscode-panel-border,#2a2a2a);background:var(--vscode-sideBar-background,#1a1a1a);font-size:10px;color:#6f7781;flex-shrink:0;letter-spacing:.06em;text-transform:uppercase}
.live-left{display:flex;align-items:center;gap:6px}
.live-note{color:#8b949e}
.ldot{width:6px;height:6px;border-radius:50%;background:var(--hub-accent);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
@media (max-width:900px){.suggestion-list{grid-template-columns:1fr 1fr}.summary-grid{grid-template-columns:1fr}.hub-titleline{flex-direction:column;align-items:flex-start}}
@media (max-width:720px){:root{--hub-pad:12px}.hub-searchbar{grid-template-columns:1fr}.summary-key{font-size:9px}.summary-value{font-size:11px}.hub-meta{font-size:10px}.hub-chip{padding:3px 7px}.suggestion-list{grid-template-columns:1fr}.suggestion-btn{width:100%}.live-note{display:none}}
@media (max-width:640px){.hub-chips{gap:5px}.hub-searchcount{display:none}td,th{padding-left:8px;padding-right:8px}}
@media (max-width:460px){:root{--hub-pad:10px}.hub-node{font-size:14px}.hub-label{font-size:9px}.hub-chip{font-size:10px}.suggestion-title{font-size:11px}.suggestion-query{font-size:10px}.hub-field{font-size:10px}.hub-count{font-size:8px}}
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
    <input class="hub-search" id="hubsearch" type="text" placeholder="Search this report...">
    <span class="hub-searchcount"><strong id="visible-count">${totalRows}</strong> of ${totalRows}</span>
</div>
<div class="hub-body">
${summarySection}
${vaultPositionSection}
${recipeSection}
${suggestionSection}
${timelineHtml}
${taskHtml}
${outgoingSections}
${incomingSections}
</div>
<div class="live-bar">
    <div class="live-left"><div class="ldot"></div><span id="jsstatus" style="color:#555">js loading...</span></div>
    <span class="live-note">switch notes to follow report</span>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
}

function buildKeyValueSection(title, fieldName, rows) {
    if (!rows || rows.length === 0) return '';
    const body = rows.map(row => `<div class="summary-key">${esc(row.key)}</div><div class="summary-value">${esc(row.value)}</div>`).join('');
    return [
        `<div class="hub-section open" data-field="${esc(fieldName)}">`,
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">&#9658;</span>',
        `        <span class="hub-field">${esc(title)}</span>`,
        `        <span class="hub-count">${rows.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        `        <div class="summary-grid">${body}</div>`,
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildSummarySection(summaryRows) {
    const body = summaryRows.length
        ? summaryRows.map(row => `<div class="summary-key">${esc(row.key)}</div><div class="summary-value">${esc(row.value)}</div>`).join('')
        : buildSectionEmptyState('No scalar frontmatter yet.', 'Add fields like <code>status:</code>, <code>owner:</code>, or <code>date:</code> to make this note easier to scan.');
    return [
        '<div class="hub-section open" data-field="summary">',
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">&#9658;</span>',
        '        <span class="hub-field">summary</span>',
        `        <span class="hub-count">${summaryRows.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        `        <div class="summary-grid">${body}</div>`,
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildSuggestionSection(nodeId, rows, explanation) {
    if (!rows.length) {
        const reasonList = Array.isArray(explanation?.reasons) && explanation.reasons.length
            ? `<ul class="section-empty-list">${explanation.reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>`
            : '';
        return [
            '<div class="hub-section" data-field="suggestions">',
            '    <div class="hub-section-header">',
            '        <span class="hub-chevron">&#9658;</span>',
            '        <span class="hub-field">suggested views</span>',
            '        <span class="hub-count">0</span>',
            '    </div>',
            '    <div class="hub-section-body">',
            buildSectionEmptyState(
                esc(explanation?.title || 'No suggested views yet.'),
                `${esc(explanation?.description || 'Yamlink is still learning the structure around this note.')}${reasonList}`
            ),
            '    </div>',
            '</div>'
        ].join('\n');
    }

    const bodyRows = rows.map(function (row) {
        const buttonAttrs = row.inserted ? ' disabled aria-disabled="true"' : '';
        const buttonLabel = row.inserted ? 'Already in note' : 'Insert';
        const note = row.inserted ? '<div class="suggestion-note">already in note</div>' : '';
        return [
            '<div class="suggestion-row">',
            `  <div class="suggestion-copy"><div class="suggestion-title">${esc(row.count)} ${esc(row.count === 1 ? row.sourceType : row.sourceType + 's')} via ${esc(row.field)}</div><div class="suggestion-query">${esc(row.queryText)}</div>${note}</div>`,
            `  <button class="suggestion-btn" data-insert-view="${esc(row.queryText)}" data-source-type="${esc(row.sourceType)}" data-field-name="${esc(row.field)}" data-node-id="${esc(nodeId)}"${buttonAttrs}>${buttonLabel}</button>`,
            '</div>'
        ].join('');
    }).join('');

    return [
        '<div class="hub-section open" data-field="suggestions">',
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">&#9658;</span>',
        '        <span class="hub-field">suggested views</span>',
        `        <span class="hub-count">${rows.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        `        <div class="suggestion-list">${bodyRows}</div>`,
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildRecipeSection(nodeId, rows) {
    if (!rows.length) {
        return [
            '<div class="hub-section" data-field="recipes">',
            '    <div class="hub-section-header">',
            '        <span class="hub-chevron">&#9658;</span>',
            '        <span class="hub-field">query recipes</span>',
            '        <span class="hub-count">0</span>',
            '    </div>',
            '    <div class="hub-section-body">',
            buildSectionEmptyState('No recipes available yet.', 'Recipes show the fastest useful views Yamlink can build from this note once it has a clearer type or link context.'),
            '    </div>',
            '</div>'
        ].join('\n');
    }

    const bodyRows = rows.map(function (row) {
        const buttonAttrs = row.inserted ? ' disabled aria-disabled="true"' : '';
        const buttonLabel = row.inserted ? 'Already in note' : 'Insert';
        const note = row.inserted ? '<div class="suggestion-note">already in note</div>' : '';
        return [
            '<div class="suggestion-row">',
            `  <div class="suggestion-copy"><div class="suggestion-title">${esc(row.title)}</div><div class="suggestion-query">${esc(row.description)}</div>${note}</div>`,
            `  <button class="suggestion-btn" data-insert-view="${esc(row.queryText)}" data-node-id="${esc(nodeId)}"${buttonAttrs}>${buttonLabel}</button>`,
            '</div>'
        ].join('');
    }).join('');

    return [
        '<div class="hub-section open" data-field="recipes">',
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">&#9658;</span>',
        '        <span class="hub-field">query recipes</span>',
        `        <span class="hub-count">${rows.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        `        <div class="suggestion-list">${bodyRows}</div>`,
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildRelationSection(field, rows, direction) {
    const columns = getVisibleRelationColumns(rows);
    const headerCells = columns.map(function (col) {
        const cls = col === 'id' ? ' class="col-id"' : '';
        return `<th${cls} data-col="${esc(col)}">${esc(col)} <span class="sarr">↕</span></th>`;
    }).join('');

    const bodyRows = rows.map(function ({ sourceId, fields }) {
        const cells = columns.map(function (col) {
            if (col === 'id') {
                return `<td class="cell-id" data-id="${esc(sourceId)}">${esc(sourceId)}</td>`;
            }
            const val = fields[col] || '';
            if (!val) return '<td class="cell-empty">-</td>';
            const rels = extractRelations(val);
            if (rels.length === 1) return `<td><span class="cell-rel" data-id="${esc(rels[0])}">${esc(rels[0])}</span></td>`;
            if (rels.length > 1) return `<td>${rels.map(id => `<span class="cell-rel" data-id="${esc(id)}">${esc(id)}</span>`).join('')}</td>`;
            return `<td>${esc(val)}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');

    return [
        `<div class="hub-section open" data-field="${esc(direction + ':' + field)}">`,
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">&#9658;</span>',
        `        <span class="hub-field">${esc(direction === 'outgoing' ? `out → ${field}` : `in ← ${field}`)}</span>`,
        `        <span class="hub-count">${rows.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        '        <table>',
        `            <thead><tr>${headerCells}</tr></thead>`,
        `            <tbody>${bodyRows}</tbody>`,
        '        </table>',
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildTaskSection(label, rows) {
    const columns = getVisibleTaskColumns(rows);
    const headerCells = columns
        .map(col => `<th data-col="${esc(col)}">${esc(col)} <span class="sarr">↕</span></th>`)
        .join('');

    const bodyRows = rows.map(function (row) {
        const cells = columns.map(function (col) {
            if (col === 'id') return `<td class="cell-id" data-id="${esc(row.file)}">${esc(row.id)}</td>`;
            if (col === 'date') return `<td>${row.date ? esc(row.date) : '<span class="cell-empty">-</span>'}</td>`;
            if (col === 'done') return `<td>${row.done === 'true' ? '<span class="cell-rel">done</span>' : '<span class="cell-empty">open</span>'}</td>`;
            if (col === 'file') return `<td class="cell-id" data-id="${esc(row.file)}">${esc(row.file)}</td>`;
            if (col === 'text') return `<td>${esc(row.text)}</td>`;
            return '<td class="cell-empty">-</td>';
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');

    return [
        `<div class="hub-section open" data-field="${esc('tasks:' + label)}">`,
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">&#9658;</span>',
        `        <span class="hub-field">${esc(label)}</span>`,
        `        <span class="hub-count">${rows.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        '        <table>',
        `            <thead><tr>${headerCells}</tr></thead>`,
        `            <tbody>${bodyRows}</tbody>`,
        '        </table>',
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildTimelineSection(rows) {
    if (!rows.length) {
        return [
            '<div class="hub-section" data-field="timeline">',
            '    <div class="hub-section-header">',
            '        <span class="hub-chevron">&#9658;</span>',
            '        <span class="hub-field">timeline</span>',
            '        <span class="hub-count">0</span>',
            '    </div>',
            '    <div class="hub-section-body">',
            buildSectionEmptyState('No dated activity yet.', 'Timeline entries appear when this note has a <code>date:</code> field or related tasks include a supported date.'),
            '    </div>',
            '</div>'
        ].join('\n');
    }

    const bodyRows = rows.map(function (row) {
        return [
            '<tr>',
            `  <td>${esc(row.date)}</td>`,
            `  <td>${esc(row.kind)}</td>`,
            `  <td>${esc(row.label)}</td>`,
            `  <td class="cell-id" data-id="${esc(row.source)}">${esc(row.source)}</td>`,
            '</tr>'
        ].join('');
    }).join('');

    return [
        '<div class="hub-section open" data-field="timeline">',
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">&#9658;</span>',
        '        <span class="hub-field">timeline</span>',
        `        <span class="hub-count">${rows.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        '        <table>',
        '            <thead><tr><th data-col="date">date <span class="sarr">↕</span></th><th data-col="kind">kind <span class="sarr">↕</span></th><th data-col="label">label <span class="sarr">↕</span></th><th data-col="source">source <span class="sarr">↕</span></th></tr></thead>',
        `            <tbody>${bodyRows}</tbody>`,
        '        </table>',
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildEmptySection(title, emptyTitle, emptyCopy) {
    return [
        `<div class="hub-section" data-field="${esc(title)}">`,
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">&#9658;</span>',
        `        <span class="hub-field">${esc(title)}</span>`,
        '        <span class="hub-count">0</span>',
        '    </div>',
        '    <div class="hub-section-body">',
        buildSectionEmptyState(emptyTitle, emptyCopy),
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildSectionEmptyState(title, copy) {
    return `<div class="section-empty"><div class="section-empty-title">${title}</div><div class="section-empty-copy">${copy}</div></div>`;
}

function renderEmpty(label) {
    const host = getHost();
    if (!host) return;
    if ('title' in host) host.title = 'Note report';
    host.webview.html = buildEmptyHtml(label);
}

const EMPTY_HINTS = {
    '-':                                  { msg: 'Open a Yamlink note to see its report.', hint: '' },
    'not a node':                         { msg: 'This file is not a Yamlink node.', hint: 'Add <code>id: your-note-id</code> to the frontmatter and save to index it.' },
    'Select a Yamlink node to open its report': { msg: 'Open a note in the editor.', hint: 'The Note Report updates whenever you switch to an indexed Markdown file.' }
};

function buildEmptyHtml(label) {
    const hint = EMPTY_HINTS[label] || { msg: 'Nothing here yet.', hint: 'Link this node to others with <code>[[note-id]]</code> to build its report.' };
    return [
        '<!DOCTYPE html><html><head><meta charset="UTF-8">',
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">',
        '<style>',
        '*{margin:0;padding:0;box-sizing:border-box}',
        'body{background:var(--vscode-editor-background,#141414);color:#888;font-family:\'Segoe UI\',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}',
        '.hub-header{padding:11px 16px 10px;background:var(--vscode-sideBar-background,#1a1a1a);border-bottom:1px solid #2a2a2a;font-size:11px;color:#6f7781;letter-spacing:.08em;text-transform:uppercase}',
        '.center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:20px;text-align:center}',
        '.msg{font-size:12px;color:#6f7781;line-height:1.5}',
        '.hint{font-size:11px;color:#555;line-height:1.6}',
        'code{background:#1e2126;padding:1px 5px;border-radius:4px;font-size:10px}',
        '</style></head><body>',
        `<div class="hub-header">${esc(label)}</div>`,
        `<div class="center"><div class="msg">${hint.msg}</div>${hint.hint ? `<div class="hint">${hint.hint}</div>` : ''}</div>`,
        '</body></html>'
    ].join('\n');
}

function renderError(label, error) {
    const host = getHost();
    if (!host) return;
    if ('title' in host) host.title = 'Note report';
    const detail = error && error.message ? error.message : String(error || 'Unknown error');
    host.webview.html = [
        '<!DOCTYPE html><html><head><meta charset="UTF-8">',
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">',
        '<style>',
        '*{margin:0;padding:0;box-sizing:border-box}',
        'body{background:var(--vscode-editor-background,#141414);color:var(--vscode-editor-foreground,#c8c8c8);font-family:\'Segoe UI\',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}',
        '.hdr{padding:11px 16px 10px;background:var(--vscode-sideBar-background,#1a1a1a);border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);font-size:11px;color:#8b949e;letter-spacing:.08em;text-transform:uppercase}',
        '.body{padding:16px;display:flex;flex-direction:column;gap:10px}',
        '.err{color:#ff9b9b;font-size:13px;font-weight:600}',
        '.detail{color:#8b949e;font-size:12px;line-height:1.45}',
        '</style></head><body>',
        `<div class="hdr">${esc(label)}</div>`,
        '<div class="body">',
        '<div class="err">Note Report hit a runtime error.</div>',
        `<div class="detail">${esc(detail)}</div>`,
        '</div></body></html>'
    ].join('\n');
}

function focusEntityHub() {
    if (sidebarView && typeof sidebarView.show === 'function') {
        sidebarView.show?.(true);
    }
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

module.exports = {
    syncEntityHub,
    refreshEntityHub,
    registerEntityHubView,
    focusEntityHub,
    buildContextualQueryRecipes,
    getVisibleRelationColumns,
    getVisibleTaskColumns
};
