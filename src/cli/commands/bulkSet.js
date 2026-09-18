'use strict';

const fs = require('fs');
const {
    parseFrontmatterDocument
} = require('../../core/frontmatter');
const {
    toWikilink,
    buildNextValue,
    buildNextContent,
    eventTypeFor,
    pickOperation
} = require('../../core/bulkFieldOperation');
const { appendMutationEvents, withMutationContext } = require('../../runtime/mutationEventLog');
const fmt = require('../format');
const { emitJson, emitText, emitCliError } = require('../io');

function splitIds(rawIds) {
    return String(rawIds || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
}

function summarizeText(result) {
    const lines = [];
    const title = result.dryRun ? 'Bulk set preview' : 'Bulk set complete';
    lines.push(`${title}: ${result.succeeded.length} succeeded, ${result.failed.length} failed`);
    if (result.succeeded.length) {
        lines.push('');
        lines.push(result.dryRun ? 'Would update:' : 'Updated:');
        for (const item of result.succeeded) {
            const marker = item.changed ? '' : ' (no change)';
            lines.push(`  ${item.id}.${item.field}: ${JSON.stringify(item.oldValue)} -> ${JSON.stringify(item.newValue)}${marker}`);
        }
    }
    if (result.failed.length) {
        lines.push('');
        lines.push('Failed:');
        for (const item of result.failed) {
            lines.push(`  ${item.id}: ${item.error}`);
        }
    }
    return lines.join('\n') + '\n';
}

async function run({ ids, field, value, add, clear, json, quiet, dryRun, vaultService }) {
    const idList = splitIds(ids);
    const operation = pickOperation({ value, add, clear });

    if (!idList.length || !field || !operation) {
        emitCliError({
            json,
            error: 'Usage: yamlink bulk-set --ids <id1,id2,...> --field <name> (--value <value> | --add <value> | --clear)',
            code: 'USAGE',
            exitCode: 1
        });
        return;
    }

    if (field === 'id') {
        emitCliError({ json, error: 'Use "yamlink rename" to change note ids.', code: 'INVALID', exitCode: 1 });
        return;
    }

    if (!vaultService && !dryRun) {
        emitCliError({ json, error: 'Vault service unavailable for bulk-set.', code: 'INTERNAL_ERROR', exitCode: 2 });
        return;
    }

    const { getIndex } = require('../../core/indexService');
    const idIndex = getIndex();
    const result = {
        ok: true,
        command: 'bulk-set',
        field,
        operation,
        dryRun: !!dryRun,
        succeeded: [],
        failed: []
    };

    for (const id of idList) {
        const filePath = idIndex.get(id);
        if (!filePath) {
            result.failed.push({ id, error: `Note "${id}" not found in vault.` });
            continue;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const parsed = parseFrontmatterDocument(content);
            if (!parsed.hasFrontmatter) throw new Error('Note has no frontmatter block.');

            const { oldValue, newValue, changed } = buildNextValue(parsed, field, operation, value, add);
            const success = { id, field, oldValue, newValue, changed };

            if (dryRun || !changed) {
                result.succeeded.push(success);
                continue;
            }

            const nextContent = buildNextContent(content, parsed, field, operation, newValue);
            await vaultService.mutate(async () => {
                fs.writeFileSync(filePath, nextContent, 'utf8');
                appendMutationEvents(withMutationContext([{
                    type: eventTypeFor(oldValue, newValue),
                    noteId: id,
                    field,
                    oldValue,
                    newValue,
                    timestamp: new Date().toISOString()
                }], { source: 'cli', cause: 'cli_bulk_set' }));
            });
            result.succeeded.push(success);
        } catch (error) {
            result.failed.push({ id, error: error && error.message ? error.message : String(error) });
        }
    }

    process.exitCode = result.failed.length ? 1 : 0;
    result.ok = result.failed.length === 0;

    if (json) {
        emitJson(result);
        return;
    }
    if (quiet && !result.failed.length) return;
    emitText(result.failed.length ? summarizeText(result) : fmt.ok(summarizeText(result)));
}

module.exports = {
    run,
    splitIds,
    toWikilink,
    buildNextValue
};
