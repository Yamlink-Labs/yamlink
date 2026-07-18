const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { parseFrontmatter, getPathIndex, getFieldsCache, getAliasIndex, getVaultGeneration } = require('../core/indexService');
const { canonicalizeLinkedTarget, resolveLinkedTarget, parseLinkedTargetParts } = require('../core/id');
const { resolveImageEmbed } = require('../core/imageEmbed');
const { normaliseDateInput } = require('../core/date');
const { extractMeaningfulBodyBlocks, normalizeAnchorText } = require('../core/bodyBlocks');
const { getSchema, getSchemaTargets } = require('../registries/schemaRegistry');
const {
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS
} = require('../intelligence/fieldRolesCore');
const {
    getCachedPriors,
    buildVaultStatusValues,
    buildVaultSemanticRolePriors
} = require('../intelligence/vaultPriors');
const { summarizeNoteRoleReasons } = require('../intelligence/noteRolesCore');
const { filterItemsForSurface, shouldSurface } = require('../intelligence/confidence');
const {
    buildNoteContext,
    buildSharedContextTraces,
    summarizeTraceHints
} = require('../intelligence/suggestionCore');
const { getVaultPatterns } = require('../intelligence/intelligenceCache');
const { summarizeAuthoringFieldSignals } = require('../intelligence/authoringEngine');
const {
    buildFrontmatterOpportunityModel,
    buildBodyMentionHints
} = require('../intelligence/frontmatterIntelligence');
const {
    buildHoverBadgeSvg,
    buildHoverBadgeDataUri,
    buildHoverBadgeMarkdown
} = require('../intelligence/hoverBadge');
const { parseViewQuery, parseAllViewQueries, runQuery } = require('../engine/query');
const {
    computeSuggestionsForNode,
    explainSuggestionState,
    getDefaultSortFieldForType
} = require('../engine/suggestions');
const { getCachedContext } = require('../intelligence/activationCache');
const { perfTracker } = require('../runtime/performanceTracker');
const { stripFrontmatter } = require('../intelligence/bodySignals');

const PREVIEW_LINES = 1;
const PREVIEW_MAX_CHARS = 220;
const FRONTMATTER_SKIP_FIELDS = new Set(['id']);
const HOVER_DETAIL_SKIP_FIELDS = new Set(['id', 'title', 'name', 'summary', 'type', 'status']);
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

                    const rawLinkText = String(match[2] || '');
                    const linkParts = parseLinkedTargetParts(rawLinkText);
                    const resolvedId = resolveLinkedTarget(rawLinkText, idIndex, aliasIdx);
                    const filePath = resolvedId ? idIndex.get(resolvedId) : null;
                    const displayId = canonicalizeLinkedTarget(rawLinkText);

                    const hoverRange = new vscode.Range(
                        new vscode.Position(position.line, start),
                        new vscode.Position(position.line, end)
                    );

                    if (!filePath) {
                        // ![[photo.png]] isn't a note — idIndex only resolves notes,
                        // so this previously always fell through to the broken-link
                        // message even for a perfectly valid image embed. Try
                        // resolving it as an image file relative to this note first.
                        if (isEmbed) {
                            const imagePath = resolveImageEmbed(rawLinkText, path.dirname(document.uri.fsPath));
                            if (imagePath) {
                                return new vscode.Hover(_buildImagePreviewHover(imagePath), hoverRange);
                            }
                        }
                        const md = new vscode.MarkdownString(
                            `$(warning) Yamlink could not find \`${displayId}\`.\n\nUse Quick Fix (\`Ctrl+.\`) to create it.`
                        );
                        md.isTrusted = true;
                        md.supportThemeIcons = true;
                        return new vscode.Hover(md, hoverRange);
                    }

                    const content = readFile(filePath);
                    if (!content) return;

                    const hoverContent = buildHoverContent(
                        resolvedId,
                        content,
                        filePath,
                        idIndex,
                        linkParts.anchor,
                        linkParts.blockId
                    );
                    if (isEmbed) {
                        hoverContent.appendMarkdown('\n\n---\n*Embedded note*');
                    }
                    return new vscode.Hover(hoverContent, hoverRange);
                }
            }
        })
    );
}


/** @param {string} imagePath @returns {import('vscode').MarkdownString} */
function _buildImagePreviewHover(imagePath) {
    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    md.supportHtml = false;
    const uri = vscode.Uri.file(imagePath).toString();
    const name = path.basename(imagePath);
    let sizeLabel = '';
    try {
        sizeLabel = _formatFileSize(fs.statSync(imagePath).size);
    } catch { /* size is decorative — skip silently if unavailable */ }
    md.appendMarkdown(`![${escapeMarkdown(name)}](${uri})`);
    md.appendMarkdown(`\n\n_${escapeMarkdown(name)}${sizeLabel ? ` · ${sizeLabel}` : ''}_`);
    return md;
}

/** @param {number} bytes @returns {string} */
function _formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

/** @param {string} id @param {string} content @param {string} [filePath] @param {Map<string,string>|null} [idIndex] @param {string} [anchorRaw] @param {string} [blockId] @returns {import('vscode').MarkdownString} */
function buildHoverContent(id, content, filePath = '', idIndex = null, anchorRaw = '', blockId = '') {
    const anchorPreview = buildAnchorHoverContent(content, anchorRaw);
    if (anchorPreview) return anchorPreview;
    const blockPreview = buildBlockHoverContent(content, blockId);
    if (blockPreview) return blockPreview;

    const md = new vscode.MarkdownString();
    // Trusted so relation-field and body-preview wikilinks can render as real
    // command:vscode.open links. Safe: escapeMarkdown() escapes `[`, `]`, `(`,
    // `)` in every plain-text segment (title, summary, detail values), so a
    // note's own authored content can never forge a working command link —
    // only renderInlineWikilinks()'s own constructed link syntax is trusted.
    md.isTrusted = true;
    md.supportHtml = false;
    md.supportThemeIcons = true;

    const frontmatter = parseFrontmatter(content) || {};
    const title = String(frontmatter.title || frontmatter.name || id).trim();
    const badgeMarkdown = buildHoverBadgeMarkdown(frontmatter);
    const summary = buildHoverSummary(content, frontmatter);
    const details = buildHoverDetails(frontmatter, idIndex);
    const contextLine = buildHoverIntelligenceSummary(id, content, frontmatter);

    md.appendMarkdown(`### ${escapeMarkdown(title)}\n\n`);
    if (badgeMarkdown) {
        md.appendMarkdown(`${badgeMarkdown}\n\n`);
    }
    if (summary) {
        md.appendMarkdown(`${renderInlineWikilinks(summary, idIndex)}\n\n`);
    }
    if (details.length) {
        const detailLines = details.map(({ label, value, linkedPath }) => {
            const labelMd = escapeMarkdown(label);
            const valueMd = linkedPath
                ? `[${escapeMarkdown(value)}](${buildOpenNoteCommandUri(linkedPath)})`
                : escapeMarkdown(value);
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

function buildAnchorHoverContent(content, anchorRaw) {
    const anchorNorm = normalizeAnchorText(anchorRaw);
    if (!anchorNorm) return null;

    const body = stripFrontmatter(content);
    const lines = body.split(/\r?\n/);

    for (let index = 0; index < lines.length; index++) {
        const match = lines[index].match(/^(#{1,6})\s+(.+)$/);
        if (!match) continue;
        const headingText = String(match[2] || '').trim();
        if (normalizeAnchorText(headingText) !== anchorNorm) continue;

        const level = match[1].length;
        const collected = [];
        for (let cursor = index + 1; cursor < lines.length; cursor++) {
            const line = lines[cursor];
            if (new RegExp(`^#{1,${level}}\\s`).test(line)) break;
            collected.push(line);
            if (collected.length >= 8) break;
        }
        const paragraphText = collected.join('\n').trim();
        const clipped = paragraphText.length > 300 ? `${paragraphText.slice(0, 299).trimEnd()}…` : paragraphText;
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = false;
        md.supportThemeIcons = true;
        md.appendMarkdown(`**${escapeMarkdown(headingText)}**\n\n${escapeMarkdown(clipped || headingText)}`);
        return md;
    }

    return null;
}

function buildBlockHoverContent(content, blockId) {
    const wanted = String(blockId || '').trim();
    if (!wanted) return null;

    const block = extractMeaningfulBodyBlocks(content).find((entry) => entry.blockId === wanted);
    if (!block) return null;

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = false;
    md.supportThemeIcons = true;

    const title = describeBodyBlockTitle(block);
    const clipped = clipBlockPreviewText(block.text || block.label || title);
    md.appendMarkdown(`**${escapeMarkdown(title)}**\n\n${escapeMarkdown(clipped)}`);
    return md;
}

function describeBodyBlockTitle(block) {
    switch (block?.type) {
        case 'task':
            return 'Task';
        case 'quote':
            return 'Quote';
        case 'footnote':
            return block.label ? `Footnote: ${block.label}` : 'Footnote';
        default:
            return block?.label ? String(block.label) : 'Block';
    }
}

function clipBlockPreviewText(value) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text) return '';
    return text.length > 300 ? `${text.slice(0, 299).trimEnd()}…` : text;
}

// ─── Custom badge rendering ─────────────────────────────────────────────────
//
// VS Code's native hover widget is the only real hover surface — every
// registered hover provider's content merges into that one widget, and there
// is no public API to swap its chrome for custom HTML/CSS (MarkdownString's
// HTML support is sanitized: no `style` attributes, no `<style>` blocks).
// A past attempt at a custom-styled card apparently used a separate Webview
// overlay instead, which can't replace the native hover — only sit alongside
// an already-active one, which is why it looked like two cards stacked.
//
// This renders real Apollo-palette-colored pills as an SVG data URI, embedded
// via plain markdown image syntax (`![](data:...)`). Images bypass the HTML
// sanitizer entirely since they're not HTML — this is the one channel that
// gets genuinely custom typography/color inside the one legitimate hover.

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
            const isWikilink = /^\[\[.+\]\]$/.test(raw);
            let linkedPath = null;
            let display = normalizeDisplayValue(raw);
            if (isWikilink) {
                const inner = raw.slice(2, -2);
                const parts = parseLinkedTargetParts(inner);
                display = normalizeDisplayValue(parts.label || parts.target || raw);
                if (idIndex) {
                    const resolvedId = resolveLinkedTarget(inner, idIndex, getAliasIndex());
                    linkedPath = resolvedId ? idIndex.get(resolvedId) || null : null;
                }
            }
            return { label: key, value: display, linkedPath };
        });
}

/** @param {string} filePath @returns {string} a command:vscode.open URI that opens the file when clicked in a trusted hover */
function buildOpenNoteCommandUri(filePath) {
    const args = encodeURIComponent(JSON.stringify([vscode.Uri.file(filePath).toString()]));
    return `command:vscode.open?${args}`;
}

const INLINE_WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * Renders `[[id]]` / `[[id|Alias]]` occurrences in freeform text as clickable
 * `command:vscode.open` links, escaping everything else. Unresolved links
 * fall back to plain escaped bracket text rather than a broken link.
 * @param {string} text
 * @param {Map<string,string>|null} idIndex
 * @returns {string}
 */
function renderInlineWikilinks(text, idIndex) {
    const raw = String(text || '');
    if (!idIndex) return escapeMarkdown(raw);
    const aliasIdx = getAliasIndex();
    let result = '';
    let lastIndex = 0;
    INLINE_WIKILINK_RE.lastIndex = 0;
    let match;
    while ((match = INLINE_WIKILINK_RE.exec(raw)) !== null) {
        result += escapeMarkdown(raw.slice(lastIndex, match.index));
        const inner = match[1];
        const parts = parseLinkedTargetParts(inner);
        const resolvedId = resolveLinkedTarget(inner, idIndex, aliasIdx);
        const filePath = resolvedId ? idIndex.get(resolvedId) : null;
        const displayText = parts.label || parts.target || inner;
        result += filePath
            ? `[${escapeMarkdown(displayText)}](${buildOpenNoteCommandUri(filePath)})`
            : escapeMarkdown(`[[${inner}]]`);
        lastIndex = match.index + match[0].length;
    }
    result += escapeMarkdown(raw.slice(lastIndex));
    return result;
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
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const derivedStatusLikeValues = buildVaultStatusValues(priors.workflowFields);
    const derivedSemanticRolePriors = buildVaultSemanticRolePriors(priors);
    const statusLikeValues = new Set([
        ...Array.from(DEFAULT_STATUS_LIKE_VALUES),
        ...Array.from(derivedStatusLikeValues || [])
    ]);
    const semanticRolePriors = {};
    for (const role of new Set([
        ...Object.keys(DEFAULT_SEMANTIC_ROLE_PRIORS),
        ...Object.keys(derivedSemanticRolePriors || {})
    ])) {
        semanticRolePriors[role] = [
            ...new Set([
                ...(DEFAULT_SEMANTIC_ROLE_PRIORS[role] || []),
                ...(derivedSemanticRolePriors?.[role] || [])
            ])
        ];
    }
    const noteContext = buildNoteContext(nodeFields, nodeType, {
        observedFields,
        getSchemaForType: getSchema,
        dateParser: normaliseDateInput,
        statusLikeValues,
        semanticRolePriors,
        noteRolePriors: priors.noteRoleNamePriors,
        noteRoleFieldHints: priors.noteRoleFieldHints,
        typeRoleMap: priors.typeRoleMap
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
        statusLikeValues,
        semanticRolePriors,
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
    const authoringSummary = summarizeAuthoringFieldSignals('lightbulb', {
        noteType: nodeType,
        noteFields: nodeFields,
        documentText: content,
        fieldsCache,
        generation: getVaultGeneration()
    });
    if (authoringSummary?.summary) {
        return normalizeContextLead(authoringSummary.summary);
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
    const hoverConnections = filterItemsForSurface(frontmatterOpportunities.likelyConnections, 'hover-opportunities', { scoreScale: 700 });
    const hoverLikelyFields = filterItemsForSurface(frontmatterOpportunities.likelyFields, 'hover-opportunities', { scoreScale: 700 });
    const hoverLikelyGaps = filterItemsForSurface(frontmatterOpportunities.likelyGaps, 'hover-opportunities', { scoreScale: 700 });
    if (hoverConnections.length) {
        return normalizeContextLead(hoverConnections[0].summary);
    }
    if (hoverLikelyFields.length) {
        return normalizeContextLead(hoverLikelyFields[0].summary || `Likely next field: ${hoverLikelyFields[0].field || hoverLikelyFields[0].key}`);
    }
    if (hoverLikelyGaps.length) {
        return normalizeContextLead(hoverLikelyGaps[0].summary || `Likely missing field: ${hoverLikelyGaps[0].field || hoverLikelyGaps[0].key}`);
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
    buildAnchorHoverContent,
    buildHoverIntelligenceSummary,
    buildQueryPreview,
    buildHoverBadgeSvg,
    buildHoverBadgeDataUri,
    buildHoverBadgeMarkdown,
    renderInlineWikilinks,
    buildOpenNoteCommandUri,
    _buildImagePreviewHover
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
