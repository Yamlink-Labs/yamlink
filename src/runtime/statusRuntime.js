'use strict';

const vscode = require('vscode');
const { isOrphan } = require('../core/graph');

function createStatusRuntime(context, services) {
    const {
        getIndex,
        getPathIndex,
        getBrokenCount,
        computeSuggestionsForNode
    } = services;

    const vaultBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    vaultBar.name = 'Yamlink Vault';
    vaultBar.command = 'yamlink.openHealthPanel';
    context.subscriptions.push(vaultBar);

    const actionBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    actionBar.name = 'Yamlink Action';
    context.subscriptions.push(actionBar);

    const suggestionBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    suggestionBar.name = 'Yamlink Suggestions';
    suggestionBar.command = 'yamlink.showQuerySuggestionsQuickPick';
    context.subscriptions.push(suggestionBar);

    let suggestionDebounce = null;
    let lastSuggestionKey = null;
    const palette = {
        mint: '#4fc4a0',
        blue: '#6eb3f0',
        rose: '#c96d78'
    };

    function updateStatusBar() {
        const nodeCount = getIndex().size;
        const broken = getBrokenCount();
        const editor = vscode.window.activeTextEditor;

        if (broken > 0) {
            vaultBar.text = '$(graph) Yamlink  $(warning) ' + nodeCount + ' nodes · ' + broken + ' broken';
            vaultBar.color = palette.rose;
            vaultBar.backgroundColor = undefined;
            vaultBar.tooltip = 'Yamlink — ' + broken + ' broken link' + (broken !== 1 ? 's' : '') + ' · Click to open Vault Health';
        } else {
            vaultBar.text = '$(graph) Yamlink  ' + nodeCount + ' nodes';
            vaultBar.color = palette.mint;
            vaultBar.backgroundColor = undefined;
            vaultBar.tooltip = 'Yamlink — Click to open Vault Health';
        }
        vaultBar.show();

        const isMarkdown = editor && editor.document.languageId === 'markdown';
        const filePath = isMarkdown ? editor.document.uri.fsPath : null;
        const id = filePath ? getPathIndex().get(filePath) : null;
        const orphan = id ? isOrphan(id) : false;
        const text = isMarkdown ? editor.document.getText() : '';

        const hasViews = isMarkdown && text.includes('!view ');
        const hasGraphs = isMarkdown && text.includes('yamlink-graph');
        const hasTasks = isMarkdown && /^\s*[-*]\s+\[( |x|X)\]\s+/m.test(text);

        if (hasViews) {
            actionBar.command = 'yamlink.runViews';
            actionBar.text = '$(play) Run views';
            actionBar.color = palette.blue;
            actionBar.tooltip = 'Yamlink — Run !view blocks in this file';
            actionBar.show();
        } else if (hasTasks) {
            actionBar.command = 'yamlink.openCalendar';
            actionBar.text = '$(calendar) Calendar';
            actionBar.color = palette.mint;
            actionBar.tooltip = 'Yamlink — Open the task calendar';
            actionBar.show();
        } else if (id) {
            actionBar.command = 'yamlink.openHub';
            actionBar.text = orphan ? '$(warning) Note report' : '$(preview) Note report';
            actionBar.color = orphan ? palette.rose : palette.blue;
            actionBar.tooltip = orphan
                ? 'Yamlink — Open the note report for this orphan node'
                : 'Yamlink — Open the note report for this node';
            actionBar.show();
        } else if (hasGraphs) {
            actionBar.command = 'yamlink.runGraph';
            actionBar.text = '$(type-hierarchy) Run graph';
            actionBar.color = palette.blue;
            actionBar.tooltip = 'Yamlink — Render yamlink-graph blocks in this file';
            actionBar.show();
        } else {
            actionBar.hide();
        }
    }

    function refreshSuggestionBar() {
        clearTimeout(suggestionDebounce);
        suggestionDebounce = setTimeout(() => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'markdown') {
                lastSuggestionKey = null;
                suggestionBar.hide();
                return;
            }

            const text = editor.document.getText();
            const cacheKey = `${editor.document.uri.fsPath}::${editor.document.version}`;
            if (cacheKey === lastSuggestionKey && suggestionBar.text) return;

            const nodeId = getPathIndex().get(editor.document.uri.fsPath);
            if (!nodeId) {
                lastSuggestionKey = cacheKey;
                suggestionBar.hide();
                return;
            }

            const suggestions = computeSuggestionsForNode(nodeId, text);
            lastSuggestionKey = cacheKey;
            if (suggestions.length > 0) {
                suggestionBar.text = `$(light-bulb) ${suggestions.length} view suggestion${suggestions.length > 1 ? 's' : ''}`;
                suggestionBar.color = palette.mint;
                suggestionBar.tooltip = suggestions.map(s =>
                    `${s.title} — ${s.description}`
                ).join('\n');
                suggestionBar.show();
            } else {
                suggestionBar.hide();
            }
        }, 250);
    }

    context.subscriptions.push({
        dispose() {
            clearTimeout(suggestionDebounce);
        }
    });

    return {
        updateStatusBar,
        refreshSuggestionBar,
        resetSuggestionCache() {
            lastSuggestionKey = null;
        }
    };
}

module.exports = { createStatusRuntime };
