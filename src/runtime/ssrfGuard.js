'use strict';
// Shared SSRF guard for anything that sends an outbound request to a
// user-supplied URL (today: webhook delivery in webhookHttp.js). Blocks
// loopback, private, link-local (including the 169.254.169.254 cloud
// metadata address), and every other non-public IPv4/IPv6 range by default.
// `safeLookup` pins the DNS resolution used for the actual TCP connection to
// the exact addresses already checked here — passed as Node's http/https
// `lookup` option, it replaces the module's own separate internal resolution
// rather than running alongside it, which closes the DNS-rebinding gap a
// check-then-connect sequence would otherwise leave open (a hostname could
// resolve to a public IP at validation time and a private one moments later
// at actual-connect time).
//
// Address classification is delegated to `ipaddr.js`, not hand-rolled CIDR
// arithmetic. A first version of this module hand-rolled the IPv4-mapped-
// IPv6 unwrap with a regex matching only the dotted-decimal embedded form
// (`::ffff:127.0.0.1`) — a real, confirmed bypass, found by an external
// security review: the exact same address also has a fully valid, standards-
// compliant pure-hex representation (`::ffff:7f00:1`, RFC 4291) that regex
// never matched, so it sailed straight through as "not private." Hand-
// rolling a second IPv6 parser to fix the first one risked only moving the
// next bypass somewhere else; `ipaddr.js` is a small, zero-dependency,
// widely-used library built specifically to parse every valid
// representation of an address and classify it against the real registered
// IANA special-purpose ranges (including the embedded-IPv4 forms) rather
// than a hand-maintained range table. The policy is inverted accordingly:
// allow only `range() === 'unicast'` (an ordinary public address), block
// everything else — loopback/private/link-local/multicast/reserved/
// carrier-grade-NAT/benchmarking/documentation/unspecified/broadcast/etc. —
// rather than trying to enumerate every non-public range ourselves and
// risking missing one.
//
// Loopback is singled out as the one range a caller can explicitly re-admit
// via `{ allowLocal: true }`. Secure-by-default still blocks it, matching
// standard SSRF guidance — but for a local-first, single-user tool, a
// webhook pointed at the vault owner's own machine doesn't grant an attacker
// any reach they don't already have (same reasoning as apiToken.js's threat
// model), so an explicit, deliberate opt-in is offered rather than leaving
// no way to use it at all. Every other blocked range (other LAN machines,
// the cloud metadata address) stays blocked regardless of this flag —
// `allowLocal` widens nothing beyond "this exact machine."

const dns = require('dns');
const net = require('net');
const ipaddr = require('ipaddr.js');

/**
 * @param {string} address
 * @param {number} [family] unused — kept for call-site compatibility; ipaddr.js determines kind from the string itself
 * @returns {boolean}
 */
function isBlockedAddress(address, family) {
    if (!address) return true;
    let addr;
    try {
        addr = ipaddr.process(String(address));
    } catch (_) {
        return true; // unparseable — fail closed
    }
    return addr.range() !== 'unicast';
}

/**
 * @param {string} address
 * @param {number} [family]
 * @returns {boolean}
 */
function isLoopbackAddress(address, family) {
    if (!address) return false;
    try {
        return ipaddr.process(String(address)).range() === 'loopback';
    } catch (_) {
        return false;
    }
}

/**
 * The actual decision a webhook call makes for one resolved address: blocked
 * by default for anything that isn't an ordinary public ("unicast") address,
 * with loopback specifically exempted when the caller explicitly opted in
 * via `{ allowLocal: true }`.
 * @param {string} address
 * @param {number} [family]
 * @param {{ allowLocal?: boolean }} [options]
 * @returns {boolean}
 */
function isBlockedForWebhook(address, family, options = {}) {
    if (!isBlockedAddress(address, family)) return false;
    if (coerceAllowLocal(options.allowLocal) && isLoopbackAddress(address, family)) return false;
    return true;
}

/**
 * Drop-in replacement for `dns.lookup`, suitable for the `lookup` option on
 * `http.request`/`https.request`. Resolves normally, then refuses to hand
 * back any address that falls in a blocked range — the caller's request
 * never reaches a loopback/private/link-local destination, and reuses
 * exactly this resolution rather than letting Node re-resolve separately.
 * @param {string} hostname
 * @param {object|Function} options
 * @param {Function} [callback]
 */
function safeLookup(hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    const wantsAll = !!(options && options.all);
    const allowLocal = coerceAllowLocal(options && options.allowLocal);
    dns.lookup(hostname, { all: true }, (err, addresses) => {
        if (err) { callback(err); return; }
        const list = Array.isArray(addresses) ? addresses : [addresses];
        if (!list.length) { callback(new Error(`DNS lookup for ${hostname} returned no addresses`)); return; }
        const blocked = list.find((entry) => isBlockedForWebhook(entry.address, entry.family, { allowLocal }));
        if (blocked) {
            callback(new Error(`Refusing to connect to ${hostname}: resolves to a private/internal address (${blocked.address})`));
            return;
        }
        if (wantsAll) { callback(null, list); return; }
        callback(null, list[0].address, list[0].family);
    });
}

/**
 * Returns a `lookup`-shaped function with `allowLocal` baked in — needed
 * because Node's own `lookup` option contract only ever hands the function
 * its own internal resolution options (`family`/`hints`/`all`), with no way
 * for the caller creating the request to pass a custom flag through that
 * channel. Binding the flag at creation time (one new function per webhook
 * delivery, cheap) is the straightforward way to thread a per-hook
 * `allowLocal` setting into the one place it's actually enforced.
 * @param {{ allowLocal?: boolean }} [options]
 */
function createSafeLookup(options = {}) {
    const allowLocal = coerceAllowLocal(options.allowLocal);
    return function boundSafeLookup(hostname, lookupOptions, callback) {
        if (typeof lookupOptions === 'function') {
            callback = lookupOptions;
            lookupOptions = {};
        }
        safeLookup(hostname, { ...lookupOptions, allowLocal }, callback);
    };
}

/**
 * Strips the `[...]` brackets the WHATWG URL parser keeps around an IPv6
 * literal in `.hostname` (e.g. `[::1]`) — `net.isIP()` does not recognize
 * the bracketed form at all and would silently report "not an IP" for every
 * IPv6 literal otherwise.
 * @param {string} hostname
 * @returns {string}
 */
function normalizeHostname(hostname) {
    return String(hostname || '').replace(/^\[/, '').replace(/\]$/, '');
}

/**
 * True when `hostname` is itself an IP literal that resolves to a blocked
 * address — checkable synchronously, with no DNS lookup involved at all.
 * This matters because Node's `lookup` option (what `safeLookup` patches)
 * is never actually invoked when the request target is already a literal
 * IP address — there's nothing to resolve, so `net.connect` skips straight
 * to connecting. A webhook URL of literally `http://127.0.0.1/...` would
 * sail straight past `safeLookup` with no check at all; this is the
 * complementary synchronous check callers must run first for exactly that
 * case (confirmed by direct testing, not assumed from the Node docs).
 * @param {string} hostname
 * @param {{ allowLocal?: boolean }} [options]
 * @returns {boolean}
 */
function isLiteralIpBlocked(hostname, options = {}) {
    const normalized = normalizeHostname(hostname);
    const family = net.isIP(normalized);
    if (!family) return false; // not an IP literal at all — a real hostname, safeLookup covers it at connect time
    return isBlockedForWebhook(normalized, family, options);
}

/**
 * Strict, fail-closed boolean coercion for `allowLocal`, wherever it's read
 * from external input — an API JSON body, a CLI flag, or a persisted hook
 * read back from `.yamlink/webhooks.json`. A plain `!!value` coercion is
 * wrong here: `!!'false'` is `true` in JavaScript (any non-empty string is
 * truthy), so a caller sending the literal JSON/string value `"false"` —
 * confirmed as a real, reachable bug via the API's JSON body, not
 * theoretical — would have its webhook treated as `allowLocal: true`
 * despite explicitly writing `false`. Only the real boolean `true` or the
 * case-insensitive string `"true"` count as true; everything else,
 * including `"false"`, `0`, `null`, `undefined`, or garbage input, is false.
 * @param {*} raw
 * @returns {boolean}
 */
function coerceAllowLocal(raw) {
    if (raw === true) return true;
    if (typeof raw === 'string' && raw.trim().toLowerCase() === 'true') return true;
    return false;
}

module.exports = {
    coerceAllowLocal,
    isBlockedAddress,
    isLoopbackAddress,
    isBlockedForWebhook,
    safeLookup,
    createSafeLookup,
    isLiteralIpBlocked,
    normalizeHostname
};
