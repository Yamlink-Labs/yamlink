const vscode = require('vscode');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { buildIndex, updateSingleFile, removeFileFromIndex, getIndex, getPathIndex, getFieldsCache, getGraphStats, getVaultGeneration } = require('./src/core/index');
const { getEdges, isOrphan } = require('./src/core/graph');
const { getPrimaryWorkspaceRoot } = require('./src/core/workspace');
const { registerDefinition } = require('./src/features/definition');
const { registerHover, registerQueryPreviewHover } = require('./src/features/hover');
const { registerCompletion } = require('./src/features/completion');
const { registerViewLightbulb } = require('./src/features/viewLightbulb');
const { registerDiagnostics, validateAll, validateDocument, getBrokenCount, clearAll } = require('./src/diagnostics/diagnostics');
const { registerCodeActions } = require('./src/actions/codeActions');
const { registerBlockReferenceCommands } = require('./src/actions/blockReferenceCommands');
const { registerRename } = require('./src/core/rename');
const { registerDecorations } = require('./src/features/decorations');
const { parseFrontmatterDocument } = require('./src/core/frontmatter');
const { buildNoteExportModel, exportNotePdf } = require('./src/export/pdf');
const { openHealthPanel, updatePanel } = require('./src/features/healthPanel');
const { openHomePanel, refreshHomePanel } = require('./src/features/homePanel');
const { openViewPanel, refreshViewPanel, closeViewPanel, getOpenViewDocumentPath, setViewPanelStateListener } = require('./src/features/viewPanel');
const { registerViewCodeLens } = require('./src/features/viewCodeLens');
const { openCalendarPanel, refreshCalendarPanel, registerCalendarView, focusCalendarView } = require('./src/features/calendarPanel');
const { registerGraphView, refreshGraphSidebarView } = require('./src/features/graphPanel');
const { createGraphPanelController } = require('./src/features/graph/graphPanelController');
const { syncEntityHub, refreshEntityHub, registerEntityHubView, focusEntityHub } = require('./src/features/entityHub');
const { registerNoteOutlineView } = require('./src/features/noteOutline');
const { importObsidianVault } = require('./src/features/importObsidian');
const { importExternalVault } = require('./src/features/importExternalVaults');
const { runGitHistoryImport } = require('./src/intelligence/gitHistoryImport');
const { registerActiveViewRuntime } = require('./src/runtime/activeViewRuntime');
const { createRefreshRouter } = require('./src/runtime/refreshRouter');
const { createStatusRuntime } = require('./src/runtime/statusRuntime');
const { createTaskNotificationRuntime } = require('./src/runtime/taskNotifications');
const { perfTracker } = require('./src/runtime/performanceTracker');
const { initMutationLog, appendMutationEvents, emitOutcomeEvent, getMutationEvents, setDefaultMutationContextProvider } = require('./src/runtime/mutationEventLog');
const { createMutationSessionRuntime } = require('./src/runtime/mutationSession');
const { setMutationEventsProvider } = require('./src/intelligence/vaultPriors');
const { setMutationAppender: setCompletionTrackerAppender, clearPending: clearCompletionPending, onSelectionChanged: onCompletionSelectionChanged } = require('./src/features/completionTracker');
const { createPreviewPanelController } = require('./src/features/preview/previewPanelController');
const { createLiveNotePanelController } = require('./src/features/preview/liveNotePanelController');
const { buildTaskRows } = require('./src/core/tasks');
const { initSuppressions } = require('./src/core/suppressions');
const { appendHealthSnapshot } = require('./src/core/healthSnapshot');

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

    // ── Mutation event log — load persisted history before first index build ─
    const _vaultRoot = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
    const _currentSessionId = 'session-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    if (_vaultRoot) {
        const _yamLinkDir = path.join(_vaultRoot, '.yamlink');
        initMutationLog(path.join(_yamLinkDir, 'mutation-log.ndjson'));
        initSuppressions(_yamLinkDir);
    }
    setMutationEventsProvider(getMutationEvents);
    setCompletionTrackerAppender(appendMutationEvents);
    const mutationSessionRuntime = createMutationSessionRuntime(context);
    setDefaultMutationContextProvider(() => ({
        source: 'vscode',
        sessionId: _currentSessionId,
        meta: mutationSessionRuntime.getContext().meta
    }));
    context.subscriptions.push({
        dispose() {
            setDefaultMutationContextProvider(null);
        }
    });

    // ── Outcome event commands ───────────────────────────────────────────────
    // Internal commands fired by completion items and lightbulb actions to log
    // user feedback. These are not user-facing — the underscore prefix signals
    // that they are internal to the extension.
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink._completionAccepted', (payload) => {
            if (!payload || !payload.noteId || !payload.field) return;
            clearCompletionPending();
            appendMutationEvents([{
                type: 'completion_accepted',
                noteId: payload.noteId,
                field: payload.field,
                newValue: payload.targetId ? `[[${payload.targetId}]]` : null,
                oldValue: null,
                source: 'vscode',
                cause: 'completion_accept',
                meta: {
                    confidence: payload.confidence,
                    source: payload.source,
                    category: payload.category,
                    targetId: payload.targetId
                }
            }]);
        }),
        vscode.commands.registerCommand('yamlink._lightbulbApplied', (payload) => {
            if (!payload || !payload.noteId || !payload.field) return;
            appendMutationEvents([{
                type: 'lightbulb_applied',
                noteId: payload.noteId,
                field: payload.field,
                newValue: payload.action || null,
                oldValue: null,
                source: 'vscode',
                cause: 'lightbulb_apply',
                meta: {
                    confidence: payload.confidence,
                    source: payload.source,
                    action: payload.action
                }
            }]);
        }),
        vscode.commands.registerCommand('yamlink._addMissingField', async (payload) => {
            if (!payload || !payload.noteId || !payload.field) return;
            const filePath = getIndex().get(payload.noteId);
            if (!filePath) {
                vscode.window.showWarningMessage(`Yamlink: Note "${payload.noteId}" not found in index.`);
                return;
            }

            let doc;
            try {
                doc = await vscode.workspace.openTextDocument(filePath);
            } catch (err) {
                vscode.window.showErrorMessage(`Yamlink: Could not open note — ${err.message}`);
                return;
            }

            // Locate the frontmatter closing ---
            const lines = doc.getText().split('\n');
            let closingLine = -1;
            let sawOpen = false;
            for (let i = 0; i < lines.length; i++) {
                if (/^---\s*$/.test(lines[i])) {
                    if (!sawOpen) { sawOpen = true; continue; }
                    closingLine = i;
                    break;
                }
            }
            if (closingLine === -1) {
                vscode.window.showWarningMessage('Yamlink: Note has no frontmatter closing ---.');
                return;
            }

            // Preserve the field name casing from the payload (arc surfaces it as-is from the vault)
            const fn = String(payload.field || '').trim();
            const fnLower = fn.toLowerCase();
            const alreadyExists = lines.slice(0, closingLine).some(l => {
                const m = l.match(/^([\w-]+)\s*:/);
                return m && m[1].trim().toLowerCase() === fnLower;
            });
            if (alreadyExists) {
                vscode.window.showInformationMessage(`Yamlink: Field "${fn}" already exists in this note.`);
                return;
            }

            // Insert field stub before the closing --- without stealing editor focus
            const stub = payload.isRelation ? `${fn}: [[\n` : `${fn}: \n`;
            const insertPos = new vscode.Position(closingLine, 0);
            const edit = new vscode.WorkspaceEdit();
            edit.insert(doc.uri, insertPos, stub);
            const ok = await vscode.workspace.applyEdit(edit);
            if (!ok) {
                vscode.window.showErrorMessage(`Yamlink: Could not insert field "${fn}".`);
                return;
            }

            // Save immediately so the index picks up the change
            await doc.save();

            emitOutcomeEvent({
                type: 'lightbulb_applied',
                noteId: payload.noteId,
                field: fnLower,
                newValue: 'addMissingField',
                source: 'vscode',
                cause: 'lightbulb_add_missing_field',
                meta: { action: 'addMissingField', source: 'arc' }
            });

            // Brief status confirmation — user stays in the Note Report
            vscode.window.setStatusBarMessage(`Yamlink: Added "${fn}" to ${payload.noteId}`, 3000);
        })
    );

    // ── Build index ──────────────────────────────────────────────────────────
    perfTracker.measureSync('index.buildIndex.activate', null, () => buildIndex(vscode.workspace.workspaceFolders));
    if (_vaultRoot) {
        const _idxForSnap = getIndex();
        const _orphanCount = [..._idxForSnap.keys()].filter(id => isOrphan(id)).length;
        appendHealthSnapshot(path.join(_vaultRoot, '.yamlink'), { broken: getBrokenCount(), orphans: _orphanCount });
    }

    // ── Backfill history for pre-existing notes ───────────────────────────────
    // Runs once per vault (guarded by a marker file). Seeds a synthetic
    // note_created event for every indexed note that has no log history yet,
    // using the file's mtime as the timestamp anchor.
    if (_vaultRoot) {
        const { getMutationEvents: _getME } = require('./src/runtime/mutationEventLog');
        const _backfillMarker = path.join(_vaultRoot, '.yamlink', 'history-backfill.done');
        if (!fs.existsSync(_backfillMarker)) {
            const _backfillEvents = [];
            for (const [noteId, filePath] of getIndex()) {
                if (_getME({ noteId, limit: 1 }).length > 0) continue;
                let mtimeMs;
                try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch (_) { continue; }
                _backfillEvents.push({
                    timestamp: new Date(mtimeMs).toISOString(),
                    type: 'note_created',
                    noteId,
                    field: null,
                    oldValue: null,
                    newValue: null
                });
            }
            if (_backfillEvents.length) appendMutationEvents(_backfillEvents);
            try {
                fs.mkdirSync(path.join(_vaultRoot, '.yamlink'), { recursive: true });
                fs.writeFileSync(_backfillMarker, new Date().toISOString(), 'utf8');
            } catch (_) {}
        }
    }

    const { updateStatusBar, refreshSuggestionBar, resetSuggestionCache } = createStatusRuntime(context, {
        getIndex,
        getPathIndex,
        getBrokenCount,
        computeSuggestionsForNode: require('./src/engine/suggestions').computeSuggestionsForNode
    });
    const { refreshTaskNotifications } = createTaskNotificationRuntime(context, {
        getIndex,
        getVaultGeneration,
        buildTaskRows
    });

    // ── Register providers ───────────────────────────────────────────────────
    // registerDiagnostics MUST come before validateAll.
    registerDefinition(context, getIndex);
    registerCompletion(context, getIndex);
    registerViewLightbulb(context);
    registerHover(context, getIndex);
    registerQueryPreviewHover(context, getIndex);
    registerDiagnostics(context, getIndex);
    registerCodeActions(context, getIndex);
    registerBlockReferenceCommands(context, getPathIndex);
    registerRename(context, getIndex, getPathIndex, buildIndex, validateAll);
    registerEntityHubView(context);
    registerNoteOutlineView(context);
    registerCalendarView(context);
    registerGraphView(context);
    const decorationsProvider = registerDecorations(context, getIndex);
    const codeLensProvider = registerViewCodeLens(context, getOpenViewDocumentPath);
    const { openPreviewPanel, refreshPreviewPanel } = createPreviewPanelController();
    const { openLiveNotePanel, refreshLiveNotePanel, refreshLiveNotePanelForDocument } = createLiveNotePanelController();
    const graphPanelController = createGraphPanelController();
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
        refreshGraph:      () => graphPanelController.refreshGraphPanel(),
        refreshGraphSidebar: refreshGraphSidebarView,
        refreshEntityHub:  refreshEntityHub,
        refreshCalendar:   refreshCalendarPanel,
        refreshSuggestions:refreshSuggestionBar,
        refreshHome:       refreshHomePanel,
        refreshTaskNotifications
    });

    // Diagnostics fire an initial validation pass after 1500ms (graph warm-up).
    // Run updateStatusBar slightly after so the suggestion bar reflects that
    // settled state on first open, not the cold-start snapshot.
    setTimeout(() => {
        updateStatusBar();
        refreshSuggestionBar();
        void refreshTaskNotifications({ force: true });
    }, 1600);

    // ── Home panel auto-open ─────────────────────────────────────────────────
    // Show on first activation for this vault root. After that, only on command.
    if (_vaultRoot) {
        const homeKey = `yamlink.homeShown.${_vaultRoot.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const alreadyShown = context.globalState.get(homeKey, false);
        if (!alreadyShown) {
            context.globalState.update(homeKey, true);
            // Small delay so the editor has settled before the panel opens
            setTimeout(() => openHomePanel(context), 800);
        }
    }

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
        if (_vaultRoot) {
            const _snap = getIndex();
            appendHealthSnapshot(path.join(_vaultRoot, '.yamlink'), {
                broken: getBrokenCount(),
                orphans: [..._snap.keys()].filter(id => isOrphan(id)).length
            });
        }
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
        const { removed, mutationEvents } = removeFileFromIndex(filePath);
        if (removed) {
            appendMutationEvents(mutationEvents);
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
        vscode.workspace.onDidChangeTextDocument((event) => {
            refreshLiveNotePanelForDocument(event.document);
        })
    );

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
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((event) => {
        if (!event.selections.length) return;
        if (event.textEditor.document.languageId !== 'markdown') return;
        const noteId = getPathIndex().get(event.textEditor.document.uri.fsPath) || null;
        onCompletionSelectionChanged(noteId, event.selections[0].active.line);
    }));

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        updateStatusBar();
        if (editor && editor.document.languageId === 'markdown') {
            validateDocument(editor.document, getIndex);
            syncEntityHub(context);
            refreshCalendarPanel();
        } else {
            syncEntityHub(context);
        }
        refreshPreviewPanel();
        refreshLiveNotePanel();
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
            const result = await importObsidianVault(context, {
                buildIndex,
                getWorkspaceRoot: getPrimaryWorkspaceRoot
            });
            if (result?.ok) {
                appendMutationEvents([{
                    type: 'vault_import_completed',
                    noteId: '__vault__',
                    field: 'obsidian',
                    oldValue: null,
                    newValue: result.importedRoot || result.sourceRoot || 'obsidian',
                    source: 'vscode',
                    cause: 'import_obsidian_vault',
                    meta: {
                        mode: result.mode || null,
                        followUpAction: result.followUpAction || 'none',
                        copied: result.stats?.copied || 0,
                        markdownCopied: result.stats?.markdownCopied || 0,
                        idMigrationApplied: result.idMigrationApplied || 0
                    }
                }]);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.importVaultExport', async () => {
            const result = await importExternalVault(context, {
                buildIndex,
                getWorkspaceRoot: getPrimaryWorkspaceRoot
            });
            if (result?.ok) {
                appendMutationEvents([{
                    type: 'vault_import_completed',
                    noteId: '__vault__',
                    field: String(result.platformKind || result.platform || 'external').toLowerCase(),
                    oldValue: null,
                    newValue: result.importedRoot || result.sourcePath || 'external',
                    source: 'vscode',
                    cause: 'import_external_vault',
                    meta: {
                        platform: result.platform || null,
                        followUpAction: result.followUpAction || 'none',
                        copied: result.stats?.copied || 0,
                        dailyNotesImported: result.stats?.dailyNotesImported || 0,
                        attachmentsExtracted: result.stats?.attachmentsExtracted || 0,
                        databaseRowsImported: result.stats?.databaseRowsImported || 0
                    }
                }]);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.importGitHistory', async () => {
            const workspaceRoot = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('Yamlink: Open a workspace folder first.');
                return;
            }

            /** @type {any} */
            let result;
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Yamlink: Importing git history…',
                cancellable: false
            }, async (progress) => {
                result = runGitHistoryImport(workspaceRoot, {
                    appendEvents: appendMutationEvents,
                    onProgress: ({ file, done, total }) => {
                        progress.report({ message: `${done + 1}/${total}: ${file}` });
                    }
                });
            });

            if (result.skipped) {
                if (result.reason === 'not-a-git-repo') {
                    vscode.window.showInformationMessage('Yamlink: This workspace is not a git repository — git history import skipped.');
                } else if (result.reason === 'already-done') {
                    vscode.window.showInformationMessage('Yamlink: Git history already imported. Delete .yamlink/git-history-import.done to re-run.');
                }
            } else {
                vscode.window.showInformationMessage(
                    `Yamlink: Git history imported — ${result.eventsEmitted} events from ${result.filesProcessed} file${result.filesProcessed === 1 ? '' : 's'}.`
                );
                appendMutationEvents([{
                    type: 'vault_import_completed',
                    noteId: '__vault__',
                    field: 'git-history',
                    oldValue: null,
                    newValue: workspaceRoot,
                    source: 'vscode',
                    cause: 'import_git_history',
                    meta: {
                        eventsEmitted: result.eventsEmitted || 0,
                        filesProcessed: result.filesProcessed || 0
                    }
                }]);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.naturalQuery', async () => {
            const { parseNaturalQuery, exampleQueries } = require('./src/intelligence/nlQuery');
            const { getCachedPriors } = require('./src/intelligence/vaultPriors');
            const { getTypes } = require('./src/registries/typeRegistry');

            const { getVaultGeneration: _getGen } = require('./src/core/indexService');
            const fieldsCache = getFieldsCache();
            const priors = getCachedPriors(fieldsCache, _getGen());
            const SYSTEM = new Set(['schema', 'template', 'dashboard']);
            const types = [...getTypes()].filter(t => !SYSTEM.has(t));

            const allFields = new Set();
            for (const [, bundle] of priors.typeFieldBundles) {
                for (const field of bundle.keys()) allFields.add(field);
            }

            const vocab = {
                types,
                fields: [...allFields],
                workflowFields: priors.workflowFields,
                noteIds: [...getIndex().keys()]
            };

            const examples = exampleQueries(types);
            const input = await vscode.window.showInputBox({
                prompt: 'Describe what you want to query in plain English',
                placeHolder: examples[0] || 'e.g., active contacts',
                title: 'Yamlink — Natural Query'
            });
            if (!input) return;

            const result = parseNaturalQuery(input, vocab);
            if (!result) {
                const examples2 = examples.slice(0, 3).join(' · ');
                vscode.window.showWarningMessage(
                    `Yamlink: Couldn't understand that query. Try: ${examples2}`,
                    'Try again'
                ).then(choice => {
                    if (choice === 'Try again') vscode.commands.executeCommand('yamlink.naturalQuery');
                });
                return;
            }

            // Show preview and ask to insert
            const picked = await vscode.window.showQuickPick(
                [
                    { label: result.query, description: result.explanation, picked: true },
                    { label: '$(pencil) Edit before inserting', description: 'Open the generated query for manual editing' }
                ],
                { title: 'Yamlink — Insert this view?', placeHolder: result.explanation }
            );
            if (!picked) return;

            let queryText = result.query;
            if (picked.label.startsWith('$(pencil)')) {
                const edited = await vscode.window.showInputBox({
                    value: result.query,
                    prompt: 'Edit the query before inserting',
                    title: 'Yamlink — Edit Query'
                });
                if (!edited) return;
                queryText = edited;
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('Yamlink: Open a Markdown note first.');
                return;
            }

            const insertPos = editor.selection.active;
            const lineText  = editor.document.lineAt(insertPos.line).text;
            const insertAt  = lineText.trim() === ''
                ? new vscode.Position(insertPos.line, 0)
                : new vscode.Position(insertPos.line + 1, 0);

            const block = `\n${queryText}\n`;
            const edit = new vscode.WorkspaceEdit();
            edit.insert(editor.document.uri, insertAt, block);
            await vscode.workspace.applyEdit(edit);

            // Position cursor inside the block and run views
            const newPos = new vscode.Position(insertAt.line + 1, queryText.length);
            editor.selection = new vscode.Selection(newPos, newPos);
            await vscode.commands.executeCommand('yamlink.runViews');
        }),

        vscode.commands.registerCommand('yamlink.openHome', () => {
            openHomePanel(context);
        }),

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
            console.log('Yamlink — runGraph invoked (x-graph)');
            try {
                graphPanelController.openGraphPanel(context, { mode: 'local' });
            } catch (error) {
                const message = error && error.message ? error.message : String(error || 'Unknown graph error');
                console.error('Yamlink — runGraph failed:', error);
                vscode.window.showErrorMessage(`Yamlink graph failed: ${message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.runVaultGraph', () => {
            console.log('Yamlink — runVaultGraph invoked (x-graph)');
            try {
                graphPanelController.openGraphPanel(context, { mode: 'vault' });
            } catch (error) {
                const message = error && error.message ? error.message : String(error || 'Unknown graph error');
                console.error('Yamlink — runVaultGraph failed:', error);
                vscode.window.showErrorMessage(`Yamlink vault graph failed: ${message}`);
            }
        })
    );


    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.openNotePreview', () => {
            openPreviewPanel(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.openLiveNote', () => {
            openLiveNotePanel(context);
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
        vscode.commands.registerCommand('yamlink.proposeSchema', async () => {
            const { detectClusters } = require('./src/intelligence/clusterEmergence');
            const { createSchemaNote } = require('./src/features/healthPanel');
            const clusters = detectClusters(getIndex(), getFieldsCache()).clusters
                .filter((c) => c.confidence === 'medium' || c.confidence === 'high');

            if (clusters.length === 0) {
                await createSchemaNote({ type: null, fields: [] });
                return;
            }

            const items = clusters.map((c) => ({
                label: c.dominantType ? `$(symbol-class) ${c.dominantType}` : '$(symbol-class) unnamed cluster',
                description: `${c.noteCount} notes · ${c.confidence} confidence`,
                detail: c.fields.join(', '),
                cluster: c
            }));
            items.push({ label: '$(plus) Create schema for a different type', description: '', detail: 'Enter type name manually', cluster: null });

            const pick = await vscode.window.showQuickPick(items, {
                title: 'Yamlink — Propose Schema',
                placeHolder: 'Select a detected cluster to name as a schema, or create one manually'
            });

            if (!pick) return;
            await createSchemaNote({
                type: pick.cluster ? pick.cluster.dominantType : null,
                fields: pick.cluster ? pick.cluster.fields : []
            });
        }),

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

function extendMarkdownIt(md) {
    const { calloutPlugin } = require('./src/export/markdownItCallouts');
    calloutPlugin(md);
    return md;
}

module.exports = { activate, deactivate, extendMarkdownIt };
