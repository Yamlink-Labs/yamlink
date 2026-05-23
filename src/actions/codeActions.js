const vscode = require('vscode');
const path = require('path');
const { getTypes } = require('../registries/typeRegistry');
const { getSchema } = require('../registries/schemaRegistry');
const { isOrphan } = require('../core/graph');
const { computeSuggestionsForNode } = require('../engine/suggestions');
const { getFieldsCache, getPathIndex } = require('../core/indexService');
const { canonicalizeId, extractCanonicalIdFromFrontmatter } = require('../core/id');
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

function registerCodeActions(context, getIndex) {

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

                            const label = resolvedType
                                ? `Yamlink: Create ${resolvedType} "${id}"${fieldCount > 0 ? ` (${fieldCount} fields)` : ''}`
                                : `Yamlink: Create node "${id}"`;

                            const action = new vscode.CodeAction(label, vscode.CodeActionKind.QuickFix);
                            action.command = {
                                command: 'yamlink.createNote',
                                title: 'Create Node',
                                arguments: [id, resolvedType, document.uri.fsPath, sourceId, sourceType]
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
