'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatterDocument } = require('../core/frontmatter');
const { canonicalizeId } = require('../core/id');
const { walkVaultFiles } = require('./obsidianFilesystem');
const { normalizeWikiTarget } = require('./obsidianLinks');

const TYPE_LIKE_EXCLUDES = new Set(['id', 'name', 'title', 'date', 'created', 'updated', 'aliases', 'tags']);

function inferLikelyTypeLikeFields(fieldStats, markdownFiles) {
    const candidates = [];
    if (!markdownFiles) return candidates;

    for (const [field, stats] of fieldStats.entries()) {
        if (TYPE_LIKE_EXCLUDES.has(field)) continue;
        const coverage = stats.present / markdownFiles;
        const uniqueCount = stats.uniqueValues.size;
        if (coverage < 0.2) continue;
        if (uniqueCount < 2) continue;
        if (uniqueCount > Math.min(12, Math.ceil(markdownFiles * 0.6))) continue;
        if (stats.multiWordCount > Math.ceil(stats.present * 0.35)) continue;

        candidates.push({
            field,
            coverage: stats.present,
            uniqueCount
        });
    }

    return candidates
        .sort((a, b) => b.coverage - a.coverage || a.uniqueCount - b.uniqueCount || a.field.localeCompare(b.field))
        .slice(0, 3);
}

function analyzeImportedVault(rootPath) {
    const summary = {
        markdownFiles: 0,
        nonMarkdownFiles: 0,
        notesWithFrontmatter: 0,
        notesWithId: 0,
        notesWithType: 0,
        typeCounts: new Map(),
        likelyTypeLikeFields: [],
        wikilinks: 0,
        idMatchedLinks: 0,
        filenameMatchedLinks: 0,
        unresolvedLinks: 0,
        filenameIdCandidates: [],
        unresolvedLinkTargets: new Map()
    };
    const noteIds = new Set();
    const noteFileTargets = new Set();
    const linkTargets = [];
    const noteRecords = [];
    const fieldStats = new Map();

    walkVaultFiles(rootPath, (fullPath, relativePath) => {
        if (!fullPath.toLowerCase().endsWith('.md')) {
            summary.nonMarkdownFiles++;
            return;
        }
        summary.markdownFiles++;

        const basename = path.basename(relativePath, '.md').toLowerCase();
        const filenameId = canonicalizeId(path.basename(relativePath, '.md'));
        noteFileTargets.add(basename);
        noteFileTargets.add(relativePath.replace(/\\/g, '/').replace(/\.md$/i, '').toLowerCase());

        const text = fs.readFileSync(fullPath, 'utf8');
        for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
            const target = normalizeWikiTarget(match[1]);
            if (target) {
                summary.wikilinks++;
                linkTargets.push(target);
            }
        }

        try {
            const parsed = parseFrontmatterDocument(text);
            if (!parsed.hasFrontmatter) return;
            summary.notesWithFrontmatter++;
            const data = parsed.data || {};

            const noteId = String(data.id || '').trim().toLowerCase();
            if (noteId) {
                summary.notesWithId++;
                noteIds.add(noteId);
            }

            noteRecords.push({
                relativePath: relativePath.replace(/\\/g, '/'),
                filenameId,
                existingId: noteId,
                titleLike: String(data.title || data.name || '').trim()
            });

            const noteType = String(data.type || '').trim().toLowerCase();
            if (noteType) {
                summary.notesWithType++;
                summary.typeCounts.set(noteType, (summary.typeCounts.get(noteType) || 0) + 1);
            }

            for (const [fieldName, rawValue] of Object.entries(data)) {
                const key = String(fieldName || '').trim().toLowerCase();
                if (!key || Array.isArray(rawValue) || rawValue == null || typeof rawValue === 'object') continue;
                const value = String(rawValue).trim();
                if (!value) continue;
                if (!fieldStats.has(key)) {
                    fieldStats.set(key, { present: 0, uniqueValues: new Set(), multiWordCount: 0 });
                }
                const stats = fieldStats.get(key);
                stats.present++;
                if (stats.uniqueValues.size < 50) stats.uniqueValues.add(value.toLowerCase());
                if (/\s/.test(value)) stats.multiWordCount++;
            }
        } catch (_) {
            // Leave malformed frontmatter files counted as markdown only.
        }
    });

    for (const target of linkTargets) {
        if (noteIds.has(target)) {
            summary.idMatchedLinks++;
        } else if (noteFileTargets.has(target)) {
            summary.filenameMatchedLinks++;
        } else {
            summary.unresolvedLinks++;
            summary.unresolvedLinkTargets.set(target, (summary.unresolvedLinkTargets.get(target) || 0) + 1);
        }
    }

    summary.likelyTypeLikeFields = inferLikelyTypeLikeFields(fieldStats, summary.markdownFiles);
    summary.filenameIdCandidates = noteRecords
        .filter(record => record.filenameId && record.filenameId !== record.existingId)
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return summary;
}

function formatImportSummaryLabel(rootPath, stats, analysis) {
    const parts = [];
    parts.push(`${analysis.markdownFiles} Markdown`);
    if (stats?.conflicts?.length) parts.push(`${stats.conflicts.length} conflict${stats.conflicts.length === 1 ? '' : 's'}`);
    if (stats?.skipped?.length) parts.push(`${stats.skipped.length} skipped`);
    if (analysis.notesWithId) parts.push(`${analysis.notesWithId} with id`);
    if (analysis.filenameMatchedLinks) parts.push(`${analysis.filenameMatchedLinks} filename-style links`);
    if (analysis.unresolvedLinks) parts.push(`${analysis.unresolvedLinks} unresolved links`);
    return `Yamlink: Imported "${path.basename(rootPath)}" — ${parts.join(' · ')}.`;
}

function formatImportSummaryDescription(analysis) {
    const topTypes = [...analysis.typeCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([type, count]) => `${type} (${count})`);
    const likelyFields = analysis.likelyTypeLikeFields.map(entry => entry.field);
    const pieces = [];
    if (topTypes.length) pieces.push(`top types: ${topTypes.join(', ')}`);
    if (likelyFields.length) pieces.push(`likely type-like fields: ${likelyFields.join(', ')}`);
    if (analysis.nonMarkdownFiles) pieces.push(`${analysis.nonMarkdownFiles} non-Markdown file${analysis.nonMarkdownFiles === 1 ? '' : 's'} preserved`);
    if (analysis.filenameMatchedLinks) pieces.push(`many links appear filename-based`);
    if (!pieces.length) return 'Imported vault is ready for Vault Health and structural analysis.';
    return pieces.join(' · ');
}

function buildImportPreviewSummaryLine(analysis) {
    const topTypes = [...analysis.typeCounts.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([t, c]) => `${t} (${c})`).join(', ');
    const likelyFields = analysis.likelyTypeLikeFields.map(e => e.field).join(', ');
    return [
        `${analysis.markdownFiles} notes`,
        analysis.notesWithType
            ? `${analysis.notesWithType} typed — ${topTypes || 'various'}`
            : likelyFields
                ? `no type: — "${likelyFields}" looks type-like`
                : 'no type: detected',
        analysis.unresolvedLinks   ? `${analysis.unresolvedLinks} unresolved links`   : null,
        analysis.filenameMatchedLinks ? `${analysis.filenameMatchedLinks} filename-style links` : null,
        analysis.notesWithId       ? `${analysis.notesWithId} with id:`               : 'no id: fields',
    ].filter(Boolean).join('  ·  ');
}

module.exports = {
    inferLikelyTypeLikeFields,
    analyzeImportedVault,
    formatImportSummaryLabel,
    formatImportSummaryDescription,
    buildImportPreviewSummaryLine
};
