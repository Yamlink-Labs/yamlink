'use strict';

const vscode = require('vscode');
const {
    extractMeaningfulBodyBlocks,
    findBodyBlockInLineRange,
    formatBlockReference
} = require('../core/bodyBlocks');
const { emitOutcomeEvent } = require('../runtime/mutationEventLog');

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

async function resolveReferenceBlock({ getPathIndex, mode, title, placeHolder, preferredBlock }) {
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
    filterBlocksByMode,
    findCurrentAddressableBlock,
    getAddressableBlocks,
    pickAddressableBlock,
    registerBlockReferenceCommands
};
