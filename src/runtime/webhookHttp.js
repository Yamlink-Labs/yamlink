'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { createSafeLookup, isLiteralIpBlocked, coerceAllowLocal } = require('./ssrfGuard');

/**
 * Best-effort POST of a small JSON payload to a configured webhook URL.
 * Never throws — callers decide how loudly to report delivery failures.
 * `allowLocal`, when true, exempts loopback (127.0.0.0/8, ::1) specifically
 * from the SSRF guard — an explicit per-hook opt-in set at registration time
 * (see `webhooks.js`'s `validateHookInput`), never a blanket default. Every
 * other blocked range (other LAN machines, the cloud metadata address) stays
 * blocked regardless of this flag.
 * @param {string} url
 * @param {Record<string, any>} payload
 * @param {{ allowLocal?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
function postJsonWebhook(url, payload, options = {}) {
    const allowLocal = coerceAllowLocal(options.allowLocal);
    return new Promise((resolve) => {
        let parsed;
        try {
            parsed = new URL(url);
        } catch (err) {
            resolve({ ok: false, error: 'Invalid webhook URL: ' + err.message });
            return;
        }
        const client = parsed.protocol === 'https:' ? https : parsed.protocol === 'http:' ? http : null;
        if (!client) {
            resolve({ ok: false, error: 'Unsupported webhook protocol: ' + parsed.protocol });
            return;
        }
        // Node's `lookup` option below is never actually invoked when the
        // target is already a literal IP address (nothing to resolve) — so
        // the simplest possible payload, `http://127.0.0.1/...`, would sail
        // straight past it with zero protection. This upfront check is the
        // one that actually covers that case; `lookup` covers the
        // hostname-resolves-to-a-private-address and DNS-rebinding cases
        // this check cannot.
        if (isLiteralIpBlocked(parsed.hostname, { allowLocal })) {
            resolve({ ok: false, error: `Refusing to connect to ${parsed.hostname}: resolves to a private/internal address` });
            return;
        }
        const body = JSON.stringify(payload);
        const req = client.request(parsed, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 5000,
            lookup: createSafeLookup({ allowLocal })
        }, (res) => {
            res.resume();
            resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                error: res.statusCode >= 300 ? 'HTTP ' + res.statusCode : undefined
            });
        });
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Webhook request timed out' }); });
        req.on('error', (err) => resolve({ ok: false, error: err.message }));
        req.end(body);
    });
}

module.exports = { postJsonWebhook };
