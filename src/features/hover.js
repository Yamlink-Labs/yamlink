const vscode = require('vscode');
const fs     = require('fs');
const { parseFrontmatter, getPathIndex } = require('../core/index');
const { parseViewQuery, runQuery }       = require('../engine/query');
const { computeSuggestionsForNode }      = require('../engine/suggestions');

// ─────────────────────────────────────────────────────────────────
// hover.js — Hover preview (Stage 2B + relation enrichment 0.2.0)
//
// Hover over [[id]] → tooltip shows:
//   - YAML fields from frontmatter
//   - Relation fields expand inline: the linked node's own fields
//     are shown indented beneath the link, so hovering on a contact
//     linked via account: [[acme]] reveals acme's type, industry,
//     employees etc. without leaving the file.
//   - First N lines of body content
//
// Independent of graph layer. Works on identity index alone.
// ─────────────────────────────────────────────────────────────────

const PREVIEW_LINES = 8; // Number of body lines to show in tooltip

// Fields to skip when rendering an expanded linked node inline.
// Keeps the hover tight — the full node is one Ctrl+Click away.
const RELATION_SKIP_FIELDS = new Set(['id', 'created']);

function registerHover(context, getIndex) {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('markdown', {
            provideHover(document, position) {
                const idIndex = getIndex();
                const line    = document.lineAt(position.line).text;
                const regex   = /\[\[([^\]]+)\]\]/g;

                let match;
                while ((match = regex.exec(line)) !== null) {
                    const start = match.index;
                    const end   = start + match[0].length;

                    // Only trigger when cursor is inside [[...]]
                    if (position.character < start || position.character > end) continue;

                    const id       = match[1].trim();
                    const filePath = idIndex.get(id);

                    if (!filePath) {
                        // Node doesn't exist — hint that it can be created
                        const md = new vscode.MarkdownString(
                            `⚠ **Yamlink**: \`${id}\` is not indexed.\n\n` +
                            `_Use Quick Fix (Ctrl+.) to create this node._`
                        );
                        md.isTrusted = true;
                        return new vscode.Hover(md);
                    }

                    // Node exists — build rich preview
                    const content = readFile(filePath);
                    if (!content) return;

                    const hover = buildHoverContent(id, content, filePath, idIndex);
                    return new vscode.Hover(hover);
                }
            }
        })
    );
}

// ─────────────────────────────────────────────────────────────────
// buildHoverContent
//
// Assembles MarkdownString from frontmatter + body preview.
//
// Relation enrichment: when a frontmatter value is [[someId]],
// resolve that node and render its fields indented beneath the
// link line. Depth is fixed at 1 — no recursive expansion.
// ─────────────────────────────────────────────────────────────────
function buildHoverContent(id, content, filePath, idIndex) {
    const md = new vscode.MarkdownString();
    md.isTrusted         = true;
    md.supportHtml       = false;
    md.supportThemeIcons = true;

    // ── Header ──
    md.appendMarkdown(`### $(file) \`${id}\`\n\n`);

    // ── YAML fields ──
    const frontmatter = parseFrontmatter(content);
    if (frontmatter && Object.keys(frontmatter).length > 0) {
        md.appendMarkdown(`---\n`);

        for (const [key, value] of Object.entries(frontmatter)) {
            if (key === 'id') continue; // Already shown in header

            // ── Relation enrichment ──────────────────────────────
            // If the value is a single [[link]], resolve the linked
            // node and expand its frontmatter fields inline.
            const linkMatch = typeof value === 'string'
                ? value.match(/^\[\[([^\]]+)\]\]$/)
                : null;

            if (linkMatch && idIndex) {
                const linkedId   = linkMatch[1].trim();
                const linkedPath = idIndex.get(linkedId);

                if (linkedPath) {
                    const linkedContent = readFile(linkedPath);
                    const linkedFm      = linkedContent
                        ? parseFrontmatter(linkedContent)
                        : null;

                    if (linkedFm && Object.keys(linkedFm).length > 0) {
                        // Render the field line with the link
                        md.appendMarkdown(`**${key}:** \`${linkedId}\`  \n`);

                        // Expand linked node's fields indented beneath
                        for (const [lk, lv] of Object.entries(linkedFm)) {
                            if (RELATION_SKIP_FIELDS.has(lk)) continue;
                            md.appendMarkdown(`&nbsp;&nbsp;&nbsp;&nbsp;↳ **${lk}:** ${lv}  \n`);
                        }
                        continue;
                    }
                }
            }

            // Plain (non-relation) field
            md.appendMarkdown(`**${key}:** ${value}  \n`);
        }

        md.appendMarkdown(`\n`);
    }

    // ── Body preview ──
    const bodyPreview = extractBodyPreview(content);
    if (bodyPreview) {
        md.appendMarkdown(`---\n`);
        md.appendMarkdown(bodyPreview);
    }

    return md;
}

// ─────────────────────────────────────────────────────────────────
// extractBodyPreview
// Returns first N non-empty lines after the frontmatter block
// ─────────────────────────────────────────────────────────────────
function extractBodyPreview(content) {
    let bodyStart = 0;
    if (/^\s*---/.test(content)) {
        const firstDash    = content.indexOf('---');
        const closingIndex = content.indexOf('---', firstDash + 3);
        if (closingIndex !== -1) {
            bodyStart = closingIndex + 3;
        }
    }

    const body  = content.slice(bodyStart);
    const lines = body
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .slice(0, PREVIEW_LINES);

    if (lines.length === 0) return null;

    return lines.join('\n\n') + (lines.length === PREVIEW_LINES ? '\n\n_..._' : '');
}

function readFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        console.error("Yamlink — Hover: cannot read file:", filePath);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────
// registerQueryPreviewHover
//
// Second hover provider — fires when cursor is in the frontmatter
// of a node that has active querySuggestion diagnostics.
//
// Shows: suggestion description + up to 3 result rows as a markdown
// table + "click 💡 to insert" nudge.
//
// Registered separately from registerHover so the two concerns
// never interfere with each other.
// ─────────────────────────────────────────────────────────────────
function registerQueryPreviewHover(context, getIndex) {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('markdown', {
            provideHover(document, position) {
                // Only fire inside the frontmatter block
                const fmEnd = getFrontmatterEndLine(document);
                if (fmEnd === -1 || position.line > fmEnd) return;

                // Only fire if this document is an indexed node
                const filePath = document.uri.fsPath;
                const nodeId   = getPathIndex().get(filePath);
                if (!nodeId) return;

                const docText     = document.getText();
                const suggestions = computeSuggestionsForNode(nodeId, docText);
                if (suggestions.length === 0) return;

                const md = new vscode.MarkdownString();
                md.isTrusted         = true;
                md.supportThemeIcons = true;

                md.appendMarkdown(`### $(lightbulb) View suggestions

`);

                for (const { field, sourceType, count, queryText } of suggestions) {
                    const plural = count === 1 ? sourceType : sourceType + 's';
                    md.appendMarkdown(`**${count} ${plural}** linked via \`${field}\`

`);

                    // Run the query and show a 3-row preview
                    const preview = buildQueryPreview(queryText, nodeId, getIndex);
                    if (preview) {
                        md.appendMarkdown(preview);
                    }

                    md.appendMarkdown(`
`);
                }

                md.appendMarkdown(`---
_Click 💡 to insert a view block_`);

                return new vscode.Hover(md);
            }
        })
    );
}

// ─────────────────────────────────────────────────────────────────
// buildQueryPreview
//
// Parses queryText, runs it, and returns a markdown table string
// showing up to PREVIEW_ROWS rows. Returns null if no results.
// ─────────────────────────────────────────────────────────────────
const PREVIEW_ROWS = 3;

function buildQueryPreview(queryText, contextNodeId, getIndex) {
    let query;
    try {
        query = parseViewQuery(queryText);
    } catch (e) {
        return null;
    }
    if (!query) return null;

    const result = runQuery(query, contextNodeId);
    if (!result.success || result.rows.length === 0) return null;

    // Cap columns for readability in a tooltip — id + up to 3 others
    const allCols  = result.columns;
    const cols     = allCols.includes('id')
        ? ['id', ...allCols.filter(c => c !== 'id').slice(0, 3)]
        : allCols.slice(0, 4);

    const rows  = result.rows.slice(0, PREVIEW_ROWS);
    const total = result.rows.length;

    // Markdown table
    const header    = '| ' + cols.join(' | ') + ' |';
    const separator = '| ' + cols.map(() => '---').join(' | ') + ' |';
    const bodyRows  = rows.map(row => {
        const cells = cols.map(col => {
            if (col === 'id') return '`' + row.id + '`';
            const v = row.fields[col] || '';
            // Strip wikilink brackets for readability
            return v.replace(/\[\[([^\]]+)\]\]/g, '$1') || '—';
        });
        return '| ' + cells.join(' | ') + ' |';
    });

    const table = [header, separator, ...bodyRows].join('\n');
    const more  = total > PREVIEW_ROWS
        ? `\n_${PREVIEW_ROWS} of ${total} shown_\n`
        : '\n';

    return table + more;
}

// ─────────────────────────────────────────────────────────────────
// getFrontmatterEndLine
//
// Returns the line index of the closing --- or -1 if not found.
// ─────────────────────────────────────────────────────────────────
function getFrontmatterEndLine(document) {
    if (document.lineCount === 0) return -1;
    const firstLine = document.lineAt(0).text.trim();
    if (firstLine !== '---') return -1;

    for (let i = 1; i < Math.min(document.lineCount, 50); i++) {
        if (document.lineAt(i).text.trim() === '---') return i;
    }
    return -1;
}

module.exports = { registerHover, registerQueryPreviewHover };