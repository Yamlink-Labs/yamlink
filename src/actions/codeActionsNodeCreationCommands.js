'use strict';

const vscode = require('vscode');
const {
    handleCreateNote,
    handleCreateRelatedNote,
    handleNewNodeFromTemplate,
    handleNewNote,
    handleNewNoteFromSelection,
    handleSplitNoteBody,
    handleNewNoteFromSchema,
    handleAddMissingTemplateFields,
    handleAddFrontmatter,
    handleBackfillCreatedDates,
    handleOpenDailyNote
} = require('./nodeCreationHandlers');

// Cache the last non-empty editor selection so commands can read it after any
// dialog (QuickPick, InputBox, command palette) steals editor focus.
function registerNodeCreationCommands(context, getIndex, getTypes) {
    const selectionRef = { current: null };

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            const sel = e.selections[0];
            if (sel && !sel.isEmpty) {
                selectionRef.current = { document: e.textEditor.document, selection: sel };
            }
        })
    );
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            selectionRef.current = null;
        })
    );

    const deps = { getIndex, getTypes, selectionRef };

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.createNote', handleCreateNote.bind(null, deps))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.createRelatedNote', handleCreateRelatedNote.bind(null, deps))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.newNodeFromTemplate', handleNewNodeFromTemplate.bind(null, deps))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.newNote', handleNewNote.bind(null, deps))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.newNoteFromSelection', handleNewNoteFromSelection.bind(null, deps))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.splitNoteBody', handleSplitNoteBody.bind(null, deps))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.newNoteFromSchema', handleNewNoteFromSchema.bind(null, deps))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.addMissingTemplateFields', handleAddMissingTemplateFields)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.addFrontmatter', handleAddFrontmatter.bind(null, deps))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.backfillCreatedDates', handleBackfillCreatedDates.bind(null, deps))
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
        vscode.commands.registerCommand('yamlink.openDailyNote', handleOpenDailyNote)
    );
}

module.exports = {
    registerNodeCreationCommands,
    registerDailyNoteCommand
};
