const vscode = require('vscode');
const { getFieldsCache } = require('../core/indexService');
const { registerNodeCreationCommands, registerDailyNoteCommand } = require('./codeActionsNodeCreationCommands');

function buildLinkEdit(document, targetId, lineIndex) {
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

    // Prefer writing directly onto the frontmatter line this quickfix was
    // actually invoked from, when that line is a blank or empty-placeholder
    // relation field — without this, every "Link this node to another…"
    // quickfix silently wrote into a hardcoded `related:` field regardless
    // of which field the cursor was on, which is confusing when a more
    // specific blank field (e.g. `ramo:`) is sitting right there instead.
    if (typeof lineIndex === 'number' && lineIndex > 0 && lineIndex < closingLine) {
        const lineText = lines[lineIndex];
        const fieldMatch = /^(\s*[\w-]+\s*:)(\s*)(.*?)\s*$/.exec(lineText || '');
        if (fieldMatch) {
            const existingValue = fieldMatch[3] || '';
            const isEmptyPlaceholder = /^\[\[\s*\]\]$/.test(existingValue);
            if (existingValue === '' || isEmptyPlaceholder) {
                const valueStart = fieldMatch[1].length;
                const start = new vscode.Position(lineIndex, valueStart);
                const end = new vscode.Position(lineIndex, lineText.length);
                edit.replace(document.uri, new vscode.Range(start, end), ` [[${targetId}]]`);
                return edit;
            }
        }
    }

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

function registerNodeLinkCommands(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.linkOrphan', async (document, sourceId, lineIndex) => {
            const fCache = getFieldsCache();
            const items = [...fCache.keys()]
                .filter((id) => id !== sourceId)
                .sort((a, b) => a.localeCompare(b))
                .map((id) => {
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

            const edit = buildLinkEdit(document, picked.label, lineIndex);
            if (!edit) {
                vscode.window.showErrorMessage('Yamlink: Could not find frontmatter to insert into.');
                return;
            }

            await vscode.workspace.applyEdit(edit);
            await document.save();

            vscode.window.showInformationMessage(`Yamlink: Linked "${sourceId}" → "${picked.label}"`);
        })
    );
}

function registerDuplicateIdCommand(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.resolveIdConflict', async (document, currentId) => {
            const newId = await vscode.window.showInputBox({
                title: 'Rename ID to resolve conflict',
                prompt: `Enter a new unique ID to replace "${currentId}"`,
                value: `${currentId}-2`,
                validateInput: (v) => {
                    const trimmed = (v || '').trim();
                    if (!trimmed) return 'ID cannot be empty';
                    if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) {
                        return 'ID must be kebab-case (lowercase letters, numbers, hyphens)';
                    }
                    return null;
                }
            });
            if (!newId) return;

            const text = document.getText();
            const lines = text.split('\n');
            const idLineIndex = lines.findIndex(l => /^\s*id:\s*.+/.test(l));
            if (idLineIndex === -1) {
                vscode.window.showErrorMessage('Yamlink: Could not find id field to rename.');
                return;
            }

            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                document.uri,
                new vscode.Range(
                    new vscode.Position(idLineIndex, 0),
                    new vscode.Position(idLineIndex, lines[idLineIndex].length)
                ),
                `id: ${newId.trim()}`
            );

            await vscode.workspace.applyEdit(edit);
            await document.save();
        })
    );
}

function registerNodeCommands(context, getIndex, getTypes) {
    registerNodeLinkCommands(context);
    registerNodeCreationCommands(context, getIndex, getTypes);
    registerDailyNoteCommand(context);
    registerDuplicateIdCommand(context);
}

module.exports = {
    registerNodeCommands
};
