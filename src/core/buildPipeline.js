'use strict';
// The `yamlink publish` engine — walks an already-built vault index and
// emits a static, structured payload a site generator (Astro/Next/Eleventy)
// can consume. Touches the filesystem (reads note bodies/assets, writes
// output), same category as vaultSnapshots.js — not import-clean "pure",
// but no VS Code import either, so it's directly testable and fully headless.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parseAllViewQueries, runQuery } = require('../engine/query');
const { readNoteBodyVerbatim, extractFirstParagraph } = require('../intelligence/glossary');
const { resolveImageEmbed } = require('./imageEmbed');
const {
    isPublishable,
    getSlug,
    getOrder,
    sortByOrder,
    resolvePublishLinks,
    resolvePublishFieldValue,
    filterOutFencedLines
} = require('./publish');

const VIEW_CLAUSE_RE = /^(select|where|sort|limit|via|group)\b/i;
const EMBED_RE = /!\[\[([^\]]+)\]\]/g;
const STANDARD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const RESERVED_FIELD_PREFIX_RE = /^_/;

/**
 * Splits a note body into alternating markdown/!view segments, the same
 * block-detection rule `previewRenderer.js`'s (unexported) splitSegments
 * uses — kept as an independent copy here since this module emits Markdown
 * tables, not HTML, for a fundamentally different consumer.
 * @param {string} body
 * @returns {Array<{type: string, text?: string, raw?: string}>}
 */
function splitBodyIntoSegments(body) {
    const lines = String(body || '').split('\n');
    const segments = [];
    let mdLines = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith('!view ')) {
            if (mdLines.length) {
                segments.push({ type: 'md', text: mdLines.join('\n') });
                mdLines = [];
            }
            const blockLines = [line];
            let j = i + 1;
            while (j < lines.length) {
                const next = lines[j].trim();
                if (!next.length || next.startsWith('!view ')) break;
                if (VIEW_CLAUSE_RE.test(next)) { blockLines.push(lines[j]); j++; } else { break; }
            }
            segments.push({ type: 'view', raw: blockLines.join('\n') });
            i = j;
            continue;
        }

        mdLines.push(line);
        i++;
    }

    if (mdLines.length) segments.push({ type: 'md', text: mdLines.join('\n') });
    return segments;
}

/** @param {import('../engine/queryConditions').ParsedQuery} query @param {string|null} contextNodeId @returns {string} */
function renderViewAsMarkdownTable(query, contextNodeId) {
    let result;
    try {
        result = runQuery(query, contextNodeId);
    } catch (err) {
        return `> Query error: ${err.message}`;
    }
    if (!result.success) return `> ${result.error || 'Query failed'}`;
    const rows = result.rows || [];
    const columns = result.columns || [];
    if (!rows.length) return '> (no results)';

    /** @param {any} row @param {string} col */
    const cell = (row, col) => {
        const val = col === 'id' ? row.id : (row.fields ? row.fields[col] : '');
        if (val == null) return '';
        return String(Array.isArray(val) ? val.join(', ') : val).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    };
    const header = `| ${columns.join(' | ')} |`;
    const divider = `| ${columns.map(() => '---').join(' | ')} |`;
    const body = rows.map((row) => `| ${columns.map((col) => cell(row, col)).join(' | ')} |`).join('\n');
    return [header, divider, body].join('\n');
}

/**
 * Resolves !view blocks in a note body to a static Markdown-table snapshot
 * at build time — the destination site has no Yamlink query engine to
 * execute them live.
 * @param {string} body
 * @param {string} contextNodeId
 * @returns {string}
 */
function resolveViewBlocksToSnapshot(body, contextNodeId) {
    const segments = splitBodyIntoSegments(body);
    return segments.map((seg) => {
        if (seg.type === 'md') return seg.text;
        const parsed = parseAllViewQueries(seg.raw);
        const query = parsed ? parsed[0] : null;
        return query ? renderViewAsMarkdownTable(query, contextNodeId) : seg.raw;
    }).join('\n');
}

/**
 * Copies every locally-resolvable image reference (`![[embed.png]]` and
 * standard `![alt](path)`) into `<outDir>/assets/<slug>/`, rewriting the
 * body's reference to the new relative site path.
 * @param {string} body
 * @param {string} noteDir
 * @param {string} slug
 * @param {string} outDir
 * @returns {{ body: string, assets: string[] }}
 */
function resolveAndCopyAssets(body, noteDir, slug, outDir) {
    const assets = [];
    /** @param {string|null} candidatePath */
    const copyOne = (candidatePath) => {
        if (!candidatePath) return null;
        let isFile = false;
        try { isFile = fs.statSync(candidatePath).isFile(); } catch (_) { isFile = false; }
        if (!isFile) return null;
        const basename = path.basename(candidatePath);
        const destDir = path.join(outDir, 'assets', slug);
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(candidatePath, path.join(destDir, basename));
        const sitePath = `/assets/${slug}/${basename}`;
        if (!assets.includes(sitePath)) assets.push(sitePath);
        return sitePath;
    };

    let rewritten = body.replace(EMBED_RE, (full, rawTarget) => {
        const resolved = resolveImageEmbed(rawTarget, noteDir);
        const sitePath = copyOne(resolved);
        if (!sitePath) return full;
        const alt = String(rawTarget).split('|')[0].trim();
        return `![${alt}](${sitePath})`;
    });

    rewritten = rewritten.replace(STANDARD_IMAGE_RE, (full, alt, rawSrc) => {
        const src = String(rawSrc || '').trim();
        if (!src || /^(https?:|data:)/i.test(src) || path.isAbsolute(src)) return full;
        const candidate = path.join(noteDir, src);
        const sitePath = copyOne(candidate);
        return sitePath ? `![${alt}](${sitePath})` : full;
    });

    return { body: rewritten, assets };
}

/** @param {Record<string, any>} fields @returns {Record<string, any>} */
function resolveFieldValues(fields, idIndex, aliasIndex) {
    const out = {};
    for (const [key, value] of Object.entries(fields || {})) {
        if (RESERVED_FIELD_PREFIX_RE.test(key)) continue;
        if (typeof value === 'string' && value.includes('[[')) {
            out[key] = resolvePublishFieldValue(value, idIndex, aliasIndex);
        } else {
            out[key] = value;
        }
    }
    return out;
}

/** @param {Record<string, any>} fields @returns {string[]} */
function getPreviousIds(fields) {
    const raw = fields ? fields.previous_ids : null;
    if (!raw) return [];
    return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function sha1(text) {
    return crypto.createHash('sha1').update(text).digest('hex');
}

function readBuildCache(cachePath) {
    try {
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch (_) {
        return { generation: null, notes: {} };
    }
}

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildSitemapXml(entries, siteUrl) {
    const urls = entries.map((e) => {
        const lastmod = e.lastmod ? `<lastmod>${escapeXml(e.lastmod)}</lastmod>` : '';
        return `  <url><loc>${escapeXml(siteUrl.replace(/\/$/, ''))}/${escapeXml(e.slug)}</loc>${lastmod}</url>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function buildFeedXml(entries, siteUrl, { title = 'Yamlink Vault Feed' } = {}) {
    const base = siteUrl.replace(/\/$/, '');
    const items = entries.map((e) => {
        return [
            '  <item>',
            `    <title>${escapeXml(e.title)}</title>`,
            `    <link>${escapeXml(base)}/${escapeXml(e.slug)}</link>`,
            `    <guid>${escapeXml(base)}/${escapeXml(e.slug)}</guid>`,
            e.date ? `    <pubDate>${escapeXml(new Date(e.date).toUTCString())}</pubDate>` : '',
            e.description ? `    <description>${escapeXml(e.description)}</description>` : '',
            '  </item>'
        ].filter(Boolean).join('\n');
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n  <title>${escapeXml(title)}</title>\n  <link>${escapeXml(base)}</link>\n${items}\n</channel></rss>\n`;
}

/**
 * Runs the full publish build: status gate, resolved links, !view static
 * snapshots, asset pass-through, manual ordering, pre-publish safety
 * warnings, redirect map, and (when `siteUrl` is given) sitemap/feed.
 * Incremental via a generation + per-note content-hash cache — a build
 * where the vault generation hasn't changed since the last build is a
 * no-op; within a changed generation, only notes whose serialized output
 * actually changed are rewritten.
 *
 * @param {{
 *   idIndex: Map<string,string>,
 *   fieldsCache: Map<string,Record<string,any>>,
 *   aliasIndex?: Map<string,string>,
 *   vaultGeneration: number,
 *   outDir: string,
 *   mode?: 'production'|'preview',
 *   siteUrl?: string,
 *   force?: boolean
 * }} options
 */
function runBuild(options) {
    const {
        idIndex,
        fieldsCache,
        aliasIndex,
        vaultGeneration,
        outDir,
        mode = 'production',
        siteUrl = null,
        force = false
    } = options;

    const cachePath = path.join(outDir, '.yamlink-build-cache.json');
    // Deliberately NOT gated on vaultGeneration: `yamlink publish` is a
    // one-shot CLI process that calls buildIndex() exactly once per
    // invocation, so vaultGeneration is always 1 at the start of every
    // separate run regardless of what changed in the vault between them —
    // comparing it across process boundaries would report "unchanged" on
    // every run after the first, forever, missing every real edit. The
    // per-note content-hash comparison below is what's actually sound
    // across processes, since it re-reads real file content each time.
    // `cache` (the previous build's per-note hashes) is always read, even
    // with --force, so stale-file cleanup below can still tell what used
    // to be published — force only bypasses the per-note "hash unchanged,
    // skip rewriting" shortcut, not the bookkeeping needed to detect
    // removed/now-unpublished notes.
    const cache = readBuildCache(cachePath);

    fs.mkdirSync(outDir, { recursive: true });

    const publishableIds = [];
    for (const [id, fields] of fieldsCache) {
        if (isPublishable(fields, { mode })) publishableIds.push(id);
    }

    const noteEntries = publishableIds.map((id) => ({ id, fields: fieldsCache.get(id) }));
    const ordered = sortByOrder(noteEntries);

    const manifestNotes = [];
    const searchIndex = [];
    const redirects = {};
    const warnings = [];
    const sitemapEntries = [];
    const feedEntries = [];
    const newCacheNotes = {};
    let notesWritten = 0;
    let notesSkipped = 0;

    for (const { id, fields } of ordered) {
        const filePath = idIndex.get(id);
        if (!filePath) continue;
        const slug = getSlug(id);
        const noteDir = path.dirname(filePath);
        const rawBody = readNoteBodyVerbatim(filePath);

        const snapshotBody = resolveViewBlocksToSnapshot(rawBody, id);
        const { body: assetBody, assets } = resolveAndCopyAssets(snapshotBody, noteDir, slug, outDir);
        const resolvedBody = resolvePublishLinks(assetBody, idIndex, aliasIndex);
        const resolvedFields = resolveFieldValues(fields, idIndex, aliasIndex);

        const title = fields.title || fields.name || id;
        const description = fields.description || fields.summary || extractFirstParagraph(rawBody);
        const order = getOrder(fields);

        const payload = {
            id,
            slug,
            type: fields.type || null,
            title,
            description,
            order,
            fields: resolvedFields,
            body: resolvedBody,
            assets
        };

        const serialized = JSON.stringify(payload, null, 2);
        const hash = sha1(serialized);
        newCacheNotes[id] = hash;

        const typeDir = path.join(outDir, 'notes', fields.type || '_untyped');
        const notePath = path.join(typeDir, slug + '.json');

        if (!force && cache.notes[id] === hash && fs.existsSync(notePath)) {
            notesSkipped++;
        } else {
            fs.mkdirSync(typeDir, { recursive: true });
            fs.writeFileSync(notePath, serialized, 'utf8');
            notesWritten++;
        }

        manifestNotes.push({ id, slug, type: fields.type || null, title, order });
        searchIndex.push({ id, slug, type: fields.type || null, title, excerpt: extractFirstParagraph(rawBody) });

        for (const previousId of getPreviousIds(fields)) {
            redirects[getSlug(previousId)] = slug;
        }

        let mtime = null;
        try { mtime = fs.statSync(filePath).mtime.toISOString().slice(0, 10); } catch (_) { /* not fatal */ }
        sitemapEntries.push({ slug, lastmod: mtime });

        const dateValue = fields.date || fields.created || fields.published_at || null;
        if (dateValue) feedEntries.push({ slug, title, description, date: dateValue });

        // Pre-publish safety gate: does this note link to a draft/archived/
        // nonexistent note? Frontmatter relation values and body wikilinks
        // both walked. Body text is scanned with fenced code blocks removed
        // first — a tutorial note's fenced example showing `[[wikilink]]`
        // syntax is documentation, not a real reference, and must never be
        // flagged as broken (confirmed against the real sample vault's
        // welcome.md, which does exactly this).
        const linkSources = [filterOutFencedLines(rawBody), ...Object.values(fields).filter((v) => typeof v === 'string')];
        for (const source of linkSources) {
            const matches = String(source).match(/\[\[([^\]\r\n]+)\]\]/g) || [];
            for (const raw of matches) {
                const inner = raw.slice(2, -2);
                const target = inner.split('|')[0].split(/[#^]/)[0].trim();
                if (!target) continue;
                const targetId = idIndex.has(target) ? target : null;
                if (!targetId) {
                    warnings.push({ noteId: id, target, reason: 'broken-link' });
                    continue;
                }
                const targetFields = fieldsCache.get(targetId) || {};
                if (!isPublishable(targetFields, { mode })) {
                    warnings.push({ noteId: id, target: targetId, reason: 'links-to-unpublished' });
                }
            }
        }
    }

    // Remove output for notes that were previously built but are no longer
    // publishable (now draft/archived/deleted) — a stale published page
    // left behind is worse than a missing one.
    let notesRemoved = 0;
    for (const oldId of Object.keys(cache.notes)) {
        if (newCacheNotes[oldId]) continue;
        const oldFields = fieldsCache.get(oldId);
        const oldType = oldFields && oldFields.type ? oldFields.type : '_untyped';
        const oldSlug = getSlug(oldId);
        const oldPath = path.join(outDir, 'notes', oldType, oldSlug + '.json');
        try { fs.unlinkSync(oldPath); notesRemoved++; } catch (_) { /* already gone */ }
    }

    const typeCounts = {};
    for (const note of manifestNotes) {
        const t = note.type || '_untyped';
        typeCounts[t] = (typeCounts[t] || 0) + 1;
    }

    const manifest = {
        generation: vaultGeneration,
        builtAt: new Date().toISOString(),
        mode,
        noteCount: manifestNotes.length,
        typeCounts,
        notes: manifestNotes
    };

    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'search-index.json'), JSON.stringify(searchIndex, null, 2), 'utf8');
    if (Object.keys(redirects).length) {
        fs.writeFileSync(path.join(outDir, 'redirects.json'), JSON.stringify(redirects, null, 2), 'utf8');
    }

    if (siteUrl) {
        fs.writeFileSync(path.join(outDir, 'sitemap.xml'), buildSitemapXml(sitemapEntries, siteUrl), 'utf8');
        const feedSorted = feedEntries.slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 50);
        fs.writeFileSync(path.join(outDir, 'feed.xml'), buildFeedXml(feedSorted, siteUrl), 'utf8');
    }

    fs.writeFileSync(cachePath, JSON.stringify({ generation: vaultGeneration, notes: newCacheNotes }, null, 2), 'utf8');

    return {
        generation: vaultGeneration,
        mode,
        notesWritten,
        notesSkipped,
        notesRemoved,
        noteCount: manifestNotes.length,
        redirectCount: Object.keys(redirects).length,
        warnings
    };
}

module.exports = {
    runBuild,
    splitBodyIntoSegments,
    resolveViewBlocksToSnapshot,
    resolveAndCopyAssets,
    resolveFieldValues,
    getPreviousIds,
    buildSitemapXml,
    buildFeedXml
};
