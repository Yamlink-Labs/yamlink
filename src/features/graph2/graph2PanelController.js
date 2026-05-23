'use strict';

const vscode = require('vscode');
const { getPathIndex, getIndex } = require('../../core/indexService');
const { perfTracker } = require('../../runtime/performanceTracker');
const { normalizeGraph2State } = require('./graph2State');
const { buildGraph2Payload } = require('./graph2Payload');
const { buildGraph2BootHtml } = require('./graph2BootHtml');

const GRAPH2_PANEL_VIEW_TYPE = 'yamlink.graphPanel.v3';

function createGraph2PanelController() {
    let panel = null;
    let panelState = null;
    let ready = false;
    let pendingPayload = null;
    let lastActiveNodeId = null;
    let editorListenerRegistered = false;

    function rememberMarkdownEditor(editor) {
        const e = editor !== undefined ? editor : vscode.window.activeTextEditor;
        if (!e || e.document.languageId !== 'markdown') return lastActiveNodeId;
        const filePath = e.document.uri.fsPath;
        const nodeId = getPathIndex().get(filePath);
        if (nodeId) lastActiveNodeId = nodeId;
        return lastActiveNodeId;
    }

    function getActiveMarkdownNodeId() {
        if (lastActiveNodeId) return lastActiveNodeId;
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') return null;
        return getPathIndex().get(editor.document.uri.fsPath) || null;
    }

    function pushUpdate() {
        if (!panel || !panelState) return;
        let payload;
        try {
            payload = perfTracker.measureSync('graph2.buildPayload', {
                source: panelState.source,
                scope: panelState.scope,
                depth: panelState.depth,
                budgetMs: 300
            }, () => buildGraph2Payload(panelState, getActiveMarkdownNodeId));
            payload = { ...payload, uiMode: 'workspace' };
        } catch (err) {
            console.error('Yamlink — graph2 payload build failed:', err);
            return;
        }
        pendingPayload = payload;
        if (!ready) return;
        panel.webview.postMessage({ type: 'graph2:update', payload });
    }

    async function openNodeInEditor(nodeId) {
        if (!nodeId) return;
        const filePath = getIndex().get(nodeId);
        if (!filePath) return;
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    }

    function applyMessage(message) {
        if (!message || !panelState) return;
        switch (message.type) {
        case 'graph2:ready':
            ready = true;
            if (pendingPayload && panel) {
                panel.webview.postMessage({ type: 'graph2:update', payload: pendingPayload });
            }
            break;
        case 'openNode':
            openNodeInEditor(message.id);
            break;
        case 'setScope':
            panelState = normalizeGraph2State({
                ...panelState,
                scope: message.scope,
                ...(['vault', 'domain'].includes(message.scope)
                    ? { centerNodeId: null, selectedNodeId: null }
                    : {})
            }, getActiveMarkdownNodeId(), panelState);
            panel.title = getGraph2Title(panelState);
            pushUpdate();
            break;
        case 'applyControls':
            panelState = normalizeGraph2State({
                ...panelState,
                source: message.source,
                depth: message.depth,
                nodeCap: message.nodeCap,
                queryText: message.queryText,
                customNodeIds: message.customNodeIds || []
            }, getActiveMarkdownNodeId(), panelState);
            panel.title = getGraph2Title(panelState);
            pushUpdate();
            break;
        case 'toggleFilter':
            panelState = normalizeGraph2State({
                ...panelState,
                filters: toggleFacetFilter(panelState.filters, message.facetKind, message.value)
            }, getActiveMarkdownNodeId(), panelState);
            pushUpdate();
            break;
        case 'resetFilters':
            panelState = normalizeGraph2State({
                ...panelState,
                filters: {
                    types: [],
                    relationTypes: [],
                    tags: [],
                    hideArchived: true,
                    hideOrphans: false,
                    hideWeakMentions: false
                }
            }, getActiveMarkdownNodeId(), panelState);
            pushUpdate();
            break;
        case 'setCenter':
            panelState = normalizeGraph2State({
                ...panelState,
                source: 'current',
                // Vault/domain aren't meaningful when re-rooting on a specific node.
                scope: ['vault', 'domain'].includes(panelState.scope) ? 'neighborhood' : panelState.scope,
                centerNodeId: message.id,
                selectedNodeId: message.id,
                pinnedCenter: true
            }, getActiveMarkdownNodeId(), panelState);
            panel.title = getGraph2Title(panelState);
            pushUpdate();
            break;
        case 'showMoreWorkspace':
            panelState = normalizeGraph2State({
                ...panelState,
                workspaceFocusCap: (panelState.workspaceFocusCap || 5) + 3
            }, getActiveMarkdownNodeId(), panelState);
            pushUpdate();
            break;
        case 'focusCurrent': {
            const focusNodeId = getActiveMarkdownNodeId();
            // If no markdown note is active, do nothing rather than rebuilding with empty seeds.
            if (!focusNodeId) break;
            panelState = normalizeGraph2State({
                ...panelState,
                source: 'current',
                scope: 'neighborhood',
                centerNodeId: focusNodeId,
                selectedNodeId: focusNodeId,
                pinnedCenter: false
            }, focusNodeId, panelState);
            panel.title = getGraph2Title(panelState);
            pushUpdate();
            break;
        }
        default:
            break;
        }
    }

    function openGraph2Panel(context, options = {}) {
        rememberMarkdownEditor(undefined);
        const activeNodeId = getActiveMarkdownNodeId();
        panelState = normalizeGraph2State(options, activeNodeId, panelState);

        if (panel) {
            panel.reveal(vscode.ViewColumn.Beside, false);
            panel.title = getGraph2Title(panelState);
            pushUpdate();
            return;
        }

        // Own editor-follow listener — registered once per extension lifetime.
        // Uses the callback editor arg directly (avoids stale vscode.window.activeTextEditor reads).
        if (!editorListenerRegistered) {
            editorListenerRegistered = true;
            context.subscriptions.push(
                vscode.window.onDidChangeActiveTextEditor((editor) => {
                    const nextId = rememberMarkdownEditor(editor);
                    if (!panel || !panelState || !nextId) return;
                    const stableScopes = new Set(['vault', 'domain']);
                    if (stableScopes.has(panelState.scope)) return;
                    // Switching tabs clears any pinned center — auto-follow resumes.
                    panelState = normalizeGraph2State({ ...panelState, centerNodeId: nextId, pinnedCenter: false }, nextId, panelState);
                    panel.title = getGraph2Title(panelState);
                    pushUpdate();
                })
            );
        }

        panel = vscode.window.createWebviewPanel(
            GRAPH2_PANEL_VIEW_TYPE,
            getGraph2Title(panelState),
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'src', 'features', 'vendor')
                ]
            }
        );

        panel.webview.onDidReceiveMessage((message) => applyMessage(message), null, context.subscriptions);
        panel.onDidDispose(() => {
            panel = null;
            panelState = null;
            ready = false;
            pendingPayload = null;
        }, null, context.subscriptions);

        panel.webview.html = perfTracker.measureSync('graph2.buildBootHtml', null, () => buildGraph2BootHtml(panel.webview, context.extensionUri));
        pushUpdate();
    }

    function refreshGraph2Panel() {
        if (!panel || !panelState) return;
        pushUpdate();
    }

    return {
        openGraph2Panel,
        refreshGraph2Panel
    };
}

function getGraph2Title(state) {
    const scope = String(state?.scope || 'neighborhood');
    return `Graph 2.0 · ${scope.charAt(0).toUpperCase()}${scope.slice(1)}`;
}

module.exports = {
    createGraph2PanelController
};

function toggleFacetFilter(filters, facetKind, value) {
    const next = {
        ...filters,
        types: [...(filters.types || [])],
        relationTypes: [...(filters.relationTypes || [])],
        tags: [...(filters.tags || [])]
    };

    const cleanValue = String(value || '').trim();
    if (!cleanValue) return next;

    if (facetKind === 'type') {
        next.types = toggleString(next.types, cleanValue);
    } else if (facetKind === 'relation') {
        next.relationTypes = toggleString(next.relationTypes, cleanValue);
    } else if (facetKind === 'tag') {
        next.tags = toggleString(next.tags, cleanValue);
    }

    return next;
}

function toggleString(values, value) {
    const target = String(value).toLowerCase();
    const exists = values.some((entry) => String(entry).toLowerCase() === target);
    if (exists) {
        return values.filter((entry) => String(entry).toLowerCase() !== target);
    }
    return [...values, value];
}
