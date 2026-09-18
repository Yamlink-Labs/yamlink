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
    getTemplatesForType,
    buildTemplateFromNote,
    saveTemplateFile
} = require('../core/templateRegistry');
const {
    positionCursorOnFirstEmptyField,
    focusFirstEmptyFieldAndSuggest,
    applyTemplate,
    syncIndexAfterWrite
} = require('./nodeCreationHelpers');
const { buildAdaptiveFrontmatterContext } = require('../intelligence/completionAdaptiveHelpers');
const { getSchema } = require('../registries/schemaRegistry');
const { getIndex } = require('../core/indexService');

const TEMPLATE_FIELD_INSERT_CAP = 6;

/**
 * Pure matching logic, given an already-built opportunity model (see
 * buildFrontmatterOpportunityModel in frontmatterIntelligence.js — the same
 * engine behind lightbulb suggestions and completion). For each missing
 * field, only ever uses relationInsertText (a real, already-confidence-gated
 * wikilink target) — never the placeholder `field: [[` shape a relational
 * field gets when no target is confident enough, since inserting that
 * unfinished would be worse than leaving the field blank.
 * @param {{ likelyGaps?: object[], likelyFields?: object[] }|null} opportunities
 * @param {string[]} missingFields
 * @returns {{ insertLines: string[], smartFilledFields: string[] }}
 */
function selectSmartFieldInsertions(opportunities, missingFields) {
    const smartValueByField = new Map();
    if (opportunities) {
        // likelyGaps first — these are specifically "field missing on this
        // note but present on similar notes" suggestions, the closest match
        // to what "add missing template fields" means. likelyFields (fields
        // suggested regardless of whether they count as a structural gap)
        // fills in anything likelyGaps didn't cover.
        const candidates = [
            ...(opportunities.likelyGaps || []),
            ...(opportunities.likelyFields || [])
        ];
        for (const candidate of candidates) {
            const field = String(candidate?.field || '').trim().toLowerCase();
            if (!field || smartValueByField.has(field)) continue;
            if (candidate.relationInsertText) {
                smartValueByField.set(field, candidate.relationInsertText.replace(/\n$/, ''));
            }
        }
    }

    const smartFilledFields = [];
    const insertLines = missingFields.map((field) => {
        const smartLine = smartValueByField.get(field.toLowerCase());
        if (smartLine) {
            smartFilledFields.push(field);
            return smartLine;
        }
        return `${field}:`;
    });

    return { insertLines, smartFilledFields };
}

/**
 * @param {import('vscode').TextDocument} document
 * @param {string} noteType
 * @returns {Record<string, any>|null}
 */
function buildAdaptiveTemplateContext(document, noteType) {
    try {
        return buildAdaptiveFrontmatterContext(document, noteType, getIndex(), getSchema);
    } catch (_) {
        return null;
    }
}

function buildMissingFieldInsertion(document, noteType, missingFields, context = null) {
    const adaptiveContext = context || buildAdaptiveTemplateContext(document, noteType);
    return selectSmartFieldInsertions(adaptiveContext ? adaptiveContext.opportunities : null, missingFields);
}

function extractInsertTextFields(insertText) {
    return String(insertText || '').split(/\r?\n/)
        .map(line => line.match(/^\s*([\w-]+):/)?.[1])
        .filter(Boolean);
}

function findFrontmatterClosingLine(text) {
    const lines = String(text || '').split('\n');
    let inFm = false;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].replace(/\r$/, '').trim();
        if (!inFm && trimmed === '---') { inFm = true; continue; }
        if (inFm && trimmed === '---') return i;
    }
    return -1;
}

function pickFollowUpStarterAction(context, insertedFields, currentText) {
    const inserted = new Set((insertedFields || []).map(f => String(f || '').toLowerCase()));
    const existingKeys = new Set(
        [...String(currentText || '').matchAll(/^\s*([\w-]+):/gm)].map(m => m[1].toLowerCase())
    );
    for (const action of context?.guidance?.starterActions || []) {
        const fields = extractInsertTextFields(action?.insertText);
        if (!fields.length) continue;
        const touchesInserted = fields.some(field => inserted.has(field.toLowerCase()));
        const touchesExisting = fields.some(field => existingKeys.has(field.toLowerCase()));
        if (!touchesInserted && !touchesExisting) return action;
    }
    return null;
}

async function maybeShowTemplateFollowUpNudge(document, context, insertedFields) {
    const action = pickFollowUpStarterAction(context, insertedFields, document.getText());
    if (!action) return;

    const choice = await vscode.window.showInformationMessage(
        `Yamlink: Also suggested: ${action.label}`,
        'Insert'
    );
    if (choice !== 'Insert') return;

    const closingDash = findFrontmatterClosingLine(document.getText());
    if (closingDash === -1) return;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(closingDash, 0), String(action.insertText || '').replace(/\s*$/, '\n'));
    await vscode.workspace.applyEdit(edit);
    await document.save();
}

function normalizeTemplateFileName(value) {
    return String(value || '')
        .trim()
        .replace(/\.md$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

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

    const templates = getTemplatesForType(root, noteType);
    if (!templates.length) {
        vscode.window.showInformationMessage(`Yamlink: No template found for type "${noteType}".`);
        return;
    }
    let template = templates[0];
    if (templates.length > 1) {
        const picked = await vscode.window.showQuickPick(
            templates.map(t => ({
                label: t.name,
                description: path.basename(t.filePath),
                detail: t.fields.length ? `Fields: ${t.fields.join(', ')}` : 'No template fields',
                template: t
            })),
            {
                title: `Which template for type "${noteType}"?`,
                placeHolder: 'Choose the template to compare against',
                matchOnDescription: true,
                matchOnDetail: true
            }
        );
        if (!picked) return;
        template = picked.template;
    }
    if (!template.fields.length) {
        vscode.window.showInformationMessage(`Yamlink: Template "${template.name}" has no fields to add.`);
        return;
    }

    const existingKeys = new Set(
        [...text.matchAll(/^\s*([\w-]+):/gm)].map(m => m[1].toLowerCase())
    );
    const allMissingFields = template.fields.filter(f => !existingKeys.has(f.toLowerCase()));
    if (!allMissingFields.length) {
        vscode.window.showInformationMessage(`Yamlink: "${noteType}" note already has all template fields.`);
        return;
    }
    const missingFields = allMissingFields.slice(0, TEMPLATE_FIELD_INSERT_CAP);

    const closingDash = findFrontmatterClosingLine(text);
    if (closingDash === -1) {
        vscode.window.showErrorMessage('Yamlink: Could not find frontmatter block to insert into.');
        return;
    }

    const adaptiveContext = buildAdaptiveTemplateContext(document, noteType);
    const { insertLines, smartFilledFields } = buildMissingFieldInsertion(document, noteType, missingFields, adaptiveContext);
    const insertion = insertLines.join('\n') + '\n';
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
                missingCount: missingFields.length,
                totalMissingCount: allMissingFields.length,
                smartFilledCount: smartFilledFields.length
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
                count: missingFields.length,
                totalMissingCount: allMissingFields.length,
                smartFilledFields
            }
        });
    }
    await focusFirstEmptyFieldAndSuggest(vscode.window.activeTextEditor, document);

    const smartNote = smartFilledFields.length
        ? ` (${smartFilledFields.length} pre-filled from vault patterns: ${smartFilledFields.join(', ')})`
        : '';
    const message = allMissingFields.length > TEMPLATE_FIELD_INSERT_CAP
        ? `Yamlink: Added 6 of ${allMissingFields.length} missing fields — run the command again to add the rest.`
        : `Yamlink: Added ${missingFields.length} missing field${missingFields.length === 1 ? '' : 's'}: ${missingFields.join(', ')}${smartNote}`;
    vscode.window.showInformationMessage(message);
    await maybeShowTemplateFollowUpNudge(document, adaptiveContext, missingFields);
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

    const templateContent = buildTemplateFromNote(text);
    const existingTemplates = getTemplatesForType(root, noteType);
    const existingNames = new Set(existingTemplates.map(t => t.name.toLowerCase()));
    let saveOptions = { force: true };
    if (existingTemplates.length > 0) {
        /** @type {Array<{ label: string, description?: string, templateName?: string, newTemplate?: boolean }>} */
        const saveChoices = [
            ...existingTemplates.map(t => ({
                label: `Overwrite ${path.basename(t.filePath)}`,
                description: t.fields.length ? `Fields: ${t.fields.join(', ')}` : '',
                templateName: t.name
            })),
            {
                label: 'Save as new template',
                description: 'Create another template for this same type',
                newTemplate: true
            }
        ];
        const picked = await vscode.window.showQuickPick(
            saveChoices,
            {
                title: `Template already exists for "${noteType}"`,
                placeHolder: 'Overwrite an existing template or save a new one'
            }
        );
        if (!picked) return;
        if (picked.newTemplate) {
            const templateName = await vscode.window.showInputBox({
                title: `New template name for "${noteType}"`,
                prompt: 'Template filename',
                placeHolder: `${noteType}-alternate`,
                validateInput: (value) => {
                    const normalized = normalizeTemplateFileName(value);
                    if (!normalized) return 'Template name cannot be empty';
                    if (existingNames.has(normalized)) return `A template named "${normalized}.md" already exists`;
                    return null;
                }
            });
            const normalized = normalizeTemplateFileName(templateName);
            if (!normalized) return;
            saveOptions = { force: false, templateName: normalized };
        } else {
            saveOptions = { force: true, templateName: picked.templateName };
        }
    }

    let templatePath;
    try {
        templatePath = saveTemplateFile(root, noteType, templateContent, saveOptions);
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
    handleSaveAsTemplate,
    selectSmartFieldInsertions
};
