'use strict';

const vscode = require('vscode');
const { getIndex, getPathIndex } = require('../../core/indexService');
const { perfTracker } = require('../../runtime/performanceTracker');
const { normalizeGraph2State, GRAPH2_SCOPES } = require('./graph2State');
const { buildGraph2Payload } = require('./graph2Payload');
const { buildGraph2SidebarBootHtml } = require('./graph2SidebarBootHtml');

/** @returns {Record<string,any>} */
function createGraph2SidebarController() {
    let sidebarView = null;
    let panelState = null;
    let ready = false;
    let pendingPayload = null;
    let lastActiveNodeId = null;
    let lastActiveMarkdownPath = null;

    function getPreferredMarkdownEditor() {
        const active = vscode.window.activeTextEditor;
        if (active && active.document.languageId === 'markdown') return active;
        const visible = Array.isArray(vscode.window.visibleTextEditors)
            ? vscode.window.visibleTextEditors : [];
        return visible.find(e => e && e.document.languageId === 'markdown') || null;
    }

    function rememberMarkdownEditor(editor) {
        const e = editor !== undefined ? editor : getPreferredMarkdownEditor();
        if (!e || e.document.languageId !== 'markdown') return null;
        const filePath = e.document.uri.fsPath;
        lastActiveMarkdownPath = filePath;
        const nodeId = getPathIndex().get(filePath);
        if (nodeId) lastActiveNodeId = nodeId;
        return lastActiveNodeId;
    }

    function getPreferredActiveNodeId() {
        const liveId = rememberMarkdownEditor();
        if (liveId) return liveId;
        if (lastActiveMarkdownPath) {
            return getPathIndex().get(lastActiveMarkdownPath) || lastActiveNodeId || null;
        }
        return lastActiveNodeId || null;
    }

    function pushUpdate() {
        if (!sidebarView || !panelState) return;
        let payload;
        try {
            payload = perfTracker.measureSync('graph2.sidebar.buildPayload', {
                scope: panelState.scope,
                budgetMs: 300
            }, () => buildGraph2Payload(panelState, getPreferredActiveNodeId));
            payload = { ...payload, uiMode: 'sidebar' };
        } catch (err) {
            console.error('Yamlink — graph2 sidebar payload failed:', err);
            return;
        }
        pendingPayload = payload;
        if (!ready || !sidebarView.visible) return;
        sidebarView.webview.postMessage({ type: 'graph2:update', payload });
    }

    async function openNodeInEditor(nodeId) {
        if (!nodeId) return;
        const fp = getIndex().get(nodeId);
        if (!fp) return;
        try {
            const doc = await vscode.workspace.openTextDocument(fp);
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        } catch (err) {
            console.error('Yamlink — graph2 sidebar openNode failed:', err.message);
        }
    }

    function handleMessage(message) {
        if (!message || !panelState) return;
        switch (message.type) {
        case 'graph2:ready':
            ready = true;
            if (pendingPayload && sidebarView) {
                sidebarView.webview.postMessage({ type: 'graph2:update', payload: pendingPayload });
            }
            break;
        case 'openNode':
            openNodeInEditor(message.id);
            break;
        case 'setScope': {
            const activeId = getPreferredActiveNodeId();
            panelState = normalizeGraph2State({
                ...panelState,
                scope: message.scope,
                ...([GRAPH2_SCOPES.VAULT, GRAPH2_SCOPES.DOMAIN].includes(message.scope)
                    ? { centerNodeId: null, selectedNodeId: null }
                    : {})
            }, activeId, panelState);
            pushUpdate();
            break;
        }
        case 'focusCurrent': {
            const focusId = getPreferredActiveNodeId();
            panelState = normalizeGraph2State({
                ...panelState,
                ...(focusId ? { scope: GRAPH2_SCOPES.NEIGHBORHOOD, centerNodeId: focusId, selectedNodeId: focusId } : {})
            }, focusId, panelState);
            pushUpdate();
            break;
        }
        case 'exploreNode': {
            if (message.id) {
                panelState = normalizeGraph2State({
                    ...panelState,
                    scope: GRAPH2_SCOPES.LOCAL,
                    centerNodeId: message.id,
                    selectedNodeId: message.id
                }, getPreferredActiveNodeId(), panelState);
                pushUpdate();
            }
            break;
        }
        default:
            break;
        }
    }

    function registerGraphView(context) {
        const provider = {
            resolveWebviewView(webviewView) {
                sidebarView = webviewView;
                ready = false;

                webviewView.webview.options = {
                    enableScripts: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(context.extensionUri, 'graph', 'renderer')
                    ]
                };

                if (!panelState) {
                    const activeId = getPreferredActiveNodeId();
                    panelState = normalizeGraph2State({
                        scope: GRAPH2_SCOPES.VAULT,
                        centerNodeId: null,
                        selectedNodeId: null
                    }, activeId, null);
                }

                const rendererUri = webviewView.webview.asWebviewUri(
                    vscode.Uri.joinPath(context.extensionUri, 'graph', 'renderer', 'Canvas2DRenderer.js')
                ).toString();

                webviewView.webview.html = perfTracker.measureSync(
                    'graph2.sidebar.buildBootHtml', null,
                    () => buildGraph2SidebarBootHtml(webviewView.webview, context.extensionUri, rendererUri)
                );

                webviewView.webview.onDidReceiveMessage(
                    (msg) => handleMessage(msg),
                    null,
                    context.subscriptions
                );

                webviewView.onDidChangeVisibility(() => {
                    if (webviewView.visible && panelState) pushUpdate();
                });

                // Seed pendingPayload immediately so it's ready when graph2:ready arrives.
                pushUpdate();
            }
        };

        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('yamlink.graph', provider, {
                webviewOptions: { retainContextWhenHidden: true }
            })
        );

        // Follow active editor. Vault and domain scopes stay stable — user presses ◎ to recenter.
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            const nextId = rememberMarkdownEditor(editor);
            if (!sidebarView || !panelState || !nextId) return;
            const stableScopes = new Set([GRAPH2_SCOPES.VAULT, GRAPH2_SCOPES.DOMAIN]);
            if (stableScopes.has(panelState.scope)) return;
            panelState = normalizeGraph2State({ ...panelState, centerNodeId: nextId }, nextId, panelState);
            pushUpdate();
        });
    }

    function refreshGraphSidebarView() {
        if (!sidebarView || !panelState) return;
        pushUpdate();
    }

    return { registerGraphView, refreshGraphSidebarView };
}

module.exports = { createGraph2SidebarController };
