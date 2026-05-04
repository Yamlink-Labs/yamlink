const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { validateAll } = require('../diagnostics/diagnostics');
const { updateSingleFile } = require('../core/index');
const { canonicalizeId } = require('../core/id');
const { getFieldsCache } = require('../core/indexService');
const { getPrimaryWorkspaceRoot, getWorkspaceRootForFile } = require('../core/workspace');

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

    return result;
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
                return;
            }

            const today = new Date().toISOString().split('T')[0];
            let content;
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
            if (!content) {
                if (chosenType) {
                    content = buildSmartFrontmatter(id, chosenType, getFieldsCache(), today, sourceType || null, sourceId || null);
                } else {
                    content = `---\nid: ${id}\ncreated: ${today}\n---\n\n`;
                }
            }

            fs.writeFileSync(filePath, content, 'utf8');
            updateSingleFile(filePath);
            validateAll(getIndex);

            const doc = await vscode.workspace.openTextDocument(filePath);
            const editor = await vscode.window.showTextDocument(doc, { preview: false });
            positionCursorOnFirstEmptyField(editor, doc);

            vscode.window.showInformationMessage(
                `Yamlink: Created node "${id}"${chosenType ? ` (${chosenType})` : ''}`
            );
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
            updateSingleFile(filePath);
            validateAll(getIndex);

            const doc = await vscode.workspace.openTextDocument(filePath);
            const editor = await vscode.window.showTextDocument(doc, { preview: false });
            positionCursorOnFirstEmptyField(editor, doc);

            vscode.window.showInformationMessage(`Yamlink: Created "${cleanId}" from template "${picked.label}"`);
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
            updateSingleFile(document.uri.fsPath);
            validateAll(getIndex);

            vscode.window.showInformationMessage(`Yamlink: "${suggestedId}" is now a Yamlink node`);
        })
    );
}

module.exports = {
    registerNodeCreationCommands
};
