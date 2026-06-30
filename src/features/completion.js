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
    buildBlockReferenceItems,
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
    rankScalarValues,
    buildFieldInferenceDetail,
    resolveQueryRelationCandidates
} = require('./completionHelpers');

function resolveFrontmatterFollowupState(document, position, getIndex) {
    if (!document || !position || !isPositionInFrontmatter(document, position.line)) return null;

    const relationState = resolveFrontmatterRelationCandidates(document, position, getIndex());
    if (relationState) {
        const candidateCount = (relationState.candidateIds || []).length;
        if (relationState.hasWiki || candidateCount || relationState.missingTargetType) {
            return {
                kind: 'relation',
                fieldName: relationState.fieldName,
                partial: relationState.partial || '',
                hasWiki: !!relationState.hasWiki,
                candidateCount,
                missingTargetType: !!relationState.missingTargetType
            };
        }
    }

    const line = document.lineAt(position.line).text;
    const textBeforeCursor = line.substring(0, position.character);
    const valueMatch = textBeforeCursor.match(/^\s*([\w-]+):\s*(.*?)$/);
    if (!valueMatch) return null;

    const fieldName = String(valueMatch[1] || '').trim().toLowerCase();
    if (!fieldName || fieldName === 'type') return null;
    const partial = String(valueMatch[2] || '').trim().toLowerCase();
    const docType = (() => {
        const text = document.getText();
        const match = text.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;
        const typeLine = match[1].split('\n').find((entry) => /^\s*type\s*:/i.test(entry));
        if (!typeLine) return null;
        return String(typeLine.split(':').slice(1).join(':') || '').trim().toLowerCase() || null;
    })();
    const scalarValues = rankScalarValues(fieldName, docType, partial);
    if (!scalarValues.length) return null;

    return {
        kind: 'scalar',
        fieldName,
        partial,
        candidateCount: scalarValues.length
    };
}

/** @param {import('vscode').ExtensionContext} context @param {() => Map<string,string>} getIndex @returns {void} */
function registerCompletion(context, getIndex) {
    let frontmatterSuggestTimer = null;
    let lastFrontmatterSuggestSignature = '';

    function maybeTriggerFrontmatterSuggest(editor) {
        if (!editor || editor.document.languageId !== 'markdown') return;
        const position = editor.selection?.active;
        if (!position) return;
        const followupState = resolveFrontmatterFollowupState(editor.document, position, getIndex());
        if (!followupState) return;
        const signature = [
            editor.document.uri.fsPath,
            editor.document.version,
            position.line,
            position.character,
            followupState.kind,
            followupState.fieldName,
            followupState.partial,
            followupState.hasWiki ? 'wiki' : 'plain',
            followupState.candidateCount,
            followupState.missingTargetType ? 'missing-target' : 'ready'
        ].join(':');
        if (signature === lastFrontmatterSuggestSignature) return;
        lastFrontmatterSuggestSignature = signature;
        clearTimeout(frontmatterSuggestTimer);
        frontmatterSuggestTimer = setTimeout(() => {
            vscode.commands.executeCommand('editor.action.triggerSuggest');
        }, 90);
    }

    context.subscriptions.push({
        dispose() {
            clearTimeout(frontmatterSuggestTimer);
        }
    });

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection((event) => {
            maybeTriggerFrontmatterSuggest(event.textEditor);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document !== event.document) return;
            maybeTriggerFrontmatterSuggest(editor);
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
    resolveFrontmatterFollowupState,
    buildDateShortcutItems,
    buildHeadingAnchorItems,
    buildBlockReferenceItems,
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
    rankScalarValues,
    buildFieldInferenceDetail,
    resolveQueryRelationCandidates,
    shouldOfferFrontmatterRelationCompletion,
    buildPreTypeBootstrapItems
};
