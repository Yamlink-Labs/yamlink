const vscode = require('vscode');
const fs     = require('fs');
const { parseFrontmatter, getPathIndex, getFieldsCache } = require('../core/indexService');
const { normaliseDateInput } = require('../core/date');
const { getSchema, getSchemaTargets } = require('../registries/schemaRegistry');
const {
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS
} = require('../intelligence/fieldRolesCore');
const { summarizeNoteRoleReasons } = require('../intelligence/noteRolesCore');
const { filterItemsForSurface, shouldSurface } = require('../intelligence/confidence');
const {
    buildObservedFields,
    buildNoteContext,
    buildSharedContextTraces,
    summarizeTraceHints
} = require('../intelligence/suggestionCore');
const {
    buildFrontmatterOpportunityModel,
    buildFrontmatterGuidanceSummary,
    summarizeGuidanceExplanation,
    buildBodyMentionHints
} = require('../intelligence/frontmatterIntelligence');
const { parseViewQuery, runQuery }       = require('../engine/query');
const {
    computeSuggestionsForNode,
    explainSuggestionState,
    getDefaultSortFieldForType
} = require('../engine/suggestions');
const { getCachedContext } = require('../intelligence/activationCache');

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
                        const md = new vscode.MarkdownString(
                            `Warning: **Yamlink** could not find \`${id}\` in the index.\n\n` +
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

    const frontmatter = parseFrontmatter(content);
    const intelligenceSummary = buildHoverIntelligenceSummary(id, content, frontmatter);
    if (intelligenceSummary) {
        md.appendMarkdown(`${intelligenceSummary}\n\n---\n`);
    }

    // ── YAML fields ──
    if (frontmatter && Object.keys(frontmatter).length > 0) {
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

// Local activation context builder — mirrors suggestions.js's buildActivationContext.
// Defined here so hover.js uses its own real intelligence imports rather than the
// suggestions.js export (which test stubs intercept), while still sharing cache
// entries with suggestions.js when both use getCachedContext on the same nodeId.
function buildHoverActivationContext(nodeId, nodeFields, nodeType, fieldsCache) {
    const observedFields = buildObservedFields(fieldsCache);
    const noteContext = buildNoteContext(nodeFields, nodeType, {
        observedFields,
        getSchemaForType: getSchema,
        dateParser: normaliseDateInput,
        statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS
    });
    const frontmatterOpportunities = buildFrontmatterOpportunityModel(nodeFields, {
        nodeId,
        nodeType,
        fieldsCache,
        observedFields,
        noteContext,
        getSchemaTargets,
        getSchemaForType: getSchema,
        getDefaultSortField: getDefaultSortFieldForType,
        dateParser: normaliseDateInput,
        statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS,
        limit: 4,
        connectionLimit: 4
    });
    return { observedFields, noteContext, frontmatterOpportunities };
}

function buildHoverIntelligenceSummary(id, content, frontmatter) {
    if (!frontmatter) frontmatter = parseFrontmatter(content);
    if (!frontmatter) return '';

    const fieldsCache  = getFieldsCache();
    const cachedFields = fieldsCache.get(id);
    const nodeFields   = cachedFields || frontmatter;
    const nodeType     = String(nodeFields.type || '').trim().toLowerCase();

    const { observedFields, noteContext, frontmatterOpportunities } = fieldsCache.has(id)
        ? getCachedContext(id, () => buildHoverActivationContext(id, nodeFields, nodeType, fieldsCache))
        : buildHoverActivationContext(id, nodeFields, nodeType, fieldsCache);

    if (!noteContext.noteRole?.noteRole) return '';

    const roleVisible = shouldSurface(noteContext.noteRole, 'hover-note-role', { confidenceKey: 'confidence' });
    const reason = summarizeNoteRoleReasons(noteContext.noteRole, 1);
    let summary = '';
    if (roleVisible) {
        summary = `$(sparkle) This looks like a **${noteContext.noteRole.roleLabel || noteContext.noteRole.noteRole}** note`;
        if (reason) summary += `\n\n_${reason}_`;
    } else {
        summary = `$(sparkle) Getting to know this note`;
    }

    const traceHints = summarizeTraceHints(
        buildSharedContextTraces(id, nodeFields, noteContext, fieldsCache, {
            nodeType,
            observedFields,
            getSchemaTargets,
            getSchemaForType: getSchema
        }),
        1
    );
    if (traceHints.length) {
        summary += `\n\n$(link) Nearby: ${traceHints[0].summary}`;
    }
    const guidance = buildFrontmatterGuidanceSummary(frontmatterOpportunities);
    const hoverFields = filterItemsForSurface(frontmatterOpportunities.likelyFields, 'hover-opportunities', { scoreScale: 700 });
    const hoverGaps = filterItemsForSurface(frontmatterOpportunities.likelyGaps, 'hover-opportunities', { scoreScale: 700 });
    const hoverContexts = filterItemsForSurface(frontmatterOpportunities.likelyContexts, 'hover-opportunities', { scoreScale: 700 });
    const hoverConnections = filterItemsForSurface(frontmatterOpportunities.likelyConnections, 'hover-opportunities', { scoreScale: 700 });
    const hoverCompanions = filterItemsForSurface(frontmatterOpportunities.likelyCompanions, 'hover-opportunities', { scoreScale: 700 });
    const hoverRelationViews = filterItemsForSurface(frontmatterOpportunities.relationViews, 'hover-opportunities', { scoreScale: 900 });
    const hoverThreadViews = filterItemsForSurface(frontmatterOpportunities.contextThreadViews, 'hover-opportunities', { scoreScale: 900 });
    const hoverSetups = filterItemsForSurface(frontmatterOpportunities.surroundingSetups, 'hover-opportunities', { scoreScale: 1100 });

    if (guidance.headline) {
        summary += `\n\n$(milestone) Next step: ${guidance.headline}`;
    }
    const guidanceWhy = summarizeGuidanceExplanation(guidance);
    if (guidanceWhy) {
        summary += `\n\n$(comment-discussion) Why: ${guidanceWhy}`;
    }
    if (hoverFields.length) {
        summary += `\n\n$(plus) Next field: ${hoverFields[0].summary}`;
    }
    if (hoverGaps.length) {
        summary += `\n\n$(diff-added) Missing: ${hoverGaps[0].missingSummary}`;
    }
    if (hoverContexts.length) {
        summary += `\n\n$(organization) Context: ${hoverContexts[0].summary}`;
    }
    if (frontmatterOpportunities.contextBundle?.summary) {
        summary += `\n\n$(symbol-structure) Flow: ${frontmatterOpportunities.contextBundle.summary}`;
    }
    if (frontmatterOpportunities.setupFields.length) {
        summary += `\n\n$(list-unordered) Try: add ${frontmatterOpportunities.setupFields.map((hint) => hint.field).slice(0, 3).join(', ')}`;
    }
    if (frontmatterOpportunities.recommendedBundle?.fields?.length) {
        summary += `\n\n$(package) Useful fields: ${frontmatterOpportunities.recommendedBundle.fields.map((hint) => hint.field).slice(0, 3).join(', ')}`;
    }
    if (guidance.workflowSummary) {
        summary += `\n\n$(symbol-structure) Pattern: ${guidance.workflowSummary}`;
    }
    if (hoverConnections.length) {
        summary += `\n\n$(git-pull-request) Related note: ${hoverConnections[0].summary}`;
    }
    if (hoverCompanions.length) {
        summary += `\n\n$(group-by-ref-type) Nearby note: ${hoverCompanions[0].summary}`;
    }
    if (hoverRelationViews.length) {
        summary += `\n\n$(list-tree) Thread: ${hoverRelationViews[0].summary}`;
    }
    if (hoverThreadViews.length) {
        summary += `\n\n$(references) Common view: ${hoverThreadViews[0].summary}`;
    }
    if (hoverSetups.length) {
        summary += `\n\n$(hubot) Setup: ${hoverSetups[0].summary}`;
    }

    const bodyMentions = buildBodyMentionHints(content, frontmatter, fieldsCache, { threshold: 2 });
    if (bodyMentions.length) {
        const top = bodyMentions[0];
        const times = top.count === 1 ? 'once' : `${top.count}×`;
        summary += `\n\n$(references) Body link: [[${top.id}]] mentioned ${times}`;
    }

    const suggestions = computeSuggestionsForNode(id, content);
    if (suggestions.length) {
        summary += `\n\n$(lightbulb) Next view: ${suggestions[0].title}`;
    }
    return summary;
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
                const md = new vscode.MarkdownString();
                md.isTrusted         = true;
                md.supportThemeIcons = true;

                const suggestions = computeSuggestionsForNode(nodeId, docText);
                if (suggestions.length === 0) {
                    const explanation = explainSuggestionState(nodeId);
                    md.appendMarkdown(`### $(lightbulb) ${explanation.title}

${explanation.description}

`);
                    for (const reason of explanation.reasons || []) {
                        md.appendMarkdown(`- ${reason}

`);
                    }
                    return new vscode.Hover(md);
                }

                md.appendMarkdown(`### $(lightbulb) View suggestions

`);

                for (const suggestion of suggestions) {
                    md.appendMarkdown(`**${suggestion.title}**

${suggestion.description}

`);

                    // Run the query and show a 3-row preview
                    const preview = buildQueryPreview(suggestion.queryText, nodeId, getIndex);
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

module.exports = {
    registerHover,
    registerQueryPreviewHover,
    buildHoverIntelligenceSummary
};
