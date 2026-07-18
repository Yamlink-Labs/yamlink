'use strict';

const path = require('path');
const vscode = require('vscode');
const {
    chooseImportDestination,
    createImportStats,
    analyzeImportedVault,
    formatImportSummaryLabel,
    formatImportSummaryDescription,
    buildImportReportMarkdown,
    buildFilenameIdMigrationPreview,
    applyMissingFilenameIds,
    buildAppliedMigrationReportMarkdown,
    applyCanonicalWikilinkRewrite,
    buildAppliedLinkRewriteReportMarkdown,
    buildCombinedCleanupReportMarkdown
} = require('../importers/obsidian');
const {
    stripHtmlToMarkdownish,
    parseCsvTable,
    formatExternalInspectionSummary,
    buildExternalImportReportMarkdown
} = require('../importers/shared');
const {
    normalizeRoamText,
    renderRoamBlocks,
    importRoamJsonToVault,
    inspectRoamExport
} = require('../importers/roam');
const {
    extractEvernoteResources,
    rewriteEvernoteContentLinks,
    saveEvernoteResources,
    importEvernoteEnexToVault,
    inspectEvernoteExport
} = require('../importers/evernote');
const {
    copyNotionExport,
    stripNotionSuffix,
    singularizeImportedType,
    inspectNotionExport,
    notionFieldKey,
    inferNotionPrimaryField,
    coerceNotionCellValue,
    rewriteNotionMarkdownLinks,
    postProcessNotionMarkdown,
    importNotionCsvDatabases
} = require('../importers/notion');

async function confirmExternalImport(platform, sourcePath, inspection) {
    const summary = formatExternalInspectionSummary(inspection);
    const picks = [
        {
            label: `$(arrow-right) Import ${platform.label} export`,
            description: platform.description,
            detail: summary || `Import ${path.basename(sourcePath)} into the current workspace`,
            action: 'import'
        },
        {
            label: '$(close) Cancel',
            description: 'Do not import.',
            action: 'cancel'
        }
    ];

    const picked = await vscode.window.showQuickPick(picks, {
        title: `Import ${platform.label} export`,
        placeHolder: summary || `Review ${path.basename(sourcePath)} before import`,
        matchOnDescription: true,
        matchOnDetail: true
    });

    return picked ? picked.action === 'import' : false;
}

async function importExternalVault(context, options = {}) {
    const buildIndex = options.buildIndex;
    const getWorkspaceRoot = options.getWorkspaceRoot;
    const workspaceRoot = getWorkspaceRoot ? getWorkspaceRoot(vscode.workspace.workspaceFolders) : null;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('Yamlink: Open a workspace folder first.');
        return;
    }

    const platform = await vscode.window.showQuickPick([
        {
            label: 'Roam Research',
            description: 'Import a JSON export into Yamlink notes',
            platformKind: 'roam',
            sourceMode: 'file'
        },
        {
            label: 'Notion',
            description: 'Import an extracted Markdown export folder',
            platformKind: 'notion',
            sourceMode: 'folder'
        },
        {
            label: 'Evernote',
            description: 'Import an ENEX export into Yamlink notes',
            platformKind: 'evernote',
            sourceMode: 'file'
        }
    ], {
        title: 'Import external vault export',
        placeHolder: 'Choose the source platform'
    });
    if (!platform) return;

    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: platform.sourceMode === 'file',
        canSelectFolders: platform.sourceMode === 'folder',
        openLabel: 'Import',
        title: `Select ${platform.label} export`
    });
    if (!picked || picked.length === 0) return;

    const sourcePath = picked[0].fsPath;
    let followUpAction = 'none';
    let inspection = null;

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Yamlink: Inspecting ${platform.label} export…`,
            cancellable: false
        }, async () => {
            if (platform.platformKind === 'roam') {
                inspection = inspectRoamExport(sourcePath);
            } else if (platform.platformKind === 'evernote') {
                inspection = inspectEvernoteExport(sourcePath);
            } else {
                inspection = inspectNotionExport(sourcePath);
            }
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Yamlink: ${error.message || `Could not inspect ${platform.label} export.`}`);
        return;
    }

    const shouldImport = await confirmExternalImport(platform, sourcePath, inspection);
    if (!shouldImport) return;

    const sourceBase = platform.sourceMode === 'folder'
        ? sourcePath
        : path.join(path.dirname(sourcePath), path.basename(sourcePath, path.extname(sourcePath)));
    const destinationRoot = chooseImportDestination(workspaceRoot, sourceBase);

    let stats = createImportStats();
    /** @type {ReturnType<typeof analyzeImportedVault>|null} */
    let analysis = null;

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Yamlink: Importing ${platform.label} export…`,
            cancellable: false
        }, async () => {
            if (platform.platformKind === 'roam') {
                stats = importRoamJsonToVault(sourcePath, destinationRoot);
            } else if (platform.platformKind === 'evernote') {
                stats = importEvernoteEnexToVault(sourcePath, destinationRoot);
            } else {
                stats = copyNotionExport(sourcePath, destinationRoot, createImportStats());
            }
            analysis = analyzeImportedVault(destinationRoot);
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Yamlink: ${error.message || `Import failed for ${platform.label}.`}`);
        return;
    }

    if (typeof buildIndex === 'function') {
        buildIndex(vscode.workspace.workspaceFolders);
    }

    const extraBits = [];
    if (stats.dailyNotesImported) extraBits.push(`${stats.dailyNotesImported} daily note${stats.dailyNotesImported === 1 ? '' : 's'}`);
    if (stats.attachmentsExtracted) extraBits.push(`${stats.attachmentsExtracted} attachment${stats.attachmentsExtracted === 1 ? '' : 's'}`);
    if (stats.rewrittenLinks) extraBits.push(`${stats.rewrittenLinks} links rewritten`);
    if (stats.databaseRowsImported) extraBits.push(`${stats.databaseRowsImported} database row note${stats.databaseRowsImported === 1 ? '' : 's'}`);
    const label = `${formatImportSummaryLabel(sourcePath, stats, analysis)}${extraBits.length ? ` · ${extraBits.join(' · ')}` : ''}`;
    vscode.window.showInformationMessage(label);

    const followUpOptions = [
        { label: 'Open Vault Health', action: 'health', description: formatImportSummaryDescription(analysis) },
        { label: 'Open import report', action: 'report', description: `Review what Yamlink found in the imported ${platform.label} export.` }
    ];
    if (analysis?.filenameIdCandidates?.length) {
        followUpOptions.push({
            label: 'Open filename-to-id migration preview',
            action: 'migration',
            description: 'Review notes that still need canonical ids before a deeper cleanup pass.'
        });
        followUpOptions.push({
            label: 'Apply missing id fields (safe)',
            action: 'applyMissingIds',
            description: 'Add filename-derived ids only where id is currently missing. No link rewriting.'
        });
    }
    if (analysis?.filenameMatchedLinks) {
        followUpOptions.push({
            label: 'Rewrite filename-style wikilinks to canonical ids',
            action: 'rewriteLinks',
            description: 'Normalize imported `[[links]]` toward canonical Yamlink note ids.'
        });
    }
    if (analysis?.filenameIdCandidates?.length || analysis?.filenameMatchedLinks) {
        followUpOptions.push({
            label: 'Apply missing ids and rewrite links',
            action: 'applyIdsAndRewrite',
            description: 'Run the strongest cleanup pass for imported notes that still look filename-driven.'
        });
    }
    followUpOptions.push({ label: 'Do nothing', action: 'none', description: 'Leave the imported notes in place and continue.' });

    const followUp = await vscode.window.showQuickPick(followUpOptions, {
        title: `${platform.label} import complete`,
        placeHolder: formatImportSummaryDescription(analysis) || 'Choose a follow-up action'
    });

    if (!followUp || followUp.action === 'none') {
        return {
            ok: true,
            platform: platform.label,
            platformKind: platform.platformKind,
            sourcePath,
            importedRoot: destinationRoot,
            followUpAction,
            stats,
            analysis
        };
    }
    followUpAction = followUp.action;
    if (followUp.action === 'health') {
        await vscode.commands.executeCommand('yamlink.openHealthPanel');
        return {
            ok: true,
            platform: platform.label,
            platformKind: platform.platformKind,
            sourcePath,
            importedRoot: destinationRoot,
            followUpAction,
            stats,
            analysis
        };
    }
    if (followUp.action === 'report') {
        const report = buildImportReportMarkdown(destinationRoot, stats, analysis, {
            mode: 'copy',
            isObsidian: false,
            platformName: platform.label
        });
        const externalReport = buildExternalImportReportMarkdown(destinationRoot, stats, analysis, platform.label);
        const doc = await vscode.workspace.openTextDocument({ content: externalReport || report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        return {
            ok: true,
            platform: platform.label,
            platformKind: platform.platformKind,
            sourcePath,
            importedRoot: destinationRoot,
            followUpAction,
            stats,
            analysis
        };
    }
    if (followUp.action === 'migration') {
        const preview = buildFilenameIdMigrationPreview(destinationRoot, analysis);
        const doc = await vscode.workspace.openTextDocument({ content: preview, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        return {
            ok: true,
            platform: platform.label,
            platformKind: platform.platformKind,
            sourcePath,
            importedRoot: destinationRoot,
            followUpAction,
            stats,
            analysis
        };
    }
    if (followUp.action === 'applyMissingIds') {
        const answer = await vscode.window.showWarningMessage(
            `Yamlink: Apply filename-derived id fields to imported ${platform.label} notes that are currently missing id? This will modify imported Markdown files, but it will not rewrite links.`,
            { modal: true },
            'Apply missing ids',
            'Cancel'
        );
        if (answer !== 'Apply missing ids') return;

        /** @type {any} */
        let result = { applied: [], skipped: [] };
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Yamlink: Applying imported ${platform.label} ids`,
            cancellable: false
        }, async () => {
            result = applyMissingFilenameIds(destinationRoot);
            if (typeof buildIndex === 'function') {
                await new Promise(resolve => setTimeout(resolve, 50));
                buildIndex(vscode.workspace.workspaceFolders);
            }
        });

        const report = buildAppliedMigrationReportMarkdown(destinationRoot, {
            ...result,
            platformName: platform.label
        });
        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        return {
            ok: true,
            platform: platform.label,
            platformKind: platform.platformKind,
            sourcePath,
            importedRoot: destinationRoot,
            followUpAction,
            stats,
            analysis
        };
    }
    if (followUp.action === 'rewriteLinks') {
        const answer = await vscode.window.showWarningMessage(
            `Yamlink: Rewrite imported ${platform.label} filename-style wikilinks to canonical note ids? This will modify imported Markdown files, but anchors, block refs, and visible labels are preserved where possible.`,
            { modal: true },
            'Rewrite links',
            'Cancel'
        );
        if (answer !== 'Rewrite links') return;

        /** @type {any} */
        let result = { changedFiles: [], rewritesApplied: 0 };
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Yamlink: Rewriting imported ${platform.label} wikilinks`,
            cancellable: false
        }, async () => {
            result = applyCanonicalWikilinkRewrite(destinationRoot);
            if (typeof buildIndex === 'function') {
                await new Promise(resolve => setTimeout(resolve, 50));
                buildIndex(vscode.workspace.workspaceFolders);
            }
        });

        const report = buildAppliedLinkRewriteReportMarkdown(destinationRoot, result);
        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        return {
            ok: true,
            platform: platform.label,
            platformKind: platform.platformKind,
            sourcePath,
            importedRoot: destinationRoot,
            followUpAction,
            stats,
            analysis
        };
    }
    if (followUp.action === 'applyIdsAndRewrite') {
        const answer = await vscode.window.showWarningMessage(
            `Yamlink: Apply missing filename-derived ids first, then rewrite filename-style wikilinks for the imported ${platform.label} notes? This is the strongest cleanup pass and will modify imported Markdown files.`,
            { modal: true },
            'Apply ids and rewrite',
            'Cancel'
        );
        if (answer !== 'Apply ids and rewrite') return;

        /** @type {any} */
        let combinedResult = {
            idResult: { applied: [], skipped: [] },
            linkResult: { changedFiles: [], rewritesApplied: 0 }
        };
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Yamlink: Applying ids and rewriting imported ${platform.label} wikilinks`,
            cancellable: false
        }, async () => {
            combinedResult.idResult = applyMissingFilenameIds(destinationRoot);
            combinedResult.linkResult = applyCanonicalWikilinkRewrite(destinationRoot);
            if (typeof buildIndex === 'function') {
                await new Promise(resolve => setTimeout(resolve, 50));
                buildIndex(vscode.workspace.workspaceFolders);
            }
        });

        const report = buildCombinedCleanupReportMarkdown(destinationRoot, combinedResult);
        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        return {
            ok: true,
            platform: platform.label,
            platformKind: platform.platformKind,
            sourcePath,
            importedRoot: destinationRoot,
            followUpAction,
            stats,
            analysis
        };
    }

    return {
        ok: true,
        platform: platform.label,
        platformKind: platform.platformKind,
        sourcePath,
        importedRoot: destinationRoot,
        followUpAction,
        stats,
        analysis
    };
}

module.exports = {
    stripHtmlToMarkdownish,
    normalizeRoamText,
    renderRoamBlocks,
    importRoamJsonToVault,
    extractEvernoteResources,
    rewriteEvernoteContentLinks,
    saveEvernoteResources,
    stripNotionSuffix,
    singularizeImportedType,
    inspectRoamExport,
    inspectEvernoteExport,
    inspectNotionExport,
    formatExternalInspectionSummary,
    parseCsvTable,
    notionFieldKey,
    inferNotionPrimaryField,
    coerceNotionCellValue,
    rewriteNotionMarkdownLinks,
    postProcessNotionMarkdown,
    importNotionCsvDatabases,
    buildExternalImportReportMarkdown,
    importEvernoteEnexToVault,
    copyNotionExport,
    importExternalVault
};
