const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoots } = require('./workspace');
const { extractCanonicalIdFromFrontmatter } = require('./id');
const { loadIgnoreRules, isIgnoredPath } = require('./ignore');

const PREVIEW_THRESHOLD = 5;

let isPropagating = false;
const pendingIdentityMutations = new Map();

function registerRename(context, getIndex, getPathIndex, buildIndex, validateAll, onComplete) {
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            const document = event && event.document;
            if (!document || document.languageId !== 'markdown' || isPropagating) return;

            const filePath = document.uri.fsPath;
            const indexedId = getPathIndex().get(filePath) ?? null;
            const currentId = extractIdFromDocument(document);

            if (indexedId === currentId) {
                pendingIdentityMutations.delete(filePath);
                return;
            }

            if (!indexedId && !currentId) {
                pendingIdentityMutations.delete(filePath);
                return;
            }

            pendingIdentityMutations.set(filePath, {
                oldId: indexedId,
                newId: currentId
            });
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((document) => {
            if (!document) return;
            pendingIdentityMutations.delete(document.uri.fsPath);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (document.languageId !== 'markdown') return;

            if (isPropagating) {
                console.log("Yamlink — Save skipped during propagation");
                return;
            }

            const filePath  = document.uri.fsPath;
            const pathIndex = getPathIndex();
            const pending = pendingIdentityMutations.get(filePath) || null;
            pendingIdentityMutations.delete(filePath);

            const oldId = pending ? pending.oldId : (pathIndex.get(filePath) ?? null);
            const newId = pending ? pending.newId : extractIdFromDocument(document);

            // Fast path: no id change — extension.js handles incremental refresh.
            // Avoids a full buildIndex on every markdown save (common case).
            if (oldId === newId) return;

            buildIndex(vscode.workspace.workspaceFolders);
            validateAll(getIndex);

            if (!oldId && newId) {
                console.log(`Yamlink — New node declared: "${newId}"`);
                return;
            }

            if (oldId && !newId) {
                console.log(`Yamlink — Node identity removed: "${oldId}"`);
                vscode.window.showWarningMessage(
                    `Yamlink: "${oldId}" removed its id field. All references are now broken.`
                );
                return;
            }

            console.log(`Yamlink — Identity mutation: "${oldId}" → "${newId}"`);
            await handleIdentityMutation(oldId, newId, buildIndex, validateAll, getIndex, onComplete);
        })
    );
}

async function handleIdentityMutation(oldId, newId, buildIndex, validateAll, getIndex, onComplete) {
    if (!vscode.workspace.workspaceFolders) return;

    let affected = [];

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Yamlink: Scanning vault for [[${oldId}]]...`,
            cancellable: false
        },
        async () => {
            affected = await findAffectedFilesAsync(vscode.workspace.workspaceFolders, oldId);
        }
    );

    if (affected.length === 0) {
        vscode.window.showInformationMessage(
            `Yamlink: ID renamed to "${newId}". No references found.`
        );
        return;
    }

    const edit = buildWorkspaceEdit(affected, oldId, newId);

    if (affected.length < PREVIEW_THRESHOLD) {
        const choice = await vscode.window.showWarningMessage(
            `Yamlink: "${oldId}" → "${newId}" — ${affected.length} file(s) reference this ID.`,
            { modal: true },
            'Apply',
            'Revert ID'
        );

        if (choice === 'Apply') {
            await applyWithGuard(edit);
            buildIndex(vscode.workspace.workspaceFolders);
            validateAll(getIndex);
            if (typeof onComplete === 'function') onComplete();
            vscode.window.showInformationMessage(
                `Yamlink: Updated ${affected.length} file(s).`
            );
        } else if (choice === 'Revert ID') {
            await revertId(newId, oldId);
            buildIndex(vscode.workspace.workspaceFolders);
            validateAll(getIndex);
            if (typeof onComplete === 'function') onComplete();
        }

    } else {
        const choice = await vscode.window.showWarningMessage(
            `Yamlink: "${oldId}" → "${newId}" — ${affected.length} file(s) affected.`,
            { modal: true },
            'Preview Changes',
            'Apply Directly',
            'Revert ID'
        );

        if (choice === 'Preview Changes') {
            await applyWithGuard(edit, { isRefactoring: true });
            buildIndex(vscode.workspace.workspaceFolders);
            validateAll(getIndex);
            if (typeof onComplete === 'function') onComplete();
        } else if (choice === 'Apply Directly') {
            await applyWithGuard(edit);
            buildIndex(vscode.workspace.workspaceFolders);
            validateAll(getIndex);
            if (typeof onComplete === 'function') onComplete();
            vscode.window.showInformationMessage(
                `Yamlink: Updated ${affected.length} file(s).`
            );
        } else if (choice === 'Revert ID') {
            await revertId(newId, oldId);
            buildIndex(vscode.workspace.workspaceFolders);
            validateAll(getIndex);
            if (typeof onComplete === 'function') onComplete();
        }
    }
}

async function applyWithGuard(edit, options = {}) {
    isPropagating = true;
    try {
        await vscode.workspace.applyEdit(edit, options);
        await vscode.workspace.saveAll(false);
    } finally {
        await new Promise(resolve => setTimeout(resolve, 300));
        isPropagating = false;
    }
}

async function findAffectedFilesAsync(workspaceFolders, oldId) {
    const affected = [];
    const pattern  = buildRenameRegex(oldId);
    for (const dir of getWorkspaceRoots(workspaceFolders)) {
        await scanAsync(dir, dir, loadIgnoreRules(dir), pattern, affected);
    }
    return affected;
}

async function scanAsync(dir, workspaceRoot, ignoreRules, pattern, results) {
    let files;
    try {
        files = await fs.promises.readdir(dir);
    } catch (e) {
        return;
    }

    for (const file of files) {
        if (file.startsWith('.')) continue;

        const fullPath = path.join(dir, file);
        if (isIgnoredPath(fullPath, workspaceRoot, ignoreRules)) continue;
        let stat;
        try { stat = await fs.promises.stat(fullPath); } catch (e) { continue; }

        if (stat.isDirectory()) {
            await scanAsync(fullPath, workspaceRoot, ignoreRules, pattern, results);
        } else if (file.endsWith('.md')) {
            let content;
            try { content = await fs.promises.readFile(fullPath, 'utf8'); } catch (e) { continue; }
            if (pattern.test(content)) {
                results.push({ filePath: fullPath, content });
            }
        }
    }
}

function buildWorkspaceEdit(affected, oldId, newId) {
    const edit          = new vscode.WorkspaceEdit();

    for (const { filePath, content } of affected) {
        const uri   = vscode.Uri.file(filePath);
        const lines = content.split('\n');

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const matches = findRenameMatchesInText(line, oldId);
            if (matches.length === 0) continue;
            for (const match of matches) {
                edit.replace(
                    uri,
                    new vscode.Range(
                        new vscode.Position(lineIndex, match.start),
                        new vscode.Position(lineIndex, match.end)
                    ),
                    newId
                );
            }
        }
    }

    return edit;
}

async function revertId(currentId, targetId) {
    const openDocs = vscode.workspace.textDocuments;

    for (const doc of openDocs) {
        if (doc.languageId !== 'markdown') continue;

        const text        = doc.getText();
        const idLineIndex = text
            .split('\n')
            .findIndex(line => /^id:\s*.+/.test(line));

        if (idLineIndex === -1) continue;

        const currentIdInLine = doc.lineAt(idLineIndex).text
            .replace(/^id:\s*/, '').trim();

        if (currentIdInLine !== currentId) continue;

        const edit = new vscode.WorkspaceEdit();
        const line = doc.lineAt(idLineIndex);

        edit.replace(
            doc.uri,
            new vscode.Range(
                new vscode.Position(idLineIndex, 0),
                new vscode.Position(idLineIndex, line.text.length)
            ),
            `id: ${targetId}`
        );

        isPropagating = true;
        try {
            await vscode.workspace.applyEdit(edit);
            await doc.save();
        } finally {
            await new Promise(resolve => setTimeout(resolve, 300));
            isPropagating = false;
        }

        vscode.window.showInformationMessage(
            `Yamlink: ID reverted to "${targetId}"`
        );
        break;
    }
}

function extractIdFromDocument(document) {
    return extractCanonicalIdFromFrontmatter(document.getText());
}

function buildRenameRegex(oldId) {
    const escaped = escapeRegex(oldId);
    return new RegExp(`!?\\[\\[${escaped}(?=\\||#|\\^|\\]\\])`, 'g');
}

function findRenameMatchesInText(text, oldId) {
    const regex = buildRenameRegex(oldId);
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        const start = match.index + (match[0].startsWith('!') ? 3 : 2);
        matches.push({ start, end: start + oldId.length });
    }
    return matches;
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { registerRename, findRenameMatchesInText, extractIdFromDocument };
