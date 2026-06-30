'use strict';

const crypto = require('crypto');
const vscode = require('vscode');
const { getPathIndex } = require('../../core/index');
const { appendMutationEvents } = require('../../runtime/mutationEventLog');
const { buildLiveNoteModel, buildLiveNoteBodyHtml } = require('./liveNoteModel');
const { LIVE_NOTE_STYLES, LIVE_TOOLBAR_STYLES } = require('./liveNoteStyles');

const LIVE_NOTE_VIEW_TYPE = 'yamlink.liveNote';

function createLiveNotePanelController() {
    let panel = null;
    let lastFilePath = null;

    function getActiveMarkdownEditor() {
        const editor = vscode.window.activeTextEditor;
        return editor && editor.document.languageId === 'markdown' ? editor : null;
    }

    function escapeAttr(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function toJsLiteral(str) {
        return JSON.stringify(str).replace(/<\//g, '<\\/');
    }

    async function revealSourceLine(line) {
        if (!lastFilePath) return;
        try {
            const doc = await vscode.workspace.openTextDocument(lastFilePath);
            const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
            const targetLine = Number.isInteger(line) && line >= 0 ? line : 0;
            const pos = new vscode.Position(targetLine, 0);
            const range = new vscode.Range(pos, pos);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(range, vscode.TextEditorRevealType?.InCenterIfOutsideViewport ?? vscode.TextEditorRevealType?.InCenter);
            const noteId = getPathIndex().get(lastFilePath) || '__vault__';
            appendMutationEvents([{
                type: 'live_note_reveal_source',
                noteId,
                field: 'source',
                oldValue: null,
                newValue: String(targetLine + 1),
                source: 'vscode',
                cause: 'live_note_reveal_line',
                meta: { line: targetLine + 1 }
            }]);
        } catch (_) {}
    }

    function renderEditor(editor) {
        if (!editor) return null;
        const fsPath = editor.document.uri.fsPath;
        const docText = editor.document.getText();
        const contextNodeId = getPathIndex().get(fsPath) || null;
        const model = buildLiveNoteModel(docText, fsPath, contextNodeId);
        return {
            ...model,
            filePath: fsPath,
            html: buildLiveNoteBodyHtml(model)
        };
    }

    function buildBootHtml(model) {
        const nonce = crypto.randomBytes(16).toString('hex');
        const bodyHtml = toJsLiteral(model?.html || '<p class="preview-empty">Open a Markdown note to use Live Note mode.</p>');
        const title = model?.title || 'Live Note';
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
<title>${escapeAttr(title)}</title>
<style>${LIVE_TOOLBAR_STYLES}</style>
</head>
<body>
<div class="toolbar">
  <div class="toolbar-title-wrap">
    <span class="toolbar-title" id="toolbarTitle">${escapeAttr(title)}</span>
    <span class="toolbar-subtitle">Rendered while you keep editing the source note</span>
  </div>
  <div class="toolbar-actions">
    <button class="toolbar-btn" id="sourceBtn">Reveal source</button>
    <button class="toolbar-btn" id="reportBtn">Open Note Report</button>
  </div>
</div>
<div id="noteHost"></div>
<script nonce="${nonce}">(function(){
  var vscodeApi = acquireVsCodeApi();
  var host = document.getElementById('noteHost');
  var shadow = host.attachShadow({ mode: 'open' });
  var styleEl = document.createElement('style');
  styleEl.textContent = ${toJsLiteral(LIVE_NOTE_STYLES)};
  shadow.appendChild(styleEl);
  var shell = document.createElement('div');
  shell.className = 'yl-live-shell';
  shell.innerHTML = ${bodyHtml};
  shadow.appendChild(shell);

  function bindSourceTargets() {
    shadow.querySelectorAll('[data-source-line]').forEach(function(node){
      if (node.dataset.bound === '1') return;
      node.dataset.bound = '1';
      node.addEventListener('click', function(ev){
        var target = ev.currentTarget;
        var line = Number(target.getAttribute('data-source-line'));
        if (Number.isNaN(line)) return;
        vscodeApi.postMessage({ type: 'live:revealLine', line: line });
      });
    });
  }
  bindSourceTargets();

  document.getElementById('sourceBtn').addEventListener('click', function(){
    vscodeApi.postMessage({ type: 'live:revealSource' });
  });
  document.getElementById('reportBtn').addEventListener('click', function(){
    vscodeApi.postMessage({ type: 'live:openReport' });
  });

  window.addEventListener('message', function(e){
    var msg = e.data;
    if (!msg) return;
    if (msg.type === 'live:update') {
      shell.innerHTML = msg.html || '';
      if (msg.title) document.getElementById('toolbarTitle').textContent = msg.title;
      bindSourceTargets();
    }
  });
}());</script>
</body>
</html>`;
    }

    async function revealSource() {
        if (!lastFilePath) return;
        try {
            const doc = await vscode.workspace.openTextDocument(lastFilePath);
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
            const noteId = getPathIndex().get(lastFilePath) || '__vault__';
            appendMutationEvents([{
                type: 'live_note_reveal_source',
                noteId,
                field: 'source',
                oldValue: null,
                newValue: 'document',
                source: 'vscode',
                cause: 'live_note_reveal_source'
            }]);
        } catch (_) {}
    }

    async function openReport() {
        if (!lastFilePath) return;
        try {
            const doc = await vscode.workspace.openTextDocument(lastFilePath);
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
            await vscode.commands.executeCommand('yamlink.openHub');
            const noteId = getPathIndex().get(lastFilePath) || '__vault__';
            appendMutationEvents([{
                type: 'live_note_open_report',
                noteId,
                field: 'report',
                oldValue: null,
                newValue: 'note_report',
                source: 'vscode',
                cause: 'live_note_open_report'
            }]);
        } catch (_) {}
    }

    function pushModelToPanel(model) {
        if (!panel || !model) return;
        lastFilePath = model.filePath || null;
        panel.title = `Live: ${model.title}`;
        panel.webview.postMessage({ type: 'live:update', html: model.html, title: model.title });
    }

    function openLiveNotePanel(context) {
        const editor = getActiveMarkdownEditor();

        if (panel) {
            panel.reveal(vscode.ViewColumn.Beside, false);
            if (editor) pushModelToPanel(renderEditor(editor));
            return;
        }

        const model = editor ? renderEditor(editor) : null;
        if (model) {
            lastFilePath = model.filePath || null;
            appendMutationEvents([{
                type: 'live_note_opened',
                noteId: getPathIndex().get(model.filePath) || '__vault__',
                field: 'live_note',
                oldValue: null,
                newValue: model.title || 'live-note',
                source: 'vscode',
                cause: 'live_note_open'
            }]);
        }

        panel = vscode.window.createWebviewPanel(
            LIVE_NOTE_VIEW_TYPE,
            model ? `Live: ${model.title}` : 'Live Note',
            vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        panel.webview.html = buildBootHtml(model);

        panel.webview.onDidReceiveMessage((message) => {
            if (!message) return;
            if (message.type === 'live:revealSource') {
                revealSource();
                return;
            }
            if (message.type === 'live:revealLine') {
                revealSourceLine(Number(message.line));
                return;
            }
            if (message.type === 'live:openReport') {
                openReport();
            }
        }, null, context.subscriptions);

        panel.onDidDispose(() => {
            panel = null;
            lastFilePath = null;
        }, null, context.subscriptions);
    }

    function refreshLiveNotePanel() {
        if (!panel) return;
        const editor = getActiveMarkdownEditor();
        if (!editor) return;
        pushModelToPanel(renderEditor(editor));
    }

    function refreshLiveNotePanelForDocument(document) {
        if (!panel || !document || document.languageId !== 'markdown') return;
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== document) return;
        pushModelToPanel(renderEditor(editor));
    }

    return {
        openLiveNotePanel,
        refreshLiveNotePanel,
        refreshLiveNotePanelForDocument
    };
}

module.exports = { createLiveNotePanelController };
