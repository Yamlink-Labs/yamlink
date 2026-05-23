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

    test('matches relative file paths, folders, and plain filenames', () => {
        const root = path.join('C:', 'vault');
        const rules = parseIgnoreFile('docs/\nnotes/legacy.md\nscratch-note.md');

        assert.equal(isIgnoredPath(path.join(root, 'docs', 'guide.md'), root, rules), true);
        assert.equal(isIgnoredPath(path.join(root, 'notes', 'legacy.md'), root, rules), true);
        assert.equal(isIgnoredPath(path.join(root, 'misc', 'scratch-note.md'), root, rules), true);
        assert.equal(isIgnoredPath(path.join(root, 'notes', 'active.md'), root, rules), false);
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
