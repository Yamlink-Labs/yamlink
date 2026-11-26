'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { isBlockedAddress, isLoopbackAddress, isBlockedForWebhook, safeLookup, createSafeLookup, isLiteralIpBlocked, coerceAllowLocal } = require('../src/runtime/ssrfGuard');

describe('ssrfGuard', () => {
    describe('isBlockedAddress — IPv4', () => {
        test('blocks loopback', () => {
            assert.equal(isBlockedAddress('127.0.0.1'), true);
            assert.equal(isBlockedAddress('127.255.255.255'), true);
        });

        test('blocks the cloud metadata address and the rest of 169.254.0.0/16', () => {
            assert.equal(isBlockedAddress('169.254.169.254'), true);
            assert.equal(isBlockedAddress('169.254.1.1'), true);
        });

        test('blocks private ranges (10/8, 172.16/12, 192.168/16)', () => {
            assert.equal(isBlockedAddress('10.0.0.1'), true);
            assert.equal(isBlockedAddress('172.16.0.1'), true);
            assert.equal(isBlockedAddress('172.31.255.255'), true);
            assert.equal(isBlockedAddress('192.168.1.1'), true);
        });

        test('does not block 172.15.x or 172.32.x — adjacent to the private range but outside it', () => {
            assert.equal(isBlockedAddress('172.15.0.1'), false);
            assert.equal(isBlockedAddress('172.32.0.1'), false);
        });

        test('blocks carrier-grade NAT (100.64.0.0/10) and reserved/multicast (>=224)', () => {
            assert.equal(isBlockedAddress('100.64.0.1'), true);
            assert.equal(isBlockedAddress('224.0.0.1'), true);
            assert.equal(isBlockedAddress('255.255.255.255'), true);
        });

        test('allows an ordinary public address', () => {
            assert.equal(isBlockedAddress('93.184.216.34'), false);
            assert.equal(isBlockedAddress('8.8.8.8'), false);
        });

        test('malformed input fails closed (blocked), never silently passes', () => {
            assert.equal(isBlockedAddress(''), true);
            assert.equal(isBlockedAddress(null), true);
            assert.equal(isBlockedAddress('not-an-ip'), true);
        });
    });

    describe('isBlockedAddress — IPv6', () => {
        test('blocks loopback and unspecified', () => {
            assert.equal(isBlockedAddress('::1'), true);
            assert.equal(isBlockedAddress('::'), true);
        });

        test('blocks link-local (fe80::/10) and unique-local (fc00::/7)', () => {
            assert.equal(isBlockedAddress('fe80::1'), true);
            assert.equal(isBlockedAddress('fc00::1'), true);
            assert.equal(isBlockedAddress('fd12:3456:789a::1'), true);
        });

        test('unwraps an IPv4-mapped address and checks it as IPv4', () => {
            assert.equal(isBlockedAddress('::ffff:127.0.0.1'), true);
            assert.equal(isBlockedAddress('::ffff:8.8.8.8'), false);
        });

        test('real exploit reproduction: the pure-hex IPv4-mapped form bypasses regex-only unwrapping — must still be blocked', () => {
            // Real, confirmed bypass (external security review, not
            // theoretical): an earlier version of isPrivateIPv6 unwrapped
            // IPv4-mapped addresses with a regex matching only the dotted-
            // decimal embedded form (`::ffff:127.0.0.1`). RFC 4291 also
            // allows the exact same address written as two pure hex groups
            // (`::ffff:7f00:1` — 0x7f00:0x0001 = 127.0.0.1), which that
            // regex never matched, so it fell through every check and
            // returned "not private" — a real, exploitable SSRF bypass,
            // independently reproduced via a live webhook delivery to
            // loopback with no allowLocal opt-in. Fixed by delegating
            // classification to ipaddr.js instead of hand-rolled regex
            // unwrapping, which normalizes both forms identically.
            assert.equal(isBlockedAddress('::ffff:7f00:1'), true, '::ffff:7f00:1 is 127.0.0.1 in pure-hex form — must be blocked');
            assert.equal(isBlockedAddress('::ffff:a9fe:a9fe'), true, '::ffff:a9fe:a9fe is 169.254.169.254 (cloud metadata) in pure-hex form — must be blocked');
            assert.equal(isLiteralIpBlocked('[::ffff:7f00:1]'), true, 'the literal-IP synchronous check must also catch the hex form');
        });

        test('allows an ordinary public IPv6 address', () => {
            assert.equal(isBlockedAddress('2606:4700:4700::1111'), false);
        });
    });

    describe('isLoopbackAddress', () => {
        test('recognizes IPv4 and IPv6 loopback', () => {
            assert.equal(isLoopbackAddress('127.0.0.1'), true);
            assert.equal(isLoopbackAddress('127.5.5.5'), true);
            assert.equal(isLoopbackAddress('::1'), true);
            assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
        });

        test('does not call a non-loopback private address loopback', () => {
            assert.equal(isLoopbackAddress('192.168.1.1'), false);
            assert.equal(isLoopbackAddress('10.0.0.1'), false);
            assert.equal(isLoopbackAddress('169.254.169.254'), false);
            assert.equal(isLoopbackAddress('fe80::1'), false);
        });
    });

    describe('isBlockedForWebhook — the allowLocal opt-in', () => {
        test('without allowLocal, loopback is blocked like any other private range', () => {
            assert.equal(isBlockedForWebhook('127.0.0.1'), true);
        });

        test('with allowLocal, loopback specifically is let through', () => {
            assert.equal(isBlockedForWebhook('127.0.0.1', 4, { allowLocal: true }), false);
            assert.equal(isBlockedForWebhook('::1', 6, { allowLocal: true }), false);
        });

        test('allowLocal does NOT widen the exemption to other private ranges — only loopback', () => {
            assert.equal(isBlockedForWebhook('192.168.1.1', 4, { allowLocal: true }), true);
            assert.equal(isBlockedForWebhook('10.0.0.1', 4, { allowLocal: true }), true);
            assert.equal(isBlockedForWebhook('169.254.169.254', 4, { allowLocal: true }), true, 'the cloud metadata address must stay blocked even with allowLocal');
        });

        test('a public address is unaffected by the flag either way', () => {
            assert.equal(isBlockedForWebhook('8.8.8.8', 4, { allowLocal: true }), false);
            assert.equal(isBlockedForWebhook('8.8.8.8', 4), false);
        });
    });

    describe('coerceAllowLocal — real exploit reproduction', () => {
        // Real, confirmed bug (external security review, not theoretical):
        // a plain `!!value` coercion treats the literal string "false" as
        // true, since any non-empty string is truthy in JavaScript. An API
        // caller sending the JSON body `{"allowLocal": "false"}` — a
        // perfectly reasonable thing to type, expecting it to mean
        // "explicitly disabled" — would previously have had that hook
        // treated as `allowLocal: true`, silently admitting loopback
        // despite the caller's own explicit intent to keep it blocked.
        test('the literal string "false" must coerce to false, not true', () => {
            assert.equal(coerceAllowLocal('false'), false);
            assert.equal(coerceAllowLocal('FALSE'), false);
            assert.equal(coerceAllowLocal(' False '), false);
        });

        test('only real true or the string "true" coerce to true', () => {
            assert.equal(coerceAllowLocal(true), true);
            assert.equal(coerceAllowLocal('true'), true);
            assert.equal(coerceAllowLocal('TRUE'), true);
            assert.equal(coerceAllowLocal(' True '), true);
        });

        test('garbage/absent input fails closed to false', () => {
            assert.equal(coerceAllowLocal(undefined), false);
            assert.equal(coerceAllowLocal(null), false);
            assert.equal(coerceAllowLocal(0), false);
            assert.equal(coerceAllowLocal(1), false);
            assert.equal(coerceAllowLocal('yes'), false);
            assert.equal(coerceAllowLocal({}), false);
        });

        test('isBlockedForWebhook actually uses the strict coercion, not a bare !!', () => {
            // Proves the fix at the real call site the bug was found in,
            // not just the helper in isolation.
            assert.equal(isBlockedForWebhook('127.0.0.1', 4, { allowLocal: 'false' }), true, 'a "false" string must still block loopback');
            assert.equal(isBlockedForWebhook('127.0.0.1', 4, { allowLocal: 'true' }), false);
        });
    });

    describe('isLiteralIpBlocked — the allowLocal opt-in', () => {
        test('loopback literal is blocked by default, allowed with allowLocal', () => {
            assert.equal(isLiteralIpBlocked('127.0.0.1'), true);
            assert.equal(isLiteralIpBlocked('127.0.0.1', { allowLocal: true }), false);
            assert.equal(isLiteralIpBlocked('[::1]', { allowLocal: true }), false);
        });

        test('a private LAN literal stays blocked even with allowLocal', () => {
            assert.equal(isLiteralIpBlocked('192.168.1.1', { allowLocal: true }), true);
        });
    });

    describe('safeLookup', () => {
        test('refuses a hostname that resolves to loopback', () => {
            return new Promise((resolve, reject) => {
                safeLookup('localhost', {}, (err) => {
                    try {
                        assert.ok(err, 'localhost must be refused');
                        assert.match(err.message, /private\/internal address/);
                        resolve();
                    } catch (assertionError) {
                        reject(assertionError);
                    }
                });
            });
        });

        test('resolving an IP literal still applies the same check (no DNS bypass)', () => {
            return new Promise((resolve, reject) => {
                safeLookup('127.0.0.1', {}, (err) => {
                    try {
                        assert.ok(err);
                        resolve();
                    } catch (assertionError) {
                        reject(assertionError);
                    }
                });
            });
        });

        test('allows an ordinary public IP literal through — no network call needed, dns.lookup resolves a literal instantly', () => {
            return new Promise((resolve, reject) => {
                safeLookup('8.8.8.8', {}, (err, address, family) => {
                    try {
                        assert.equal(err, null);
                        assert.equal(address, '8.8.8.8');
                        assert.equal(family, 4);
                        resolve();
                    } catch (assertionError) {
                        reject(assertionError);
                    }
                });
            });
        });

        test('createSafeLookup bakes allowLocal in, so a bound lookup admits loopback but still blocks a private LAN address', () => {
            const lenientLookup = createSafeLookup({ allowLocal: true });
            return Promise.all([
                new Promise((resolve, reject) => {
                    lenientLookup('127.0.0.1', {}, (err, address) => {
                        try {
                            assert.equal(err, null);
                            assert.equal(address, '127.0.0.1');
                            resolve();
                        } catch (assertionError) { reject(assertionError); }
                    });
                }),
                new Promise((resolve, reject) => {
                    lenientLookup('192.168.1.1', {}, (err) => {
                        try {
                            assert.ok(err);
                            resolve();
                        } catch (assertionError) { reject(assertionError); }
                    });
                })
            ]);
        });

        test('callback-as-second-arg form (no options object) is supported', () => {
            return new Promise((resolve, reject) => {
                safeLookup('localhost', (err) => {
                    try {
                        assert.ok(err);
                        resolve();
                    } catch (assertionError) {
                        reject(assertionError);
                    }
                });
            });
        });
    });
});
