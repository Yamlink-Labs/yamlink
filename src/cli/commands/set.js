'use strict';

// yamlink set <id> <field> <value>   — update a frontmatter field on a note
// yamlink set <id> <field> --clear   — remove a frontmatter field from a note
//
// Writes directly to the note file using frontmatter.js surgical writer.
// Emits field_added / field_changed / field_removed mutation events.

const fs   = require('fs');
const { parseFrontmatterDocument, writeFrontmatterFieldSurgically, serializeFrontmatterDocument, setField, deleteField } = require('../../core/frontmatter');
const { appendMutationEvents, withMutationContext } = require('../../runtime/mutationEventLog');
const fmt = require('../format');
const { emitCliError, emitCliSuccess, emitText } = require('../io');

async function run({ id, field, value, vaultPath, json, quiet, dryRun, clear }) {
    if (!id || !field) {
        return emitCliError({ json, error: 'Usage: yamlink set <id> <field> <value>', code: 'USAGE', exitCode: 1 });
    }
    if (!clear && (value === undefined || value === null)) {
        return emitCliError({ json, error: 'Provide a value or use --clear to remove the field.', code: 'USAGE', exitCode: 1 });
    }
    if (field === 'id') {
        return emitCliError({ json, error: 'Use "yamlink rename" to change a note\'s id.', code: 'INVALID', exitCode: 1 });
    }

    const { getIndex } = require('../../core/indexService');
    const idIndex  = getIndex();
    const filePath = idIndex.get(id);
    if (!filePath) {
        return emitCliError({ json, error: `Note "${id}" not found in vault.`, code: 'NOT_FOUND', exitCode: 1, details: { id, vaultPath } });
    }

    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) {
        return emitCliError({ json, error: `Cannot read file: ${e.message}`, code: 'IO_ERROR', exitCode: 2 });
    }

    let parsed;
    try { parsed = parseFrontmatterDocument(content); } catch (_) {
        return emitCliError({ json, error: 'Could not parse frontmatter.', code: 'PARSE_ERROR', exitCode: 2 });
    }
    if (!parsed.hasFrontmatter) {
        return emitCliError({ json, error: 'Note has no frontmatter block.', code: 'INVALID', exitCode: 1 });
    }

    const oldValue = parsed.data[field] ?? null;
    const newValue = clear ? null : String(value);
    const nextDoc  = newValue === null ? deleteField(parsed, field) : setField(parsed, field, newValue);
    const surgical = writeFrontmatterFieldSurgically(content, field, newValue);
    const nextContent = surgical !== null ? surgical : serializeFrontmatterDocument(nextDoc);

    if (dryRun) {
        if (json) { emitCliSuccess({ id, field, oldValue, newValue, filePath, dryRun: true }); return; }
        emitText(fmt.warn(`Would set ${id}.${field} = ${JSON.stringify(newValue)}\n`));
        return;
    }

    try { fs.writeFileSync(filePath, nextContent, 'utf8'); } catch (e) {
        return emitCliError({ json, error: `Cannot write file: ${e.message}`, code: 'IO_ERROR', exitCode: 2 });
    }

    const eventType = !oldValue && newValue ? 'field_added'
        : oldValue && !newValue ? 'field_removed'
        : 'field_changed';
    appendMutationEvents(withMutationContext([{
        type: eventType, noteId: id, field,
        oldValue: oldValue ?? null, newValue: newValue ?? null,
        timestamp: new Date().toISOString()
    }], { source: 'cli', cause: 'cli_set' }));

    if (json) { emitCliSuccess({ id, field, oldValue, newValue, filePath, dryRun: false }); return; }
    if (!quiet) emitText(fmt.ok(`Set ${id}.${field} = ${JSON.stringify(newValue)}\n`));
}

module.exports = { run };
