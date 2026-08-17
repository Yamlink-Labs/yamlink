'use strict';

const path = require('path');

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

module.exports = {
    buildImportReportMarkdown,
    buildFilenameIdMigrationPreview,
    buildAppliedMigrationReportMarkdown,
    buildAppliedLinkRewriteReportMarkdown,
    buildCombinedCleanupReportMarkdown
};
