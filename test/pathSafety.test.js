'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { isWithinRoot, ensureContainedDir } = require('../src/core/pathSafety');

describe('isWithinRoot', () => {
    test('a path inside the root is within it', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-pathsafety-'));
        const inside = path.join(root, 'note.md');
        fs.writeFileSync(inside, 'x');
        try {
            assert.equal(isWithinRoot(inside, root), true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('a path outside the root is not within it', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-pathsafety-'));
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-pathsafety-outside-'));
        const outsideFile = path.join(outside, 'secret.md');
        fs.writeFileSync(outsideFile, 'x');
        try {
            assert.equal(isWithinRoot(outsideFile, root), false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    test('a nonexistent path fails closed', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-pathsafety-'));
        try {
            assert.equal(isWithinRoot(path.join(root, 'does-not-exist.md'), root), false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('ensureContainedDir — real exploit reproduction', () => {
    test('creates and returns the real path for a normal, unpoisoned directory', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-pathsafety-ecd-'));
        try {
            const dirPath = path.join(root, '.yamlink');
            const real = ensureContainedDir(dirPath, root);
            assert.equal(fs.existsSync(dirPath), true);
            assert.equal(fs.realpathSync(dirPath), real);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('throws when the directory already exists as a junction redirecting outside the root', (t) => {
        // Real, confirmed vulnerability this guards against (external
        // security review, independently reproduced): a plain
        // fs.mkdirSync(..., { recursive: true }) is a silent no-op when the
        // directory already exists — including as a symlink/junction
        // planted there before the real owner ever ran anything. Several
        // call sites (apiToken.js, mutationEventLog.js, webhooks.js) all
        // rely on this function refusing that case instead of silently
        // creating/writing through it.
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-pathsafety-ecd-junction-'));
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-pathsafety-ecd-outside-'));
        try {
            const dirPath = path.join(root, '.yamlink');
            try {
                fs.symlinkSync(outside, dirPath, 'junction');
            } catch (error) {
                if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
                    t.skip('junction creation not permitted in this environment');
                    return;
                }
                throw error;
            }
            assert.throws(() => ensureContainedDir(dirPath, root), /resolves outside/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});
