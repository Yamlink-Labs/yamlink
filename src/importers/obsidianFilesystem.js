'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', '.vscode', '.cursor', '.zed', 'node_modules']);
const SKIP_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

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

function walkVaultFiles(rootPath, onFile, relativeBase = '') {
    for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
        if (shouldSkipImportEntry(entry.name, entry.isDirectory())) continue;
        const fullPath = path.join(rootPath, entry.name);
        const relativePath = relativeBase ? path.join(relativeBase, entry.name) : entry.name;

        if (entry.isDirectory()) {
            walkVaultFiles(fullPath, onFile, relativePath);
            continue;
        }

        onFile(fullPath, relativePath);
    }
}

module.exports = {
    detectObsidianVault,
    shouldSkipImportEntry,
    chooseImportDestination,
    copyVaultContents,
    createImportStats,
    walkVaultFiles
};
