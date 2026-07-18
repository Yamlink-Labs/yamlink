'use strict';

const fs = require('fs');
const path = require('path');
const { canonicalizeId } = require('../core/id');
const { createImportStats, buildCanonicalWikilink } = require('./obsidian');
const {
    decodeHtmlEntities,
    stripHtmlToMarkdownish,
    sanitizeFileStem,
    buildFrontmatterMarkdown,
    ensureUniqueMarkdownPath
} = require('./shared');

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

module.exports = {
    extractEnexNotes,
    extractXmlTag,
    extractXmlTags,
    normaliseEvernoteDate,
    extensionForMime,
    extractEvernoteResources,
    extractEvernoteGuid,
    rewriteEvernoteContentLinks,
    saveEvernoteResources,
    importEvernoteEnexToVault,
    inspectEvernoteExport
};
