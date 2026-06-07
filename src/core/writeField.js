'use strict';

const fs = require('fs');
const vscode = require('vscode');
const {
    parseFrontmatterDocument,
    setField,
    deleteField,
    serializeFrontmatterDocument,
    writeFrontmatterFieldSurgically
} = require('./frontmatter');

/** @param {string} filePath @param {string} field @param {any} newValue @returns {Promise<boolean>} */
async function writeFieldValue(filePath, field, newValue) {
    if (!filePath || !field) return false;
    if (field === 'id') return false;

    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) { return false; }
    let parsed;
    try {
        parsed = parseFrontmatterDocument(content);
    } catch (e) {
        return false;
    }
    if (!parsed.hasFrontmatter) return false;

    const normalisedValue = typeof newValue === 'string' ? newValue.trim() : newValue;
    const nextDoc = normalisedValue === ''
        ? deleteField(parsed, field)
        : setField(parsed, field, normalisedValue);

    const canonicalValue = normalisedValue === '' ? null : nextDoc.data[field];
    const surgical = writeFrontmatterFieldSurgically(content, field, canonicalValue);
    const nextContent = surgical !== null ? surgical : serializeFrontmatterDocument(nextDoc);

    try {
        const targetUri = vscode.Uri.file(filePath);
        const openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === filePath);
        if (openDoc) {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                openDoc.positionAt(0),
                openDoc.positionAt(openDoc.getText().length)
            );
            edit.replace(targetUri, fullRange, nextContent);
            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) return false;
            if (openDoc.isDirty) {
                await openDoc.save();
            }
            return true;
        }

        fs.writeFileSync(filePath, nextContent, 'utf8');
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = { writeFieldValue };
