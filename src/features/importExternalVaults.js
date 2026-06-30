'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { serializeFrontmatterDocument, parseFrontmatterDocument, setField } = require('../core/frontmatter');
const { canonicalizeId } = require('../core/id');
const {
    chooseImportDestination,
    createImportStats,
    analyzeImportedVault,
    formatImportSummaryLabel,
    formatImportSummaryDescription,
    buildImportReportMarkdown,
    buildCanonicalWikilink,
    buildFilenameIdMigrationPreview,
    applyMissingFilenameIds,
    buildAppliedMigrationReportMarkdown,
    applyCanonicalWikilinkRewrite,
    buildAppliedLinkRewriteReportMarkdown,
    buildCombinedCleanupReportMarkdown
} = require('./importObsidian');

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

function extractEnexNotes(xml) {
    const notes = [];
    const noteRegex = /<note>([\s\S]*?)<\/note>/gi;
    let match;
    while ((match = noteRegex.exec(xml)) !== null) {
        notes.push(match[1]);
    }
    return notes;
}

function extractXmlTag(xml, tagName) {
    const match = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(xml);
    return match ? decodeHtmlEntities(match[1].trim()) : '';
}

function extractXmlTags(xml, tagName) {
    const values = [];
    const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
    let match;
    while ((match = regex.exec(xml)) !== null) {
        values.push(decodeHtmlEntities(match[1].trim()));
    }
    return values;
}

function normaliseEvernoteDate(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.length < 8) return '';
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function extensionForMime(mime) {
    const normalized = String(mime || '').toLowerCase();
    if (normalized === 'image/png') return '.png';
    if (normalized === 'image/jpeg') return '.jpg';
    if (normalized === 'image/gif') return '.gif';
    if (normalized === 'application/pdf') return '.pdf';
    if (normalized === 'text/plain') return '.txt';
    if (normalized === 'audio/mpeg') return '.mp3';
    return '';
}

function extractEvernoteResources(noteXml) {
    const resources = [];
    const regex = /<resource>([\s\S]*?)<\/resource>/gi;
    let match;
    while ((match = regex.exec(noteXml)) !== null) {
        const xml = match[1];
        const dataMatch = /<data[^>]*encoding="base64"[^>]*>([\s\S]*?)<\/data>/i.exec(xml);
        const base64 = dataMatch ? dataMatch[1].replace(/\s+/g, '') : '';
        const mime = extractXmlTag(xml, 'mime');
        const fileName = extractXmlTag(xml, 'file-name');
        resources.push({
            mime,
            fileName,
            base64
        });
    }
    return resources;
}

function extractEvernoteGuid(noteXml) {
    return extractXmlTag(noteXml, 'guid');
}

function rewriteEvernoteContentLinks(content, linkContext = {}) {
    return String(content || '').replace(/<a\b([^>]*)href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi, (full, _before, href, _after, label) => {
        const textLabel = stripHtmlToMarkdownish(label) || decodeHtmlEntities(label).trim();
        const url = String(href || '').trim();
        if (!url) return textLabel || full;

        const evernoteMatch = /evernote:\/\/\/view\/[^/]+\/[^/]+\/([0-9a-f-]+)\/([0-9a-f-]+)\//i.exec(url);
        const guid = evernoteMatch ? String(evernoteMatch[2] || evernoteMatch[1] || '').trim().toLowerCase() : '';
        const guidTarget = guid ? linkContext.guidToNote?.get(guid) : null;
        if (guidTarget?.id) {
            return buildCanonicalWikilink(guidTarget.id, {
                alias: textLabel && textLabel !== guidTarget.title ? textLabel : ''
            });
        }

        const titleTarget = textLabel ? linkContext.titleToNote?.get(textLabel.toLowerCase()) : null;
        if (titleTarget?.id) {
            return buildCanonicalWikilink(titleTarget.id, {
                alias: textLabel && textLabel !== titleTarget.title ? textLabel : ''
            });
        }

        if (/^https?:\/\//i.test(url)) {
            return textLabel ? `[${textLabel}](${url})` : url;
        }

        return textLabel || full;
    });
}

function saveEvernoteResources(noteId, noteXml, destinationRoot) {
    const resources = extractEvernoteResources(noteXml);
    if (!resources.length) return [];
    const attachmentRoot = path.join(destinationRoot, '_attachments', noteId);
    fs.mkdirSync(attachmentRoot, { recursive: true });
    const saved = [];
    let counter = 0;
    for (const resource of resources) {
        const fallback = `${noteId}-attachment-${counter + 1}${extensionForMime(resource.mime)}`;
        const name = sanitizeFileStem(resource.fileName || fallback, fallback);
        const outputPath = path.join(attachmentRoot, name);
        if (resource.base64) {
            fs.writeFileSync(outputPath, Buffer.from(resource.base64, 'base64'));
            saved.push(path.relative(destinationRoot, outputPath).replace(/\\/g, '/'));
            counter++;
        }
    }
    return saved;
}

function importEvernoteEnexToVault(sourcePath, destinationRoot) {
    const xml = fs.readFileSync(sourcePath, 'utf8');
    const notes = extractEnexNotes(xml);
    fs.mkdirSync(destinationRoot, { recursive: true });
    const used = new Set();
    const stats = createImportStats();
    stats.skipped = [];
    stats.conflicts = [];
    stats.platform = 'Evernote';
    stats.notesImported = 0;
    stats.attachmentsExtracted = 0;
    stats.internalLinksRewritten = 0;
    stats.externalLinksPreserved = 0;

    const titleToNote = new Map();
    const guidToNote = new Map();
    for (const noteXml of notes) {
        const title = extractXmlTag(noteXml, 'title') || 'Untitled Note';
        const id = canonicalizeId(title);
        const guid = String(extractEvernoteGuid(noteXml) || '').trim().toLowerCase();
        titleToNote.set(title.toLowerCase(), { id, title });
        if (guid) guidToNote.set(guid, { id, title });
    }

    for (const noteXml of notes) {
        const title = extractXmlTag(noteXml, 'title') || 'Untitled Note';
        const tags = extractXmlTags(noteXml, 'tag');
        const createdRaw = extractXmlTag(noteXml, 'created');
        const updatedRaw = extractXmlTag(noteXml, 'updated');
        const author = extractXmlTag(noteXml, 'author');
        const sourceUrl = extractXmlTag(noteXml, 'source-url');
        const sourceApplication = extractXmlTag(noteXml, 'source-application');
        const contentRaw = extractXmlTag(noteXml, 'content');
        const linkedContent = rewriteEvernoteContentLinks(contentRaw.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''), {
            titleToNote,
            guidToNote
        });
        const body = stripHtmlToMarkdownish(linkedContent);
        const id = canonicalizeId(title);
        const attachments = saveEvernoteResources(id, noteXml, destinationRoot);
        stats.attachmentsExtracted += attachments.length;
        stats.internalLinksRewritten += (body.match(/\[\[[^\]]+\]\]/g) || []).length;
        stats.externalLinksPreserved += (body.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) || []).length;
        const content = buildFrontmatterMarkdown({
            id,
            title,
            imported_from: 'evernote',
            created: normaliseEvernoteDate(createdRaw),
            updated: normaliseEvernoteDate(updatedRaw),
            tags,
            author,
            source_url: sourceUrl,
            source_application: sourceApplication,
            attachments
        }, body);
        const filePath = ensureUniqueMarkdownPath(destinationRoot, id || title, used);
        fs.writeFileSync(filePath, content, 'utf8');
        stats.copied++;
        stats.markdownCopied++;
        stats.notesImported++;
    }

    return stats;
}

function shouldSkipExternalEntry(entryName, isDirectory) {
    const normalized = String(entryName || '').trim().toLowerCase();
    if (!normalized) return true;
    if (isDirectory) return EXTERNAL_SKIP_DIRS.has(normalized);
    return EXTERNAL_SKIP_FILES.has(normalized);
}

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

function extractFirstMarkdownHeading(text) {
    const match = String(text || '').match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : '';
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

function inspectEvernoteExport(sourcePath) {
    const xml = fs.readFileSync(sourcePath, 'utf8');
    const notes = extractEnexNotes(xml);
    if (!notes.length) {
        throw new Error('Evernote export did not contain any <note> entries.');
    }

    let resources = 0;
    for (const noteXml of notes) {
        resources += extractEvernoteResources(noteXml).length;
    }

    return {
        platform: 'Evernote',
        notes: notes.length,
        resources
    };
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

async function confirmExternalImport(platform, sourcePath, inspection) {
    const summary = formatExternalInspectionSummary(inspection);
    const picks = [
        {
            label: `$(arrow-right) Import ${platform.label} export`,
            description: platform.description,
            detail: summary || `Import ${path.basename(sourcePath)} into the current workspace`,
            action: 'import'
        },
        {
            label: '$(close) Cancel',
            description: 'Do not import.',
            action: 'cancel'
        }
    ];

    const picked = await vscode.window.showQuickPick(picks, {
        title: `Import ${platform.label} export`,
        placeHolder: summary || `Review ${path.basename(sourcePath)} before import`,
        matchOnDescription: true,
        matchOnDetail: true
    });

    return picked ? picked.action === 'import' : false;
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

function notionFieldKey(label) {
    const normalized = canonicalizeId(label).replace(/-/g, '_');
    if (!normalized) return '';
    if (normalized === 'created_time' || normalized === 'created_at' || normalized === 'date_created') return 'created';
    if (normalized === 'last_edited_time' || normalized === 'updated_at' || normalized === 'last_modified' || normalized === 'date_updated') return 'updated';
    if (normalized === 'url' || normalized === 'link') return 'source_url';
    return normalized;
}

function stripMarkdownFormatting(text) {
    return String(text || '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[*_`]/g, '')
        .trim();
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

async function importExternalVault(context, options = {}) {
    const buildIndex = options.buildIndex;
    const getWorkspaceRoot = options.getWorkspaceRoot;
    const workspaceRoot = getWorkspaceRoot ? getWorkspaceRoot(vscode.workspace.workspaceFolders) : null;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('Yamlink: Open a workspace folder first.');
        return;
    }

    const platform = await vscode.window.showQuickPick([
        {
            label: 'Roam Research',
            description: 'Import a JSON export into Yamlink notes',
            kind: 'roam',
            sourceMode: 'file'
        },
        {
            label: 'Notion',
            description: 'Import an extracted Markdown export folder',
            kind: 'notion',
            sourceMode: 'folder'
        },
        {
            label: 'Evernote',
            description: 'Import an ENEX export into Yamlink notes',
            kind: 'evernote',
            sourceMode: 'file'
        }
    ], {
        title: 'Import external vault export',
        placeHolder: 'Choose the source platform'
    });
    if (!platform) return;

    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: platform.sourceMode === 'file',
        canSelectFolders: platform.sourceMode === 'folder',
        openLabel: 'Import',
        title: `Select ${platform.label} export`
    });
    if (!picked || picked.length === 0) return;

    const sourcePath = picked[0].fsPath;
    let followUpAction = 'none';
    let inspection = null;

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Yamlink: Inspecting ${platform.label} export…`,
            cancellable: false
        }, async () => {
            if (platform.kind === 'roam') {
                inspection = inspectRoamExport(sourcePath);
            } else if (platform.kind === 'evernote') {
                inspection = inspectEvernoteExport(sourcePath);
            } else {
                inspection = inspectNotionExport(sourcePath);
            }
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Yamlink: ${error.message || `Could not inspect ${platform.label} export.`}`);
        return;
    }

    const shouldImport = await confirmExternalImport(platform, sourcePath, inspection);
    if (!shouldImport) return;

    const sourceBase = platform.sourceMode === 'folder'
        ? sourcePath
        : path.join(path.dirname(sourcePath), path.basename(sourcePath, path.extname(sourcePath)));
    const destinationRoot = chooseImportDestination(workspaceRoot, sourceBase);

    let stats = createImportStats();
    let analysis = null;

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Yamlink: Importing ${platform.label} export…`,
            cancellable: false
        }, async () => {
            if (platform.kind === 'roam') {
                stats = importRoamJsonToVault(sourcePath, destinationRoot);
            } else if (platform.kind === 'evernote') {
                stats = importEvernoteEnexToVault(sourcePath, destinationRoot);
            } else {
                stats = copyNotionExport(sourcePath, destinationRoot, createImportStats());
            }
            analysis = analyzeImportedVault(destinationRoot);
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Yamlink: ${error.message || `Import failed for ${platform.label}.`}`);
        return;
    }

    if (typeof buildIndex === 'function') {
        buildIndex(vscode.workspace.workspaceFolders);
    }

    const extraBits = [];
    if (stats.dailyNotesImported) extraBits.push(`${stats.dailyNotesImported} daily note${stats.dailyNotesImported === 1 ? '' : 's'}`);
    if (stats.attachmentsExtracted) extraBits.push(`${stats.attachmentsExtracted} attachment${stats.attachmentsExtracted === 1 ? '' : 's'}`);
    if (stats.rewrittenLinks) extraBits.push(`${stats.rewrittenLinks} links rewritten`);
    if (stats.databaseRowsImported) extraBits.push(`${stats.databaseRowsImported} database row note${stats.databaseRowsImported === 1 ? '' : 's'}`);
    const label = `${formatImportSummaryLabel(sourcePath, stats, analysis)}${extraBits.length ? ` · ${extraBits.join(' · ')}` : ''}`;
    vscode.window.showInformationMessage(label);

    const followUpOptions = [
        { label: 'Open Vault Health', action: 'health', description: formatImportSummaryDescription(analysis) },
        { label: 'Open import report', action: 'report', description: `Review what Yamlink found in the imported ${platform.label} export.` }
    ];
    if (analysis?.filenameIdCandidates?.length) {
        followUpOptions.push({
            label: 'Open filename-to-id migration preview',
            action: 'migration',
            description: 'Review notes that still need canonical ids before a deeper cleanup pass.'
        });
        followUpOptions.push({
            label: 'Apply missing id fields (safe)',
            action: 'applyMissingIds',
            description: 'Add filename-derived ids only where id is currently missing. No link rewriting.'
        });
    }
    if (analysis?.filenameMatchedLinks) {
        followUpOptions.push({
            label: 'Rewrite filename-style wikilinks to canonical ids',
            action: 'rewriteLinks',
            description: 'Normalize imported `[[links]]` toward canonical Yamlink note ids.'
        });
    }
    if (analysis?.filenameIdCandidates?.length || analysis?.filenameMatchedLinks) {
        followUpOptions.push({
            label: 'Apply missing ids and rewrite links',
            action: 'applyIdsAndRewrite',
            description: 'Run the strongest cleanup pass for imported notes that still look filename-driven.'
        });
    }
    followUpOptions.push({ label: 'Do nothing', action: 'none', description: 'Leave the imported notes in place and continue.' });

    const followUp = await vscode.window.showQuickPick(followUpOptions, {
        title: `${platform.label} import complete`,
        placeHolder: formatImportSummaryDescription(analysis) || 'Choose a follow-up action'
    });

    if (!followUp || followUp.action === 'none') {
        return {
            ok: true,
            platform: platform.label,
            platformKind: platform.kind,
            sourcePath,
            importedRoot: destinationRoot,
            followUpAction,
            stats,
            analysis
        };
    }
    followUpAction = followUp.action;
    if (followUp.action === 'health') {
        await vscode.commands.executeCommand('yamlink.openHealthPanel');
        return {
            ok: true,
            platform: platform.label,
            platformKind: platform.kind,
            sourcePath,
            importedRoot: destinationRoot,
            followUpAction,
            stats,
            analysis
        };
    }
    if (followUp.action === 'report') {
        const report = buildImportReportMarkdown(destinationRoot, stats, analysis, {
            mode: 'copy',
            isObsidian: false,
            platformName: platform.label
        });
        const externalReport = buildExternalImportReportMarkdown(destinationRoot, stats, analysis, platform.label);
        const doc = await vscode.workspace.openTextDocument({ content: externalReport || report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        return {
            ok: true,
            platform: platform.label,
            platformKind: platform.kind,
            sourcePath,
            importedRoot: destinationRoot,
            followUpAction,
            stats,
            analysis
        };
    }
    if (followUp.action === 'migration') {
        const preview = buildFilenameIdMigrationPreview(destinationRoot, analysis);
        const doc = await vscode.workspace.openTextDocument({ content: preview, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        return {
            ok: true,
            platform: platform.label,
            platformKind: platform.kind,
            sourcePath,
            importedRoot: destinationRoot,
            followUpAction,
            stats,
            analysis
        };
    }
    if (followUp.action === 'applyMissingIds') {
        const answer = await vscode.window.showWarningMessage(
            `Yamlink: Apply filename-derived id fields to imported ${platform.label} notes that are currently missing id? This will modify imported Markdown files, but it will not rewrite links.`,
            { modal: true },
            'Apply missing ids',
            'Cancel'
        );
        if (answer !== 'Apply missing ids') return;

        let result = { applied: [], skipped: [] };
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Yamlink: Applying imported ${platform.label} ids`,
            cancellable: false
        }, async () => {
            result = applyMissingFilenameIds(destinationRoot);
            if (typeof buildIndex === 'function') {
                await new Promise(resolve => setTimeout(resolve, 50));
                buildIndex(vscode.workspace.workspaceFolders);
            }
        });

        const report = buildAppliedMigrationReportMarkdown(destinationRoot, {
            ...result,
            platformName: platform.label
        });
        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        return {
            ok: true,
            platform: platform.label,
            platformKind: platform.kind,
            sourcePath,
            importedRoot: destinationRoot,
            followUpAction,
            stats,
            analysis
        };
    }
    if (followUp.action === 'rewriteLinks') {
        const answer = await vscode.window.showWarningMessage(
            `Yamlink: Rewrite imported ${platform.label} filename-style wikilinks to canonical note ids? This will modify imported Markdown files, but anchors, block refs, and visible labels are preserved where possible.`,
            { modal: true },
            'Rewrite links',
            'Cancel'
        );
        if (answer !== 'Rewrite links') return;

        let result = { changedFiles: [], rewritesApplied: 0 };
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Yamlink: Rewriting imported ${platform.label} wikilinks`,
            cancellable: false
        }, async () => {
            result = applyCanonicalWikilinkRewrite(destinationRoot);
            if (typeof buildIndex === 'function') {
                await new Promise(resolve => setTimeout(resolve, 50));
                buildIndex(vscode.workspace.workspaceFolders);
            }
        });

        const report = buildAppliedLinkRewriteReportMarkdown(destinationRoot, result);
        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        return {
            ok: true,
            platform: platform.label,
            platformKind: platform.kind,
            sourcePath,
            importedRoot: destinationRoot,
            followUpAction,
            stats,
            analysis
        };
    }
    if (followUp.action === 'applyIdsAndRewrite') {
        const answer = await vscode.window.showWarningMessage(
            `Yamlink: Apply missing filename-derived ids first, then rewrite filename-style wikilinks for the imported ${platform.label} notes? This is the strongest cleanup pass and will modify imported Markdown files.`,
            { modal: true },
            'Apply ids and rewrite',
            'Cancel'
        );
        if (answer !== 'Apply ids and rewrite') return;

        let combinedResult = {
            idResult: { applied: [], skipped: [] },
            linkResult: { changedFiles: [], rewritesApplied: 0 }
        };
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Yamlink: Applying ids and rewriting imported ${platform.label} wikilinks`,
            cancellable: false
        }, async () => {
            combinedResult.idResult = applyMissingFilenameIds(destinationRoot);
            combinedResult.linkResult = applyCanonicalWikilinkRewrite(destinationRoot);
            if (typeof buildIndex === 'function') {
                await new Promise(resolve => setTimeout(resolve, 50));
                buildIndex(vscode.workspace.workspaceFolders);
            }
        });

        const report = buildCombinedCleanupReportMarkdown(destinationRoot, combinedResult);
        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        return {
            ok: true,
            platform: platform.label,
            platformKind: platform.kind,
            sourcePath,
            importedRoot: destinationRoot,
            followUpAction,
            stats,
            analysis
        };
    }

    return {
        ok: true,
        platform: platform.label,
        platformKind: platform.kind,
        sourcePath,
        importedRoot: destinationRoot,
        followUpAction,
        stats,
        analysis
    };
}

module.exports = {
    stripHtmlToMarkdownish,
    normalizeRoamText,
    renderRoamBlocks,
    importRoamJsonToVault,
    extractEvernoteResources,
    rewriteEvernoteContentLinks,
    saveEvernoteResources,
    stripNotionSuffix,
    singularizeImportedType,
    inspectRoamExport,
    inspectEvernoteExport,
    inspectNotionExport,
    formatExternalInspectionSummary,
    parseCsvTable,
    notionFieldKey,
    inferNotionPrimaryField,
    coerceNotionCellValue,
    rewriteNotionMarkdownLinks,
    postProcessNotionMarkdown,
    importNotionCsvDatabases,
    buildExternalImportReportMarkdown,
    importEvernoteEnexToVault,
    copyNotionExport,
    importExternalVault
};
