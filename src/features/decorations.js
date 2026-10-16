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
const path = require('path');
const { resolveDateShortcutToken } = require('../core/date');
const { resolveLinkedTarget } = require('../core/id');
const { resolveImageEmbed } = require('../core/imageEmbed');
const { getAliasIndex, getIndex, getPathIndex, getFieldsCache } = require('../core/indexService');
const { extractPriority } = require('../core/tasks');
const { isDiagnosticIgnored, describeBrokenLink } = require('../diagnostics/ignoredDiagnostics');
const { scanInlineCalcs, maskCrossNoteReferences, formatCalcValue } = require('../engine/inlineCalc');
const { createCrossNoteResolver } = require('../engine/crossNoteCalcResolver');
const { perfTracker } = require('../runtime/performanceTracker');

const INLINE_CALC_BUDGET_MS = 10;

/** @param {string} text @returns {number} 0 if the note has no closed frontmatter block. */
function computeFrontmatterEnd(text) {
    if (!/^\s*---/.test(text)) return 0;
    const firstDash = text.indexOf('---');
    const closing = text.indexOf('---', firstDash + 3);
    return closing !== -1 ? closing + 3 : 0;
}

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

// Inline `=expr` calculations (src/engine/mathExpr.js) — the base type
// carries no fixed style since the result text differs per occurrence;
// each range supplies its own renderOptions.after at setDecorations time.
// (A pill/chip around the expression itself was tried and dropped — it
// didn't render correctly here in practice.)
const inlineCalcDecoration = vscode.window.createTextEditorDecorationType({});
const INLINE_CALC_OK_COLOR = '#86efac';
// Same muted amber already used for broken-link styling elsewhere in this
// file — an invalid expression is an honest error, not a wrong number, and
// should read as a warning, not blend in as a normal result.
const INLINE_CALC_ERROR_COLOR = 'rgba(231, 168, 90, 0.9)';

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

// Task-priority tags (#urgent, #medium, #low — see core/tasks.js's
// PRIORITY_ALIASES for the full recognized vocabulary) get their own color
// per word instead of the generic lavender tag chip above — the whole point
// is that #urgent reads as urgent at a glance in the source text itself, not
// just inside Task Center. Same chip shape (background + border + text
// color) as the base tag decoration, just recolored per priority.
const tagUrgentDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(248, 113, 113, 0.18)',
    color: '#f87171',
    borderRadius: '3px',
    border: '1px solid rgba(248, 113, 113, 0.45)',
    fontWeight: '600',
});
const tagMediumDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
    color: '#f5a524',
    borderRadius: '3px',
    border: '1px solid rgba(245, 158, 11, 0.45)',
    fontWeight: '500',
});
const tagLowDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(148, 163, 184, 0.14)',
    color: '#94a3b8',
    borderRadius: '3px',
    border: '1px solid rgba(148, 163, 184, 0.35)',
    fontWeight: '500',
});

// Embed ![[id]] — same bracket dim as wikilinks, exclamation mark also dimmed
const embedBangDecoration = vscode.window.createTextEditorDecorationType({
    opacity: '0.35',
    textDecoration: 'none'
});

// Broken [[links]] — amber brackets signal the dead reference; inner text fades out.
// Contrast with working links: those have dimmed brackets + vivid mint text.
// Here it inverts: the container warns, the content recedes.
const brokenBracketDecoration = vscode.window.createTextEditorDecorationType({
    color: 'rgba(231,168,90,0.55)',
    textDecoration: 'none'
});
const brokenLinkDecoration = vscode.window.createTextEditorDecorationType({
    color: 'rgba(231,168,90,0.32)',
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

// Concealment decoration types — created lazily so they don't exist unless the feature is on.
// font-size:1px collapses the character to near-zero width while opacity:0 hides it visually.
// This is the standard VS Code extension pattern for markup concealment (used by Foam, etc.).
let concealBracketDec = null;
let concealPrefixDec  = null;  // hides [[id| prefix in aliased links
let revealBracketDec  = null;  // brackets shown normally when cursor is inside the link

function getConcealDecorations() {
    if (!concealBracketDec) {
        concealBracketDec = vscode.window.createTextEditorDecorationType({
            opacity: '0',
            textDecoration: 'none; font-size: 0.001em;'
        });
        concealPrefixDec = vscode.window.createTextEditorDecorationType({
            opacity: '0',
            textDecoration: 'none; font-size: 0.001em;'
        });
        revealBracketDec = vscode.window.createTextEditorDecorationType({
            opacity: '0.35',
            textDecoration: 'none'
        });
    }
    return { concealBracketDec, concealPrefixDec, revealBracketDec };
}

function isConcealmentEnabled() {
    return vscode.workspace.getConfiguration('yamlink').get('concealedWikilinks', false);
}

let debounceTimer = null;

/** @param {import('vscode').ExtensionContext} context @param {() => Map<string,string>} getIndex @returns {{ refresh: () => void }} */
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

    // Excel-style Y<N> reference renumbering — deliberately save-triggered,
    // not live on every keystroke (see reconcileInlineCalcReferences's own
    // comment for why).
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(document => {
            reconcileInlineCalcReferences(document, context);
        })
    );

    // Cursor movement triggers concealment reveal for the link under cursor.
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(event => {
            if (isConcealmentEnabled()) updateConcealReveal(event.textEditor, getIndex);
        })
    );

    // Config change — toggle concealment on/off without reloading.
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('yamlink.concealedWikilinks')) {
                const editor = vscode.window.activeTextEditor;
                if (editor) updateDecorations(editor, getIndex);
            }
        })
    );

    return {
        refresh() {
            const editor = vscode.window.activeTextEditor;
            if (editor) updateDecorations(editor, getIndex);
        }
    };
}

/**
 * Collect concealment ranges for all resolved wikilinks.
 * Returns { hidden: Range[], prefixHidden: Range[], cursorReveal: Range[] }.
 * cursorReveal ranges are the full [[...]] spans — caller uses cursor position to
 * decide which ones to reveal.
 * @param {import('vscode').TextDocument} document
 * @param {Map<string,string>} idIndex
 * @param {import('vscode').Position} cursorPos
 * @param {Map<string,string>} aliasIdx
 */
function collectConcealRanges(document, idIndex, cursorPos, aliasIdx) {
    const text = document.getText();
    const regex = /(!?)\[\[([^\]]+)\]\]/g;
    const hidden = [];       // [[ and ]] ranges to hide
    const prefixHidden = []; // [[id| prefix ranges for aliased links
    const revealed = [];     // bracket ranges where cursor is inside — shown at 0.35 opacity

    let match;
    while ((match = regex.exec(text)) !== null) {
        const isEmbed    = match[1] === '!';
        const rawInner   = match[2];
        const resolvedId = resolveLinkedTarget(rawInner, idIndex, aliasIdx);
        if (!resolvedId) continue;

        const fullStart    = match.index;
        const fullEnd      = match.index + match[0].length;
        const bracketStart = fullStart + (isEmbed ? 1 : 0);
        const openBracket  = new vscode.Range(document.positionAt(bracketStart),      document.positionAt(bracketStart + 2));
        const closeBracket = new vscode.Range(document.positionAt(fullEnd - 2),       document.positionAt(fullEnd));
        const fullRange    = new vscode.Range(document.positionAt(fullStart),         document.positionAt(fullEnd));

        const cursorInLink = fullRange.contains(cursorPos);

        if (cursorInLink) {
            revealed.push({ range: openBracket });
            revealed.push({ range: closeBracket });
            continue;
        }

        // Check for pipe alias: [[id|Alias]] — hide [[id| prefix
        const pipeIdx = rawInner.indexOf('|');
        if (pipeIdx !== -1) {
            // Hide [[id| — that's brackets + id + pipe
            const prefixEnd = bracketStart + 2 + pipeIdx + 1; // past the |
            prefixHidden.push({ range: new vscode.Range(document.positionAt(bracketStart), document.positionAt(prefixEnd)) });
            hidden.push({ range: closeBracket });
        } else {
            hidden.push({ range: openBracket });
            hidden.push({ range: closeBracket });
        }
    }

    return { hidden, prefixHidden, revealed };
}

/**
 * Update just the concealment reveal decorations when the cursor moves.
 * Full decoration update is too heavy to run on every selection change.
 */
function updateConcealReveal(editor, getIndex) {
    if (!editor) return;
    const langId = editor.document.languageId;
    if (langId !== 'markdown' && !langId.startsWith('markdown')) return;
    const { concealBracketDec, concealPrefixDec, revealBracketDec } = getConcealDecorations();
    const cursorPos = editor.selection.active;
    const idIndex = getIndex();
    const aliasIdx = getAliasIndex();
    const { hidden, prefixHidden, revealed } = collectConcealRanges(editor.document, idIndex, cursorPos, aliasIdx);
    editor.setDecorations(concealBracketDec, hidden);
    editor.setDecorations(concealPrefixDec, prefixHidden);
    editor.setDecorations(revealBracketDec, revealed);
}

/** @param {import('vscode').TextEditor} editor @param {() => Map<string,string>} getIndex @returns {void} */
function updateDecorations(editor, getIndex) {
    const langId = editor && editor.document && editor.document.languageId;
    if (!editor || (langId !== 'markdown' && !langId.startsWith('markdown'))) {
        if (!editor) return;
        editor.setDecorations(bracketDecoration,       []);
        editor.setDecorations(linkDecoration,          []);
        editor.setDecorations(brokenBracketDecoration, []);
        editor.setDecorations(brokenLinkDecoration,    []);
        editor.setDecorations(embedBangDecoration,     []);
        editor.setDecorations(dateShortcutDecoration, []);
        editor.setDecorations(resolvedDateDecoration, []);
        editor.setDecorations(tagDecoration, []);
        editor.setDecorations(tagUrgentDecoration, []);
        editor.setDecorations(tagMediumDecoration, []);
        editor.setDecorations(tagLowDecoration, []);
        editor.setDecorations(calloutSourceDecoration, []);
        editor.setDecorations(calloutInfoDecoration, []);
        editor.setDecorations(calloutWarningDecoration, []);
        editor.setDecorations(calloutDangerDecoration, []);
        editor.setDecorations(inlineCalcDecoration, []);
        if (concealBracketDec) {
            editor.setDecorations(concealBracketDec, []);
            editor.setDecorations(concealPrefixDec,  []);
            editor.setDecorations(revealBracketDec,  []);
        }
        return;
    }

    const idIndex  = getIndex();
    const aliasIdx = getAliasIndex();
    const concealing = isConcealmentEnabled();
    const text     = editor.document.getText();
    const frontmatterEnd = computeFrontmatterEnd(text);
    // Capture optional leading ! for embed syntax
    const regex    = /(!?)\[\[([^\]]+)\]\]/g;

    const brackets       = [];
    const links          = [];
    const embedBangs     = [];
    const brokenBrackets = [];
    const brokenLinks    = [];
    const dateTokens     = [];
    const resolvedDates  = [];
    const tags           = [];
    const urgentTags     = [];
    const mediumTags     = [];
    const lowTags        = [];
    const calloutSource  = [];
    const calloutInfo    = [];
    const calloutWarning = [];
    const calloutDanger  = [];

    let match;
    while ((match = regex.exec(text)) !== null) {
        const isEmbed      = match[1] === '!';
        const rawInner     = match[2];
        const resolvedId   = resolveLinkedTarget(rawInner, idIndex, aliasIdx);
        // ![[photo.png]] embeds resolve against real files, not notes — check
        // this before treating the link as broken.
        const resolvedImage = !resolvedId && isEmbed
            ? resolveImageEmbed(rawInner, path.dirname(editor.document.uri.fsPath))
            : null;

        const fullStart    = match.index;
        const fullEnd      = match.index + match[0].length;
        const bracketStart = fullStart + match[1].length; // skip ! if embed
        const idStart      = bracketStart + 2;            // after [[
        const idEnd        = bracketStart + 2 + rawInner.length; // before ]]

        if (!resolvedId && !resolvedImage) {
            // Same code/message the real diagnostic uses (see
            // ignoredDiagnostics.js's describeBrokenLink) — must match
            // exactly, or a diagnostic the user dismissed via "Ignore this
            // suggestion here" would still render muted here forever.
            const id = rawInner.split('|')[0].trim();
            const isInFrontmatter = frontmatterEnd > 0 && fullStart < frontmatterEnd;
            const { code, message } = describeBrokenLink(id, isInFrontmatter);
            const ignored = isDiagnosticIgnored(editor.document, {
                range: new vscode.Range(editor.document.positionAt(fullStart), editor.document.positionAt(fullEnd)),
                code,
                message
            });

            if (!ignored) {
                // Broken link — amber brackets + faded amber inner text.
                brokenBrackets.push({ range: new vscode.Range(editor.document.positionAt(bracketStart),     editor.document.positionAt(bracketStart + 2)) });
                brokenBrackets.push({ range: new vscode.Range(editor.document.positionAt(fullEnd - 2),      editor.document.positionAt(fullEnd)) });
                brokenLinks.push({    range: new vscode.Range(editor.document.positionAt(idStart),          editor.document.positionAt(idEnd)) });
                continue;
            }
            // Ignored — fall through to normal (unmuted) link rendering below,
            // same as a resolved link, instead of `continue`-ing past it.
        }

        if (isEmbed) {
            // Dim the leading !
            embedBangs.push({
                range: new vscode.Range(
                    editor.document.positionAt(fullStart),
                    editor.document.positionAt(fullStart + 1)
                )
            });
        }

        // When concealment is on, bracket ranges are owned by concealBracketDec — skip here
        // so the dim decoration doesn't fight and win against the concealment opacity.
        if (!concealing) {
            brackets.push({ range: new vscode.Range(editor.document.positionAt(bracketStart), editor.document.positionAt(bracketStart + 2)) });
            brackets.push({ range: new vscode.Range(editor.document.positionAt(fullEnd - 2),  editor.document.positionAt(fullEnd)) });
        }
        links.push({    range: new vscode.Range(editor.document.positionAt(idStart),      editor.document.positionAt(idEnd)) });
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
    for (const { range, priority } of collectTagDecorations(editor.document)) {
        if (priority === 'urgent') urgentTags.push({ range });
        else if (priority === 'medium') mediumTags.push({ range });
        else if (priority === 'low') lowTags.push({ range });
        else tags.push({ range });
    }

    const inlineCalcs = perfTracker.measureSync(
        'decorations.inlineCalc',
        { budgetMs: INLINE_CALC_BUDGET_MS },
        () => collectInlineCalcDecorations(editor.document)
    ).map(({ range, evalResult, format }) => ({
        range,
        // Just the result. The cell label (Y2), name, and dependencies live on
        // hover (hover.js) — showing the label beside every result was tried
        // and dropped as noise.
        renderOptions: {
            after: {
                contentText: evalResult.ok ? ` = ${formatCalcValue(evalResult.value, format)}` : ' = ?',
                color: evalResult.ok ? INLINE_CALC_OK_COLOR : INLINE_CALC_ERROR_COLOR,
                fontWeight: '700'
            }
        }
    }));

    editor.setDecorations(bracketDecoration,       brackets);
    editor.setDecorations(linkDecoration,          links);
    editor.setDecorations(brokenBracketDecoration, brokenBrackets);
    editor.setDecorations(brokenLinkDecoration,    brokenLinks);
    editor.setDecorations(embedBangDecoration,     embedBangs);
    editor.setDecorations(dateShortcutDecoration, dateTokens);
    editor.setDecorations(resolvedDateDecoration, resolvedDates);
    editor.setDecorations(tagDecoration, tags);
    editor.setDecorations(tagUrgentDecoration, urgentTags);
    editor.setDecorations(tagMediumDecoration, mediumTags);
    editor.setDecorations(tagLowDecoration, lowTags);
    editor.setDecorations(inlineCalcDecoration, inlineCalcs);

    // Concealment layer. Bracket ranges excluded from bracketDecoration above when active,
    // so there is no competing dim decoration fighting the opacity-zero concealment.
    if (concealing) {
        const { concealBracketDec: cbd, concealPrefixDec: cpd, revealBracketDec: rbd } = getConcealDecorations();
        const cursorPos = editor.selection.active;
        const { hidden, prefixHidden, revealed } = collectConcealRanges(editor.document, idIndex, cursorPos, aliasIdx);
        editor.setDecorations(cbd, hidden);
        editor.setDecorations(cpd, prefixHidden);
        editor.setDecorations(rbd, revealed);
    } else if (concealBracketDec) {
        editor.setDecorations(concealBracketDec, []);
        editor.setDecorations(concealPrefixDec,  []);
        editor.setDecorations(revealBracketDec,  []);
    }

    editor.setDecorations(calloutSourceDecoration, calloutSource);
    editor.setDecorations(calloutInfoDecoration, calloutInfo);
    editor.setDecorations(calloutWarningDecoration, calloutWarning);
    editor.setDecorations(calloutDangerDecoration, calloutDanger);
}

/** @param {import('vscode').TextDocument} document @returns {import('vscode').Range[]} */
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

/** @param {import('vscode').TextDocument} document @returns {import('vscode').Range[]} */
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

/** @param {import('vscode').TextDocument} document @returns {Array<{range: import('vscode').Range, priority: 'urgent'|'medium'|'low'|null}>} */
function collectTagDecorations(document) {
    /** @type {Array<{range: import('vscode').Range, priority: 'urgent'|'medium'|'low'|null}>} */
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
        ranges.push({
            range: new vscode.Range(document.positionAt(start), document.positionAt(end)),
            priority: extractPriority(`#${match[2]}`)
        });
    }

    function addRange(start, end, rawToken) {
        const key = `${start}:${end}`;
        if (seen.has(key)) return;
        seen.add(key);
        ranges.push({
            range: new vscode.Range(document.positionAt(start), document.positionAt(end)),
            priority: extractPriority(`#${String(rawToken || '').replace(/^#+/, '')}`)
        });
    }

    // Same-line item extraction (flow `[a, b]` or comma-separated `a, b`).
    // Leading alternation includes `[` so the first item right after an
    // opening bracket is matched too — previously only start-of-string or a
    // preceding comma counted as a valid boundary, so `tags: [a, b, c]`
    // silently dropped `a` and only decorated `b`/`c`.
    function addInlineItems(rawValue, baseOffset) {
        const itemRegex = /(^|,\s*|\[\s*)(#?[A-Za-z][\w-]*)/g;
        let itemMatch;
        while ((itemMatch = itemRegex.exec(rawValue)) !== null) {
            const token = itemMatch[2] || '';
            const normalized = token.replace(/^#+/, '');
            if (!normalized) continue;
            const tokenOffset = itemMatch.index + itemMatch[1].length;
            const start = baseOffset + tokenOffset;
            addRange(start, start + token.length, normalized);
        }
    }

    const lines = text.split('\n');
    let offset = 0;
    // Block-style YAML list state: `tags:`/`labels:` with nothing after the
    // colon, followed by `  - item` lines — the idiomatic YAML list form,
    // and what Obsidian-import produces. Previously never handled at all:
    // the field-line regex required same-line content, so a block list
    // rendered zero pills.
    let blockListIndent = null;
    for (const line of lines) {
        if (blockListIndent !== null) {
            const itemMatch = line.match(/^(\s*)-\s+(.+?)\s*$/);
            if (itemMatch && itemMatch[1].length > blockListIndent) {
                const rawValue = itemMatch[2] || '';
                const valueOffset = line.indexOf(rawValue, itemMatch[1].length);
                const normalized = rawValue.replace(/^#+/, '');
                if (normalized && /^[A-Za-z]/.test(normalized)) {
                    addRange(offset + valueOffset, offset + valueOffset + rawValue.length, normalized);
                }
                offset += line.length + 1;
                continue;
            }
            if (line.trim() === '') {
                // Blank lines are legal inside a YAML block sequence.
                offset += line.length + 1;
                continue;
            }
            blockListIndent = null;
        }

        const fieldMatch = line.match(/^(\s*)(tags?|labels?)\s*:\s*(.*)$/i);
        if (fieldMatch) {
            const rawValue = (fieldMatch[3] || '').trim();
            if (rawValue) {
                const valueOffset = line.indexOf(fieldMatch[3]);
                addInlineItems(fieldMatch[3], offset + valueOffset);
            } else {
                // Nothing after the colon — the list, if any, is on the
                // following indented `- item` lines.
                blockListIndent = fieldMatch[1].length;
            }
        }
        offset += line.length + 1;
    }

    return ranges;
}

// Real, I/O-backed cross-note resolver (src/engine/crossNoteCalcResolver.js)
// — lets `` `=[[other-note]]^label` `` pull another note's computed cell
// value into this one. Built once at module load against the live vault
// index; collectInlineCalcDecorations accepts an override for tests so they
// don't need a real vault just to exercise cross-note resolution.
const defaultCrossNoteCalcResolver = createCrossNoteResolver({ getIndex });
const { createTableRangeResolver } = require('../engine/tableRangeResolver');

/**
 * Inline `=expr` calculations — an explicit, opt-in syntax only (a real
 * inline code span whose content starts with `=`, or is prefixed with a
 * name — `` `name=expr` ``). Deliberately never auto-detects plain
 * numbers/expressions in ordinary prose. All scanning/evaluation lives in
 * the pure engine module (src/engine/inlineCalc.js), shared with hover.js;
 * this only maps its offsets onto editor ranges. Every block, named or not,
 * carries an automatic Excel-style cell label (Y1, Y2, ...) in document
 * order. Keeping `Y<N>` references pointing at the *same* block after an
 * earlier block is inserted/removed happens on save, in
 * `reconcileInlineCalcReferences()` below — this function only reads.
 * @param {import('vscode').TextDocument} document
 * @param {(noteId: string, label: string) => {ok: true, value: import('../engine/mathExpr').ScalarValue} | {ok: false, reason: string}} [resolveCrossNoteRef]
 * @returns {Array<{range: import('vscode').Range, evalResult: import('../engine/mathExpr').EvalResult, expr: string, label: string, name: string|null, deps: Array<{ref: string, value: import('../engine/mathExpr').ScalarValue}>}>}
 */
/** @param {import('vscode').TextDocument} document @returns {Record<string, unknown>|undefined} */
function getFrontmatterFieldsForDocument(document) {
    if (!document.uri) return undefined;
    const id = getPathIndex().get(document.uri.fsPath);
    return id ? getFieldsCache().get(id) : undefined;
}

function collectInlineCalcDecorations(document, resolveCrossNoteRef = defaultCrossNoteCalcResolver) {
    const frontmatterFields = getFrontmatterFieldsForDocument(document);
    // Built fresh per call (not a module-level singleton like the cross-note
    // resolver above) — it's scoped to THIS note's own current `!view`
    // blocks, which change on every edit. Construction itself only parses
    // text (parseAllViewQueries), so it's cheap even though this runs on
    // every keystroke; the query underneath a T<N> reference only actually
    // runs if some formula on the page references it at all.
    const resolveTableRange = createTableRangeResolver(document.getText());
    return scanInlineCalcs(document.getText(), { resolveCrossNoteRef, resolveTableRange, frontmatterFields }).map((block) => ({
        range: new vscode.Range(document.positionAt(block.start), document.positionAt(block.end)),
        evalResult: block.evalResult,
        expr: block.expr,
        label: block.label,
        name: block.name,
        format: block.format,
        deps: block.deps
    }));
}

// Last-known ordered list of calc-block expression texts per document,
// keyed by URI string — the baseline reconcileInlineCalcReferences() diffs
// against on the next save. Capped like unlinkedRefs.js's body cache so a
// long session touching many files doesn't grow this unboundedly.
const INLINE_CALC_HISTORY_CAP = 100;
/** @type {Map<string, string[]>} */
const lastKnownInlineCalcExprs = new Map();

/**
 * Given the previous and current ordered lists of calc-block expression
 * texts, figures out which positional numbers actually moved — matched by
 * exact expression text, in relative order, so ties among identical
 * duplicate expressions resolve deterministically (first previous
 * occurrence pairs with first current occurrence, and so on). Only
 * numbers that actually changed are included.
 * @param {string[]} previousExprs @param {string[]} currentExprs
 * @returns {Map<number, number>}
 */
function computeInlineCalcRenumberMap(previousExprs, currentExprs) {
    /** @type {Map<string, number[]>} */
    const prevByText = new Map();
    previousExprs.forEach((raw, i) => {
        const key = raw.trim();
        if (!prevByText.has(key)) prevByText.set(key, []);
        prevByText.get(key).push(i + 1);
    });
    /** @type {Map<string, number[]>} */
    const curByText = new Map();
    currentExprs.forEach((raw, i) => {
        const key = raw.trim();
        if (!curByText.has(key)) curByText.set(key, []);
        curByText.get(key).push(i + 1);
    });

    const renumber = new Map();
    for (const [text, oldNumbers] of prevByText) {
        const newNumbers = curByText.get(text) || [];
        const pairCount = Math.min(oldNumbers.length, newNumbers.length);
        for (let i = 0; i < pairCount; i++) {
            const oldNum = oldNumbers[i];
            const newNum = newNumbers[i];
            if (oldNum !== newNum) renumber.set(oldNum, newNum);
        }
    }
    return renumber;
}

/**
 * Excel-style live renumbering, triggered on save. If an earlier calc block
 * was inserted or removed since the last time this document was seen, every
 * `Y<N>` reference elsewhere in the same document that pointed at a block
 * whose number changed gets rewritten in place to its new number — the
 * same thing Excel does silently when a row shifts. All replacement ranges
 * are computed against one document snapshot and applied in a single
 * WorkspaceEdit, so a simultaneous swap (Y1<->Y2) can never cascade into
 * itself. Runs on save, not on every keystroke, specifically so it never
 * fights the user's cursor mid-edit and so the corrective re-save it
 * triggers is trivially idempotent (see the second call below).
 *
 * When it actually rewrites something, this is the one moment the extension
 * edits a note's text without the user directly typing it — worth a real,
 * one-time explanation the very first time it ever happens (tracked in
 * globalState, so it survives restarts), and a quiet, self-dismissing
 * status-bar note on every occurrence after that. Never a modal, never
 * repeated in full — matches this session's own hard lesson about not
 * surfacing something unconditionally on every occurrence.
 * @param {import('vscode').TextDocument} document
 * @param {import('vscode').ExtensionContext} [context]
 * @returns {Promise<void>}
 */
async function reconcileInlineCalcReferences(document, context) {
    if (!document || (document.languageId !== 'markdown' && !document.languageId.startsWith('markdown'))) return;

    const uriKey = document.uri.toString();
    const currentBlocks = collectInlineCalcDecorations(document);
    const currentExprs = currentBlocks.map((block) => block.expr);
    const previousExprs = lastKnownInlineCalcExprs.get(uriKey);

    if (lastKnownInlineCalcExprs.size >= INLINE_CALC_HISTORY_CAP && !lastKnownInlineCalcExprs.has(uriKey)) {
        lastKnownInlineCalcExprs.delete(lastKnownInlineCalcExprs.keys().next().value);
    }
    lastKnownInlineCalcExprs.set(uriKey, currentExprs);

    if (!previousExprs) return; // first time seeing this document — nothing to reconcile against yet
    const renumber = computeInlineCalcRenumberMap(previousExprs, currentExprs);
    if (renumber.size === 0) return;

    const referenceRegex = /\bY(\d+)\b/g;
    const edit = new vscode.WorkspaceEdit();
    let editCount = 0;
    for (const block of scanInlineCalcs(document.getText())) {
        // Mask cross-note reference spans first — `[[budget]]^Y2`'s `Y2`
        // belongs to budget's own numbering, not this note's, and must
        // never be mistaken for a local Y<N> token during this note's own
        // renumbering. Same-length masking keeps every match offset valid
        // against the original (unmasked) block.expr below.
        const maskedExpr = maskCrossNoteReferences(block.expr);
        referenceRegex.lastIndex = 0;
        let refMatch;
        while ((refMatch = referenceRegex.exec(maskedExpr)) !== null) {
            const newNumber = renumber.get(Number(refMatch[1]));
            if (newNumber === undefined) continue;
            const tokenStart = block.exprStart + refMatch.index;
            const tokenEnd = tokenStart + refMatch[0].length;
            edit.replace(
                document.uri,
                new vscode.Range(document.positionAt(tokenStart), document.positionAt(tokenEnd)),
                `Y${newNumber}`
            );
            editCount += 1;
        }
    }

    if (editCount === 0) return;
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) return;
    await document.save();
    notifyInlineCalcReferencesRewritten(editCount, context);
}

const INLINE_CALC_EXPLAINER_SEEN_KEY = 'yamlink.seenInlineCalcRenumberExplainer';

/** @param {number} count @param {import('vscode').ExtensionContext} [context] */
function notifyInlineCalcReferencesRewritten(count, context) {
    const plural = count === 1 ? 'reference' : 'references';
    const globalState = context && context.globalState;
    const alreadySeen = globalState ? globalState.get(INLINE_CALC_EXPLAINER_SEEN_KEY, false) : true;
    if (!alreadySeen) {
        vscode.window.showInformationMessage(
            `Yamlink: you moved a calculation, so ${count} formula ${plural} ${count === 1 ? 'was' : 'were'} ` +
            `automatically fixed to still point at the right one — like a spreadsheet updating itself when you ` +
            `move a row. This is the only time you'll see this explained; after this it's just a quick note at the bottom of the screen.`
        );
        if (globalState) globalState.update(INLINE_CALC_EXPLAINER_SEEN_KEY, true);
        return;
    }
    vscode.window.setStatusBarMessage(`Yamlink: fixed ${count} formula ${plural} after reordering`, 4000);
}

/** @param {import('vscode').TextDocument} document @returns {Array<{range: import('vscode').Range, family: string}>} */
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

module.exports = {
    registerDecorations,
    updateDecorations,
    collectDateShortcutDecorations,
    collectResolvedDateDecorations,
    collectTagDecorations,
    collectCalloutDecorations,
    collectInlineCalcDecorations,
    computeInlineCalcRenumberMap,
    reconcileInlineCalcReferences,
    notifyInlineCalcReferencesRewritten
};
