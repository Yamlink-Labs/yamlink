'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { canonicalizeId } = require('../core/id');
const { getPathIndex } = require('../core/indexService');
const { getPrimaryWorkspaceRoot, getWorkspaceRootForFile } = require('../core/workspace');

async function handleNewNoteFromSelection(deps) {
    const { selectionRef } = deps;
    // Capture selection before any dialog opens — QuickPick/InputBox steal editor focus.
    const editor = vscode.window.activeTextEditor;
    const liveSel = (editor && !editor.selection.isEmpty) ? editor.selection : null;
    const activeSelection = liveSel
        ? { uri: editor.document.uri, range: liveSel, document: editor.document }
        : (selectionRef.current
            ? { uri: selectionRef.current.document.uri, range: selectionRef.current.selection, document: selectionRef.current.document }
            : null);

    const selectedText = activeSelection
        ? activeSelection.document.getText(activeSelection.range).trim()
        : '';

    const createdId = await vscode.commands.executeCommand('yamlink.newNote', selectedText || undefined);

    // Replace the original selection with [[createdId]] so the thought becomes a linked note.
    if (createdId && activeSelection) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(activeSelection.uri, activeSelection.range, `[[${createdId}]]`);
        await vscode.workspace.applyEdit(edit);
    }
}

async function handleSplitNoteBody(deps) {
    const { selectionRef } = deps;
    try {
        // Capture selection before dialogs steal focus.
        // Falls back to the last known non-empty selection so right-clicking
        // (which may clear the live selection) still works.
        const editor = vscode.window.activeTextEditor;
        const liveSel = (editor && !editor.selection.isEmpty) ? editor.selection : null;
        const activeSelection = liveSel
            ? { uri: editor.document.uri, range: liveSel, document: editor.document }
            : (selectionRef.current
                ? { uri: selectionRef.current.document.uri, range: selectionRef.current.selection, document: selectionRef.current.document }
                : null);

        if (!activeSelection) {
            vscode.window.showInformationMessage('Yamlink: Select some text in the note body first.');
            return;
        }

        const bodyContent = activeSelection.document.getText(activeSelection.range).trim();
        if (!bodyContent) {
            vscode.window.showInformationMessage('Yamlink: Selection is empty — select some body text first.');
            return;
        }

        // Derive title from first heading or first non-blank line
        const headingMatch = bodyContent.match(/^#{1,6}\s+(.+)/m);
        const firstLine = bodyContent.split('\n').find(l => l.trim());
        const derivedTitle = headingMatch
            ? headingMatch[1].trim()
            : (firstLine || '').replace(/^#+\s*/, '').replace(/\*+/g, '').trim().slice(0, 80);

        const title = await vscode.window.showInputBox({
            prompt: 'Title for the extracted note',
            value: derivedTitle,
            placeHolder: 'Note title',
            validateInput: v => (v && v.trim()) ? null : 'Title cannot be empty'
        });
        if (!title) return;

        const cleanId = canonicalizeId(title);
        if (!cleanId) {
            vscode.window.showErrorMessage('Yamlink: Could not generate a valid ID from that title.');
            return;
        }

        const root = getWorkspaceRootForFile(vscode.workspace.workspaceFolders, activeSelection.uri.fsPath)
            || getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
        if (!root) {
            vscode.window.showErrorMessage('Yamlink: No workspace folder found. Make sure a folder is open.');
            return;
        }

        const newFilePath = path.join(root, `${cleanId}.md`);
        if (fs.existsSync(newFilePath)) {
            vscode.window.showErrorMessage(`Yamlink: A note with id "${cleanId}" already exists.`);
            return;
        }

        // Get the source note's ID for the back-link
        const sourceId = getPathIndex().get(activeSelection.uri.fsPath) || null;
        const today = new Date().toISOString().slice(0, 10);

        // Build frontmatter for the new note
        const frontmatterLines = ['---', `id: ${cleanId}`, `created: ${today}`];
        if (sourceId) frontmatterLines.push(`source: [[${sourceId}]]`);
        frontmatterLines.push('---', '');
        const newFileContent = frontmatterLines.join('\n') + bodyContent + '\n';

        // Write the new file
        fs.writeFileSync(newFilePath, newFileContent, 'utf8');

        // Replace the selection in the source note with ![[cleanId]]
        const edit = new vscode.WorkspaceEdit();
        edit.replace(activeSelection.uri, activeSelection.range, `![[${cleanId}]]`);
        const editApplied = await vscode.workspace.applyEdit(edit);
        if (!editApplied) {
            vscode.window.showWarningMessage(`Yamlink: Created "${cleanId}" but could not replace the selection — replace manually with ![[${cleanId}]].`);
        }

        // Open the new note
        const newDoc = await vscode.workspace.openTextDocument(newFilePath);
        await vscode.window.showTextDocument(newDoc, { viewColumn: vscode.ViewColumn.One, preview: false });

        vscode.window.showInformationMessage(`Yamlink: Created "${cleanId}" from selection`);
    } catch (err) {
        vscode.window.showErrorMessage(`Yamlink: Extract selection failed — ${err && err.message ? err.message : String(err)}`);
    }
}

module.exports = {
    handleNewNoteFromSelection,
    handleSplitNoteBody
};
