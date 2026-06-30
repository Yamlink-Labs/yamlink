'use strict';

const path = require('path');
const { parseFrontmatterDocument } = require('../../core/frontmatter');
const { renderNotePreview } = require('./previewRenderer');

const HEADING_RE = /^#{1,6}\s+(.+)$/;

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function countMatches(text, re) {
    const matches = String(text || '').match(re);
    return matches ? matches.length : 0;
}

function formatFieldValue(value) {
    if (value === null || value === undefined || value === '') return 'empty';
    if (Array.isArray(value)) {
        if (!value.length) return '[]';
        return value.map((item) => String(item)).join(', ');
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}

function buildFrontmatterEntries(data) {
    return Object.entries(data || {}).map(([key, value]) => ({
        key,
        value: formatFieldValue(value)
    }));
}

function normalizeHeadingLabel(text) {
    return String(text || '').trim().toLowerCase();
}

function findLiveSourceTargets(documentText) {
    const lines = String(documentText || '').split(/\r?\n/);
    const fieldLines = new Map();
    const headings = [];
    const viewLines = [];

    let inFrontmatter = false;
    let frontmatterDone = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = String(line || '').trim();

        if (!frontmatterDone && i === 0 && trimmed === '---') {
            inFrontmatter = true;
            continue;
        }
        if (inFrontmatter) {
            if (trimmed === '---') {
                inFrontmatter = false;
                frontmatterDone = true;
                continue;
            }
            const fieldMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s|$)/);
            if (fieldMatch) fieldLines.set(fieldMatch[1], i);
            continue;
        }

        if (/^\s*!view\b/.test(line)) {
            viewLines.push(i);
        }

        const headingMatch = line.match(HEADING_RE);
        if (headingMatch) {
            headings.push({
                text: String(headingMatch[1] || '').trim(),
                norm: normalizeHeadingLabel(headingMatch[1] || ''),
                line: i
            });
        }
    }

    return { fieldLines, headings, viewLines };
}

function decorateRenderedHtml(renderedHtml, targets) {
    let headingIndex = 0;
    let viewIndex = 0;
    let html = String(renderedHtml || '');

    html = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (full, level, inner) => {
        const heading = targets.headings[headingIndex++];
        if (!heading) return full;
        return `<h${level} class="yl-live-heading" data-source-line="${heading.line}"><button class="yl-live-heading-jump" data-source-line="${heading.line}" type="button">${inner}</button></h${level}>`;
    });

    html = html.replace(/<div class="view-block">/g, () => {
        const line = targets.viewLines[viewIndex++];
        if (typeof line !== 'number') return '<div class="view-block">';
        return `<div class="view-block yl-live-view-block" data-source-line="${line}">`;
    });

    return html;
}

function buildMetricChips(doc, body) {
    const fields = Object.keys(doc.data || {}).length;
    const links = countMatches(body, /\[\[[^\]]+\]\]/g);
    const tasks = countMatches(body, /^\s*-\s+\[[ xX]\]/gm);
    const views = countMatches(body, /^\s*!view\b/gm);
    const headings = countMatches(body, /^#{1,6}\s+/gm);
    return [
        { label: 'fields', value: String(fields) },
        { label: 'links', value: String(links) },
        { label: 'tasks', value: String(tasks) },
        { label: 'views', value: String(views) },
        { label: 'sections', value: String(headings) }
    ];
}

function buildLiveNoteBodyHtml(model) {
    const identity = [];
    if (model.noteId) identity.push(`<span class="yl-live-pill"><strong>ID</strong>${escapeHtml(model.noteId)}</span>`);
    if (model.noteType) identity.push(`<span class="yl-live-pill"><strong>TYPE</strong>${escapeHtml(model.noteType)}</span>`);
    const metrics = model.metrics.map((metric) =>
        `<span class="yl-live-pill yl-live-pill--metric"><strong>${escapeHtml(metric.label)}</strong>${escapeHtml(metric.value)}</span>`
    ).join('');
    const fm = model.frontmatter.length
        ? `<div class="yl-live-frontmatter-strip">
              ${model.frontmatter.map((entry) => `
                <button class="yl-live-field-pill" type="button"${typeof entry.line === 'number' ? ` data-source-line="${entry.line}"` : ''}>
                  <span class="yl-live-field-key">${escapeHtml(entry.key)}</span>
                  <span class="yl-live-field-value">${escapeHtml(entry.value)}</span>
                </button>
              `).join('')}
            </div>`
        : '';
    return `
      <section class="yl-live-meta">
        <div class="yl-live-meta-top">
          <div class="yl-live-eyebrow">Live note</div>
          <h1 class="yl-live-title">${escapeHtml(model.title)}</h1>
        </div>
        <div class="yl-live-pill-row">${identity.join('')}${metrics}</div>
        ${fm}
        <div class="yl-live-source-hint">Frontmatter chips, headings, and Yamlink view blocks jump back to source.</div>
      </section>
      <section class="yl-live-note-shell">
        <div class="yl-live-note-kicker">Rendered note</div>
        <article class="yl-live-article">${model.renderedHtml}</article>
      </section>
    `;
}

function buildLiveNoteModel(documentText, fsPath, contextNodeId) {
    const doc = parseFrontmatterDocument(documentText);
    const body = String(doc.body || '');
    const title = path.basename(fsPath || 'Live Note', '.md') || 'Live Note';
    const noteId = String(doc.data?.id || '').trim();
    const noteType = String(doc.data?.type || '').trim();
    const targets = findLiveSourceTargets(documentText);
    const frontmatter = buildFrontmatterEntries(doc.data || {}).map((entry) => ({
        ...entry,
        line: targets.fieldLines.has(entry.key) ? targets.fieldLines.get(entry.key) : null
    }));
    return {
        title,
        noteId,
        noteType,
        frontmatter,
        metrics: buildMetricChips(doc, body),
        renderedHtml: decorateRenderedHtml(renderNotePreview(documentText, contextNodeId || null), targets)
    };
}

module.exports = {
    buildFrontmatterEntries,
    buildLiveNoteBodyHtml,
    buildLiveNoteModel,
    buildMetricChips,
    decorateRenderedHtml,
    findLiveSourceTargets,
    formatFieldValue
};
