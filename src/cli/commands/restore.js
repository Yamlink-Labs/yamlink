'use strict';

const fs = require('fs');
const path = require('path');
const { getFieldsCache } = require('../../core/indexService');
const { reconstructVaultAtTime } = require('../../core/timeEngine');
const { getMutationEvents, getVaultSnapshots } = require('../../runtime/mutationEventLog');
const { captureOutput, emitCliError, emitCliSuccess, emitText } = require('../io');
const fmt = require('../format');

function yamlScalar(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value) || (typeof value === 'object' && value)) return JSON.stringify(value);
    const text = String(value);
    if (!text.length) return '""';
    if (/^[A-Za-z0-9_.\/:-]+$/.test(text) && !/^(true|false|null)$/i.test(text)) return text;
    return JSON.stringify(text);
}

function orderedEntries(id, fields) {
    const entries = Object.entries(fields || {}).filter(([key]) => !key.startsWith('__'));
    entries.sort(([a], [b]) => {
        if (a === 'id') return -1;
        if (b === 'id') return 1;
        if (a === 'type') return b === 'id' ? 1 : -1;
        if (b === 'type') return a === 'id' ? -1 : 1;
        return a.localeCompare(b);
    });
    if (!entries.some(([key]) => key === 'id')) entries.unshift(['id', id]);
    return entries;
}

function toMarkdown(id, fields, timestamp, complete, reason) {
    const frontmatter = orderedEntries(id, fields)
        .map(([key, value]) => `${key}: ${yamlScalar(value)}`)
        .join('\n');
    const warning = complete ? '' : `\n# Reconstruction incomplete as of ${timestamp}${reason ? ` (${reason})` : ''}.\n`;
    return `---\n${frontmatter}\n---\n${warning}`;
}

function buildRestoreData(timestamp) {
    const fieldsCache = getFieldsCache();
    const mutationEvents = getMutationEvents();
    const snapshots = getVaultSnapshots();
    const reconstructed = reconstructVaultAtTime(timestamp, { fieldsCache, mutationEvents, snapshots });
    const notes = [];
    let complete = true;
    let incompleteCount = 0;
    let existingCount = 0;

    for (const [id, entry] of reconstructed) {
        if (!entry.exists) continue;
        existingCount++;
        if (!entry.complete) {
            complete = false;
            incompleteCount++;
        }
        notes.push({
            id,
            exists: true,
            complete: Boolean(entry.complete),
            fields: entry.fields || null,
            reason: entry.reason || null,
            earliestReconstructableTimestamp: entry.earliestReconstructableTimestamp || null,
            deletedAt: entry.deletedAt || null
        });
    }

    notes.sort((a, b) => a.id.localeCompare(b.id));
    return {
        timestamp,
        complete,
        noteCount: existingCount,
        incompleteCount,
        notes
    };
}

function writeRestoreExport(data, outputPath, vaultPath) {
    const resolvedOutput = path.resolve(outputPath);
    const resolvedVault = path.resolve(vaultPath);
    // Refuse the exact root AND any subdirectory of it — not just an exact
    // match. A subdirectory (e.g. `--output ./export` run from inside the
    // vault) still lands inside the tree Yamlink's own indexer scans, so
    // restored/historical .md files would get picked up as live vault notes
    // on the next rebuild, exactly the pollution this check exists to stop.
    const relativeToVault = path.relative(resolvedVault, resolvedOutput);
    const isInsideVault = resolvedOutput === resolvedVault
        || (!relativeToVault.startsWith('..') && !path.isAbsolute(relativeToVault));
    if (isInsideVault) {
        const error = new Error('Refusing to write restore output inside the live vault. Choose a directory outside the vault.');
        /** @type {Error & { code?: string }} */ (error).code = 'REFUSE_LIVE_VAULT';
        throw error;
    }

    fs.mkdirSync(resolvedOutput, { recursive: true });
    let written = 0;
    for (const note of data.notes) {
        if (!note.fields) continue;
        const filename = `${note.id.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')}.md`;
        fs.writeFileSync(path.join(resolvedOutput, filename), toMarkdown(note.id, note.fields, data.timestamp, note.complete, note.reason), 'utf8');
        written++;
    }
    return { outputPath: resolvedOutput, written };
}

function run({ timestamp, output, vaultPath, json }) {
    const raw = String(timestamp || '').trim();
    if (!raw) {
        emitCliError({ json, error: 'Usage: yamlink restore <timestamp> [--output <path>]', code: 'USAGE', exitCode: 1 });
        return;
    }
    const parsedMs = Date.parse(raw);
    if (!Number.isFinite(parsedMs)) {
        emitCliError({ json, error: `Invalid timestamp: ${raw}`, code: 'INVALID_PARAM', exitCode: 1 });
        return;
    }

    const at = new Date(parsedMs).toISOString();
    const data = buildRestoreData(at);
    let exportResult = null;
    if (output) {
        try {
            exportResult = writeRestoreExport(data, output, vaultPath);
        } catch (error) {
            emitCliError({
                json,
                error: error && error.message ? error.message : String(error),
                code: error && error.code ? error.code : 'INTERNAL_ERROR',
                exitCode: error && error.code === 'REFUSE_LIVE_VAULT' ? 1 : 2
            });
            return;
        }
    }

    if (json) {
        emitCliSuccess({ ...data, ...(exportResult ? { output: exportResult } : {}) });
        return;
    }

    emitText(captureOutput(() => {
        fmt.header(`Vault Restore Preview — ${data.timestamp}`);
        fmt.row('Notes existing', data.noteCount);
        fmt.row('Complete', data.complete ? 'true' : 'false');
        if (data.incompleteCount) fmt.row('Incomplete notes', data.incompleteCount);
        if (exportResult) {
            fmt.row('Export directory', exportResult.outputPath);
            fmt.row('Files written', exportResult.written);
        } else {
            fmt.row('Writes', 'none (preview only)');
        }
        fmt.blank();
        fmt.subheader('Notes');
        for (const note of data.notes.slice(0, 30)) {
            const marker = note.complete ? fmt.ok('complete') : fmt.warn('incomplete');
            console.log(`  ${note.id} — ${marker}`);
        }
        if (data.notes.length > 30) console.log(`  ... ${data.notes.length - 30} more`);
        fmt.blank();
        if (!exportResult) {
            console.log('  ' + fmt.warn('Preview only. Pass --output <path> to export reconstructed .md files into a separate directory.'));
        }
    }));
}

module.exports = { run, buildRestoreData, writeRestoreExport };
