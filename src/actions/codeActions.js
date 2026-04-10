const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { validateAll } = require('../diagnostics/diagnostics');
const { getTypes } = require('../registries/typeRegistry');
const { getSchema } = require('../registries/schemaRegistry');
const { isOrphan } = require('../core/graph');
const { computeSuggestionsForNode } = require('../engine/suggestions');
const { getFieldsCache, getPathIndex, updateSingleFile } = require('../core/index');
const { canonicalizeId } = require('../core/id');
const { getPrimaryWorkspaceRoot, getWorkspaceRootForFile } = require('../core/workspace');
const {
    appendQueryOptions,
    buildIncomingViewQuery,
    buildRefinedBlockText,
    buildTypeViewQuery,
    defaultSelectClauseForType,
    getAvailableFieldsForType,
    getSchemaBackedDefaultSortField,
    getViewBlockAtRange,
    getViewBlockByIndex,
    refineParsedQuery,
    revealDocumentAndRunViews,
    runGuidedViewBuilder,
    runViewRefinementBuilder,
    runViewRefinementByIndex
} = require('./viewBuilder');

const TEMPLATES_DIR = '_templates';

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
            return { label: path.basename(f, '.md'), filePath, content };
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

function buildLinkEdit(document, targetId) {
    const text = document.getText();
    const lines = text.split('\n');
    const edit = new vscode.WorkspaceEdit();

    let closingLine = -1;
    let inFm = false;
    for (let i = 0; i < lines.length; i++) {
        if (i === 0 && lines[i].trim() === '---') {
            inFm = true;
            continue;
        }
        if (inFm && lines[i].trim() === '---') {
            closingLine = i;
            break;
        }
    }

    if (closingLine === -1) return null;

    const relatedLineIdx = lines.findIndex((l, i) =>
        i > 0 && i < closingLine && /^\s*related:\s*/.test(l)
    );

    if (relatedLineIdx !== -1) {
        const existing = lines[relatedLineIdx];
        const inlineMatch = existing.match(/^\s*related:\s*(\[\[[^\]]+\]\])\s*$/);

        if (inlineMatch) {
            const oldVal = inlineMatch[1];
            const newContent = `related:\n  - ${oldVal}\n  - [[${targetId}]]`;
            const start = new vscode.Position(relatedLineIdx, 0);
            const end = new vscode.Position(relatedLineIdx, existing.length);
            edit.replace(document.uri, new vscode.Range(start, end), newContent);
        } else {
            const insertPos = new vscode.Position(closingLine, 0);
            edit.insert(document.uri, insertPos, `  - [[${targetId}]]\n`);
        }
    } else {
        const insertPos = new vscode.Position(closingLine, 0);
        edit.insert(document.uri, insertPos, `related: [[${targetId}]]\n`);
    }

    return edit;
}

async function buildStarterViewQuery(activeDocument) {
    const noteId = activeDocument ? (getPathIndex().get(activeDocument.uri.fsPath) ?? null) : null;
    const knownTypes = Array.from(getTypes()).sort();
    const items = [
        { label: 'Guided builder', query: '__guided__', detail: 'Step through a query builder with presets' },
        { label: 'All nodes', query: '!view *', detail: 'Browse the whole vault' },
        { label: 'Tasks', query: '!view tasks', detail: 'All task rows across the vault' },
        { label: 'Open tasks', query: '!view open-tasks', detail: 'Only incomplete tasks' },
        { label: 'Done tasks', query: '!view done-tasks', detail: 'Only completed tasks' },
        { label: 'Overdue tasks', query: '!view overdue', detail: 'Incomplete tasks with dates before today' },
        { label: 'Undated tasks', query: '!view undated-tasks', detail: 'Tasks that still need a date' },
        { label: 'Calendar', query: '!view calendar', detail: 'All dated tasks, sorted by date' },
        { label: 'Today', query: '!view today', detail: 'Tasks due today' },
        { label: 'Upcoming', query: '!view upcoming', detail: 'Tasks due in the next two weeks' }
    ];

    if (noteId) {
        items.push({
            label: 'Backlinks to this note',
            query: '!view incoming *',
            detail: `See what links to ${noteId}`
        });
    }

    for (const type of knownTypes) {
        items.push({
            label: `${type} table`,
            query: `!view ${type}${defaultSelectClauseForType(type)}`,
            detail: `Start with ${type} nodes`
        });
    }

    const picked = await vscode.window.showQuickPick(items, {
        title: 'Yamlink — Insert view block',
        placeHolder: 'Pick a starter query',
        matchOnDescription: true,
        matchOnDetail: true
    });
    if (!picked) return null;
    if (picked.query === '__guided__') return runGuidedViewBuilder(activeDocument, noteId, knownTypes);
    return picked.query;
}

function registerCodeActions(context, getIndex, buildIndex) {
    void buildIndex;

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            'markdown',
            {
                provideCodeActions(document, range, codeActionContext) {
                    const actions = [];
                    const seenIds = new Set();

                    const viewBlock = getViewBlockAtRange(document, range);
                    if (viewBlock && viewBlock.query) {
                        const runAction = new vscode.CodeAction(
                            'Yamlink: Run view block',
                            vscode.CodeActionKind.QuickFix
                        );
                        runAction.command = { command: 'yamlink.runViews', title: 'Run Views' };
                        actions.push(runAction);

                        const refineAction = new vscode.CodeAction(
                            'Yamlink: Refine this view',
                            vscode.CodeActionKind.RefactorRewrite
                        );
                        refineAction.command = {
                            command: 'yamlink.refineViewBlock',
                            title: 'Refine view block',
                            arguments: [document, range]
                        };
                        actions.push(refineAction);
                    }

                    for (const diagnostic of codeActionContext.diagnostics) {
                        if (diagnostic.source !== 'yamlink') continue;

                        const code = diagnostic.code?.value ?? diagnostic.code;

                        if (code === 'yamlink.missingId') {
                            const fileName = toKebabId(path.basename(document.uri.fsPath, '.md'));
                            const action = new vscode.CodeAction(
                                'Yamlink: Add id field to this file',
                                vscode.CodeActionKind.QuickFix
                            );
                            action.command = {
                                command: 'yamlink.addFrontmatter',
                                title: 'Add Frontmatter',
                                arguments: [document, fileName]
                            };
                            action.diagnostics = [diagnostic];
                            action.isPreferred = true;
                            actions.push(action);
                        }

                        if (code === 'yamlink.querySuggestion') {
                            const nodeId = getPathIndex().get(document.uri.fsPath) ?? null;
                            if (!nodeId) return actions;
                            const docText = document.getText();
                            const suggestions = computeSuggestionsForNode(nodeId, docText);
                            for (const suggestion of suggestions) {
                                const qAction = new vscode.CodeAction(
                                    `Yamlink: Add view — ${suggestion.title}`,
                                    vscode.CodeActionKind.QuickFix
                                );
                                qAction.command = {
                                    command: 'yamlink.insertViewBlock',
                                    title: 'Insert !view block',
                                    arguments: [document, suggestion.queryText, suggestion.sourceType, suggestion.field, nodeId]
                                };
                                qAction.diagnostics = [diagnostic];
                                qAction.isPreferred = true;
                                actions.push(qAction);
                            }
                        }

                        if (code === 'yamlink.brokenLink' || code === 'yamlink.brokenRelation') {
                            const rangeText = document.getText(diagnostic.range);
                            const match = rangeText.match(/\[\[([^\]]+)\]\]/);
                            if (!match || !match[1] || match[1].trim() === '') continue;

                            const id = match[1].trim();
                            if (seenIds.has(id)) continue;
                            seenIds.add(id);

                            const lineText = document.lineAt(diagnostic.range.start.line).text;
                            const fieldMatch = lineText.match(/^\s*([\w-]+)\s*:/);
                            const fieldName = fieldMatch ? fieldMatch[1].toLowerCase() : null;

                            const knownTypes = getTypes ? new Set(getTypes()) : new Set();
                            let resolvedType = null;
                            if (fieldName) {
                                for (const targetType of knownTypes) {
                                    const schema = getSchema ? getSchema(targetType) : null;
                                    if (schema && schema.fields[fieldName] && schema.fields[fieldName].type === 'relation' && schema.fields[fieldName].target) {
                                        resolvedType = schema.fields[fieldName].target;
                                        break;
                                    }
                                }
                                if (!resolvedType && knownTypes.has(fieldName)) resolvedType = fieldName;
                            }

                            const label = resolvedType
                                ? `Yamlink: Create ${resolvedType} "${id}"`
                                : `Yamlink: Create node "${id}"`;

                            const action = new vscode.CodeAction(label, vscode.CodeActionKind.QuickFix);
                            action.command = {
                                command: 'yamlink.createNote',
                                title: 'Create Node',
                                arguments: [id, resolvedType, document.uri.fsPath]
                            };
                            action.diagnostics = [diagnostic];
                            action.isPreferred = true;
                            actions.push(action);
                        }
                    }

                    const filePath = document.uri.fsPath;
                    const id = getPathIndex().get(filePath) ?? null;
                    if (id && isOrphan(id)) {
                        const text = document.getText();
                        const fmEnd = text.indexOf('\n---', 3);
                        const fmEndPos = fmEnd !== -1
                            ? document.positionAt(fmEnd + 4)
                            : new vscode.Position(0, 0);

                        if (range.start.isBefore(fmEndPos)) {
                            const action = new vscode.CodeAction(
                                'Yamlink: Link this node to another…',
                                vscode.CodeActionKind.QuickFix
                            );
                            action.command = {
                                command: 'yamlink.linkOrphan',
                                title: 'Link this node',
                                arguments: [document, id]
                            };
                            action.isPreferred = false;
                            actions.push(action);
                        }
                    }

                    return actions;
                }
            },
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Refactor] }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.insertViewBlock', async (document, queryText, sourceType) => {
            if (!document) {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== 'markdown') {
                    vscode.window.showInformationMessage('Yamlink: Open a Markdown note to insert a view block.');
                    return;
                }
                document = editor.document;
            }

            if (!queryText) {
                queryText = await buildStarterViewQuery(document);
                if (!queryText) return;
            }

            const text = document.getText();
            const lastLine = document.lineCount - 1;
            const lastChar = document.lineAt(lastLine).text.length;

            let prefix = '';
            if (!text.endsWith('\n\n')) {
                prefix = text.endsWith('\n') ? '\n' : '\n\n';
            }

            const selectClause = sourceType ? defaultSelectClauseForType(sourceType) : '';
            const headingLabel = sourceType
                ? `${capitalize(sourceType)}s`
                : queryText.replace(/^!view\s+/i, '').split('\n')[0].trim() || 'View';
            const insertion = `${prefix}## ${headingLabel}\n\n${queryText}${selectClause}\n`;

            const edit = new vscode.WorkspaceEdit();
            edit.insert(document.uri, new vscode.Position(lastLine, lastChar), insertion);

            await vscode.workspace.applyEdit(edit);
            await document.save();
            await revealDocumentAndRunViews(document);

            vscode.window.showInformationMessage(
                sourceType
                    ? `Yamlink: Inserted !view ${sourceType} block`
                    : 'Yamlink: Inserted view block'
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.queryBuilder', async () => {
            await vscode.commands.executeCommand('yamlink.insertViewBlock');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.refineViewBlock', async (document, range) => {
            if (!document) {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== 'markdown') {
                    vscode.window.showInformationMessage('Yamlink: Open a Markdown note to refine a view block.');
                    return;
                }
                document = editor.document;
                range = editor.selection;
            }

            const refined = await runViewRefinementBuilder(document, range);
            if (!refined || !refined.nextText) return;

            const edit = new vscode.WorkspaceEdit();
            const start = new vscode.Position(refined.start, 0);
            const endLine = Math.max(refined.end - 1, refined.start);
            const end = new vscode.Position(endLine, document.lineAt(endLine).text.length);
            edit.replace(document.uri, new vscode.Range(start, end), refined.nextText);

            await vscode.workspace.applyEdit(edit);
            await document.save();
            await revealDocumentAndRunViews(document);
            vscode.window.showInformationMessage('Yamlink: Refined view block');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.refineViewBlockAtIndex', async (document, queryIndex) => {
            if (!document) {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== 'markdown') {
                    vscode.window.showInformationMessage('Yamlink: Open a Markdown note to refine a view block.');
                    return;
                }
                document = editor.document;
            }

            const refined = await runViewRefinementByIndex(document, Number(queryIndex));
            if (!refined || !refined.nextText) return;

            const edit = new vscode.WorkspaceEdit();
            const start = new vscode.Position(refined.start, 0);
            const endLine = Math.max(refined.end - 1, refined.start);
            const end = new vscode.Position(endLine, document.lineAt(endLine).text.length);
            edit.replace(document.uri, new vscode.Range(start, end), refined.nextText);

            await vscode.workspace.applyEdit(edit);
            await document.save();
            await revealDocumentAndRunViews(document);
            vscode.window.showInformationMessage('Yamlink: Refined view block');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.linkOrphan', async (document, sourceId) => {
            const idIndex = getIndex();
            const fCache = getFieldsCache();
            const items = [...idIndex.entries()]
                .filter(([id]) => id !== sourceId)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([id]) => {
                    const fields = fCache.get(id);
                    return {
                        label: id,
                        description: fields && fields.type ? fields.type : ''
                    };
                });

            if (items.length === 0) {
                vscode.window.showInformationMessage('Yamlink: No other nodes in vault to link to.');
                return;
            }

            const picked = await vscode.window.showQuickPick(items, {
                title: `Link "${sourceId}" to…`,
                placeHolder: 'Pick a node to create a relation',
                matchOnDescription: true
            });
            if (!picked) return;

            const edit = buildLinkEdit(document, picked.label);
            if (!edit) {
                vscode.window.showErrorMessage('Yamlink: Could not find frontmatter to insert into.');
                return;
            }

            await vscode.workspace.applyEdit(edit);
            await document.save();

            vscode.window.showInformationMessage(`Yamlink: Linked "${sourceId}" → "${picked.label}"`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.createNote', async (id, preselectedType, sourceFilePath) => {
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
                const typeField = chosenType ? `type: ${chosenType}\n` : '';
                content = `---\nid: ${id}\n${typeField}created: ${today}\n---\n\n`;
            }

            fs.writeFileSync(filePath, content, 'utf8');
            updateSingleFile(filePath);
            validateAll(getIndex);

            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc, { preview: false });

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
                    description: path.relative(root, t.filePath),
                    template: t
                })),
                { title: 'New Node from Template', placeHolder: 'Select a template' }
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
            await vscode.window.showTextDocument(doc, { preview: false });

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

function toKebabId(str) {
    return canonicalizeId(str);
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = {
    registerCodeActions,
    buildTypeViewQuery,
    buildIncomingViewQuery,
    appendQueryOptions,
    getAvailableFieldsForType,
    getSchemaBackedDefaultSortField,
    runGuidedViewBuilder,
    refineParsedQuery,
    buildRefinedBlockText,
    revealDocumentAndRunViews,
    runViewRefinementBuilder,
    getViewBlockByIndex,
    runViewRefinementByIndex
};
