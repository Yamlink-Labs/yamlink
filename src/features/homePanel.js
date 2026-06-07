'use strict';

const vscode   = require('vscode');
const crypto   = require('crypto');
const { getIndex, getFieldsCache } = require('../core/indexService');
const { getTypes }                  = require('../registries/typeRegistry');
const { getBrokenCount }            = require('../diagnostics/diagnostics');
const { getMutationEvents }         = require('../runtime/mutationEventLog');
const { buildHomeHtml, OUTCOME_TYPES } = require('./home/homePanelHtml');

let _panel  = null;
let _extUri = null;

const SYSTEM_TYPES = new Set(['schema', 'template', 'dashboard']);

/** @param {import('vscode').ExtensionContext} context @returns {void} */
function openHomePanel(context) {
    _extUri = context.extensionUri;

    if (_panel) {
        _panel.reveal(vscode.ViewColumn.One);
        _updatePanel();
        return;
    }

    _panel = vscode.window.createWebviewPanel(
        'yamlink.homePanel',
        'Yamlink Home',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'src', 'features'),
                vscode.Uri.joinPath(context.extensionUri, 'media'),
            ]
        }
    );

    _panel.webview.onDidReceiveMessage(msg => {
        const idIndex = getIndex();

        if (msg.command === 'openNode') {
            const fp = idIndex.get(msg.id);
            if (fp) vscode.workspace.openTextDocument(fp).then(doc =>
                vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false })
            );
        }
        if (msg.command === 'runCommand' && msg.id) {
            vscode.commands.executeCommand(msg.id);
        }
        if (msg.command === 'openProblems') {
            vscode.commands.executeCommand('workbench.actions.view.problems');
        }
        if (msg.command === 'openUntypedView') {
            const { openViewPanel } = require('./viewPanel');
            openViewPanel(context, '# Notes without a type\n\n!view where type is empty\n');
        }
    }, null, context.subscriptions);

    _panel.onDidDispose(() => { _panel = null; }, null, context.subscriptions);

    _updatePanel();
}

/** @returns {void} */
function _updatePanel() {
    if (!_panel || !_extUri) return;

    const idIndex    = getIndex();
    const fieldsCache = getFieldsCache();
    const events     = getMutationEvents({ limit: 200 });

    // Pulse
    const noteCount  = idIndex.size;
    const typeCount  = [...getTypes()].filter(t => !SYSTEM_TYPES.has(t)).length;
    const brokenCount = getBrokenCount();

    // Types list for quick-action buttons (exclude system types, max 4)
    const types = [...getTypes()].filter(t => !SYSTEM_TYPES.has(t)).slice(0, 4);

    // Activity feed: last 15 meaningful events, most recent first
    const activityEvents = events
        .filter(e => !OUTCOME_TYPES.has(e.type))
        .slice(-15)
        .reverse();

    // Continue working: 5 most recently mutated distinct noteIds in idIndex
    const recentNoteIds = [];
    const seen = new Set();
    for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (OUTCOME_TYPES.has(e.type)) continue;
        if (!seen.has(e.noteId) && idIndex.has(e.noteId)) {
            seen.add(e.noteId);
            recentNoteIds.push(e.noteId);
        }
        if (recentNoteIds.length >= 5) break;
    }

    // Nudges (at most 2)
    const nudges = [];
    if (brokenCount > 0) nudges.push({ type: 'broken', count: brokenCount });
    const untypedCount = [...fieldsCache.values()].filter(f => !String(f.type || '').trim()).length;
    if (untypedCount > 0 && nudges.length < 2) nudges.push({ type: 'untyped', count: untypedCount });

    const todayDate  = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const vaultName  = (() => {
        const folders = vscode.workspace.workspaceFolders;
        return (folders && folders.length) ? folders[0].name : 'Vault';
    })();

    const nonce     = crypto.randomBytes(16).toString('hex');
    const csp       = _panel.webview.cspSource;
    const scriptUri = _panel.webview.asWebviewUri(
        vscode.Uri.joinPath(_extUri, 'src', 'features', 'home', 'homeScript.js')
    ).toString();
    const logoUri   = _panel.webview.asWebviewUri(
        vscode.Uri.joinPath(_extUri, 'media', 'icon.png')
    ).toString();

    _panel.webview.html = buildHomeHtml(
        { noteCount, typeCount, brokenCount, activityEvents, recentNoteIds, types, nudges, fieldsCache, idIndex, vaultName, todayDate },
        { nonce, csp, scriptUri, logoUri }
    );
}

/** Refresh the panel if it is open (called by the refresh router). @returns {void} */
function refreshHomePanel() {
    if (_panel) _updatePanel();
}

module.exports = { openHomePanel, refreshHomePanel };
