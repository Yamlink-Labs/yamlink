'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runBuild, splitBodyIntoSegments, getPreviousIds } = require('../src/core/buildPipeline');
const { createVault } = require('./lib/vaultSim');

function writeNote(vaultDir, filename, content) {
    const filePath = path.join(vaultDir, filename);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
}

describe('buildPipeline', () => {
    let vaultDir;
    let outDir;

    beforeEach(() => {
        vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-build-vault-'));
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-build-out-'));
    });

    afterEach(() => {
        fs.rmSync(vaultDir, { recursive: true, force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
    });

    describe('splitBodyIntoSegments', () => {
        test('splits plain markdown and a !view block into separate segments', () => {
            const body = 'Some intro text.\n\n!view unit\nwhere type = unit\nsort name\n\nMore prose after.';
            const segments = splitBodyIntoSegments(body);
            assert.equal(segments.length, 3);
            assert.equal(segments[0].type, 'md');
            assert.equal(segments[1].type, 'view');
            assert.ok(segments[1].raw.includes('!view unit'));
            assert.equal(segments[2].type, 'md');
        });

        test('a body with no !view blocks returns a single md segment', () => {
            const segments = splitBodyIntoSegments('Just plain prose, nothing else.');
            assert.equal(segments.length, 1);
            assert.equal(segments[0].type, 'md');
        });
    });

    describe('getPreviousIds', () => {
        test('parses a comma-joined previous_ids field', () => {
            assert.deepEqual(getPreviousIds({ previous_ids: 'old-slug-1, old-slug-2' }), ['old-slug-1', 'old-slug-2']);
        });

        test('returns empty array when absent', () => {
            assert.deepEqual(getPreviousIds({}), []);
        });
    });

    describe('runBuild', () => {
        function buildFixture() {
            const publishedPath = writeNote(vaultDir, 'published-note.md',
                '---\nid: published-note\ntype: article\nstatus: published\ntitle: Published Note\norder: 2\n---\nBody linking to [[draft-note]] and [[nonexistent-note]].\n');
            const draftPath = writeNote(vaultDir, 'draft-note.md',
                '---\nid: draft-note\ntype: article\nstatus: draft\ntitle: Draft Note\norder: 1\n---\nThis is still a draft.\n');
            const noStatusPath = writeNote(vaultDir, 'no-status-note.md',
                '---\nid: no-status-note\ntype: article\ntitle: No Status Note\n---\nA note with no status field at all.\n');

            const idIndex = new Map([
                ['published-note', publishedPath],
                ['draft-note', draftPath],
                ['no-status-note', noStatusPath]
            ]);
            const fieldsCache = new Map([
                ['published-note', { id: 'published-note', type: 'article', status: 'published', title: 'Published Note', order: 2 }],
                ['draft-note', { id: 'draft-note', type: 'article', status: 'draft', title: 'Draft Note', order: 1 }],
                ['no-status-note', { id: 'no-status-note', type: 'article', title: 'No Status Note' }]
            ]);
            return { idIndex, fieldsCache };
        }

        test('production mode excludes draft notes from the manifest and output', () => {
            const { idIndex, fieldsCache } = buildFixture();
            const result = runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'production' });

            assert.equal(result.skipped, false);
            assert.equal(result.noteCount, 2);

            const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
            const ids = manifest.notes.map((n) => n.id);
            assert.ok(!ids.includes('draft-note'));
            assert.ok(ids.includes('published-note'));
            assert.ok(ids.includes('no-status-note'));
            assert.ok(!fs.existsSync(path.join(outDir, 'notes', 'article', 'draft-note.json')));
            assert.ok(fs.existsSync(path.join(outDir, 'notes', 'article', 'published-note.json')));
        });

        test('preview mode includes draft notes', () => {
            const { idIndex, fieldsCache } = buildFixture();
            const result = runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'preview' });
            assert.equal(result.noteCount, 3);
            assert.ok(fs.existsSync(path.join(outDir, 'notes', 'article', 'draft-note.json')));
        });

        test('resolves body wikilinks to relative site URLs in the written payload', () => {
            const { idIndex, fieldsCache } = buildFixture();
            runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'preview' });
            const payload = JSON.parse(fs.readFileSync(path.join(outDir, 'notes', 'article', 'published-note.json'), 'utf8'));
            assert.ok(payload.body.includes('(/draft-note)'));
            assert.ok(!payload.body.includes('[[draft-note]]'));
        });

        test('manifest respects order: field ascending, notes without order trail', () => {
            const { idIndex, fieldsCache } = buildFixture();
            runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'preview' });
            const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
            const ids = manifest.notes.map((n) => n.id);
            assert.deepEqual(ids, ['draft-note', 'published-note', 'no-status-note']);
        });

        test('pre-publish safety gate flags a link to an unpublished note and a broken link', () => {
            const { idIndex, fieldsCache } = buildFixture();
            const result = runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'production' });
            const reasons = result.warnings.filter((w) => w.noteId === 'published-note').map((w) => w.reason);
            assert.ok(reasons.includes('links-to-unpublished'));
            assert.ok(reasons.includes('broken-link'));
        });

        test('an unclosed [[ illustrating trigger syntax in prose does not swallow the rest of the note as a broken link', () => {
            // Reproduces sample/welcome.md: "Type `[[` anywhere to trigger
            // autocomplete." has no closing ]] on its own line. Without the
            // no-newline-in-capture-group fix, the regex hunts forward across
            // paragraphs for the next ]] anywhere and treats everything in
            // between as one giant broken-link target.
            const notePath = writeNote(vaultDir, 'tutorial-note.md',
                '---\nid: tutorial-note\ntype: article\nstatus: published\n---\n' +
                'Type `[[` anywhere to trigger autocomplete.\n\n' +
                'Some other unrelated paragraph of real prose here.\n\n' +
                'A real link: [[published-note]].\n');
            const idIndex = new Map([['tutorial-note', notePath], ...buildFixture().idIndex]);
            const fieldsCache = new Map([['tutorial-note', { id: 'tutorial-note', type: 'article', status: 'published' }], ...buildFixture().fieldsCache]);

            const result = runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'production' });
            const tutorialWarnings = result.warnings.filter((w) => w.noteId === 'tutorial-note');
            assert.equal(tutorialWarnings.length, 0);

            const payload = JSON.parse(fs.readFileSync(path.join(outDir, 'notes', 'article', 'tutorial-note.json'), 'utf8'));
            assert.ok(payload.body.includes('Some other unrelated paragraph of real prose here.'));
            assert.ok(payload.body.includes('[published-note](/published-note).'));
        });

        test('redirect map is built from a declared previous_ids field', () => {
            const notePath = writeNote(vaultDir, 'renamed-note.md',
                '---\nid: renamed-note\ntype: article\nstatus: published\nprevious_ids: old-note-slug\n---\nBody.\n');
            const idIndex = new Map([['renamed-note', notePath]]);
            const fieldsCache = new Map([['renamed-note', { id: 'renamed-note', type: 'article', status: 'published', previous_ids: 'old-note-slug' }]]);

            const result = runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'production' });
            assert.equal(result.redirectCount, 1);
            const redirects = JSON.parse(fs.readFileSync(path.join(outDir, 'redirects.json'), 'utf8'));
            assert.equal(redirects['old-note-slug'], 'renamed-note');
        });

        test('!view blocks resolve to a static Markdown table snapshot, not live query syntax', () => {
            // runQuery() reads the process-global idIndex/fieldsCache from
            // core/index.js, not the local Maps runBuild is given — a real
            // vault (via buildIndex()) is required here, not fixture Maps.
            const vault = createVault({
                'unit-alpha.md': '---\nid: unit-alpha\ntype: unit\nstatus: published\nname: Alpha\n---\nAn alpha unit.\n',
                'hub-note.md': '---\nid: hub-note\ntype: article\nstatus: published\n---\nUnits:\n\n!view unit\nwhere type = unit\n\nDone.\n'
            });
            try {
                runBuild({ idIndex: vault.idIndex, fieldsCache: vault.fieldsCache, vaultGeneration: 1, outDir, mode: 'production' });
                const payload = JSON.parse(fs.readFileSync(path.join(outDir, 'notes', 'article', 'hub-note.json'), 'utf8'));
                assert.ok(!payload.body.includes('!view'));
                assert.ok(payload.body.includes('|'));
            } finally {
                vault.destroy();
            }
        });

        test('a second build with an unchanged generation is a no-op skip', () => {
            const { idIndex, fieldsCache } = buildFixture();
            runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'production' });
            const second = runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'production' });
            assert.equal(second.skipped, true);
        });

        test('--force bypasses the generation cache and rebuilds', () => {
            const { idIndex, fieldsCache } = buildFixture();
            runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'production' });
            const forced = runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'production', force: true });
            assert.equal(forced.skipped, false);
        });

        test('a note that flips from published to draft is removed from output on the next build', () => {
            const { idIndex, fieldsCache } = buildFixture();
            runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'production' });
            assert.ok(fs.existsSync(path.join(outDir, 'notes', 'article', 'published-note.json')));

            fieldsCache.set('published-note', { id: 'published-note', type: 'article', status: 'draft', title: 'Published Note' });
            const result = runBuild({ idIndex, fieldsCache, vaultGeneration: 2, outDir, mode: 'production' });
            assert.equal(result.notesRemoved, 1);
            assert.ok(!fs.existsSync(path.join(outDir, 'notes', 'article', 'published-note.json')));
        });

        test('sitemap.xml and feed.xml are only written when a siteUrl is given', () => {
            const { idIndex, fieldsCache } = buildFixture();
            runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'production' });
            assert.ok(!fs.existsSync(path.join(outDir, 'sitemap.xml')));

            const withSite = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-build-out-site-'));
            try {
                runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir: withSite, mode: 'production', siteUrl: 'https://example.com' });
                assert.ok(fs.existsSync(path.join(withSite, 'sitemap.xml')));
                const sitemap = fs.readFileSync(path.join(withSite, 'sitemap.xml'), 'utf8');
                assert.ok(sitemap.includes('https://example.com/published-note'));
            } finally {
                fs.rmSync(withSite, { recursive: true, force: true });
            }
        });

        test('search index includes an excerpt for every publishable note', () => {
            const { idIndex, fieldsCache } = buildFixture();
            runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'production' });
            const searchIndex = JSON.parse(fs.readFileSync(path.join(outDir, 'search-index.json'), 'utf8'));
            const entry = searchIndex.find((e) => e.id === 'published-note');
            assert.ok(entry);
            assert.ok(entry.excerpt.length > 0);
        });

        test('a referenced local image is copied into assets/<slug>/ and the body reference rewritten', () => {
            const imagePath = path.join(vaultDir, 'diagram.png');
            fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
            const notePath = writeNote(vaultDir, 'note-with-image.md',
                '---\nid: note-with-image\ntype: article\nstatus: published\n---\n![a diagram](diagram.png)\n');
            const idIndex = new Map([['note-with-image', notePath]]);
            const fieldsCache = new Map([['note-with-image', { id: 'note-with-image', type: 'article', status: 'published' }]]);

            runBuild({ idIndex, fieldsCache, vaultGeneration: 1, outDir, mode: 'production' });
            const payload = JSON.parse(fs.readFileSync(path.join(outDir, 'notes', 'article', 'note-with-image.json'), 'utf8'));
            assert.deepEqual(payload.assets, ['/assets/note-with-image/diagram.png']);
            assert.ok(payload.body.includes('(/assets/note-with-image/diagram.png)'));
            assert.ok(fs.existsSync(path.join(outDir, 'assets', 'note-with-image', 'diagram.png')));
        });
    });
});
