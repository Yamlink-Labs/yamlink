'use strict';

function normalizePlatformName(platformName) {
    const value = String(platformName || '').trim().toLowerCase();
    if (value.includes('roam')) return 'Roam';
    if (value.includes('evernote')) return 'Evernote';
    if (value.includes('notion')) return 'Notion';
    return 'Obsidian';
}

function buildImportTrustProfile(platformName, inspection = {}) {
    const platform = normalizePlatformName(platformName || inspection.platform);

    if (platform === 'Notion') {
        return {
            platform,
            confidence: 'Mixed',
            preserves: [
                'Markdown pages, local files, page titles, folders, and local page links come over when the target page is in the export.',
                'CSV databases stay as CSV, and Yamlink also creates row notes from them.',
                inspection.htmlFiles ? 'HTML pages are turned into Markdown notes.' : 'Markdown and CSV exports are handled directly.'
            ],
            partial: [
                'HTML comes over as readable Markdown, not an exact copy of the Notion page.',
                'Relation-looking CSV cells can become links when the target is in the export and the title is not ambiguous.',
                'Row note types come from the CSV filename.'
            ],
            gaps: [
                'Notion does not put enough in exported files for Yamlink to rebuild real relations, rollups, formulas, views, comments, permissions, or full database setup.',
                'Duplicate page titles may need a quick review because Notion filenames get cleaner after Yamlink removes ID suffixes.',
                'Some rich Notion blocks become simpler Markdown.'
            ]
        };
    }

    if (platform === 'Evernote') {
        return {
            platform,
            confidence: 'Good, with formatting tradeoffs',
            preserves: [
                'Evernote notes, titles, tags, created/updated dates, source fields, note links, external links, tasks, and attachments come over.',
                'Images and attachments are extracted and linked from the Markdown note.',
                'Encrypted blocks are kept as clear placeholders instead of disappearing.'
            ],
            partial: [
                'Evernote HTML comes over as readable Markdown, not a pixel-perfect Evernote page.',
                'Heavy styling, nested layout, and some table/list details may be simplified.',
                'Evernote note links work when the target note is in the same import.'
            ],
            gaps: [
                'OCR text, detailed attachment metadata, location data, and Evernote-only display settings are not fully rebuilt.',
                'Notebook membership is not always present in a single ENEX file.',
                'Encrypted content cannot be decrypted by Yamlink.'
            ]
        };
    }

    if (platform === 'Roam') {
        return {
            platform,
            confidence: 'Good for pages and blocks',
            preserves: [
                'Pages, nested blocks, daily notes, page references, TODO/DONE state, and page-level Roam IDs come over.',
                'Roam block IDs are kept as Markdown block anchors.',
                'Roam block references can become Yamlink block links when the target ID is in the import.'
            ],
            partial: [
                'Roam embeds become block links instead of live embedded content.',
                'Block metadata mostly becomes readable Markdown structure.',
                'Date page parsing depends on recognizable date titles.'
            ],
            gaps: [
                'Roam queries, advanced attributes, custom components, and live embeds are not fully rebuilt.',
                'Remote attachments/images are not downloaded during import.',
                'Roam EDN export may contain more data than JSON, but Yamlink imports JSON.'
            ]
        };
    }

    return {
        platform: 'Obsidian',
        confidence: 'Strong',
        preserves: [
            'Notes, folders, frontmatter, tags, aliases, attachments, wikilinks, headings, and block links come over well.',
            'Obsidian-style wikilinks and Markdown note links can be cleaned up toward Yamlink IDs.',
            'Obsidian config folders are skipped so settings and plugins do not become notes.'
        ],
        partial: [
            'Obsidian settings are treated carefully, but they are not turned into a full migration plan.',
            'Custom config folders are skipped when they look like real Obsidian config folders.',
            'Plugin-specific syntax stays in the note unless Yamlink already understands it.'
        ],
        gaps: [
            'Themes, hotkeys, workspace layout, plugin state, and Obsidian app settings do not migrate into Yamlink.',
            'Attachment-folder preferences and excluded-file settings are not fully used as import rules.',
            'Plugin-generated database or schema behavior is not automatically rebuilt.'
        ]
    };
}

function formatImportTrustSummary(platformName, inspection = {}) {
    const profile = buildImportTrustProfile(platformName, inspection);
    const firstPartial = profile.partial[0] || 'Some details may be simplified.';
    const firstGap = profile.gaps[0] || 'Some details may need a quick review.';
    return `Import fit: ${profile.confidence}. ${firstPartial} ${firstGap}`;
}

function buildImportTrustSection(platformName, inspection = {}) {
    const profile = buildImportTrustProfile(platformName, inspection);
    const lines = [
        '## What to expect from this import',
        '',
        `- Platform: **${profile.platform}**`,
        `- Import fit: **${profile.confidence}**`,
        '',
        '### Comes over well',
        ''
    ];

    for (const item of profile.preserves) lines.push(`- ${item}`);
    lines.push('', '### Check after import', '');
    for (const item of profile.partial) lines.push(`- ${item}`);
    lines.push('', '### Yamlink cannot fully rebuild from this export', '');
    for (const item of profile.gaps) lines.push(`- ${item}`);
    lines.push('');
    return lines.join('\n');
}

module.exports = {
    normalizePlatformName,
    buildImportTrustProfile,
    formatImportTrustSummary,
    buildImportTrustSection
};
