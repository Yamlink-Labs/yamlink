'use strict';

const vscode = require('vscode');
const { parseAllViewQueries } = require('../engine/query');

function registerActiveViewRuntime(context, handlers) {
    const { updateStatusBar, refreshSuggestionBar } = handlers;
    let debounceTimer = null;
    let lastRenderedSignature = null;

    function getActiveMarkdownEditor() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return null;
        if (editor.document.languageId !== 'markdown') return null;
        return editor;
    }

    function schedule(reason) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const editor = getActiveMarkdownEditor();
            if (!editor) return;

            const text = editor.document.getText();
            const queries = parseAllViewQueries(text);
            const signature = queries
                ? `${editor.document.uri.fsPath}:${editor.document.version}:${queries.length}:${reason}`
                : `${editor.document.uri.fsPath}:${editor.document.version}:none:${reason}`;

            if (signature === lastRenderedSignature) return;
            lastRenderedSignature = signature;

            if (typeof updateStatusBar === 'function') updateStatusBar();
            if (typeof refreshSuggestionBar === 'function') refreshSuggestionBar();

        }, 180);
    }

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            const editor = getActiveMarkdownEditor();
            if (!editor) return;
            if (event.document.uri.toString() !== editor.document.uri.toString()) return;
            schedule('change');
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (!editor || editor.document.languageId !== 'markdown') return;
            schedule('active-editor');
        })
    );

    context.subscriptions.push({
        dispose() {
            clearTimeout(debounceTimer);
        }
    });

    return {
        schedule,
        reset() {
            lastRenderedSignature = null;
        }
    };
}

module.exports = { registerActiveViewRuntime };
