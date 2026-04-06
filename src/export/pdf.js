'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { parseAllViewQueries, runQuery, buildQueryString } = require('../engine/query');
const { parseFrontmatterDocument } = require('../core/frontmatter');

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

function buildNoteExportModel(documentText, contextNodeId) {
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
        views
    };
}

function exportViewPdf(filePath, model) {
    const doc = createDocument(filePath, model.label || 'Yamlink View');
    writeHeader(doc, model.label || 'Yamlink View', model.queryText || '');
    if (Array.isArray(model.warnings) && model.warnings.length) {
        writeCallout(doc, 'Warnings', model.warnings.join('\n'));
    }
    writeTable(doc, model.columns || [], model.rows || []);
    finishDocument(doc);
}

function exportNotePdf(filePath, model) {
    const doc = createDocument(filePath, model.title || 'Yamlink Note');
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
        doc.font('Helvetica').fontSize(11).fillColor('#1b1f24').text(model.body, {
            width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
            lineGap: 3
        });
        doc.moveDown(1.1);
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
}

function createDocument(filePath, title) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const doc = new PDFDocument({
        size: 'A4',
        margin: 44,
        info: {
            Title: title,
            Author: 'Yamlink'
        }
    });
    doc.pipe(fs.createWriteStream(filePath));
    return doc;
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
    exportNotePdf
};
