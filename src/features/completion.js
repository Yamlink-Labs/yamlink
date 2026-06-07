'use strict';

// Thin wiring shim — all callers import from this module unchanged.
// Pure utilities: completionCore.js
// Item builders + provider implementations: completionProviders.js
// Context/relation/adaptive helpers: completionHelpers.js (→ completionContextHelpers, completionRelationHelpers, completionAdaptiveHelpers)

const vscode = require('vscode');
const { isPositionInFrontmatter, resolveFrontmatterRelationCandidates } = require('./completionHelpers');
const { inferTargetTypeFromFieldName } = require('../intelligence/fieldRoles');
const {
    buildDateShortcutItems,
    buildHeadingAnchorItems,
    buildFootnoteReferenceItems,
    buildLongformBodyStructureItems,
    shouldOfferFrontmatterRelationCompletion,
    buildPreTypeBootstrapItems,
    provideLinkAndDateCompletions,
    provideFrontmatterFieldCompletions,
    provideQueryCompletions
} = require('./completionProviders');
const {
    collectObservedFrontmatterFields,
    collectRoleAlignedObservedFrontmatterFields,
    collectContextualObservedFrontmatterFields,
    collectAdaptiveFrontmatterFieldSuggestions,
    collectSchemaAdaptiveGapSuggestions,
    collectAdaptiveFrontmatterStarterSuggestions,
    collectArchetypeFieldSuggestions,
    collectNoteRoleFieldSuggestions,
    collectDriftMissingFieldSuggestions,
    collectLocalLinkedIds,
    collectObservedRelationUsage,
    rankCandidateIds,
    buildFieldInferenceDetail,
    resolveQueryRelationCandidates
} = require('./completionHelpers');

/** @param {import('vscode').ExtensionContext} context @param {() => Map<string,string>} getIndex @returns {void} */
function registerCompletion(context, getIndex) {
    let relationSuggestTimer = null;
    let lastRelationSuggestSignature = '';

    function maybeTriggerRelationSuggest(editor) {
        if (!editor || editor.document.languageId !== 'markdown') return;
        const position = editor.selection?.active;
        if (!position) return;
        const relationState = resolveFrontmatterRelationCandidates(editor.document, position, getIndex());
        if (!relationState || !isPositionInFrontmatter(editor.document, position.line)) return;
        if (!relationState.hasWiki) return;
        const candidateCount = (relationState.candidateIds || []).length;
        if (!candidateCount && !relationState.missingTargetType) return;
        const signature = [
            editor.document.uri.fsPath,
            editor.document.version,
            position.line,
            position.character,
            relationState.fieldName,
            relationState.partial,
            relationState.hasWiki ? 'wiki' : 'plain'
        ].join(':');
        if (signature === lastRelationSuggestSignature) return;
        lastRelationSuggestSignature = signature;
        clearTimeout(relationSuggestTimer);
        relationSuggestTimer = setTimeout(() => {
            vscode.commands.executeCommand('editor.action.triggerSuggest');
        }, 90);
    }

    context.subscriptions.push({
        dispose() {
            clearTimeout(relationSuggestTimer);
        }
    });

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection((event) => {
            maybeTriggerRelationSuggest(event.textEditor);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document !== event.document) return;
            maybeTriggerRelationSuggest(editor);
        })
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'markdown',
            {
                provideCompletionItems(document, position, token, completionContext) {
                    return provideLinkAndDateCompletions(document, position, token, completionContext, getIndex);
                }
            },
            '[', ':', '@'
        )
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'markdown',
            {
                provideCompletionItems(document, position) {
                    return provideFrontmatterFieldCompletions(document, position, getIndex);
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'markdown',
            {
                provideCompletionItems(document, position) {
                    return provideQueryCompletions(document, position, getIndex);
                }
            },
            ' ', '=', ',', '['
        )
    );
}

module.exports = {
    registerCompletion,
    buildDateShortcutItems,
    buildHeadingAnchorItems,
    buildFootnoteReferenceItems,
    buildLongformBodyStructureItems,
    // Re-export helpers so existing test imports continue to work
    resolveFrontmatterRelationCandidates,
    inferTargetTypeFromFieldName,
    collectObservedFrontmatterFields,
    collectRoleAlignedObservedFrontmatterFields,
    collectContextualObservedFrontmatterFields,
    collectAdaptiveFrontmatterFieldSuggestions,
    collectSchemaAdaptiveGapSuggestions,
    collectAdaptiveFrontmatterStarterSuggestions,
    collectArchetypeFieldSuggestions,
    collectNoteRoleFieldSuggestions,
    collectDriftMissingFieldSuggestions,
    collectLocalLinkedIds,
    collectObservedRelationUsage,
    rankCandidateIds,
    buildFieldInferenceDetail,
    resolveQueryRelationCandidates,
    shouldOfferFrontmatterRelationCompletion,
    buildPreTypeBootstrapItems
};
