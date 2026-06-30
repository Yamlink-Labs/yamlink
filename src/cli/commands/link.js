'use strict';

// yamlink link <id> <field> <target-id>   — add a wikilink relation on a note
// yamlink link <id> <field> <target-id> --append  — append to existing value
//
// Validates that both source and target exist in the vault index.
// Emits relation_added or relation_changed mutation events.

const fs   = require('fs');
const { parseFrontmatterDocument, writeFrontmatterFieldSurgically, serializeFrontmatterDocument, setField } = require('../../core/frontmatter');
const { appendMutationEvents, withMutationContext } = require('../../runtime/mutationEventLog');
const fmt = require('../format');
const { emitCliError, emitCliSuccess, emitText } = require('../io');

async function run({ id, field, targetId, vaultPath, json, quiet, dryRun, append }) {
    if (!id || !field || !targetId) {
        return emitCliError({ json, error: 'Usage: yamlink link <id> <field> <target-id>', code: 'USAGE', exitCode: 1 });
    }

    const { getIndex } = require('../../core/indexService');
    const idIndex  = getIndex();

    const filePath = idIndex.get(id);
    if (!filePath) {
        return emitCliError({ json, error: `Note "${id}" not found in vault.`, code: 'NOT_FOUND', exitCode: 1, details: { id, vaultPath } });
    }
    if (!idIndex.has(targetId)) {
        return emitCliError({ json, error: `Target "${targetId}" not found in vault.`, code: 'NOT_FOUND', exitCode: 1, details: { targetId, vaultPath } });
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

    const wikilink = `[[${targetId}]]`;
    const oldValue = parsed.data[field] ?? null;
    const oldStr   = oldValue !== null ? String(oldValue) : '';

    let newValue;
    if (append && oldStr) {
        newValue = oldStr.includes(wikilink) ? oldStr : `${oldStr}, ${wikilink}`;
    } else {
        newValue = wikilink;
    }

    const nextDoc     = setField(parsed, field, newValue);
    const surgical    = writeFrontmatterFieldSurgically(content, field, newValue);
    const nextContent = surgical !== null ? surgical : serializeFrontmatterDocument(nextDoc);

    if (dryRun) {
        if (json) { emitCliSuccess({ id, field, oldValue, newValue, targetId, filePath, dryRun: true }); return; }
        emitText(fmt.warn(`Would link ${id}.${field} → ${targetId}\n`));
        return;
    }

    try { fs.writeFileSync(filePath, nextContent, 'utf8'); } catch (e) {
        return emitCliError({ json, error: `Cannot write file: ${e.message}`, code: 'IO_ERROR', exitCode: 2 });
    }

    const eventType = !oldStr ? 'relation_added' : 'relation_changed';
    appendMutationEvents(withMutationContext([{
        type: eventType, noteId: id, field,
        oldValue: oldValue ?? null, newValue,
        timestamp: new Date().toISOString()
    }], { source: 'cli', cause: 'cli_link' }));

    if (json) { emitCliSuccess({ id, field, oldValue, newValue, targetId, filePath, dryRun: false }); return; }
    if (!quiet) emitText(fmt.ok(`Linked ${id}.${field} → ${targetId}\n`));
}

module.exports = { run };
