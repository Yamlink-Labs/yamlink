'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);
require.cache.__import_obsidian_vscode_stub__ = {
    id: '__import_obsidian_vscode_stub__',
    filename: '__import_obsidian_vscode_stub__',
    loaded: true,
    exports: {}
};
Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__import_obsidian_vscode_stub__';
    return originalResolve(request, parent, ...rest);
};

const {
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
    buildAppliedMigrationReportMarkdown
} = require('../src/features/importObsidian');

describe('importObsidian helpers', () => {
    let tempRoot;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-import-'));
    });

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    test('detects a vault by .obsidian directory', () => {
        const vaultRoot = path.join(tempRoot, 'vault');
        fs.mkdirSync(path.join(vaultRoot, '.obsidian'), { recursive: true });
        assert.equal(detectObsidianVault(vaultRoot), true);
        assert.equal(detectObsidianVault(path.join(tempRoot, 'missing')), false);
    });

    test('skips obsidian config and common junk entries', () => {
        assert.equal(shouldSkipImportEntry('.obsidian', true), true);
        assert.equal(shouldSkipImportEntry('.git', true), true);
        assert.equal(shouldSkipImportEntry('.vscode', true), true);
        assert.equal(shouldSkipImportEntry('node_modules', true), true);
        assert.equal(shouldSkipImportEntry('Thumbs.db', false), true);
        assert.equal(shouldSkipImportEntry('desktop.ini', false), true);
        assert.equal(shouldSkipImportEntry('notes', true), false);
        assert.equal(shouldSkipImportEntry('welcome.md', false), false);
    });

    test('chooseImportDestination avoids collisions inside workspace root', () => {
        const workspaceRoot = path.join(tempRoot, 'workspace');
        const sourceRoot = path.join(tempRoot, 'vault');
        fs.mkdirSync(path.join(workspaceRoot, 'vault'), { recursive: true });
        const destination = chooseImportDestination(workspaceRoot, sourceRoot);
        assert.equal(path.basename(destination), 'vault-2');
    });

    test('copyVaultContents skips .obsidian and preserves markdown plus attachments', () => {
        const sourceRoot = path.join(tempRoot, 'source');
        const destinationRoot = path.join(tempRoot, 'dest');
        fs.mkdirSync(path.join(sourceRoot, '.obsidian'), { recursive: true });
        fs.mkdirSync(path.join(sourceRoot, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(sourceRoot, '.obsidian', 'workspace.json'), '{}');
        fs.writeFileSync(path.join(sourceRoot, 'note.md'), '# Note');
        fs.writeFileSync(path.join(sourceRoot, 'assets', 'image.png'), 'png');

        const stats = copyVaultContents(sourceRoot, destinationRoot, createImportStats());

        assert.equal(stats.markdownCopied, 1);
        assert.equal(stats.copied, 2);
        assert.ok(stats.skipped.includes('.obsidian'));
        assert.equal(fs.existsSync(path.join(destinationRoot, '.obsidian')), false);
        assert.equal(fs.existsSync(path.join(destinationRoot, 'note.md')), true);
        assert.equal(fs.existsSync(path.join(destinationRoot, 'assets', 'image.png')), true);
    });

    test('copyVaultContents records conflicts instead of overwriting files', () => {
        const sourceRoot = path.join(tempRoot, 'source');
        const destinationRoot = path.join(tempRoot, 'dest');
        fs.mkdirSync(sourceRoot, { recursive: true });
        fs.mkdirSync(destinationRoot, { recursive: true });
        fs.writeFileSync(path.join(sourceRoot, 'note.md'), '# Incoming');
        fs.writeFileSync(path.join(destinationRoot, 'note.md'), '# Existing');

        const stats = copyVaultContents(sourceRoot, destinationRoot, createImportStats());

        assert.equal(stats.copied, 0);
        assert.equal(stats.conflicts.length, 1);
        assert.equal(fs.readFileSync(path.join(destinationRoot, 'note.md'), 'utf8'), '# Existing');
    });

    test('analyzeImportedVault detects filename-style links and likely type-like fields', () => {
        const vaultRoot = path.join(tempRoot, 'vault');
        fs.mkdirSync(vaultRoot, { recursive: true });
        fs.writeFileSync(path.join(vaultRoot, 'johnny-rico.md'), `---
category: character
unit: roughnecks
---

Met [[dizzy-flores]] on [[klendathu]].
`);
        fs.writeFileSync(path.join(vaultRoot, 'dizzy-flores.md'), `---
category: character
unit: roughnecks
---
`);
        fs.writeFileSync(path.join(vaultRoot, 'klendathu.md'), `---
category: mission
---
`);

        const analysis = analyzeImportedVault(vaultRoot);

        assert.equal(analysis.markdownFiles, 3);
        assert.equal(analysis.notesWithFrontmatter, 3);
        assert.equal(analysis.notesWithId, 0);
        assert.equal(analysis.filenameMatchedLinks, 2);
        assert.equal(analysis.unresolvedLinks, 0);
        assert.ok(analysis.likelyTypeLikeFields.some(entry => entry.field === 'category'));
        assert.ok(analysis.filenameIdCandidates.some(entry => entry.relativePath === 'johnny-rico.md' && entry.filenameId === 'johnny-rico'));
    });

    test('import summary formatting reflects structural findings', () => {
        const rootPath = path.join(tempRoot, 'vault');
        const stats = {
            copied: 4,
            markdownCopied: 3,
            skipped: ['.obsidian', '.vscode'],
            conflicts: ['vault/note.md']
        };
        const analysis = {
            markdownFiles: 3,
            notesWithId: 0,
            filenameMatchedLinks: 2,
            unresolvedLinks: 1,
            typeCounts: new Map([['character', 2], ['mission', 1]]),
            likelyTypeLikeFields: [{ field: 'category', coverage: 3, uniqueCount: 2 }]
        };

        const label = formatImportSummaryLabel(rootPath, stats, analysis);
        const description = formatImportSummaryDescription(analysis);

        assert.match(label, /3 Markdown/);
        assert.match(label, /1 conflict/);
        assert.match(label, /2 skipped/);
        assert.match(label, /2 filename-style links/);
        assert.match(description, /top types: character \(2\), mission \(1\)/);
        assert.match(description, /likely type-like fields: category/);
    });

    test('buildImportReportMarkdown produces a structured review document', () => {
        const report = buildImportReportMarkdown(path.join(tempRoot, 'vault'), {
            copied: 4,
            markdownCopied: 3,
            skipped: ['.obsidian', '.vscode'],
            conflicts: ['dest/note.md']
        }, {
            markdownFiles: 3,
            notesWithFrontmatter: 3,
            notesWithId: 0,
            notesWithType: 0,
            wikilinks: 2,
            idMatchedLinks: 0,
            filenameMatchedLinks: 2,
            unresolvedLinks: 1,
            unresolvedLinkTargets: new Map([['planet-p', 1]]),
            typeCounts: new Map([['character', 2], ['mission', 1]]),
            likelyTypeLikeFields: [{ field: 'category', coverage: 3, uniqueCount: 2 }],
            filenameIdCandidates: [{ relativePath: 'johnny-rico.md', filenameId: 'johnny-rico', existingId: '', titleLike: '' }]
        }, {
            mode: 'copy',
            isObsidian: true
        });

        assert.match(report, /# Yamlink Obsidian Import Report/);
        assert.match(report, /Filename-style links: \*\*2\*\*/);
        assert.match(report, /Likely type-like fields/);
        assert.match(report, /`category`/);
        assert.match(report, /Filename → id migration preview/);
        assert.match(report, /Top unresolved link targets/);
        assert.match(report, /Open Vault Health/);
    });

    test('buildFilenameIdMigrationPreview lists suggested filename-derived ids', () => {
        const preview = buildFilenameIdMigrationPreview(path.join(tempRoot, 'vault'), {
            filenameIdCandidates: [
                { relativePath: 'people/johnny-rico.md', filenameId: 'johnny-rico', existingId: '', titleLike: 'Johnny Rico' },
                { relativePath: 'ops/klendathu.md', filenameId: 'klendathu', existingId: 'battle-of-klendathu', titleLike: '' }
            ],
            filenameMatchedLinks: 7,
            unresolvedLinks: 2
        });

        assert.match(preview, /# Yamlink Filename-to-ID Migration Preview/);
        assert.match(preview, /people\/johnny-rico\.md/);
        assert.match(preview, /suggested id: `johnny-rico`/);
        assert.match(preview, /current id: `battle-of-klendathu`/);
        assert.match(preview, /review-only preview/);
    });

    test('collectMissingIdCandidates finds markdown notes without ids', () => {
        const vaultRoot = path.join(tempRoot, 'vault');
        fs.mkdirSync(vaultRoot, { recursive: true });
        fs.writeFileSync(path.join(vaultRoot, 'johnny-rico.md'), '---\ntype: character\n---\n');
        fs.writeFileSync(path.join(vaultRoot, 'dizzy-flores.md'), '---\nid: dizzy-flores\ntype: character\n---\n');
        fs.writeFileSync(path.join(vaultRoot, 'notes.txt'), 'ignore');

        const result = collectMissingIdCandidates(vaultRoot);

        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0].relativePath, 'johnny-rico.md');
        assert.ok(result.existingIds.has('dizzy-flores'));
    });

    test('applyMissingFilenameIds writes safe filename-derived ids and skips collisions', () => {
        const vaultRoot = path.join(tempRoot, 'vault');
        fs.mkdirSync(vaultRoot, { recursive: true });
        fs.writeFileSync(path.join(vaultRoot, 'johnny-rico.md'), '---\ntype: character\n---\n');
        fs.writeFileSync(path.join(vaultRoot, 'carl-jenkins.md'), 'Carl Jenkins body only');
        fs.writeFileSync(path.join(vaultRoot, 'dizzy-flores.md'), '---\nid: dizzy-flores\ntype: character\n---\n');
        fs.writeFileSync(path.join(vaultRoot, 'dizzy-flores (copy).md'), '---\ntype: character\n---\n');

        const result = applyMissingFilenameIds(vaultRoot);

        assert.equal(result.applied.length, 3);
        assert.equal(result.skipped.length, 0);

        const johnny = fs.readFileSync(path.join(vaultRoot, 'johnny-rico.md'), 'utf8');
        const carl = fs.readFileSync(path.join(vaultRoot, 'carl-jenkins.md'), 'utf8');
        assert.match(johnny, /id: johnny-rico/);
        assert.match(carl, /id: carl-jenkins/);
    });

    test('applyMissingFilenameIds skips notes whose derived id collides with an existing id', () => {
        const vaultRoot = path.join(tempRoot, 'vault');
        fs.mkdirSync(path.join(vaultRoot, 'folder-a'), { recursive: true });
        fs.mkdirSync(path.join(vaultRoot, 'folder-b'), { recursive: true });
        fs.writeFileSync(path.join(vaultRoot, 'folder-a', 'alpha.md'), '---\nid: alpha\n---\n');
        fs.writeFileSync(path.join(vaultRoot, 'folder-b', 'alpha.md'), '---\ntype: note\n---\n');

        const result = applyMissingFilenameIds(vaultRoot);

        assert.equal(result.applied.length, 0);
        assert.equal(result.skipped.length, 1);
        assert.equal(result.skipped[0].reason, 'id-collision');
    });

    test('buildAppliedMigrationReportMarkdown explains applied and skipped changes', () => {
        const report = buildAppliedMigrationReportMarkdown(path.join(tempRoot, 'vault'), {
            applied: [{ relativePath: 'johnny-rico.md', id: 'johnny-rico' }],
            skipped: [{ relativePath: 'folder-b/alpha.md', suggestedId: 'alpha', reason: 'id-collision' }]
        });

        assert.match(report, /# Yamlink Obsidian ID Migration Report/);
        assert.match(report, /IDs applied: \*\*1\*\*/);
        assert.match(report, /johnny-rico\.md/);
        assert.match(report, /id-collision/);
        assert.match(report, /does not rewrite links/);
    });
});
