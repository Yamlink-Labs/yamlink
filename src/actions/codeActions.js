const vscode = require('vscode');
const path = require('path');
const { validateDocument } = require('../diagnostics/diagnostics');
const { initializeIgnoredDiagnostics, ignoreDiagnostic, isDiagnosticIgnored } = require('../diagnostics/ignoredDiagnostics');
const { suppress: suppressNote } = require('../core/suppressions');
const { getTypes } = require('../registries/typeRegistry');
const { isOrphan } = require('../core/graph');
const { computeSuggestionsForNode } = require('../engine/suggestions');
const { getFieldsCache, getPathIndex, getVaultGeneration } = require('../core/indexService');
const { getExpectedRelationTypes } = require('../intelligence/authoringEngine');
const { canonicalizeId, extractCanonicalIdFromFrontmatter } = require('../core/id');
const { getPrimaryWorkspaceRoot } = require('../core/workspace');
const { getTemplateForType, extractTemplateFields, TEMPLATES_DIR } = require('../core/templateRegistry');
const { emitOutcomeEvent } = require('../runtime/mutationEventLog');
const { buildStarterViewQuery, registerViewCommands } = require('./codeActionsViewCommands');
const { registerNodeCommands } = require('./codeActionsNodeCommands');
const {
    appendQueryOptions,
    buildLikelyRepairActions,
    buildIncomingViewQuery,
    buildRefinedBlockText,
    buildTypeViewQuery,
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

function getMissingTemplateFieldsForDocument(document) {
    const text = document.getText();
    const firstDashIdx = text.indexOf('---');
    const closingDashIdx = firstDashIdx !== -1 ? text.indexOf('---', firstDashIdx + 3) : -1;
    if (firstDashIdx === -1 || closingDashIdx === -1) return null;

    const typeMatch = text.match(/^\s*type:\s*(.+?)\s*$/m);
    const noteType = typeMatch ? typeMatch[1].trim().toLowerCase() : '';
    if (!noteType) return null;

    const SKIP_TYPES = new Set(['schema', 'dashboard', 'template']);
    if (SKIP_TYPES.has(noteType)) return null;

    const root = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
    if (!root) return null;

    const templateFilePath = path.join(root, TEMPLATES_DIR, `${noteType}.md`);
    const openTemplate = (vscode.workspace.textDocuments || []).find(
        (doc) => doc.uri?.fsPath?.toLowerCase() === templateFilePath.toLowerCase()
    );
    const templateFields = openTemplate
        ? extractTemplateFields(openTemplate.getText())
        : (getTemplateForType(root, noteType)?.fields || null);
    if (!templateFields || !templateFields.length) return null;

    const existingKeys = new Set(
        [...text.matchAll(/^\s*([\w-]+):/gm)].map((match) => match[1].toLowerCase())
    );
    const missingFields = templateFields.filter((field) => !existingKeys.has(field.toLowerCase()));
    if (!missingFields.length) return null;

    const typeLineIndex = text.split('\n').findIndex((line) => /^\s*type:\s*.+/.test(line));
    if (typeLineIndex === -1) return null;

    return { noteType, missingFields, typeLineIndex };
}

/**
 * @param {import('vscode').ExtensionContext} context
 * @param {() => Map<string, string>} getIndex
 * @returns {void}
 */
function registerCodeActions(context, getIndex) {
    initializeIgnoredDiagnostics(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.suppressQuerySuggestion', (noteId, document) => {
            if (!noteId) return;
            suppressNote(noteId, 'querySuggestion');
            if (document) validateDocument(document, getIndex);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.ignoreDiagnostic', async (document, diagnostic) => {
            if (!document || !diagnostic) return;
            await ignoreDiagnostic(document, diagnostic);
            const noteId = getPathIndex().get(document.uri.fsPath) || extractCanonicalIdFromFrontmatter(document.getText()) || null;
            if (noteId) {
                const code = /** @type {any} */ (diagnostic.code)?.value ?? diagnostic.code ?? null;
                emitOutcomeEvent({
                    type: 'suggestion_ignored',
                    noteId,
                    field: `diagnostic:${code || 'unknown'}`,
                    newValue: diagnostic.message || null,
                    source: 'vscode',
                    cause: 'ignore_diagnostic',
                    meta: {
                        diagnosticCode: code,
                        line: diagnostic.range?.start?.line ?? null
                    }
                });
            }
            validateDocument(document, getIndex);
        })
    );

    function isFrontmatterDiagnostic(document, diagnostic) {
        if (!document || !diagnostic?.range?.start) return false;
        const text = document.getText();
        const firstDashIdx = text.indexOf('---');
        const closingDashIdx = firstDashIdx !== -1 ? text.indexOf('---', firstDashIdx + 3) : -1;
        if (firstDashIdx === -1 || closingDashIdx === -1) return false;
        const closingLine = text.slice(0, closingDashIdx).split('\n').length - 1;
        const startLine = diagnostic.range.start.line;
        const endLine = diagnostic.range.end?.line ?? startLine;
        return startLine > 0 && endLine < closingLine;
    }

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            'markdown',
            {
                provideCodeActions(document, range, codeActionContext) {
                    const actions = [];
                    const seenIds = new Set();
                    const diagnostics = Array.isArray(codeActionContext?.diagnostics)
                        ? codeActionContext.diagnostics
                        : [];
                    const hasTemplateDriftDiagnostic = diagnostics.some((diagnostic) => {
                        const code = /** @type {any} */ (diagnostic.code)?.value ?? diagnostic.code;
                        return code === 'yamlink.templateDrift';
                    });

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

                    for (const diagnostic of diagnostics) {
                        if (diagnostic.source !== 'yamlink') continue;
                        if (isDiagnosticIgnored(document, diagnostic)) continue;

                        const code = /** @type {any} */ (diagnostic.code)?.value ?? diagnostic.code;

                        if (isFrontmatterDiagnostic(document, diagnostic)) {
                            const ignoreAction = new vscode.CodeAction(
                                'Yamlink: Ignore this suggestion here',
                                vscode.CodeActionKind.QuickFix
                            );
                            ignoreAction.command = {
                                command: 'yamlink.ignoreDiagnostic',
                                title: 'Ignore this suggestion here',
                                arguments: [document, diagnostic]
                            };
                            ignoreAction.diagnostics = [diagnostic];
                            actions.push(ignoreAction);
                        }

                        if (code === 'yamlink.missingId') {
                            const fileName = canonicalizeId(path.basename(document.uri.fsPath, '.md'));
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
                            const suppressAction = new vscode.CodeAction(
                                'Yamlink: Don\'t suggest views for this note',
                                vscode.CodeActionKind.QuickFix
                            );
                            suppressAction.command = {
                                command: 'yamlink.suppressQuerySuggestion',
                                title: 'Suppress view suggestions',
                                arguments: [nodeId, document]
                            };
                            suppressAction.diagnostics = [diagnostic];
                            actions.push(suppressAction);
                        }

                        if (code === 'yamlink.templateDrift') {
                            const noteType = document.getText().match(/^\s*type:\s*(.+?)$/m)?.[1]?.trim() || 'note';
                            const fieldList = diagnostic.message.replace(/^Yamlink: Missing template fields:\s*/, '');
                            const driftAction = new vscode.CodeAction(
                                `Yamlink: Add missing "${noteType}" fields (${fieldList})`,
                                vscode.CodeActionKind.QuickFix
                            );
                            driftAction.command = {
                                command: 'yamlink.addMissingTemplateFields',
                                title: 'Add missing template fields'
                            };
                            driftAction.diagnostics = [diagnostic];
                            driftAction.isPreferred = true;
                            actions.push(driftAction);
                        }

                        if (code === 'yamlink.duplicateId') {
                            const thisId = extractCanonicalIdFromFrontmatter(document.getText());
                            if (thisId) {
                                const action = new vscode.CodeAction(
                                    `Yamlink: Rename id "${thisId}" to resolve conflict`,
                                    vscode.CodeActionKind.QuickFix
                                );
                                action.command = {
                                    command: 'yamlink.resolveIdConflict',
                                    title: 'Rename ID',
                                    arguments: [document, thisId]
                                };
                                action.diagnostics = [diagnostic];
                                action.isPreferred = true;
                                actions.push(action);
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

                            let resolvedType = null;
                            if (fieldName) {
                                resolvedType = getExpectedRelationTypes(fieldName, {
                                    noteType: '',
                                    fieldsCache: getFieldsCache(),
                                    generation: getVaultGeneration()
                                })[0] || null;
                            }

                            // Get source note info for smart reverse relation backfill
                            const sourceId = getPathIndex().get(document.uri.fsPath) ?? null;
                            const sourceFields = sourceId ? (getFieldsCache().get(sourceId) || {}) : {};
                            const sourceType = sourceFields.type ? String(sourceFields.type).toLowerCase() : null;

                            const fieldCount = resolvedType
                                ? (() => {
                                    const fc = getFieldsCache();
                                    let n = 0;
                                    for (const f of fc.values()) {
                                        if (String(f.type || '').toLowerCase() === resolvedType) n++;
                                    }
                                    const freq = new Map();
                                    const SKIP = new Set(['id', 'type', 'created', 'updated', 'modified']);
                                    for (const f of fc.values()) {
                                        if (String(f.type || '').toLowerCase() !== resolvedType) continue;
                                        for (const k of Object.keys(f)) {
                                            if (!SKIP.has(k)) freq.set(k, (freq.get(k) || 0) + 1);
                                        }
                                    }
                                    if (n === 0) return 0;
                                    return [...freq.values()].filter(c => c >= Math.ceil(n * 0.5)).length;
                                })()
                                : 0;

                            const typeHint = resolvedType
                                ? resolvedType
                                : null;
                            const label = typeHint
                                ? `Yamlink: Create ${typeHint} "${id}"${fieldCount > 0 ? ` (${fieldCount} fields)` : ''}`
                                : `Yamlink: Create note "${id}"`;

                            const action = new vscode.CodeAction(label, vscode.CodeActionKind.QuickFix);
                            action.command = {
                                command: 'yamlink.createNote',
                                title: 'Create Node',
                                arguments: [id, resolvedType, document.uri.fsPath, sourceId, sourceType, true]
                            };
                            action.diagnostics = [diagnostic];
                            action.isPreferred = true;
                            actions.push(action);
                        }
                    }

                    const templateHint = getMissingTemplateFieldsForDocument(document);
                    if (
                        templateHint &&
                        !hasTemplateDriftDiagnostic &&
                        range?.start?.line === templateHint.typeLineIndex
                    ) {
                        const action = new vscode.CodeAction(
                            `Yamlink: Use the ${templateHint.noteType} schema from Smart Templates`,
                            vscode.CodeActionKind.QuickFix
                        );
                        action.command = {
                            command: 'yamlink.addMissingTemplateFields',
                            title: 'Fill template fields'
                        };
                        action.isPreferred = true;
                        actions.push(action);
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
                            const lineText = document.lineAt(range.start.line).text;
                            const parsedField = lineText.match(/^\s*([\w-]+)\s*:/)?.[1]?.toLowerCase() || '';
                            if (parsedField === 'type') return actions;
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

    registerViewCommands(context, getTypes);
    registerNodeCommands(context, getIndex, getTypes);
}

module.exports = {
    buildStarterViewQuery,
    registerCodeActions,
    buildLikelyRepairActions,
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
