'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const { getIndex, getFieldsCache, getAliasIndex, getVaultGeneration } = require('../../core/indexService');
const { runBuild } = require('../../core/buildPipeline');
const { emitCliError, emitCliSuccess, emitText } = require('../io');
const fmt = require('../format');

/**
 * Best-effort POST of a small JSON payload to a configured webhook URL after
 * a successful build (e.g. to trigger the destination site's own redeploy).
 * Never fails the build itself — a webhook that's down or misconfigured is
 * a warning, not a build failure.
 * @param {string} url
 * @param {Record<string, any>} payload
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
function postWebhook(url, payload) {
    return new Promise((resolve) => {
        let parsed;
        try {
            parsed = new URL(url);
        } catch (err) {
            resolve({ ok: false, error: 'Invalid webhook URL: ' + err.message });
            return;
        }
        const client = parsed.protocol === 'https:' ? https : http;
        const body = JSON.stringify(payload);
        const req = client.request(parsed, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 5000
        }, (res) => {
            res.resume();
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, error: res.statusCode >= 300 ? 'HTTP ' + res.statusCode : undefined });
        });
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Webhook request timed out' }); });
        req.on('error', (err) => resolve({ ok: false, error: err.message }));
        req.end(body);
    });
}

async function run({ out, mode, siteUrl, webhook, force, json, quiet }) {
    if (!out) {
        emitCliError({
            json,
            error: 'Usage: yamlink publish --out <dir> [--mode preview|production] [--site-url <url>] [--webhook <url>] [--force]',
            code: 'USAGE',
            exitCode: 1
        });
        return;
    }

    const resolvedMode = mode === 'preview' ? 'preview' : 'production';

    let result;
    try {
        result = runBuild({
            idIndex: getIndex(),
            fieldsCache: getFieldsCache(),
            aliasIndex: getAliasIndex(),
            vaultGeneration: getVaultGeneration(),
            outDir: out,
            mode: resolvedMode,
            siteUrl: siteUrl || null,
            force: !!force
        });
    } catch (err) {
        emitCliError({ json, error: 'Build failed: ' + err.message, code: 'BUILD_FAILED', exitCode: 2 });
        return;
    }

    let webhookResult = null;
    if (webhook) {
        webhookResult = await postWebhook(webhook, {
            generation: result.generation,
            noteCount: result.noteCount,
            notesWritten: result.notesWritten,
            mode: resolvedMode,
            timestamp: new Date().toISOString()
        });
    }

    if (json) {
        emitCliSuccess({ ...result, webhook: webhookResult });
        return;
    }

    if (!quiet) {
        const lines = [
            fmt.ok(`Published ${result.noteCount} note(s) to ${out}`),
            `  written: ${result.notesWritten}, unchanged: ${result.notesSkipped}, removed: ${result.notesRemoved}`
        ];
        if (result.redirectCount) lines.push(`  redirects: ${result.redirectCount}`);
        if (result.warnings.length) {
            lines.push(fmt.warn(`  ${result.warnings.length} pre-publish warning(s):`));
            for (const w of result.warnings.slice(0, 20)) {
                lines.push(`    ${w.noteId} → ${w.target} (${w.reason})`);
            }
            if (result.warnings.length > 20) lines.push(`    ...and ${result.warnings.length - 20} more`);
        }
        if (webhookResult) {
            lines.push(webhookResult.ok ? fmt.ok('  webhook: delivered') : fmt.warn('  webhook: failed — ' + webhookResult.error));
        }
        emitText(lines.join('\n') + '\n');
    }
}

module.exports = { run };
