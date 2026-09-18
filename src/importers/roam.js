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

function rewriteRoamReferences(text, pageTargetMap, blockTargetMap = null) {
    return String(text || '')
        .replace(/\[\[([^\]]+)\]\]/g, (full, rawTarget) => {
            const title = String(rawTarget || '').trim();
            if (!title) return full;
            const match = pageTargetMap?.get(title.toLowerCase());
            if (match?.id) return buildCanonicalWikilink(match.id, { alias: title !== match.id ? title : '' });
            const fallbackId = canonicalizeId(title);
            if (!fallbackId) return full;
            return buildCanonicalWikilink(fallbackId, { alias: title !== fallbackId ? title : '' });
        })
        .replace(/\{\{\s*(?:embed|embed-path)\s*:\s*\(\(([^)]+)\)\)\s*\}\}/gi, (_full, uid) => {
            const target = blockTargetMap?.get(String(uid || '').trim());
            return target ? buildCanonicalWikilink(target.noteId, { block: target.blockId }) : `((${String(uid || '').trim()}))`;
        })
        .replace(/\(\(([^)]+)\)\)/g, (full, rawUid) => {
            const uid = String(rawUid || '').trim();
            const target = blockTargetMap?.get(uid);
            if (!target) return full;
            return buildCanonicalWikilink(target.noteId, { block: target.blockId });
        });
}

function rewriteRoamPageReferences(text, pageTargetMap) {
    return rewriteRoamReferences(text, pageTargetMap, null);
}

function renderRoamBlocks(blocks, depth = 0, pageTargetMap = null, blockTargetMap = null) {
    if (!Array.isArray(blocks) || !blocks.length) return '';
    const lines = [];
    for (const block of blocks) {
        const uid = String(block?.uid || '').trim();
        const suffix = uid ? ` ^${uid}` : '';
        const text = rewriteRoamReferences(normalizeRoamText(block?.string || block?.title || ''), pageTargetMap, blockTargetMap);
        if (text) lines.push(`${'  '.repeat(depth)}- ${text}${suffix}`);
        const nested = renderRoamBlocks(block?.children || [], depth + 1, pageTargetMap, blockTargetMap);
        if (nested) lines.push(nested);
    }
    return lines.join('\n');
}

function collectRoamBlockTargets(blocks, noteId, blockTargetMap) {
    for (const block of Array.isArray(blocks) ? blocks : []) {
        const uid = String(block?.uid || '').trim();
        if (uid && !blockTargetMap.has(uid)) {
            blockTargetMap.set(uid, {
                noteId,
                blockId: uid
            });
        }
        collectRoamBlockTargets(block?.children || [], noteId, blockTargetMap);
    }
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
    const blockTargetMap = new Map();
    for (const page of parsed) {
        const title = String(page?.title || '').trim();
        if (!title) continue;
        const id = canonicalizeId(title);
        pageTargetMap.set(title.toLowerCase(), {
            id,
            title
        });
        collectRoamBlockTargets(page.children || [], id, blockTargetMap);
    }

    for (const page of parsed) {
        const title = String(page?.title || '').trim();
        if (!title) {
            stats.skipped.push('(untitled page)');
            continue;
        }
        const id = canonicalizeId(title);
        const body = renderRoamBlocks(page.children || [], 0, pageTargetMap, blockTargetMap);
        stats.pageReferencesNormalized += (body.match(/\[\[[^\]]+\]\]/g) || []).length;
        stats.blockReferencesNormalized = (stats.blockReferencesNormalized || 0) + (body.match(/\[\[[^\]]+\^[^\]]+\]\]/g) || []).length;
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
    rewriteRoamReferences,
    rewriteRoamPageReferences,
    renderRoamBlocks,
    collectRoamBlockTargets,
    importRoamJsonToVault,
    inspectRoamExport
};
