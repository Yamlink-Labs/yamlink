'use strict';

const vscode = require('vscode');
const { getIndex, getPathIndex } = require('../../core/indexService');
const { normaliseState, clampDepth } = require('./graphState');
const { buildBootHtml } = require('./graphBootHtml');
const { buildPanelPayload } = require('./graphPayload');
const { perfTracker } = require('../../runtime/performanceTracker');

function createGraphSidebarController() {
    let sidebarView = null;
    let panelState = null;
    let viewReady = false;
    let pendingPayload = null;
    let lastActiveNodeId = null;
    let lastActiveMarkdownPath = null;

    function rememberMarkdownPath(filePath) {
        if (!filePath) return null;
        lastActiveMarkdownPath = filePath;
        lastActiveNodeId = getPathIndex().get(filePath) || lastActiveNodeId || null;
        return lastActiveNodeId;
    }

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
        return rememberMarkdownPath(e.document.uri.fsPath);
    }

    function getPreferredActiveNodeId() {
        const liveId = rememberMarkdownEditor();
        if (liveId) return liveId;
        if (lastActiveMarkdownPath) {
            return getPathIndex().get(lastActiveMarkdownPath) || lastActiveNodeId || null;
        }
        return lastActiveNodeId || null;
    }

    function syncLocalToNode(nodeId) {
        if (!panelState || !nodeId) return;
        const changed = panelState.centerNodeId !== nodeId || panelState.selectedNodeId !== nodeId;
        panelState.centerNodeId = nodeId;
        panelState.selectedNodeId = nodeId;
        panelState.expandedNodeIds = new Set([nodeId]);
        panelState.forceLayout = changed;
    }

    function syncVaultToNode(nodeId) {
        if (!panelState || !nodeId) return;
        panelState.selectedNodeId = nodeId;
        panelState.forceLayout = false;
    }

    function pushViewUpdate() {
        if (!sidebarView || !panelState) return;
        const payload = perfTracker.measureSync('graph.sidebar.buildPayload', {
            mode: panelState.mode,
            depth: panelState.depth
        }, () => buildPanelPayload(panelState, getPreferredActiveNodeId));
        pendingPayload = payload;
        if (!viewReady || !sidebarView.visible) return;
        sidebarView.webview.postMessage({ type: 'updateGraph', payload });
    }

    async function openNodeInEditor(nodeId) {
        if (!nodeId) return;
        const fp = getIndex().get(nodeId);
        if (!fp) return;
        try {
            const doc = await vscode.workspace.openTextDocument(fp);
            const editor = await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.One,
                preview: false
            });
            rememberMarkdownEditor(editor);
        } catch (err) {
            console.error('Yamlink — sidebar graph openNode failed:', err.message);
        }
    }

    function handleViewMessage(message) {
        if (!message || !panelState) return;
        switch (message.type) {
        case 'webviewReady':
            viewReady = true;
            if (pendingPayload && sidebarView) {
                sidebarView.webview.postMessage({ type: 'updateGraph', payload: pendingPayload });
            }
            break;
        case 'bootStatus':
            if (message.level === 'error' && message.text) {
                vscode.window.showErrorMessage(`Yamlink graph error: ${message.text}`);
            }
            break;
        case 'openNode':
            openNodeInEditor(message.id);
            break;
        case 'selectNode':
            panelState.selectedNodeId = message.id || null;
            break;
        case 'focusNode':
            if (message.id) {
                const changed = panelState.centerNodeId !== message.id || panelState.mode !== 'local';
                panelState.mode = 'local';
                panelState.centerNodeId = message.id;
                panelState.selectedNodeId = message.id;
                panelState.expandedNodeIds.add(message.id);
                panelState.forceLayout = changed;
                pushViewUpdate();
            }
            break;
        case 'expandNode':
            if (message.id) {
                const before = panelState.expandedNodeIds.size;
                panelState.expandedNodeIds.add(message.id);
                panelState.selectedNodeId = message.id;
                if (panelState.expandedNodeIds.size !== before) panelState.forceLayout = true;
                pushViewUpdate();
            }
            break;
        case 'setDepth':
            panelState.depth = clampDepth(message.depth);
            pushViewUpdate();
            break;
        case 'setMode':
            panelState.mode = message.mode === 'vault' ? 'vault' : 'local';
            if (panelState.mode === 'local') {
                const activeId = getPreferredActiveNodeId();
                if (activeId) syncLocalToNode(activeId);
            }
            pushViewUpdate();
            break;
        case 'revealActive': {
            const activeId = getPreferredActiveNodeId();
            const changed = panelState.mode !== 'local' || (activeId && panelState.centerNodeId !== activeId);
            panelState.mode = 'local';
            if (activeId) syncLocalToNode(activeId);
            panelState.forceLayout = changed;
            pushViewUpdate();
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
                viewReady = false;

                webviewView.webview.options = {
                    enableScripts: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(context.extensionUri, 'src', 'features', 'vendor')
                    ]
                };

                if (!panelState) {
                    panelState = normaliseState({ mode: 'vault' }, getPreferredActiveNodeId(), null);
                }

                webviewView.webview.html = perfTracker.measureSync(
                    'graph.sidebar.buildBootHtml', null,
                    () => buildBootHtml(webviewView.webview, context.extensionUri)
                );

                webviewView.webview.onDidReceiveMessage(
                    (msg) => handleViewMessage(msg),
                    null,
                    context.subscriptions
                );

                webviewView.onDidChangeVisibility(() => {
                    if (webviewView.visible && panelState) pushViewUpdate();
                });
            }
        };

        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('yamlink.graph', provider, {
                webviewOptions: { retainContextWhenHidden: true }
            })
        );

        // Follow the active editor: highlight its node in vault mode, re-center in local mode
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            const nextId = rememberMarkdownEditor(editor);
            if (!sidebarView || !panelState || !nextId) return;
            if (panelState.mode === 'local') {
                syncLocalToNode(nextId);
                pushViewUpdate();
            } else {
                syncVaultToNode(nextId);
                pushViewUpdate();
            }
        });
    }

    function refreshGraphSidebarView() {
        if (!sidebarView || !panelState) return;
        const activeId = rememberMarkdownEditor();
        if (panelState.mode === 'local' && activeId) {
            syncLocalToNode(activeId);
        } else if (panelState.mode === 'vault' && activeId) {
            syncVaultToNode(activeId);
        }
        pushViewUpdate();
    }

    return { registerGraphView, refreshGraphSidebarView };
}

module.exports = { createGraphSidebarController };
