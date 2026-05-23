'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash']);
const SKIP_FILES = new Set(['.ds_store', 'thumbs.db']);

function detectObsidianVault(rootPath) {
    if (!rootPath) return false;
    return fs.existsSync(path.join(rootPath, '.obsidian'));
}

function shouldSkipImportEntry(entryName, isDirectory) {
    const normalized = String(entryName || '').trim().toLowerCase();
    if (!normalized) return true;
    if (isDirectory) return SKIP_DIRS.has(normalized);
    return SKIP_FILES.has(normalized);
}

function chooseImportDestination(workspaceRoot, sourceRoot) {
    const baseName = path.basename(sourceRoot);
    let candidate = path.join(workspaceRoot, baseName);
    if (!fs.existsSync(candidate)) return candidate;

    let suffix = 2;
    while (fs.existsSync(candidate)) {
        candidate = path.join(workspaceRoot, `${baseName}-${suffix}`);
        suffix++;
    }
    return candidate;
}

function copyVaultContents(sourceRoot, destinationRoot, stats = createImportStats()) {
    if (!fs.existsSync(destinationRoot)) {
        fs.mkdirSync(destinationRoot, { recursive: true });
    }

    for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
        if (shouldSkipImportEntry(entry.name, entry.isDirectory())) {
            stats.skipped.push(entry.name);
            continue;
        }

        const sourcePath = path.join(sourceRoot, entry.name);
        const destinationPath = path.join(destinationRoot, entry.name);

        if (entry.isDirectory()) {
            copyVaultContents(sourcePath, destinationPath, stats);
            continue;
        }

        if (fs.existsSync(destinationPath)) {
            stats.conflicts.push(destinationPath);
            continue;
        }

        fs.copyFileSync(sourcePath, destinationPath);
        stats.copied++;

        if (destinationPath.toLowerCase().endsWith('.md')) {
            stats.markdownCopied++;
        }
    }

    return stats;
}

function createImportStats() {
    return {
        copied: 0,
        markdownCopied: 0,
        skipped: [],
        conflicts: []
    };
}

async function promptImportMode(hasWorkspace) {
    const picks = hasWorkspace
        ? [
            {
                label: 'Copy into current workspace',
                description: 'Copies the vault into a new folder under the current workspace root.',
                mode: 'copy'
            },
            {
                label: 'Add as workspace folder',
                description: 'Adds the vault directly to the current multi-root workspace.',
                mode: 'add'
            }
        ]
        : [
            {
                label: 'Add as workspace folder',
                description: 'Open the selected vault as a workspace folder for Yamlink to index.',
                mode: 'add'
            }
        ];

    const picked = await vscode.window.showQuickPick(picks, {
        title: 'Import Obsidian Vault',
        placeHolder: hasWorkspace
            ? 'Choose how to bring this vault into Yamlink'
            : 'No workspace folder is open — add the vault as a workspace folder',
        matchOnDescription: true
    });

    return picked ? picked.mode : '';
}

async function promptPostImportAction() {
    const picked = await vscode.window.showQuickPick([
        { label: 'Open Vault Health', action: 'health', description: 'Inspect the imported vault structure, lifecycle, and drift.' },
        { label: 'Do nothing', action: 'none', description: 'Leave the vault imported and continue working.' }
    ], {
        title: 'Obsidian vault imported',
        placeHolder: 'Choose a follow-up action'
    });

    return picked ? picked.action : 'none';
}

async function importObsidianVault(context, options = {}) {
    const buildIndex = options.buildIndex;
    const getWorkspaceRoot = options.getWorkspaceRoot;

    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: false,
        canSelectFolders: true,
        openLabel: 'Import Vault',
        title: 'Select an Obsidian vault folder'
    });

    if (!picked || picked.length === 0) return;

    const sourceUri = picked[0];
    const sourceRoot = sourceUri.fsPath;
    const hasWorkspace = Array.isArray(vscode.workspace.workspaceFolders) && vscode.workspace.workspaceFolders.length > 0;
    const mode = await promptImportMode(hasWorkspace);
    if (!mode) return;

    const isObsidian = detectObsidianVault(sourceRoot);

    if (mode === 'copy') {
        const workspaceRoot = getWorkspaceRoot ? getWorkspaceRoot(vscode.workspace.workspaceFolders) : null;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('Yamlink: Open a workspace folder first, or use "Add as workspace folder" instead.');
            return;
        }

        const destinationRoot = chooseImportDestination(workspaceRoot, sourceRoot);
        const stats = copyVaultContents(sourceRoot, destinationRoot);
        if (typeof buildIndex === 'function') buildIndex(vscode.workspace.workspaceFolders);

        const suffix = isObsidian ? ' (.obsidian ignored)' : '';
        vscode.window.showInformationMessage(
            `Yamlink: Imported ${stats.markdownCopied} Markdown files into "${path.basename(destinationRoot)}"${suffix}.`
        );
    } else if (mode === 'add') {
        const existing = vscode.workspace.workspaceFolders || [];
        const alreadyOpen = existing.some(folder => path.resolve(folder.uri.fsPath) === path.resolve(sourceRoot));
        if (!alreadyOpen) {
            vscode.workspace.updateWorkspaceFolders(existing.length, 0, {
                uri: sourceUri,
                name: path.basename(sourceRoot)
            });
        }

        if (typeof buildIndex === 'function') {
            await new Promise(resolve => setTimeout(resolve, 150));
            buildIndex(vscode.workspace.workspaceFolders);
        }

        const suffix = isObsidian ? ' (.obsidian stays local and is not indexed)' : '';
        vscode.window.showInformationMessage(
            `Yamlink: Added "${path.basename(sourceRoot)}" as a workspace folder${suffix}.`
        );
    }

    const followUp = await promptPostImportAction();
    if (followUp === 'health') {
        await vscode.commands.executeCommand('yamlink.openHealthPanel');
    }
}

module.exports = {
    detectObsidianVault,
    shouldSkipImportEntry,
    chooseImportDestination,
    createImportStats,
    copyVaultContents,
    importObsidianVault
};
