'use strict';

const fs = require('fs');
const path = require('path');
const { isSymlinkEntry, isHardlinkEntry } = require('./fsSafety');

const KNOWN_OBSIDIAN_CONFIG_FILES = new Set(['app.json', 'appearance.json', 'core-plugins.json', 'community-plugins.json', 'hotkeys.json', 'workspace.json']);
// Real, confirmed gap this closes (external security review, independently
// reproduced): `.yamlink` was not in this list, so an Obsidian export that
// already contained a `.yamlink/` folder (e.g. exported from an existing
// Yamlink vault, or planted there deliberately) would have its control files
// — notably `api-token` and `webhooks.json` — copied wholesale into the
// freshly imported vault. A pre-seeded api-token lets whoever chose that
// value authenticate to the imported vault's own local API later; a
// pre-seeded webhooks.json entry silently starts forwarding future mutation
// events (including real field values) to whatever URL it names, the moment
// the imported vault is later used with `yamlink serve`. Neither of these is
// the user's own choice — they never ran `yamlink hooks add` or generated a
// token themselves — so `.yamlink` belongs in the same never-import category
// as `.git`/`.obsidian`/editor-config directories, not vault content.
const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', '.vscode', '.cursor', '.zed', '.yamlink', 'node_modules']);
const SKIP_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

function detectObsidianVault(rootPath) {
    if (!rootPath) return false;
    return fs.existsSync(path.join(rootPath, '.obsidian'));
}

function looksLikeObsidianConfigDir(fullPath) {
    if (!fullPath || !fs.existsSync(fullPath)) return false;
    let entries;
    try {
        entries = fs.readdirSync(fullPath, { withFileTypes: true });
    } catch (_) {
        return false;
    }
    return entries.some(entry => entry.isFile() && KNOWN_OBSIDIAN_CONFIG_FILES.has(entry.name.toLowerCase()));
}

function shouldSkipImportEntry(entryName, isDirectory, fullPath = '') {
    const normalized = String(entryName || '').trim().toLowerCase();
    if (!normalized) return true;
    if (isDirectory) return SKIP_DIRS.has(normalized) || looksLikeObsidianConfigDir(fullPath);
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
        const sourcePath = path.join(sourceRoot, entry.name);
        if (shouldSkipImportEntry(entry.name, entry.isDirectory(), sourcePath)) {
            stats.skipped.push(entry.name);
            continue;
        }
        if (isSymlinkEntry(sourcePath)) {
            stats.skipped.push(entry.name);
            continue;
        }

        const destinationPath = path.join(destinationRoot, entry.name);

        if (entry.isDirectory()) {
            copyVaultContents(sourcePath, destinationPath, stats);
            continue;
        }

        // Hardlink check only applies to files: a directory cannot be
        // hardlinked on any mainstream filesystem (disallowed by the OS to
        // avoid filesystem-tree cycles), but directory nlink counts
        // themselves vary by platform (e.g. Linux ext4 directories commonly
        // report nlink >= 2 once they contain subdirectories) — checking it
        // on a directory entry would misfire as a false-positive skip on
        // those filesystems.
        if (isHardlinkEntry(sourcePath)) {
            stats.skipped.push(entry.name);
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
        const fullPath = path.join(rootPath, entry.name);
        if (shouldSkipImportEntry(entry.name, entry.isDirectory(), fullPath)) continue;
        if (isSymlinkEntry(fullPath)) continue;
        const relativePath = relativeBase ? path.join(relativeBase, entry.name) : entry.name;

        if (entry.isDirectory()) {
            walkVaultFiles(fullPath, onFile, relativePath);
            continue;
        }

        // See copyVaultContents' comment above: hardlink check only applies
        // to files, never directories (nlink semantics for directories vary
        // by platform and would false-positive on some).
        if (isHardlinkEntry(fullPath)) continue;

        onFile(fullPath, relativePath);
    }
}

module.exports = {
    detectObsidianVault,
    looksLikeObsidianConfigDir,
    shouldSkipImportEntry,
    chooseImportDestination,
    copyVaultContents,
    createImportStats,
    walkVaultFiles
};
