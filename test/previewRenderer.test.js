'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const {
    renderNotePreview,
    preprocessImagesForRender,
    rewriteImageSrcs
} = require('../src/features/preview/previewRenderer');

function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-previewrenderer-'));
    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe('preview renderer footnotes', () => {
    test('renders footnote references and footnote section instead of raw definitions', () => {
        const text = [
            '---',
            'id: test-note',
            'type: note',
            'title: Test Note',
            '---',
            '',
            'Claim with support[^source-1].',
            '',
            '[^source-1]: Training-yard line associated with [[jean-rasczak]].'
        ].join('\n');

        const html = renderNotePreview(text, 'test-note');

        assert.ok(html.includes('yl-footnotes'));
        assert.ok(html.includes('href="#yl-fn-source-1"'));
        assert.ok(html.includes('Training-yard line associated with'));
        assert.ok(!html.includes('[^source-1]:'));
    });
});

describe('preview renderer — image handling', () => {
    test('preprocessImagesForRender dedents a standalone image line accidentally indented 4+ spaces', () => {
        const text = 'A paragraph.\n\n    ![alt](photo.png)\n\nMore text.';
        const out = preprocessImagesForRender(text, null);
        assert.ok(out.includes('\n![alt](photo.png)\n'), 'over-indented standalone image line is dedented to a plain paragraph');
    });

    test('preprocessImagesForRender leaves an image indented as real list-item content alone', () => {
        const text = '- item one\n\n  ![alt](photo.png)\n';
        const out = preprocessImagesForRender(text, null);
        assert.ok(out.includes('  ![alt](photo.png)'), 'image within an active list content column is left untouched');
    });

    test('preprocessImagesForRender does not touch image-shaped text inside a fenced code block', () => {
        const text = '```\n    ![[image.png]]\n```\n';
        const out = preprocessImagesForRender(text, null);
        assert.equal(out, text, 'fenced content is passed through verbatim');
    });

    test('preprocessImagesForRender resolves ![[embed.png]] to a real markdown image using resolveImageEmbed', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'photo.png'), Buffer.alloc(4));
            const out = preprocessImagesForRender('See ![[photo.png]] above.', dir);
            // A file:// URI, not a raw filesystem path — markdown-it mangles Windows
            // backslashes into %5C when a raw path is wrapped as a link destination,
            // silently producing an unloadable src. See the dedicated regression
            // test below for the exact bug this guards against.
            assert.match(out, /!\[photo\.png\]\(file:\/\/\/.*photo\.png\)/);
        });
    });

    test('preprocessImagesForRender never emits a raw backslash-containing path as an image destination (regression: markdown-it mangles it into %5C)', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'photo.png'), Buffer.alloc(4));
            const out = preprocessImagesForRender('![[photo.png]]', dir);
            assert.ok(!out.includes('\\'), 'no raw backslash should ever appear in the emitted image destination');

            const text = ['---', 'id: test-note', 'type: note', '---', '', '![[photo.png]]', ''].join('\n');
            const html = renderNotePreview(text, 'test-note', dir);
            assert.match(html, /<img src="file:\/\/\//);
            assert.ok(!html.includes('%5C'), 'markdown-it must not have mangled a path separator into %5C');
        });
    });

    test('preprocessImagesForRender resolves a standard ![alt](relative.png) reference against noteDir too, not just ![[embed]] syntax', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'diagram.png'), Buffer.alloc(4));
            const out = preprocessImagesForRender('![a diagram](diagram.png)', dir);
            assert.match(out, /!\[a diagram\]\(file:\/\/\/.*diagram\.png\)/);
        });
    });

    test('preprocessImagesForRender leaves a remote standard image reference untouched', () => {
        const out = preprocessImagesForRender('![x](https://example.com/a.png)', os.tmpdir());
        assert.equal(out, '![x](https://example.com/a.png)');
    });

    test('preprocessImagesForRender leaves an unresolvable embed as literal text (honest failure, not a guess)', () => {
        const out = preprocessImagesForRender('See ![[missing.png]] above.', os.tmpdir());
        assert.ok(out.includes('![[missing.png]]'));
    });

    test('renderNotePreview turns an indented ![[embed.png]] into a real <img> tag, not a code block', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'photo.png'), Buffer.alloc(4));
            const text = [
                '---', 'id: with-image', 'type: note', '---', '',
                'A paragraph.', '', '    ![[photo.png]]', ''
            ].join('\n');
            const html = renderNotePreview(text, 'with-image', dir);
            assert.ok(html.includes('<img'), 'renders as an image tag');
            assert.ok(!html.includes('<pre>') && !html.includes('<code>'), 'does not fall into a code block');
            assert.ok(!html.includes('wikilink'), 'embed syntax is not mistaken for a broken note wikilink');
        });
    });

    test('renderNotePreview renders a properly nested list image without corrupting the list', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'photo.png'), Buffer.alloc(4));
            const text = [
                '---', 'id: with-list-image', 'type: note', '---', '',
                '- first item', '', '  ![[photo.png]]', ''
            ].join('\n');
            const html = renderNotePreview(text, 'with-list-image', dir);
            assert.ok(html.includes('<img'));
            assert.ok(html.includes('<li>') || html.includes('<ul>'), 'list structure is preserved');
        });
    });
});

describe('preview renderer — rewriteImageSrcs', () => {
    test('rewrites a local file path src using the supplied resolver', () => {
        const html = '<img src="C:\\vault\\photo.png" alt="x">';
        const out = rewriteImageSrcs(html, (p) => `webview://resolved${p}`);
        assert.ok(out.includes('src="webview://resolved'));
    });

    test('leaves remote and data URIs untouched', () => {
        const html = '<img src="https://example.com/a.png"><img src="data:image/png;base64,AAA">';
        const out = rewriteImageSrcs(html, () => 'SHOULD_NOT_APPEAR');
        assert.ok(!out.includes('SHOULD_NOT_APPEAR'));
    });

    test('leaves html unchanged when no resolver is supplied', () => {
        const html = '<img src="photo.png">';
        assert.equal(rewriteImageSrcs(html), html);
    });

    test('converts a file:// URI src back to a plain fs path before calling the resolver', () => {
        // fileURLToPath() is platform-dependent (backslashes on win32, forward
        // slashes on POSIX) — build the file:// URL from a real platform-native
        // absolute path via pathToFileURL() rather than hardcoding one platform's
        // expected output, so this test is honest about what it's actually proving
        // (a correct round trip) regardless of which OS runs it.
        const samplePath = process.platform === 'win32'
            ? 'C:\\Users\\test\\vault\\photo.png'
            : '/Users/test/vault/photo.png';
        const fileUrl = pathToFileURL(samplePath).href;
        const html = `<img src="${fileUrl}">`;
        let receivedPath = null;
        rewriteImageSrcs(html, (p) => { receivedPath = p; return 'ok'; });
        assert.equal(receivedPath, samplePath);
    });
});
