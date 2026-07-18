'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveImageEmbed, IMAGE_EMBED_EXTENSIONS } = require('../src/core/imageEmbed');

function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-imageembed-'));
    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe('imageEmbed — resolveImageEmbed', () => {
    it('resolves a real image file relative to the given directory', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'photo.png'), Buffer.alloc(4));
            assert.equal(resolveImageEmbed('photo.png', dir), path.join(dir, 'photo.png'));
        });
    });

    it('returns null for a non-image extension', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'note.md'), 'x');
            assert.equal(resolveImageEmbed('note.md', dir), null);
        });
    });

    it('returns null when the file does not exist', () => {
        withTempDir((dir) => {
            assert.equal(resolveImageEmbed('nope.png', dir), null);
        });
    });

    it('returns null for an empty or missing target', () => {
        withTempDir((dir) => {
            assert.equal(resolveImageEmbed('', dir), null);
            assert.equal(resolveImageEmbed(null, dir), null);
            assert.equal(resolveImageEmbed(undefined, dir), null);
        });
    });

    it('returns null when the resolved path is a directory, not a file', () => {
        withTempDir((dir) => {
            fs.mkdirSync(path.join(dir, 'weird.png'));
            assert.equal(resolveImageEmbed('weird.png', dir), null);
        });
    });

    it('strips an alias segment (matching the [[id|Alias]] convention)', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'diagram.svg'), '<svg/>');
            assert.equal(resolveImageEmbed('diagram.svg|My Diagram', dir), path.join(dir, 'diagram.svg'));
        });
    });

    it('supports every extension in IMAGE_EMBED_EXTENSIONS', () => {
        withTempDir((dir) => {
            for (const ext of IMAGE_EMBED_EXTENSIONS) {
                const name = `file${ext}`;
                fs.writeFileSync(path.join(dir, name), Buffer.alloc(1));
                assert.equal(resolveImageEmbed(name, dir), path.join(dir, name), `expected ${ext} to resolve`);
            }
        });
    });
});
