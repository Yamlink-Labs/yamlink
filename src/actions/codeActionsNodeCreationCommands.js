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

const TEMPLATES_DIR = '_templates';

function extractTemplateType(content) {
    const match = content.match(/^\s*type:\s*(.+)$/m);
    return match ? match[1].trim() : '';
}

function extractTemplateFields(content) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return [];
    return fmMatch[1].split('\n')
        .map(line => line.match(/^\s*([\w-]+):/)?.[1])
        .filter(Boolean)
        .filter(f => f !== 'id' && f !== 'type' && f !== 'created');
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

function loadTemplates(workspaceRoot) {
    const templatesPath = path.join(workspaceRoot, TEMPLATES_DIR);
    if (!fs.existsSync(templatesPath)) return [];

    let files;
    try {
        files = fs.readdirSync(templatesPath);
    } catch (e) {
        console.error('Yamlink — Cannot read _templates directory:', e.message);
        return [];
    }

    return files
        .filter(f => f.endsWith('.md'))
        .sort()
        .map(f => {
            const filePath = path.join(templatesPath, f);
            let content = '';
            try {
                content = fs.readFileSync(filePath, 'utf8');
            } catch (e) {
                console.error(`Yamlink — Cannot read template "${f}":`, e.message);
            }
            const type = extractTemplateType(content);
            const fields = extractTemplateFields(content);
            return { label: path.basename(f, '.md'), filePath, content, type, fields };
        })
        .filter(t => t.content.length > 0);
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

function registerNodeCreationCommands(context, getIndex, getTypes) {
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.createNote', async (id, preselectedType, sourceFilePath, sourceId, sourceType) => {
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
            const templatePath = chosenType
                ? path.join(root, '_templates', chosenType + '.md')
                : null;
            if (templatePath && fs.existsSync(templatePath)) {
                try {
                    const raw = fs.readFileSync(templatePath, 'utf8');
                    content = applyTemplate(raw, id, today);
                } catch (e) {
                    content = null;
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
                    label: t.label,
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
}

module.exports = {
    registerNodeCreationCommands
};
