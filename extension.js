const vscode = require('vscode');
const fs     = require('fs');
const path   = require('path');
const { buildIndex, updateSingleFile, removeFileFromIndex, getIndex, getPathIndex, getFieldsCache, getGraphStats } = require('./src/core/index');
const { getEdges } = require('./src/core/graph');
const { getPrimaryWorkspaceRoot } = require('./src/core/workspace');
const { registerDefinition } = require('./src/features/definition');
const { registerCompletion } = require('./src/features/completion');
const { registerViewLightbulb } = require('./src/features/viewLightbulb');
const { registerDiagnostics, validateAll, validateDocument, getBrokenCount, clearAll } = require('./src/diagnostics/diagnostics');
const { registerCodeActions } = require('./src/actions/codeActions');
const { registerRename } = require('./src/core/rename');
const { registerDecorations } = require('./src/features/decorations');
const { parseFrontmatterDocument } = require('./src/core/frontmatter');
const { buildNoteExportModel, exportNotePdf } = require('./src/export/pdf');
const { openHealthPanel, updatePanel } = require('./src/features/healthPanel');
const { openViewPanel, refreshViewPanel, closeViewPanel, getOpenViewDocumentPath, setViewPanelStateListener } = require('./src/features/viewPanel');
const { registerViewCodeLens } = require('./src/features/viewCodeLens');
const { openCalendarPanel, refreshCalendarPanel, registerCalendarView, focusCalendarView } = require('./src/features/calendarPanel');
const { openGraph2Panel, refreshGraph2Panel, registerGraphView, refreshGraphSidebarView } = require('./src/features/graphPanel');
const { buildRunGraphOptions, buildRunVaultGraphOptions } = require('./src/features/graph2/graph2LaunchOptions');
const { syncEntityHub, refreshEntityHub, registerEntityHubView, focusEntityHub } = require('./src/features/entityHub');
const { importObsidianVault } = require('./src/features/importObsidian');
const { registerActiveViewRuntime } = require('./src/runtime/activeViewRuntime');
const { createRefreshRouter } = require('./src/runtime/refreshRouter');
const { createStatusRuntime } = require('./src/runtime/statusRuntime');
const { perfTracker } = require('./src/runtime/performanceTracker');
const { createPreviewPanelController } = require('./src/features/preview/previewPanelController');

// ─────────────────────────────────────────────────────────────────
// What's new — shown once per version upgrade, never on first install
// ─────────────────────────────────────────────────────────────────
async function showWhatsNew(context) {
    const lastSeen = context.globalState.get('yamlink.lastSeenVersion', '');
    const current  = context.extension.packageJSON.version;
    if (lastSeen === current) return;

    context.globalState.update('yamlink.lastSeenVersion', current);

    // First install already shows welcome.md — skip the release notes there.
    const isFirstInstall = !context.globalState.get('yamlink.welcomeShown', false);
    if (isFirstInstall) return;

    const notesPath = path.join(context.extensionPath, 'WHATS_NEW.md');
    if (!fs.existsSync(notesPath)) return;

    await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(notesPath));
}

// ─────────────────────────────────────────────────────────────────
// First-run setup
//
// Fires once per machine, tracked via globalState.
// Copies sample/ files into the user's workspace root (never
// overwrites anything that already exists), then opens welcome.md.
//
// After the first run this returns immediately on every activation.
// The user can delete the sample files whenever they want — they are
// just regular Markdown files in their vault after the copy.
// ─────────────────────────────────────────────────────────────────
async function runFirstTimeSetup(context) {
    const hasSeenWelcome = context.globalState.get('yamlink.welcomeShown', false);
    if (hasSeenWelcome) return;

    if (!vscode.workspace.workspaceFolders) return;

    const workspaceRoot = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
    if (!workspaceRoot) return;
    const sampleSrcDir  = path.join(context.extensionPath, 'sample');

    if (!fs.existsSync(sampleSrcDir)) {
        console.warn('Yamlink — sample/ folder not found in extension. Skipping first-run.');
        context.globalState.update('yamlink.welcomeShown', true);
        return;
    }

    try {
        copySampleFiles(sampleSrcDir, workspaceRoot);
    } catch (e) {
        console.error('Yamlink — Error copying sample files:', e.message);
    }

    // Mark done before opening the file to avoid re-triggering
    context.globalState.update('yamlink.welcomeShown', true);

    const welcomePath = path.join(workspaceRoot, 'welcome.md');
    if (fs.existsSync(welcomePath)) {
        try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(welcomePath));
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        } catch (e) {
            console.error('Yamlink — Could not open welcome.md:', e.message);
        }
    }
}

// Recursively copies src → dest. Never overwrites existing files.
// Creates subdirectories (like _templates/) as needed.
function copySampleFiles(src, dest) {
    for (const entry of fs.readdirSync(src)) {
        const srcPath  = path.join(src, entry);
        const destPath = path.join(dest, entry);

        if (fs.statSync(srcPath).isDirectory()) {
            if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
            copySampleFiles(srcPath, destPath);
        } else if (!fs.existsSync(destPath)) {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// activate
// ─────────────────────────────────────────────────────────────────
async function activate(context) {
    console.log("Yamlink activated");

    // ── Public API event emitter ─────────────────────────────────────────────
    const _onVaultChange = new vscode.EventEmitter();
    context.subscriptions.push(_onVaultChange);

    // ── Build index ──────────────────────────────────────────────────────────
    perfTracker.measureSync('index.buildIndex.activate', null, () => buildIndex(vscode.workspace.workspaceFolders));

    const { updateStatusBar, refreshSuggestionBar, resetSuggestionCache } = createStatusRuntime(context, {
        getIndex,
        getPathIndex,
        getBrokenCount,
        computeSuggestionsForNode: require('./src/engine/suggestions').computeSuggestionsForNode
    });

    // ── Register providers ───────────────────────────────────────────────────
    // registerDiagnostics MUST come before validateAll.
    registerDefinition(context, getIndex);
    registerCompletion(context, getIndex);
    registerViewLightbulb(context);
    // registerHover(context, getIndex);
    // registerQueryPreviewHover(context, getIndex);
    registerDiagnostics(context, getIndex);
    registerCodeActions(context, getIndex);
    registerRename(context, getIndex, getPathIndex, buildIndex, validateAll);
    registerEntityHubView(context);
    registerCalendarView(context);
    registerGraphView(context);
    const decorationsProvider = registerDecorations(context, getIndex);
    const codeLensProvider = registerViewCodeLens(context, getOpenViewDocumentPath);
    const { openPreviewPanel, refreshPreviewPanel } = createPreviewPanelController();
    setViewPanelStateListener(() => codeLensProvider.refresh());

    validateAll(getIndex);
    updateStatusBar();

    // ── Refresh router — single source of truth for coordinated refreshes ───
    const router = createRefreshRouter({
        clearDiagnostics:  clearAll,
        validateAll:       () => validateAll(getIndex),
        validateTargeted:  () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'markdown') {
                validateDocument(editor.document, getIndex);
            }
        },
        refreshDecorations:() => decorationsProvider.refresh(),
        refreshStatusBar:  updateStatusBar,
        refreshHealthPanel:updatePanel,
        refreshViews:      refreshViewPanel,
        refreshGraph2:     refreshGraph2Panel,
        refreshGraphSidebar: refreshGraphSidebarView,
        refreshEntityHub:  refreshEntityHub,
        refreshCalendar:   refreshCalendarPanel,
        refreshSuggestions:refreshSuggestionBar
    });

    // Diagnostics fire an initial validation pass after 1500ms (graph warm-up).
    // Run updateStatusBar slightly after so the suggestion bar reflects that
    // settled state on first open, not the cold-start snapshot.
    setTimeout(() => { updateStatusBar(); refreshSuggestionBar(); }, 1600);

    // ── First-run setup ──────────────────────────────────────────────────────
    // Non-blocking — errors are caught so they never crash activation.
    runFirstTimeSetup(context).catch(e => {
        console.error('Yamlink — First-run setup error:', e.message);
    });

    showWhatsNew(context).catch(e => {
        console.error('Yamlink — What\'s new error:', e.message);
    });

    // ── Dirty flag + background full-rebuild fallback ────────────────────────
    //
    // Mass events (many files created/deleted at once, e.g. git pull) set
    // needsFullRebuild = true. A 20-second inactivity timer then runs
    // buildIndex() in the background, showing progress in vaultBar.
    //
    // This catches anything the incremental updater misses without making
    // normal single-file saves pay the full-scan cost.
    let needsFullRebuild  = false;
    let inactivityTimer   = null;
    const IDLE_DELAY_MS   = 20_000; // 20 seconds of no saves → background rebuild

    function scheduleBackgroundRebuild() {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
            if (!needsFullRebuild) return;
            if (!vscode.workspace.workspaceFolders) return;

            const clearSpinner = vscode.window.setStatusBarMessage('$(sync~spin) Yamlink  re-indexing…');

            // yield to the event loop so the status bar update paints first
            setImmediate(() => {
                try {
                    perfTracker.measureSync('index.buildIndex.background', null, () => buildIndex(vscode.workspace.workspaceFolders));
                    needsFullRebuild = false;
                    updateStatusBar();
                    const s = getGraphStats();
                    vscode.window.setStatusBarMessage(
                        `Yamlink indexed: ${getIndex().size} nodes · ${s.totalEdges} edges`,
                        5000
                    );
                } catch (e) {
                    console.error('Yamlink — Background rebuild failed:', e.message);
                } finally {
                    clearSpinner.dispose();
                }
                router.refreshForPassiveIndexSweep();
            });
        }, IDLE_DELAY_MS);
    }

    // ── Full rebuild cycle (for renames, deletes, create-single) ────────────
    function rebuildAll() {
        if (!vscode.workspace.workspaceFolders) return;
        perfTracker.measureSync('index.buildIndex.rebuildAll', null, () => buildIndex(vscode.workspace.workspaceFolders));
        router.refreshForPassiveIndexSweep();
        _onVaultChange.fire({ changedId: null, full: true });
    }

    function refreshAfterViewEdit() {
        router.refresh({ full: true });
    }

    context.subscriptions.push(vscode.workspace.onDidRenameFiles(() => rebuildAll()));

    // .yamlinkignore changes — rebuild immediately so new rules take effect without a restart.
    const ignoreFileWatcher = vscode.workspace.createFileSystemWatcher('**/.yamlinkignore');
    context.subscriptions.push(
        ignoreFileWatcher,
        ignoreFileWatcher.onDidCreate(() => rebuildAll()),
        ignoreFileWatcher.onDidChange(() => rebuildAll()),
        ignoreFileWatcher.onDidDelete(() => rebuildAll())
    );

    // Delete — single file: incremental removal. Batch: defer to background timer.
    context.subscriptions.push(vscode.workspace.onDidDeleteFiles(e => {
        if (e.files.length > 1) {
            needsFullRebuild = true;
            scheduleBackgroundRebuild();
            return;
        }
        const filePath = e.files[0].fsPath;
        if (!filePath.endsWith('.md')) return;
        const wasKnown = removeFileFromIndex(filePath);
        if (wasKnown) {
            router.refreshForPassiveIndexSweep();
            _onVaultChange.fire({ changedId: null, full: true });
        }
    }));

    // Create — single file: attempt incremental index. Batch: defer to background timer.
    // updateSingleFile handles new files correctly as long as they have valid frontmatter.
    // If the file has no id: yet (freshly created, still empty) it's a no-op — the save
    // handler will pick it up once the user adds frontmatter and saves.
    context.subscriptions.push(vscode.workspace.onDidCreateFiles(e => {
        if (e.files.length > 1) {
            needsFullRebuild = true;
            scheduleBackgroundRebuild();
            return;
        }
        const filePath = e.files[0].fsPath;
        if (!filePath.endsWith('.md')) return;
        const result = updateSingleFile(filePath, { workspaceFolders: vscode.workspace.workspaceFolders });
        if (result.needsFull) {
            rebuildAll();
        } else if (result.changed) {
            router.refreshForIndexMutation(result);
        }
    }));

    // Smart save handler
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
            const filePath = doc.uri.fsPath;
            let result = { changed: false, needsFull: false };

            if (filePath.endsWith('.md')) {
                result = updateSingleFile(filePath, { workspaceFolders: vscode.workspace.workspaceFolders });
                if (result.needsFull && vscode.workspace.workspaceFolders) {
                    perfTracker.measureSync('index.buildIndex.saveFallback', null, () => buildIndex(vscode.workspace.workspaceFolders));
                }
                if (!result.needsFull) {
                    clearTimeout(inactivityTimer);
                    scheduleBackgroundRebuild();
                }
            }

            // Re-validate diagnostics only when the index actually changed.
            // Skipping on unchanged saves avoids redundant work on every keystroke+save.
            // Exception: non-markdown files (e.g. settings) still clear stale markers.
            // Re-validate open documents that the saved file points TO via backlinks.
            // When contact3.md gains "account: [[acme]]", acme.md is the node whose
            // backlink count just crossed the suggestion threshold — not contact3.md.
            // We walk the outbound edges of the saved file and re-validate each target.
            if (filePath.endsWith('.md')) {
                const savedId = getPathIndex().get(filePath);
                if (savedId) {
                    const outbound = getEdges(savedId);
                    const idIndex  = getIndex();
                    for (const edge of outbound) {
                        const targetPath = idIndex.get(edge.targetId);
                        if (!targetPath) continue;
                        const openDoc = vscode.workspace.textDocuments.find(
                            d => d.uri.fsPath === targetPath
                        );
                        if (openDoc) validateDocument(openDoc, getIndex);
                    }
                }
            }

            router.refreshForIndexMutation(result, { forceHeavy: !filePath.endsWith('.md') });
            if (result.changed || result.needsFull) {
                _onVaultChange.fire({ changedId: result.changedId ?? null, full: !!result.needsFull });
                if (doc === vscode.window.activeTextEditor?.document && activeViewRuntime) activeViewRuntime.schedule('save');
            }
        })
    );
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        updateStatusBar();
        if (editor && editor.document.languageId === 'markdown') {
            validateDocument(editor.document, getIndex);
            syncEntityHub(context);
            refreshCalendarPanel();
        } else {
            syncEntityHub(context);
        }
        refreshGraph2Panel();
        refreshPreviewPanel();
        resetSuggestionCache();
        refreshSuggestionBar();
    }));

    const activeViewRuntime = registerActiveViewRuntime(context, {
        updateStatusBar,
        refreshSuggestionBar
    });

    // ── Commands ─────────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.showPerformanceReport', () => {
            perfTracker.showReport();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.resetPerformanceReport', () => {
            perfTracker.reset();
            vscode.window.showInformationMessage('Yamlink: Performance metrics reset.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.importObsidianVault', async () => {
            await importObsidianVault(context, {
                buildIndex,
                getWorkspaceRoot: getPrimaryWorkspaceRoot
            });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.openHealthPanel', () => {
            openHealthPanel(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.openView', (query, label) => {
            openViewPanel(context, '# ' + label + '\n\n' + query + '\n', refreshAfterViewEdit, null);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.openHub', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.yamlinkSidebar');
            try { await vscode.commands.executeCommand('yamlink.noteReport.focus'); } catch (_) {}
            syncEntityHub(context, { immediate: true });
            focusEntityHub();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.openCalendar', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.yamlinkSidebar');
            try { await vscode.commands.executeCommand('yamlink.calendar.focus'); } catch (_) {}
            openCalendarPanel();
            focusCalendarView();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.runViews', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'markdown') {
                openViewPanel(context, editor.document.getText(), refreshAfterViewEdit, editor.document.uri.fsPath);
                if (typeof activeViewRuntime !== 'undefined' && activeViewRuntime) activeViewRuntime.reset();
                codeLensProvider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.runViewsAt', (tabIndex) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'markdown') {
                openViewPanel(context, editor.document.getText(), refreshAfterViewEdit, editor.document.uri.fsPath, typeof tabIndex === 'number' ? tabIndex : 0);
                if (typeof activeViewRuntime !== 'undefined' && activeViewRuntime) activeViewRuntime.reset();
                codeLensProvider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.closeViewPanel', () => {
            closeViewPanel();
            codeLensProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.runGraph', () => {
            console.log('Yamlink — runGraph invoked (Graph 2.0)');
            try {
                const activeEditor = vscode.window.activeTextEditor;
                const hasNote = activeEditor && activeEditor.document.languageId === 'markdown';
                openGraph2Panel(context, buildRunGraphOptions(hasNote));
            } catch (error) {
                const message = error && error.message ? error.message : String(error || 'Unknown graph 2.0 error');
                console.error('Yamlink — runGraph failed:', error);
                vscode.window.showErrorMessage(`Yamlink graph failed: ${message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.runVaultGraph', () => {
            console.log('Yamlink — runVaultGraph invoked (Graph 2.0)');
            try {
                openGraph2Panel(context, buildRunVaultGraphOptions());
            } catch (error) {
                const message = error && error.message ? error.message : String(error || 'Unknown graph 2.0 error');
                console.error('Yamlink — runVaultGraph failed:', error);
                vscode.window.showErrorMessage(`Yamlink vault graph failed: ${message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.runGraph2Preview', () => {
            console.log('Yamlink — runGraph2Preview invoked');
            try {
                openGraph2Panel(context, {
                    source: 'current',
                    scope: 'neighborhood',
                    depth: 2,
                    nodeCap: 128
                });
            } catch (error) {
                const message = error && error.message ? error.message : String(error || 'Unknown graph 2.0 error');
                console.error('Yamlink — runGraph2Preview failed:', error);
                vscode.window.showErrorMessage(`Yamlink graph 2.0 failed: ${message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.openNotePreview', () => {
            openPreviewPanel(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.openGraphSidebar', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.yamlinkSidebar');
            try { await vscode.commands.executeCommand('yamlink.graph.focus'); } catch (_) {}
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.exportActiveNotePdf', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'markdown') {
                vscode.window.showErrorMessage('Yamlink: Open a Markdown note before exporting to PDF.');
                return;
            }

            const docText = editor.document.getText();
            let parsed;
            try {
                parsed = parseFrontmatterDocument(docText);
            } catch (e) {
                vscode.window.showErrorMessage('Yamlink: Could not parse frontmatter — make sure the --- block is closed.');
                return;
            }
            const noteId = String(parsed.data?.id || '').trim();
            const baseName = noteId || path.basename(editor.document.uri.fsPath, '.md') || 'yamlink-note';
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(path.dirname(editor.document.uri.fsPath), `${baseName}.pdf`)),
                filters: { PDF: ['pdf'] },
                saveLabel: 'Export Note PDF'
            });
            if (!uri) return;

            const model = buildNoteExportModel(docText, noteId || null);
            exportNotePdf(uri.fsPath, model);
            vscode.window.showInformationMessage(`Yamlink: Exported "${baseName}" to PDF`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.copyId', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'markdown') {
                vscode.window.showInformationMessage('Yamlink: Open a Markdown note to copy its ID.');
                return;
            }
            const nodeId = getPathIndex().get(editor.document.uri.fsPath);
            if (!nodeId) {
                vscode.window.showInformationMessage('Yamlink: This file has no id: field yet.');
                return;
            }
            await vscode.env.clipboard.writeText(`[[${nodeId}]]`);
            vscode.window.setStatusBarMessage(`Yamlink: Copied [[${nodeId}]]`, 3000);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.openHoverNote', async (filePath) => {
            if (!filePath || typeof filePath !== 'string') return;
            try {
                const doc = await vscode.workspace.openTextDocument(filePath);
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
            } catch (error) {
                console.error('Yamlink — openHoverNote failed:', error?.message || error);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.showQuerySuggestionsQuickPick', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'markdown') return;

            const nodeId = getPathIndex().get(editor.document.uri.fsPath);
            if (!nodeId) return;

            const { computeSuggestionsForNode } = require('./src/engine/suggestions');
            const sugg = computeSuggestionsForNode(nodeId, editor.document.getText());
            if (sugg.length === 0) return;

            const items = sugg.map(s => ({
                label:       `$(light-bulb) ${s.count} ${s.sourceType}s linked via "${s.field}"`,
                description: s.queryText,
                suggestion:  s
            }));

            const pick = await vscode.window.showQuickPick(items, {
                title:       'Yamlink — Insert view block',
                placeHolder: 'Select a suggestion to insert into this note'
            });

            if (pick) {
                await vscode.commands.executeCommand(
                    'yamlink.insertViewBlock',
                    editor.document,
                    pick.suggestion.queryText,
                    pick.suggestion.sourceType,
                    pick.suggestion.field,
                    nodeId
                );
            }
        })
    );

    // ── Public API ───────────────────────────────────────────────────────────
    return {
        getIndex:        () => getIndex(),
        getFieldsCache:  () => getFieldsCache(),
        getPathIndex:    () => getPathIndex(),
        getSchema:       (type) => require('./src/registries/schemaRegistry').getSchema(type),
        getSchemaTargets:() => require('./src/registries/schemaRegistry').getSchemaTargets(),
        query: (queryText, opts = {}) => {
            const { parseViewQuery, runQuery } = require('./src/engine/query');
            const parsed = parseViewQuery(queryText);
            if (!parsed) return { success: false, rows: [], columns: [], warnings: [], error: 'Could not parse query' };
            return runQuery(parsed, opts.contextNodeId ?? null);
        },
        onVaultChange: _onVaultChange.event
    };
}

function deactivate() {}

module.exports = { activate, deactivate };
