'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { parseFrontmatterDocument, setField, serializeFrontmatterDocument } = require('../core/frontmatter');
const { canonicalizeId } = require('../core/id');

const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', '.vscode', '.cursor', '.zed', 'node_modules']);
const SKIP_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const TYPE_LIKE_EXCLUDES = new Set(['id', 'name', 'title', 'date', 'created', 'updated', 'aliases', 'tags']);

function detectObsidianVault(rootPath) {
    if (!rootPath) return false;
    return fs.existsSync(path.join(rootPath, '.obsidian'));
}

function shouldSkipImportEntry(entryName, isDirectory) {
    const normalized = String(entryName || '').trim().toLowerCase();
    if (!normalized) return true;
    if (isDirectory) return SKIP_DIRS.has(normalized);
    return SKIP_FILES.has(normalized);
}

function chooseImportDestination(workspaceRoot, sourceRoot) {
    const baseName = path.basename(sourceRoot);
    let candidate = path.join(workspaceRoot, baseName);
    if (!fs.existsSync(candidate)) return candidate;

    let suffix = 2;
    while (fs.existsSync(candidate)) {
        candidate = path.join(workspaceRoot, `${baseName}-${suffix}`);
        suffix++;
    }
    return candidate;
}

function copyVaultContents(sourceRoot, destinationRoot, stats = createImportStats()) {
    if (!fs.existsSync(destinationRoot)) {
        fs.mkdirSync(destinationRoot, { recursive: true });
    }

    for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
        if (shouldSkipImportEntry(entry.name, entry.isDirectory())) {
            stats.skipped.push(entry.name);
            continue;
        }

        const sourcePath = path.join(sourceRoot, entry.name);
        const destinationPath = path.join(destinationRoot, entry.name);

        if (entry.isDirectory()) {
            copyVaultContents(sourcePath, destinationPath, stats);
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

    return stats;
}

function createImportStats() {
    return {
        copied: 0,
        markdownCopied: 0,
        skipped: [],
        conflicts: []
    };
}

function walkVaultFiles(rootPath, onFile, relativeBase = '') {
    for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
        if (shouldSkipImportEntry(entry.name, entry.isDirectory())) continue;
        const fullPath = path.join(rootPath, entry.name);
        const relativePath = relativeBase ? path.join(relativeBase, entry.name) : entry.name;

        if (entry.isDirectory()) {
            walkVaultFiles(fullPath, onFile, relativePath);
            continue;
        }

        onFile(fullPath, relativePath);
    }
}

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

function buildImportReportMarkdown(rootPath, stats, analysis, options = {}) {
    const mode = options.mode || 'copy';
    const isObsidian = !!options.isObsidian;
    const platformName = String(options.platformName || 'Obsidian').trim() || 'Obsidian';
    const topTypes = [...analysis.typeCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8);
    const likelyFields = analysis.likelyTypeLikeFields;
    const skipped = [...new Set(stats.skipped)].sort();
    const conflicts = stats.conflicts.slice(0, 20);
    const unresolvedTargets = [...analysis.unresolvedLinkTargets.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 15);

    const lines = [
        `# Yamlink ${platformName} Import Report`,
        '',
        `- Imported root: \`${path.basename(rootPath)}\``,
        `- Mode: \`${mode}\``,
        `- Obsidian vault detected: \`${isObsidian ? 'yes' : 'no'}\``,
        '',
        '## Summary',
        '',
        `- Markdown files: **${analysis.markdownFiles}**`,
        `- Non-Markdown files preserved: **${analysis.nonMarkdownFiles || 0}**`,
        `- Notes with frontmatter: **${analysis.notesWithFrontmatter}**`,
        `- Notes with \`id:\`: **${analysis.notesWithId}**`,
        `- Notes with \`type:\`: **${analysis.notesWithType}**`,
        `- Wikilinks scanned: **${analysis.wikilinks}**`,
        `- ID-matched links: **${analysis.idMatchedLinks}**`,
        `- Filename-style links: **${analysis.filenameMatchedLinks}**`,
        `- Unresolved links: **${analysis.unresolvedLinks}**`,
        `- Files copied: **${stats.copied}**`,
        `- Markdown files copied: **${stats.markdownCopied}**`,
        `- Skipped entries: **${skipped.length}**`,
        `- Conflicts: **${stats.conflicts.length}**`,
        ''
    ];

    if (topTypes.length) {
        lines.push('## Top detected types', '');
        for (const [type, count] of topTypes) {
            lines.push(`- \`${type}\` (${count})`);
        }
        lines.push('');
    }

    if (likelyFields.length) {
        lines.push('## Likely type-like fields', '');
        for (const entry of likelyFields) {
            lines.push(`- \`${entry.field}\` — seen in ${entry.coverage}/${analysis.markdownFiles} Markdown files, ${entry.uniqueCount} distinct values`);
        }
        lines.push('');
    }

    if (analysis.filenameIdCandidates.length) {
        lines.push('## Filename → id migration preview', '');
        lines.push('These notes do not currently expose a canonical `id:` that matches the filename-derived Yamlink ID.', '');
        for (const candidate of analysis.filenameIdCandidates.slice(0, 25)) {
            const current = candidate.existingId ? `current: \`${candidate.existingId}\`` : 'current: _(missing)_';
            const label = candidate.titleLike ? ` — ${candidate.titleLike}` : '';
            lines.push(`- \`${candidate.relativePath}\` -> suggested \`id: ${candidate.filenameId}\` (${current})${label}`);
        }
        if (analysis.filenameIdCandidates.length > 25) {
            lines.push(`- ...and ${analysis.filenameIdCandidates.length - 25} more`);
        }
        lines.push('');
    }

    if (unresolvedTargets.length) {
        lines.push('## Top unresolved link targets', '');
        for (const [target, count] of unresolvedTargets) {
            lines.push(`- \`${target}\` (${count})`);
        }
        lines.push('');
    }

    if (skipped.length) {
        lines.push('## Skipped entries', '');
        for (const entry of skipped.slice(0, 20)) {
            lines.push(`- \`${entry}\``);
        }
        if (skipped.length > 20) {
            lines.push(`- ...and ${skipped.length - 20} more`);
        }
        lines.push('');
    }

    if (conflicts.length) {
        lines.push('## Conflicts', '', 'These files already existed at the destination and were not overwritten.', '');
        for (const entry of conflicts) {
            lines.push(`- \`${entry}\``);
        }
        if (stats.conflicts.length > conflicts.length) {
            lines.push(`- ...and ${stats.conflicts.length - conflicts.length} more`);
        }
        lines.push('');
    }

    lines.push('## What to do next', '');
    if (analysis.filenameMatchedLinks) {
        lines.push(`- This vault still appears to rely on **filename-style links** in at least ${analysis.filenameMatchedLinks} cases.`);
        lines.push('- Yamlink can already index the vault, but a migration/review pass may be needed if you want canonical `id:`-first linking.');
    }
    if (analysis.unresolvedLinks) {
        lines.push(`- There are **${analysis.unresolvedLinks} unresolved links**. Open Vault Health to inspect broken structure first.`);
    }
    if (likelyFields.length) {
        lines.push(`- The vault may be using \`${likelyFields[0].field}\` as a type-like field.`);
    }
    lines.push('- Open Vault Health for a structural scan of lifecycle, drift, and integrity.');
    lines.push('- Open Note Report on representative notes to inspect how Yamlink is reading the imported structure.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function buildFilenameIdMigrationPreview(rootPath, analysis) {
    const lines = [
        '# Yamlink Filename-to-ID Migration Preview',
        '',
        `- Vault root: \`${path.basename(rootPath)}\``,
        `- Candidate notes: **${analysis.filenameIdCandidates.length}**`,
        `- Filename-style links observed: **${analysis.filenameMatchedLinks}**`,
        `- Unresolved links observed: **${analysis.unresolvedLinks}**`,
        '',
        '> This is a review-only preview. Nothing has been rewritten.',
        '',
        '## Suggested note ID mappings',
        ''
    ];

    if (!analysis.filenameIdCandidates.length) {
        lines.push('- No filename-to-id candidates detected.');
    } else {
        for (const candidate of analysis.filenameIdCandidates) {
            const current = candidate.existingId ? candidate.existingId : '(missing)';
            const title = candidate.titleLike ? ` — ${candidate.titleLike}` : '';
            lines.push(`- \`${candidate.relativePath}\``);
            lines.push(`  - current id: \`${current}\``);
            lines.push(`  - suggested id: \`${candidate.filenameId}\`${title}`);
        }
    }

    lines.push('', '## What this preview means', '');
    lines.push('- If you later choose to migrate, these are the filename-derived IDs Yamlink would most likely recommend.');
    lines.push('- Notes already using canonical IDs can stay as they are.');
    lines.push('- Review unresolved link targets in the import report before attempting any rewrite.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function collectMissingIdCandidates(rootPath) {
    const candidates = [];
    const existingIds = new Set();

    walkVaultFiles(rootPath, (fullPath, relativePath) => {
        if (!fullPath.toLowerCase().endsWith('.md')) return;
        const text = fs.readFileSync(fullPath, 'utf8');
        const parsed = parseFrontmatterDocument(text);
        const existingId = String(parsed.data?.id || '').trim();
        if (existingId) existingIds.add(existingId.toLowerCase());
        const filenameId = canonicalizeId(path.basename(relativePath, '.md'));
        candidates.push({
            fullPath,
            relativePath: relativePath.replace(/\\/g, '/'),
            parsed,
            text,
            existingId,
            filenameId
        });
    });

    return {
        existingIds,
        candidates: candidates.filter(candidate => !candidate.existingId && candidate.filenameId)
    };
}

function applyMissingFilenameIds(rootPath) {
    const { existingIds, candidates } = collectMissingIdCandidates(rootPath);
    const applied = [];
    const skipped = [];
    const reserved = new Set(existingIds);

    for (const candidate of candidates) {
        const nextId = String(candidate.filenameId || '').trim().toLowerCase();
        if (!nextId) {
            skipped.push({ relativePath: candidate.relativePath, reason: 'empty-filename-id' });
            continue;
        }
        if (reserved.has(nextId)) {
            skipped.push({ relativePath: candidate.relativePath, suggestedId: nextId, reason: 'id-collision' });
            continue;
        }

        const nextDoc = setField({
            hasFrontmatter: candidate.parsed.hasFrontmatter,
            data: candidate.parsed.data || {},
            body: candidate.parsed.body || '',
            originalOrder: candidate.parsed.originalOrder || []
        }, 'id', nextId);
        const nextContent = serializeFrontmatterDocument(nextDoc);
        fs.writeFileSync(candidate.fullPath, nextContent, 'utf8');
        reserved.add(nextId);
        applied.push({ relativePath: candidate.relativePath, id: nextId });
    }

    return {
        applied,
        skipped
    };
}

function applyCanonicalWikilinkRewrite(rootPath) {
    const noteTargetMap = buildImportNoteTargetMap(rootPath);
    const changedFiles = [];
    let rewritesApplied = 0;

    walkVaultFiles(rootPath, (fullPath, relativePath) => {
        if (!fullPath.toLowerCase().endsWith('.md')) return;
        const raw = fs.readFileSync(fullPath, 'utf8');
        const rewritten = rewriteFilenameStyleWikilinks(raw, noteTargetMap);
        if (rewritten.rewrites <= 0 || rewritten.text === raw) return;
        fs.writeFileSync(fullPath, rewritten.text, 'utf8');
        rewritesApplied += rewritten.rewrites;
        changedFiles.push({
            relativePath: relativePath.replace(/\\/g, '/'),
            rewrites: rewritten.rewrites
        });
    });

    return {
        changedFiles,
        rewritesApplied
    };
}

function buildAppliedMigrationReportMarkdown(rootPath, result) {
    const platformName = String(result?.platformName || 'Obsidian').trim() || 'Obsidian';
    const lines = [
        `# Yamlink ${platformName} ID Migration Report`,
        '',
        `- Vault root: \`${path.basename(rootPath)}\``,
        `- IDs applied: **${result.applied.length}**`,
        `- Candidates skipped: **${result.skipped.length}**`,
        '',
        '> This migration only adds missing `id:` fields derived from filenames. It does not rewrite links.',
        ''
    ];

    lines.push('## Applied', '');
    if (!result.applied.length) {
        lines.push('- No missing ids were applied.');
    } else {
        for (const entry of result.applied) {
            lines.push(`- \`${entry.relativePath}\` -> \`id: ${entry.id}\``);
        }
    }
    lines.push('');

    if (result.skipped.length) {
        lines.push('## Skipped', '');
        for (const entry of result.skipped) {
            const suggested = entry.suggestedId ? ` (\`${entry.suggestedId}\`)` : '';
            lines.push(`- \`${entry.relativePath}\`${suggested} — ${entry.reason}`);
        }
        lines.push('');
    }

    lines.push('## What this means next', '');
    lines.push('- Rebuild/index refresh has already been triggered.');
    lines.push('- Open Vault Health to inspect the vault after the id pass.');
    lines.push('- Use the filename-to-id migration preview and import report to decide whether link rewriting should happen later.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function buildAppliedLinkRewriteReportMarkdown(rootPath, result) {
    const lines = [
        '# Yamlink Canonical Link Rewrite Report',
        '',
        `- Vault root: \`${path.basename(rootPath)}\``,
        `- Files changed: **${result.changedFiles.length}**`,
        `- Links rewritten: **${result.rewritesApplied}**`,
        '',
        '> This pass rewrites filename-style or alias-like wikilinks to canonical Yamlink note ids.',
        ''
    ];

    lines.push('## Changed files', '');
    if (!result.changedFiles.length) {
        lines.push('- No wikilinks needed rewriting.');
    } else {
        for (const entry of result.changedFiles) {
            lines.push(`- \`${entry.relativePath}\` — ${entry.rewrites} rewrite${entry.rewrites === 1 ? '' : 's'}`);
        }
    }
    lines.push('');
    lines.push('## What this means next', '');
    lines.push('- The imported vault now points more consistently at canonical `id:` targets.');
    lines.push('- Rebuild/index refresh has already been triggered.');
    lines.push('- Open Vault Health or Note Report to verify graph and relation surfaces on representative notes.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function buildCombinedCleanupReportMarkdown(rootPath, result) {
    const lines = [
        '# Yamlink Obsidian Cleanup Report',
        '',
        `- Vault root: \`${path.basename(rootPath)}\``,
        `- IDs applied: **${result.idResult?.applied?.length || 0}**`,
        `- ID candidates skipped: **${result.idResult?.skipped?.length || 0}**`,
        `- Files with rewritten links: **${result.linkResult?.changedFiles?.length || 0}**`,
        `- Links rewritten: **${result.linkResult?.rewritesApplied || 0}**`,
        '',
        '> This pass applies missing filename-derived ids first, then rewrites filename-style wikilinks to canonical Yamlink note ids.',
        ''
    ];

    lines.push('## ID assignments', '');
    if (!(result.idResult?.applied?.length)) {
        lines.push('- No missing ids were applied.');
    } else {
        for (const entry of result.idResult.applied) {
            lines.push(`- \`${entry.relativePath}\` -> \`id: ${entry.id}\``);
        }
    }
    lines.push('');

    if (result.idResult?.skipped?.length) {
        lines.push('## Skipped id candidates', '');
        for (const entry of result.idResult.skipped) {
            const suggested = entry.suggestedId ? ` (\`${entry.suggestedId}\`)` : '';
            lines.push(`- \`${entry.relativePath}\`${suggested} — ${entry.reason}`);
        }
        lines.push('');
    }

    lines.push('## Rewritten link files', '');
    if (!(result.linkResult?.changedFiles?.length)) {
        lines.push('- No wikilinks needed rewriting after the id pass.');
    } else {
        for (const entry of result.linkResult.changedFiles) {
            lines.push(`- \`${entry.relativePath}\` — ${entry.rewrites} rewrite${entry.rewrites === 1 ? '' : 's'}`);
        }
    }
    lines.push('');
    lines.push('## What this means next', '');
    lines.push('- The imported vault should now be much closer to Yamlink-native structure.');
    lines.push('- Rebuild/index refresh has already been triggered.');
    lines.push('- Open Vault Health or Note Report on representative notes to verify graph and relation behavior.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function _buildPreviewSummaryLine(analysis) {
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

async function showImportPreviewAndPickMode(sourceRoot, analysis, hasWorkspace) {
    const summary = _buildPreviewSummaryLine(analysis);
    const picks = [];

    if (hasWorkspace) {
        picks.push({
            label: '$(arrow-right) Copy into current workspace',
            description: 'Copies vault content. .obsidian/ is excluded.',
            detail: summary,
            mode: 'copy'
        });
        picks.push({
            label: '$(add) Add as workspace folder',
            description: 'Adds the folder to the current multi-root workspace.',
            detail: '.obsidian/ stays on disk but is not indexed.',
            mode: 'add'
        });
    } else {
        picks.push({
            label: '$(add) Add as workspace folder',
            description: 'Open vault as a workspace folder for Yamlink to index.',
            detail: summary,
            mode: 'add'
        });
    }

    picks.push({ label: '$(close) Cancel', description: 'Do not import.', mode: 'cancel' });

    const picked = await vscode.window.showQuickPick(picks, {
        title: `Import "${path.basename(sourceRoot)}"`,
        placeHolder: summary,
        matchOnDescription: true,
        matchOnDetail: true
    });

    return picked ? picked.mode : 'cancel';
}

async function showIdAssignmentQuestion(analysis) {
    const missing = analysis.markdownFiles - analysis.notesWithId;
    if (missing <= 0) return false;

    const detail = analysis.filenameMatchedLinks
        ? `${analysis.filenameMatchedLinks} existing [[wikilinks]] use filename-style targets — they will resolve automatically once IDs are assigned.`
        : 'Yamlink resolves [[wikilinks]] by id: field. Notes without one are invisible to the graph.';

    const picked = await vscode.window.showQuickPick([
        {
            label: `$(check) Yes — assign filename IDs to ${missing} note${missing === 1 ? '' : 's'}`,
            description: 'Recommended',
            detail,
            assign: true
        },
        {
            label: '$(close) No — skip for now',
            description: 'IDs can be applied later from the follow-up menu.',
            detail: 'Notes without id: will not appear in the graph until IDs are assigned.',
            assign: false
        }
    ], {
        title: `${missing} note${missing === 1 ? '' : 's'} ${missing === 1 ? 'has' : 'have'} no id: field`,
        placeHolder: 'Use the filename as the id: for notes that are missing one?',
        matchOnDescription: false,
        matchOnDetail: false
    });

    return picked ? picked.assign : false;
}

async function importObsidianVault(context, options = {}) {
    const buildIndex = options.buildIndex;
    const getWorkspaceRoot = options.getWorkspaceRoot;

    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: false,
        canSelectFolders: true,
        openLabel: 'Import Vault',
        title: 'Select an Obsidian vault folder'
    });

    if (!picked || picked.length === 0) return;

    const sourceUri = picked[0];
    const sourceRoot = sourceUri.fsPath;
    const hasWorkspace = Array.isArray(vscode.workspace.workspaceFolders) && vscode.workspace.workspaceFolders.length > 0;

    // Scan before showing the confirmation so the user sees what they're importing.
    let preAnalysis;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Yamlink: Scanning "${path.basename(sourceRoot)}"…`,
        cancellable: false
    }, async () => {
        preAnalysis = analyzeImportedVault(sourceRoot);
    });

    const mode = await showImportPreviewAndPickMode(sourceRoot, preAnalysis, hasWorkspace);
    if (!mode || mode === 'cancel') return;
    let followUpAction = 'none';

    // Ask about filename IDs before touching any files.
    const assignIds = await showIdAssignmentQuestion(preAnalysis);

    const isObsidian = detectObsidianVault(sourceRoot);
    let importedRoot = sourceRoot;
    let importStats = createImportStats();

    if (mode === 'copy') {
        const workspaceRoot = getWorkspaceRoot ? getWorkspaceRoot(vscode.workspace.workspaceFolders) : null;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('Yamlink: Open a workspace folder first, or use "Add as workspace folder" instead.');
            return;
        }

        const destinationRoot = chooseImportDestination(workspaceRoot, sourceRoot);
        importStats = copyVaultContents(sourceRoot, destinationRoot);
        importedRoot = destinationRoot;
    } else if (mode === 'add') {
        const existing = vscode.workspace.workspaceFolders || [];
        const alreadyOpen = existing.some(folder => path.resolve(folder.uri.fsPath) === path.resolve(sourceRoot));
        if (!alreadyOpen) {
            vscode.workspace.updateWorkspaceFolders(existing.length, 0, {
                uri: sourceUri,
                name: path.basename(sourceRoot)
            });
        }
    }

    /** @type {any} */
    let idMigrationResult = null;
    if (assignIds) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Yamlink: Assigning filename IDs in "${path.basename(importedRoot)}"…`,
            cancellable: false
        }, async () => {
            idMigrationResult = applyMissingFilenameIds(importedRoot);
        });
    }

    if (typeof buildIndex === 'function') {
        if (mode === 'add') await new Promise(resolve => setTimeout(resolve, 150));
        buildIndex(vscode.workspace.workspaceFolders);
    }

    // Reuse the pre-import analysis — the vault content is identical after copy.
    const analysis = preAnalysis;
    const summaryLabel = formatImportSummaryLabel(sourceRoot, importStats, analysis);
    const summaryDescription = formatImportSummaryDescription(analysis);
    const suffix = isObsidian
        ? mode === 'copy'
            ? ' (.obsidian ignored)'
            : ' (.obsidian stays local and is not indexed)'
        : '';
    const idSuffix = idMigrationResult
        ? ` · ${idMigrationResult.applied.length} id${idMigrationResult.applied.length === 1 ? '' : 's'} assigned`
        : '';
    vscode.window.showInformationMessage(`${summaryLabel}${idSuffix}${suffix}`);

    const followUpOptions = [
        { label: 'Open Vault Health', action: 'health', description: summaryDescription },
        { label: 'Open import report', action: 'report', description: 'Review what Yamlink found in the imported vault before doing anything else.' },
        { label: 'Open filename-to-id migration preview', action: 'migration', description: 'See which notes would likely need canonical id review before a later migration.' },
    ];
    followUpOptions.push({ label: 'Rewrite filename-style wikilinks to canonical ids', action: 'rewriteLinks', description: 'Safely rewrite imported `[[links]]` so the graph and relation surfaces point at canonical Yamlink ids.' });
    if (!assignIds) {
        followUpOptions.push({ label: 'Apply missing id fields (safe)', action: 'applyMissingIds', description: 'Add filename-derived id fields only where id is currently missing. No link rewriting.' });
        followUpOptions.push({ label: 'Apply missing ids and rewrite links', action: 'applyIdsAndRewrite', description: 'Recommended full cleanup for imported vaults that still use filename-style structure.' });
    }
    followUpOptions.push({ label: 'Do nothing', action: 'none', description: 'Leave the imported vault in place and continue working.' });

    const followUp = await vscode.window.showQuickPick(followUpOptions, {
        title: 'Obsidian vault imported',
        placeHolder: summaryDescription || 'Choose a follow-up action'
    });

    const action = followUp ? followUp.action : 'none';
    followUpAction = action;
    if (action === 'health') {
        await vscode.commands.executeCommand('yamlink.openHealthPanel');
    } else if (action === 'report') {
        const report = buildImportReportMarkdown(importedRoot, importStats, analysis, { mode, isObsidian });
        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    } else if (action === 'migration') {
        const preview = buildFilenameIdMigrationPreview(importedRoot, analysis);
        const doc = await vscode.workspace.openTextDocument({ content: preview, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    } else if (action === 'applyMissingIds') {
        const answer = await vscode.window.showWarningMessage(
            'Yamlink: Apply filename-derived id fields to notes that are currently missing id? This will modify imported Markdown files, but it will not rewrite links.',
            { modal: true },
            'Apply missing ids',
            'Cancel'
        );
        if (answer !== 'Apply missing ids') return;

        let result = { applied: [], skipped: [] };
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Yamlink: Applying missing Obsidian ids',
            cancellable: false
        }, async () => {
            result = applyMissingFilenameIds(importedRoot);
            if (typeof buildIndex === 'function') {
                await new Promise(resolve => setTimeout(resolve, 50));
                buildIndex(vscode.workspace.workspaceFolders);
            }
        });

        const report = buildAppliedMigrationReportMarkdown(importedRoot, result);
        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    } else if (action === 'rewriteLinks') {
        const answer = await vscode.window.showWarningMessage(
            'Yamlink: Rewrite imported filename-style wikilinks to canonical note ids? This will modify imported Markdown files, but it keeps anchors, block refs, and visible labels intact where possible.',
            { modal: true },
            'Rewrite links',
            'Cancel'
        );
        if (answer !== 'Rewrite links') return;

        let result = { changedFiles: [], rewritesApplied: 0 };
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Yamlink: Rewriting imported wikilinks',
            cancellable: false
        }, async () => {
            result = applyCanonicalWikilinkRewrite(importedRoot);
            if (typeof buildIndex === 'function') {
                await new Promise(resolve => setTimeout(resolve, 50));
                buildIndex(vscode.workspace.workspaceFolders);
            }
        });

        const report = buildAppliedLinkRewriteReportMarkdown(importedRoot, result);
        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    } else if (action === 'applyIdsAndRewrite') {
        const answer = await vscode.window.showWarningMessage(
            'Yamlink: Apply missing filename-derived ids first, then rewrite filename-style wikilinks to canonical note ids? This is the strongest cleanup pass for imported Obsidian vaults and will modify imported Markdown files.',
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
            title: 'Yamlink: Applying ids and rewriting imported wikilinks',
            cancellable: false
        }, async () => {
            combinedResult.idResult = applyMissingFilenameIds(importedRoot);
            combinedResult.linkResult = applyCanonicalWikilinkRewrite(importedRoot);
            if (typeof buildIndex === 'function') {
                await new Promise(resolve => setTimeout(resolve, 50));
                buildIndex(vscode.workspace.workspaceFolders);
            }
        });

        const report = buildCombinedCleanupReportMarkdown(importedRoot, combinedResult);
        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    }

    return {
        ok: true,
        platform: 'Obsidian',
        sourceRoot,
        importedRoot,
        mode,
        followUpAction,
        stats: importStats,
        analysis,
        idMigrationApplied: idMigrationResult ? idMigrationResult.applied.length : 0
    };
}

module.exports = {
    detectObsidianVault,
    shouldSkipImportEntry,
    chooseImportDestination,
    createImportStats,
    copyVaultContents,
    analyzeImportedVault,
    formatImportSummaryLabel,
    formatImportSummaryDescription,
    buildImportReportMarkdown,
    buildFilenameIdMigrationPreview,
    collectMissingIdCandidates,
    applyMissingFilenameIds,
    buildAppliedMigrationReportMarkdown,
    splitWikilinkTarget,
    buildCanonicalWikilink,
    buildImportNoteTargetMap,
    rewriteFilenameStyleWikilinks,
    applyCanonicalWikilinkRewrite,
    buildAppliedLinkRewriteReportMarkdown,
    buildCombinedCleanupReportMarkdown,
    showIdAssignmentQuestion,
    importObsidianVault
};
