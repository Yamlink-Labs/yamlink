'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const { parseFrontmatterDocument } = require('../../core/frontmatter');
const { getFieldsCache } = require('../../core/index');
const { parseAllViewQueries, runQuery } = require('../../engine/query');
const { resolveImageEmbed } = require('../../core/imageEmbed');

let _md = null;
function getMd() {
    if (!_md) {
        const MarkdownIt = require('markdown-it');
        const { calloutPlugin } = require('../../export/markdownItCallouts');
        _md = new MarkdownIt({ html: true, linkify: false });
        calloutPlugin(_md);
        // markdown-it's default validateLink blocks file:/javascript:/vbscript: uniformly
        // as a defense against untrusted-content link injection. file: URIs reaching this
        // renderer are always our own construction (see preprocessImagesForRender —
        // pathToFileURL() of a path resolveImageEmbed/fs.statSync already verified is a
        // real local file), never raw user input, so only the genuinely dangerous schemes
        // need blocking here.
        _md.validateLink = (url) => !/^(javascript|vbscript):/i.test(String(url || '').trim().toLowerCase());
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

// Two independent problems, handled together in one fence/list-aware line scan
// so they share the same fence/list-context tracking:
//
// 1. Yamlink's own ![[embed.png]] syntax isn't real markdown image syntax, so
//    markdown-it's inline image rule never recognizes it — it falls through as
//    literal text. Rewriting it to standard ![alt](path) *before* md.render()
//    means markdown-it turns it into a real <img> tag, and there's no leftover
//    [[...]] text left for wikilinkToSpan to wrongly grab afterward.
// 2. CommonMark treats a line indented 4+ spaces (outside an active list's own
//    content column) as an indented code block, not a paragraph. A line whose
//    entire content is just an image reference — accidentally over-indented,
//    with no list marker actually governing that indentation — silently turns
//    into a literal-text code block instead of an image. Dedenting only that
//    specific case (whole-line image reference, indentation not owned by an
//    active list) is a safe, conservative fix: it never touches lines that are
//    legitimately part of a list item's own content column.
const EMBED_RE = /!\[\[([^\]]+)\]\]/g;
const STANDARD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const IMAGE_ONLY_RE = /^(!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]*\))$/;
const FENCE_LINE_RE = /^\s*(`{3,}|~{3,})/;
const LIST_MARKER_RE = /^(\s*)([-*+]|\d+[.)])\s+/;

function preprocessImagesForRender(text, noteDir) {
    const lines = String(text || '').split('\n');
    const out = [];
    let inFence = false;
    let fenceMarker = '';
    let listMarkerColumn = null;
    let listContentColumn = null;

    for (const rawLine of lines) {
        const fenceMatch = rawLine.match(FENCE_LINE_RE);
        if (fenceMatch) {
            if (!inFence) { inFence = true; fenceMarker = fenceMatch[1][0]; }
            else if (rawLine.trim().startsWith(fenceMarker)) inFence = false;
            out.push(rawLine);
            continue;
        }
        if (inFence) { out.push(rawLine); continue; }

        let line = rawLine;
        if (noteDir) {
            line = line.replace(EMBED_RE, (full, rawTarget) => {
                const resolved = resolveImageEmbed(rawTarget, noteDir);
                if (!resolved) return full; // leave unresolvable embeds alone — same honest-failure behavior as before
                const alt = String(rawTarget).split('|')[0].trim().replace(/[[\]()]/g, '');
                return `![${alt}](${pathToFileURL(resolved).href})`;
            });
            // Standard ![alt](relative/path.png) syntax markdown-it already renders
            // as a real <img> tag natively — but the src stays whatever relative
            // path was written, which never resolves in a webview or browser.
            // Resolve it against noteDir the same way, leaving absolute/remote
            // sources (http(s):, data:, file:, already-rooted paths) untouched.
            line = line.replace(STANDARD_IMAGE_RE, (full, alt, rawSrc) => {
                const src = String(rawSrc || '').trim();
                if (!src || /^(https?:|data:|file:)/i.test(src) || path.isAbsolute(src)) return full;
                const candidate = path.join(noteDir, src);
                let isFile = false;
                try { isFile = fs.statSync(candidate).isFile(); } catch (_) { isFile = false; }
                if (!isFile) return full; // leave unresolvable references alone — same honest-failure behavior
                return `![${alt}](${pathToFileURL(candidate).href})`;
            });
        }

        if (!line.trim()) { out.push(line); continue; }

        const listMatch = line.match(LIST_MARKER_RE);
        if (listMatch) {
            listMarkerColumn = listMatch[1].length;
            listContentColumn = listMatch[0].length;
            out.push(line);
            continue;
        }

        const indent = line.match(/^\s*/)[0].length;
        if (listContentColumn !== null && indent < listMarkerColumn) {
            listContentColumn = null;
            listMarkerColumn = null;
        }

        const trimmed = line.trim();
        if (indent >= 4 && IMAGE_ONLY_RE.test(trimmed)) {
            const withinList = listContentColumn !== null && indent >= listContentColumn;
            if (!withinList) {
                out.push(trimmed); // fully dedent — safe fallback: render as a normal paragraph image
                continue;
            }
        }

        out.push(line);
    }

    return out.join('\n');
}

// Rewrites <img src="..."> attributes emitted by md.render() into whatever URI
// scheme the destination actually needs: a webview needs asWebviewUri(), a
// browser-print temp file needs a plain file:// URI. Remote/data URLs are left
// untouched. Local images are embedded as file:// URIs (via pathToFileURL) by
// preprocessImagesForRender above — not raw filesystem paths — because
// markdown-it's own link-destination parsing mangles Windows backslashes into
// %5C when it sees a raw path, silently producing an unloadable src. Converted
// back to a plain fs path here before handing off to resolveSrc, so each
// caller's resolver function keeps a simple "always receives a real fs path" contract.
const IMG_SRC_RE = /(<img\s[^>]*\bsrc=")([^"]+)(")/gi;

function rewriteImageSrcs(html, resolveSrc) {
    if (typeof resolveSrc !== 'function') return html;
    return String(html || '').replace(IMG_SRC_RE, (full, pre, src, post) => {
        if (/^(https?:|data:|vscode-)/i.test(src)) return full;
        try {
            const fsPath = src.startsWith('file:') ? fileURLToPath(src) : src;
            return `${pre}${resolveSrc(fsPath)}${post}`;
        } catch (_) {
            return full;
        }
    });
}

function renderMarkdownWithFootnotes(md, text, noteDir) {
    text = preprocessImagesForRender(text, noteDir);
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

function renderNotePreview(documentText, contextNodeId, noteDir) {
    const { body } = parseFrontmatterDocument(documentText);
    const segments = splitSegments(body);
    const md = getMd();
    const parts = [];

    for (const seg of segments) {
        if (seg.type === 'md') {
            let html = renderMarkdownWithFootnotes(md, seg.text, noteDir);
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

module.exports = {
    renderNotePreview,
    extractFootnoteDefinitions,
    renderMarkdownWithFootnotes,
    preprocessImagesForRender,
    rewriteImageSrcs
};
