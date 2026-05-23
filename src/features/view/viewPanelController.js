'use strict';

const vscode = require('vscode');
const { perfTracker } = require('../../runtime/performanceTracker');

function createViewPanelController(services) {
    let panel = null;
    let lastQuery = null;
    let onCompleteCallback = null;
    let extensionUri = null;
    let panelState = null;
    let contextNodeId = null;
    let sourceDocumentPath = null;
    let viewPanelStateListener = null;

    function notifyViewPanelStateChange() {
        if (typeof viewPanelStateListener === 'function') {
            viewPanelStateListener({
                open: !!panel,
                sourceDocumentPath
            });
        }
    }

    function renderCurrent(preferredTab = null) {
        if (!panel || !lastQuery || !extensionUri) return;
        perfTracker.measureSync('view.renderPanel', {
            queryCount: Array.isArray(lastQuery) ? lastQuery.length : 1,
            preferredTab: preferredTab ?? 'state'
        }, () => {
            services.renderPanel({
                panel,
                queries: lastQuery,
                extensionUri,
                panelState,
                preferredTab,
                contextNodeId
            });
        });
    }

    function ensurePanel(context) {
        if (panel) return;

        panelState = null;
        panel = vscode.window.createWebviewPanel('yamlink.viewPanel', 'Yamlink View', vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'src', 'features')]
        });

        panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'openNode') {
                await services.openNode(msg.id);
                return;
            }

            if (msg.command === 'openReport') {
                await services.openReport(msg.id);
                return;
            }

            if (msg.command === 'toggleTaskDone') {
                const ok = await services.toggleTaskDone(msg.filePath, msg.line, msg.newDone);
                if (ok) {
                    services.syncIndexAfterWrite(msg.filePath);
                    if (typeof onCompleteCallback === 'function') onCompleteCallback();
                    renderCurrent();
                }
                return;
            }

            if (msg.command === 'editCell') {
                const ok = await services.editCell(msg.filePath, msg.field, msg.value);
                panel?.webview.postMessage({ command: 'editResult', ok, requestId: msg.requestId });
                if (ok) {
                    services.syncIndexAfterWrite(msg.filePath);
                    if (typeof onCompleteCallback === 'function') onCompleteCallback();
                    renderCurrent();
                }
                return;
            }

            if (msg.command === 'editCellsBulk') {
                const edits = Array.isArray(msg.edits) ? msg.edits : [];
                const results = [];
                let anySuccess = false;
                for (const edit of edits) {
                    const ok = await services.editCell(edit.filePath, edit.field, edit.value);
                    if (ok) {
                        anySuccess = true;
                        services.syncIndexAfterWrite(edit.filePath);
                    }
                    results.push({ requestId: edit.requestId, ok });
                }
                panel?.webview.postMessage({ command: 'bulkEditResult', results, source: msg.source || 'user' });
                if (anySuccess) {
                    if (typeof onCompleteCallback === 'function') onCompleteCallback();
                    renderCurrent();
                }
                return;
            }

            if (msg.command === 'saveState') {
                panelState = msg.state;
                return;
            }

            if (msg.command === 'export') {
                await services.exportQueryResult(msg.format, lastQuery, msg.queryIndex, msg.visibleColumns || null, contextNodeId);
                return;
            }

            if (msg.command === 'refineQuery') {
                if (!sourceDocumentPath) {
                    vscode.window.showInformationMessage('Yamlink: This view was not opened from a note, so there is no source block to refine.');
                    return;
                }
                const updatedQueries = await services.refineQuery(sourceDocumentPath, msg.queryIndex);
                if (updatedQueries) {
                    lastQuery = updatedQueries;
                    renderCurrent();
                }
            }
        }, null, context.subscriptions);

        panel.onDidDispose(() => {
            panel = null;
            panelState = null;
            sourceDocumentPath = null;
            notifyViewPanelStateChange();
        }, null, context.subscriptions);

        panel.onDidChangeViewState((e) => {
            if (e.webviewPanel.visible) renderCurrent();
        }, null, context.subscriptions);
    }

    function openViewPanel(context, documentText, onComplete, nextSourceDocumentPath = null, preferredTab = null) {
        const queries = perfTracker.measureSync('view.parseQueries', {
            source: nextSourceDocumentPath ? 'note' : 'ad-hoc'
        }, () => services.parseAllViewQueries(documentText));
        if (!queries) return;

        lastQuery = queries;
        extensionUri = context.extensionUri;
        contextNodeId = services.extractIdFromText(documentText);
        sourceDocumentPath = nextSourceDocumentPath || null;
        if (onComplete) onCompleteCallback = onComplete;

        perfTracker.measureSync('view.ensureIndexBuilt', null, () => services.ensureIndexBuilt());
        ensurePanel(context);
        renderCurrent(typeof preferredTab === 'number' ? preferredTab : null);
        notifyViewPanelStateChange();
    }

    function refreshViewPanel() {
        renderCurrent();
    }

    function isViewPanelOpen() {
        return panel !== null;
    }

    function closeViewPanel() {
        if (panel) panel.dispose();
    }

    function getOpenViewDocumentPath() {
        return sourceDocumentPath;
    }

    function setViewPanelStateListener(listener) {
        viewPanelStateListener = listener;
    }

    return {
        openViewPanel,
        refreshViewPanel,
        isViewPanelOpen,
        closeViewPanel,
        getOpenViewDocumentPath,
        setViewPanelStateListener
    };
}

module.exports = {
    createViewPanelController
};
