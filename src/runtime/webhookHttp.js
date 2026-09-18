'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Best-effort POST of a small JSON payload to a configured webhook URL.
 * Never throws — callers decide how loudly to report delivery failures.
 * @param {string} url
 * @param {Record<string, any>} payload
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
function postJsonWebhook(url, payload) {
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
        const body = JSON.stringify(payload);
        const req = client.request(parsed, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 5000
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
