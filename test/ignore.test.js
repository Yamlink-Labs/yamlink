'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    normalizeRule,
    parseIgnoreFile,
    isIgnoredPath
} = require('../src/core/ignore');
const {
    buildIndex,
    updateSingleFile,
    getIndex
} = require('../src/core/index');

describe('.yamlinkignore rules', () => {
    test('parses file, folder, and basename rules', () => {
        const rules = parseIgnoreFile([
            '# comment',
            'docs/',
            'notes/legacy.md',
            'scratch-note.md'
        ].join('\n'));

        assert.deepEqual(rules, [
            { type: 'dir', value: 'docs' },
            { type: 'path', value: 'notes/legacy.md' },
            { type: 'name', value: 'scratch-note.md' }
        ]);
        assert.equal(normalizeRule(''), null);
    });

    // Real bug found live: a leading `/` is common .gitignore muscle memory
    // ("anchor to root"). Every Yamlink ignore rule is already relative to
    // the workspace root, so a preserved leading slash never matches the
    // computed relative path (which never has one) — the rule silently
    // ignored nothing.
    test('strips a leading slash (gitignore-style root anchor) so the rule still matches', () => {
        const rules = parseIgnoreFile('/docs/\n/notes/legacy.md\n/scratch-note.md');

        assert.deepEqual(rules, [
            { type: 'dir', value: 'docs' },
            { type: 'path', value: 'notes/legacy.md' },
            { type: 'name', value: 'scratch-note.md' }
        ]);

        const root = path.join('C:', 'vault');
        assert.equal(isIgnoredPath(path.join(root, 'docs', 'guide.md'), root, rules), true);
        assert.equal(isIgnoredPath(path.join(root, 'notes', 'legacy.md'), root, rules), true);
        assert.equal(isIgnoredPath(path.join(root, 'misc', 'scratch-note.md'), root, rules), true);
    });

    test('matches relative file paths, folders, and plain filenames', () => {
        const root = path.join('C:', 'vault');
        const rules = parseIgnoreFile('docs/\nnotes/legacy.md\nscratch-note.md');

        assert.equal(isIgnoredPath(path.join(root, 'docs', 'guide.md'), root, rules), true);
        assert.equal(isIgnoredPath(path.join(root, 'notes', 'legacy.md'), root, rules), true);
        assert.equal(isIgnoredPath(path.join(root, 'misc', 'scratch-note.md'), root, rules), true);
        assert.equal(isIgnoredPath(path.join(root, 'notes', 'active.md'), root, rules), false);
    });

    // Real gap found from a GitHub Discussions report about multi-root
    // workspaces: .yamlinkignore had zero wildcard support at all, so a
    // second folder in the workspace couldn't be excluded wholesale without
    // listing every path exactly.
    describe('glob rules', () => {
        test('parses a bare `*` as an anchored glob rule', () => {
            const rules = parseIgnoreFile('*');
            assert.equal(rules.length, 1);
            assert.equal(rules[0].type, 'glob');
            assert.equal(rules[0].anchored, false);
            assert.equal(rules[0].dirLike, false);
        });

        test('a bare `*` (unanchored) ignores everything at any depth', () => {
            const root = path.join('C:', 'vault');
            const rules = parseIgnoreFile('*');

            assert.equal(isIgnoredPath(path.join(root, 'top.md'), root, rules), true);
            assert.equal(isIgnoredPath(path.join(root, 'sub', 'nested.md'), root, rules), true);
        });

        test('`**/` ignores the whole tree from any anchor point', () => {
            const root = path.join('C:', 'vault');
            const rules = parseIgnoreFile('**/');

            assert.equal(isIgnoredPath(path.join(root, 'top.md'), root, rules), true);
            assert.equal(isIgnoredPath(path.join(root, 'sub', 'deep', 'nested.md'), root, rules), true);
        });

        test('an unanchored directory glob (`logs*/`, no slash) excludes matching dirs at any depth', () => {
            const root = path.join('C:', 'vault');
            const rules = parseIgnoreFile('logs*/');

            assert.equal(isIgnoredPath(path.join(root, 'logs-2026', 'jan.md'), root, rules), true);
            assert.equal(isIgnoredPath(path.join(root, 'other', 'logs-2026', 'jan.md'), root, rules), true);
            assert.equal(isIgnoredPath(path.join(root, 'notes.md'), root, rules), false);
        });

        test('an anchored directory glob (`archive/old*/`, has a slash) only matches at that exact root path', () => {
            const root = path.join('C:', 'vault');
            const rules = parseIgnoreFile('archive/old*/');

            assert.equal(isIgnoredPath(path.join(root, 'archive', 'old-2024', 'jan.md'), root, rules), true);
            assert.equal(isIgnoredPath(path.join(root, 'archive', 'old-2024'), root, rules), true);
            assert.equal(isIgnoredPath(path.join(root, 'other', 'archive', 'old-2024', 'jan.md'), root, rules), false);
            assert.equal(isIgnoredPath(path.join(root, 'archive', 'notes.md'), root, rules), false);
        });

        test('an anchored file glob (`drafts/*.md`) only matches directly inside that folder', () => {
            const root = path.join('C:', 'vault');
            const rules = parseIgnoreFile('drafts/*.md');

            assert.equal(isIgnoredPath(path.join(root, 'drafts', 'idea.md'), root, rules), true);
            assert.equal(isIgnoredPath(path.join(root, 'drafts', 'sub', 'idea.md'), root, rules), false);
        });

        test('an unanchored filename glob (`*.tmp.md`) matches at any depth by basename', () => {
            const root = path.join('C:', 'vault');
            const rules = parseIgnoreFile('*.tmp.md');

            assert.equal(isIgnoredPath(path.join(root, 'scratch.tmp.md'), root, rules), true);
            assert.equal(isIgnoredPath(path.join(root, 'nested', 'scratch.tmp.md'), root, rules), true);
            assert.equal(isIgnoredPath(path.join(root, 'keep.md'), root, rules), false);
        });

        test('an unanchored directory-name glob (`node_modules*/`) excludes matching folders at any depth', () => {
            const root = path.join('C:', 'vault');
            const rules = parseIgnoreFile('node_modules*/');

            assert.equal(isIgnoredPath(path.join(root, 'node_modules', 'pkg.md'), root, rules), true);
            assert.equal(isIgnoredPath(path.join(root, 'sub', 'node_modules-backup', 'pkg.md'), root, rules), true);
            assert.equal(isIgnoredPath(path.join(root, 'sub', 'not-modules', 'pkg.md'), root, rules), false);
        });
    });
});

describe('.yamlinkignore indexing', () => {
    let tempRoot;
    let workspaceFolders;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-ignore-'));
        workspaceFolders = [{ uri: { fsPath: tempRoot } }];
    });

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    test('buildIndex excludes ignored markdown notes from the vault', () => {
        fs.writeFileSync(path.join(tempRoot, '.yamlinkignore'), 'ignored.md\narchive/\n');
        fs.writeFileSync(path.join(tempRoot, 'ignored.md'), '---\nid: ignored\n---\n');
        fs.writeFileSync(path.join(tempRoot, 'kept.md'), '---\nid: kept\n---\n');
        fs.mkdirSync(path.join(tempRoot, 'archive'), { recursive: true });
        fs.writeFileSync(path.join(tempRoot, 'archive', 'buried.md'), '---\nid: buried\n---\n');

        buildIndex(workspaceFolders);

        assert.equal(getIndex().has('ignored'), false);
        assert.equal(getIndex().has('buried'), false);
        assert.equal(getIndex().has('kept'), true);
    });

    test('buildIndex honors a leading-slash directory rule (real bug: silently matched nothing)', () => {
        fs.writeFileSync(path.join(tempRoot, '.yamlinkignore'), '/archive/\n');
        fs.mkdirSync(path.join(tempRoot, 'archive'), { recursive: true });
        // Same id in both an ignored and a real note — before the fix this
        // produced a false "duplicate id" warning because the ignored copy
        // was still scanned and registered first.
        fs.writeFileSync(path.join(tempRoot, 'archive', 'old.md'), '---\nid: shared-id\n---\n');
        fs.writeFileSync(path.join(tempRoot, 'real.md'), '---\nid: shared-id\n---\n');

        buildIndex(workspaceFolders);

        assert.equal(getIndex().size, 1);
        assert.ok(getIndex().get('shared-id').endsWith('real.md'));
    });

    test('updateSingleFile stays quiet for ignored notes', () => {
        const ignoredPath = path.join(tempRoot, 'ignored.md');
        fs.writeFileSync(path.join(tempRoot, '.yamlinkignore'), 'ignored.md\n');
        fs.writeFileSync(ignoredPath, '---\nid: ignored\n---\n');

        buildIndex(workspaceFolders);
        const result = updateSingleFile(ignoredPath, { workspaceFolders });

        assert.equal(result.changed, false);
        assert.equal(getIndex().has('ignored'), false);
    });
});
