const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { validateAll } = require('../diagnostics/diagnostics');
const { getTypes } = require('../registries/typeRegistry');
const { getSchema } = require('../registries/schemaRegistry');
const { isOrphan, getBacklinks } = require('../core/graph');
const { computeSuggestionsForNode, QUERY_SUGGESTION_THRESHOLD } = require('../engine/suggestions');
const { parseSingleViewBlock } = require('../engine/query');
const { getFieldsCache, getPathIndex, updateSingleFile } = require('../core/index');
const { canonicalizeId } = require('../core/id');
const { getPrimaryWorkspaceRoot, getWorkspaceRootForFile } = require('../core/workspace');

// ─────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────

const TEMPLATES_DIR = '_templates';


function loadTemplates(workspaceRoot) {
    const templatesPath = path.join(workspaceRoot, TEMPLATES_DIR);
    if (!fs.existsSync(templatesPath)) return [];

    let files;
    try { files = fs.readdirSync(templatesPath); }
    catch (e) {
        console.error('Yamlink — Cannot read _templates directory:', e.message);
        return [];
    }

    return files
        .filter(f => f.endsWith('.md'))
        .sort()
        .map(f => {
            const filePath = path.join(templatesPath, f);
            let content = '';
            try { content = fs.readFileSync(filePath, 'utf8'); }
            catch (e) { console.error(`Yamlink — Cannot read template "${f}":`, e.message); }
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

// ─────────────────────────────────────────────────────────────────
// insertRelationField
// ─────────────────────────────────────────────────────────────────
function buildLinkEdit(document, targetId) {
    const text  = document.getText();
    const lines = text.split('\n');
    const edit  = new vscode.WorkspaceEdit();

    let closingLine = -1;
    let inFm = false;
    for (let i = 0; i < lines.length; i++) {
        if (i === 0 && lines[i].trim() === '---') { inFm = true; continue; }
        if (inFm && lines[i].trim() === '---') { closingLine = i; break; }
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
            const newContent =
                `related:\n  - ${oldVal}\n  - [[${targetId}]]`;
            const start = new vscode.Position(relatedLineIdx, 0);
            const end   = new vscode.Position(relatedLineIdx, existing.length);
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


function getViewBlockAtRange(document, range) {
    const lines = document.getText().split('\n');
    let start = range.start.line;
    while (start >= 0) {
        const t = lines[start].trim();
        if (t.startsWith('!view ')) break;
        if (!t || (!/^(select|where|sort|limit|via)\b/i.test(t) && start !== range.start.line)) return null;
        start--;
    }
    if (start < 0 || !lines[start].trim().startsWith('!view ')) return null;
    const block = [lines[start]];
    let end = start + 1;
    while (end < lines.length) {
        const t = lines[end].trim();
        if (!t) break;
        if (t.startsWith('!view ')) break;
        if (/^(select|where|sort|limit|via)\b/i.test(t)) {
            block.push(lines[end]);
            end++;
        } else break;
    }
    return { start, end, block, query: parseSingleViewBlock(block) };
}

function defaultSelectClauseForType(type) {
    const schema = getSchema ? getSchema(type) : null;
    if (!schema || !schema.fields) return '';
    const schemaFields = Object.keys(schema.fields)
        .filter(f => f !== 'id' && f !== 'created' && f !== 'type')
        .slice(0, 5);
    return schemaFields.length > 0 ? `\nselect ${schemaFields.join(', ')}` : '';
}

function buildTypeViewQuery(type, selectMode = 'smart') {
    const head = type === '*' ? '!view *' : `!view ${type}`;
    if (type === '*' || selectMode === 'none') return head;
    if (selectMode === 'all') return `${head}\nselect *`;
    return `${head}${defaultSelectClauseForType(type)}`;
}

function buildIncomingViewQuery(sourceType, viaField) {
    let query = `!view incoming ${sourceType}`;
    if (viaField && viaField !== '*') query += `\nvia ${viaField}`;
    return query;
}

async function runGuidedViewBuilder(activeDocument, noteId, knownTypes) {
    const rootItems = [
        {
            label: 'Table of a type',
            description: 'Build a node table',
            value: 'table'
        },
        {
            label: 'Tasks and calendar',
            description: 'Pick a task preset',
            value: 'tasks'
        }
    ];

    if (noteId) {
        rootItems.splice(1, 0, {
            label: 'Backlinks to this note',
            description: `Build an incoming query for ${noteId}`,
            value: 'incoming'
        });
    }

    const root = await vscode.window.showQuickPick(rootItems, {
        title: 'Yamlink — Query Builder',
        placeHolder: 'Choose the kind of view you want to build'
    });
    if (!root) return null;

    if (root.value === 'tasks') {
        const taskPick = await vscode.window.showQuickPick([
            { label: 'All tasks', query: '!view tasks', description: 'Every task row across the vault' },
            { label: 'Calendar', query: '!view calendar', description: 'Every dated task and created-note event' },
            { label: 'Today', query: '!view today', description: 'Only today activity' },
            { label: 'Upcoming', query: '!view upcoming', description: 'Next two weeks of activity' }
        ], {
            title: 'Yamlink — Query Builder',
            placeHolder: 'Choose a task or calendar preset'
        });
        return taskPick ? taskPick.query : null;
    }

    if (root.value === 'incoming') {
        const typePick = await vscode.window.showQuickPick([
            { label: 'Any source type', value: '*' },
            ...knownTypes.map(type => ({ label: capitalize(type), description: type, value: type }))
        ], {
            title: 'Yamlink — Query Builder',
            placeHolder: 'Choose which kinds of nodes can link here'
        });
        if (!typePick) return null;

        const backlinkFields = Array.from(new Set(
            getBacklinks(noteId)
                .map(edge => String(edge.field || '').trim().toLowerCase())
                .filter(field => field && field !== 'body')
        )).sort();
        const fieldPick = await vscode.window.showQuickPick([
            { label: 'Any relation field', value: '*' },
            ...backlinkFields.map(field => ({ label: field, value: field }))
        ], {
            title: 'Yamlink — Query Builder',
            placeHolder: 'Optionally narrow to a specific relation field'
        });
        if (!fieldPick) return null;

        return buildIncomingViewQuery(typePick.value, fieldPick.value);
    }

    const typePick = await vscode.window.showQuickPick([
        { label: 'All nodes', value: '*', description: 'Browse the whole vault' },
        ...knownTypes.map(type => ({ label: `${capitalize(type)} table`, description: type, value: type }))
    ], {
        title: 'Yamlink — Query Builder',
        placeHolder: 'Choose which type to show'
    });
    if (!typePick) return null;

    const selectPick = await vscode.window.showQuickPick([
        { label: 'Smart default columns', value: 'smart', description: 'Use schema-backed starter columns when available' },
        { label: 'All available columns', value: 'all', description: 'Insert a wildcard select clause' },
        { label: 'No select clause', value: 'none', description: 'Keep the query minimal and let the table infer columns' }
    ], {
        title: 'Yamlink — Query Builder',
        placeHolder: 'Choose how much structure to prefill'
    });
    if (!selectPick) return null;

    return buildTypeViewQuery(typePick.value, selectPick.value);
}

async function buildStarterViewQuery(activeDocument) {
    const noteId = activeDocument ? (getPathIndex().get(activeDocument.uri.fsPath) ?? null) : null;
    const knownTypes = Array.from(getTypes()).sort();
    const items = [
        { label: 'Guided builder', query: '__guided__', detail: 'Step through a query builder with presets' },
        { label: 'All nodes', query: '!view *', detail: 'Browse the whole vault' },
        { label: 'Tasks', query: '!view tasks', detail: 'All task rows across the vault' },
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

// ─────────────────────────────────────────────────────────────────
// registerCodeActions
// ─────────────────────────────────────────────────────────────────
function registerCodeActions(context, getIndex, buildIndex) {
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
                    }

                    // ── Diagnostic-based actions ──────────────────────
                    for (const diagnostic of codeActionContext.diagnostics) {
                        if (diagnostic.source !== 'yamlink') continue;

                        const code = diagnostic.code?.value ?? diagnostic.code;

                        if (code === 'yamlink.missingId') {
                            const fileName = toKebabId(path.basename(document.uri.fsPath, '.md'));
                            const action   = new vscode.CodeAction(
                                `Yamlink: Add id field to this file`,
                                vscode.CodeActionKind.QuickFix
                            );
                            action.command = {
                                command:   'yamlink.addFrontmatter',
                                title:     'Add Frontmatter',
                                arguments: [document, fileName]
                            };
                            action.diagnostics = [diagnostic];
                            action.isPreferred = true;
                            actions.push(action);
                        }

                        if (code === 'yamlink.querySuggestion') {
                            // Use the shared suggestion engine — same logic as
                            // diagnostics.js, guaranteed to agree with it.
                            const nodeId  = getPathIndex().get(document.uri.fsPath) ?? null;
                            if (!nodeId) return actions;
                            const docText = document.getText();

                            if (nodeId) {
                                const suggestions = computeSuggestionsForNode(nodeId, docText);
                                for (const { field, sourceType, count, queryText } of suggestions) {
                                    const plural  = count === 1 ? sourceType : sourceType + 's';
                                    const qAction = new vscode.CodeAction(
                                        `Yamlink: Add view — ${count} ${plural} linked via "${field}"`,
                                        vscode.CodeActionKind.QuickFix
                                    );
                                    qAction.command = {
                                        command:   'yamlink.insertViewBlock',
                                        title:     'Insert !view block',
                                        arguments: [document, queryText, sourceType, field, nodeId]
                                    };
                                    qAction.diagnostics = [diagnostic];
                                    qAction.isPreferred = true;
                                    actions.push(qAction);
                                }
                            }
                        }

                        if (code === 'yamlink.brokenLink' ||
                            code === 'yamlink.brokenRelation') {

                            const rangeText = document.getText(diagnostic.range);
                            const match     = rangeText.match(/\[\[([^\]]+)\]\]/);
                            if (!match || !match[1] || match[1].trim() === '') continue;

                            const id = match[1].trim();
                            if (seenIds.has(id)) continue;
                            seenIds.add(id);

                            const lineText   = document.lineAt(diagnostic.range.start.line).text;
                            const fieldMatch = lineText.match(/^\s*([\w-]+)\s*:/);
                            const fieldName  = fieldMatch ? fieldMatch[1].toLowerCase() : null;

                            const knownTypes = getTypes ? new Set(getTypes()) : new Set();

                            let resolvedType = null;
                            if (fieldName) {
                                for (const targetType of (knownTypes || [])) {
                                    const schema = getSchema ? getSchema(targetType) : null;
                                    if (schema && schema.fields[fieldName] && schema.fields[fieldName].type === 'relation' && schema.fields[fieldName].target) {
                                        resolvedType = schema.fields[fieldName].target;
                                        break;
                                    }
                                }
                                if (!resolvedType && knownTypes.has(fieldName)) {
                                    resolvedType = fieldName;
                                }
                            }

                            const label = resolvedType
                                ? `Yamlink: Create ${resolvedType} "${id}"`
                                : `Yamlink: Create node "${id}"`;

                            const action = new vscode.CodeAction(label, vscode.CodeActionKind.QuickFix);
                            action.command = {
                                command:   'yamlink.createNote',
                                title:     'Create Node',
                                arguments: [id, resolvedType, document.uri.fsPath]
                            };
                            action.diagnostics = [diagnostic];
                            action.isPreferred = true;
                            actions.push(action);
                        }
                    }

                    // ── Orphan: Link this node ────────────────────────
                    const filePath = document.uri.fsPath;
                    const idIndex  = getIndex();
                    const id       = getPathIndex().get(filePath) ?? null;

                    if (id && isOrphan(id)) {
                        const text     = document.getText();
                        const fmEnd    = text.indexOf('\n---', 3);
                        const fmEndPos = fmEnd !== -1
                            ? document.positionAt(fmEnd + 4)
                            : new vscode.Position(0, 0);

                        if (range.start.isBefore(fmEndPos)) {
                            const action = new vscode.CodeAction(
                                `Yamlink: Link this node to another…`,
                                vscode.CodeActionKind.QuickFix
                            );
                            action.command = {
                                command:   'yamlink.linkOrphan',
                                title:     'Link this node',
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

    // ── yamlink.insertViewBlock ──────────────────────────────────────
    //
    // Inserts a !view block at the end of the document.
    // Called from the query suggestion code action.
    // Appends with a separator comment so it's clearly a generated view,
    // not body prose.
    //
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'yamlink.insertViewBlock',
            async (document, queryText, sourceType, field, nodeId) => {
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

                const text     = document.getText();
                const lastLine = document.lineCount - 1;
                const lastChar = document.lineAt(lastLine).text.length;

                // Ensure clean double-newline separation before the block
                let prefix = '';
                if (!text.endsWith('\n\n')) {
                    prefix = text.endsWith('\n') ? '\n' : '\n\n';
                }

                // Build the full insertion:
                // A markdown heading derived from the type + separator, then the query.
                // select is pre-filled from schema if available, otherwise omitted.
                const selectClause = sourceType ? defaultSelectClauseForType(sourceType) : '';

                const headingLabel = sourceType
                    ? `${capitalize(sourceType)}s`
                    : queryText.replace(/^!view\s+/i, '').split('\n')[0].trim() || 'View';
                const insertion = `${prefix}## ${headingLabel}\n\n${queryText}${selectClause}\n`;

                const edit = new vscode.WorkspaceEdit();
                edit.insert(document.uri, new vscode.Position(lastLine, lastChar), insertion);

                await vscode.workspace.applyEdit(edit);
                await document.save();

                vscode.window.showInformationMessage(
                    sourceType
                        ? `Yamlink: Inserted !view ${sourceType} block`
                        : 'Yamlink: Inserted view block'
                );
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.queryBuilder', async () => {
            await vscode.commands.executeCommand('yamlink.insertViewBlock');
        })
    );

    // ── yamlink.linkOrphan ───────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'yamlink.linkOrphan',
            async (document, sourceId) => {
                const idIndex = getIndex();

                const fCache = getFieldsCache();
                const items = [...idIndex.entries()]
                    .filter(([id]) => id !== sourceId)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([id]) => {
                        const fields = fCache.get(id);
                        return {
                            label:       id,
                            description: (fields && fields.type) ? fields.type : '',
                        };
                    });

                if (items.length === 0) {
                    vscode.window.showInformationMessage(
                        'Yamlink: No other nodes in vault to link to.'
                    );
                    return;
                }

                const picked = await vscode.window.showQuickPick(items, {
                    title:       `Link "${sourceId}" to…`,
                    placeHolder: 'Pick a node to create a relation',
                    matchOnDescription: true
                });

                if (!picked) return;

                const edit = buildLinkEdit(document, picked.label);
                if (!edit) {
                    vscode.window.showErrorMessage(
                        'Yamlink: Could not find frontmatter to insert into.'
                    );
                    return;
                }

                await vscode.workspace.applyEdit(edit);
                await document.save();

                vscode.window.showInformationMessage(
                    `Yamlink: Linked "${sourceId}" → "${picked.label}"`
                );
            }
        )
    );

    // ── yamlink.createNote ───────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.createNote', async (id, preselectedType, sourceFilePath) => {
            let chosenType = preselectedType || null;

            if (!id || typeof id !== 'string' || id.trim() === '') {
                id = await vscode.window.showInputBox({
                    title:       'Create Yamlink Node',
                    prompt:      'Node ID',
                    placeHolder: 'my-node-id',
                    validateInput: (v) => {
                        if (!v || !v.trim()) return 'ID cannot be empty';
                        if (!canonicalizeId(v)) {
                            return 'Enter text that can be turned into an ID';
                        }
                        return null;
                    }
                });
                if (!id) return;
                id = canonicalizeId(id);

                const knownTypes = [...getTypes()];
                const typeItems  = [
                    ...knownTypes.map(t => ({ label: t, description: 'existing type' })),
                    { label: '$(plus) Enter new type…', description: '' }
                ];

                if (chosenType) {
                    // Type already inferred — skip picker
                } else if (knownTypes.length > 0) {
                    const pick = await vscode.window.showQuickPick(typeItems, {
                        title:       'Node Type',
                        placeHolder: 'Select a type — press Escape to skip'
                    });
                    if (pick) {
                        if (pick.label.startsWith('$(plus)')) {
                            chosenType = await vscode.window.showInputBox({
                                title:        'New Type',
                                prompt:       'Enter a type name',
                                placeHolder:  'contact',
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
                } else {
                    const raw = await vscode.window.showInputBox({
                        title:       'Node Type',
                        prompt:      'Type (optional — press Escape to skip)',
                        placeHolder: 'contact'
                    });
                    if (raw && raw.trim()) chosenType = raw.trim();
                }
            }

            if (!vscode.workspace.workspaceFolders) {
                vscode.window.showErrorMessage("Yamlink: No workspace folder open.");
                return;
            }

            const root = sourceFilePath
                ? getWorkspaceRootForFile(vscode.workspace.workspaceFolders, sourceFilePath)
                : getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
            if (!root) {
                vscode.window.showErrorMessage("Yamlink: No workspace folder open.");
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
                ? require('path').join(root, '_templates', chosenType + '.md')
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

    // ── yamlink.newNodeFromTemplate ──────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.newNodeFromTemplate', async () => {
            if (!vscode.workspace.workspaceFolders) {
                vscode.window.showErrorMessage("Yamlink: No workspace folder open.");
                return;
            }

            const root = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
            if (!root) {
                vscode.window.showErrorMessage("Yamlink: No workspace folder open.");
                return;
            }
            const templates = loadTemplates(root);

            if (templates.length === 0) {
                const action = await vscode.window.showInformationMessage(
                    `Yamlink: No templates found. Create .md files in _templates/ to get started.`,
                    'Create _templates folder'
                );
                if (action === 'Create _templates folder') {
                    const templatesPath = path.join(root, TEMPLATES_DIR);
                    if (!fs.existsSync(templatesPath)) fs.mkdirSync(templatesPath);

                    const starterPath = path.join(templatesPath, 'contact.md');
                    if (!fs.existsSync(starterPath)) {
                        fs.writeFileSync(starterPath,
`---
id:
type: contact
name:
account: [[]]
email:
created:
---

`, 'utf8');
                    }

                    const doc = await vscode.workspace.openTextDocument(
                        vscode.Uri.file(path.join(templatesPath, 'contact.md'))
                    );
                    await vscode.window.showTextDocument(doc, { preview: false });
                    vscode.window.showInformationMessage(
                        `Yamlink: _templates/ created with a starter contact template.`
                    );
                }
                return;
            }

            const picked = await vscode.window.showQuickPick(
                templates.map(t => ({
                    label:       t.label,
                    description: path.relative(root, t.filePath),
                    template:    t
                })),
                { title: 'New Node from Template', placeHolder: 'Select a template' }
            );
            if (!picked) return;

            const id = await vscode.window.showInputBox({
                title:       `New ${picked.label} node`,
                prompt:      'Node ID',
                placeHolder: `my-${picked.label}-id`,
                validateInput: (v) => {
                    if (!v || !v.trim()) return 'ID cannot be empty';
                    if (!canonicalizeId(v)) {
                        return 'Enter text that can be turned into an ID';
                    }
                    return null;
                }
            });
            if (!id) return;

            const cleanId  = canonicalizeId(id);
            const today    = new Date().toISOString().split('T')[0];
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

            vscode.window.showInformationMessage(
                `Yamlink: Created "${cleanId}" from template "${picked.label}"`
            );
        })
    );

    // ── yamlink.addFrontmatter ───────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'yamlink.addFrontmatter',
            async (document, suggestedId) => {
                const today          = new Date().toISOString().split('T')[0];
                const text           = document.getText();
                const hasFrontmatter = /^\s*---/.test(text);
                const edit           = new vscode.WorkspaceEdit();

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

                vscode.window.showInformationMessage(
                    `Yamlink: "${suggestedId}" is now a Yamlink node`
                );
            }
        )
    );
}

// ─────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────

function toKebabId(str) {
    return canonicalizeId(str);
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Helper used in the insertViewBlock success message
function count_label(n, type) {
    return `${n} ${n === 1 ? type : type + 's'}`;
}

function backlinks_count(document, queryText) {
    // Rough count from the query text for the success message
    // We don't have direct access here so return a placeholder
    return '?';
}

module.exports = { registerCodeActions, buildTypeViewQuery, buildIncomingViewQuery };
