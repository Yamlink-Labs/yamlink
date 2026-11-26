'use strict';
// Shared filesystem-containment check, used anywhere a path derived from
// vault content (a frontmatter value, an `![[embed]]` target, a relative
// image reference) is about to be read or embedded, and must not be allowed
// to resolve outside a known boundary (the vault root, an export staging
// directory). Extracted here — rather than left as a private helper inside
// src/export/pdf.js, where it was first built — so every consumer shares one
// implementation instead of each re-deriving the same containment logic.

const fs = require('fs');
const path = require('path');

/**
 * True when `candidatePath` resolves (following symlinks, via realpath —
 * not a purely lexical check, which a symlink could defeat) to somewhere
 * inside `root`. A purely lexical check (`path.resolve`/`path.join` plus a
 * string-prefix comparison) only normalizes `.`/`..` segments in the
 * string — it never follows a symlink, so a symlink sitting inside the
 * allowed directory but physically pointing elsewhere on disk would pass a
 * string-prefix check while still escaping containment for real.
 * `realpathSync` resolves to the actual physical location, which is what a
 * containment check must compare.
 * @param {string} candidatePath
 * @param {string} root
 * @returns {boolean}
 */
function isWithinRoot(candidatePath, root) {
    let resolvedRoot;
    try { resolvedRoot = fs.realpathSync(root); } catch (_) { return false; }
    let resolvedCandidate;
    try { resolvedCandidate = fs.realpathSync(candidatePath); } catch (_) { return false; }
    return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep);
}

/**
 * Ensures `dirPath` exists and physically resolves inside `root`, then
 * returns its real path. Real, confirmed gap this closes (external security
 * review, independently reproduced): code that does `fs.mkdirSync(dirPath,
 * { recursive: true })` and then writes into it assumes that directory is
 * really where it looks — but `mkdirSync` is a silent no-op when the
 * directory already exists, including when it already exists as a symlink
 * or (on Windows) a directory junction planted there before the vault was
 * ever opened. A poisoned `.yamlink` junction pointing outside the vault
 * would make every subsequent write under it (the API token, the mutation
 * log, webhooks.json) land in the attacker-chosen location instead, with no
 * error at all. Checking containment via `isWithinRoot` (realpath-based, so
 * the junction/symlink is actually followed and compared) after creating the
 * directory catches this — `mkdirSync` itself has no way to refuse "a
 * directory already exists here, just not really here."
 * @param {string} dirPath
 * @param {string} root
 * @returns {string} the real, resolved path of dirPath
 */
function ensureContainedDir(dirPath, root) {
    fs.mkdirSync(dirPath, { recursive: true });
    if (!isWithinRoot(dirPath, root)) {
        throw new Error(`Refusing to use '${dirPath}' — it resolves outside '${root}' (a symlink or directory junction may be redirecting it)`);
    }
    return fs.realpathSync(dirPath);
}

module.exports = { isWithinRoot, ensureContainedDir };
