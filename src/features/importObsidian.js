'use strict';

const path = require('path');
const vscode = require('vscode');
const {
    detectObsidianVault,
    shouldSkipImportEntry,
    chooseImportDestination,
    createImportStats,
    copyVaultContents,
    analyzeImportedVault,
    formatImportSummaryLabel,
    formatImportSummaryDescription,
    buildImportReportMarkdown,
    buildFilenameIdMigrationPreview,
    collectMissingIdCandidates,
    applyMissingFilenameIds,
    buildAppliedMigrationReportMarkdown,
    buildImportPreviewSummaryLine,
    splitWikilinkTarget,
    buildCanonicalWikilink,
    buildImportNoteTargetMap,
    rewriteFilenameStyleWikilinks,
    applyCanonicalWikilinkRewrite,
    buildAppliedLinkRewriteReportMarkdown,
    buildCombinedCleanupReportMarkdown
} = require('../importers/obsidian');

async function showImportPreviewAndPickMode(sourceRoot, analysis, hasWorkspace) {
    const summary = buildImportPreviewSummaryLine(analysis);
    const picks = [];

    if (hasWorkspace) {
        picks.push({
            label: '$(arrow-right) Copy into current workspace',
            description: 'Copies vault content. .obsidian/ is excluded.',
            detail: summary,
            mode: 'copy'
        });
        picks.push({
            label: '$(add) Add as workspace folder',
            description: 'Adds the folder to the current multi-root workspace.',
            detail: '.obsidian/ stays on disk but is not indexed.',
            mode: 'add'
        });
    } else {
        picks.push({
            label: '$(add) Add as workspace folder',
            description: 'Open vault as a workspace folder for Yamlink to index.',
            detail: summary,
            mode: 'add'
        });
    }

    picks.push({ label: '$(close) Cancel', description: 'Do not import.', mode: 'cancel' });

    const picked = await vscode.window.showQuickPick(picks, {
        title: `Import "${path.basename(sourceRoot)}"`,
        placeHolder: summary,
        matchOnDescription: true,
        matchOnDetail: true
    });

    return picked ? picked.mode : 'cancel';
}

async function showIdAssignmentQuestion(analysis) {
    const missing = analysis.markdownFiles - analysis.notesWithId;
    if (missing <= 0) return false;

    const detail = analysis.filenameMatchedLinks
        ? `${analysis.filenameMatchedLinks} existing [[wikilinks]] use filename-style targets - they will resolve automatically once IDs are assigned.`
        : 'Yamlink resolves [[wikilinks]] by id: field. Notes without one are invisible to the graph.';

    const picked = await vscode.window.showQuickPick([
        {
            label: `$(check) Yes - assign filename IDs to ${missing} note${missing === 1 ? '' : 's'}`,
            description: 'Recommended',
            detail,
            assign: true
        },
        {
            label: '$(close) No - skip for now',
            description: 'IDs can be applied later from the follow-up menu.',
            detail: 'Notes without id: will not appear in the graph until IDs are assigned.',
            assign: false
        }
    ], {
        title: `${missing} note${missing === 1 ? ' has' : 's have'} no id: field`,
        placeHolder: 'Use the filename as the id: for notes that are missing one?',
        matchOnDescription: false,
        matchOnDetail: false
    });

    return picked ? picked.assign : false;
}

async function importObsidianVault(context, options = {}) {
    const buildIndex = options.buildIndex;
    const getWorkspaceRoot = options.getWorkspaceRoot;

    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: false,
        canSelectFolders: true,
        openLabel: 'Import Vault',
        title: 'Select an Obsidian vault folder'
    });

    if (!picked || picked.length === 0) return;

    const sourceUri = picked[0];
    const sourceRoot = sourceUri.fsPath;
    const hasWorkspace = Array.isArray(vscode.workspace.workspaceFolders) && vscode.workspace.workspaceFolders.length > 0;

    let preAnalysis;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Yamlink: Scanning "${path.basename(sourceRoot)}"...`,
        cancellable: false
    }, async () => {
        preAnalysis = analyzeImportedVault(sourceRoot);
    });

    const mode = await showImportPreviewAndPickMode(sourceRoot, preAnalysis, hasWorkspace);
    if (!mode || mode === 'cancel') return;
    let followUpAction = 'none';

    const assignIds = await showIdAssignmentQuestion(preAnalysis);

    const isObsidian = detectObsidianVault(sourceRoot);
    let importedRoot = sourceRoot;
    let importStats = createImportStats();

    if (mode === 'copy') {
        const workspaceRoot = getWorkspaceRoot ? getWorkspaceRoot(vscode.workspace.workspaceFolders) : null;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('Yamlink: Open a workspace folder first, or use "Add as workspace folder" instead.');
            return;
        }

        const destinationRoot = chooseImportDestination(workspaceRoot, sourceRoot);
        importStats = copyVaultContents(sourceRoot, destinationRoot);
        importedRoot = destinationRoot;
    } else if (mode === 'add') {
        const existing = vscode.workspace.workspaceFolders || [];
        const alreadyOpen = existing.some(folder => path.resolve(folder.uri.fsPath) === path.resolve(sourceRoot));
        if (!alreadyOpen) {
            vscode.workspace.updateWorkspaceFolders(existing.length, 0, {
                uri: sourceUri,
                name: path.basename(sourceRoot)
            });
        }
    }

    /** @type {any} */
    let idMigrationResult = null;
    if (assignIds) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Yamlink: Assigning filename IDs in "${path.basename(importedRoot)}"...`,
            cancellable: false
        }, async () => {
            idMigrationResult = applyMissingFilenameIds(importedRoot);
        });
    }

    if (typeof buildIndex === 'function') {
        if (mode === 'add') await new Promise(resolve => setTimeout(resolve, 150));
        buildIndex(vscode.workspace.workspaceFolders);
    }

    const analysis = preAnalysis;
    const summaryLabel = formatImportSummaryLabel(sourceRoot, importStats, analysis);
    const summaryDescription = formatImportSummaryDescription(analysis);
    const suffix = isObsidian
        ? mode === 'copy'
            ? ' (.obsidian ignored)'
            : ' (.obsidian stays local and is not indexed)'
        : '';
    const idSuffix = idMigrationResult
        ? ` · ${idMigrationResult.applied.length} id${idMigrationResult.applied.length === 1 ? '' : 's'} assigned`
        : '';
    vscode.window.showInformationMessage(`${summaryLabel}${idSuffix}${suffix}`);

    const followUpOptions = [
        { label: 'Open Vault Health', action: 'health', description: summaryDescription },
        { label: 'Open import report', action: 'report', description: 'Review what Yamlink found in the imported vault before doing anything else.' },
        { label: 'Open filename-to-id migration preview', action: 'migration', description: 'See which notes would likely need canonical id review before a later migration.' }
    ];
    followUpOptions.push({ label: 'Rewrite filename-style wikilinks to canonical ids', action: 'rewriteLinks', description: 'Safely rewrite imported [[links]] so the graph and relation surfaces point at canonical Yamlink ids.' });
    if (!assignIds) {
        followUpOptions.push({ label: 'Apply missing id fields (safe)', action: 'applyMissingIds', description: 'Add filename-derived id fields only where id is currently missing. No link rewriting.' });
        followUpOptions.push({ label: 'Apply missing ids and rewrite links', action: 'applyIdsAndRewrite', description: 'Recommended full cleanup for imported vaults that still use filename-style structure.' });
    }
    followUpOptions.push({ label: 'Do nothing', action: 'none', description: 'Leave the imported vault in place and continue working.' });

    const followUp = await vscode.window.showQuickPick(followUpOptions, {
        title: 'Obsidian vault imported',
        placeHolder: summaryDescription || 'Choose a follow-up action'
    });

    const action = followUp ? followUp.action : 'none';
    followUpAction = action;
    if (action === 'health') {
        await vscode.commands.executeCommand('yamlink.openHealthPanel');
    } else if (action === 'report') {
        const report = buildImportReportMarkdown(importedRoot, importStats, analysis, { mode, isObsidian });
        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    } else if (action === 'migration') {
        const preview = buildFilenameIdMigrationPreview(importedRoot, analysis);
        const doc = await vscode.workspace.openTextDocument({ content: preview, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    } else if (action === 'applyMissingIds') {
        const answer = await vscode.window.showWarningMessage(
            'Yamlink: Apply filename-derived id fields to notes that are currently missing id? This will modify imported Markdown files, but it will not rewrite links.',
            { modal: true },
            'Apply missing ids',
            'Cancel'
        );
        if (answer !== 'Apply missing ids') return;

        let result = { applied: [], skipped: [] };
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Yamlink: Applying missing Obsidian ids',
            cancellable: false
        }, async () => {
            result = applyMissingFilenameIds(importedRoot);
            if (typeof buildIndex === 'function') {
                await new Promise(resolve => setTimeout(resolve, 50));
                buildIndex(vscode.workspace.workspaceFolders);
            }
        });

        const report = buildAppliedMigrationReportMarkdown(importedRoot, result);
        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    } else if (action === 'rewriteLinks') {
        const answer = await vscode.window.showWarningMessage(
            'Yamlink: Rewrite imported filename-style wikilinks to canonical note ids? This will modify imported Markdown files, but it keeps anchors, block refs, and visible labels intact where possible.',
            { modal: true },
            'Rewrite links',
            'Cancel'
        );
        if (answer !== 'Rewrite links') return;

        let result = { changedFiles: [], rewritesApplied: 0 };
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Yamlink: Rewriting imported wikilinks',
            cancellable: false
        }, async () => {
            result = applyCanonicalWikilinkRewrite(importedRoot);
            if (typeof buildIndex === 'function') {
                await new Promise(resolve => setTimeout(resolve, 50));
                buildIndex(vscode.workspace.workspaceFolders);
            }
        });

        const report = buildAppliedLinkRewriteReportMarkdown(importedRoot, result);
        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    } else if (action === 'applyIdsAndRewrite') {
        const answer = await vscode.window.showWarningMessage(
            'Yamlink: Apply missing filename-derived ids first, then rewrite filename-style wikilinks to canonical note ids? This is the strongest cleanup pass for imported Obsidian vaults and will modify imported Markdown files.',
            { modal: true },
            'Apply ids and rewrite',
            'Cancel'
        );
        if (answer !== 'Apply ids and rewrite') return;

        let combinedResult = {
            idResult: { applied: [], skipped: [] },
            linkResult: { changedFiles: [], rewritesApplied: 0 }
        };
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Yamlink: Applying ids and rewriting imported wikilinks',
            cancellable: false
        }, async () => {
            combinedResult.idResult = applyMissingFilenameIds(importedRoot);
            combinedResult.linkResult = applyCanonicalWikilinkRewrite(importedRoot);
            if (typeof buildIndex === 'function') {
                await new Promise(resolve => setTimeout(resolve, 50));
                buildIndex(vscode.workspace.workspaceFolders);
            }
        });

        const report = buildCombinedCleanupReportMarkdown(importedRoot, combinedResult);
        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    }

    return {
        ok: true,
        platform: 'Obsidian',
        sourceRoot,
        importedRoot,
        mode,
        followUpAction,
        stats: importStats,
        analysis,
        idMigrationApplied: idMigrationResult ? idMigrationResult.applied.length : 0
    };
}

module.exports = {
    detectObsidianVault,
    shouldSkipImportEntry,
    chooseImportDestination,
    createImportStats,
    copyVaultContents,
    analyzeImportedVault,
    formatImportSummaryLabel,
    formatImportSummaryDescription,
    buildImportReportMarkdown,
    buildFilenameIdMigrationPreview,
    collectMissingIdCandidates,
    applyMissingFilenameIds,
    buildAppliedMigrationReportMarkdown,
    buildImportPreviewSummaryLine,
    splitWikilinkTarget,
    buildCanonicalWikilink,
    buildImportNoteTargetMap,
    rewriteFilenameStyleWikilinks,
    applyCanonicalWikilinkRewrite,
    buildAppliedLinkRewriteReportMarkdown,
    buildCombinedCleanupReportMarkdown,
    showIdAssignmentQuestion,
    importObsidianVault
};
