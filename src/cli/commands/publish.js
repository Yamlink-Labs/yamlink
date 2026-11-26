'use strict';

const fs = require('fs');
const path = require('path');
const { getIndex, getFieldsCache, getAliasIndex, getVaultGeneration } = require('../../core/indexService');
const { runBuild } = require('../../core/buildPipeline');
const { emitCliError, emitCliSuccess, emitText } = require('../io');
const fmt = require('../format');
const { postJsonWebhook } = require('../../runtime/webhookHttp');

// fs.realpathSync, not path.resolve: path.resolve is purely lexical and
// never follows a symlink, so a symlinked --out that physically points
// inside the vault (or vice versa) would pass a plain string-prefix check
// while still being unsafe for real. --out typically doesn't exist yet on a
// first publish, so this walks up to the nearest existing ancestor,
// resolves that for real, and rejoins the remaining path segments.
function realpathOrNearestAncestor(targetPath) {
    try {
        return fs.realpathSync(targetPath);
    } catch (_) {
        const parent = path.dirname(targetPath);
        if (parent === targetPath) return targetPath;
        return path.join(realpathOrNearestAncestor(parent), path.basename(targetPath));
    }
}

async function run({ out, mode, siteUrl, webhook, vaultPath, force, json, quiet }) {
    if (!out) {
        emitCliError({
            json,
            error: 'Usage: yamlink publish --out <dir> [--mode preview|production] [--site-url <url>] [--webhook <url>] [--force]',
            code: 'USAGE',
            exitCode: 1
        });
        return;
    }

    // --out must never be the vault itself, or a folder inside it. The build
    // output directory is walked wholesale for --deploy and the raw .md
    // source files (private notes included, with none of the publishability
    // filtering applied) would sit right there alongside the generated site
    // and ship as-is — a real, confirmed way to leak an entire vault, not a
    // hypothetical.
    if (vaultPath) {
        const resolvedOut = realpathOrNearestAncestor(path.resolve(out));
        const resolvedVault = realpathOrNearestAncestor(path.resolve(vaultPath));
        if (resolvedOut === resolvedVault || resolvedOut.startsWith(resolvedVault + path.sep)) {
            emitCliError({
                json,
                error: `--out must not be the vault itself or a folder inside it (vault: ${resolvedVault}, --out: ${resolvedOut}) — the raw, unfiltered vault files would be published alongside the generated site. Choose a separate output directory.`,
                code: 'UNSAFE_OUT_DIR',
                exitCode: 1
            });
            return;
        }
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
            vaultPath,
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
