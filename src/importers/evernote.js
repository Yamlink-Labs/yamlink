'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
        const hash = base64 ? crypto.createHash('md5').update(Buffer.from(base64, 'base64')).digest('hex') : '';
        resources.push({
            mime,
            fileName,
            base64,
            hash
        });
    }
    return resources;
}

function extractEvernoteGuid(noteXml) {
    return extractXmlTag(noteXml, 'guid');
}

function rewriteEvernoteContentLinks(content, linkContext = {}) {
    return String(content || '')
        .replace(/<en-todo\b([^>]*)\/>/gi, (_full, attrs) => {
            return /\bchecked="true"/i.test(attrs) ? '- [x] ' : '- [ ] ';
        })
        .replace(/<en-crypt\b([^>]*)>([\s\S]*?)<\/en-crypt>/gi, (_full, attrs) => {
            const hintMatch = /\bhint="([^"]*)"/i.exec(attrs);
            const hint = hintMatch ? decodeHtmlEntities(hintMatch[1]).trim() : '';
            return hint ? `[Encrypted Evernote content. Hint: ${hint}]` : '[Encrypted Evernote content]';
        })
        .replace(/<en-media\b([^>]*)\/>/gi, (full, attrs) => {
            const hashMatch = /\bhash="([^"]+)"/i.exec(attrs);
            const hash = hashMatch ? String(hashMatch[1] || '').trim().toLowerCase() : '';
            const resource = hash ? linkContext.resourceByHash?.get(hash) : null;
            if (!resource) return full;
            const label = resource.fileName || path.basename(resource.path || '') || 'Attachment';
            return `[${label}](${resource.path})`;
        })
        .replace(/<a\b([^>]*)href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi, (full, _before, href, _after, label) => {
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

function saveEvernoteResourcesDetailed(noteId, noteXml, destinationRoot) {
    const resources = extractEvernoteResources(noteXml);
    if (!resources.length) return { attachments: [], resourceByHash: new Map() };
    const attachmentRoot = path.join(destinationRoot, '_attachments', noteId);
    fs.mkdirSync(attachmentRoot, { recursive: true });
    const saved = [];
    const resourceByHash = new Map();
    let counter = 0;
    for (const resource of resources) {
        const fallback = `${noteId}-attachment-${counter + 1}${extensionForMime(resource.mime)}`;
        const name = sanitizeFileStem(resource.fileName || fallback, fallback);
        const outputPath = path.join(attachmentRoot, name);
        if (resource.base64) {
            fs.writeFileSync(outputPath, Buffer.from(resource.base64, 'base64'));
            const relativePath = path.relative(destinationRoot, outputPath).replace(/\\/g, '/');
            saved.push(relativePath);
            if (resource.hash) {
                resourceByHash.set(resource.hash, {
                    ...resource,
                    path: relativePath,
                    fileName: name
                });
            }
            counter++;
        }
    }
    return { attachments: saved, resourceByHash };
}

function saveEvernoteResources(noteId, noteXml, destinationRoot) {
    return saveEvernoteResourcesDetailed(noteId, noteXml, destinationRoot).attachments;
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
        const id = canonicalizeId(title);
        const savedResources = saveEvernoteResourcesDetailed(id, noteXml, destinationRoot);
        const linkedContent = rewriteEvernoteContentLinks(contentRaw.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''), {
            titleToNote,
            guidToNote,
            resourceByHash: savedResources.resourceByHash
        });
        const body = stripHtmlToMarkdownish(linkedContent);
        const attachments = savedResources.attachments;
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
    saveEvernoteResourcesDetailed,
    saveEvernoteResources,
    importEvernoteEnexToVault,
    inspectEvernoteExport
};
