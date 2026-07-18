'use strict';

const vscode = require('vscode');
const { getIndex, getPathIndex } = require('../../core/indexService');
const { normaliseState, getPanelTitle, clampDepth } = require('./graphState');
const { buildBootHtml } = require('./graphBootHtml');
const { buildPanelPayload } = require('./graphPayload');
const { buildTimelapseSequence } = require('./graphTimelapse');
const { perfTracker } = require('../../runtime/performanceTracker');

const PANEL_VIEW_TYPE = 'yamlink.graphPanel.v2';

/** @returns {Record<string,any>} */
function createGraphPanelController() {
    let panel = null;
    let panelState = null;
    let panelReady = false;
    let pendingPayload = null;
    let lastActiveMarkdownPath = null;
    let lastActiveNodeId = null;

    function rememberMarkdownPath(filePath) {
        if (!filePath) return null;
        lastActiveMarkdownPath = filePath;
        lastActiveNodeId = getPathIndex().get(filePath) || lastActiveNodeId || null;
        return lastActiveNodeId;
    }

    function getActiveMarkdownTabNodeId() {
        const tabGroups = vscode.window && vscode.window.tabGroups;
        const activeGroup = tabGroups && tabGroups.activeTabGroup;
        const activeTab = activeGroup && activeGroup.activeTab;
        const input = activeTab && activeTab.input;
        if (!input) return null;

        const uri = /** @type {any} */ (input).uri || /** @type {any} */ (input).modified || null;
        const filePath = uri && uri.fsPath ? uri.fsPath : null;
        return rememberMarkdownPath(filePath);
    }

    function getVisibleMarkdownEditor() {
        const visible = Array.isArray(vscode.window.visibleTextEditors)
            ? vscode.window.visibleTextEditors
            : [];
        return visible.find((editor) => editor && editor.document && editor.document.languageId === 'markdown') || null;
    }

    function getPreferredMarkdownEditor() {
        const active = vscode.window.activeTextEditor;
        if (active && active.document.languageId === 'markdown') return active;
        return getVisibleMarkdownEditor();
    }

    function rememberMarkdownEditor(editor = getPreferredMarkdownEditor()) {
        if (!editor || editor.document.languageId !== 'markdown') return null;
        return rememberMarkdownPath(editor.document.uri.fsPath);
    }

    function getPreferredActiveNodeId() {
        const tabId = getActiveMarkdownTabNodeId();
        if (tabId) return tabId;
        const liveId = rememberMarkdownEditor(getPreferredMarkdownEditor());
        if (liveId) return liveId;
        if (lastActiveMarkdownPath) {
            return getPathIndex().get(lastActiveMarkdownPath) || lastActiveNodeId || null;
        }
        return lastActiveNodeId || null;
    }

    function syncLocalGraphToNode(nodeId) {
        if (!panelState || !nodeId) return;
        const changed = panelState.centerNodeId !== nodeId || panelState.selectedNodeId !== nodeId;
        panelState.centerNodeId = nodeId;
        panelState.selectedNodeId = nodeId;
        panelState.expandedNodeIds = new Set([nodeId]);
        panelState.forceLayout = changed;
        if (panel) panel.title = getPanelTitle(panelState);
    }

    function syncExplorerGraphToNode(nodeId) {
        if (!panelState || !nodeId) return;
        const changed = panelState.selectedNodeId !== nodeId;
        panelState.selectedNodeId = nodeId;
        panelState.forceLayout = changed;
        if (panel) panel.title = getPanelTitle(panelState);
    }

    function applyActiveNodeToPanel(nodeId) {
        if (!panelState || !nodeId) return false;
        if (panelState.mode === 'local') {
            const changed = panelState.centerNodeId !== nodeId || panelState.selectedNodeId !== nodeId;
            if (!changed) return false;
            syncLocalGraphToNode(nodeId);
            return true;
        }
        if (panelState.mode === 'vault') {
            const changed = panelState.selectedNodeId !== nodeId;
            if (!changed) return false;
            syncExplorerGraphToNode(nodeId);
            return true;
        }
        return false;
    }

    function resetPanelRuntime(clearContext = false) {
        panel = null;
        panelReady = false;
        pendingPayload = null;
        if (clearContext) {
            panelState = null;
        }
    }

    function pushGraphUpdate() {
        if (!panel || !panelState) return;

        const payload = perfTracker.measureSync('graph.buildPanelPayload', {
            mode: panelState.mode,
            depth: panelState.depth
        }, () => buildPanelPayload(panelState, getPreferredActiveNodeId));
        pendingPayload = payload;

        if (!panelReady) return;

        perfTracker.measureSync('graph.postMessage', {
            mode: panelState.mode,
            nodeCount: payload?.model?.nodes?.length || 0
        }, () => {
            panel.webview.postMessage({
                type: 'updateGraph',
                payload
            });
        });
    }

    async function openNodeInEditor(nodeId) {
        if (!nodeId) return;
        const fp = getIndex().get(nodeId);
        if (!fp) return;
        const doc = await vscode.workspace.openTextDocument(fp);
        const editor = await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preview: false
        });
        rememberMarkdownEditor(editor);
    }

    function handleWebviewMessage(message) {
        if (!message || !panelState) return;

        switch (message.type) {
        case 'webviewReady':
            panelReady = true;
            if (pendingPayload && panel) {
                panel.webview.postMessage({ type: 'updateGraph', payload: pendingPayload });
            }
            break;
        case 'bootStatus':
            if (message.level === 'error' && message.text) {
                vscode.window.showErrorMessage(`Yamlink graph boot failed: ${message.text}`);
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
                panelState.centerNodeId = message.id;
                panelState.selectedNodeId = message.id;
                panelState.expandedNodeIds.add(message.id);
                panelState.mode = 'local';
                panelState.forceLayout = changed;
                if (panel) panel.title = getPanelTitle(panelState);
                pushGraphUpdate();
            }
            break;
        case 'expandNode':
            if (message.id) {
                const before = panelState.expandedNodeIds.size;
                panelState.expandedNodeIds.add(message.id);
                panelState.selectedNodeId = message.id;
                if (panelState.expandedNodeIds.size !== before) {
                    panelState.forceLayout = true;
                }
                pushGraphUpdate();
            }
            break;
        case 'setDepth':
            panelState.depth = clampDepth(message.depth);
            pushGraphUpdate();
            break;
        case 'setMode':
            panelState.mode = message.mode === 'vault' ? 'vault' : 'local';
            if (panelState.mode === 'local') {
                const activeId = getPreferredActiveNodeId();
                if (activeId) {
                    syncLocalGraphToNode(activeId);
                }
            }
            if (panel) panel.title = getPanelTitle(panelState);
            pushGraphUpdate();
            break;
        case 'requestTimelapse':
            if (panel) {
                perfTracker.measureSync('graph.buildTimelapseSequence', null, () => {
                    const payload = buildTimelapseSequence();
                    panel.webview.postMessage({ type: 'timelapseData', payload });
                });
            }
            break;
        case 'revealActive': {
            const activeId = getPreferredActiveNodeId();
            const changed = panelState.mode !== 'local' || (activeId && panelState.centerNodeId !== activeId);
            panelState.mode = 'local';
            if (activeId) {
                syncLocalGraphToNode(activeId);
            }
            panelState.forceLayout = changed;
            if (panel) panel.title = getPanelTitle(panelState);
            pushGraphUpdate();
            break;
        }
        default:
            break;
        }
    }

    function openGraphPanel(context, options = {}) {
        const activeNodeId = getPreferredActiveNodeId();
        const newState = normaliseState(options, activeNodeId, panelState);

        if (panel) {
            try {
                panel.dispose();
            } catch (_) {}
            resetPanelRuntime(false);
        }

        panelState = newState;

        panel = vscode.window.createWebviewPanel(
            PANEL_VIEW_TYPE,
            getPanelTitle(panelState),
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'graph', 'renderer'),
                ]
            }
        );

        // Cache-bust: without a varying query param, Chromium's webview
        // resource cache can serve a stale copy of this externally-loaded
        // module across sessions even after a full window reload, since the
        // URI itself never changes. The inline boot script is regenerated
        // fresh every activation and isn't affected, but this file is loaded
        // via a static asWebviewUri() URL, so it needs its own busting.
        const rendererUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'graph', 'renderer', 'Canvas2DRenderer.js')
        ).toString() + '?v=' + Date.now();

        panel.webview.onDidReceiveMessage((message) => {
            handleWebviewMessage(message);
        }, null, context.subscriptions);

        panel.onDidDispose(() => {
            resetPanelRuntime(true);
        }, null, context.subscriptions);

        panel.webview.html = perfTracker.measureSync('graph.buildBootHtml', null, () => buildBootHtml(panel.webview, context.extensionUri, rendererUri));

        panel.title = getPanelTitle(panelState);
        panel.reveal(vscode.ViewColumn.Beside, false);
        pushGraphUpdate();
    }

    function refreshGraphPanel() {
        if (!panel || !panelState) return;
        const activeId = rememberMarkdownEditor(getPreferredMarkdownEditor());
        applyActiveNodeToPanel(activeId);
        panel.title = getPanelTitle(panelState);
        pushGraphUpdate();
    }

    if (vscode.window && typeof vscode.window.onDidChangeActiveTextEditor === 'function') {
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            const nextId = rememberMarkdownEditor(editor);
            if (!panel || !panelState || !nextId) return;
            if (applyActiveNodeToPanel(nextId)) {
                pushGraphUpdate();
                return;
            }
        });
    }

    if (vscode.window && typeof vscode.window.onDidChangeVisibleTextEditors === 'function') {
        vscode.window.onDidChangeVisibleTextEditors(() => {
            const nextId = rememberMarkdownEditor(getVisibleMarkdownEditor());
            if (!panel || !panelState || !nextId) return;
            if (applyActiveNodeToPanel(nextId)) {
                pushGraphUpdate();
                return;
            }
        });
    }

    if (vscode.window && vscode.window.tabGroups && typeof vscode.window.tabGroups.onDidChangeTabs === 'function') {
        vscode.window.tabGroups.onDidChangeTabs(() => {
            const nextId = getPreferredActiveNodeId();
            if (!panel || !panelState || !nextId) return;
            if (applyActiveNodeToPanel(nextId)) {
                pushGraphUpdate();
                return;
            }
        });
    }

    return {
        openGraphPanel,
        refreshGraphPanel
    };
}

module.exports = {
    createGraphPanelController
};
