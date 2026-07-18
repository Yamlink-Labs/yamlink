'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatterDocument, serializeFrontmatterDocument, setField } = require('../core/frontmatter');
const { canonicalizeId } = require('../core/id');
const { createImportStats, buildCanonicalWikilink } = require('./obsidian');
const {
    walkExternalFiles,
    shouldSkipExternalEntry,
    buildFrontmatterMarkdown,
    ensureUniqueMarkdownPath,
    extractFirstMarkdownHeading,
    parseCsvTable,
    stripMarkdownFormatting
} = require('./shared');

function stripNotionSuffix(name) {
    return String(name || '')
        .replace(/\s+[0-9a-f]{32}$/i, '')
        .replace(/-[0-9a-f]{32}$/i, '')
        .trim();
}

function singularizeImportedType(name) {
    const normalized = canonicalizeId(name);
    if (!normalized) return '';
    if (normalized.endsWith('ies') && normalized.length > 3) {
        return `${normalized.slice(0, -3)}y`;
    }
    if (normalized.endsWith('sses') || normalized.endsWith('is') || normalized.endsWith('us')) {
        return normalized;
    }
    if (normalized.endsWith('s') && !normalized.endsWith('ss') && normalized.length > 1) {
        return normalized.slice(0, -1);
    }
    return normalized;
}

function buildNotionMarkdownMap(rootPath) {
    const entries = [];
    walkExternalFiles(rootPath, (fullPath, relativePath) => {
        if (!fullPath.toLowerCase().endsWith('.md')) return;
        const normalizedRelative = relativePath.replace(/\\/g, '/');
        const stem = stripNotionSuffix(path.basename(normalizedRelative, '.md'));
        const id = canonicalizeId(stem);
        entries.push({
            fullPath,
            relativePath: normalizedRelative,
            id
        });
    });
    const byResolvedRelative = new Map();
    for (const entry of entries) {
        byResolvedRelative.set(entry.relativePath.toLowerCase(), entry.id);
    }
    return { entries, byResolvedRelative };
}

function rewriteNotionMarkdownLinks(text, currentRelativePath, linkMap) {
    return String(text || '').replace(/(!?)\[([^\]]+)\]\(([^)]+)\)/g, (full, bang, label, target) => {
        if (bang === '!') return full;
        const raw = String(target || '').trim();
        if (!raw || /^https?:\/\//i.test(raw) || raw.startsWith('#')) return full;
        const parts = raw.split('#');
        const withoutAnchor = parts[0];
        const anchor = parts[1] ? parts[1].trim() : '';
        if (!/\.md$/i.test(withoutAnchor)) return full;
        let decoded = withoutAnchor;
        try {
            decoded = decodeURIComponent(withoutAnchor);
        } catch (_) {
            decoded = withoutAnchor.replace(/%20/g, ' ');
        }
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(currentRelativePath.replace(/\\/g, '/')), decoded));
        const targetId = linkMap.get(resolved.toLowerCase());
        if (!targetId) return full;
        return buildCanonicalWikilink(targetId, {
            alias: String(label || '').trim(),
            anchor
        });
    });
}

function inspectNotionExport(sourceRoot) {
    const summary = {
        platform: 'Notion',
        markdownFiles: 0,
        csvFiles: 0,
        otherFiles: 0
    };

    walkExternalFiles(sourceRoot, (fullPath) => {
        const lower = fullPath.toLowerCase();
        if (lower.endsWith('.md')) {
            summary.markdownFiles++;
            return;
        }
        if (lower.endsWith('.csv')) {
            summary.csvFiles++;
            return;
        }
        summary.otherFiles++;
    });

    if (!summary.markdownFiles && !summary.csvFiles) {
        throw new Error('Notion export folder did not contain Markdown notes or CSV databases.');
    }

    return summary;
}

function notionFieldKey(label) {
    const normalized = canonicalizeId(label).replace(/-/g, '_');
    if (!normalized) return '';
    if (normalized === 'created_time' || normalized === 'created_at' || normalized === 'date_created') return 'created';
    if (normalized === 'last_edited_time' || normalized === 'updated_at' || normalized === 'last_modified' || normalized === 'date_updated') return 'updated';
    if (normalized === 'url' || normalized === 'link') return 'source_url';
    return normalized;
}

function inferNotionPrimaryField(headers) {
    const normalized = headers.map((header) => String(header || '').trim().toLowerCase());
    const preferred = ['name', 'title', 'task', 'project', 'account', 'contact', 'company'];
    for (const key of preferred) {
        const index = normalized.indexOf(key);
        if (index !== -1) return index;
    }
    return normalized.findIndex(Boolean);
}

function coerceNotionCellValue(raw, titleMap) {
    const text = String(raw || '').trim();
    if (!text) return '';

    const markdownLinkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(text);
    if (markdownLinkMatch) {
        const label = String(markdownLinkMatch[1] || '').trim();
        const target = titleMap?.get(label.toLowerCase());
        if (target?.id) return buildCanonicalWikilink(target.id, { alias: label !== target.id ? label : '' });
        return text;
    }

    const segments = text.split(/\s*;\s*|\s*,\s*/).map((segment) => stripMarkdownFormatting(segment)).filter(Boolean);
    if (segments.length > 1) {
        const linked = segments.map((segment) => {
            const match = titleMap?.get(segment.toLowerCase());
            return match?.id ? buildCanonicalWikilink(match.id, { alias: segment !== match.id ? segment : '' }) : segment;
        });
        return linked;
    }

    const normalized = stripMarkdownFormatting(text);
    const exact = titleMap?.get(normalized.toLowerCase());
    if (exact?.id) return buildCanonicalWikilink(exact.id, { alias: normalized !== exact.id ? normalized : '' });
    return normalized;
}

function importNotionCsvDatabases(rootPath) {
    const csvFiles = [];
    walkExternalFiles(rootPath, (fullPath, relativePath) => {
        if (fullPath.toLowerCase().endsWith('.csv')) {
            csvFiles.push({
                fullPath,
                relativePath: relativePath.replace(/\\/g, '/')
            });
        }
    });

    const result = {
        csvDatabasesProcessed: 0,
        databaseRowsImported: 0,
        generatedFiles: []
    };
    if (!csvFiles.length) return result;

    const titleMap = new Map();
    const generatedRows = [];
    const usedPaths = new Set();

    for (const file of csvFiles) {
        const raw = fs.readFileSync(file.fullPath, 'utf8');
        const table = parseCsvTable(raw);
        if (table.length < 2) continue;

        const headers = table[0];
        const primaryIndex = inferNotionPrimaryField(headers);
        const databaseName = stripNotionSuffix(path.basename(file.relativePath, '.csv'));
        const databaseId = canonicalizeId(databaseName) || 'notion-database';
        const rowType = singularizeImportedType(databaseName) || databaseId;
        const databaseDir = path.join(rootPath, '_notion_databases', databaseId);
        fs.mkdirSync(databaseDir, { recursive: true });
        result.csvDatabasesProcessed++;

        for (let rowIndex = 1; rowIndex < table.length; rowIndex++) {
            const values = table[rowIndex];
            const primaryValue = primaryIndex >= 0 ? stripMarkdownFormatting(values[primaryIndex] || '') : '';
            const rowId = canonicalizeId(primaryValue) || `${databaseId}-row-${rowIndex}`;
            const title = primaryValue || `${databaseName} row ${rowIndex}`;
            const outputPath = ensureUniqueMarkdownPath(databaseDir, rowId, usedPaths);
            const parentDir = path.dirname(file.relativePath).replace(/\\/g, '/');

            const metadata = {
                id: rowId,
                type: rowType,
                title,
                imported_from: 'notion',
                notion_database: databaseName,
                notion_row: rowIndex
            };
            if (parentDir && parentDir !== '.') {
                metadata.parent = canonicalizeId(stripNotionSuffix(path.basename(parentDir)));
            }

            generatedRows.push({
                outputPath,
                title,
                rowId,
                headers,
                values,
                metadata
            });
            titleMap.set(title.toLowerCase(), { id: rowId, title });
        }
    }

    const markdownMap = buildNotionMarkdownMap(rootPath);
    for (const entry of markdownMap.entries) {
        const title = stripNotionSuffix(path.basename(entry.relativePath, '.md'));
        if (title) titleMap.set(title.toLowerCase(), { id: entry.id, title });
    }

    for (const row of generatedRows) {
        const data = { ...row.metadata };
        for (let i = 0; i < row.headers.length; i++) {
            const key = notionFieldKey(row.headers[i]);
            const isPrimaryTitleColumn = stripMarkdownFormatting(row.values[i] || '') === row.title
                && (key === 'name' || key === 'title');
            if (!key || key === 'id' || key === 'type' || key === 'title' || isPrimaryTitleColumn) continue;
            const value = coerceNotionCellValue(row.values[i], titleMap);
            if (value === '' || (Array.isArray(value) && value.length === 0)) continue;
            data[key] = value;
        }
        const content = buildFrontmatterMarkdown(data, '');
        fs.writeFileSync(row.outputPath, content, 'utf8');
        result.databaseRowsImported++;
        result.generatedFiles.push(path.relative(rootPath, row.outputPath).replace(/\\/g, '/'));
    }

    return result;
}

function postProcessNotionMarkdown(rootPath) {
    const { entries, byResolvedRelative } = buildNotionMarkdownMap(rootPath);
    let rewrittenLinks = 0;
    let frontmatterStamped = 0;
    for (const entry of entries) {
        const raw = fs.readFileSync(entry.fullPath, 'utf8');
        const rewritten = rewriteNotionMarkdownLinks(raw, entry.relativePath, byResolvedRelative);
        if (rewritten !== raw) {
            rewrittenLinks += (rewritten.match(/\[\[[^\]]+\]\]/g) || []).length - (raw.match(/\[\[[^\]]+\]\]/g) || []).length;
        }
        const parsed = parseFrontmatterDocument(rewritten);
        const title = extractFirstMarkdownHeading(parsed.body) || stripNotionSuffix(path.basename(entry.relativePath, '.md'));
        const parentDir = path.dirname(entry.relativePath).replace(/\\/g, '/');
        let nextDoc = setField(parsed, 'id', entry.id);
        nextDoc = setField(nextDoc, 'title', title);
        nextDoc = setField(nextDoc, 'imported_from', 'notion');
        if (parentDir && parentDir !== '.') {
            nextDoc = setField(nextDoc, 'parent', canonicalizeId(stripNotionSuffix(path.basename(parentDir))));
        }
        const serialized = serializeFrontmatterDocument(nextDoc);
        if (serialized !== raw) frontmatterStamped++;
        fs.writeFileSync(entry.fullPath, serialized, 'utf8');
    }
    return {
        markdownNotesProcessed: entries.length,
        frontmatterStamped,
        rewrittenLinks
    };
}

function copyNotionExportRecursive(sourceRoot, destinationRoot, stats) {
    fs.mkdirSync(destinationRoot, { recursive: true });

    for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
        if (shouldSkipExternalEntry(entry.name, entry.isDirectory())) {
            stats.skipped.push(entry.name);
            continue;
        }
        const sourcePath = path.join(sourceRoot, entry.name);
        const destinationPath = path.join(destinationRoot, entry.name);
        if (entry.isDirectory()) {
            copyNotionExportRecursive(sourcePath, destinationPath, stats);
            continue;
        }
        if (fs.existsSync(destinationPath)) {
            stats.conflicts.push(destinationPath);
            continue;
        }
        fs.copyFileSync(sourcePath, destinationPath);
        stats.copied++;
        if (destinationPath.toLowerCase().endsWith('.md')) {
            stats.markdownCopied++;
        }
    }
}

function copyNotionExport(sourceRoot, destinationRoot, stats = createImportStats()) {
    copyNotionExportRecursive(sourceRoot, destinationRoot, stats);

    const post = postProcessNotionMarkdown(destinationRoot);
    const databaseImport = importNotionCsvDatabases(destinationRoot);
    stats.markdownNotesProcessed = post.markdownNotesProcessed;
    stats.frontmatterStamped = post.frontmatterStamped;
    stats.rewrittenLinks = post.rewrittenLinks;
    stats.csvDatabasesProcessed = databaseImport.csvDatabasesProcessed;
    stats.databaseRowsImported = databaseImport.databaseRowsImported;
    stats.generatedDatabaseFiles = databaseImport.generatedFiles;
    return stats;
}

module.exports = {
    stripNotionSuffix,
    singularizeImportedType,
    buildNotionMarkdownMap,
    rewriteNotionMarkdownLinks,
    inspectNotionExport,
    notionFieldKey,
    inferNotionPrimaryField,
    coerceNotionCellValue,
    importNotionCsvDatabases,
    postProcessNotionMarkdown,
    copyNotionExportRecursive,
    copyNotionExport
};
