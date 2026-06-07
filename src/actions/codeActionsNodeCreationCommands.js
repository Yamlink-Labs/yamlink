const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { validateAll } = require('../diagnostics/diagnostics');
const { buildIndex, updateSingleFile, invalidateFileCache } = require('../core/index');
const { canonicalizeId } = require('../core/id');
const { getFieldsCache } = require('../core/indexService');
const { getPrimaryWorkspaceRoot, getWorkspaceRootForFile } = require('../core/workspace');
const { writeFieldValue } = require('../core/writeField');
const { parseFrontmatterDocument } = require('../core/frontmatter');
const { getSchema, getSchemaTargets } = require('../registries/schemaRegistry');
const {
    TEMPLATES_DIR,
    loadTemplates
} = require('../core/templateRegistry');

function getCommonVaultFields(type, fieldsCache) {
    const fieldCounts = new Map();
    let noteCount = 0;
    for (const fields of fieldsCache.values()) {
        if (String(fields.type || '').toLowerCase() !== type.toLowerCase()) continue;
        noteCount++;
        for (const key of Object.keys(fields)) {
            if (key === 'type' || key === 'id' || key === 'created') continue;
            fieldCounts.set(key, (fieldCounts.get(key) || 0) + 1);
        }
    }
    if (noteCount === 0) return [];
    const threshold = Math.max(1, noteCount * 0.4);
    return [...fieldCounts.entries()]
        .filter(([, count]) => count >= threshold)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k]) => k);
}

function buildSmartFrontmatter(id, type, fieldsCache, today, reverseField, reverseId) {
    const candidates = [];
    for (const fields of fieldsCache.values()) {
        if (String(fields.type || '').toLowerCase() === type.toLowerCase()) {
            candidates.push(fields);
        }
    }

    if (candidates.length === 0) {
        const typeField = `type: ${type}\n`;
        const reverseBlock = reverseField && reverseId ? `${reverseField}: [[${reverseId}]]\n` : '';
        return `---\nid: ${id}\n${typeField}${reverseBlock}created: ${today}\n---\n\n`;
    }

    const freq = new Map();
    const SKIP = new Set(['id', 'type', 'created', 'updated', 'modified', 'indexed']);
    for (const fields of candidates) {
        for (const key of Object.keys(fields)) {
            if (SKIP.has(key)) continue;
            freq.set(key, (freq.get(key) || 0) + 1);
        }
    }

    const threshold = Math.max(1, Math.ceil(candidates.length * 0.5));
    const commonFields = [...freq.entries()]
        .filter(([, count]) => count >= threshold)
        .sort((a, b) => b[1] - a[1])
        .map(([key]) => key);

    let fm = `---\nid: ${id}\ntype: ${type}\n`;
    for (const field of commonFields) {
        if (reverseField && field === reverseField && reverseId) {
            fm += `${field}: [[${reverseId}]]\n`;
        } else {
            fm += `${field}:\n`;
        }
    }
    if (reverseField && reverseId && !commonFields.includes(reverseField)) {
        fm += `${reverseField}: [[${reverseId}]]\n`;
    }
    fm += `created: ${today}\n---\n\n`;
    return fm;
}

function buildSchemaFrontmatter(id, type, schemaFields, today, reverseField, reverseId) {
    const entries = Object.entries(schemaFields);
    const required = entries.filter(([, def]) => def.required);
    const optional = entries.filter(([, def]) => !def.required);

    let fm = `---\nid: ${id}\ntype: ${type}\n`;
    for (const [fieldName, fieldDef] of [...required, ...optional]) {
        if (reverseField && fieldName === reverseField && reverseId) {
            fm += `${fieldName}: [[${reverseId}]]\n`;
        } else if (fieldDef.type === 'relation') {
            fm += `${fieldName}: [[]]\n`;
        } else {
            fm += `${fieldName}:\n`;
        }
    }
    fm += `created: ${today}\n---\n\n`;
    return fm;
}

function positionCursorOnFirstEmptyField(editor, document) {
    const lines = document.getText().split('\n');
    let inFm = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i === 0 && line.trim() === '---') { inFm = true; continue; }
        if (inFm && line.trim() === '---') break;
        if (!inFm) break;
        const relMatch = line.match(/^(\s*[\w-]+:\s*)\[\[\]\]/);
        if (relMatch) {
            const col = relMatch[1].length + 2;
            const pos = new vscode.Position(i, col);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos));
            return;
        }
        const emptyMatch = line.match(/^(\s*[\w-]+:)\s*$/);
        if (emptyMatch) {
            const col = emptyMatch[1].length + 1;
            const pos = new vscode.Position(i, col);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos));
            return;
        }
    }
}


function applyTemplate(content, newId, today) {
    let result = content;

    if (/^\s*id:\s*$/m.test(result)) {
        result = result.replace(/^(\s*id:)\s*$/m, `$1 ${newId}`);
    } else if (!/^\s*id:\s*.+/m.test(result)) {
        result = result.replace(/^(---\s*\n)/, `$1id: ${newId}\n`);
    }

    if (/^\s*created:\s*$/m.test(result)) {
        result = result.replace(/^(\s*created:)\s*$/m, `$1 ${today}`);
    }

    if (/^\s*date:\s*$/m.test(result)) {
        result = result.replace(/^(\s*date:)\s*$/m, `$1 ${today}`);
    }

    return result;
}

function buildSuggestedRelationNodeId(targetType, sourceId, fieldName) {
    const source = canonicalizeId(String(sourceId || '').trim()) || 'note';
    const target = canonicalizeId(String(targetType || fieldName || 'related').trim()) || 'related';
    if (source && target) return `${source}-${target}`;
    return `new-${target}`;
}

function buildStarterTemplateContent(type, commonFields) {
    const skip = new Set(['id', 'type', 'created', 'updated', 'modified']);
    const lines = ['---', 'id:', `type: ${type}`];
    for (const field of commonFields) {
        if (skip.has(field)) continue;
        lines.push(`${field}: `);
    }
    lines.push('created:', '---', '', '');
    return lines.join('\n');
}

function inferReverseRelationField(targetType, sourceType, sourceId, fieldsCache) {
    const normalizedSourceType = String(sourceType || '').trim().toLowerCase();
    if (!normalizedSourceType) return null;

    for (const fields of fieldsCache.values()) {
        const noteType = String(fields?.type || '').trim().toLowerCase();
        if (noteType !== String(targetType || '').trim().toLowerCase()) continue;
        if (Object.prototype.hasOwnProperty.call(fields, normalizedSourceType)) return normalizedSourceType;
        if (Object.prototype.hasOwnProperty.call(fields, `${normalizedSourceType}s`)) return `${normalizedSourceType}s`;
    }

    if (sourceId && normalizedSourceType) return normalizedSourceType;
    return null;
}

function mergeRelationFieldValue(existingValue, targetId) {
    const nextLink = `[[${targetId}]]`;
    const current = String(existingValue || '').trim();
    if (!current) return nextLink;
    if (current.includes(nextLink)) return current;
    return `${current}, ${nextLink}`;
}

function readExistingFieldValue(filePath, fieldName) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed = parseFrontmatterDocument(content);
        if (!parsed?.hasFrontmatter) return '';
        return parsed.data?.[fieldName] ?? '';
    } catch (error) {
        return '';
    }
}

function syncIndexAfterWrite(filePath) {
    if (!filePath) return;
    invalidateFileCache(filePath);
    const result = updateSingleFile(filePath, { force: true, workspaceFolders: vscode.workspace.workspaceFolders });
    if (result.needsFull && vscode.workspace.workspaceFolders) {
        buildIndex(vscode.workspace.workspaceFolders);
    }
}

// Cache the last non-empty editor selection so commands can read it after any
// dialog (QuickPick, InputBox, command palette) steals editor focus.
let _lastNonEmptySelection = null;

function registerNodeCreationCommands(context, getIndex, getTypes) {
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            const sel = e.selections[0];
            if (sel && !sel.isEmpty) {
                _lastNonEmptySelection = { document: e.textEditor.document, selection: sel };
            }
        })
    );
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            _lastNonEmptySelection = null;
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.createNote', async (id, preselectedType, sourceFilePath, sourceId, sourceType, interactive = false) => {
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
            const reverseField = inferReverseRelationField(chosenType, sourceType, sourceId, getFieldsCache());

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
            syncIndexAfterWrite(filePath);
            validateAll(getIndex);

            const doc = await vscode.workspace.openTextDocument(filePath);
            const editor = await vscode.window.showTextDocument(doc, { preview: false });
            positionCursorOnFirstEmptyField(editor, doc);

            vscode.window.showInformationMessage(
                `Yamlink: Created node "${id}"${chosenType ? ` (${chosenType})` : ''}`
            );

            return {
                id,
                filePath,
                type: chosenType || null
            };
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.createRelatedNote', async (options = {}) => {
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
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.newNodeFromTemplate', async () => {
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
        })
    );

    // yamlink.newNote — unified "quick new note" entry point.
    // Takes a human title, derives the ID, picks the best scaffold source
    // (template → schema → smart frontmatter from existing notes).
    // yamlink.newNote — unified "quick new note" entry point.
    // Accepts optional prefillTitle (string) passed by newNoteFromSelection so the
    // selection is captured before any dialog steals focus. Returns the created
    // note's canonical ID on success, or null if the user cancelled.
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.newNote', async (prefillTitle) => {
            // Use caller-supplied text first; fall back to live selection or cached selection.
            const selectedText = (typeof prefillTitle === 'string' && prefillTitle.trim())
                ? prefillTitle.trim()
                : (() => {
                    const editor = vscode.window.activeTextEditor;
                    if (editor && editor.selection && !editor.selection.isEmpty) {
                        return editor.document.getText(editor.selection).trim();
                    }
                    if (_lastNonEmptySelection) {
                        return _lastNonEmptySelection.document.getText(_lastNonEmptySelection.selection).trim();
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
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.newNoteFromSelection', async () => {
            // Capture selection before any dialog opens — QuickPick/InputBox steal editor focus.
            const editor = vscode.window.activeTextEditor;
            const liveSel = (editor && !editor.selection.isEmpty) ? editor.selection : null;
            const activeSelection = liveSel
                ? { uri: editor.document.uri, range: liveSel, document: editor.document }
                : (_lastNonEmptySelection
                    ? { uri: _lastNonEmptySelection.document.uri, range: _lastNonEmptySelection.selection, document: _lastNonEmptySelection.document }
                    : null);

            const selectedText = activeSelection
                ? activeSelection.document.getText(activeSelection.range).trim()
                : '';

            const createdId = await vscode.commands.executeCommand('yamlink.newNote', selectedText || undefined);

            // Replace the original selection with [[createdId]] so the thought becomes a linked note.
            if (createdId && activeSelection) {
                const edit = new vscode.WorkspaceEdit();
                edit.replace(activeSelection.uri, activeSelection.range, `[[${createdId}]]`);
                await vscode.workspace.applyEdit(edit);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.splitNoteBody', async () => {
            try {
                // Capture selection before dialogs steal focus.
                // Falls back to the last known non-empty selection so right-clicking
                // (which may clear the live selection) still works.
                const editor = vscode.window.activeTextEditor;
                const liveSel = (editor && !editor.selection.isEmpty) ? editor.selection : null;
                const activeSelection = liveSel
                    ? { uri: editor.document.uri, range: liveSel, document: editor.document }
                    : (_lastNonEmptySelection
                        ? { uri: _lastNonEmptySelection.document.uri, range: _lastNonEmptySelection.selection, document: _lastNonEmptySelection.document }
                        : null);

                if (!activeSelection) {
                    vscode.window.showInformationMessage('Yamlink: Select some text in the note body first.');
                    return;
                }

                const bodyContent = activeSelection.document.getText(activeSelection.range).trim();
                if (!bodyContent) {
                    vscode.window.showInformationMessage('Yamlink: Selection is empty — select some body text first.');
                    return;
                }

                // Derive title from first heading or first non-blank line
                const headingMatch = bodyContent.match(/^#{1,6}\s+(.+)/m);
                const firstLine = bodyContent.split('\n').find(l => l.trim());
                const derivedTitle = headingMatch
                    ? headingMatch[1].trim()
                    : (firstLine || '').replace(/^#+\s*/, '').replace(/\*+/g, '').trim().slice(0, 80);

                const title = await vscode.window.showInputBox({
                    prompt: 'Title for the extracted note',
                    value: derivedTitle,
                    placeHolder: 'Note title',
                    validateInput: v => (v && v.trim()) ? null : 'Title cannot be empty'
                });
                if (!title) return;

                const cleanId = canonicalizeId(title);
                if (!cleanId) {
                    vscode.window.showErrorMessage('Yamlink: Could not generate a valid ID from that title.');
                    return;
                }

                const root = getWorkspaceRootForFile(vscode.workspace.workspaceFolders, activeSelection.uri.fsPath)
                    || getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
                if (!root) {
                    vscode.window.showErrorMessage('Yamlink: No workspace folder found. Make sure a folder is open.');
                    return;
                }

                const newFilePath = path.join(root, `${cleanId}.md`);
                if (fs.existsSync(newFilePath)) {
                    vscode.window.showErrorMessage(`Yamlink: A note with id "${cleanId}" already exists.`);
                    return;
                }

                // Get the source note's ID for the back-link
                const { getPathIndex } = require('../core/indexService');
                const sourceId = getPathIndex().get(activeSelection.uri.fsPath) || null;
                const today = new Date().toISOString().slice(0, 10);

                // Build frontmatter for the new note
                const frontmatterLines = ['---', `id: ${cleanId}`, `created: ${today}`];
                if (sourceId) frontmatterLines.push(`source: [[${sourceId}]]`);
                frontmatterLines.push('---', '');
                const newFileContent = frontmatterLines.join('\n') + bodyContent + '\n';

                // Write the new file
                fs.writeFileSync(newFilePath, newFileContent, 'utf8');

                // Replace the selection in the source note with ![[cleanId]]
                const edit = new vscode.WorkspaceEdit();
                edit.replace(activeSelection.uri, activeSelection.range, `![[${cleanId}]]`);
                const editApplied = await vscode.workspace.applyEdit(edit);
                if (!editApplied) {
                    vscode.window.showWarningMessage(`Yamlink: Created "${cleanId}" but could not replace the selection — replace manually with ![[${cleanId}]].`);
                }

                // Open the new note
                const newDoc = await vscode.workspace.openTextDocument(newFilePath);
                await vscode.window.showTextDocument(newDoc, { viewColumn: vscode.ViewColumn.One, preview: false });

                vscode.window.showInformationMessage(`Yamlink: Created "${cleanId}" from selection`);
            } catch (err) {
                vscode.window.showErrorMessage(`Yamlink: Extract selection failed — ${err && err.message ? err.message : String(err)}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.newNoteFromSchema', async () => {
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
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.addMissingTemplateFields', async () => {
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

            const { getTemplateForType } = require('../core/templateRegistry');
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

            vscode.window.showInformationMessage(
                `Yamlink: Added ${missingFields.length} missing field${missingFields.length === 1 ? '' : 's'}: ${missingFields.join(', ')}`
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.addFrontmatter', async (document, suggestedId) => {
            const today = new Date().toISOString().split('T')[0];
            const text = document.getText();
            const hasFrontmatter = /^\s*---/.test(text);
            const edit = new vscode.WorkspaceEdit();

            if (hasFrontmatter) {
                edit.insert(document.uri, new vscode.Position(1, 0), `id: ${suggestedId}\n`);
            } else {
                edit.insert(
                    document.uri,
                    new vscode.Position(0, 0),
                    `---\nid: ${suggestedId}\ncreated: ${today}\n---\n\n`
                );
            }

            await vscode.workspace.applyEdit(edit);
            await document.save();
            syncIndexAfterWrite(document.uri.fsPath);
            validateAll(getIndex);

            vscode.window.showInformationMessage(`Yamlink: "${suggestedId}" is now a Yamlink node`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.backfillCreatedDates', async () => {
            const fieldCache = getFieldsCache();
            const idIndex = getIndex();
            const missing = [];
            for (const [id, filePath] of idIndex.entries()) {
                const fields = fieldCache.get(id);
                if (!fields || fields.created) continue;
                missing.push({ id, filePath });
            }
            if (missing.length === 0) {
                vscode.window.showInformationMessage('Yamlink: All notes already have a created: date.');
                return;
            }
            const action = await vscode.window.showWarningMessage(
                `Yamlink: ${missing.length} note(s) have no created: date. Backfill from file system birthtime?`,
                {
                    modal: true,
                    detail: 'File system birthtime may not be reliable across git clones, syncs, or drive migrations. Use as a best-effort approximation only.'
                },
                'Backfill',
                'Cancel'
            );
            if (action !== 'Backfill') return;
            let written = 0;
            for (const { filePath } of missing) {
                try {
                    const stat = fs.statSync(filePath);
                    const dateMs = stat.birthtimeMs || stat.mtimeMs;
                    const dateIso = new Date(dateMs).toISOString().split('T')[0];
                    await writeFieldValue(filePath, 'created', dateIso);
                    syncIndexAfterWrite(filePath);
                    written++;
                } catch (e) { /* skip */ }
            }
            vscode.window.showInformationMessage(`Yamlink: Backfilled created: date on ${written} note(s).`);
            validateAll(getIndex);
        })
    );
}

/**
 * Register yamlink.openDailyNote — opens (or creates) today's journal note.
 * ID format: journal-YYYY-MM-DD. Uses _templates/journal.md if present.
 * Keybinding: Ctrl+Alt+J / Cmd+Alt+J (wired in package.json).
 *
 * @param {import('vscode').ExtensionContext} context
 */
function registerDailyNoteCommand(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.openDailyNote', async () => {
            const workspaceRoot = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
            if (!workspaceRoot) {
                vscode.window.showWarningMessage('Yamlink: No workspace open.');
                return;
            }

            const today = new Date();
            const dateIso = today.toISOString().split('T')[0]; // YYYY-MM-DD
            const noteId = `journal-${dateIso}`;
            const notePath = path.join(workspaceRoot, `${noteId}.md`);

            // If note already exists, just open it
            if (fs.existsSync(notePath)) {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(notePath));
                await vscode.window.showTextDocument(doc);
                return;
            }

            // Try journal template first
            const templates = loadTemplates(workspaceRoot);
            const template = templates.find(t => t.type === 'journal' || t.name === 'journal');
            let content;
            if (template) {
                const templateBody = template.content.replace(/^---[\s\S]*?---\s*/m, '');
                content = `---\nid: ${noteId}\ntype: journal\ndate: ${dateIso}\n---\n\n${templateBody}`;
            } else {
                content = `---\nid: ${noteId}\ntype: journal\ndate: ${dateIso}\n---\n\n`;
            }

            fs.writeFileSync(notePath, content, 'utf8');
            await updateSingleFile(notePath, { workspaceFolders: vscode.workspace.workspaceFolders });

            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(notePath));
            await vscode.window.showTextDocument(doc);
            // Move cursor to end of frontmatter so the user can start writing
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const lines = content.split('\n');
                const closingLine = lines.findIndex((line, i) => i > 0 && /^---/.test(line));
                if (closingLine >= 0) {
                    const pos = new vscode.Position(closingLine + 2, 0);
                    editor.selection = new vscode.Selection(pos, pos);
                }
            }
        })
    );
}

module.exports = {
    registerNodeCreationCommands,
    registerDailyNoteCommand
};
