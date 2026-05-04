'use strict';

const vscode = require('vscode');
const { parseAllViewQueries } = require('../engine/query');
const { parseFrontmatter, getFieldsCache, getPathIndex } = require('../core/indexService');
const {
    buildFrontmatterGuidanceSummary,
    buildBodyMentionHints
} = require('../intelligence/frontmatterIntelligence');
const { filterItemsForSurface } = require('../intelligence/confidence');
const { buildActivationContext } = require('../engine/suggestions');
const { getCachedContext } = require('../intelligence/activationCache');

function getFrontmatterRange(document) {
    const lines = document.getText().split('\n');
    let openLine = -1;
    let closeLine = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^---\s*$/.test(lines[i])) {
            if (openLine === -1) openLine = i;
            else {
                closeLine = i;
                break;
            }
        }
    }
    return openLine !== -1 && closeLine !== -1 ? { openLine, closeLine } : null;
}

function buildAdaptiveFrontmatterActions(document) {
    const fmRange = getFrontmatterRange(document);
    if (!fmRange) return [];

    const frontmatter = parseFrontmatter(document.getText());
    if (!frontmatter) return [];

    const nodeId     = String(frontmatter.id || '').trim();
    const nodeType   = String(frontmatter.type || '').trim().toLowerCase();
    const fieldsCache = getFieldsCache();

    // Use activation cache only when the document is saved and the node is indexed —
    // dirty documents may have unsaved frontmatter changes not yet in fieldsCache.
    const nodeFields = fieldsCache.get(nodeId) || frontmatter;
    const { frontmatterOpportunities: opportunities } =
        (!document.isDirty && fieldsCache.has(nodeId))
            ? getCachedContext(nodeId, () => buildActivationContext(nodeId, nodeFields, nodeType, fieldsCache))
            : buildActivationContext(nodeId, nodeFields, nodeType, fieldsCache);
    const guidance = buildFrontmatterGuidanceSummary(opportunities);
    if (!opportunities.likelyFields.length && !opportunities.likelyConnections.length) return [];

    const actions = [];
    const actionContexts = filterItemsForSurface(opportunities.likelyContexts || [], 'frontmatter-actions', { scoreScale: 700 });
    const actionCompanions = filterItemsForSurface(opportunities.likelyCompanions || [], 'frontmatter-actions', { scoreScale: 700 });
    const actionConnections = filterItemsForSurface(opportunities.likelyConnections || [], 'frontmatter-actions', { scoreScale: 700 });
    const actionRelationViews = filterItemsForSurface(opportunities.relationViews || [], 'frontmatter-actions', { scoreScale: 900 });
    const actionThreadViews = filterItemsForSurface(opportunities.contextThreadViews || [], 'frontmatter-actions', { scoreScale: 900 });
    const actionSetups = filterItemsForSurface(opportunities.surroundingSetups || [], 'frontmatter-actions', { scoreScale: 1100 });
    const insertPosition = new vscode.Position(fmRange.closeLine, 0);
    if (guidance.bestNextStep?.insertText) {
        const starterAction = new vscode.CodeAction(
            `Apply smart starter: ${guidance.bestNextStep.label}`,
            vscode.CodeActionKind.QuickFix
        );
        const starterEdit = new vscode.WorkspaceEdit();
        starterEdit.insert(document.uri, insertPosition, guidance.bestNextStep.insertText);
        starterAction.edit = starterEdit;
        starterAction.isPreferred = true;
        starterAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        actions.push(starterAction);
    }

    const completionInsertText = opportunities.recommendedBundle?.insertText || opportunities.setupInsertText || '';
    if (guidance.bestNextStep?.insertText && completionInsertText) {
        const combinedInsert = `${guidance.bestNextStep.insertText}${completionInsertText}`;
        const completeAction = new vscode.CodeAction(
            `Complete likely setup: ${guidance.bestNextStep.label}`,
            vscode.CodeActionKind.QuickFix
        );
        const completeEdit = new vscode.WorkspaceEdit();
        completeEdit.insert(document.uri, insertPosition, combinedInsert);
        completeAction.edit = completeEdit;
        completeAction.isPreferred = true;
        completeAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        actions.push(completeAction);
    }

    if (opportunities.setupFields.length > 0 && opportunities.setupInsertText) {
        const setupAction = new vscode.CodeAction(
            `Add likely setup: ${opportunities.setupFields.map((hint) => hint.field).join(', ')}`,
            vscode.CodeActionKind.QuickFix
        );
        const setupEdit = new vscode.WorkspaceEdit();
        setupEdit.insert(document.uri, insertPosition, opportunities.setupInsertText);
        setupAction.edit = setupEdit;
        setupAction.isPreferred = true;
        setupAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        actions.push(setupAction);
    }

    if (opportunities.recommendedBundle?.fields?.length && opportunities.recommendedBundle.insertText) {
        const bundleAction = new vscode.CodeAction(
            `Add recommended bundle: ${opportunities.recommendedBundle.fields.map((hint) => hint.field).join(', ')}`,
            vscode.CodeActionKind.QuickFix
        );
        const bundleEdit = new vscode.WorkspaceEdit();
        bundleEdit.insert(document.uri, insertPosition, opportunities.recommendedBundle.insertText);
        bundleAction.edit = bundleEdit;
        bundleAction.isPreferred = true;
        bundleAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        actions.push(bundleAction);
    }
    if (opportunities.contextBundle?.summary && opportunities.contextBundle.insertText) {
        const flowAction = new vscode.CodeAction(
            `Add usual flow: ${opportunities.contextBundle.summary}`,
            vscode.CodeActionKind.QuickFix
        );
        const flowEdit = new vscode.WorkspaceEdit();
        flowEdit.insert(document.uri, insertPosition, opportunities.contextBundle.insertText);
        flowAction.edit = flowEdit;
        flowAction.isPreferred = false;
        flowAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        actions.push(flowAction);
    }

    for (const contextHint of actionContexts.slice(0, 2)) {
        const contextAction = new vscode.CodeAction(
            `Add likely context: ${contextHint.field} → ${contextHint.targetId}`,
            vscode.CodeActionKind.QuickFix
        );
        const contextEdit = new vscode.WorkspaceEdit();
        contextEdit.insert(document.uri, insertPosition, contextHint.insertText);
        contextAction.edit = contextEdit;
        contextAction.isPreferred = false;
        contextAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        actions.push(contextAction);
    }
    for (const companionHint of actionCompanions.slice(0, 2)) {
        const companionAction = new vscode.CodeAction(
            `Link nearby companion: ${companionHint.candidateId}`,
            vscode.CodeActionKind.QuickFix
        );
        const companionEdit = new vscode.WorkspaceEdit();
        companionEdit.insert(document.uri, insertPosition, companionHint.insertText);
        companionAction.edit = companionEdit;
        companionAction.isPreferred = false;
        companionAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        actions.push(companionAction);
    }

    if (opportunities.relationSetupFields.length > 1 && opportunities.relationSetupInsertText) {
        const relationSetupAction = new vscode.CodeAction(
            `Add likely relation setup: ${opportunities.relationSetupFields.map((hint) => hint.field).join(', ')}`,
            vscode.CodeActionKind.QuickFix
        );
        const relationSetupEdit = new vscode.WorkspaceEdit();
        relationSetupEdit.insert(document.uri, insertPosition, opportunities.relationSetupInsertText);
        relationSetupAction.edit = relationSetupEdit;
        relationSetupAction.isPreferred = false;
        relationSetupAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        actions.push(relationSetupAction);
    }

    for (const connection of actionConnections) {
        const connectionAction = new vscode.CodeAction(
            `Link this note to ${connection.candidateId}`,
            vscode.CodeActionKind.QuickFix
        );
        const connectionEdit = new vscode.WorkspaceEdit();
        connectionEdit.insert(document.uri, insertPosition, connection.insertText);
        connectionAction.edit = connectionEdit;
        connectionAction.isPreferred = false;
        connectionAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        actions.push(connectionAction);
    }

    const blockInsertPosition = new vscode.Position(fmRange.closeLine + 1, 0);
    for (const view of actionRelationViews.slice(0, 2)) {
        const viewAction = new vscode.CodeAction(
            `Insert related view: ${view.sourceType} around ${view.relatedId}`,
            vscode.CodeActionKind.RefactorRewrite
        );
        const viewEdit = new vscode.WorkspaceEdit();
        viewEdit.insert(document.uri, blockInsertPosition, `\n${view.queryText}\n`);
        viewAction.edit = viewEdit;
        viewAction.isPreferred = false;
        viewAction.command = {
            command: 'yamlink.runViews',
            title: 'Run Yamlink view'
        };
        actions.push(viewAction);
    }
    for (const view of actionThreadViews.slice(0, 2)) {
        const threadAction = new vscode.CodeAction(
            `Insert usual thread: ${view.summary}`,
            vscode.CodeActionKind.RefactorRewrite
        );
        const threadEdit = new vscode.WorkspaceEdit();
        threadEdit.insert(document.uri, blockInsertPosition, `\n${view.queryText}\n`);
        threadAction.edit = threadEdit;
        threadAction.isPreferred = false;
        threadAction.command = {
            command: 'yamlink.runViews',
            title: 'Run Yamlink view'
        };
        actions.push(threadAction);
    }
    for (const setup of actionSetups.slice(0, 2)) {
        const surroundingAction = new vscode.CodeAction(
            `Insert surrounding setup: ${setup.summary}`,
            vscode.CodeActionKind.RefactorRewrite
        );
        const surroundingEdit = new vscode.WorkspaceEdit();
        surroundingEdit.insert(document.uri, blockInsertPosition, setup.blockText);
        surroundingAction.edit = surroundingEdit;
        surroundingAction.isPreferred = false;
        surroundingAction.command = {
            command: 'yamlink.runViews',
            title: 'Run Yamlink view'
        };
        actions.push(surroundingAction);
    }

    const bodyMentions = buildBodyMentionHints(document.getText(), frontmatter, fieldsCache, { threshold: 2 });
    for (const mention of bodyMentions.slice(0, 2)) {
        const times = mention.count === 1 ? 'once' : `${mention.count}×`;
        const bodyAction = new vscode.CodeAction(
            `Add body mention as field: [[${mention.id}]] (${times})`,
            vscode.CodeActionKind.QuickFix
        );
        const bodyEdit = new vscode.WorkspaceEdit();
        bodyEdit.insert(document.uri, insertPosition, mention.insertText);
        bodyAction.edit = bodyEdit;
        bodyAction.isPreferred = false;
        bodyAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        actions.push(bodyAction);
    }

    for (const hint of opportunities.likelyFields) {
        const action = new vscode.CodeAction(`Add likely field: ${hint.field}`, vscode.CodeActionKind.QuickFix);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, insertPosition, hint.insertText);
        action.edit = edit;
        action.isPreferred = false;
        action.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        actions.push(action);

        if (hint.relational && Array.isArray(hint.sampleTargets) && hint.sampleTargets.length) {
            const linkAction = new vscode.CodeAction(
                `Add likely link: ${hint.field} → ${hint.sampleTargets[0]}`,
                vscode.CodeActionKind.QuickFix
            );
            const linkEdit = new vscode.WorkspaceEdit();
            linkEdit.insert(document.uri, insertPosition, hint.relationInsertText || `${hint.field}: [[${hint.sampleTargets[0]}]]\n`);
            linkAction.edit = linkEdit;
            linkAction.isPreferred = false;
            linkAction.command = {
                command: 'yamlink.openHub',
                title: 'Open Yamlink Note Report'
            };
            actions.push(linkAction);
        }
    }

    return actions;
}

function registerViewLightbulb(context) {
    const provider = {
        provideCodeActions(document, range) {
            if (!document || document.languageId !== 'markdown') return undefined;
            const line = document.lineAt(range.start.line).text;
            if (!line.trim().startsWith('!view ')) {
                const fmRange = getFrontmatterRange(document);
                if (!fmRange || range.start.line <= fmRange.openLine || range.start.line >= fmRange.closeLine) return undefined;
                const actions = buildAdaptiveFrontmatterActions(document);
                return actions.length ? actions : undefined;
            }
            const queries = parseAllViewQueries(document.getText());
            if (!queries || queries.length === 0) return undefined;

            const run = new vscode.CodeAction('Run Yamlink view', vscode.CodeActionKind.QuickFix);
            run.command = { command: 'yamlink.runViews', title: 'Run Yamlink view' };
            run.isPreferred = true;

            const insert = new vscode.CodeAction('Insert Yamlink starter view', vscode.CodeActionKind.RefactorRewrite);
            insert.command = { command: 'yamlink.insertViewBlock', title: 'Insert Yamlink starter view' };

            const builder = new vscode.CodeAction('Open Yamlink Query Builder', vscode.CodeActionKind.RefactorRewrite);
            builder.command = { command: 'yamlink.queryBuilder', title: 'Open Yamlink Query Builder' };

            const refine = new vscode.CodeAction('Refine this Yamlink view', vscode.CodeActionKind.RefactorRewrite);
            refine.command = { command: 'yamlink.refineViewBlock', title: 'Refine this Yamlink view', arguments: [document, range] };

            return [run, insert, builder, refine];
        }
    };

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('markdown', provider, {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite]
        })
    );
}

module.exports = { registerViewLightbulb, buildAdaptiveFrontmatterActions };
