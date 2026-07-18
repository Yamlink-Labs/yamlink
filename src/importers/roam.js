'use strict';

const fs = require('fs');
const { canonicalizeId } = require('../core/id');
const { createImportStats, buildCanonicalWikilink } = require('./obsidian');
const { buildFrontmatterMarkdown, ensureUniqueMarkdownPath } = require('./shared');

function normalizeDateTitle(title) {
    const raw = String(title || '').trim();
    if (!raw) return '';
    const normalized = raw
        .replace(/(\d+)(st|nd|rd|th)\b/gi, '$1')
        .replace(/\s+/g, ' ');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
}

function normalizeRoamText(text) {
    return String(text || '')
        .replace(/\{\{\[\[TODO\]\]\}\}\s*/gi, '[ ] ')
        .replace(/\{\{\[\[DONE\]\]\}\}\s*/gi, '[x] ')
        .replace(/\{\{TODO\}\}\s*/gi, '[ ] ')
        .replace(/\{\{DONE\}\}\s*/gi, '[x] ')
        .replace(/\{\{calc:.*?\}\}/gi, '')
        .trim();
}

function rewriteRoamPageReferences(text, pageTargetMap) {
    return String(text || '').replace(/\[\[([^\]]+)\]\]/g, (full, rawTarget) => {
        const title = String(rawTarget || '').trim();
        if (!title) return full;
        const match = pageTargetMap?.get(title.toLowerCase());
        if (match?.id) return buildCanonicalWikilink(match.id, { alias: title !== match.id ? title : '' });
        const fallbackId = canonicalizeId(title);
        if (!fallbackId) return full;
        return buildCanonicalWikilink(fallbackId, { alias: title !== fallbackId ? title : '' });
    });
}

function renderRoamBlocks(blocks, depth = 0, pageTargetMap = null) {
    if (!Array.isArray(blocks) || !blocks.length) return '';
    const lines = [];
    for (const block of blocks) {
        const text = rewriteRoamPageReferences(normalizeRoamText(block?.string || block?.title || ''), pageTargetMap);
        if (text) lines.push(`${'  '.repeat(depth)}- ${text}`);
        const nested = renderRoamBlocks(block?.children || [], depth + 1, pageTargetMap);
        if (nested) lines.push(nested);
    }
    return lines.join('\n');
}

function importRoamJsonToVault(sourcePath, destinationRoot) {
    const raw = fs.readFileSync(sourcePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error('Roam export must be a JSON array of pages.');
    }

    fs.mkdirSync(destinationRoot, { recursive: true });
    const used = new Set();
    const stats = createImportStats();
    stats.skipped = [];
    stats.conflicts = [];
    stats.platform = 'Roam';
    stats.pagesImported = 0;
    stats.dailyNotesImported = 0;
    stats.pageReferencesNormalized = 0;

    const pageTargetMap = new Map();
    for (const page of parsed) {
        const title = String(page?.title || '').trim();
        if (!title) continue;
        pageTargetMap.set(title.toLowerCase(), {
            id: canonicalizeId(title),
            title
        });
    }

    for (const page of parsed) {
        const title = String(page?.title || '').trim();
        if (!title) {
            stats.skipped.push('(untitled page)');
            continue;
        }
        const id = canonicalizeId(title);
        const body = renderRoamBlocks(page.children || [], 0, pageTargetMap);
        stats.pageReferencesNormalized += (body.match(/\[\[[^\]]+\]\]/g) || []).length;
        const dailyDate = normalizeDateTitle(title);
        const data = {
            id,
            title,
            imported_from: 'roam',
            roam_uid: String(page?.uid || '').trim(),
            created: page['create-time'] ? new Date(page['create-time']).toISOString().slice(0, 10) : '',
            updated: page['edit-time'] ? new Date(page['edit-time']).toISOString().slice(0, 10) : ''
        };
        if (dailyDate) {
            data.type = 'journal';
            data.date = dailyDate;
            stats.dailyNotesImported++;
        }
        const content = buildFrontmatterMarkdown(data, body);
        const filePath = ensureUniqueMarkdownPath(destinationRoot, id || title, used);
        fs.writeFileSync(filePath, content, 'utf8');
        stats.copied++;
        stats.markdownCopied++;
        stats.pagesImported++;
    }

    return stats;
}

function inspectRoamExport(sourcePath) {
    const raw = fs.readFileSync(sourcePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error('Roam export must be a JSON array of pages.');
    }

    let untitledPages = 0;
    let dailyNotes = 0;
    for (const page of parsed) {
        const title = String(page?.title || '').trim();
        if (!title) {
            untitledPages++;
            continue;
        }
        if (normalizeDateTitle(title)) dailyNotes++;
    }

    return {
        platform: 'Roam Research',
        pages: parsed.length,
        untitledPages,
        dailyNotes
    };
}

module.exports = {
    normalizeDateTitle,
    normalizeRoamText,
    rewriteRoamPageReferences,
    renderRoamBlocks,
    importRoamJsonToVault,
    inspectRoamExport
};
