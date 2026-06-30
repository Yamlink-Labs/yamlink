'use strict';

const { parseFrontmatterDocument } = require('../../core/frontmatter');
const { getFieldsCache } = require('../../core/index');
const { parseAllViewQueries, runQuery } = require('../../engine/query');

let _md = null;
function getMd() {
    if (!_md) {
        const MarkdownIt = require('markdown-it');
        const { calloutPlugin } = require('../../export/markdownItCallouts');
        _md = new MarkdownIt({ html: true, linkify: false });
        calloutPlugin(_md);
    }
    return _md;
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const VIEW_CLAUSE_RE = /^(select|where|sort|limit|via|group)\b/i;
const FENCE_OPEN_RE = /^(`{3,}|~{3,})/;

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
}

function extractFootnoteDefinitions(text) {
    const lines = String(text || '').split('\n');
    const bodyLines = [];
    const definitions = new Map();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
        if (!match) {
            bodyLines.push(line);
            continue;
        }

        const id = String(match[1] || '').trim();
        const valueLines = [match[2] || ''];
        let j = i + 1;
        while (j < lines.length && /^( {2,}|\t)/.test(lines[j])) {
            valueLines.push(lines[j].replace(/^( {2,}|\t)/, ''));
            j++;
        }
        definitions.set(id, valueLines.join('\n').trim());
        i = j - 1;
    }

    return {
        bodyText: bodyLines.join('\n'),
        definitions
    };
}

function renderMarkdownWithFootnotes(md, text) {
    const { bodyText, definitions } = extractFootnoteDefinitions(text);
    const orderedIds = [];

    const referencedBody = bodyText.replace(/\[\^([^\]]+)\]/g, (full, rawId) => {
        const id = String(rawId || '').trim();
        if (!definitions.has(id)) return full;
        let index = orderedIds.indexOf(id);
        if (index === -1) {
            orderedIds.push(id);
            index = orderedIds.length - 1;
        }
        const num = index + 1;
        const safeId = escapeHtmlAttr(id);
        return `<sup class="yl-footnote-ref"><a class="yl-footnote-link" href="#yl-fn-${safeId}" id="yl-fnref-${safeId}">[${num}]</a></sup>`;
    });

    let html = md.render(referencedBody);
    if (!orderedIds.length) return html;

    const items = orderedIds.map((id, index) => {
        const safeId = escapeHtmlAttr(id);
        const rawText = definitions.get(id) || '';
        const rendered = md.renderInline(rawText);
        return `<li id="yl-fn-${safeId}"><span class="yl-footnote-index">${index + 1}.</span> <span class="yl-footnote-body">${rendered}</span> <a class="yl-footnote-backref" href="#yl-fnref-${safeId}">↩</a></li>`;
    }).join('');

    return `${html}<section class="yl-footnotes"><h2>Footnotes</h2><ol>${items}</ol></section>`;
}

function wikilinkToSpan(html) {
    const fieldsCache = getFieldsCache();
    const segments = html.split(/(<(?:code|pre)\b[^>]*>[\s\S]*?<\/(?:code|pre)>)/gi);
    return segments.map((seg, idx) => {
        if (idx % 2 === 1) return seg;
        return seg.replace(WIKILINK_RE, (_, nodeId) => {
            const fields = fieldsCache.get(nodeId);
            const label = fields?.name || fields?.title || nodeId;
            return `<span class="wikilink">${escapeHtml(label)}</span>`;
        });
    }).join('');
}

function cellValue(value) {
    if (value === null || value === undefined || value === '') return '';
    if (Array.isArray(value)) return value.map(v => escapeHtml(String(v))).join(', ');
    return escapeHtml(String(value));
}

function buildViewTable(query, contextNodeId) {
    const label = query.label || (query.type === '*' ? 'All nodes' : query.type);
    let result;
    try {
        result = runQuery(query, contextNodeId);
    } catch (err) {
        return `<div class="view-block"><div class="view-label">${escapeHtml(label)}</div><div class="view-error">Query error: ${escapeHtml(err.message)}</div></div>`;
    }

    if (!result.success) {
        const msg = result.error || 'Query failed';
        return `<div class="view-block"><div class="view-label">${escapeHtml(label)}</div><div class="view-error">${escapeHtml(msg)}</div></div>`;
    }

    const rows = result.rows || [];
    const columns = result.columns || [];

    if (!rows.length) {
        return `<div class="view-block"><div class="view-label">${escapeHtml(label)}</div><div class="view-empty">No results</div></div>`;
    }

    const thead = `<thead><tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`;
    const tbody = `<tbody>${rows.map(row => {
        const cells = columns.map(col => {
            const val = col === 'id' ? row.id : (row.fields?.[col] ?? '');
            return `<td>${cellValue(val)}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('')}</tbody>`;

    return `<div class="view-block"><div class="view-label">${escapeHtml(label)}</div><table class="view-table">${thead}${tbody}</table></div>`;
}

// Split document body into alternating markdown and !view segments.
// Returns array of { type: 'md', text } | { type: 'view', query, raw }
function splitSegments(body) {
    const lines = body.split('\n');
    const segments = [];
    let mdLines = [];
    let inCodeFence = false;
    let fenceMarker = '';
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!inCodeFence) {
            const fenceMatch = trimmed.match(FENCE_OPEN_RE);
            if (fenceMatch) {
                inCodeFence = true;
                fenceMarker = fenceMatch[1];
                mdLines.push(line);
                i++;
                continue;
            }

            if (trimmed.startsWith('!view ')) {
                // Flush any preceding markdown
                if (mdLines.length) {
                    segments.push({ type: 'md', text: mdLines.join('\n') });
                    mdLines = [];
                }
                // Collect the !view block
                const blockLines = [line];
                let j = i + 1;
                while (j < lines.length) {
                    const next = lines[j].trim();
                    if (!next.length || next.startsWith('!view ')) break;
                    if (VIEW_CLAUSE_RE.test(next)) { blockLines.push(lines[j]); j++; } else { break; }
                }
                // Parse the collected block
                const parsed = parseAllViewQueries(blockLines.join('\n'));
                const query = parsed ? parsed[0] : null;
                segments.push({ type: 'view', query, raw: blockLines.join('\n') });
                i = j;
                continue;
            }

            mdLines.push(line);
        } else {
            mdLines.push(line);
            if (trimmed.startsWith(fenceMarker) && /^[`~]+$/.test(trimmed)) {
                inCodeFence = false;
                fenceMarker = '';
            }
        }

        i++;
    }

    if (mdLines.length) {
        segments.push({ type: 'md', text: mdLines.join('\n') });
    }

    return segments;
}

function renderNotePreview(documentText, contextNodeId) {
    const { body } = parseFrontmatterDocument(documentText);
    const segments = splitSegments(body);
    const md = getMd();
    const parts = [];

    for (const seg of segments) {
        if (seg.type === 'md') {
            let html = renderMarkdownWithFootnotes(md, seg.text);
            html = wikilinkToSpan(html);
            parts.push(html);
        } else {
            if (seg.query) {
                parts.push(buildViewTable(seg.query, contextNodeId || null));
            }
            // silently drop unparseable !view lines
        }
    }

    return parts.join('\n');
}

module.exports = { renderNotePreview, extractFootnoteDefinitions, renderMarkdownWithFootnotes };
