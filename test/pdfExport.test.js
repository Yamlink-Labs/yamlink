'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    buildNoteExportModel,
    exportNotePdf,
    parseBodySegments,
    resolveImageLine
} = require('../src/export/pdf');
const { buildIndex } = require('../src/core/index');

// A real, minimal, valid 1x1 transparent PNG — needed because pdfkit actually
// parses image headers when embedding; a placeholder buffer of zero bytes
// would just exercise the error-fallback path, not real embedding.
const MINIMAL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
);

async function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-pdfexport-image-'));
    try {
        return await fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// exportNotePdf/exportViewPdf write asynchronously (pdfkit streams to disk) —
// their returned write stream must actually finish before a test asserts on
// the output file or before withTempDir deletes the directory underneath it.
function waitForFinish(stream) {
    return new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}

describe('pdf export models', () => {
    test('builds a structured note export model with embedded view results', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-pdf-'));
        const notePath = path.join(root, 'table-types.md');
        const text = [
            '---',
            'id: table-types',
            'type: lab',
            'name: Table Types',
            'active: true',
            'score: 7',
            'due: 2026-03-31',
            'owner: [[johnny-rico]]',
            'status: active',
            '---',
            '',
            '# Table Types',
            '',
            'This note is here to test typed cell editing.',
            '',
            '!view lab',
            'select active, score, due, owner, status'
        ].join('\n');
        fs.writeFileSync(notePath, text, 'utf8');
        buildIndex([{ uri: { fsPath: root } }]);

        const model = buildNoteExportModel(text, 'table-types');

        assert.equal(model.title, 'Table Types');
        assert.equal(model.id, 'table-types');
        assert.equal(model.type, 'lab');
        assert.equal(model.views.length, 1);
        assert.deepEqual(model.views[0].columns, ['id', 'active', 'score', 'due', 'owner', 'status']);
        fs.rmSync(root, { recursive: true, force: true });
    });
});

describe('pdf export — resolveImageLine', () => {
    test('resolves a real ![[embed.png]] to a local file, tolerating leading indentation', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'photo.png'), MINIMAL_PNG);
            const resolved = resolveImageLine('    ![[photo.png]]', dir);
            assert.ok(resolved);
            assert.equal(resolved.src, path.join(dir, 'photo.png'));
        });
    });

    test('resolves a real ![alt](relative.png) to a local file relative to noteDir', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'diagram.png'), MINIMAL_PNG);
            const resolved = resolveImageLine('![a diagram](diagram.png)', dir);
            assert.ok(resolved);
            assert.equal(resolved.src, path.join(dir, 'diagram.png'));
            assert.equal(resolved.alt, 'a diagram');
        });
    });

    test('returns null for an unresolvable embed (honest failure, not a guess)', () => {
        withTempDir((dir) => {
            assert.equal(resolveImageLine('![[missing.png]]', dir), null);
        });
    });

    test('returns null for a remote image — this is an offline export, not a network fetch', () => {
        withTempDir((dir) => {
            assert.equal(resolveImageLine('![x](https://example.com/a.png)', dir), null);
        });
    });

    test('returns null for a line that has more than just an image reference', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'photo.png'), MINIMAL_PNG);
            assert.equal(resolveImageLine('See ![[photo.png]] above.', dir), null);
        });
    });
});

describe('pdf export — parseBodySegments with images', () => {
    test('emits an image segment for a standalone (even indented) image line', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'photo.png'), MINIMAL_PNG);
            const text = 'A paragraph.\n\n    ![[photo.png]]\n\nMore text.';
            const segments = parseBodySegments(text, dir);
            const imageSeg = segments.find((s) => s.type === 'image');
            assert.ok(imageSeg);
            assert.equal(imageSeg.src, path.join(dir, 'photo.png'));
            assert.equal(segments.filter((s) => s.type === 'text').length, 2, 'text before and after the image stays separate');
        });
    });

    test('falls back to literal text for an unresolvable image reference', () => {
        const segments = parseBodySegments('![[missing.png]]', os.tmpdir());
        assert.equal(segments.length, 1);
        assert.equal(segments[0].type, 'text');
        assert.ok(segments[0].content.includes('missing.png'));
    });
});

describe('pdf export — exportNotePdf embeds real images', () => {
    test('a note with a real image produces a meaningfully larger PDF than one without', async () => {
        await withTempDir(async (dir) => {
            fs.writeFileSync(path.join(dir, 'photo.png'), MINIMAL_PNG);

            const withImageText = ['---', 'id: with-image', 'type: note', '---', '', 'Body text.', '', '    ![[photo.png]]', ''].join('\n');
            const withoutImageText = ['---', 'id: without-image', 'type: note', '---', '', 'Body text.', ''].join('\n');

            const withImagePath = path.join(dir, 'with-image.pdf');
            const withoutImagePath = path.join(dir, 'without-image.pdf');

            const withStream = exportNotePdf(withImagePath, buildNoteExportModel(withImageText, 'with-image', dir));
            const withoutStream = exportNotePdf(withoutImagePath, buildNoteExportModel(withoutImageText, 'without-image', dir));
            await Promise.all([waitForFinish(withStream), waitForFinish(withoutStream)]);

            const withSize = fs.statSync(withImagePath).size;
            const withoutSize = fs.statSync(withoutImagePath).size;
            assert.ok(withSize > withoutSize + 200, `expected the image-embedding PDF (${withSize}b) to be meaningfully larger than the plain one (${withoutSize}b)`);
        });
    });

    test('an image with an unsupported extension gets a text placeholder instead of crashing the export', async () => {
        await withTempDir(async (dir) => {
            fs.writeFileSync(path.join(dir, 'diagram.svg'), '<svg></svg>');
            const text = ['---', 'id: with-svg', 'type: note', '---', '', '![[diagram.svg]]', ''].join('\n');
            const outPath = path.join(dir, 'out.pdf');
            let stream;
            assert.doesNotThrow(() => {
                stream = exportNotePdf(outPath, buildNoteExportModel(text, 'with-svg', dir));
            });
            await waitForFinish(stream);
        });
    });

    test('a corrupt image file gets a text placeholder instead of crashing the export', async () => {
        await withTempDir(async (dir) => {
            fs.writeFileSync(path.join(dir, 'broken.png'), Buffer.from([0, 1, 2, 3]));
            const text = ['---', 'id: with-broken-image', 'type: note', '---', '', '![[broken.png]]', ''].join('\n');
            const outPath = path.join(dir, 'out.pdf');
            let stream;
            assert.doesNotThrow(() => {
                stream = exportNotePdf(outPath, buildNoteExportModel(text, 'with-broken-image', dir));
            });
            await waitForFinish(stream);
        });
    });
});
