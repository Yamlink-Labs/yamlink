'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { validateAll } = require('../diagnostics/diagnostics');
const { canonicalizeId } = require('../core/id');
const { getFieldsCache } = require('../core/indexService');
const { getPrimaryWorkspaceRoot, getWorkspaceRootForFile } = require('../core/workspace');
const { writeFieldValue } = require('../core/writeField');
const { parseFrontmatterDocument } = require('../core/frontmatter');
const { getSchema } = require('../registries/schemaRegistry');
const { TEMPLATES_DIR, loadTemplates } = require('../core/templateRegistry');
const {
    getCommonVaultFields,
    buildSmartFrontmatter,
    buildSchemaFrontmatter,
    positionCursorOnFirstEmptyField,
    applyTemplate,
    buildSuggestedRelationNodeId,
    buildStarterTemplateContent,
    inferReverseRelationField,
    mergeRelationFieldValue,
    readExistingFieldValue,
    syncIndexAfterWrite
} = require('./nodeCreationHelpers');

async function handleCreateNote(deps, id, preselectedType, sourceFilePath, sourceId, sourceType, interactive = false) {
    const { getIndex, getTypes } = deps;
    let chosenType = preselectedType || null;

    if (!id || typeof id !== 'string' || id.trim() === '') {
        id = await vscode.window.showInputBox({
            title: 'Create Yamlink Node',
            prompt: 'Node ID',
            placeHolder: 'my-node-id',
            validateInput: (v) => {
                if (!v || !v.trim()) return 'ID cannot be empty';
                if (!canonicalizeId(v)) return 'Enter text that can be turned into an ID';
                return null;
            }
        });
        if (!id) return;
        id = canonicalizeId(id);

        const knownTypes = [...getTypes()];
        const typeItems = [
            ...knownTypes.map(t => ({ label: t, description: 'existing type' })),
            { label: '$(plus) Enter new type…', description: '' }
        ];

        if (!chosenType && knownTypes.length > 0) {
            const pick = await vscode.window.showQuickPick(typeItems, {
                title: 'Node Type',
                placeHolder: 'Select a type — press Escape to skip'
            });
            if (pick) {
                if (pick.label.startsWith('$(plus)')) {
                    chosenType = await vscode.window.showInputBox({
                        title: 'New Type',
                        prompt: 'Enter a type name',
                        placeHolder: 'contact',
                        validateInput: (v) => {
                            if (v && !/^[a-zA-Z0-9_-]+$/.test(v.trim())) {
                                return 'Use only letters, numbers, hyphens, underscores';
                            }
                            return null;
                        }
                    });
                    if (chosenType) chosenType = chosenType.trim() || null;
                } else {
                    chosenType = pick.label;
                }
            }
        } else if (!chosenType) {
            const raw = await vscode.window.showInputBox({
                title: 'Node Type',
                prompt: 'Type (optional — press Escape to skip)',
                placeHolder: 'contact'
            });
            if (raw && raw.trim()) chosenType = raw.trim();
        }
    }

    if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage('Yamlink: No workspace folder open.');
        return;
    }

    const root = sourceFilePath
        ? getWorkspaceRootForFile(vscode.workspace.workspaceFolders, sourceFilePath)
        : getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
    if (!root) {
        vscode.window.showErrorMessage('Yamlink: No workspace folder open.');
        return;
    }

    const filePath = path.join(root, `${id}.md`);
    if (fs.existsSync(filePath)) {
        vscode.window.showWarningMessage(`Yamlink: "${id}.md" already exists.`);
        return null;
    }

    const today = new Date().toISOString().split('T')[0];
    let content;
    // Structural autocomplete, Behavior B: only auto-fill a reverse-link field
    // when there's real vault evidence for it ('observed' — an existing note
    // of this type already has a matching field). A 'guessed' inference has
    // zero corroborating evidence and must never be silently written —
    // instead it's offered as a visible, clickable follow-up below, once the
    // note actually exists to link into. "Honest silence over wrong guesses."
    const reverseInference = inferReverseRelationField(chosenType, sourceType, sourceId, getFieldsCache());
    const reverseField = reverseInference?.confidence === 'observed' ? reverseInference.field : null;

    const templatesDir      = path.join(root, TEMPLATES_DIR);
    const templatesDirExists = fs.existsSync(templatesDir);
    const templatePath       = chosenType ? path.join(templatesDir, `${chosenType}.md`) : null;

    if (!interactive) {
        // Non-interactive (programmatic/test): silently apply a filename-matched template
        const templateExists = templatePath && fs.existsSync(templatePath);
        if (templateExists) {
            try {
                const raw = fs.readFileSync(templatePath, 'utf8');
                content = applyTemplate(raw, id, today);
            } catch (_) { content = null; }
        }
    } else {
        // Interactive (quick-fix lightbulb): show the user the template options
        const templates = loadTemplates(root);

        if (!templatesDirExists) {
            // No _templates/ folder — offer to create it
            const pick = await vscode.window.showInformationMessage(
                `Yamlink: No _templates/ folder found. Create one to scaffold "${id}"?`,
                'Create _templates/',
                'Create without template'
            );
            if (pick === 'Create _templates/') {
                fs.mkdirSync(templatesDir, { recursive: true });
                const starterPath = templatePath || path.join(templatesDir, 'note.md');
                const starterContent = chosenType
                    ? buildStarterTemplateContent(chosenType, getCommonVaultFields(chosenType, getFieldsCache()))
                    : '---\nid:\ntype:\ncreated:\n---\n\n';
                fs.writeFileSync(starterPath, starterContent, 'utf8');
                const tDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(starterPath));
                await vscode.window.showTextDocument(tDoc, { preview: false });
                vscode.window.showInformationMessage(
                    `Yamlink: Template created. Edit it, then create "${id}" again.`
                );
                return;
            }
            // 'Create without template' — fall through

        } else if (templates.length === 0) {
            // _templates/ exists but is empty — offer to create a starter
            const pick = await vscode.window.showInformationMessage(
                `Yamlink: _templates/ is empty. Create a starter template${chosenType ? ` for "${chosenType}"` : ''}?`,
                'Create template',
                'Create without template'
            );
            if (pick === 'Create template') {
                const starterPath = templatePath || path.join(templatesDir, 'note.md');
                const starterContent = chosenType
                    ? buildStarterTemplateContent(chosenType, getCommonVaultFields(chosenType, getFieldsCache()))
                    : '---\nid:\ntype:\ncreated:\n---\n\n';
                fs.writeFileSync(starterPath, starterContent, 'utf8');
                const tDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(starterPath));
                await vscode.window.showTextDocument(tDoc, { preview: false });
                vscode.window.showInformationMessage(
                    `Yamlink: Template created. Edit it, then create "${id}" again.`
                );
                return;
            }
            // 'Create without template' — fall through

        } else {
            // Templates exist — show a QuickPick so user picks one
            const typeMatch = chosenType
                ? templates.find(t => t.type === chosenType.toLowerCase()) || null
                : null;
            const items = [
                ...templates.map(t => ({
                    label:       t.name,
                    description: t.type   ? `type: ${t.type}` : '(no type)',
                    detail:      t.fields.length > 0 ? `Fields: ${t.fields.join(', ')}` : undefined,
                    templateObj: t
                })),
                {
                    label:       '$(circle-slash) Create without template',
                    description: '',
                    templateObj: null
                }
            ];
            // Bubble the type-matched template to the top
            if (typeMatch) {
                const idx = items.findIndex(i => i.templateObj === typeMatch);
                if (idx > 0) items.unshift(...items.splice(idx, 1));
            }
            const chosen = await vscode.window.showQuickPick(items, {
                title:       `Create "${id}" — pick a template`,
                placeHolder: typeMatch
                    ? `Suggested: ${typeMatch.name} (matches type "${chosenType}")`
                    : 'Select a template, or create without one'
            });
            if (!chosen) return; // user cancelled
            if (chosen.templateObj) {
                try { content = applyTemplate(chosen.templateObj.content, id, today); }
                catch (_) { content = null; }
            }
            // null templateObj = create without template — fall through
        }
    }

    if (!content && chosenType) {
        const schema = getSchema(chosenType);
        if (schema && Object.keys(schema.fields).length > 0) {
            content = buildSchemaFrontmatter(id, chosenType, schema.fields, today, reverseField || null, sourceId || null);
        } else {
            content = buildSmartFrontmatter(id, chosenType, getFieldsCache(), today, reverseField || null, sourceId || null);
        }
    }
    if (!content) {
        content = `---\nid: ${id}\ncreated: ${today}\n---\n\n`;
    }

    fs.writeFileSync(filePath, content, 'utf8');
    let reverseFieldApplied = null;
    if (content && reverseField && sourceId && !content.includes(`[[${sourceId}]]`)) {
        await writeFieldValue(filePath, reverseField, `[[${sourceId}]]`);
        reverseFieldApplied = reverseField;
    }
    syncIndexAfterWrite(filePath);
    validateAll(getIndex);

    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    positionCursorOnFirstEmptyField(editor, doc);

    const createdMessage = `Yamlink: Created node "${id}"${chosenType ? ` (${chosenType})` : ''}`;
    if (reverseFieldApplied) {
        // Always visible, even in the confident case — never a silent write.
        vscode.window.showInformationMessage(
            `${createdMessage} — linked back to ${sourceId} via ${reverseFieldApplied}: (based on existing ${chosenType} notes)`
        );
    } else {
        vscode.window.showInformationMessage(createdMessage);
    }

    // A 'guessed' inference (no vault evidence) is never auto-written — but
    // still surfaced as a real, user-approved action, not silently dropped.
    if (!reverseFieldApplied && reverseInference?.confidence === 'guessed' && sourceId) {
        const guessedField = reverseInference.field;
        const pick = await vscode.window.showInformationMessage(
            `Yamlink: Link "${id}" back to ${sourceId} via ${guessedField}:? (no existing ${chosenType} note has this field yet, so this wasn't added automatically)`,
            `Add ${guessedField}: [[${sourceId}]]`
        );
        if (pick) {
            const existingValue = readExistingFieldValue(filePath, guessedField);
            const nextValue = mergeRelationFieldValue(existingValue, sourceId);
            await writeFieldValue(filePath, guessedField, nextValue);
            syncIndexAfterWrite(filePath);
        }
    }

    return {
        id,
        filePath,
        type: chosenType || null
    };
}

async function handleCreateRelatedNote(deps, options = {}) {
    const { getIndex } = deps;
    const targetType = String(options.targetType || options.fieldName || 'related').trim().toLowerCase();
    const sourceId = String(options.sourceId || '').trim() || null;
    const sourceFilePath = options.sourceFilePath || null;
    const sourceType = String(options.sourceType || '').trim().toLowerCase() || null;
    const relationField = String(options.fieldName || targetType || 'related').trim().toLowerCase();
    const suggestedId = buildSuggestedRelationNodeId(targetType, sourceId, relationField);

    const rawId = await vscode.window.showInputBox({
        title: `Create ${targetType} note`,
        prompt: sourceId
            ? `Create a ${targetType} note to link from ${sourceId}`
            : `Create a ${targetType} note`,
        value: suggestedId,
        placeHolder: suggestedId,
        validateInput: (v) => {
            if (!v || !v.trim()) return 'ID cannot be empty';
            if (!canonicalizeId(v)) return 'Enter text that can be turned into an ID';
            return null;
        }
    });
    if (!rawId) return;

    const cleanId = canonicalizeId(rawId);
    const created = await vscode.commands.executeCommand(
        'yamlink.createNote',
        cleanId,
        targetType,
        sourceFilePath,
        sourceId,
        sourceType
    );
    if (!created || !sourceFilePath || !relationField) return;

    const existingValue = readExistingFieldValue(sourceFilePath, relationField);
    const nextValue = mergeRelationFieldValue(existingValue, cleanId);
    await writeFieldValue(sourceFilePath, relationField, nextValue);
    syncIndexAfterWrite(sourceFilePath);
    validateAll(getIndex);
}

async function handleNewNote(deps, prefillTitle) {
    const { getIndex, getTypes, selectionRef } = deps;
    // Use caller-supplied text first; fall back to live selection or cached selection.
    const selectedText = (typeof prefillTitle === 'string' && prefillTitle.trim())
        ? prefillTitle.trim()
        : (() => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.selection && !editor.selection.isEmpty) {
                return editor.document.getText(editor.selection).trim();
            }
            if (selectionRef.current) {
                return selectionRef.current.document.getText(selectionRef.current.selection).trim();
            }
            return '';
        })();

    if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage('Yamlink: No workspace folder open.');
        return null;
    }
    const root = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
    if (!root) {
        vscode.window.showErrorMessage('Yamlink: No workspace folder open.');
        return null;
    }

    const templates = loadTemplates(root);
    const templateTypes = new Set(templates.filter(t => t.type).map(t => t.type));
    const knownTypes = [...getTypes()].sort();

    // Build type list: types with templates first, then others
    const typeItems = [
        ...templates
            .filter(t => t.type)
            .map(t => ({
                label: t.type,
                description: 'template',
                detail: t.fields.length > 0 ? t.fields.join(', ') : undefined
            })),
        ...knownTypes
            .filter(t => !templateTypes.has(t))
            .map(t => {
                const commonFields = getCommonVaultFields(t, getFieldsCache());
                return {
                    label: t,
                    description: 'from vault',
                    detail: commonFields.length > 0 ? commonFields.join(', ') : undefined
                };
            }),
        { label: '$(plus) New type…', description: '', detail: undefined }
    ];

    let chosenType = null;
    if (typeItems.length > 1) {
        const typePick = await vscode.window.showQuickPick(typeItems, {
            title: 'New Note — Pick a type',
            placeHolder: 'Select a type or press Escape to skip',
            matchOnDescription: true,
            matchOnDetail: true
        });
        if (typePick === undefined) return null;
        if (typePick && typePick.label.startsWith('$(plus)')) {
            chosenType = await vscode.window.showInputBox({
                title: 'New type name',
                placeHolder: 'contact',
                validateInput: v => (v && !/^[a-zA-Z0-9_-]+$/.test(v.trim()))
                    ? 'Letters, numbers, hyphens only' : null
            });
            if (chosenType) chosenType = chosenType.trim() || null;
        } else if (typePick) {
            chosenType = typePick.label;
        }
    }

    const title = await vscode.window.showInputBox({
        title: chosenType ? `New ${chosenType}` : 'New Note',
        prompt: 'Note title or name',
        placeHolder: chosenType ? `My ${chosenType} name` : 'My note title',
        value: selectedText || undefined,
        valueSelection: selectedText ? [0, selectedText.length] : undefined,
        validateInput: v => (!v || !v.trim()) ? 'Title cannot be empty' : null
    });
    if (!title) return null;

    const cleanId = canonicalizeId(title);
    if (!cleanId) {
        vscode.window.showErrorMessage('Yamlink: Could not derive an ID from that title.');
        return null;
    }

    const filePath = path.join(root, `${cleanId}.md`);
    if (fs.existsSync(filePath)) {
        vscode.window.showWarningMessage(`Yamlink: "${cleanId}.md" already exists.`);
        return null;
    }

    // L3: if the active document is a Yamlink note, offer to link the new note back
    let reverseField = null;
    let reverseId = null;
    const activeDoc = vscode.window.activeTextEditor?.document;
    if (activeDoc && activeDoc.languageId === 'markdown') {
        const parsedActive = parseFrontmatterDocument(activeDoc.getText());
        const currentId = parsedActive?.hasFrontmatter && parsedActive.data?.id
            ? String(parsedActive.data.id).trim().toLowerCase() : null;
        if (currentId && currentId !== cleanId) {
            const currentType = String(parsedActive.data?.type || '').trim().toLowerCase();
            const defaultField = currentType || 'source';
            const linkBack = await vscode.window.showQuickPick(
                [
                    { label: `$(link) Link to [[${currentId}]]`, description: 'Add a relation field in the new note' },
                    { label: '$(close) Skip', description: '' }
                ],
                { title: 'Link back to current note?', placeHolder: `Connect new note to ${currentId}` }
            );
            if (linkBack && !linkBack.label.startsWith('$(close)')) {
                const fieldInput = await vscode.window.showInputBox({
                    title: 'Relation field name',
                    prompt: `Which field on the new note links to [[${currentId}]]?`,
                    value: defaultField,
                    placeHolder: defaultField,
                    validateInput: v => (!v || !v.trim()) ? 'Field name cannot be empty' : null
                });
                if (fieldInput && fieldInput.trim()) {
                    reverseField = fieldInput.trim().toLowerCase();
                    reverseId = currentId;
                }
            }
        }
    }

    const today = new Date().toISOString().split('T')[0];
    let content;

    const template = chosenType
        ? templates.find(t => t.type === chosenType.toLowerCase()) || null
        : null;
    if (template) {
        content = applyTemplate(template.content, cleanId, today);
    } else if (chosenType) {
        const schema = getSchema(chosenType);
        if (schema && Object.keys(schema.fields).length > 0) {
            content = buildSchemaFrontmatter(cleanId, chosenType, schema.fields, today, reverseField, reverseId);
        } else {
            content = buildSmartFrontmatter(cleanId, chosenType, getFieldsCache(), today, reverseField, reverseId);
        }
    } else {
        const revBlock = reverseField && reverseId ? `${reverseField}: [[${reverseId}]]\n` : '';
        content = `---\nid: ${cleanId}\n${revBlock}created: ${today}\n---\n\n`;
    }

    fs.writeFileSync(filePath, content, 'utf8');
    syncIndexAfterWrite(filePath);
    validateAll(getIndex);

    // For template-based notes, write reverse link afterward since applyTemplate doesn't inject it
    if (template && reverseField && reverseId) {
        await writeFieldValue(filePath, reverseField, `[[${reverseId}]]`);
        syncIndexAfterWrite(filePath);
    }

    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    positionCursorOnFirstEmptyField(editor, doc);

    vscode.window.showInformationMessage(
        `Yamlink: Created "${cleanId}"${chosenType ? ` (${chosenType})` : ''}`
    );
    return cleanId;
}

module.exports = {
    handleCreateNote,
    handleCreateRelatedNote,
    handleNewNote
};
