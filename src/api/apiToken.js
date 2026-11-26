'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureContainedDir } = require('../core/pathSafety');

const TOKEN_FILE = 'api-token';

function getTokenPath(vaultPath) {
    return path.join(vaultPath, '.yamlink', TOKEN_FILE);
}

function ensureVaultGitignore(vaultPath) {
    const ignorePath = path.join(vaultPath, '.gitignore');
    let existing = '';
    try {
        if (fs.lstatSync(ignorePath).isSymbolicLink()) throw new Error('Vault .gitignore must not be a symbolic link');
        existing = fs.readFileSync(ignorePath, 'utf8');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    if (/^\s*\.yamlink\/?\s*$/m.test(existing)) return;
    const separator = existing && !/\r?\n$/.test(existing) ? (existing.includes('\r\n') ? '\r\n' : '\n') : '';
    const content = existing + separator + '.yamlink/' + (existing.includes('\r\n') ? '\r\n' : '\n');
    // Real, confirmed vulnerability this closes (external security review,
    // independently reproduced): the symlink check above does not catch a
    // hardlink — a second directory entry sharing the same inode as a real
    // file elsewhere — since lstat reports a hardlinked path as an ordinary
    // regular file. Writing straight to `ignorePath` would open-and-truncate
    // whatever inode is actually there, corrupting that other file. Write to
    // a new, randomly-named temp file and rename it into place instead — the
    // same pattern already used for the token file below — since rename
    // replaces the directory entry atomically, leaving whatever inode was
    // previously at `ignorePath` (and anything else hardlinked to it)
    // completely untouched.
    const temporary = path.join(vaultPath, `.gitignore.${crypto.randomBytes(8).toString('hex')}.tmp`);
    try {
        fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(temporary, ignorePath);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

/**
 * Authentication is opt-in no longer — every `yamlink serve` (standalone or
 * the one `yamlink`/`yamlink conduit` auto-starts for themselves) now
 * requires a token by default, closing a real gap: CORS on this API is
 * intentionally wide open (`Access-Control-Allow-Origin: *`, so browser-based
 * local tools on a different port can reach it), which without a token meant
 * any webpage open in the same browser could read or write the vault for as
 * long as the server ran.
 *
 * `YAMLINK_API_TOKEN`, if already set, always wins unchanged — this is purely
 * about what happens when nobody set one. The generated token is persisted
 * per-vault at `.yamlink/api-token` (with a vault-local ignore rule) so
 * that restarting `yamlink serve` for the same vault keeps issuing the same
 * token, and so a second local process for the *same* vault (Conduit
 * attaching to an already-running server instead of starting its own) can
 * read the identical value back rather than being locked out of its own
 * vault's server. A process that can already read files in the vault
 * directory has no less access than someone running `yamlink serve`
 * themselves — the token's job is to stop a *remote* actor (a webpage, an
 * unrelated program) from reaching the API, not to add a barrier between a
 * user and their own vault.
 * @param {string} vaultPath
 * @returns {string}
 */
function getOrCreateApiToken(vaultPath) {
    if (process.env.YAMLINK_API_TOKEN) return process.env.YAMLINK_API_TOKEN;

    ensureVaultGitignore(vaultPath);

    const tokenPath = getTokenPath(vaultPath);
    try {
        const existing = fs.readFileSync(tokenPath, 'utf8').trim();
        // Defense in depth beyond closing the import carrier (see the
        // importers' .yamlink skip-dir fix): a vault can also be opened
        // directly — downloaded, cloned, copied by hand — without going
        // through Yamlink's own import pipeline at all, so a pre-existing
        // `.yamlink/api-token` isn't guaranteed to be one this codebase
        // actually generated. Trusting its raw content unconditionally would
        // let whoever planted that file choose the vault's own API
        // credential. A token this function generates is always exactly 48
        // lowercase hex characters (crypto.randomBytes(24).toString('hex'));
        // anything else is regenerated instead of trusted.
        if (existing && /^[0-9a-f]{48}$/.test(existing)) return existing;
    } catch (_) { /* no persisted token yet — generate one below */ }

    const token = crypto.randomBytes(24).toString('hex');
    try {
        // Real, confirmed vulnerability this closes (external security
        // review, independently reproduced): a plain `fs.mkdirSync(...,
        // { recursive: true })` is a silent no-op when `.yamlink` already
        // exists — including as a symlink or (Windows) directory junction
        // planted there before the vault was ever opened, redirecting
        // every subsequent write under it outside the vault entirely.
        // ensureContainedDir() creates the directory the same way but then
        // verifies (via realpath) that it actually resolves inside
        // vaultPath, throwing — caught below, so persistence is skipped
        // rather than written to the wrong place — if it doesn't.
        ensureContainedDir(path.dirname(tokenPath), vaultPath);
        // Real, confirmed vulnerability this closes (external security
        // review, reproduced directly): writing straight to `tokenPath` with
        // a plain fs.writeFileSync opens and truncates whatever inode is
        // already there — if that path is a hardlink to some other real
        // file elsewhere on the same volume (a "poisoned vault" planting an
        // empty hardlink at .yamlink/api-token before the victim ever runs
        // a yamlink command), the write silently overwrites that other
        // file's actual content, not just the token. A symlink check (as
        // used elsewhere in this codebase) does not help here — a hardlink
        // has no symlink to detect; lstat reports it as an ordinary regular
        // file. Writing to a new, randomly-named temp file and renaming it
        // into place instead replaces the directory entry at `tokenPath`
        // atomically, leaving whatever inode was previously there (and
        // anything else hardlinked to it) completely untouched.
        const temporary = path.join(path.dirname(tokenPath), `.${TOKEN_FILE}.${crypto.randomBytes(8).toString('hex')}.tmp`);
        try {
            fs.writeFileSync(temporary, token, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            fs.renameSync(temporary, tokenPath);
        } finally {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
    } catch (_) { /* best-effort persistence — the in-memory token below still works for this process */ }
    return token;
}

module.exports = { getOrCreateApiToken, getTokenPath, ensureVaultGitignore };
