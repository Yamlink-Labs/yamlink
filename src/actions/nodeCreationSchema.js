'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { validateAll } = require('../diagnostics/diagnostics');
const { canonicalizeId } = require('../core/id');
const { getPrimaryWorkspaceRoot } = require('../core/workspace');
const { getSchema, getSchemaTargets } = require('../registries/schemaRegistry');
const {
    buildSchemaFrontmatter,
    positionCursorOnFirstEmptyField,
    syncIndexAfterWrite
} = require('./nodeCreationHelpers');

async function handleNewNoteFromSchema(deps) {
    const { getIndex } = deps;
    if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage('Yamlink: No workspace folder open.');
        return;
    }
    const root = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
    if (!root) {
        vscode.window.showErrorMessage('Yamlink: No workspace folder open.');
        return;
    }

    const schemaTypes = [...getSchemaTargets()].sort();
    if (!schemaTypes.length) {
        vscode.window.showInformationMessage(
            'Yamlink: No schemas found. Create a note with type: schema and target: yourtype to define one.'
        );
        return;
    }

    const items = schemaTypes.map(type => {
        const schema = getSchema(type);
        const fields = schema ? Object.entries(schema.fields) : [];
        const requiredCount = fields.filter(([, def]) => def.required).length;
        const fieldSummary = fields.map(([name, def]) => def.required ? `${name}*` : name).join(', ');
        return {
            label: type,
            description: fields.length
                ? `${fields.length} field${fields.length !== 1 ? 's' : ''}${requiredCount ? ` · ${requiredCount} required` : ''}`
                : 'no fields defined',
            detail: fieldSummary ? `Fields: ${fieldSummary}  (* = required)` : undefined,
            type,
            schema
        };
    });

    const picked = await vscode.window.showQuickPick(items, {
        title: 'New Note from Schema',
        placeHolder: 'Select a schema type',
        matchOnDescription: true,
        matchOnDetail: true
    });
    if (!picked) return;

    const rawId = await vscode.window.showInputBox({
        title: `New ${picked.type} note`,
        prompt: 'Note ID',
        placeHolder: `my-${picked.type}`,
        validateInput: (v) => {
            if (!v || !v.trim()) return 'ID cannot be empty';
            if (!canonicalizeId(v)) return 'Enter text that can be turned into an ID';
            return null;
        }
    });
    if (!rawId) return;

    const cleanId = canonicalizeId(rawId);
    const today = new Date().toISOString().split('T')[0];
    const filePath = path.join(root, `${cleanId}.md`);
    if (fs.existsSync(filePath)) {
        vscode.window.showWarningMessage(`Yamlink: "${cleanId}.md" already exists.`);
        return;
    }

    const schemaFields = picked.schema?.fields || {};
    const content = buildSchemaFrontmatter(cleanId, picked.type, schemaFields, today, null, null);
    fs.writeFileSync(filePath, content, 'utf8');
    syncIndexAfterWrite(filePath);
    validateAll(getIndex);

    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    positionCursorOnFirstEmptyField(editor, doc);

    vscode.window.showInformationMessage(`Yamlink: Created "${cleanId}" (${picked.type})`);
}

module.exports = { handleNewNoteFromSchema };
