'use strict';
// Deliberately a standalone, dependency-free leaf module — not folded into
// shared.js. shared.js already requires obsidian.js (for
// buildImportReportMarkdown), and obsidian.js requires obsidianFilesystem.js;
// obsidianFilesystem.js needing this same symlink check would have closed a
// real circular require (shared.js -> obsidian.js -> obsidianFilesystem.js
// -> shared.js), confirmed to silently break buildImportReportMarkdown via
// Node's circular-require partial-exports behavior. This module is a leaf
// specifically so every importer file can depend on it with no cycle risk.

const fs = require('fs');

/**
 * True when `fullPath` is itself a symbolic link (or junction, on Windows) —
 * checked with `lstatSync`, which never follows the link, unlike
 * `fs.Dirent#isDirectory()`/`#isFile()` from `readdirSync(..., { withFileTypes: true })`,
 * both of which report `false` for a symlink entry regardless of what it
 * points at. Real, confirmed vulnerability this guards against (external
 * security review, independently reproduced): an export/vault directory
 * being imported can contain a symlink pointing to an arbitrary file
 * elsewhere on disk (outside the export entirely) — reading or copying
 * through it (`fs.readFileSync`/`fs.copyFileSync` both follow symlinks by
 * default) silently pulls that external file's content into the vault as
 * if it were legitimate imported content. Every recursive walk over
 * untrusted import/export content must check this per entry and skip
 * rather than read/copy through it.
 * @param {string} fullPath
 * @returns {boolean}
 */
function isSymlinkEntry(fullPath) {
    try {
        return fs.lstatSync(fullPath).isSymbolicLink();
    } catch (_) {
        return false;
    }
}

/**
 * True when `fullPath` is a hardlink — a second directory entry sharing the
 * same inode as another file elsewhere on disk. Distinct from a symlink and
 * invisible to `isSymlinkEntry`: `lstatSync` reports a hardlinked path as an
 * ordinary regular file, since there is no link to detect, just two names for
 * one inode. Real, confirmed gap this guards against (external security
 * review, independently reproduced): an untrusted export/vault directory can
 * plant a hardlink to an arbitrary file elsewhere on the same volume (a
 * credential, a config file outside the export) — copying it as if it were
 * ordinary export content silently pulls that file's real data into the
 * vault. An ordinary file this process itself created has `nlink === 1`; a
 * hardlinked one has `nlink > 1`, so checking `nlink` is a reliable,
 * platform-general signal (not Windows-only, unlike the junction-vs-symlink
 * distinction elsewhere in this codebase).
 * @param {string} fullPath
 * @returns {boolean}
 */
function isHardlinkEntry(fullPath) {
    try {
        return fs.lstatSync(fullPath).nlink > 1;
    } catch (_) {
        return false;
    }
}

module.exports = { isSymlinkEntry, isHardlinkEntry };
