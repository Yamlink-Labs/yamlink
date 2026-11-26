'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { getOrCreateApiToken, getTokenPath, ensureVaultGitignore } = require('../src/api/apiToken');

describe('getOrCreateApiToken', () => {
    let originalEnvToken;
    let dir;

    function setup() {
        originalEnvToken = process.env.YAMLINK_API_TOKEN;
        delete process.env.YAMLINK_API_TOKEN;
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-api-token-'));
    }
    function teardown() {
        if (originalEnvToken === undefined) delete process.env.YAMLINK_API_TOKEN;
        else process.env.YAMLINK_API_TOKEN = originalEnvToken;
        fs.rmSync(dir, { recursive: true, force: true });
    }

    test('generates a real random token and persists it to .yamlink/api-token', () => {
        setup();
        try {
            const token = getOrCreateApiToken(dir);
            assert.match(token, /^[0-9a-f]{48}$/, 'should be a real random hex token, not a placeholder');
            const persisted = fs.readFileSync(getTokenPath(dir), 'utf8').trim();
            assert.equal(persisted, token);
        } finally {
            teardown();
        }
    });

    test('a second call for the same vault returns the identical persisted token, not a new one', () => {
        setup();
        try {
            const first = getOrCreateApiToken(dir);
            const second = getOrCreateApiToken(dir);
            assert.equal(first, second);
        } finally {
            teardown();
        }
    });

    test('two different vaults get two different tokens', () => {
        setup();
        const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-api-token-2-'));
        try {
            const tokenA = getOrCreateApiToken(dir);
            const tokenB = getOrCreateApiToken(dir2);
            assert.notEqual(tokenA, tokenB);
        } finally {
            teardown();
            fs.rmSync(dir2, { recursive: true, force: true });
        }
    });

    test('YAMLINK_API_TOKEN, when already set, always wins and nothing is written to disk', () => {
        setup();
        try {
            process.env.YAMLINK_API_TOKEN = 'explicit-operator-chosen-token';
            const token = getOrCreateApiToken(dir);
            assert.equal(token, 'explicit-operator-chosen-token');
            assert.equal(fs.existsSync(getTokenPath(dir)), false);
        } finally {
            teardown();
        }
    });

    test('a vault without init gains an ignore rule before its API token is written', () => {
        setup();
        try {
            getOrCreateApiToken(dir);
            assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^\.yamlink\/$/m);
            assert.equal(fs.existsSync(getTokenPath(dir)), true);
        } finally {
            teardown();
        }
    });

    test('an existing ignore file is preserved and the rule is not duplicated', () => {
        setup();
        try {
            const ignorePath = path.join(dir, '.gitignore');
            fs.writeFileSync(ignorePath, 'drafts/\n');
            getOrCreateApiToken(dir);
            getOrCreateApiToken(dir);
            assert.equal(fs.readFileSync(ignorePath, 'utf8'), 'drafts/\n.yamlink/\n');
        } finally {
            teardown();
        }
    });

    test('an existing .yamlink entry is accepted without appending another', () => {
        setup();
        try {
            const ignorePath = path.join(dir, '.gitignore');
            fs.writeFileSync(ignorePath, 'drafts/\n.yamlink\n');
            getOrCreateApiToken(dir);
            assert.equal(fs.readFileSync(ignorePath, 'utf8'), 'drafts/\n.yamlink\n');
        } finally {
            teardown();
        }
    });

    test('real exploit reproduction: a hardlinked .yamlink/api-token no longer corrupts the file it shares an inode with', (t) => {
        // Real, confirmed vulnerability (external security review,
        // reproduced directly before this fix, not theoretical): the old
        // implementation wrote straight to the token path with a plain
        // fs.writeFileSync, which opens and truncates whatever inode is
        // already there. A hardlink has no symlink for lstat to detect —
        // it looks like an ordinary regular file — so a "poisoned vault"
        // shipped with .yamlink/api-token already hardlinked to some other
        // real file elsewhere on the same volume (empty, so the existing-
        // token read-back sees nothing and falls through to generate+write)
        // would have that other file's content silently overwritten with a
        // random token the moment any yamlink command ran.
        setup();
        const victimPath = path.join(os.tmpdir(), `yamlink-hardlink-victim-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
        fs.writeFileSync(victimPath, ''); // empty, so the read-existing-token check falls through to the write path
        try {
            fs.mkdirSync(path.dirname(getTokenPath(dir)), { recursive: true });
            try {
                fs.linkSync(victimPath, getTokenPath(dir));
            } catch (error) {
                if (error && (error.code === 'EPERM' || error.code === 'EXDEV')) {
                    t.skip('hardlink creation not permitted/possible in this environment');
                    return;
                }
                throw error;
            }
            const victimInodeBefore = fs.statSync(victimPath).ino;

            const token = getOrCreateApiToken(dir);

            assert.equal(fs.readFileSync(victimPath, 'utf8'), '', 'the hardlinked victim file must remain untouched');
            assert.equal(fs.readFileSync(getTokenPath(dir), 'utf8'), token);
            assert.equal(fs.statSync(victimPath).ino, victimInodeBefore, 'the victim file\'s own inode must be unchanged');
            assert.notEqual(fs.statSync(getTokenPath(dir)).ino, victimInodeBefore, 'the token path must now be a fresh, independent file, not still sharing the victim\'s inode');
        } finally {
            teardown();
            fs.rmSync(victimPath, { force: true });
        }
    });

    test('refuses to write through a symlinked .gitignore — real exploit reproduction, not just a code-review assumption', (t) => {
        // Real, confirmed gap this closes (found during independent
        // re-verification of a Codex delivery, not covered by Codex's own
        // tests): ensureVaultGitignore's lstatSync-based symlink check was
        // read and judged correct, but had no test proving it. A `.gitignore`
        // that's actually a symlink pointing elsewhere (e.g. a shared/synced
        // vault where something outside Yamlink's control planted one) must
        // never be silently written through — that would both corrupt
        // whatever the symlink actually points at and fail to protect the
        // vault's own real .yamlink/ directory.
        setup();
        const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-api-token-outside-'));
        const outsideTarget = path.join(outsideDir, 'real-file.txt');
        fs.writeFileSync(outsideTarget, 'unrelated content\n');
        try {
            try {
                fs.symlinkSync(outsideTarget, path.join(dir, '.gitignore'), 'file');
            } catch (error) {
                if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
                    t.skip('symlink creation not permitted in this environment');
                    return;
                }
                throw error;
            }
            assert.throws(() => ensureVaultGitignore(dir), /symbolic link/i);
            // The symlink's real target must be completely untouched.
            assert.equal(fs.readFileSync(outsideTarget, 'utf8'), 'unrelated content\n');
        } finally {
            teardown();
            fs.rmSync(outsideDir, { recursive: true, force: true });
        }
    });

    test('refuses to write the token through a .yamlink directory junction redirecting outside the vault — real exploit reproduction (third-round Codex finding)', (t) => {
        // Real, confirmed gap (external security review, independently
        // reproduced): a plain fs.mkdirSync(..., { recursive: true }) is a
        // silent no-op if `.yamlink` already exists — including as a
        // directory junction planted there before the vault was ever
        // opened. Before this fix, the token would be written straight
        // through the junction into the attacker-controlled directory.
        setup();
        const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-api-token-junction-outside-'));
        try {
            try {
                fs.symlinkSync(outsideDir, path.join(dir, '.yamlink'), 'junction');
            } catch (error) {
                if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
                    t.skip('junction creation not permitted in this environment');
                    return;
                }
                throw error;
            }
            // The in-memory token must still be returned (this process can
            // still talk to its own API), but persistence must be refused.
            const token = getOrCreateApiToken(dir);
            assert.match(token, /^[0-9a-f]{48}$/);
            assert.equal(fs.existsSync(path.join(outsideDir, 'api-token')), false, 'the token must never be written into the attacker-controlled directory the junction points at');
        } finally {
            teardown();
            fs.rmSync(outsideDir, { recursive: true, force: true });
        }
    });

    test('refuses to write .gitignore through a hardlink — real exploit reproduction (third-round Codex finding)', (t) => {
        // Real, confirmed gap: ensureVaultGitignore's lstatSync symlink check
        // does not catch a hardlink (a second directory entry sharing the
        // same inode as a real file elsewhere) — lstat reports it as an
        // ordinary regular file. Before this fix, writing the vault's
        // .gitignore would open-and-truncate whatever inode was actually
        // there, corrupting the hardlinked victim file.
        setup();
        const victimPath = path.join(os.tmpdir(), `yamlink-gitignore-victim-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
        fs.writeFileSync(victimPath, 'important unrelated content');
        try {
            try {
                fs.linkSync(victimPath, path.join(dir, '.gitignore'));
            } catch (error) {
                if (error && (error.code === 'EPERM' || error.code === 'EXDEV')) {
                    t.skip('hardlink creation not permitted/possible in this environment');
                    return;
                }
                throw error;
            }
            const victimInodeBefore = fs.statSync(victimPath).ino;

            ensureVaultGitignore(dir);

            assert.equal(fs.readFileSync(victimPath, 'utf8'), 'important unrelated content', 'the hardlinked victim file must remain untouched');
            assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /\.yamlink\//, 'the vault\'s own .gitignore must still get its real content');
            assert.equal(fs.statSync(victimPath).ino, victimInodeBefore, 'the victim file\'s own inode must be unchanged');
            assert.notEqual(fs.statSync(path.join(dir, '.gitignore')).ino, victimInodeBefore, 'the .gitignore path must now be a fresh, independent file, not still sharing the victim\'s inode');
        } finally {
            teardown();
            fs.rmSync(victimPath, { force: true });
        }
    });

    test('rejects a pre-existing api-token file that does not look like one this codebase generated — real exploit reproduction (Codex re-audit finding)', () => {
        // Real, confirmed gap (external security review, independently
        // reproduced): a vault can be opened directly — downloaded, cloned,
        // copied by hand — without going through Yamlink's own import
        // pipeline (which now refuses to copy .yamlink/ at all, see the
        // importers' fix for the same underlying risk). A pre-existing
        // .yamlink/api-token file was trusted unconditionally, letting
        // whoever planted that file choose the vault's own API credential.
        // A real generated token is always exactly 48 lowercase hex
        // characters; anything else must be rejected and regenerated.
        setup();
        try {
            fs.mkdirSync(path.dirname(getTokenPath(dir)), { recursive: true });
            fs.writeFileSync(getTokenPath(dir), 'pre-seeded-attacker-chosen-token');

            const token = getOrCreateApiToken(dir);

            assert.notEqual(token, 'pre-seeded-attacker-chosen-token', 'a malformed pre-existing token must never be trusted as-is');
            assert.match(token, /^[0-9a-f]{48}$/, 'a real token must be generated instead');
            assert.equal(fs.readFileSync(getTokenPath(dir), 'utf8'), token, 'the real generated token must be the one persisted to disk');
        } finally {
            teardown();
        }
    });

    test('still accepts and reuses a genuinely well-formed pre-existing token (no needless regeneration)', () => {
        setup();
        try {
            const first = getOrCreateApiToken(dir);
            const second = getOrCreateApiToken(dir);
            assert.equal(first, second, 'a real, well-formed persisted token must be reused across calls, not regenerated every time');
        } finally {
            teardown();
        }
    });
});
