// src/features/decorations.js
//
// Visual decoration for resolved [[wikilinks]] in the editor.
//
// Two decoration types work together:
//   bracketDecoration  — dims the [[ and ]] brackets (opacity 0.25, no underline)
//   linkDecoration     — underlines + colors the inner ID only
//
// Result: [[roughnecks]] where brackets recede and the ID reads as a link.
// Unresolved links are left alone — diagnostics.js handles those with squiggles.
//
// Debounced at 300ms on document change. Zero disk reads — index only.

const vscode = require('vscode');
const { resolveDateShortcutToken } = require('../core/date');
const { resolveLinkedTarget } = require('../core/id');
const { getAliasIndex } = require('../core/indexService');

// The [[ and ]] brackets — dimmed, no underline
const bracketDecoration = vscode.window.createTextEditorDecorationType({
    opacity: '0.25',
    textDecoration: 'none'
});

// The inner ID — underlined in the VS Code link color
const linkDecoration = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline',
    color: new vscode.ThemeColor('textLink.foreground')
});

const dateShortcutDecoration = vscode.window.createTextEditorDecorationType({
    color: '#d8b4fe',
    fontWeight: '600'
});

const resolvedDateDecoration = vscode.window.createTextEditorDecorationType({
    color: '#e2c6ff',
    fontWeight: '500'
});

// Monaco/VS Code inline decorations support backgroundColor, borderRadius, and border
// (shorthand only) on the main range. borderTop/borderBottom/borderLeft/borderRight are
// not in the ThemableDecorationRenderOptions API and are silently dropped. before/after
// attachment options also lack borderRadius, so any pill-via-pseudo-element approach
// produces broken side blocks with no actual borders. The cleanest chip that Monaco can
// reliably render is: background fill + rounded border + matching text color.
const tagDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(139, 92, 246, 0.18)',
    color: '#ddd6fe',
    borderRadius: '3px',
    border: '1px solid rgba(139, 92, 246, 0.40)',
    fontWeight: '500',
});

// Embed ![[id]] — same bracket dim as wikilinks, exclamation mark also dimmed
const embedBangDecoration = vscode.window.createTextEditorDecorationType({
    opacity: '0.35',
    textDecoration: 'none'
});

// Callout type markers: [!SOURCE], [!NOTE], [!WARNING], [!DANGER]
const calloutSourceDecoration = vscode.window.createTextEditorDecorationType({
    color: '#f59e0b', fontWeight: '700'
});
const calloutInfoDecoration = vscode.window.createTextEditorDecorationType({
    color: '#60a5fa', fontWeight: '700'
});
const calloutWarningDecoration = vscode.window.createTextEditorDecorationType({
    color: '#fb923c', fontWeight: '700'
});
const calloutDangerDecoration = vscode.window.createTextEditorDecorationType({
    color: '#f87171', fontWeight: '700'
});

const CALLOUT_COLOR_MAP = {
    SOURCE: 'source', EVIDENCE: 'source', QUOTE: 'source', REFERENCE: 'source',
    NOTE: 'info', INFO: 'info', TIP: 'info', ABSTRACT: 'info',
    WARNING: 'warning', CAUTION: 'warning',
    DANGER: 'danger', BUG: 'danger', FAILURE: 'danger'
};

let debounceTimer = null;

function registerDecorations(context, getIndex) {

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) updateDecorations(activeEditor, getIndex);

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) updateDecorations(editor, getIndex);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document !== event.document) return;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => updateDecorations(editor, getIndex), 300);
        })
    );

    return {
        refresh() {
            const editor = vscode.window.activeTextEditor;
            if (editor) updateDecorations(editor, getIndex);
        }
    };
}

function updateDecorations(editor, getIndex) {
    if (!editor || editor.document.languageId !== 'markdown') {
        editor.setDecorations(bracketDecoration, []);
        editor.setDecorations(linkDecoration, []);
        editor.setDecorations(embedBangDecoration, []);
        editor.setDecorations(dateShortcutDecoration, []);
        editor.setDecorations(resolvedDateDecoration, []);
        editor.setDecorations(tagDecoration, []);
        editor.setDecorations(calloutSourceDecoration, []);
        editor.setDecorations(calloutInfoDecoration, []);
        editor.setDecorations(calloutWarningDecoration, []);
        editor.setDecorations(calloutDangerDecoration, []);
        return;
    }

    const idIndex  = getIndex();
    const aliasIdx = getAliasIndex();
    const text     = editor.document.getText();
    // Capture optional leading ! for embed syntax
    const regex    = /(!?)\[\[([^\]]+)\]\]/g;

    const brackets  = [];
    const links     = [];
    const embedBangs = [];
    const dateTokens = [];
    const resolvedDates = [];
    const tags = [];
    const calloutSource = [];
    const calloutInfo = [];
    const calloutWarning = [];
    const calloutDanger = [];

    let match;
    while ((match = regex.exec(text)) !== null) {
        const isEmbed   = match[1] === '!';
        const rawInner  = match[2];
        const resolvedId = resolveLinkedTarget(rawInner, idIndex, aliasIdx);
        if (!resolvedId) continue; // unresolved — leave alone

        const fullStart = match.index;
        const fullEnd   = match.index + match[0].length;
        const bracketStart = fullStart + match[1].length; // skip the ! if present
        const idStart   = bracketStart + 2;               // after [[
        const idEnd     = bracketStart + 2 + rawInner.length; // before ]]

        if (isEmbed) {
            // Dim the leading !
            embedBangs.push({
                range: new vscode.Range(
                    editor.document.positionAt(fullStart),
                    editor.document.positionAt(fullStart + 1)
                )
            });
        }

        brackets.push({ range: new vscode.Range(editor.document.positionAt(bracketStart), editor.document.positionAt(bracketStart + 2)) });
        brackets.push({ range: new vscode.Range(editor.document.positionAt(fullEnd - 2), editor.document.positionAt(fullEnd)) });
        links.push({ range: new vscode.Range(editor.document.positionAt(idStart), editor.document.positionAt(idEnd)) });
    }

    for (const { range, family } of collectCalloutDecorations(editor.document)) {
        if (family === 'source') calloutSource.push({ range });
        else if (family === 'warning') calloutWarning.push({ range });
        else if (family === 'danger') calloutDanger.push({ range });
        else calloutInfo.push({ range });
    }

    for (const tokenRange of collectDateShortcutDecorations(editor.document)) {
        dateTokens.push({ range: tokenRange });
    }
    for (const dateRange of collectResolvedDateDecorations(editor.document)) {
        resolvedDates.push({ range: dateRange });
    }
    for (const tagRange of collectTagDecorations(editor.document)) {
        tags.push({ range: tagRange });
    }

    editor.setDecorations(bracketDecoration, brackets);
    editor.setDecorations(linkDecoration, links);
    editor.setDecorations(embedBangDecoration, embedBangs);
    editor.setDecorations(dateShortcutDecoration, dateTokens);
    editor.setDecorations(resolvedDateDecoration, resolvedDates);
    editor.setDecorations(tagDecoration, tags);
    editor.setDecorations(calloutSourceDecoration, calloutSource);
    editor.setDecorations(calloutInfoDecoration, calloutInfo);
    editor.setDecorations(calloutWarningDecoration, calloutWarning);
    editor.setDecorations(calloutDangerDecoration, calloutDanger);
}

function collectDateShortcutDecorations(document) {
    const ranges = [];
    const text = document.getText();
    const regex = /(^|[\s:(-])@([a-z-]+)/gim;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const token = match[2] || '';
        if (!resolveDateShortcutToken(token)) continue;
        const leading = match[1] || '';
        const start = match.index + leading.length;
        const end = start + token.length + 1;
        ranges.push(new vscode.Range(
            document.positionAt(start),
            document.positionAt(end)
        ));
    }
    return ranges;
}

function collectResolvedDateDecorations(document) {
    const ranges = [];
    const text = document.getText();
    const regex = /\b(\d{4}-\d{2}-\d{2})\b/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        ranges.push(new vscode.Range(
            document.positionAt(match.index),
            document.positionAt(match.index + match[1].length)
        ));
    }
    return ranges;
}

function collectTagDecorations(document) {
    const ranges = [];
    const text = document.getText();
    const seen = new Set();

    const hashtagRegex = /(^|[\s(])#([A-Za-z][\w-]*)/gm;
    let match;
    while ((match = hashtagRegex.exec(text)) !== null) {
        const leading = match[1] || '';
        const start = match.index + leading.length;
        const end = start + match[2].length + 1;
        const key = `${start}:${end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        ranges.push(new vscode.Range(
            document.positionAt(start),
            document.positionAt(end)
        ));
    }

    const lines = text.split('\n');
    let offset = 0;
    for (const line of lines) {
        const fieldMatch = line.match(/^\s*(tags?|labels?)\s*:\s*(.+)\s*$/i);
        if (fieldMatch) {
            const rawValue = fieldMatch[2] || '';
            const valueOffset = line.indexOf(rawValue);
            const itemRegex = /(^|,\s*)(#?[A-Za-z][\w-]*)/g;
            let itemMatch;
            while ((itemMatch = itemRegex.exec(rawValue)) !== null) {
                const token = itemMatch[2] || '';
                const normalized = token.replace(/^#+/, '');
                if (!normalized) continue;
                const tokenOffset = itemMatch.index + itemMatch[1].length;
                const start = offset + valueOffset + tokenOffset;
                const end = start + token.length;
                const key = `${start}:${end}`;
                if (seen.has(key)) continue;
                seen.add(key);
                ranges.push(new vscode.Range(
                    document.positionAt(start),
                    document.positionAt(end)
                ));
            }
        }
        offset += line.length + 1;
    }

    return ranges;
}

function collectCalloutDecorations(document) {
    const results = [];
    const text = document.getText();
    // Match > [!TYPE] on its own or with a title
    const regex = /^>\s*(\[![A-Z][A-Z0-9]*\])/gmi;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const markerText = match[1]; // e.g. [!SOURCE]
        const type = markerText.slice(2, -1).toUpperCase(); // e.g. SOURCE
        const start = match.index + match[0].indexOf(markerText);
        const end = start + markerText.length;
        results.push({
            range: new vscode.Range(document.positionAt(start), document.positionAt(end)),
            family: CALLOUT_COLOR_MAP[type] || 'info'
        });
    }
    return results;
}

module.exports = { registerDecorations, collectDateShortcutDecorations, collectResolvedDateDecorations, collectTagDecorations, collectCalloutDecorations };
