// src/features/decorations.js
//
// Visual decoration for resolved [[wikilinks]] in the editor.
//
// Two decoration types work together:
//   bracketDecoration  — dims the [[ and ]] brackets (opacity 0.25, no underline)
//   linkDecoration     — underlines + colors the inner ID only
//
// Result: [[roughnecks]] where brackets recede and the ID reads as a link.
// Unresolved links are left alone — diagnostics.js handles those with squiggles.
//
// Debounced at 300ms on document change. Zero disk reads — index only.

const vscode = require('vscode');

// The [[ and ]] brackets — dimmed, no underline
const bracketDecoration = vscode.window.createTextEditorDecorationType({
    opacity: '0.25',
    textDecoration: 'none'
});

// The inner ID — underlined in the VS Code link color
const linkDecoration = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline',
    color: new vscode.ThemeColor('textLink.foreground')
});

let debounceTimer = null;

function registerDecorations(context, getIndex) {

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) updateDecorations(activeEditor, getIndex);

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) updateDecorations(editor, getIndex);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document !== event.document) return;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => updateDecorations(editor, getIndex), 300);
        })
    );

    return {
        refresh() {
            const editor = vscode.window.activeTextEditor;
            if (editor) updateDecorations(editor, getIndex);
        }
    };
}

function updateDecorations(editor, getIndex) {
    if (!editor || editor.document.languageId !== 'markdown') {
        editor.setDecorations(bracketDecoration, []);
        editor.setDecorations(linkDecoration, []);
        return;
    }

    const idIndex  = getIndex();
    const text     = editor.document.getText();
    const regex    = /\[\[([^\]]+)\]\]/g;

    const brackets = []; // ranges for [[ and ]]
    const links    = []; // ranges for the inner ID

    let match;
    while ((match = regex.exec(text)) !== null) {
        const id = match[1].trim();
        if (!idIndex.has(id)) continue; // unresolved — leave alone

        const fullStart = match.index;
        const fullEnd   = match.index + match[0].length;
        const idStart   = match.index + 2;           // after [[
        const idEnd     = match.index + 2 + match[1].length; // before ]]

        // Opening [[
        brackets.push({
            range: new vscode.Range(
                editor.document.positionAt(fullStart),
                editor.document.positionAt(fullStart + 2)
            )
        });

        // Closing ]]
        brackets.push({
            range: new vscode.Range(
                editor.document.positionAt(fullEnd - 2),
                editor.document.positionAt(fullEnd)
            )
        });

        // Inner ID — underlined
        links.push({
            range: new vscode.Range(
                editor.document.positionAt(idStart),
                editor.document.positionAt(idEnd)
            )
        });
    }

    editor.setDecorations(bracketDecoration, brackets);
    editor.setDecorations(linkDecoration, links);
}

module.exports = { registerDecorations };