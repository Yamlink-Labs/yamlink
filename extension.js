const vscode = require('vscode');
const fs     = require('fs');
const path   = require('path');
const { buildIndex, updateSingleFile, removeFileFromIndex, getIndex, getPathIndex, getFieldsCache, getGraphStats, parseFrontmatter } = require('./src/core/index');
const { isOrphan, getEdges } = require('./src/core/graph');
const { getPrimaryWorkspaceRoot } = require('./src/core/workspace');
const { registerDefinition } = require('./src/features/definition');
const { registerCompletion } = require('./src/features/completion');
const { registerViewLightbulb } = require('./src/features/viewLightbulb');
const { registerHover, registerQueryPreviewHover } = require('./src/features/hover');
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
const { openGraphPanel, refreshGraphPanel, parseGraphBlocks } = require('./src/features/graphPanel');
const { syncEntityHub, refreshEntityHub, registerEntityHubView, focusEntityHub } = require('./src/features/entityHub');
const { registerActiveViewRuntime } = require('./src/runtime/activeViewRuntime');
const { createRefreshRouter } = require('./src/runtime/refreshRouter');

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

// ─────────────────────────────────────────────────────────────────
// Status bar — three items, each with one permanent purpose.
//
//  vaultBar   (left, 100) — always: node count + broken count → Health Panel
//  actionBar  (left, 98)  — contextual action like Run views / Calendar / Run graph
//
// Commands NEVER change. Only text and visibility change.
// ─────────────────────────────────────────────────────────────────

    // Vault summary — always visible, always opens Health Panel
    const vaultBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    vaultBar.name    = 'Yamlink Vault';
    vaultBar.command = 'yamlink.openHealthPanel';
    context.subscriptions.push(vaultBar);

    const actionBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    actionBar.name = 'Yamlink Action';
    context.subscriptions.push(actionBar);

    // Suggestion bar — shown on the RIGHT when the active node has view suggestions.
    // Yamlink-owned UI: never cursor-dependent, always visible, bypasses lightbulb.
    const suggestionBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    suggestionBar.name    = 'Yamlink Suggestions';
    suggestionBar.command = 'yamlink.showQuerySuggestionsQuickPick';
    context.subscriptions.push(suggestionBar);

    // ── Status bar rendering ─────────────────────────────────────────────────
    function updateStatusBar() {
        const nodeCount = getIndex().size;
        const broken    = getBrokenCount();
        const editor    = vscode.window.activeTextEditor;

        // ── vaultBar — always shown, always the same command ────────────────
        if (broken > 0) {
            vaultBar.text            = '$(graph) Yamlink  $(warning) ' + nodeCount + ' nodes \u00b7 ' + broken + ' broken';
            vaultBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            vaultBar.tooltip         = 'Yamlink — ' + broken + ' broken link' + (broken !== 1 ? 's' : '') + ' · Click to open Vault Health';
        } else {
            vaultBar.text            = '$(graph) Yamlink  ' + nodeCount + ' nodes';
            vaultBar.backgroundColor = undefined;
            vaultBar.tooltip         = 'Yamlink — Click to open Vault Health';
        }
        vaultBar.show();

        const isMarkdown = editor && editor.document.languageId === 'markdown';
        const filePath   = isMarkdown ? editor.document.uri.fsPath : null;
        const id         = filePath ? getPathIndex().get(filePath) : null;
        const orphan     = id ? isOrphan(id) : false;

        const hasViews  = isMarkdown && editor.document.getText().includes('!view ');
        const hasGraphs = isMarkdown && editor.document.getText().includes('yamlink-graph');
        const hasTasks = isMarkdown && /^\s*[-*]\s+\[( |x|X)\]\s+/m.test(editor.document.getText());

        if (hasViews) {
            actionBar.command = 'yamlink.runViews';
            actionBar.text = '$(play) Run views';
            actionBar.tooltip = 'Yamlink — Run !view blocks in this file';
            actionBar.show();
        } else if (hasTasks) {
            actionBar.command = 'yamlink.openCalendar';
            actionBar.text = '$(calendar) Calendar';
            actionBar.tooltip = 'Yamlink — Open the task calendar';
            actionBar.show();
        } else if (id) {
            actionBar.command = 'yamlink.openHub';
            actionBar.text = orphan ? '$(warning) Note report' : '$(preview) Note report';
            actionBar.tooltip = orphan
                ? 'Yamlink — Open the note report for this orphan node'
                : 'Yamlink — Open the note report for this node';
            actionBar.show();
        } else if (hasGraphs) {
            actionBar.command = 'yamlink.runGraph';
            actionBar.text = '$(type-hierarchy) Run graph';
            actionBar.tooltip = 'Yamlink — Render yamlink-graph blocks in this file';
            actionBar.show();
        } else {
            actionBar.hide();
        }

    }

    // ── Build index ──────────────────────────────────────────────────────────
    buildIndex(vscode.workspace.workspaceFolders);

    // ── Register providers ───────────────────────────────────────────────────
    // registerDiagnostics MUST come before validateAll.
    registerDefinition(context, getIndex);
    registerCompletion(context, getIndex);
    registerViewLightbulb(context);
    registerHover(context, getIndex);
    registerQueryPreviewHover(context, getIndex);
    registerDiagnostics(context, getIndex);
    registerCodeActions(context, getIndex, buildIndex);
    registerRename(context, getIndex, getPathIndex, buildIndex, validateAll);
    registerEntityHubView(context);
    registerCalendarView(context);
    const decorationsProvider = registerDecorations(context, getIndex);
    const codeLensProvider = registerViewCodeLens(context, getOpenViewDocumentPath);
    setViewPanelStateListener(() => codeLensProvider.refresh());

    validateAll(getIndex);
    updateStatusBar();

    // ── Refresh router — single source of truth for coordinated refreshes ───
    const router = createRefreshRouter({
        clearDiagnostics:  clearAll,
        validateAll:       () => validateAll(getIndex),
        refreshBacklinks:  () => {},
        refreshRelated:    () => {},
        refreshDecorations:() => decorationsProvider.refresh(),
        refreshStatusBar:  updateStatusBar,
        refreshHealthPanel:updatePanel,
        refreshViews:      refreshViewPanel,
        refreshGraph:      refreshGraphPanel,
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

            const prevText = vaultBar.text;
            vaultBar.text  = '$(sync~spin) Yamlink  re-indexing…';
            vaultBar.tooltip = 'Yamlink — Re-indexing vault in background…';

            // yield to the event loop so the status bar update paints first
            setImmediate(() => {
                try {
                    buildIndex(vscode.workspace.workspaceFolders);
                    needsFullRebuild = false;
                    const s = getGraphStats();
                    vscode.window.setStatusBarMessage(
                        `Yamlink indexed: ${getIndex().size} nodes · ${s.totalEdges} edges`,
                        5000
                    );
                } catch (e) {
                    console.error('Yamlink — Background rebuild failed:', e.message);
                }
                router.refreshForPassiveIndexSweep();
            });
        }, IDLE_DELAY_MS);
    }

    // ── Full rebuild cycle (for renames, deletes, create-single) ────────────
    function rebuildAll() {
        if (!vscode.workspace.workspaceFolders) return;
        buildIndex(vscode.workspace.workspaceFolders);
        router.refreshForPassiveIndexSweep();
    }

    function refreshAfterViewEdit() {
        router.refresh({ full: true });
    }

    context.subscriptions.push(vscode.workspace.onDidRenameFiles(() => rebuildAll()));

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
        const result = updateSingleFile(filePath);
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
                result = updateSingleFile(filePath);
                if (result.needsFull && vscode.workspace.workspaceFolders) {
                    buildIndex(vscode.workspace.workspaceFolders);
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
                if (doc === vscode.window.activeTextEditor?.document && activeViewRuntime) activeViewRuntime.schedule('save');
            }
        })
    );
    // ── Suggestion bar refresh — separated from updateStatusBar so it can
    // run on its own schedule and always reads a fully-settled graph.
    //
    // The critical difference: we scan EVERY indexed file for mtime changes,
    // not just the active one. Backlinks for node X live in the graph entries
    // of the SOURCE files that point to X — updating X's own file does nothing
    // to refresh getBacklinks(X). Scanning all vault files ensures inbound
    // edge data is current before computeSuggestionsForNode runs.
    let suggestionDebounce = null;

    function refreshSuggestionBar() {
        clearTimeout(suggestionDebounce);
        suggestionDebounce = setTimeout(() => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'markdown') {
                suggestionBar.hide();
                return;
            }

            // Scan every indexed file — catches edge changes in source files
            // whose mtime changed since the last buildIndex or save handler.
            let needsFull = false;
            for (const filePath of getIndex().values()) {
                const r = updateSingleFile(filePath);
                if (r.needsFull) { needsFull = true; break; }
            }
            if (needsFull && vscode.workspace.workspaceFolders) {
                buildIndex(vscode.workspace.workspaceFolders);
            }

            const nodeId = getPathIndex().get(editor.document.uri.fsPath);
            if (!nodeId) { suggestionBar.hide(); return; }

            const { computeSuggestionsForNode } = require('./src/engine/suggestions');
            const sugg = computeSuggestionsForNode(nodeId, editor.document.getText());
            if (sugg.length > 0) {
                suggestionBar.text    = `$(light-bulb) ${sugg.length} view suggestion${sugg.length > 1 ? 's' : ''}`;
                suggestionBar.tooltip = sugg.map(s =>
                    `${s.count} ${s.sourceType}s linked via "${s.field}" → ${s.queryText}`
                ).join('\n');
                suggestionBar.show();
            } else {
                suggestionBar.hide();
            }
        }, 250);
    }

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        updateStatusBar();
        if (editor && editor.document.languageId === 'markdown') {
            validateDocument(editor.document, getIndex);
            syncEntityHub(context);
            refreshCalendarPanel();
        } else {
            syncEntityHub(context);
        }
        refreshSuggestionBar();
    }));

    const activeViewRuntime = registerActiveViewRuntime(context, {
        updateStatusBar,
        refreshSuggestionBar
    });

    // ── Commands ─────────────────────────────────────────────────────────────
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
        vscode.commands.registerCommand('yamlink.closeViewPanel', () => {
            closeViewPanel();
            codeLensProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.runGraph', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'markdown') {
                openGraphPanel(context, editor.document.getText());
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.runVaultGraph', () => {
            // Synthesise a !view * block — shows every indexed node
            const editor = vscode.window.activeTextEditor;
            const docText = editor ? editor.document.getText() : '';
            openGraphPanel(context, '```yamlink-graph\n!view *\n```\n', docText);
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
}

function deactivate() {}

module.exports = { activate, deactivate };
