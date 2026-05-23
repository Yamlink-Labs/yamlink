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
    copyVaultContents
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
        assert.equal(shouldSkipImportEntry('Thumbs.db', false), true);
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
});
