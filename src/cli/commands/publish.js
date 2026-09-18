'use strict';

const { getIndex, getFieldsCache, getAliasIndex, getVaultGeneration } = require('../../core/indexService');
const { runBuild } = require('../../core/buildPipeline');
const { emitCliError, emitCliSuccess, emitText } = require('../io');
const fmt = require('../format');
const { postJsonWebhook } = require('../../runtime/webhookHttp');

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
        webhookResult = await postJsonWebhook(webhook, {
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
