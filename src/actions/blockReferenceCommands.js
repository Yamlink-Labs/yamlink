'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const {
    extractMeaningfulBodyBlocks,
    findBodyBlockInLineRange,
    formatBlockReference
} = require('../core/bodyBlocks');
const { emitOutcomeEvent } = require('../runtime/mutationEventLog');
const { canonicalizeId } = require('../core/id');
const { getWorkspaceRootForFile, getPrimaryWorkspaceRoot } = require('../core/workspace');

function describeBlockKind(block) {
    switch (block?.type) {
        case 'heading': return 'Heading';
        case 'task': return 'Task';
        case 'quote': return 'Quote';
        case 'footnote': return 'Footnote';
        default: return 'Block';
    }
}

function buildBlockQuickPickItems(noteId, blocks) {
    return (Array.isArray(blocks) ? blocks : []).map((block) => {
        const snippet = String(block.label || block.text || '').trim().replace(/\s+/g, ' ');
        return {
            label: `${describeBlockKind(block)}: ${snippet || block.blockId}`,
            description: formatBlockReference(noteId, block),
            detail: block.type === 'heading'
                ? `Line ${block.line + 1} · section link`
                : `Line ${block.line + 1} · ${block.blockId}`,
            block
        };
    });
}

function getAddressableBlocks(editor) {
    const content = editor.document.getText();
    return extractMeaningfulBodyBlocks(content);
}

function filterBlocksByMode(blocks, mode) {
    const list = Array.isArray(blocks) ? blocks : [];
    if (mode === 'heading') return list.filter((block) => block.type === 'heading');
    if (mode === 'nonHeading') return list.filter((block) => block.type !== 'heading');
    return list;
}

function findCurrentAddressableBlock(editor, mode = 'any') {
    const blocks = filterBlocksByMode(getAddressableBlocks(editor), mode);
    if (!blocks.length) return null;
    const selection = editor.selection;
    return findBodyBlockInLineRange(blocks, selection.start.line, selection.end.line);
}

async function pickAddressableBlock(editor, noteId, options = {}) {
    const mode = options.mode || 'any';
    const preferredBlock = options.preferredBlock || null;
    const blocks = filterBlocksByMode(getAddressableBlocks(editor), mode);
    if (!blocks.length) return null;

    if (preferredBlock) {
        const matched = blocks.find((block) =>
            block.blockId === preferredBlock.blockId
            || (
                block.type === preferredBlock.type
                && block.line === preferredBlock.line
                && String(block.label || '').trim() === String(preferredBlock.label || '').trim()
            )
        );
        if (matched) return matched;
    }

    const selection = editor.selection;
    const current = findBodyBlockInLineRange(blocks, selection.start.line, selection.end.line);
    if (current) return current;

    const picks = buildBlockQuickPickItems(noteId, blocks);
    const picked = await vscode.window.showQuickPick(picks, {
        title: options.title || 'Yamlink — Select block reference',
        placeHolder: options.placeHolder || 'Choose a heading, task, quote, or footnote from this note'
    });
    return picked?.block || null;
}

function replaceEditorSelection(editor, text) {
    return editor.edit((editBuilder) => {
        editBuilder.replace(editor.selection, text);
    });
}

function buildHeadingReference(noteId, block) {
    return `[[${noteId}#${String(block?.label || '').trim()}]]`;
}

function buildScopedReference(noteId, block) {
    if (block?.type === 'heading') return buildHeadingReference(noteId, block);
    return formatBlockReference(noteId, block);
}

function ensureActiveMarkdownEditor(verb) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showInformationMessage(`Yamlink: Open a Markdown note to ${verb}.`);
        return null;
    }
    return editor;
}

function ensureNoteId(editor, getPathIndex) {
    const noteId = getPathIndex().get(editor.document.uri.fsPath);
    if (!noteId) {
        vscode.window.showInformationMessage('Yamlink: This file has no id: field yet.');
        return null;
    }
    return noteId;
}

async function resolveReferenceBlock({ getPathIndex, mode, title, placeHolder, preferredBlock = null }) {
    const verb = mode === 'heading' ? 'use section references' : 'use block references';
    const editor = ensureActiveMarkdownEditor(verb);
    if (!editor) return null;

    const noteId = ensureNoteId(editor, getPathIndex);
    if (!noteId) return null;

    const block = await pickAddressableBlock(editor, noteId, {
        mode,
        title,
        placeHolder,
        preferredBlock
    });
    if (!block) {
        const kind = mode === 'heading'
            ? 'addressable headings'
            : 'addressable headings, tasks, quotes, or footnotes';
        vscode.window.showInformationMessage(`Yamlink: No ${kind} found.`);
        return null;
    }

    return { editor, noteId, sourceNoteId: noteId, block };
}

async function resolveScopedReferenceBlock({ getPathIndex, title, placeHolder }) {
    const editor = ensureActiveMarkdownEditor('use scoped references');
    if (!editor) return null;

    const noteId = ensureNoteId(editor, getPathIndex);
    if (!noteId) return null;

    const current = findCurrentAddressableBlock(editor, 'any');
    if (current) {
        return { editor, noteId, sourceNoteId: noteId, block: current };
    }

    const block = await pickAddressableBlock(editor, noteId, {
        mode: 'any',
        title: title || 'Yamlink — Copy scoped reference',
        placeHolder: placeHolder || 'Choose a heading, task, quote, or footnote from this note'
    });
    if (!block) {
        vscode.window.showInformationMessage('Yamlink: No addressable headings, tasks, quotes, or footnotes found.');
        return null;
    }
    return { editor, noteId, sourceNoteId: noteId, block };
}

async function copyResolvedReference(resolved, formatter, successVerb) {
    if (!resolved) return;
    const reference = formatter(resolved.noteId, resolved.block);
    await vscode.env.clipboard.writeText(reference);
    vscode.window.setStatusBarMessage(`Yamlink: ${successVerb} ${reference}`, 3000);
}

async function insertResolvedReference(resolved, formatter) {
    if (!resolved) return;
    const reference = formatter(resolved.noteId, resolved.block);
    const ok = await replaceEditorSelection(resolved.editor, reference);
    if (!ok) {
        vscode.window.showWarningMessage('Yamlink: Could not insert reference.');
        return;
    }
    const sourceNoteId = resolved.sourceNoteId || null;
    if (sourceNoteId) {
        emitOutcomeEvent({
            type: 'block_reference_created',
            noteId: sourceNoteId,
            field: resolved.block?.type === 'heading' ? 'section_reference' : 'block_reference',
            newValue: reference,
            source: 'vscode',
            cause: 'insert_reference',
            meta: {
                targetNoteId: resolved.noteId,
                blockType: resolved.block?.type || 'block',
                blockId: resolved.block?.blockId || null
            }
        });
    }
    vscode.window.setStatusBarMessage(`Yamlink: Inserted ${reference}`, 3000);
}

function deriveBlockExtractTitle(block) {
    const raw = String(block?.label || block?.text || '').trim();
    const firstLine = raw.split('\n')[0] || '';
    return firstLine.replace(/\*+/g, '').trim().slice(0, 80) || describeBlockKind(block);
}

/**
 * Body-target action, distinct from the copy/insert commands above: moves a
 * single addressable block (task/quote/footnote — not a heading, which has
 * no bounded content range of its own) out of the current note and into a
 * brand-new one, replacing it in place with an embed. Deliberately mirrors
 * nodeCreationSelection.js's handleSplitNoteBody() (same frontmatter shape,
 * same embed-replacement convention, same direct fs write with no
 * vaultService involvement) rather than inventing a second convention —
 * the difference is the source range comes from a known block's
 * line/endLine instead of an arbitrary user selection.
 */
async function handleExtractBlockToNote(getPathIndex, preferredBlock = null) {
    const editor = ensureActiveMarkdownEditor('extract a block to a new note');
    if (!editor) return;

    const noteId = ensureNoteId(editor, getPathIndex);
    if (!noteId) return;

    const block = await pickAddressableBlock(editor, noteId, {
        mode: 'nonHeading',
        title: 'Yamlink — Extract block to new note',
        placeHolder: 'Choose a task, quote, or footnote to move into its own note',
        preferredBlock
    });
    if (!block) {
        vscode.window.showInformationMessage('Yamlink: No addressable tasks, quotes, or footnotes found.');
        return;
    }

    const title = await vscode.window.showInputBox({
        prompt: 'Title for the extracted note',
        value: deriveBlockExtractTitle(block),
        placeHolder: 'Note title',
        validateInput: (v) => (v && v.trim()) ? null : 'Title cannot be empty'
    });
    if (!title) return;

    const cleanId = canonicalizeId(title);
    if (!cleanId) {
        vscode.window.showErrorMessage('Yamlink: Could not generate a valid ID from that title.');
        return;
    }

    const root = getWorkspaceRootForFile(vscode.workspace.workspaceFolders, editor.document.uri.fsPath)
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

    const lines = editor.document.getText().split('\n');
    const blockLines = lines.slice(block.line, block.endLine + 1);
    const bodyContent = blockLines.join('\n').trim();
    const today = new Date().toISOString().slice(0, 10);
    const frontmatterLines = ['---', `id: ${cleanId}`, `created: ${today}`, `source: [[${noteId}]]`, '---', ''];
    fs.writeFileSync(newFilePath, frontmatterLines.join('\n') + bodyContent + '\n', 'utf8');

    const replaceRange = new vscode.Range(
        new vscode.Position(block.line, 0),
        new vscode.Position(block.endLine, lines[block.endLine].length)
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(editor.document.uri, replaceRange, `![[${cleanId}]]`);
    const editApplied = await vscode.workspace.applyEdit(edit);
    if (!editApplied) {
        vscode.window.showWarningMessage(`Yamlink: Created "${cleanId}" but could not replace the block — replace manually with ![[${cleanId}]].`);
    }

    emitOutcomeEvent({
        type: 'block_reference_created',
        noteId,
        field: 'block_reference',
        newValue: `![[${cleanId}]]`,
        source: 'vscode',
        cause: 'extract_block_to_note',
        meta: { targetNoteId: cleanId, blockType: block.type, blockId: block.blockId }
    });

    const newDoc = await vscode.workspace.openTextDocument(newFilePath);
    await vscode.window.showTextDocument(newDoc, { viewColumn: vscode.ViewColumn.One, preview: false });
    vscode.window.showInformationMessage(`Yamlink: Extracted "${cleanId}" from ${describeBlockKind(block).toLowerCase()}`);
}

function registerBlockReferenceCommands(context, getPathIndex) {
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.copyBlockReference', async () => {
            const resolved = await resolveReferenceBlock({
                getPathIndex,
                mode: 'nonHeading',
                title: 'Yamlink — Copy block reference',
                placeHolder: 'Choose a task, quote, or footnote from this note'
            });
            await copyResolvedReference(resolved, formatBlockReference, 'Copied');
        }),

        vscode.commands.registerCommand('yamlink.insertBlockReference', async () => {
            const resolved = await resolveReferenceBlock({
                getPathIndex,
                mode: 'nonHeading',
                title: 'Yamlink — Insert block reference',
                placeHolder: 'Choose a task, quote, or footnote from this note'
            });
            await insertResolvedReference(resolved, formatBlockReference);
        }),

        vscode.commands.registerCommand('yamlink.extractBlockToNote', async (preferredBlock) => {
            await handleExtractBlockToNote(getPathIndex, preferredBlock || null);
        }),

        vscode.commands.registerCommand('yamlink.copyScopedReference', async () => {
            const resolved = await resolveScopedReferenceBlock({
                getPathIndex,
                title: 'Yamlink — Copy scoped reference',
                placeHolder: 'Choose a heading, task, quote, or footnote from this note'
            });
            await copyResolvedReference(resolved, buildScopedReference, 'Copied');
        }),

        vscode.commands.registerCommand('yamlink.insertScopedReference', async () => {
            const resolved = await resolveScopedReferenceBlock({
                getPathIndex,
                title: 'Yamlink — Insert scoped reference',
                placeHolder: 'Choose a heading, task, quote, or footnote from this note'
            });
            await insertResolvedReference(resolved, buildScopedReference);
        }),

        vscode.commands.registerCommand('yamlink.copySectionReference', async (outlineNode) => {
            const resolved = await resolveReferenceBlock({
                getPathIndex,
                mode: 'heading',
                title: 'Yamlink — Copy section reference',
                placeHolder: 'Choose a heading from this note',
                preferredBlock: outlineNode && outlineNode.heading
                    ? {
                        blockId: `h-${String(outlineNode.heading.text || '').trim()}`,
                        type: 'heading',
                        line: outlineNode.heading.line,
                        label: outlineNode.heading.text,
                        text: outlineNode.heading.text
                    }
                    : null
            });
            await copyResolvedReference(resolved, buildHeadingReference, 'Copied');
        }),

        vscode.commands.registerCommand('yamlink.insertSectionReference', async (outlineNode) => {
            const resolved = await resolveReferenceBlock({
                getPathIndex,
                mode: 'heading',
                title: 'Yamlink — Insert section reference',
                placeHolder: 'Choose a heading from this note',
                preferredBlock: outlineNode && outlineNode.heading
                    ? {
                        blockId: `h-${String(outlineNode.heading.text || '').trim()}`,
                        type: 'heading',
                        line: outlineNode.heading.line,
                        label: outlineNode.heading.text,
                        text: outlineNode.heading.text
                    }
                    : null
            });
            await insertResolvedReference(resolved, buildHeadingReference);
        })
    );
}

module.exports = {
    describeBlockKind,
    buildBlockQuickPickItems,
    buildHeadingReference,
    buildScopedReference,
    deriveBlockExtractTitle,
    filterBlocksByMode,
    findCurrentAddressableBlock,
    getAddressableBlocks,
    pickAddressableBlock,
    registerBlockReferenceCommands
};
