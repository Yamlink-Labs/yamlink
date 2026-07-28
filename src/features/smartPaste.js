'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { getWorkspaceRootForFile } = require('../core/workspace');
const {
    detectSmartPaste,
    buildViewBlock,
    buildFrontmatterFromJson,
    buildTaskList,
    buildNotesFromTable,
    buildNotesPreview
} = require('./smartPasteCore');

const PASTE_MIME_TYPES = ['text/plain'];

/** @param {vscode.ExtensionContext} context */
function registerSmartPaste(context) {
    if (!vscode.languages.registerDocumentPasteEditProvider || !vscode.DocumentDropOrPasteEditKind) {
        return;
    }

    const kind = vscode.DocumentDropOrPasteEditKind.Text.append('yamlink', 'smartPaste');
    const provider = {
        /**
         * @param {vscode.TextDocument} document
         * @param {readonly vscode.Range[]} _ranges
         * @param {vscode.DataTransfer} dataTransfer
         * @returns {Promise<vscode.DocumentPasteEdit[]|undefined>}
         */
        async provideDocumentPasteEdits(document, _ranges, dataTransfer) {
            const item = dataTransfer.get('text/plain');
            if (!item) return undefined;

            const text = await item.asString();
            const detection = detectSmartPaste(text);
            if (!detection) return undefined;

            const choice = await pickSmartPasteOption(detection);
            if (!choice || choice.action === 'plain') {
                return [new vscode.DocumentPasteEdit(text, 'Paste as plain text', kind)];
            }

            // Casts below are safe: the `detection.kind === '...'` guard on each
            // line already proves the narrower shape at runtime. TS isn't
            // tracking the discriminant here (same class of gap already fixed
            // elsewhere this session in vaultTrends.js) — likely the intervening
            // `await pickSmartPasteOption(detection)` above resetting narrowing.
            if (choice.action === 'view' && detection.kind === 'table') {
                return [new vscode.DocumentPasteEdit(buildViewBlock(/** @type {import('./smartPasteCore').SmartPasteTable} */ (detection)), 'Convert table to !view block', kind)];
            }

            if (choice.action === 'frontmatter' && detection.kind === 'json') {
                return [new vscode.DocumentPasteEdit(buildFrontmatterFromJson(/** @type {import('./smartPasteCore').SmartPasteJson} */ (detection)), 'Convert JSON to frontmatter', kind)];
            }

            if (choice.action === 'tasks' && detection.kind === 'list') {
                return [new vscode.DocumentPasteEdit(buildTaskList(/** @type {import('./smartPasteCore').SmartPasteList} */ (detection)), 'Convert list to task list', kind)];
            }

            if (choice.action === 'notes' && detection.kind === 'table') {
                return createNotesPasteEdit(document, /** @type {import('./smartPasteCore').SmartPasteTable} */ (detection), kind);
            }

            return undefined;
        }
    };

    context.subscriptions.push(vscode.languages.registerDocumentPasteEditProvider(
        { language: 'markdown' },
        provider,
        { providedPasteEditKinds: [kind], pasteMimeTypes: PASTE_MIME_TYPES }
    ));
}

/**
 * @param {ReturnType<typeof detectSmartPaste>} detection
 * @returns {Promise<{ label: string, action: string }|undefined>}
 */
async function pickSmartPasteOption(detection) {
    if (!detection) return undefined;
    const items = [{ label: 'Paste as plain text', action: 'plain' }];

    if (detection.kind === 'table') {
        items.push(
            { label: 'Convert to !view block', action: 'view' },
            { label: `Convert to ${detection.rows.length} new notes`, action: 'notes' }
        );
    } else if (detection.kind === 'json') {
        items.push({ label: 'Convert to frontmatter', action: 'frontmatter' });
    } else if (detection.kind === 'list') {
        items.push({ label: 'Convert to task list', action: 'tasks' });
    }

    return vscode.window.showQuickPick(items, {
        placeHolder: 'Yamlink Smart Paste',
        title: 'Yamlink Smart Paste'
    });
}

/**
 * @param {vscode.TextDocument} document
 * @param {Extract<ReturnType<typeof detectSmartPaste>, { kind: 'table' }>} table
 * @param {vscode.DocumentDropOrPasteEditKind} kind
 * @returns {Promise<vscode.DocumentPasteEdit[]|undefined>}
 */
async function createNotesPasteEdit(document, table, kind) {
    const root = getWorkspaceRootForFile(vscode.workspace.workspaceFolders, document.uri.fsPath);
    if (!root) {
        vscode.window.showErrorMessage('Yamlink Smart Paste needs an open workspace before it can create notes.');
        return undefined;
    }

    const notes = buildNotesFromTable(table);
    const preview = buildNotesPreview(notes);
    const confirm = await vscode.window.showInformationMessage(
        `Create ${notes.length} notes from pasted table?`,
        { modal: true, detail: preview || 'No notes would be created.' },
        'Create notes',
        'Cancel'
    );
    if (confirm !== 'Create notes') return undefined;

    const edit = new vscode.WorkspaceEdit();
    for (const note of notes) {
        const filePath = path.join(root, note.fileName);
        if (fs.existsSync(filePath)) {
            vscode.window.showErrorMessage(`Yamlink Smart Paste stopped because ${note.fileName} already exists.`);
            return undefined;
        }
        const uri = vscode.Uri.file(filePath);
        edit.createFile(uri, { ignoreIfExists: false });
        edit.insert(uri, new vscode.Position(0, 0), note.content);
    }

    const insertText = `${notes.map(note => `[[${note.id}]]`).join('\n')}\n`;
    const pasteEdit = new vscode.DocumentPasteEdit(insertText, `Create ${notes.length} notes from table`, kind);
    pasteEdit.additionalEdit = edit;
    return [pasteEdit];
}

module.exports = { registerSmartPaste };
