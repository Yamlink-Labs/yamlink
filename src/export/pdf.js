'use strict';

const fs = require('fs');
const path = require('path');
const { parseAllViewQueries, runQuery, buildQueryString } = require('../engine/query');
const { parseFrontmatterDocument } = require('../core/frontmatter');
const { resolveImageEmbed } = require('../core/imageEmbed');
const { CALLOUT_TYPE_FAMILY } = require('./markdownItCallouts');

const CALLOUT_LINE_RE = /^>\s*\[!([A-Z]+)\](?:\s+(.+))?$/i;

// A line whose entire (trimmed) content is a single image reference — either
// Yamlink's own ![[embed.png]] syntax or standard ![alt](path). Indentation is
// tolerated (\s* prefix) since this exporter doesn't have a CommonMark-style
// "4 spaces = code block" rule to fight, unlike the Live Note/Preview renderer.
const IMAGE_LINE_RE = /^\s*(?:!\[\[([^\]]+)\]\]|!\[([^\]]*)\]\(([^)]+)\))\s*$/;

// pdfkit's doc.image() only actually embeds JPEG and PNG — GIF/WEBP/BMP/SVG
// (all valid per IMAGE_EMBED_EXTENSIONS elsewhere in the codebase) either throw
// or silently fail there. Anything outside this set gets an honest text
// placeholder instead of a crash or a silently-dropped image.
const PDF_SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

/**
 * Resolves a single line to an embeddable local image, or null if the line
 * isn't a standalone image reference, or is one that doesn't resolve to a real
 * local file. Remote (http/https/data) images are deliberately left
 * unresolved — this is an offline, local export, not a network fetch.
 * @param {string} line
 * @param {string|null} noteDir
 * @returns {{src: string, alt: string}|null}
 */
function resolveImageLine(line, noteDir) {
    const match = String(line || '').match(IMAGE_LINE_RE);
    if (!match) return null;

    if (match[1]) {
        // ![[embed.png]]
        if (!noteDir) return null;
        const resolved = resolveImageEmbed(match[1], noteDir);
        if (!resolved) return null;
        return { src: resolved, alt: String(match[1]).split('|')[0].trim() };
    }

    // ![alt](path)
    const rawSrc = String(match[3] || '').trim();
    if (!rawSrc || /^(https?:|data:)/i.test(rawSrc)) return null;
    if (!noteDir && !path.isAbsolute(rawSrc)) return null;
    const candidate = path.isAbsolute(rawSrc) ? rawSrc : path.join(noteDir, rawSrc);
    try {
        if (!fs.statSync(candidate).isFile()) return null;
    } catch {
        return null;
    }
    return { src: candidate, alt: String(match[2] || '').trim() };
}

const CALLOUT_PDF_STYLES = {
    amber:  { bg: '#fdf6e3', stroke: '#e6a817', badge: '#7a5a10', body: '#3d2d08' },
    blue:   { bg: '#eaf4fb', stroke: '#4a9fc8', badge: '#1a5a80', body: '#0f3a55' },
    orange: { bg: '#fff4e0', stroke: '#e89020', badge: '#8a5c10', body: '#5a3a08' },
    red:    { bg: '#ffeaea', stroke: '#d95050', badge: '#8a2020', body: '#5a1010' },
};

let _PDFDocument = null;
function getPDFDocument() {
    if (!_PDFDocument) _PDFDocument = require('pdfkit');
    return _PDFDocument;
}

function buildViewExportModel(query, contextNodeId) {
    const result = runQuery(query, contextNodeId || null);
    if (!result.success) {
        throw new Error(result.error || 'Could not run view for export');
    }

    return {
        label: query.label || (query.type === '*' ? 'All nodes' : query.type),
        queryText: buildQueryString(query),
        columns: result.columns,
        rows: result.rows.map(row => {
            const values = {};
            for (const col of result.columns) {
                values[col] = col === 'id' ? row.id : String(row.fields[col] ?? '');
            }
            return values;
        }),
        warnings: result.warnings || []
    };
}

function buildNoteExportModel(documentText, contextNodeId, noteDir) {
    const parsed = parseFrontmatterDocument(documentText);
    const queries = parseAllViewQueries(documentText) || [];
    const views = queries.map(query => buildViewExportModel(query, contextNodeId || null));
    const summaryRows = Object.entries(parsed.data || {})
        .filter(([key]) => key !== 'id')
        .map(([key, value]) => ({ key, value: stringifyValue(value) }));

    return {
        title: parsed.data?.name || parsed.data?.title || contextNodeId || 'Yamlink Note',
        id: parsed.data?.id || contextNodeId || '',
        type: parsed.data?.type || '',
        summaryRows,
        body: String(parsed.body || '').trim(),
        noteDir: noteDir || null,
        views
    };
}

function exportViewPdf(filePath, model) {
    const { doc, stream } = createDocument(filePath, model.label || 'Yamlink View');
    writeHeader(doc, model.label || 'Yamlink View', model.queryText || '');
    if (Array.isArray(model.warnings) && model.warnings.length) {
        writeCallout(doc, 'Warnings', model.warnings.join('\n'));
    }
    writeTable(doc, model.columns || [], model.rows || []);
    finishDocument(doc);
    return stream;
}

function exportNotePdf(filePath, model) {
    const { doc, stream } = createDocument(filePath, model.title || 'Yamlink Note');
    writeHeader(doc, model.title || 'Yamlink Note', model.id ? `ID: ${model.id}${model.type ? ` · Type: ${model.type}` : ''}` : '');

    if (model.summaryRows && model.summaryRows.length) {
        writeSectionTitle(doc, 'Summary');
        for (const row of model.summaryRows) {
            writeKeyValue(doc, row.key, row.value);
        }
        doc.moveDown(0.8);
    }

    if (model.body) {
        writeSectionTitle(doc, 'Note');
        const bodyWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        for (const seg of parseBodySegments(model.body, model.noteDir)) {
            if (seg.type === 'callout') {
                writeCalloutBlock(doc, seg.calloutType, seg.title, seg.content);
            } else if (seg.type === 'image') {
                writeImageBlock(doc, seg.src, seg.alt, bodyWidth);
            } else {
                doc.font('Helvetica').fontSize(11).fillColor('#1b1f24')
                    .text(seg.content, { width: bodyWidth, lineGap: 3 });
                doc.moveDown(0.8);
            }
        }
        doc.moveDown(0.3);
    }

    for (const view of model.views || []) {
        ensureSpace(doc, 120);
        writeSectionTitle(doc, view.label || 'View');
        if (view.queryText) {
            doc.font('Helvetica-Oblique').fontSize(10).fillColor('#59636e').text(view.queryText);
            doc.moveDown(0.5);
        }
        if (view.warnings && view.warnings.length) {
            writeCallout(doc, 'Warnings', view.warnings.join('\n'));
        }
        writeTable(doc, view.columns || [], view.rows || []);
        doc.moveDown(0.8);
    }

    finishDocument(doc);
    return stream;
}

function createDocument(filePath, title) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const PDFDocument = getPDFDocument();
    const doc = new PDFDocument({
        size: 'A4',
        margin: 44,
        info: {
            Title: title,
            Author: 'Yamlink'
        }
    });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    return { doc, stream };
}

function finishDocument(doc) {
    doc.end();
}

function writeHeader(doc, title, subtitle) {
    doc.fillColor('#0f1720')
        .font('Helvetica-Bold')
        .fontSize(22)
        .text(title, { align: 'left' });
    if (subtitle) {
        doc.moveDown(0.35);
        doc.fillColor('#4f5d6b')
            .font('Helvetica')
            .fontSize(10)
            .text(subtitle);
    }
    doc.moveDown(1.1);
}

function writeSectionTitle(doc, title) {
    ensureSpace(doc, 48);
    doc.fillColor('#1e3f58')
        .font('Helvetica-Bold')
        .fontSize(13)
        .text(title);
    doc.moveDown(0.45);
}

function writeKeyValue(doc, key, value) {
    ensureSpace(doc, 18);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#64707a').text(String(key).toUpperCase(), { continued: true });
    doc.font('Helvetica').fillColor('#1b1f24').text(`  ${value}`);
}

/**
 * Split body text into alternating text / callout / image segments.
 * @param {string} text
 * @param {string|null} [noteDir] - resolves embed and relative image references
 * @returns {Array<{type:'text',content:string}|{type:'callout',calloutType:string,title:string,content:string}|{type:'image',src:string,alt:string}>}
 */
function parseBodySegments(text, noteDir) {
    const lines = text.split('\n');
    /** @type {Array<{type:'text',content:string}|{type:'callout',calloutType:string,title:string,content:string}|{type:'image',src:string,alt:string}>} */
    const segments = [];
    let i = 0;

    while (i < lines.length) {
        const calloutMatch = lines[i].match(CALLOUT_LINE_RE);
        if (calloutMatch) {
            const calloutType = calloutMatch[1].toUpperCase();
            const title = calloutMatch[2] || calloutType;
            i++;
            const bodyLines = [];
            while (i < lines.length && /^>/.test(lines[i])) {
                bodyLines.push(lines[i].replace(/^>\s?/, ''));
                i++;
            }
            segments.push(/** @type {{type:'callout',calloutType:string,title:string,content:string}} */ ({
                type: 'callout',
                calloutType,
                title,
                content: bodyLines.join('\n').trim()
            }));
            continue;
        }

        const image = resolveImageLine(lines[i], noteDir);
        if (image) {
            segments.push(/** @type {{type:'image',src:string,alt:string}} */ ({ type: 'image', src: image.src, alt: image.alt }));
            i++;
            continue;
        }

        {
            const textLines = [];
            while (i < lines.length && !CALLOUT_LINE_RE.test(lines[i]) && !resolveImageLine(lines[i], noteDir)) {
                textLines.push(lines[i]);
                i++;
            }
            const content = textLines.join('\n').trim();
            if (content) {
                segments.push(/** @type {{type:'text',content:string}} */ ({
                    type: 'text',
                    content
                }));
            }
        }
    }

    return segments;
}

// Cap embedded image height so a tall image doesn't dominate several pages —
// pdfkit's `fit` scales down proportionally to stay within both bounds.
const PDF_IMAGE_MAX_HEIGHT = 320;

function writeImageBlock(doc, src, alt, maxWidth) {
    const ext = path.extname(src).toLowerCase();
    if (!PDF_SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
        writeImagePlaceholder(doc, alt || path.basename(src), `unsupported image format for PDF export (${ext || 'unknown'} — only PNG/JPEG embed)`);
        return;
    }

    ensureSpace(doc, Math.min(PDF_IMAGE_MAX_HEIGHT, 200) + 16);
    try {
        doc.image(src, { fit: [maxWidth, PDF_IMAGE_MAX_HEIGHT], align: 'left' });
        doc.moveDown(0.8);
    } catch (err) {
        writeImagePlaceholder(doc, alt || path.basename(src), `could not embed image: ${err.message}`);
    }
}

function writeImagePlaceholder(doc, label, reason) {
    ensureSpace(doc, 40);
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#8a6710')
        .text(`[Image: ${label} — ${reason}]`);
    doc.moveDown(0.8);
}

function writeCalloutBlock(doc, calloutType, title, content) {
    const family = CALLOUT_TYPE_FAMILY[calloutType] || 'blue';
    const s = CALLOUT_PDF_STYLES[family];
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const innerWidth = pageWidth - 24;
    const label = title && title.toUpperCase() !== calloutType
        ? `${calloutType} — ${title}`
        : calloutType;

    const labelHeight = doc.heightOfString(label, { width: innerWidth, fontSize: 9 });
    const bodyHeight = content
        ? doc.heightOfString(content, { width: innerWidth, fontSize: 10 }) + 6
        : 0;
    const boxHeight = 10 + labelHeight + bodyHeight + 10;

    ensureSpace(doc, boxHeight + 8);

    const x = doc.x;
    const y = doc.y;

    // Background fill
    doc.rect(x, y, pageWidth, boxHeight).fill(s.bg);
    // Left accent bar
    doc.rect(x, y, 3, boxHeight).fill(s.stroke);

    // Label
    doc.font('Helvetica-Bold').fontSize(9).fillColor(s.badge)
        .text(label, x + 12, y + 10, { width: innerWidth });

    // Body
    if (content) {
        const labelActualHeight = doc.heightOfString(label, { width: innerWidth, fontSize: 9 });
        doc.font('Helvetica').fontSize(10).fillColor(s.body)
            .text(content, x + 12, y + 10 + labelActualHeight + 4, { width: innerWidth, lineGap: 2 });
    }

    doc.y = y + boxHeight + 6;
}

function writeCallout(doc, title, text) {
    ensureSpace(doc, 50);
    const x = doc.x;
    const y = doc.y;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const height = 38;
    doc.roundedRect(x, y, width, height, 10).fillAndStroke('#f7f4ea', '#ead9a1');
    doc.fillColor('#8a6710').font('Helvetica-Bold').fontSize(10).text(title, x + 10, y + 8);
    doc.fillColor('#5e4b16').font('Helvetica').fontSize(9).text(text, x + 10, y + 19, { width: width - 20 });
    doc.moveDown(2.9);
}

function writeTable(doc, columns, rows) {
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colCount = Math.max(columns.length, 1);
    const colWidth = usableWidth / colCount;
    const startX = doc.page.margins.left;

    ensureSpace(doc, 30);
    let y = doc.y;
    drawTableRow(doc, startX, y, columns, colWidth, {
        fill: '#1d2a35',
        text: '#f5f7fb',
        bold: true
    });
    y += 24;

    if (!rows.length) {
        drawTableRow(doc, startX, y, Array(colCount).fill('No rows found'), colWidth, {
            fill: '#f7f9fb',
            text: '#60707d'
        });
        doc.y = y + 24;
        return;
    }

    rows.forEach((row, index) => {
        ensureSpace(doc, 28);
        y = doc.y;
        const values = columns.map(col => stringifyValue(row[col]));
        drawTableRow(doc, startX, y, values, colWidth, {
            fill: index % 2 === 0 ? '#ffffff' : '#f5f7fb',
            text: '#1c252e'
        });
        doc.y = y + 24;
    });
}

function drawTableRow(doc, x, y, cells, colWidth, style) {
    const height = 24;
    cells.forEach((cell, index) => {
        const cellX = x + index * colWidth;
        doc.rect(cellX, y, colWidth, height).fillAndStroke(style.fill, '#d9e0e7');
        doc.fillColor(style.text)
            .font(style.bold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(9)
            .text(cell, cellX + 6, y + 7, {
                width: colWidth - 12,
                height: height - 10,
                ellipsis: true
            });
    });
}

function ensureSpace(doc, needed) {
    if (doc.y + needed < doc.page.height - doc.page.margins.bottom) return;
    doc.addPage();
}

function stringifyValue(value) {
    if (Array.isArray(value)) return value.map(stringifyValue).join(', ');
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

module.exports = {
    buildViewExportModel,
    buildNoteExportModel,
    exportViewPdf,
    exportNotePdf,
    parseBodySegments,
    resolveImageLine
};
