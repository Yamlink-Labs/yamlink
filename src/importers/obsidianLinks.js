'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatterDocument } = require('../core/frontmatter');
const { canonicalizeId } = require('../core/id');
const { walkVaultFiles } = require('./obsidianFilesystem');

function normalizeWikiTarget(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const noAlias = text.split('|')[0].trim();
    const noAnchor = noAlias.split('#')[0].split('^')[0].trim();
    return noAnchor.replace(/\\/g, '/').replace(/\.md$/i, '').trim().toLowerCase();
}

function splitWikilinkTarget(raw) {
    const text = String(raw || '').trim();
    if (!text) return { target: '', alias: '', anchor: '', block: '' };

    const [targetPart, aliasPart = ''] = text.split('|');
    let target = String(targetPart || '').trim();
    let anchor = '';
    let block = '';

    const blockIndex = target.indexOf('^');
    if (blockIndex !== -1) {
        block = target.slice(blockIndex + 1).trim();
        target = target.slice(0, blockIndex).trim();
    }

    const anchorIndex = target.indexOf('#');
    if (anchorIndex !== -1) {
        anchor = target.slice(anchorIndex + 1).trim();
        target = target.slice(0, anchorIndex).trim();
    }

    return {
        target,
        alias: String(aliasPart || '').trim(),
        anchor,
        block
    };
}

function buildCanonicalWikilink(targetId, options = {}) {
    const canonicalId = String(targetId || '').trim();
    if (!canonicalId) return '';

    const anchor = String(options.anchor || '').trim();
    const block = String(options.block || '').trim();
    const alias = String(options.alias || '').trim();

    let core = canonicalId;
    if (anchor) core += `#${anchor}`;
    if (block) core += `^${block}`;
    if (alias) core += `|${alias}`;
    return `[[${core}]]`;
}

function buildImportNoteTargetMap(rootPath) {
    const noteTargetMap = new Map();

    walkVaultFiles(rootPath, (fullPath, relativePath) => {
        if (!fullPath.toLowerCase().endsWith('.md')) return;
        const text = fs.readFileSync(fullPath, 'utf8');
        const parsed = parseFrontmatterDocument(text);
        const data = parsed.data || {};
        const existingId = String(data.id || '').trim();
        const canonicalId = canonicalizeId(existingId || path.basename(relativePath, '.md'));
        if (!canonicalId) return;

        const normalizedRelative = relativePath.replace(/\\/g, '/');
        const basename = path.basename(normalizedRelative, '.md');
        const titleLike = String(data.title || data.name || basename).trim();
        const aliasLabel = titleLike || basename;

        const keys = new Set([
            normalizeWikiTarget(basename),
            normalizeWikiTarget(normalizedRelative),
            normalizeWikiTarget(existingId),
            normalizeWikiTarget(aliasLabel)
        ]);

        const aliases = String(data.aliases || '')
            .split(/,\s*/)
            .map((entry) => normalizeWikiTarget(entry))
            .filter(Boolean);
        for (const alias of aliases) keys.add(alias);

        for (const key of keys) {
            if (!key) continue;
            if (!noteTargetMap.has(key)) {
                noteTargetMap.set(key, { id: canonicalId, label: aliasLabel });
            }
        }
    });

    return noteTargetMap;
}

function rewriteFilenameStyleWikilinks(text, noteTargetMap) {
    let rewrites = 0;
    const nextText = String(text || '').replace(/\[\[([^\]]+)\]\]/g, (full, rawTarget) => {
        const parts = splitWikilinkTarget(rawTarget);
        const normalized = normalizeWikiTarget(parts.target);
        if (!normalized) return full;

        const resolved = noteTargetMap.get(normalized);
        if (!resolved || !resolved.id) return full;

        const alias = parts.alias || (parts.target.trim() !== resolved.id ? (parts.target.trim() || resolved.label) : '');
        const replacement = buildCanonicalWikilink(resolved.id, {
            alias,
            anchor: parts.anchor,
            block: parts.block
        });

        if (!replacement || replacement === full) return full;
        rewrites++;
        return replacement;
    });

    return { text: nextText, rewrites };
}

function rewriteFilenameStyleMarkdownLinks(text, noteTargetMap) {
    let rewrites = 0;
    const nextText = String(text || '').replace(/(!?)\[([^\]\n]+)\]\(([^)\n]+)\)/g, (full, bang, label, rawTarget) => {
        if (bang === '!') return full;
        const target = String(rawTarget || '').trim();
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) return full;

        const [targetPath, anchor = ''] = target.split('#');
        let decoded = targetPath;
        try {
            decoded = decodeURIComponent(targetPath);
        } catch (_) {
            decoded = targetPath.replace(/%20/g, ' ');
        }
        if (!/\.md$/i.test(decoded)) return full;

        const normalized = normalizeWikiTarget(decoded);
        if (!normalized) return full;
        const resolved = noteTargetMap.get(normalized);
        if (!resolved || !resolved.id) return full;

        const replacement = buildCanonicalWikilink(resolved.id, {
            alias: String(label || '').trim(),
            anchor: String(anchor || '').trim()
        });
        if (!replacement || replacement === full) return full;
        rewrites++;
        return replacement;
    });
    return { text: nextText, rewrites };
}

function applyCanonicalWikilinkRewrite(rootPath) {
    const noteTargetMap = buildImportNoteTargetMap(rootPath);
    const changedFiles = [];
    let rewritesApplied = 0;

    walkVaultFiles(rootPath, (fullPath, relativePath) => {
        if (!fullPath.toLowerCase().endsWith('.md')) return;
        const raw = fs.readFileSync(fullPath, 'utf8');
        const rewrittenWikilinks = rewriteFilenameStyleWikilinks(raw, noteTargetMap);
        const rewrittenMarkdownLinks = rewriteFilenameStyleMarkdownLinks(rewrittenWikilinks.text, noteTargetMap);
        const totalRewrites = rewrittenWikilinks.rewrites + rewrittenMarkdownLinks.rewrites;
        if (totalRewrites <= 0 || rewrittenMarkdownLinks.text === raw) return;
        fs.writeFileSync(fullPath, rewrittenMarkdownLinks.text, 'utf8');
        rewritesApplied += totalRewrites;
        changedFiles.push({
            relativePath: relativePath.replace(/\\/g, '/'),
            rewrites: totalRewrites
        });
    });

    return {
        changedFiles,
        rewritesApplied
    };
}

module.exports = {
    normalizeWikiTarget,
    splitWikilinkTarget,
    buildCanonicalWikilink,
    buildImportNoteTargetMap,
    rewriteFilenameStyleWikilinks,
    rewriteFilenameStyleMarkdownLinks,
    applyCanonicalWikilinkRewrite
};
