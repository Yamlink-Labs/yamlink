'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { canonicalizeId } = require('../core/id');
const { getPrimaryWorkspaceRoot } = require('../core/workspace');
const { parseFrontmatterDocument } = require('../core/frontmatter');
const { buildFieldOperation } = require('../core/bulkFieldOperation');
const { syncIndexAfterWrite } = require('./nodeCreationHelpers');
const {
    appendMutationEvents,
    withMutationContext
} = require('../runtime/mutationEventLog');

function isMarkdownUri(uri) {
    return uri && uri.fsPath && path.extname(uri.fsPath).toLowerCase() === '.md';
}

function collectMarkdownUris(uri, selectedUris) {
    const raw = Array.isArray(selectedUris) && selectedUris.length ? selectedUris : [uri];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        if (!isMarkdownUri(item)) continue;
        const key = path.resolve(item.fsPath).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

async function promptBulkFieldOperation() {
    const field = await vscode.window.showInputBox({
        title: 'Bulk set field',
        prompt: 'Frontmatter field name',
        placeHolder: 'status',
        validateInput: (value) => {
            const name = String(value || '').trim();
            if (!name) return 'Field cannot be empty';
            if (name === 'id') return 'Use rename to change note ids';
            return null;
        }
    });
    const fieldName = String(field || '').trim();
    if (!fieldName) return null;

    const mode = await vscode.window.showQuickPick(
        [
            { label: 'Set', operation: 'value', description: 'Overwrite this field on each selected note' },
            { label: 'Add', operation: 'add', description: 'Append a wikilink relation to a list field' },
            { label: 'Clear', operation: 'clear', description: 'Remove this field from each selected note' }
        ],
        { title: 'Bulk field mode', placeHolder: 'Choose what to do' }
    );
    if (!mode) return null;

    let value = null;
    if (mode.operation !== 'clear') {
        const input = await vscode.window.showInputBox({
            title: `Bulk ${mode.label.toLowerCase()} ${fieldName}`,
            prompt: mode.operation === 'add' ? 'Relation target to add' : 'Value to write',
            placeHolder: mode.operation === 'add' ? 'johnny-rico or [[johnny-rico]]' : 'active'
        });
        if (input === undefined) return null;
        value = input;
    }

    return { field: fieldName, operation: mode.operation, value };
}

function buildMutationEvent(noteId, result) {
    if (!result.changed || !result.eventType) return null;
    return {
        type: result.eventType,
        noteId,
        field: result.field,
        oldValue: result.oldValue,
        newValue: result.newValue
    };
}

function applyBulkFieldToFile(filePath, options) {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseFrontmatterDocument(content);
    const noteId = canonicalizeId(String(parsed?.data?.id || '').trim());
    if (!noteId) {
        throw new Error('Note has no id field.');
    }

    const result = buildFieldOperation(content, options.field, options.operation, options.value);
    if (!result.changed) {
        return { id: noteId, filePath, changed: false };
    }

    fs.writeFileSync(filePath, result.nextContent, 'utf8');
    // Matches every other VS Code write handler (nodeCreationTemplates.js,
    // nodeCreationCore.js, etc.): a cheap incremental single-file index
    // update, only escalating to a full buildIndex() when the update itself
    // reports it needs one — not a full-vault rebuild per selected note.
    syncIndexAfterWrite(filePath);
    const event = buildMutationEvent(noteId, result);
    if (event) {
        appendMutationEvents(withMutationContext([event], {
            source: 'vscode',
            cause: 'vscode_bulk_set_field_selection'
        }));
    }

    return { id: noteId, filePath, changed: true };
}

async function handleBulkSetFieldOnSelection(uri, selectedUris) {
    const uris = collectMarkdownUris(uri, selectedUris);
    if (!uris.length) {
        vscode.window.showInformationMessage('Yamlink: Select one or more Markdown notes first.');
        return;
    }

    const operation = await promptBulkFieldOperation();
    if (!operation) return;

    const root = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
    if (!root) {
        vscode.window.showErrorMessage('Yamlink: No workspace folder open.');
        return;
    }

    const succeeded = [];
    const failed = [];
    for (const item of uris) {
        try {
            succeeded.push(applyBulkFieldToFile(item.fsPath, operation));
        } catch (error) {
            failed.push({
                filePath: item.fsPath,
                error: error && error.message ? error.message : String(error)
            });
        }
    }

    const summary = `Yamlink: Bulk field update complete — ${succeeded.length} succeeded, ${failed.length} failed.`;
    if (failed.length) vscode.window.showWarningMessage(summary);
    else vscode.window.showInformationMessage(summary);

    return { succeeded, failed };
}

module.exports = {
    collectMarkdownUris,
    applyBulkFieldToFile,
    handleBulkSetFieldOnSelection
};
