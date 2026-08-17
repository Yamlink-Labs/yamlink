'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { validateAll } = require('../diagnostics/diagnostics');
const { updateSingleFile } = require('../core/index');
const { getFieldsCache } = require('../core/indexService');
const { getPrimaryWorkspaceRoot } = require('../core/workspace');
const { writeFieldValue } = require('../core/writeField');
const { loadTemplates } = require('../core/templateRegistry');
const { syncIndexAfterWrite } = require('./nodeCreationHelpers');

async function handleAddFrontmatter(deps, document, suggestedId) {
    const { getIndex } = deps;
    const today = new Date().toISOString().split('T')[0];
    const text = document.getText();
    const hasFrontmatter = /^\s*---/.test(text);
    const edit = new vscode.WorkspaceEdit();

    if (hasFrontmatter) {
        edit.insert(document.uri, new vscode.Position(1, 0), `id: ${suggestedId}\n`);
    } else {
        edit.insert(
            document.uri,
            new vscode.Position(0, 0),
            `---\nid: ${suggestedId}\ncreated: ${today}\n---\n\n`
        );
    }

    await vscode.workspace.applyEdit(edit);
    await document.save();
    syncIndexAfterWrite(document.uri.fsPath);
    validateAll(getIndex);

    vscode.window.showInformationMessage(`Yamlink: "${suggestedId}" is now a Yamlink node`);
}

async function handleBackfillCreatedDates(deps) {
    const { getIndex } = deps;
    const fieldCache = getFieldsCache();
    const idIndex = getIndex();
    const missing = [];
    for (const [id, filePath] of idIndex.entries()) {
        const fields = fieldCache.get(id);
        if (!fields || fields.created) continue;
        missing.push({ id, filePath });
    }
    if (missing.length === 0) {
        vscode.window.showInformationMessage('Yamlink: All notes already have a created: date.');
        return;
    }
    const action = await vscode.window.showWarningMessage(
        `Yamlink: ${missing.length} note(s) have no created: date. Backfill from file system birthtime?`,
        {
            modal: true,
            detail: 'File system birthtime may not be reliable across git clones, syncs, or drive migrations. Use as a best-effort approximation only.'
        },
        'Backfill',
        'Cancel'
    );
    if (action !== 'Backfill') return;
    let written = 0;
    for (const { filePath } of missing) {
        try {
            const stat = fs.statSync(filePath);
            const dateMs = stat.birthtimeMs || stat.mtimeMs;
            const dateIso = new Date(dateMs).toISOString().split('T')[0];
            await writeFieldValue(filePath, 'created', dateIso);
            syncIndexAfterWrite(filePath);
            written++;
        } catch (e) { /* skip */ }
    }
    vscode.window.showInformationMessage(`Yamlink: Backfilled created: date on ${written} note(s).`);
    validateAll(getIndex);
}

async function handleOpenDailyNote() {
    const workspaceRoot = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
    if (!workspaceRoot) {
        vscode.window.showWarningMessage('Yamlink: No workspace open.');
        return;
    }

    const today = new Date();
    const dateIso = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const noteId = `journal-${dateIso}`;
    const notePath = path.join(workspaceRoot, `${noteId}.md`);

    // If note already exists, just open it
    if (fs.existsSync(notePath)) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(notePath));
        await vscode.window.showTextDocument(doc);
        return;
    }

    // Try journal template first
    const templates = loadTemplates(workspaceRoot);
    const template = templates.find(t => t.type === 'journal' || t.name === 'journal');
    let content;
    if (template) {
        const templateBody = template.content.replace(/^---[\s\S]*?---\s*/m, '');
        content = `---\nid: ${noteId}\ntype: journal\ndate: ${dateIso}\n---\n\n${templateBody}`;
    } else {
        content = `---\nid: ${noteId}\ntype: journal\ndate: ${dateIso}\n---\n\n`;
    }

    fs.writeFileSync(notePath, content, 'utf8');
    await updateSingleFile(notePath, { workspaceFolders: vscode.workspace.workspaceFolders });

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(notePath));
    await vscode.window.showTextDocument(doc);
    // Move cursor to end of frontmatter so the user can start writing
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const lines = content.split('\n');
        const closingLine = lines.findIndex((line, i) => i > 0 && /^---/.test(line));
        if (closingLine >= 0) {
            const pos = new vscode.Position(closingLine + 2, 0);
            editor.selection = new vscode.Selection(pos, pos);
        }
    }
}

module.exports = {
    handleAddFrontmatter,
    handleBackfillCreatedDates,
    handleOpenDailyNote
};
