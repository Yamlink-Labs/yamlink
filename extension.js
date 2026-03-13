const vscode = require('vscode');
const fs     = require('fs');
const path   = require('path');
const { buildIndex, updateSingleFile, getIndex, getPathIndex, getFieldsCache, parseFrontmatter } = require('./src/core/index');
const { isOrphan, getBacklinks, getEdges } = require('./src/core/graph');
const { registerDefinition } = require('./src/features/definition');
const { registerCompletion } = require('./src/features/completion');
const { registerHover } = require('./src/features/hover');
const { registerDiagnostics, validateAll, validateDocument, getBrokenCount, clearAll } = require('./src/diagnostics/diagnostics');
const { registerCodeActions } = require('./src/actions/codeActions');
const { registerRename } = require('./src/core/rename');
const { registerBacklinks } = require('./src/features/backlinks');
const { registerDecorations } = require('./src/features/decorations');
const { openHealthPanel, updatePanel } = require('./src/features/healthPanel');
const { openViewPanel, refreshViewPanel } = require('./src/features/viewPanel');
const { syncEntityHub, refreshEntityHub } = require('./src/features/entityHub');

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

    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
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
//  nodeBar    (left, 99)  — when on a node: type + backlinks   → Entity Hub
//  runViewsBar(left, 98)  — when file has !view blocks         → Run views
//
// Commands NEVER change. Only text and visibility change.
// ─────────────────────────────────────────────────────────────────

    // Vault summary — always visible, always opens Health Panel
    const vaultBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    vaultBar.name    = 'Yamlink Vault';
    vaultBar.command = 'yamlink.openHealthPanel';
    context.subscriptions.push(vaultBar);

    // Node info — visible only when active file is an indexed node
    const nodeBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    nodeBar.name    = 'Yamlink Node';
    nodeBar.command = 'yamlink.openHub';
    nodeBar.tooltip = 'Yamlink — Click to open Entity Hub';
    context.subscriptions.push(nodeBar);

    // Run views — visible only when active file has !view blocks
    const runViewsBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    runViewsBar.name    = 'Yamlink Run Views';
    runViewsBar.command = 'yamlink.runViews';
    runViewsBar.text    = '$(play) Run views';
    runViewsBar.tooltip = 'Yamlink — Run !view blocks in this file';
    context.subscriptions.push(runViewsBar);

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

        // ── nodeBar — only when active file is an indexed node ───────────────
        const isMarkdown = editor && editor.document.languageId === 'markdown';
        const filePath   = isMarkdown ? editor.document.uri.fsPath : null;
        const id         = filePath ? getPathIndex().get(filePath) : null;

        if (id) {
            const fields   = getFieldsCache().get(id) || {};
            const type     = fields.type ? fields.type.trim() : null;
            const orphan   = isOrphan(id);
            const blCount  = getBacklinks(id).length;

            let nodeText = type ? '$(symbol-class) ' + type : '$(symbol-file) node';
            if (blCount > 0) nodeText += '  $(references) ' + blCount;
            if (orphan)      nodeText += '  $(warning) orphan';

            nodeBar.text            = nodeText;
            nodeBar.backgroundColor = orphan
                ? new vscode.ThemeColor('statusBarItem.warningBackground')
                : undefined;
            nodeBar.tooltip = blCount > 0
                ? '"' + id + '" · ' + blCount + ' inbound link' + (blCount !== 1 ? 's' : '') + ' · Click to open Hub'
                : orphan
                    ? '"' + id + '" is an orphan node (no connections) · Click to open Hub'
                    : '"' + id + '" · No inbound links yet';
            nodeBar.show();
        } else {
            nodeBar.hide();
        }

        // ── runViewsBar — only when file has !view blocks ────────────────────
        const hasViews = isMarkdown && editor.document.getText().includes('!view ');
        runViewsBar[hasViews ? 'show' : 'hide']();

    }

    // ── Build index ──────────────────────────────────────────────────────────
    buildIndex(vscode.workspace.workspaceFolders);

    // ── Register providers ───────────────────────────────────────────────────
    // registerDiagnostics MUST come before validateAll.
    registerDefinition(context, getIndex);
    registerCompletion(context, getIndex);
    registerHover(context, getIndex);
    registerDiagnostics(context, getIndex);
    registerCodeActions(context, getIndex, buildIndex);
    registerRename(context, getIndex, getPathIndex, buildIndex, validateAll);
    const backlinksProvider   = registerBacklinks(context);
    const decorationsProvider = registerDecorations(context, getIndex);

    validateAll(getIndex);
    updateStatusBar();

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
                } catch (e) {
                    console.error('Yamlink — Background rebuild failed:', e.message);
                }
                clearAll();
                validateAll(getIndex);
                backlinksProvider.refresh();
                decorationsProvider.refresh();
                updateStatusBar();
                updatePanel();
                refreshViewPanel();
                refreshEntityHub();
            });
        }, IDLE_DELAY_MS);
    }

    // ── Full rebuild cycle (for renames, deletes, create-single) ────────────
    function rebuildAll() {
        if (!vscode.workspace.workspaceFolders) return;
        buildIndex(vscode.workspace.workspaceFolders);
        clearAll();
        validateAll(getIndex);
        backlinksProvider.refresh();
        decorationsProvider.refresh();
        updateStatusBar();
        updatePanel();
        refreshViewPanel();
        refreshEntityHub();
    }

    context.subscriptions.push(vscode.workspace.onDidRenameFiles(() => rebuildAll()));

    // Delete/create of multiple files (e.g. git checkout, npm install) —
    // set dirty flag and let the background timer handle it instead of
    // hammering buildIndex() on every file in the batch.
    context.subscriptions.push(vscode.workspace.onDidDeleteFiles(e => {
        if (e.files.length > 1) { needsFullRebuild = true; scheduleBackgroundRebuild(); }
        else rebuildAll();
    }));
    context.subscriptions.push(vscode.workspace.onDidCreateFiles(e => {
        if (e.files.length > 1) { needsFullRebuild = true; scheduleBackgroundRebuild(); }
        else rebuildAll();
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

            // Always re-validate diagnostics — querySuggestion hints depend on
            // backlink counts that change when a neighbour is saved, not just
            // when this file changes.
            clearAll();
            validateAll(getIndex);

            // Re-validate open documents that the saved file points TO via backlinks.
            // When contact3.md gains "account: [[acme]]", acme.md is the node whose
            // backlink count just crossed the suggestion threshold — not contact3.md.
            // We walk the outbound edges of the saved file and re-validate each target.
            // validateAll() above already covered open docs; this ensures targets that
            // are open but may have been missed get a second pass with fresh graph data.
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

            backlinksProvider.refresh();
            decorationsProvider.refresh();
            updateStatusBar();
            refreshSuggestionBar();

            // Gate heavier panel refreshes on actual content changes.
            if (result.changed || result.needsFull) {
                updatePanel();
                refreshViewPanel();
                refreshEntityHub();
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
        }
        refreshSuggestionBar();
    }));

    // ── Commands ─────────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.openHealthPanel', () => {
            openHealthPanel(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.openView', (query, label) => {
            openViewPanel(context, '# ' + label + '\n\n' + query + '\n');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.openHub', () => {
            syncEntityHub(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.runViews', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'markdown') {
                openViewPanel(context, editor.document.getText());
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
}

function deactivate() {}

module.exports = { activate, deactivate };