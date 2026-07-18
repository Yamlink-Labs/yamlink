'use strict';

const fs = require('fs');
const path = require('path');
const { serializeFrontmatterDocument } = require('../core/frontmatter');
const { canonicalizeId } = require('../core/id');
const { buildImportReportMarkdown } = require('./obsidian');

const EXTERNAL_SKIP_DIRS = new Set(['.git', '.obsidian', '.trash', '.vscode', '.cursor', '.zed', '__macosx', 'node_modules']);
const EXTERNAL_SKIP_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

function sanitizeFileStem(value, fallback = 'note') {
    const cleaned = String(value || '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || fallback;
}

function ensureUniqueMarkdownPath(rootPath, preferredStem, usedPaths) {
    const baseStem = sanitizeFileStem(preferredStem, 'note');
    let counter = 1;
    let candidate = `${baseStem}.md`;
    while (usedPaths.has(candidate.toLowerCase()) || fs.existsSync(path.join(rootPath, candidate))) {
        counter++;
        candidate = `${baseStem}-${counter}.md`;
    }
    usedPaths.add(candidate.toLowerCase());
    return path.join(rootPath, candidate);
}

function decodeHtmlEntities(text) {
    return String(text || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

function stripHtmlToMarkdownish(text) {
    return decodeHtmlEntities(String(text || '')
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\s*\/p\s*>/gi, '\n\n')
        .replace(/<\s*\/div\s*>/gi, '\n')
        .replace(/<\s*li[^>]*>/gi, '- ')
        .replace(/<\s*\/li\s*>/gi, '\n')
        .replace(/<\s*h[1-6][^>]*>/gi, '\n\n## ')
        .replace(/<\s*\/h[1-6]\s*>/gi, '\n\n')
        .replace(/<\s*en-note[^>]*>/gi, '')
        .replace(/<\s*\/en-note\s*>/gi, '')
        .replace(/<[^>]+>/g, ''))
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function buildFrontmatterMarkdown(data, body) {
    return serializeFrontmatterDocument({
        hasFrontmatter: true,
        data,
        body: String(body || '').trim(),
        originalOrder: Object.keys(data)
    });
}

function shouldSkipExternalEntry(entryName, isDirectory) {
    const normalized = String(entryName || '').trim().toLowerCase();
    if (!normalized) return true;
    if (isDirectory) return EXTERNAL_SKIP_DIRS.has(normalized);
    return EXTERNAL_SKIP_FILES.has(normalized);
}

function walkExternalFiles(rootPath, onFile, relativeBase = '') {
    for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
        if (shouldSkipExternalEntry(entry.name, entry.isDirectory())) continue;
        const fullPath = path.join(rootPath, entry.name);
        const relativePath = relativeBase ? path.join(relativeBase, entry.name) : entry.name;
        if (entry.isDirectory()) {
            walkExternalFiles(fullPath, onFile, relativePath);
            continue;
        }
        onFile(fullPath, relativePath);
    }
}

function extractFirstMarkdownHeading(text) {
    const match = String(text || '').match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : '';
}

function stripMarkdownFormatting(text) {
    return String(text || '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[*_`]/g, '')
        .trim();
}

function parseCsvTable(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    const source = String(text || '');

    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        const next = source[i + 1];

        if (ch === '"') {
            if (inQuotes && next === '"') {
                cell += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (ch === ',' && !inQuotes) {
            row.push(cell);
            cell = '';
            continue;
        }

        if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (ch === '\r' && next === '\n') i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            continue;
        }

        cell += ch;
    }

    if (cell.length || row.length) {
        row.push(cell);
        rows.push(row);
    }

    return rows
        .filter((entry) => entry.some((value) => String(value || '').trim() !== ''))
        .map((entry) => entry.map((value) => String(value || '').trim()));
}

function formatExternalInspectionSummary(inspection) {
    if (!inspection) return '';
    if (inspection.platform === 'Roam Research') {
        const bits = [`${inspection.pages} page${inspection.pages === 1 ? '' : 's'}`];
        if (inspection.dailyNotes) bits.push(`${inspection.dailyNotes} daily note${inspection.dailyNotes === 1 ? '' : 's'}`);
        if (inspection.untitledPages) bits.push(`${inspection.untitledPages} untitled page${inspection.untitledPages === 1 ? '' : 's'} skipped`);
        return bits.join(' · ');
    }
    if (inspection.platform === 'Evernote') {
        const bits = [`${inspection.notes} note${inspection.notes === 1 ? '' : 's'}`];
        if (inspection.resources) bits.push(`${inspection.resources} attachment${inspection.resources === 1 ? '' : 's'}`);
        return bits.join(' · ');
    }
    if (inspection.platform === 'Notion') {
        const bits = [];
        if (inspection.markdownFiles) bits.push(`${inspection.markdownFiles} markdown`);
        if (inspection.csvFiles) bits.push(`${inspection.csvFiles} csv`);
        if (inspection.otherFiles) bits.push(`${inspection.otherFiles} asset${inspection.otherFiles === 1 ? '' : 's'}/other`);
        return bits.join(' · ');
    }
    return '';
}

function buildExternalImportReportMarkdown(rootPath, stats, analysis, platformName) {
    const base = buildImportReportMarkdown(rootPath, stats, analysis, {
        mode: 'copy',
        isObsidian: false,
        platformName
    }).trimEnd();
    const lines = [base];

    if (platformName === 'Roam') {
        lines.push(
            '',
            '## Roam normalization',
            '',
            `- Pages imported: **${stats.pagesImported || 0}**`,
            `- Daily notes inferred: **${stats.dailyNotesImported || 0}**`,
            `- Page references normalized: **${stats.pageReferencesNormalized || 0}**`,
            '',
            '- Roam `[[Page]]` references were normalized toward canonical Yamlink ids where possible.',
            '- Date-titled pages were converted into `type: journal` notes with a `date:` field.',
            ''
        );
    }

    if (platformName === 'Evernote') {
        lines.push(
            '',
            '## Evernote normalization',
            '',
            `- Notes imported: **${stats.notesImported || 0}**`,
            `- Attachments extracted: **${stats.attachmentsExtracted || 0}**`,
            `- Internal note links rewritten: **${stats.internalLinksRewritten || 0}**`,
            `- External links preserved: **${stats.externalLinksPreserved || 0}**`,
            '',
            '- Evernote note links were converted into Yamlink wikilinks when the importer could resolve the target.',
            '- Attachments were extracted into `_attachments/<note-id>/` and referenced from frontmatter.',
            ''
        );
    }

    if (platformName === 'Notion') {
        lines.push(
            '',
            '## Notion normalization',
            '',
            `- Markdown notes processed: **${stats.markdownNotesProcessed || 0}**`,
            `- Frontmatter stamped: **${stats.frontmatterStamped || 0}**`,
            `- Markdown links rewritten: **${stats.rewrittenLinks || 0}**`,
            `- CSV databases processed: **${stats.csvDatabasesProcessed || 0}**`,
            `- Database row notes generated: **${stats.databaseRowsImported || 0}**`,
            '',
            '- Local Notion markdown links were rewritten into canonical Yamlink wikilinks where possible.',
            '- CSV databases were preserved and also expanded into Yamlink row notes under `_notion_databases/`.',
            '- Database row note `type:` values were normalized toward singular collection names for cleaner Yamlink structure.',
            ''
        );
    }

    return `${lines.join('\n')}\n`;
}

module.exports = {
    sanitizeFileStem,
    ensureUniqueMarkdownPath,
    decodeHtmlEntities,
    stripHtmlToMarkdownish,
    buildFrontmatterMarkdown,
    shouldSkipExternalEntry,
    walkExternalFiles,
    extractFirstMarkdownHeading,
    stripMarkdownFormatting,
    parseCsvTable,
    formatExternalInspectionSummary,
    buildExternalImportReportMarkdown,
    canonicalizeId
};
