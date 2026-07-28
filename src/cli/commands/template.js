'use strict';

const fs = require('fs');
const { getIndex, getFieldsCache } = require('../../core/indexService');
const { buildTemplateFromNote, saveTemplateFile } = require('../../core/templateRegistry');
const { emitCliError, emitCliSuccess, emitText } = require('../io');
const fmt = require('../format');

function runSave({ id, force, json, vaultPath }) {
    const idIndex = getIndex();
    if (!idIndex.has(id)) {
        emitCliError({ json, error: 'Note not found: ' + id, code: 'NOT_FOUND', exitCode: 1, details: { id } });
        return;
    }

    const fieldsCache = getFieldsCache();
    const type = String(fieldsCache.get(id)?.type || '').trim();
    if (!type) {
        emitCliError({
            json,
            error: `Note "${id}" has no type: field — templates are keyed by type and can't be built from an untyped note.`,
            code: 'USAGE',
            exitCode: 1,
            details: { id }
        });
        return;
    }

    const filePath = idIndex.get(id);
    let noteContent;
    try {
        noteContent = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        emitCliError({ json, error: 'Failed to read note: ' + error.message, code: 'INTERNAL_ERROR', exitCode: 2 });
        return;
    }

    const templateContent = buildTemplateFromNote(noteContent);
    let templatePath;
    try {
        templatePath = saveTemplateFile(vaultPath, type, templateContent, { force: Boolean(force) });
    } catch (error) {
        if (error && error.code === 'TEMPLATE_EXISTS') {
            emitCliError({
                json,
                error: error.message + ' — pass --force to overwrite.',
                code: 'CONFLICT',
                exitCode: 1,
                details: { id, type }
            });
            return;
        }
        emitCliError({ json, error: 'Failed to write template: ' + error.message, code: 'INTERNAL_ERROR', exitCode: 2 });
        return;
    }

    if (json) {
        emitCliSuccess({ id, type, templatePath });
        return;
    }
    emitText(fmt.ok(`Saved template for type "${type}": ${templatePath}`) + '\n');
}

function run(args) {
    const { subcommand, id, force, json, vaultPath } = args;
    if (subcommand === 'save') {
        if (!id) {
            emitCliError({ json, error: 'Usage: yamlink template save <id> [--force]', code: 'USAGE', exitCode: 1 });
            return;
        }
        runSave({ id, force, json, vaultPath });
        return;
    }
    emitCliError({ json, error: 'Usage: yamlink template save <id> [--force]', code: 'USAGE', exitCode: 1 });
}

module.exports = { run };
