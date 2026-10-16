'use strict';

// Two ways to build a formula that references another cell without typing
// its label from memory:
//   1. Autocomplete while typing inside a formula (this file's completion
//      provider) — VS Code doesn't reliably auto-trigger suggestions while
//      typing plain Markdown, so this force-triggers the suggest widget the
//      same way completion.js's maybeTriggerFrontmatterSuggest already does
//      for frontmatter fields, rather than relying on default behavior.
//   2. `Yamlink: Insert Cell Reference` command — a searchable picker over
//      every cell in the current note, for browsing/finding one rather than
//      recalling its label.
// Same-note references are offered as bare labels/names. Cross-note references
// use Yamlink's calc syntax: [[note-id]]^cell.

const vscode = require('vscode');
const { scanInlineCalcs, buildFrontmatterSeedEnv } = require('../engine/inlineCalc');
const { listNoteTableColumns } = require('../engine/tableRangeResolver');
const { getIndex, getPathIndex, getFieldsCache, getVaultGeneration } = require('../core/indexService');
const { defaultReadBody } = require('../engine/crossNoteCalcResolver');
const { rankCandidateIds } = require('../intelligence/completionHelpers');
const { getCachedFormulaPriors } = require('../intelligence/formulaPriors');

// A pattern needs to recur in at least this many OTHER notes of the same
// type before it's offered as a suggestion — a single occurrence is just
// one note's own formula, not yet a real vault-learned pattern (see
// formulaPriors.js's own header comment for the full reasoning).
const MIN_FORMULA_PATTERN_COUNT = 2;
const MAX_FORMULA_PATTERN_SUGGESTIONS = 5;
const RANGE_FUNCTION_RE = /\b(sum|average|min|max)\s*\(\s*([^()]*)$/i;

/**
 * A formula that reads this note's own frontmatter (e.g. `subtotal=rate*quantity`
 * where `quantity` lives in frontmatter, not an earlier cell) only resolves
 * when scanInlineCalcs is given those fields — without them it fails with an
 * honest "not found," and every cell that references it transitively fails
 * right along with it. Shared by both context finders below so neither one
 * silently drops real prior cells just because this note happens to lean on
 * its own frontmatter, the same way hover.js and decorations.js already do.
 * @param {import('vscode').TextDocument} document
 * @returns {Record<string, unknown>|undefined}
 */
function getFrontmatterFieldsForDocument(document) {
    if (!document.uri) return undefined;
    const noteId = getPathIndex().get(document.uri.fsPath);
    return noteId ? getFieldsCache().get(noteId) : undefined;
}

/**
 * @param {import('vscode').TextDocument} document @param {import('vscode').Position} position
 * @returns {{ block: object, priorBlocks: object[] } | null}
 */
function findEditableCalcContext(document, position) {
    const langId = document && document.languageId;
    if (!langId || (langId !== 'markdown' && !langId.startsWith('markdown'))) return null;
    const offset = document.offsetAt(position);
    const blocks = scanInlineCalcs(document.getText(), { frontmatterFields: getFrontmatterFieldsForDocument(document) });
    const block = blocks.find((b) => offset >= b.exprStart && offset < b.end);
    if (!block) return null;
    // Only cells defined strictly before this one are real references — the
    // same "no forward references" rule the evaluator itself enforces.
    const priorBlocks = blocks.filter((b) => b.start < block.start && b.evalResult.ok);
    return { block, priorBlocks };
}

// Matches right after typing `= or `name= — a formula that hasn't been
// closed with its trailing backtick yet. findEditableCalcContext above only
// recognizes a COMPLETE `=...` span (scanInlineCalcs has nothing to parse
// without a closing backtick), which is why suggestions previously only
// appeared once a formula was already closed — a real gap compared to `[[`,
// which suggests the moment you type the second bracket. This closes it.
const UNCLOSED_CALC_RE = /`([A-Za-z_][A-Za-z0-9_]*)?=[^`]*$/;

/**
 * @param {import('vscode').TextDocument} document @param {import('vscode').Position} position
 * @returns {{ priorBlocks: object[] } | null}
 */
function findUnclosedCalcContext(document, position) {
    const langId = document && document.languageId;
    if (!langId || (langId !== 'markdown' && !langId.startsWith('markdown'))) return null;
    const lineText = document.lineAt(position.line).text.slice(0, position.character);
    if (!UNCLOSED_CALC_RE.test(lineText)) return null;
    const offset = document.offsetAt(position);
    const blocks = scanInlineCalcs(document.getText(), { frontmatterFields: getFrontmatterFieldsForDocument(document) });
    const priorBlocks = blocks.filter((b) => b.end <= offset && b.evalResult.ok);
    return { priorBlocks };
}

/** @param {object} block @returns {string} */
function describeCellForPicker(block) {
    const value = block.evalResult.ok ? block.evalResult.value : '?';
    return `${block.label}${block.name ? ` · ${block.name}` : ''}  —  ${block.expr.trim()} = ${value}`;
}

/**
 * Vault-learned formula suggestions — the one place calc authoring gets any
 * benefit from the rest of the vault's history, mirroring (at a smaller
 * scale) how frontmatter-field completion already learns from vaultPriors.js.
 * Scoped to the CURRENT note's own `type:`, so a zero-schema vault (or a
 * note with no type) simply gets nothing extra here — "schema amplifies,
 * never gates," same as every other intelligence feature in this codebase.
 * Fires regardless of whether this note already has other calc cells to
 * reference (unlike same-note reference completion, which needs at least
 * one prior block) — this is exactly the moment a brand-new, first-ever
 * formula in a note benefits most from seeing what similar notes do.
 * @param {import('vscode').TextDocument} document
 * @returns {import('vscode').CompletionItem[]}
 */
function buildVaultLearnedFormulaItems(document) {
    if (!document.uri) return [];
    const noteId = getPathIndex().get(document.uri.fsPath);
    if (!noteId) return [];
    const fieldsCache = getFieldsCache();
    const fields = fieldsCache.get(noteId);
    const type = String(fields?.type || '').trim().toLowerCase();
    if (!type) return [];

    const priors = getCachedFormulaPriors(fieldsCache, getIndex(), getVaultGeneration());
    const patterns = (priors.get(type) || [])
        .filter((pattern) => pattern.count >= MIN_FORMULA_PATTERN_COUNT)
        .slice(0, MAX_FORMULA_PATTERN_SUGGESTIONS);
    if (!patterns.length) return [];

    return patterns.map((pattern, index) => {
        const item = new vscode.CompletionItem(pattern.expr, vscode.CompletionItemKind.Snippet);
        item.insertText = pattern.expr;
        item.detail = `${pattern.name} — common in ${pattern.count} other ${type} notes`;
        item.documentation = new vscode.MarkdownString(`\`${pattern.name}=${pattern.expr}\``);
        item.sortText = `05${String(index).padStart(3, '0')}`;
        return item;
    });
}

/**
 * @param {import('vscode').TextDocument} document
 * @param {import('vscode').Position} position
 * @returns {{ line: string, before: string, after: string }}
 */
function getLineContext(document, position) {
    if (document.lineAt && typeof position.line === 'number') {
        const line = document.lineAt(position.line).text;
        return {
            line,
            before: line.substring(0, position.character),
            after: line.substring(position.character)
        };
    }
    const text = document.getText();
    const offset = document.offsetAt(position);
    return { line: text, before: text.slice(0, offset), after: text.slice(offset) };
}

/**
 * @param {import('vscode').TextDocument} document
 * @param {import('vscode').Position} position
 * @param {string} partial
 * @param {Map<string,string>} idIndex
 * @returns {import('vscode').CompletionItem[]}
 */
function buildCrossNoteIdItems(document, position, partial, idIndex) {
    const ctx = getLineContext(document, position);
    const bracketStart = position.character - String(partial || '').length - 2;
    const replaceRange = new vscode.Range(
        new vscode.Position(position.line || 0, Math.max(0, bracketStart)),
        new vscode.Position(position.line || 0, position.character + (ctx.after.startsWith(']]') ? 2 : 0))
    );
    return rankCandidateIds(Array.from(idIndex.keys()), partial)
        .map((id, index) => {
            const item = new vscode.CompletionItem(id, vscode.CompletionItemKind.Reference);
            item.insertText = `[[${id}]]`;
            item.range = replaceRange;
            item.filterText = `[[${id}`;
            item.detail = idIndex.get(id);
            item.sortText = `03${String(index).padStart(3, '0')}`;
            return item;
        });
}

/**
 * @param {Map<string,string>} idIndex
 * @param {string} targetId
 * @param {(filePath: string) => string|null} [readBody]
 * @returns {{blockId: string, label: string, expr: string, value: import('../engine/mathExpr').ScalarValue}[]}
 */
function collectCrossNoteCalcCellCandidates(idIndex, targetId, readBody = defaultReadBody) {
    const normalizedId = String(targetId || '').trim().toLowerCase();
    const filePath = idIndex.get(normalizedId);
    if (!filePath) return [];
    const body = readBody(filePath);
    if (!body) return [];
    const candidates = [];
    for (const block of scanInlineCalcs(body)) {
        if (!block.evalResult.ok) continue;
        candidates.push({ blockId: block.label, label: block.label, expr: block.expr, value: block.evalResult.value });
        if (block.name) {
            candidates.push({ blockId: block.name, label: block.label, expr: block.expr, value: block.evalResult.value });
        }
    }
    return candidates;
}

/**
 * @param {import('vscode').TextDocument} _document
 * @param {import('vscode').Position} position
 * @param {Map<string,string>} idIndex
 * @param {string} targetId
 * @param {string} partial
 * @returns {import('vscode').CompletionItem[]}
 */
function buildCrossNoteCalcCellItems(_document, position, idIndex, targetId, partial) {
    const replaceRange = new vscode.Range(
        new vscode.Position(position.line || 0, Math.max(0, position.character - String(partial || '').length)),
        new vscode.Position(position.line || 0, position.character)
    );
    return collectCrossNoteCalcCellCandidates(idIndex, targetId)
        .filter((block) => block.blockId.toLowerCase().startsWith(String(partial || '').toLowerCase()))
        .map((block, index) => {
            const item = new vscode.CompletionItem(block.blockId, vscode.CompletionItemKind.Reference);
            item.insertText = block.blockId;
            item.range = replaceRange;
            item.filterText = `[[${targetId}]]^${block.blockId}`;
            item.detail = `${block.label} = ${block.value}`;
            item.documentation = new vscode.MarkdownString(`\`${block.expr.trim()}\``);
            item.sortText = `015${String(index).padStart(3, '0')}`;
            return item;
        });
}

/** @param {number} value @returns {string} */
function formatPreviewNumber(value) {
    if (!Number.isFinite(value)) return '?';
    if (Number.isInteger(value)) return String(value);
    return String(Number(value.toFixed(6)));
}

/**
 * @param {string} fn
 * @param {number[]} values
 * @returns {number|null}
 */
function computeRangePreview(fn, values) {
    if (!values.length) return null;
    if (fn === 'sum') return values.reduce((total, value) => total + value, 0);
    if (fn === 'average') return values.reduce((total, value) => total + value, 0) / values.length;
    if (fn === 'min') return Math.min(...values);
    if (fn === 'max') return Math.max(...values);
    return null;
}

/**
 * @param {import('vscode').TextDocument} document
 * @param {import('vscode').Position} position
 * @param {{priorBlocks: object[]}} ctx
 * @returns {import('vscode').CompletionItem[]}
 */
function buildRangeCompletionItems(document, position, ctx) {
    const lineCtx = getLineContext(document, position);
    const match = lineCtx.before.match(RANGE_FUNCTION_RE);
    if (!match) return [];
    const fn = String(match[1] || '').toLowerCase();
    const valuesByLabel = new Map();
    for (const block of ctx.priorBlocks || []) {
        if (!block?.label || !block.evalResult?.ok || typeof block.evalResult.value !== 'number') continue;
        valuesByLabel.set(block.label, block.evalResult.value);
    }
    const labels = Array.from(valuesByLabel.keys())
        .map((label) => ({ label, number: Number(String(label).slice(1)) }))
        .filter((entry) => /^Y\d+$/.test(entry.label) && Number.isInteger(entry.number))
        .sort((a, b) => a.number - b.number);
    if (!labels.length) return [];
    const latest = labels[labels.length - 1].number;
    const candidates = [
        [1, latest],
        latest >= 2 ? [latest - 1, latest] : null,
        latest >= 3 ? [latest - 2, latest] : null
    ].filter(Boolean);
    const seen = new Set();
    const items = [];
    for (const [start, end] of candidates) {
        const rangeText = `Y${start}:Y${end}`;
        if (seen.has(rangeText)) continue;
        seen.add(rangeText);
        const values = [];
        let complete = true;
        for (let i = start; i <= end; i++) {
            const value = valuesByLabel.get(`Y${i}`);
            if (typeof value !== 'number') {
                complete = false;
                break;
            }
            values.push(value);
        }
        if (!complete) continue;
        const preview = computeRangePreview(fn, values);
        if (preview === null) continue;
        const item = new vscode.CompletionItem(rangeText, vscode.CompletionItemKind.Variable);
        item.insertText = rangeText;
        item.detail = `${fn} = ${formatPreviewNumber(preview)}`;
        item.sortText = `00${String(items.length).padStart(3, '0')}`;
        items.push(item);
    }
    return items;
}

/**
 * @param {import('vscode').TextDocument} document @param {import('vscode').Position} position
 * @returns {import('vscode').CompletionItem[] | undefined}
 */
function provideCellReferenceCompletions(document, position) {
    const ctx = findEditableCalcContext(document, position) || findUnclosedCalcContext(document, position);
    if (!ctx) return undefined;

    const lineCtx = getLineContext(document, position);
    const idIndex = getIndex();

    const crossNoteCellMatch = lineCtx.before.match(/\[\[([^#\]\|^]+)\]\]\^([^\s`]*)$/);
    if (crossNoteCellMatch) {
        const targetId = String(crossNoteCellMatch[1] || '').trim();
        const items = buildCrossNoteCalcCellItems(document, position, idIndex, targetId, crossNoteCellMatch[2] || '');
        return items.length ? items : undefined;
    }

    const wikiMatch = lineCtx.before.match(/\[\[([^\]]*)$/);
    if (wikiMatch) {
        const items = buildCrossNoteIdItems(document, position, wikiMatch[1] || '', idIndex);
        return items.length ? items : undefined;
    }

    const rangeItems = buildRangeCompletionItems(document, position, ctx);
    if (rangeItems.length) return rangeItems;

    const items = [];
    // Closest (most recently defined) cell first — the common case is
    // referencing what you just calculated a line or two above.
    const ordered = [...ctx.priorBlocks].reverse();
    ordered.forEach((block, index) => {
        const labelItem = new vscode.CompletionItem(block.label, vscode.CompletionItemKind.Variable);
        labelItem.detail = `= ${block.evalResult.ok ? block.evalResult.value : '?'}`;
        labelItem.documentation = new vscode.MarkdownString(`\`${block.expr.trim()}\``);
        labelItem.sortText = String(index).padStart(4, '0');
        items.push(labelItem);
        if (block.name) {
            const nameItem = new vscode.CompletionItem(block.name, vscode.CompletionItemKind.Variable);
            nameItem.detail = `${block.label} = ${block.evalResult.ok ? block.evalResult.value : '?'}`;
            nameItem.documentation = new vscode.MarkdownString(`\`${block.expr.trim()}\``);
            nameItem.sortText = String(index).padStart(4, '0') + '_name';
            items.push(nameItem);
        }
    });
    const usedNames = new Set();
    for (const block of ctx.priorBlocks) {
        usedNames.add(block.label);
        if (block.name) usedNames.add(block.name);
    }
    items.push(...buildTableFieldItems(document));
    items.push(...buildFrontmatterFieldItems(document, usedNames));
    items.push(...buildVaultLearnedFormulaItems(document));
    return items.length ? items : undefined;
}

/**
 * A `!view` table already sitting in this note is the vault-wide part of a
 * formula — `T1.total` reads a column that itself comes from every matching
 * note, not just this one. Offering `T<N>.<column>` as flat, complete
 * tokens (same shape as a frontmatter field item) means picking a vault-wide
 * value is exactly as easy as picking a same-note one, rather than needing
 * a separate two-step trigger just for this.
 * @param {import('vscode').TextDocument} document
 * @returns {import('vscode').CompletionItem[]}
 */
function buildTableFieldItems(document) {
    const tables = listNoteTableColumns(document.getText());
    const items = [];
    for (const { label, columns } of tables) {
        for (const column of columns) {
            const token = `${label}.${column}`;
            const item = new vscode.CompletionItem(token, vscode.CompletionItemKind.Field);
            item.detail = `table ${label} column — reads across every note it matches`;
            item.sortText = 'x_' + token;
            items.push(item);
        }
    }
    return items;
}

/**
 * A formula can read the note's own frontmatter directly (see
 * buildFrontmatterSeedEnv in inlineCalc.js) — so the fields it could
 * actually resolve belong in the suggestion box too, not just prior calc
 * cells. Reuses that exact function rather than re-deriving the rules here,
 * so this can never offer a field the evaluator would then reject.
 * @param {import('vscode').TextDocument} document
 * @param {Set<string>} excludeNames — names already offered as cell labels/names, so a field doesn't appear twice
 * @returns {import('vscode').CompletionItem[]}
 */
function buildFrontmatterFieldItems(document, excludeNames) {
    if (!document.uri) return [];
    const noteId = getPathIndex().get(document.uri.fsPath);
    if (!noteId) return [];
    const fields = getFieldsCache().get(noteId);
    if (!fields) return [];
    const seed = buildFrontmatterSeedEnv(fields);
    return Object.entries(seed)
        .filter(([name]) => !excludeNames.has(name))
        .map(([name, value]) => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Field);
            item.detail = `frontmatter · ${JSON.stringify(value)}`;
            // After same-note cell references (more often what's wanted right
            // after a `=), but still ahead of vault-learned pattern suggestions.
            item.sortText = 'y_' + name;
            return item;
        });
}

/** @param {import('vscode').ExtensionContext} context @returns {void} */
function registerInlineCalcCompletion(context) {
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'markdown',
            {
                provideCompletionItems(document, position) {
                    return provideCellReferenceCompletions(document, position);
                }
            },
            '`', '='
        )
    );

    // Force-trigger the suggest widget while typing inside a formula — same
    // debounced-signature pattern completion.js already uses for frontmatter
    // fields, as a backup for cases VS Code's own trigger-character handling
    // (registered just above) doesn't catch — e.g. clicking back into the
    // middle of an already-closed formula without typing a trigger character.
    let triggerTimer = null;
    let lastSignature = '';
    function maybeTriggerCellSuggest(editor) {
        if (!editor) return;
        const position = editor.selection && editor.selection.active;
        if (!position) return;
        const ctx = findEditableCalcContext(editor.document, position) || findUnclosedCalcContext(editor.document, position);
        if (!ctx) return;
        if (!ctx.priorBlocks.length && !buildVaultLearnedFormulaItems(editor.document).length) return;
        const signature = [editor.document.uri.fsPath, editor.document.version, position.line, position.character].join(':');
        if (signature === lastSignature) return;
        lastSignature = signature;
        clearTimeout(triggerTimer);
        triggerTimer = setTimeout(() => {
            vscode.commands.executeCommand('editor.action.triggerSuggest');
        }, 90);
    }
    context.subscriptions.push({ dispose() { clearTimeout(triggerTimer); } });
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection((event) => maybeTriggerCellSuggest(event.textEditor))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.insertCellReference', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'markdown') {
                vscode.window.showInformationMessage('Yamlink: Open a Markdown note to insert a cell reference.');
                return;
            }
            const blocks = scanInlineCalcs(editor.document.getText()).filter((b) => b.evalResult.ok);
            if (!blocks.length) {
                vscode.window.showInformationMessage('Yamlink: This note has no calculated cells yet.');
                return;
            }
            const picked = await vscode.window.showQuickPick(
                blocks.map((block) => ({ label: describeCellForPicker(block), block })),
                { title: 'Yamlink — Insert Cell Reference', placeHolder: 'Choose a cell to reference' }
            );
            if (!picked) return;
            await editor.edit((editBuilder) => {
                editBuilder.insert(editor.selection.active, picked.block.label);
            });
        })
    );
}

module.exports = {
    registerInlineCalcCompletion,
    provideCellReferenceCompletions,
    findEditableCalcContext,
    findUnclosedCalcContext,
    describeCellForPicker,
    collectCrossNoteCalcCellCandidates,
    buildCrossNoteCalcCellItems,
    buildVaultLearnedFormulaItems,
    buildRangeCompletionItems,
    buildFrontmatterFieldItems,
    buildTableFieldItems
};
