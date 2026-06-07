const vscode = require('vscode');
const fs = require('fs');
const { parseFrontmatter, getPathIndex, getFieldsCache, getAliasIndex, getVaultGeneration } = require('../core/indexService');
const { canonicalizeLinkedTarget, resolveLinkedTarget } = require('../core/id');
const { normaliseDateInput } = require('../core/date');
const { getSchema, getSchemaTargets } = require('../registries/schemaRegistry');
const {
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS
} = require('../intelligence/fieldRolesCore');
const { summarizeNoteRoleReasons } = require('../intelligence/noteRolesCore');
const { filterItemsForSurface, shouldSurface } = require('../intelligence/confidence');
const {
    buildNoteContext,
    buildSharedContextTraces,
    summarizeTraceHints
} = require('../intelligence/suggestionCore');
const { getVaultPatterns } = require('../intelligence/intelligenceCache');
const {
    buildFrontmatterOpportunityModel,
    buildBodyMentionHints
} = require('../intelligence/frontmatterIntelligence');
const { parseViewQuery, parseAllViewQueries, runQuery } = require('../engine/query');
const {
    computeSuggestionsForNode,
    explainSuggestionState,
    getDefaultSortFieldForType
} = require('../engine/suggestions');
const { getCachedContext } = require('../intelligence/activationCache');
const { perfTracker } = require('../runtime/performanceTracker');

const PREVIEW_LINES = 1;
const PREVIEW_MAX_CHARS = 220;
const FRONTMATTER_SKIP_FIELDS = new Set(['id']);
const HOVER_DETAIL_SKIP_FIELDS = new Set(['id', 'title', 'name', 'summary', 'type', 'status']);
const HOVER_CHIP_FIELDS = ['type', 'status'];
const HOVER_MAX_DETAILS = 3;
const FRONTMATTER_PRIORITY_FIELDS = [
    'type',
    'account',
    'contacts',
    'contact',
    'project',
    'status',
    'date',
    'email',
    'phone',
    'owner',
    'summary'
];

/** @param {import('vscode').ExtensionContext} context @param {() => Map<string,string>} getIndex @returns {void} */
function registerHover(context, getIndex) {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('markdown', {
            provideHover(document, position) {
                const idIndex = getIndex();
                const aliasIdx = getAliasIndex();
                const line = document.lineAt(position.line).text;
                // Match both ![[embed]] and [[wikilink]] forms
                const regex = /(!?)\[\[([^\]]+)\]\]/g;

                let match;
                while ((match = regex.exec(line)) !== null) {
                    const isEmbed = match[1] === '!';
                    const start = match.index;
                    const end = start + match[0].length;
                    if (position.character < start || position.character > end) continue;

                    const resolvedId = resolveLinkedTarget(match[2], idIndex, aliasIdx);
                    const filePath = resolvedId ? idIndex.get(resolvedId) : null;
                    const displayId = canonicalizeLinkedTarget(match[2]);

                    const hoverRange = new vscode.Range(
                        new vscode.Position(position.line, start),
                        new vscode.Position(position.line, end)
                    );

                    if (!filePath) {
                        const md = new vscode.MarkdownString(
                            `$(warning) Yamlink could not find \`${displayId}\`.\n\nUse Quick Fix (\`Ctrl+.\`) to create it.`
                        );
                        md.isTrusted = true;
                        md.supportThemeIcons = true;
                        return new vscode.Hover(md, hoverRange);
                    }

                    const content = readFile(filePath);
                    if (!content) return;

                    const hoverContent = buildHoverContent(resolvedId, content, filePath, idIndex);
                    if (isEmbed) {
                        hoverContent.appendMarkdown('\n\n---\n*Embedded note*');
                    }
                    return new vscode.Hover(hoverContent, hoverRange);
                }
            }
        })
    );
}

/** @param {string} lineText @param {number} character @returns {boolean} */
function isPositionInsideWikilink(lineText, character) {
    const regex = /\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = regex.exec(lineText)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (character >= start && character <= end) return true;
    }
    return false;
}

/** @param {string} id @param {string} content @param {string} [filePath] @param {Map<string,string>|null} [idIndex] @returns {import('vscode').MarkdownString} */
function buildHoverContent(id, content, filePath = '', idIndex = null) {
    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    md.supportHtml = false;
    md.supportThemeIcons = true;

    const frontmatter = parseFrontmatter(content) || {};
    const title = String(frontmatter.title || frontmatter.name || id).trim();
    const chips = buildHoverChips(frontmatter);
    const summary = buildHoverSummary(content, frontmatter);
    const details = buildHoverDetails(frontmatter, idIndex);
    const contextLine = buildHoverIntelligenceSummary(id, content, frontmatter);

    md.appendMarkdown(`### ${escapeMarkdown(title)}\n\n`);
    if (chips) {
        md.appendMarkdown(`${chips}\n\n`);
    }
    if (summary) {
        md.appendMarkdown(`${escapeMarkdown(summary)}\n\n`);
    }
    if (details.length) {
        const detailLines = details.map(({ label, value, linkedPath }) => {
            const labelMd = escapeMarkdown(label);
            const valueMd = escapeMarkdown(value);
            return `- **${labelMd}:** ${valueMd}`;
        });
        md.appendMarkdown(detailLines.join('\n'));
        md.appendMarkdown('\n\n');
    }
    if (contextLine) {
        md.appendMarkdown(`_${escapeMarkdown(contextLine)}_\n\n`);
    }

    return md;
}

function buildHoverChips(frontmatter) {
    const chips = [];
    for (const key of HOVER_CHIP_FIELDS) {
        const value = cleanValue(frontmatter[key]);
        if (!value) continue;
        chips.push(`\`${escapeMarkdown(normalizeDisplayValue(value))}\``);
        if (chips.length >= 2) break;
    }
    return chips.join(' ');
}

function buildHoverSummary(content, frontmatter) {
    const bodyPreview = extractBodyPreview(content);
    if (bodyPreview) return bodyPreview;
    const explicitSummary = cleanValue(frontmatter.summary);
    if (explicitSummary) return normalizeDisplayValue(explicitSummary);
    const details = buildHoverDetails(frontmatter);
    if (!details.length) return '';
    return details.map(({ label, value }) => `${label}: ${value}`).join(' · ');
}

function buildHoverDetails(frontmatter, idIndex) {
    return prioritizedFrontmatterEntries(frontmatter)
        .filter(([key]) => !HOVER_DETAIL_SKIP_FIELDS.has(key))
        .slice(0, HOVER_MAX_DETAILS)
        .map(([key, rawValue]) => {
            const raw = String(rawValue || '').trim();
            const display = normalizeDisplayValue(raw);
            const match = raw.match(/^\[\[([^\]|#^]+)(?:[#^][^\]|]+)?(?:\|([^\]]+))?\]\]$/);
            let linkedPath = null;
            if (match && idIndex) {
                linkedPath = idIndex.get(match[1].trim()) || null;
            }
            return { label: key, value: display, linkedPath };
        });
}

function prioritizedFrontmatterEntries(frontmatter) {
    const seen = new Set();
    const ordered = [];

    for (const key of FRONTMATTER_PRIORITY_FIELDS) {
        if (FRONTMATTER_SKIP_FIELDS.has(key)) continue;
        const value = cleanValue(frontmatter[key]);
        if (!value) continue;
        ordered.push([key, String(frontmatter[key] || '').trim()]);
        seen.add(key);
    }

    for (const [key, rawValue] of Object.entries(frontmatter || {})) {
        if (FRONTMATTER_SKIP_FIELDS.has(key) || seen.has(key)) continue;
        if (key === 'title' || key === 'name') continue;
        const value = cleanValue(rawValue);
        if (!value) continue;
        ordered.push([key, String(rawValue || '').trim()]);
    }

    return ordered;
}

function cleanValue(value) {
    if (value == null) return '';
    return String(value).trim();
}

function buildHoverActivationContext(nodeId, nodeFields, nodeType, fieldsCache) {
    const { observedFields, observedIndex } = getVaultPatterns(fieldsCache, getVaultGeneration());
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
        observedIndex,
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

/** @param {string} id @param {string} content @param {Record<string,any>|null} [frontmatter] @returns {string} */
function buildHoverIntelligenceSummary(id, content, frontmatter) {
    return perfTracker.measureSync('hover.intelligenceSummary', {
        nodeId: id, budgetMs: 5
    }, () => buildHoverContextLine(id, content, frontmatter));
}

function buildHoverContextLine(id, content, frontmatter) {
    if (!frontmatter) frontmatter = parseFrontmatter(content);
    if (!frontmatter) return '';

    const fieldsCache = getFieldsCache();
    const cachedFields = fieldsCache.get(id);
    const nodeFields = cachedFields || frontmatter;
    const nodeType = String(nodeFields.type || '').trim().toLowerCase();

    const { observedFields, noteContext, frontmatterOpportunities } = fieldsCache.has(id)
        ? getCachedContext(id, () => buildHoverActivationContext(id, nodeFields, nodeType, fieldsCache))
        : buildHoverActivationContext(id, nodeFields, nodeType, fieldsCache);

    const traceHints = summarizeTraceHints(
        buildSharedContextTraces(id, nodeFields, noteContext, fieldsCache, {
            nodeType,
            observedFields,
            getSchemaTargets,
            getSchemaForType: getSchema
        }),
        1
    );
    const hoverConnections = filterItemsForSurface(frontmatterOpportunities.likelyConnections, 'hover-opportunities', { scoreScale: 700 });
    if (hoverConnections.length) {
        return normalizeContextLead(hoverConnections[0].summary);
    }
    if (traceHints.length) {
        return normalizeContextLead(traceHints[0].summary);
    }

    const bodyMentions = buildBodyMentionHints(content, frontmatter, fieldsCache, { threshold: 2 });
    if (bodyMentions.length) {
        const top = bodyMentions[0];
        const target = normalizeDisplayValue(/** @type {any} */ (top).alias || top.id || '');
        if (target) {
            return `Mentions ${target} in the note body.`;
        }
    }

    const roleLabel = getUsefulHoverRoleLabel(noteContext, nodeType);
    if (roleLabel) {
        return normalizeContextLead(roleLabel);
    }

    return '';
}

function extractBodyPreview(content) {
    let bodyStart = 0;
    if (/^\s*---/.test(content)) {
        const firstDash = content.indexOf('---');
        const closingIndex = content.indexOf('---', firstDash + 3);
        if (closingIndex !== -1) {
            bodyStart = closingIndex + 3;
        }
    }

    const body = content.slice(bodyStart);
    const lines = body
        .split('\n')
        .map((line) => cleanPreviewLine(line))
        .filter((line) => line.length > 0 && line !== '---')
        .filter((line) => !/^#{1,6}\s+/.test(line))
        .filter((line) => !/^\[\^[^\]]+\]:/.test(line))
        .filter((line) => !/^!view\b/i.test(line))
        .filter((line) => !/^(where|select|sort|limit|via)\s+\S/i.test(line))
        .slice(0, PREVIEW_LINES);

    if (lines.length === 0) return null;
    const preview = lines.join(' ');
    return preview.length > PREVIEW_MAX_CHARS
        ? `${preview.slice(0, PREVIEW_MAX_CHARS).trimEnd()}...`
        : preview;
}

function cleanPreviewLine(line) {
    return normalizeDisplayValue(String(line || '')
        .trim()
        .replace(/(^|\s)@([a-z0-9][\w-]*)/gi, '$1$2')
        .replace(/\s+/g, ' ')
        .trim());
}

function readFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        console.error('Yamlink Hover: cannot read file:', filePath);
        return null;
    }
}

/** @param {import('vscode').ExtensionContext} context @param {() => Map<string,string>} getIndex @returns {void} */
function registerQueryPreviewHover(context, getIndex) {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('markdown', {
            provideHover(document, position) {
                const fmEnd = getFrontmatterEndLine(document);
                if (fmEnd === -1 || position.line > fmEnd) return;
                const lineText = document.lineAt(position.line).text;
                // Suppress when the line contains any wikilink — the wikilink hover provider owns these lines.
                if (/\[\[/.test(lineText)) return;

                const filePath = document.uri.fsPath;
                const nodeId = getPathIndex().get(filePath);
                if (!nodeId) return;

                const docText = document.getText();
                const md = new vscode.MarkdownString();
                md.isTrusted = true;
                md.supportThemeIcons = true;

                const suggestions = computeSuggestionsForNode(nodeId, docText);
                if (suggestions.length === 0) {
                    const explanation = explainSuggestionState(nodeId);
                    md.appendMarkdown(`### $(lightbulb) ${escapeMarkdown(explanation.title)}\n\n`);
                    if (explanation.description) {
                        md.appendMarkdown(`${escapeMarkdown(explanation.description)}\n\n`);
                    }
                    for (const reason of explanation.reasons || []) {
                        md.appendMarkdown(`- ${escapeMarkdown(reason)}\n`);
                    }
                    return new vscode.Hover(md);
                }

                md.appendMarkdown('### $(lightbulb) Suggested views\n\n');
                for (const suggestion of suggestions.slice(0, 2)) {
                    md.appendMarkdown(`**${escapeMarkdown(suggestion.title)}**\n\n`);
                    if (suggestion.description) {
                        md.appendMarkdown(`${escapeMarkdown(suggestion.description)}\n\n`);
                    }
                    const preview = buildQueryPreview(suggestion.queryText, nodeId);
                    if (preview) {
                        md.appendMarkdown(`${preview}\n`);
                    }
                }
                md.appendMarkdown('\n_Click the lightbulb to insert a view block._');

                return new vscode.Hover(md);
            }
        })
    );
}

function describePreviewQuery(query) {
    if (!query) return 'view';
    if (query.label) return String(query.label).trim();
    const scope = query.incoming ? `incoming ${query.type || 'notes'}` : (query.type || 'view');
    const firstWhere = query.wheres && query.wheres.length ? query.wheres[0] : query.where;
    if (firstWhere && firstWhere.value) {
        return `${scope} around ${firstWhere.value}`;
    }
    return scope;
}

function buildCompoundQueryPreview(queries) {
    if (!Array.isArray(queries) || queries.length <= 1) return null;
    const lines = [`_${queries.length} related views will be inserted._`];
    for (const query of queries.slice(0, 2)) {
        lines.push(`- ${escapeMarkdown(describePreviewQuery(query))}`);
    }
    if (queries.length > 2) {
        lines.push(`- ${escapeMarkdown(`${queries.length - 2} more`)}`);
    }
    return `${lines.join('\n')}\n`;
}

/** @param {string} queryText @param {string|null} [contextNodeId] @returns {string|null} */
function buildQueryPreview(queryText, contextNodeId) {
    return perfTracker.measureSync('hover.queryPreview', { budgetMs: 5 }, () => {
        const parsedQueries = parseAllViewQueries(queryText) || [];
        if (parsedQueries.length > 1) {
            return buildCompoundQueryPreview(parsedQueries);
        }

        let query = parsedQueries[0] || null;
        try {
            query = query || parseViewQuery(queryText);
        } catch (error) {
            return null;
        }
        if (!query) return null;

        const result = runQuery(query, contextNodeId);
        if (!result.success) return null;

        if (result.groupBy && Array.isArray(result.groups) && result.groups.length) {
            const top = result.groups[0];
            const topKey = String(top.key || '').replace(/\[\[([^\]]+)\]\]/g, '$1') || '-';
            const extra = result.groups.length > 1 ? `; ${result.groups.length} groups total` : '';
            return `_Groups by ${escapeMarkdown(result.groupBy)}. Top bucket: ${escapeMarkdown(topKey)} (${top.count})${escapeMarkdown(extra)}._\n`;
        }

        if (Array.isArray(result.rows) && result.rows.length) {
            const first = result.rows[0];
            const cols = (result.columns || []).filter((col) => col !== 'id').slice(0, 2);
            const summary = cols.map((col) => {
                const value = String(first.fields?.[col] || '').replace(/\[\[([^\]]+)\]\]/g, '$1').trim();
                return value ? `${col}: ${value}` : null;
            }).filter(Boolean).join(' · ');
            const more = result.rows.length > 1 ? `; ${result.rows.length} matches` : '; 1 match';
            return `_${summary ? escapeMarkdown(summary) : 'Preview ready'}${escapeMarkdown(more)}._\n`;
        }
        return null;
    });
}

function getFrontmatterEndLine(document) {
    if (document.lineCount === 0) return -1;
    const firstLine = document.lineAt(0).text.trim();
    if (firstLine !== '---') return -1;

    for (let i = 1; i < Math.min(document.lineCount, 50); i++) {
        if (document.lineAt(i).text.trim() === '---') return i;
    }
    return -1;
}

function escapeMarkdown(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/([`*_{}\[\]()#+\-.!|>])/g, '\\$1');
}

function normalizeDisplayValue(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeContextLead(value) {
    const text = normalizeDisplayValue(value)
        .replace(/^(next|focus|why|related|body|type)\s*:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return '';
    const sentence = text.endsWith('.') ? text : `${text}.`;
    return sentence.length > 120 ? `${sentence.slice(0, 117).trimEnd()}...` : sentence;
}

module.exports = {
    isPositionInsideWikilink,
    registerHover,
    registerQueryPreviewHover,
    buildHoverContent,
    buildHoverIntelligenceSummary,
    buildQueryPreview
};

function getUsefulHoverRoleLabel(noteContext, nodeType) {
    const role = noteContext.noteRole;
    if (!role?.noteRole) return '';
    const roleVisible = shouldSurface(role, 'hover-note-role', { confidenceKey: 'confidence' });
    if (!roleVisible) return '';
    const rawLabel = String(role.roleLabel || role.noteRole || '').trim();
    if (!rawLabel) return '';
    if (nodeType && rawLabel.toLowerCase() === String(nodeType).toLowerCase()) return '';
    const reason = summarizeNoteRoleReasons(role, 1);
    return reason ? `${rawLabel} - ${reason}` : rawLabel;
}
