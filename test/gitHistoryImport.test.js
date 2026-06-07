'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Check git availability once at module load.
let gitAvailable = false;
try {
    execFileSync('git', ['--version'], { stdio: 'pipe', timeout: 3000 });
    gitAvailable = true;
} catch (_) {}

const {
    isGitRepo,
    isImportDone,
    markImportDone,
    getMdFiles,
    diffFrontmatters,
    runGitHistoryImport
} = require('../src/intelligence/gitHistoryImport');

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-git-'));
}

function gitInit(dir) {
    execFileSync('git', ['init', dir], { stdio: 'pipe' });
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@yamlink.local'], { stdio: 'pipe' });
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'Yamlink Test'], { stdio: 'pipe' });
}

function gitCommit(dir, filename, content, message = 'update') {
    const filePath = path.join(dir, ...filename.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    execFileSync('git', ['-C', dir, 'add', '--', filename], { stdio: 'pipe' });
    execFileSync('git', ['-C', dir, 'commit', '-m', message], { stdio: 'pipe' });
}

describe('gitHistoryImport — pure helpers', () => {
    let tempDir;

    beforeEach(() => { tempDir = makeTempDir(); });
    afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

    test('isGitRepo returns false for plain directory', () => {
        assert.equal(isGitRepo(tempDir), false);
    });

    test('isImportDone returns false when guard file absent', () => {
        assert.equal(isImportDone(tempDir), false);
    });

    test('markImportDone creates guard file', () => {
        markImportDone(tempDir);
        assert.equal(isImportDone(tempDir), true);
    });

    test('markImportDone is idempotent', () => {
        markImportDone(tempDir);
        markImportDone(tempDir);
        assert.equal(isImportDone(tempDir), true);
    });

    test('getMdFiles returns markdown files and skips excluded dirs', () => {
        fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, '.yamlink'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, 'notes'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'a.md'), '# A');
        fs.writeFileSync(path.join(tempDir, 'notes', 'b.md'), '# B');
        fs.writeFileSync(path.join(tempDir, '.git', 'config'), 'git stuff');
        fs.writeFileSync(path.join(tempDir, '.yamlink', 'mutation-log.ndjson'), '');
        fs.writeFileSync(path.join(tempDir, 'readme.txt'), 'ignored');

        const files = getMdFiles(tempDir);
        assert.equal(files.length, 2);
        assert.ok(files.includes('a.md'));
        assert.ok(files.some(f => f.endsWith('b.md')));
    });

    test('getMdFiles skips _templates directory', () => {
        fs.mkdirSync(path.join(tempDir, '_templates'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'note.md'), '# note');
        fs.writeFileSync(path.join(tempDir, '_templates', 'character.md'), '# template');

        const files = getMdFiles(tempDir);
        assert.equal(files.length, 1);
        assert.equal(files[0], 'note.md');
    });
});

describe('diffFrontmatters', () => {
    test('emits note_created and type_set when previous is null', () => {
        const events = diffFrontmatters(null, { type: 'character', name: 'Rico' }, 'johnny-rico', '2024-01-01T00:00:00Z');
        const types = events.map(e => e.type);
        assert.ok(types.includes('note_created'));
        assert.ok(types.includes('type_set'));
        assert.ok(types.includes('field_added'));
    });

    test('note_created event has correct shape', () => {
        const events = diffFrontmatters(null, { type: 'character' }, 'rico', '2024-01-01T00:00:00Z');
        const ev = events.find(e => e.type === 'note_created');
        assert.equal(ev.noteId, 'rico');
        assert.equal(ev.timestamp, '2024-01-01T00:00:00Z');
    });

    test('type_set carries old and new values', () => {
        const events = diffFrontmatters({ type: 'draft' }, { type: 'character' }, 'rico', '2024-02-01T00:00:00Z');
        const ev = events.find(e => e.type === 'type_set');
        assert.ok(ev);
        assert.equal(ev.oldValue, 'draft');
        assert.equal(ev.newValue, 'character');
    });

    test('emits field_added when new field appears', () => {
        const events = diffFrontmatters(
            { type: 'character' },
            { type: 'character', rank: 'lieutenant' },
            'rico', '2024-03-01T00:00:00Z'
        );
        const ev = events.find(e => e.type === 'field_added' && e.field === 'rank');
        assert.ok(ev);
        assert.equal(ev.newValue, 'lieutenant');
    });

    test('emits field_removed when field disappears', () => {
        const events = diffFrontmatters(
            { type: 'character', rank: 'private' },
            { type: 'character' },
            'rico', '2024-03-02T00:00:00Z'
        );
        const ev = events.find(e => e.type === 'field_removed' && e.field === 'rank');
        assert.ok(ev);
        assert.equal(ev.oldValue, 'private');
    });

    test('emits field_changed for scalar value change', () => {
        const events = diffFrontmatters(
            { type: 'character', status: 'active' },
            { type: 'character', status: 'retired' },
            'rico', '2024-04-01T00:00:00Z'
        );
        const ev = events.find(e => e.type === 'field_changed' && e.field === 'status');
        assert.ok(ev);
        assert.equal(ev.oldValue, 'active');
        assert.equal(ev.newValue, 'retired');
    });

    test('emits relation_changed when wikilink target changes', () => {
        const events = diffFrontmatters(
            { type: 'character', unit: '[[roughnecks]]' },
            { type: 'character', unit: '[[marauders]]' },
            'rico', '2024-05-01T00:00:00Z'
        );
        const ev = events.find(e => e.type === 'relation_changed' && e.field === 'unit');
        assert.ok(ev);
    });

    test('does not emit events for id or type fields as field_added', () => {
        const events = diffFrontmatters(null, { id: 'rico', type: 'character' }, 'rico', '2024-01-01T00:00:00Z');
        assert.ok(!events.some(e => e.type === 'field_added' && e.field === 'id'));
        assert.ok(!events.some(e => e.type === 'field_added' && e.field === 'type'));
    });

    test('returns empty array when currFields is null', () => {
        const events = diffFrontmatters({ type: 'character' }, null, 'rico', '2024-01-01T00:00:00Z');
        assert.equal(events.length, 0);
    });

    test('returns empty array when noteId is empty', () => {
        const events = diffFrontmatters(null, { type: 'character' }, '', '2024-01-01T00:00:00Z');
        assert.equal(events.length, 0);
    });

    test('does not emit note_created when previous fields exist', () => {
        const events = diffFrontmatters({ type: 'character' }, { type: 'character', rank: 'captain' }, 'rico', '2024-01-01T00:00:00Z');
        assert.ok(!events.some(e => e.type === 'note_created'));
    });
});

describe('runGitHistoryImport — non-git cases', () => {
    let tempDir;

    beforeEach(() => { tempDir = makeTempDir(); });
    afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

    test('returns not-a-git-repo for plain directory', () => {
        const result = runGitHistoryImport(tempDir, { appendEvents: () => {} });
        assert.equal(result.skipped, true);
        assert.equal(result.reason, 'not-a-git-repo');
    });

    test('returns already-done when guard file exists', () => {
        if (!gitAvailable) return;
        gitInit(tempDir);
        markImportDone(tempDir);
        const result = runGitHistoryImport(tempDir, { appendEvents: () => {} });
        assert.equal(result.skipped, true);
        assert.equal(result.reason, 'already-done');
    });
});

describe('runGitHistoryImport — git integration', () => {
    let tempDir;

    beforeEach(() => {
        if (!gitAvailable) return;
        tempDir = makeTempDir();
        gitInit(tempDir);
    });

    afterEach(() => {
        if (!tempDir) return;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('imports note_created and type_set from git history', () => {
        if (!gitAvailable) return;

        gitCommit(tempDir, 'rico.md', '---\ntype: character\nname: Rico\n---\n', 'add rico');

        const allEvents = [];
        const result = runGitHistoryImport(tempDir, {
            appendEvents: events => allEvents.push(...events)
        });

        assert.equal(result.skipped, false);
        assert.ok(result.filesProcessed >= 1);
        assert.ok(allEvents.some(e => e.type === 'note_created' && e.noteId === 'rico'));
        assert.ok(allEvents.some(e => e.type === 'type_set' && e.newValue === 'character'));
    });

    test('imports field_added event across commits', () => {
        if (!gitAvailable) return;

        gitCommit(tempDir, 'rico.md', '---\nid: rico\ntype: character\n---\n', 'create');
        gitCommit(tempDir, 'rico.md', '---\nid: rico\ntype: character\nrank: lieutenant\n---\n', 'add rank');

        const allEvents = [];
        runGitHistoryImport(tempDir, { appendEvents: events => allEvents.push(...events) });

        assert.ok(allEvents.some(e => e.type === 'field_added' && e.field === 'rank' && e.newValue === 'lieutenant'));
    });

    test('writes guard file on completion', () => {
        if (!gitAvailable) return;

        gitCommit(tempDir, 'a.md', '# No frontmatter', 'init');
        runGitHistoryImport(tempDir, { appendEvents: () => {} });
        assert.equal(isImportDone(tempDir), true);
    });

    test('calls onProgress callback for each file', () => {
        if (!gitAvailable) return;

        gitCommit(tempDir, 'a.md', '---\nid: a\ntype: note\n---\n', 'init');
        gitCommit(tempDir, 'b.md', '---\nid: b\ntype: note\n---\n', 'init b');

        const progressCalls = [];
        runGitHistoryImport(tempDir, {
            appendEvents: () => {},
            onProgress: info => progressCalls.push(info)
        });

        assert.ok(progressCalls.length >= 2);
    });

    test('handles files with no frontmatter without error', () => {
        if (!gitAvailable) return;

        gitCommit(tempDir, 'plain.md', '# Just a heading\n\nNo frontmatter here.', 'plain file');

        const allEvents = [];
        const result = runGitHistoryImport(tempDir, { appendEvents: events => allEvents.push(...events) });

        assert.equal(result.skipped, false);
        assert.equal(result.filesProcessed, 1);
        assert.equal(allEvents.length, 0);
    });

    test('uses filename as noteId when id: field is absent', () => {
        if (!gitAvailable) return;

        gitCommit(tempDir, 'johnny-rico.md', '---\ntype: character\n---\n', 'create');

        const allEvents = [];
        runGitHistoryImport(tempDir, { appendEvents: events => allEvents.push(...events) });

        assert.ok(allEvents.some(e => e.noteId === 'johnny-rico'));
    });

    test('respects maxCommitsPerFile limit', () => {
        if (!gitAvailable) return;

        // Create 5 commits for one file
        for (let i = 1; i <= 5; i++) {
            gitCommit(tempDir, 'note.md', `---\nid: note\ntype: note\nrev: ${i}\n---\n`, `rev ${i}`);
        }

        const allEvents = [];
        runGitHistoryImport(tempDir, {
            appendEvents: events => allEvents.push(...events),
            maxCommitsPerFile: 2
        });

        // With limit=2 we only process the 2 oldest commits, so field_changed from rev 3+ not present
        const revChanges = allEvents.filter(e => e.type === 'field_changed' && e.field === 'rev');
        assert.ok(revChanges.length <= 1); // at most 1 change between the 2 oldest commits
    });
});
