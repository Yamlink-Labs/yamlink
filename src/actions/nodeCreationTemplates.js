'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { validateAll } = require('../diagnostics/diagnostics');
const { canonicalizeId } = require('../core/id');
const { getPrimaryWorkspaceRoot } = require('../core/workspace');
const { parseFrontmatterDocument } = require('../core/frontmatter');
const { emitOutcomeEvent } = require('../runtime/mutationEventLog');
const {
    TEMPLATES_DIR,
    loadTemplates,
    getTemplateForType,
    buildTemplateFromNote,
    saveTemplateFile
} = require('../core/templateRegistry');
const {
    positionCursorOnFirstEmptyField,
    focusFirstEmptyFieldAndSuggest,
    applyTemplate,
    syncIndexAfterWrite
} = require('./nodeCreationHelpers');

async function handleNewNodeFromTemplate(deps) {
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

    const templates = loadTemplates(root);
    if (templates.length === 0) {
        const action = await vscode.window.showInformationMessage(
            'Yamlink: No templates found. Create .md files in _templates/ to get started.',
            'Create _templates folder'
        );
        if (action === 'Create _templates folder') {
            const templatesPath = path.join(root, TEMPLATES_DIR);
            if (!fs.existsSync(templatesPath)) fs.mkdirSync(templatesPath);

            const starterPath = path.join(templatesPath, 'contact.md');
            if (!fs.existsSync(starterPath)) {
                fs.writeFileSync(starterPath, `---
id:
type: contact
name:
account: [[]]
email:
created:
---

`, 'utf8');
            }

            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(templatesPath, 'contact.md')));
            await vscode.window.showTextDocument(doc, { preview: false });
            vscode.window.showInformationMessage('Yamlink: _templates/ created with a starter contact template.');
        }
        return;
    }

    const picked = await vscode.window.showQuickPick(
        templates.map(t => ({
            label: t.name,
            description: t.type ? `type: ${t.type}` : '',
            detail: t.fields.length > 0 ? `Fields: ${t.fields.join(', ')}` : '',
            template: t
        })),
        { title: 'New Node from Template', placeHolder: 'Select a template', matchOnDescription: true, matchOnDetail: true }
    );
    if (!picked) return;

    const id = await vscode.window.showInputBox({
        title: `New ${picked.label} node`,
        prompt: 'Node ID',
        placeHolder: `my-${picked.label}-id`,
        validateInput: (v) => {
            if (!v || !v.trim()) return 'ID cannot be empty';
            if (!canonicalizeId(v)) return 'Enter text that can be turned into an ID';
            return null;
        }
    });
    if (!id) return;

    const cleanId = canonicalizeId(id);
    const today = new Date().toISOString().split('T')[0];
    const filePath = path.join(root, `${cleanId}.md`);
    if (fs.existsSync(filePath)) {
        vscode.window.showWarningMessage(`Yamlink: "${cleanId}.md" already exists.`);
        return;
    }

    const finalContent = applyTemplate(picked.template.content, cleanId, today);
    fs.writeFileSync(filePath, finalContent, 'utf8');
    syncIndexAfterWrite(filePath);
    validateAll(getIndex);

    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    positionCursorOnFirstEmptyField(editor, doc);

    vscode.window.showInformationMessage(`Yamlink: Created "${cleanId}" from template "${picked.label}"`);
}

async function handleAddMissingTemplateFields() {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
        vscode.window.showErrorMessage('Yamlink: No active editor.');
        return;
    }

    const root = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
    if (!root) return;

    const text = document.getText();
    const typeMatch = text.match(/^\s*type:\s*(.+)$/m);
    const noteType = typeMatch ? typeMatch[1].trim().toLowerCase() : null;
    if (!noteType) {
        vscode.window.showInformationMessage('Yamlink: This note has no type: field.');
        return;
    }

    const template = getTemplateForType(root, noteType);
    if (!template || !template.fields.length) {
        vscode.window.showInformationMessage(`Yamlink: No template found for type "${noteType}".`);
        return;
    }

    const existingKeys = new Set(
        [...text.matchAll(/^\s*([\w-]+):/gm)].map(m => m[1].toLowerCase())
    );
    const missingFields = template.fields.filter(f => !existingKeys.has(f.toLowerCase()));
    if (!missingFields.length) {
        vscode.window.showInformationMessage(`Yamlink: "${noteType}" note already has all template fields.`);
        return;
    }

    // Find closing --- of frontmatter
    const lines = text.split('\n');
    let closingDash = -1;
    let inFm = false;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].replace(/\r$/, '').trim();
        if (!inFm && trimmed === '---') { inFm = true; continue; }
        if (inFm && trimmed === '---') { closingDash = i; break; }
    }
    if (closingDash === -1) {
        vscode.window.showErrorMessage('Yamlink: Could not find frontmatter block to insert into.');
        return;
    }

    const insertion = missingFields.map(f => `${f}:`).join('\n') + '\n';
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(closingDash, 0), insertion);
    await vscode.workspace.applyEdit(edit);
    await document.save();
    const noteId = canonicalizeId(
        String(parseFrontmatterDocument(document.getText())?.data?.id || '').trim()
    ) || null;
    if (noteId) {
        emitOutcomeEvent({
            type: 'template_applied',
            noteId,
            field: 'type',
            newValue: noteType,
            source: 'vscode',
            cause: 'smart_template_schema_apply',
            meta: {
                mode: 'fill_missing_fields',
                missingCount: missingFields.length
            }
        });
        emitOutcomeEvent({
            type: 'template_fields_filled',
            noteId,
            field: 'frontmatter',
            newValue: missingFields.join(', '),
            source: 'vscode',
            cause: 'smart_template_fill_missing_fields',
            meta: {
                noteType,
                fields: missingFields,
                count: missingFields.length
            }
        });
    }
    await focusFirstEmptyFieldAndSuggest(vscode.window.activeTextEditor, document);

    vscode.window.showInformationMessage(
        `Yamlink: Added ${missingFields.length} missing field${missingFields.length === 1 ? '' : 's'}: ${missingFields.join(', ')}`
    );
}

async function handleSaveAsTemplate() {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
        vscode.window.showErrorMessage('Yamlink: No active editor.');
        return;
    }

    const root = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
    if (!root) {
        vscode.window.showErrorMessage('Yamlink: No workspace folder open.');
        return;
    }

    const text = document.getText();
    const parsed = parseFrontmatterDocument(text);
    const noteType = String(parsed?.data?.type || '').trim().toLowerCase();
    if (!noteType) {
        vscode.window.showInformationMessage('Yamlink: This note has no type: field — templates are keyed by type.');
        return;
    }

    const existing = getTemplateForType(root, noteType);
    if (existing) {
        const choice = await vscode.window.showWarningMessage(
            `Yamlink: A template for type "${noteType}" already exists. Overwrite it?`,
            { modal: true },
            'Overwrite'
        );
        if (choice !== 'Overwrite') return;
    }

    const templateContent = buildTemplateFromNote(text);
    let templatePath;
    try {
        templatePath = saveTemplateFile(root, noteType, templateContent, { force: true });
    } catch (error) {
        vscode.window.showErrorMessage('Yamlink: Failed to save template — ' + error.message);
        return;
    }

    const noteId = canonicalizeId(String(parsed?.data?.id || '').trim()) || null;
    if (noteId) {
        emitOutcomeEvent({
            type: 'template_saved',
            noteId,
            field: 'type',
            newValue: noteType,
            source: 'vscode',
            cause: 'save_as_template'
        });
    }

    const action = await vscode.window.showInformationMessage(
        `Yamlink: Saved template for type "${noteType}".`,
        'Open template'
    );
    if (action === 'Open template') {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(templatePath));
        await vscode.window.showTextDocument(doc, { preview: false });
    }
}

module.exports = {
    handleNewNodeFromTemplate,
    handleAddMissingTemplateFields,
    handleSaveAsTemplate
};
