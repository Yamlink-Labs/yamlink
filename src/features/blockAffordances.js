// src/features/blockAffordances.js
// Block-ID revision pass, part 1: in-editor affordances for addressable blocks.
// Previously the only way to know a heading/task/quote/footnote was
// referenceable at all was to already know the feature existed and run a
// command from the palette. This surfaces it directly above the block, and
// turns block-level backlinks (CLI/API since 0.7.6, entity hub since Sugar)
// into a real editor action instead of a panel-only view.

const vscode = require('vscode');
const { extractMeaningfulBodyBlocks, formatBlockReference } = require('../core/bodyBlocks');
const { buildBlockBacklinks } = require('./entityHubModel');

/** @param {{type?: string}|null|undefined} block */
function describeBlockKindShort(block) {
    switch (block?.type) {
        case 'heading': return 'section';
        case 'task': return 'task';
        case 'quote': return 'quote';
        case 'footnote': return 'footnote';
        default: return 'block';
    }
}

/** @param {import('vscode').ExtensionContext} context @param {() => Map<string,string>} getPathIndex @param {() => Map<string,string>} getIndex @param {() => Map<string,object>} getFieldsCache @returns {import('vscode').CodeLensProvider & { refresh: () => void }} */
function registerBlockAffordances(context, getPathIndex, getIndex, getFieldsCache) {
    const emitter = new vscode.EventEmitter();

    const provider = {
        onDidChangeCodeLenses: emitter.event,

        refresh() {
            emitter.fire();
        },

        /** @param {import('vscode').TextDocument} document */
        provideCodeLenses(document) {
            if (document.languageId !== 'markdown') return [];
            const noteId = getPathIndex().get(document.uri.fsPath);
            if (!noteId) return [];

            const text = document.getText();
            const blocks = extractMeaningfulBodyBlocks(text);
            if (!blocks.length) return [];

            let backlinkCounts = new Map();
            try {
                const rows = buildBlockBacklinks(noteId, text, getIndex(), getFieldsCache());
                for (const row of rows) {
                    backlinkCounts.set(row.targetBlockId, (backlinkCounts.get(row.targetBlockId) || 0) + 1);
                }
            } catch (_) {
                // Backlink affordance is a bonus on top of the copy affordance —
                // a failure here should never hide the base CodeLens.
            }

            const lenses = [];
            for (const block of blocks) {
                if (block.line < 0 || block.line >= document.lineCount) continue;
                const range = new vscode.Range(block.line, 0, block.line, document.lineAt(block.line).text.length);

                lenses.push(new vscode.CodeLens(range, {
                    title: `$(link) Copy ${describeBlockKindShort(block)} reference`,
                    command: 'yamlink._copyBlockReferenceAt',
                    arguments: [noteId, block]
                }));

                const count = backlinkCounts.get(block.blockId) || 0;
                if (count > 0) {
                    lenses.push(new vscode.CodeLens(range, {
                        title: `$(references) ${count} reference${count === 1 ? '' : 's'}`,
                        command: 'yamlink._showBlockBacklinksAt',
                        arguments: [noteId, block.blockId]
                    }));
                }

                if (block.type !== 'heading') {
                    lenses.push(new vscode.CodeLens(range, {
                        title: '$(new-file) Extract to note',
                        command: 'yamlink.extractBlockToNote',
                        arguments: [block]
                    }));
                }
            }
            return lenses;
        }
    };

    function registerCommands() {
        context.subscriptions.push(
            vscode.commands.registerCommand('yamlink._copyBlockReferenceAt', async (noteId, block) => {
                if (!noteId || !block) return;
                const reference = formatBlockReference(noteId, block);
                if (!reference) return;
                await vscode.env.clipboard.writeText(reference);
                vscode.window.setStatusBarMessage(`Yamlink: Copied ${reference}`, 3000);
            }),

            vscode.commands.registerCommand('yamlink._showBlockBacklinksAt', async (noteId, blockId) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || !noteId || !blockId) return;

                let rows;
                try {
                    rows = buildBlockBacklinks(noteId, editor.document.getText(), getIndex(), getFieldsCache())
                        .filter((row) => row.targetBlockId === blockId);
                } catch (_) {
                    rows = [];
                }
                if (!rows.length) {
                    vscode.window.showInformationMessage('Yamlink: No block references found.');
                    return;
                }

                const pathIndex = getPathIndex();
                const picks = rows.map((row) => ({
                    label: `${row.sourceLabel}${row.sourceType ? ` (${row.sourceType})` : ''}`,
                    description: `line ${row.line}`,
                    row
                }));
                const picked = picks.length === 1
                    ? picks[0]
                    : await vscode.window.showQuickPick(picks, {
                        title: `Yamlink — References to this ${describeBlockKindShort({ type: rows[0].targetKind })}`,
                        placeHolder: 'Jump to a referencing note'
                    });
                if (!picked) return;

                const targetPath = [...pathIndex.entries()].find(([, id]) => id === picked.row.sourceId)?.[0];
                if (!targetPath) {
                    vscode.window.showInformationMessage('Yamlink: Could not locate that note on disk.');
                    return;
                }
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
                const targetEditor = await vscode.window.showTextDocument(doc);
                const line = Math.max(0, (picked.row.line || 1) - 1);
                const pos = new vscode.Position(line, 0);
                targetEditor.selection = new vscode.Selection(pos, pos);
                targetEditor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            })
        );
    }
    registerCommands();

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ language: 'markdown' }, provider)
    );
    context.subscriptions.push(emitter);

    return provider;
}

module.exports = { registerBlockAffordances, describeBlockKindShort };
