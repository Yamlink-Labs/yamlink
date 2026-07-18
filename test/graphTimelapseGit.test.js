'use strict';

// Real git integration tests for the git-backed x-graph time-lapse
// reconstruction. Unlike graphTimelapse.js's mutation-log-based path, this
// one can reconstruct BOTH frontmatter relations AND body-text [[mentions]] —
// the whole point of this module, since the mutation log has never recorded
// body text.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// graphTimelapseGit.js requires 'vscode' (only used by getGitTimelapseRoot(),
// which none of these tests exercise — they pass `root` explicitly) — stub
// it minimally so the require doesn't fail outside a real VS Code host.
const Module = require('module');
const originalResolveFilename = Module._resolveFilename.bind(Module);
Module._resolveFilename = (request, parent, ...rest) => {
    if (request === 'vscode') return '__stub_vscode_gtl__';
    return originalResolveFilename(request, parent, ...rest);
};
require.cache.__stub_vscode_gtl__ = {
    id: '__stub_vscode_gtl__',
    filename: '__stub_vscode_gtl__',
    loaded: true,
    exports: { workspace: { workspaceFolders: [] } }
};

let gitAvailable = false;
try {
    execFileSync('git', ['--version'], { stdio: 'pipe', timeout: 3000 });
    gitAvailable = true;
} catch (_) {}

const {
    isGitTimelapseAvailable,
    loadPerFileHistories,
    findCommitAtOrBefore,
    pickGitCheckpointTimestamps,
    buildGitTimelapseFrame,
    buildGitTimelapseSequence
} = require('../src/features/graph/graphTimelapseGit');

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-gtl-'));
}

function gitInit(dir) {
    execFileSync('git', ['init', dir], { stdio: 'pipe' });
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@yamlink.local'], { stdio: 'pipe' });
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'Yamlink Test'], { stdio: 'pipe' });
}

// Controls the commit's authored/committed date deterministically, so
// checkpoint math is testable rather than depending on wall-clock time.
function gitCommitAt(dir, filename, content, isoDate, message = 'update') {
    const filePath = path.join(dir, ...filename.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    execFileSync('git', ['-C', dir, 'add', '--', filename], { stdio: 'pipe' });
    execFileSync('git', ['-C', dir, 'commit', '-m', message], {
        stdio: 'pipe',
        env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate }
    });
}

describe('graphTimelapseGit', () => {
    let dir;

    beforeEach(() => {
        if (!gitAvailable) return;
        dir = makeTempDir();
        gitInit(dir);
    });

    afterEach(() => {
        if (!dir) return;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('isGitTimelapseAvailable is false for a plain (non-git) directory', () => {
        const plain = makeTempDir();
        assert.equal(isGitTimelapseAvailable(plain), false);
        fs.rmSync(plain, { recursive: true, force: true });
    });

    test('isGitTimelapseAvailable is true for a real git repo', () => {
        if (!gitAvailable) return;
        assert.equal(isGitTimelapseAvailable(dir), true);
    });

    test('findCommitAtOrBefore picks the newest commit not after the target time', () => {
        const commits = [
            { hash: 'a', timestamp: '2026-01-01T00:00:00Z' },
            { hash: 'b', timestamp: '2026-02-01T00:00:00Z' },
            { hash: 'c', timestamp: '2026-03-01T00:00:00Z' }
        ];
        assert.equal(findCommitAtOrBefore(commits, Date.parse('2026-01-15T00:00:00Z')).hash, 'a');
        assert.equal(findCommitAtOrBefore(commits, Date.parse('2026-02-15T00:00:00Z')).hash, 'b');
        assert.equal(findCommitAtOrBefore(commits, Date.parse('2026-04-01T00:00:00Z')).hash, 'c');
        assert.equal(findCommitAtOrBefore(commits, Date.parse('2025-12-01T00:00:00Z')), null);
    });

    test('pickGitCheckpointTimestamps spans from the earliest commit across all files to now', () => {
        const histories = new Map([
            ['a.md', [{ hash: 'a1', timestamp: '2026-01-01T00:00:00Z' }]],
            ['b.md', [{ hash: 'b1', timestamp: '2026-02-01T00:00:00Z' }]]
        ]);
        const now = '2026-03-01T00:00:00Z';
        const result = pickGitCheckpointTimestamps(histories, now, 5);
        assert.equal(result.length, 5);
        assert.equal(result[0], '2026-01-01T00:00:00.000Z');
        assert.equal(result[result.length - 1], new Date(now).toISOString());
    });

    test('reconstructs a body-text [[mention]] edge from real historical file content — the core of this fix', () => {
        if (!gitAvailable) return;
        gitCommitAt(dir, 'a.md', '---\nid: a\ntype: note\n---\nSee [[b]] for details.\n', '2026-01-01T00:00:00Z', 'add a mentioning b');
        gitCommitAt(dir, 'b.md', '---\nid: b\ntype: note\n---\n', '2026-01-01T00:00:01Z', 'add b');

        const histories = loadPerFileHistories(dir);
        const contentCache = new Map();
        const frame = buildGitTimelapseFrame(new Date().toISOString(), { root: dir, perFileHistories: histories, contentCache });

        assert.equal(frame.nodes.length, 2);
        const bodyEdge = frame.edges.find((e) => e.field === 'body');
        assert.ok(bodyEdge, 'expected a body-text mention edge — this is the whole point of the git-based path');
        assert.equal(bodyEdge.source, 'a');
        assert.equal(bodyEdge.target, 'b');
    });

    test('reconstructs a frontmatter relation edge too, same as the mutation-log path', () => {
        if (!gitAvailable) return;
        gitCommitAt(dir, 'a.md', '---\nid: a\ntype: note\nmentor: [[b]]\n---\n', '2026-01-01T00:00:00Z', 'add a');
        gitCommitAt(dir, 'b.md', '---\nid: b\ntype: note\n---\n', '2026-01-01T00:00:01Z', 'add b');

        const histories = loadPerFileHistories(dir);
        const contentCache = new Map();
        const frame = buildGitTimelapseFrame(new Date().toISOString(), { root: dir, perFileHistories: histories, contentCache });

        const mentorEdge = frame.edges.find((e) => e.field === 'mentor');
        assert.ok(mentorEdge);
        assert.equal(mentorEdge.source, 'a');
        assert.equal(mentorEdge.target, 'b');
    });

    test('a note that did not exist yet at the target timestamp is excluded', () => {
        if (!gitAvailable) return;
        gitCommitAt(dir, 'a.md', '---\nid: a\ntype: note\n---\n', '2026-01-01T00:00:00Z', 'add a');
        gitCommitAt(dir, 'b.md', '---\nid: b\ntype: note\n---\n', '2026-06-01T00:00:00Z', 'add b, much later');

        const histories = loadPerFileHistories(dir);
        const contentCache = new Map();
        const earlyFrame = buildGitTimelapseFrame('2026-03-01T00:00:00.000Z', { root: dir, perFileHistories: histories, contentCache });

        assert.equal(earlyFrame.nodes.length, 1);
        assert.equal(earlyFrame.nodes[0].id, 'a');
    });

    test('a deleted note stops appearing in frames after its deletion commit', () => {
        if (!gitAvailable) return;
        gitCommitAt(dir, 'a.md', '---\nid: a\ntype: note\n---\n', '2026-01-01T00:00:00Z', 'add a');
        execFileSync('git', ['-C', dir, 'rm', 'a.md'], { stdio: 'pipe' });
        execFileSync('git', ['-C', dir, 'commit', '-m', 'remove a'], {
            stdio: 'pipe',
            env: { ...process.env, GIT_AUTHOR_DATE: '2026-06-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-06-01T00:00:00Z' }
        });

        const histories = loadPerFileHistories(dir);
        const contentCache = new Map();
        const laterFrame = buildGitTimelapseFrame('2026-07-01T00:00:00.000Z', { root: dir, perFileHistories: histories, contentCache });
        assert.equal(laterFrame.nodes.length, 0);
    });

    test('buildGitTimelapseSequence returns null for a non-git vault (caller should fall back)', () => {
        const plain = makeTempDir();
        const result = buildGitTimelapseSequence({ root: plain });
        assert.equal(result, null);
        fs.rmSync(plain, { recursive: true, force: true });
    });

    test('buildGitTimelapseSequence builds a real frame sequence end to end, tagged source: git', () => {
        if (!gitAvailable) return;
        gitCommitAt(dir, 'a.md', '---\nid: a\ntype: note\n---\nMentions [[b]] in prose.\n', '2026-01-01T00:00:00Z', 'add a');
        gitCommitAt(dir, 'b.md', '---\nid: b\ntype: note\n---\n', '2026-02-01T00:00:00Z', 'add b');

        const result = buildGitTimelapseSequence({ root: dir, frameCount: 4, now: '2026-03-01T00:00:00.000Z' });
        assert.equal(result.source, 'git');
        // frameCount real checkpoints, PLUS one prepended synthetic empty
        // frame — see the next test for why.
        assert.equal(result.frames.length, 5);
        const last = result.frames[result.frames.length - 1];
        assert.equal(last.nodes.length, 2);
        assert.ok(last.edges.some((e) => e.field === 'body'));
    });

    test('the very first frame is genuinely empty, even though the earliest real commit already added a note', () => {
        // The real bug this closes: a note added in the vault's very first
        // commit would otherwise make the "earliest checkpoint" already
        // contain it — a vault-wide time-lapse should always open on an
        // empty canvas and grow from there, not from "whatever happened to
        // exist at the first commit" (which can itself be many notes at
        // once, e.g. an imported/scaffolded vault).
        if (!gitAvailable) return;
        gitCommitAt(dir, 'a.md', '---\nid: a\ntype: note\n---\n', '2026-01-01T00:00:00Z', 'add a');

        const result = buildGitTimelapseSequence({ root: dir, frameCount: 2, now: '2026-02-01T00:00:00.000Z' });
        assert.equal(result.frames[0].nodes.length, 0);
        assert.equal(result.frames[0].edges.length, 0);
        assert.ok(result.frames[result.frames.length - 1].nodes.length >= 1);
    });
});
