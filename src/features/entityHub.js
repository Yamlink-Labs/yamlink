'use strict';

const vscode = require('vscode');
const { getIndex, getPathIndex, getFieldsCache } = require('../core/indexService');
const { getEdges, getBacklinks } = require('../core/graph');
const {
    buildContextualQueryRecipes,
    buildEntityHubModel,
    getVisibleRelationColumns,
    getVisibleTaskColumns,
} = require('./entityHubModel');
const {
    buildHubHtml,
    buildEntityHubEmptyHtml,
    buildEntityHubErrorHtml
} = require('./entity/entityHubHtml');

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

function refreshEntityHub(changedId) {
    if (!sidebarView || !_lastId) return;
    if (changedId && changedId !== _lastId) {
        const neighbors = new Set([
            ...getEdges(_lastId).map(e => e.targetId),
            ...getBacklinks(_lastId).map(e => e.sourceId)
        ]);
        if (!neighbors.has(changedId)) return;
    }
    renderHub(_lastId);
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
                            }).catch(function (err) {
                                console.error('Yamlink — openNode failed:', err.message);
                            });
                            return;
                        }
                        if (msg.command === 'insertView') {
                            const fp = getIndex().get(msg.id);
                            if (!fp) return;
                            vscode.workspace.openTextDocument(fp).then(async function (doc) {
                                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
                                await vscode.commands.executeCommand('yamlink.insertViewBlock', doc, msg.queryText, msg.sourceType, msg.field, msg.id);
                            }).catch(function (err) {
                                console.error('Yamlink — insertView failed:', err.message);
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
            vaultPositionRows,
            vaultDiagnosticRows
        } = model;

        if ('title' in host) host.title = `${nodeId} · report`;

        if (model.isEmpty) {
            host.webview.html = buildEntityHubEmptyHtml(nodeId);
            return;
        }

        host.webview.html = buildHubHtml({
            host,
            extensionUri: _extUri,
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
        });
    } catch (error) {
        renderError(`Could not render report for ${nodeId}`, error);
    }
}
function renderEmpty(label) {
    const host = getHost();
    if (!host) return;
    if ('title' in host) host.title = 'Note report';
    host.webview.html = buildEntityHubEmptyHtml(label);
}

function renderError(label, error) {
    const host = getHost();
    if (!host) return;
    if ('title' in host) host.title = 'Note report';
    host.webview.html = buildEntityHubErrorHtml(label, error);
}

function focusEntityHub() {
    if (sidebarView && typeof sidebarView.show === 'function') {
        sidebarView.show?.(true);
    }
}

module.exports = {
    syncEntityHub,
    refreshEntityHub,
    registerEntityHubView,
    focusEntityHub,
    buildContextualQueryRecipes,
    buildEntityHubModel,
    getVisibleRelationColumns,
    getVisibleTaskColumns
};
