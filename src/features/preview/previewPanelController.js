'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vscode = require('vscode');
const { renderNotePreview } = require('./previewRenderer');
const { TOOLBAR_STYLES, NOTE_STYLES } = require('./previewStyles');
const { getPathIndex } = require('../../core/index');

const PREVIEW_VIEW_TYPE = 'yamlink.notePreview';

function createPreviewPanelController() {
    let panel = null;
    let lastHtml = '';
    let lastTitle = 'Note Preview';

    function getActiveMarkdownEditor() {
        const editor = vscode.window.activeTextEditor;
        return editor && editor.document.languageId === 'markdown' ? editor : null;
    }

    function escapeAttr(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Safely encode a string for embedding inside a JS <script> block.
    // JSON.stringify gives a valid JS string literal; we additionally escape
    // </ so the sequence </script> never appears unescaped inside the tag.
    function toJsLiteral(str) {
        return JSON.stringify(str).replace(/<\//g, '<\\/');
    }

    function buildBootHtml(articleHtml, displayTitle) {
        const nonce = crypto.randomBytes(16).toString('hex');
        const safeHtml = toJsLiteral(articleHtml);

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
<title>${escapeAttr(displayTitle)}</title>
<style>${TOOLBAR_STYLES}</style>
</head>
<body>
<div class="toolbar">
  <span class="toolbar-title" id="toolbarTitle">${escapeAttr(displayTitle)}</span>
  <button class="print-btn" id="printBtn">&#9113;&nbsp;Export / Print PDF</button>
</div>
<div id="noteHost"></div>
<script nonce="${nonce}">(function(){
  var vscodeApi = acquireVsCodeApi();

  /* ── Shadow DOM: complete CSS isolation from VS Code's injected theme ── */
  var host = document.getElementById('noteHost');
  var shadow = host.attachShadow({ mode: 'open' });

  var styleEl = document.createElement('style');
  styleEl.textContent = ${toJsLiteral(NOTE_STYLES)};
  shadow.appendChild(styleEl);

  var article = document.createElement('article');
  article.innerHTML = ${safeHtml};
  shadow.appendChild(article);

  /* ── Message handling ──────────────────────────────────────────────── */
  document.getElementById('printBtn').addEventListener('click', function() {
    vscodeApi.postMessage({ type: 'requestPrint' });
  });

  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg) return;
    if (msg.type === 'preview:update') {
      shadow.querySelector('article').innerHTML = msg.html || '';
      if (msg.title) document.getElementById('toolbarTitle').textContent = msg.title;
    }
  });
}());</script>
</body>
</html>`;
    }

    function buildPrintHtml(articleHtml, title) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeAttr(title)}</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#111}
body{font:15px/1.75 'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}
#printbar{
  position:fixed;top:0;left:0;right:0;
  display:flex;align-items:center;justify-content:space-between;
  padding:8px 20px;background:#f3f4f6;border-bottom:1px solid #ddd;
  font-family:sans-serif;font-size:13px;color:#333;z-index:999
}
#printbar button{
  padding:6px 16px;background:#0078d4;color:#fff;border:none;
  border-radius:4px;font-size:13px;cursor:pointer;font-family:sans-serif
}
#printbar button:hover{background:#005fa3}
.note-body{max-width:860px;margin:60px auto 48px;padding:40px 48px}
.note-body h1{font-size:2em;font-weight:700;margin:0 0 .4em;line-height:1.2;color:#0a0a0a;font-family:sans-serif}
.note-body h2{font-size:1.45em;font-weight:700;margin:1.5em 0 .4em;padding-bottom:.2em;border-bottom:1px solid #ddd;color:#111;font-family:sans-serif}
.note-body h3,.note-body h4,.note-body h5,.note-body h6{font-family:sans-serif;color:#111;font-weight:700;margin:1.2em 0 .3em}
.note-body h3{font-size:1.2em}.note-body h4,.note-body h5,.note-body h6{font-size:1em}
.note-body p{margin:0 0 1em;color:#111}
.note-body ul,.note-body ol{margin:0 0 1em 1.5em;padding:0;color:#111}
.note-body li{margin-bottom:.25em;color:#111}
.note-body blockquote{margin:1em 0;padding:.5em 1em;border-left:4px solid #ccc;color:#555;font-style:italic}
.note-body code{font-family:monospace;font-size:.875em;background:#f0f0f0;padding:2px 4px;border-radius:3px;color:#c0392b}
.note-body pre{background:#f6f8fa;border:1px solid #ddd;border-radius:4px;padding:1em;overflow-x:auto;margin:0 0 1em;font-size:.875em}
.note-body pre code{background:none;padding:0;color:#111}
.note-body hr{border:none;border-top:1px solid #ddd;margin:1.5em 0}
.note-body a{color:#0078d4}
.note-body table{width:100%;border-collapse:collapse;margin:0 0 1em;font-size:.9em;font-family:sans-serif;background:#fff;color:#111}
.note-body table th{background:#f0f0f0;color:#111;font-weight:600;text-align:left;padding:8px 12px;border:1px solid #bbb}
.note-body table td{padding:7px 12px;border:1px solid #bbb;color:#111;background:#fff}
.note-body table tbody tr:nth-child(even) td{background:#f8f9fa}
.note-body img{max-width:100%;height:auto}
.wikilink{color:#555}
@media print{
  #printbar{display:none}
  .note-body{margin-top:0}
  @page{margin:1.8cm 2cm}
}
</style>
</head>
<body>
<div id="printbar">
  <span>${escapeAttr(title)}</span>
  <button onclick="window.print()">&#9113; Print / Save as PDF</button>
</div>
<article class="note-body">${articleHtml}</article>
<script>
window.addEventListener('load', function() { setTimeout(function() { window.print(); }, 400); });
</script>
</body>
</html>`;
    }

    function openInBrowserForPrint(html, title) {
        try {
            const tmpPath = path.join(os.tmpdir(), `yamlink-preview-${Date.now()}.html`);
            fs.writeFileSync(tmpPath, buildPrintHtml(html, title), 'utf8');
            vscode.env.openExternal(vscode.Uri.file(tmpPath));
        } catch (err) {
            vscode.window.showErrorMessage(`Yamlink: Could not open print preview — ${err.message}`);
        }
    }

    function renderEditor(editor) {
        if (!editor) return null;
        const fsPath = editor.document.uri.fsPath;
        const docText = editor.document.getText();
        const title = path.basename(fsPath, '.md');
        const contextNodeId = getPathIndex().get(fsPath) || null;
        let html;
        try {
            html = renderNotePreview(docText, contextNodeId);
        } catch (err) {
            console.error('Yamlink — preview render failed:', err);
            html = `<p class="preview-error">Preview failed: ${escapeAttr(err.message)}</p>`;
        }
        return { html, title };
    }

    function openPreviewPanel(context) {
        const editor = getActiveMarkdownEditor();

        if (panel) {
            panel.reveal(vscode.ViewColumn.Beside, false);
            if (editor) {
                const rendered = renderEditor(editor);
                if (rendered) {
                    lastHtml = rendered.html;
                    lastTitle = rendered.title;
                    panel.title = `Preview: ${rendered.title}`;
                    panel.webview.postMessage({ type: 'preview:update', html: rendered.html, title: rendered.title });
                }
            }
            return;
        }

        const rendered = editor ? renderEditor(editor) : null;
        const panelTitle = rendered ? `Preview: ${rendered.title}` : 'Note Preview';
        const articleHtml = rendered
            ? rendered.html
            : '<p class="preview-empty">Open a Markdown note to preview it here.</p>';

        if (rendered) {
            lastHtml = rendered.html;
            lastTitle = rendered.title;
        }

        panel = vscode.window.createWebviewPanel(
            PREVIEW_VIEW_TYPE,
            panelTitle,
            vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        panel.webview.html = buildBootHtml(articleHtml, rendered ? rendered.title : 'Note Preview');

        panel.webview.onDidReceiveMessage((message) => {
            if (message && message.type === 'requestPrint') {
                openInBrowserForPrint(lastHtml, lastTitle);
            }
        }, null, context.subscriptions);

        panel.onDidDispose(() => { panel = null; }, null, context.subscriptions);
    }

    function refreshPreviewPanel() {
        if (!panel) return;
        const editor = getActiveMarkdownEditor();
        if (!editor) return;
        const rendered = renderEditor(editor);
        if (!rendered) return;
        lastHtml = rendered.html;
        lastTitle = rendered.title;
        panel.title = `Preview: ${rendered.title}`;
        panel.webview.postMessage({ type: 'preview:update', html: rendered.html, title: rendered.title });
    }

    return { openPreviewPanel, refreshPreviewPanel };
}

module.exports = { createPreviewPanelController };
