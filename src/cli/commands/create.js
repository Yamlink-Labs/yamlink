'use strict';

const fs = require('fs');
const path = require('path');

const fmt = require('../format');
const { emitCliError, emitCliSuccess, emitText } = require('../io');
const { appendMutationEvents, withMutationContext } = require('../../runtime/mutationEventLog');

function slugifyName(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
}

function buildId(noteType, fieldMap) {
    const nameValue = fieldMap.name || fieldMap.title || '';
    const slug = slugifyName(nameValue);
    if (slug) return slug;
    return `${noteType}-${Math.floor(Date.now() / 1000)}`;
}

function parseFieldArgs(rawArgs) {
    const fields = [];
    for (let i = 0; i < rawArgs.length; i++) {
        if (rawArgs[i] !== '--field') continue;
        const pair = rawArgs[i + 1];
        if (!pair) continue;
        const eqIndex = pair.indexOf('=');
        if (eqIndex === -1) continue;
        const key = pair.slice(0, eqIndex).trim();
        const value = pair.slice(eqIndex + 1).trim();
        if (!key) continue;
        fields.push({ key, value });
        i++;
    }
    return fields;
}

async function run({ noteType, rawArgs, vaultPath, json, quiet, dryRun, vaultService }) {
    const normalizedType = String(noteType || '').trim().toLowerCase();
    if (!normalizedType) {
        emitCliError({ json, error: 'Note type is required.', code: 'USAGE', exitCode: 1 });
        return;
    }

    const parsedFields = parseFieldArgs(rawArgs);
    const fieldMap = Object.create(null);
    for (const field of parsedFields) fieldMap[field.key] = field.value;

    const id = buildId(normalizedType, fieldMap);
    const filePath = path.join(vaultPath, `${id}.md`);
    if (fs.existsSync(filePath)) {
        emitCliError({ json, error: 'File already exists: ' + filePath, code: 'CONFLICT', exitCode: 1 });
        return;
    }

    const lines = ['---', `id: ${id}`, `type: ${normalizedType}`];
    for (const field of parsedFields) {
        lines.push(`${field.key}: ${field.value}`);
    }
    lines.push('---', '');

    if (!dryRun) {
        if (!vaultService) {
            emitCliError({ json, error: 'Vault service unavailable for create.', code: 'INTERNAL_ERROR', exitCode: 2 });
            return;
        }
        try {
            await vaultService.mutate(async () => {
            fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
            appendMutationEvents(withMutationContext([{
                type: 'note_created',
                noteId: id,
                field: null,
                oldValue: null,
                newValue: null,
                timestamp: new Date().toISOString()
            }], {
                source: 'cli',
                cause: 'cli_create_note'
            }));
            });
        } catch (error) {
            emitCliError({ json, error: 'Failed to create note: ' + error.message, code: 'INTERNAL_ERROR', exitCode: 2 });
            return;
        }
        if (json) {
            emitCliSuccess({ id, filePath, dryRun: false }, null);
            return;
        }
        emitText((quiet ? filePath : fmt.ok('Created: ' + filePath)) + '\n');
        return;
    }

    if (json) {
        emitCliSuccess({ id, filePath, dryRun: !!dryRun }, null);
        return;
    }

    emitText((quiet ? filePath : (dryRun ? fmt.warn('Would create: ' + filePath) : fmt.ok('Created: ' + filePath))) + '\n');
}

module.exports = { run };
