'use strict';

// x-graph time-lapse — git-backed historical reconstruction.
//
// The mutation-log-based path (graphTimelapse.js) can only ever reconstruct
// frontmatter field values, because the mutation log never records body
// text — by design, it's a delta log of field changes, not a snapshot store.
// For a git-tracked vault, real historical file content (frontmatter AND
// body) already exists in git history. This module reconstructs each
// checkpoint from the actual historical file content at the nearest commit,
// running it through the exact same raw-text edge extraction the *live*
// graph already uses (extractEdgesFromFrontmatterRaw/extractBodyLinksRaw) —
// so historical frames get real body-mention edges too, not just
// frontmatter-declared relations.

const path = require('path');
const { isGitRepo, getMdFiles, getGitLog, getFileAtCommit } = require('../../intelligence/gitHistoryImport');
const {
    parseFrontmatter,
    extractEdgesFromFrontmatterRaw,
    extractBodyLinksRaw,
    extractAliasesFromFields,
    resolveRawEdges
} = require('../../core/indexService');
const { extractCanonicalIdFromFrontmatter, canonicalizeId } = require('../../core/id');
const { getPrimaryWorkspaceRoot } = require('../../core/workspace');
const { xgKind } = require('./graphPayload');

const DEFAULT_FRAME_COUNT = 14;
const MAX_COMMITS_PER_FILE = 300;

/**
 * Lazily requires vscode — this module must stay requireable from non-VS
 * Code callers (tests, CLI) even though this one function needs the live
 * workspace folders, since graphTimelapse.js (which is used well outside a
 * running VS Code host) requires this module unconditionally.
 * @returns {string|null}
 */
function getGitTimelapseRoot() {
    try {
        const vscode = require('vscode');
        return getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
    } catch (_) {
        return null;
    }
}

/** @param {string|null} root @returns {boolean} */
function isGitTimelapseAvailable(root) {
    return !!root && isGitRepo(root);
}

/**
 * One `git log` call per file, once — not per checkpoint. Checkpoints then
 * do an in-memory lookup against this instead of re-invoking git.
 * @returns {Map<string, Array<{hash: string, timestamp: string}>>} relPath -> commits, oldest first
 */
function loadPerFileHistories(root, maxCommitsPerFile = MAX_COMMITS_PER_FILE) {
    const files = getMdFiles(root);
    const histories = new Map();
    for (const relPath of files) {
        const commits = getGitLog(root, relPath, maxCommitsPerFile);
        if (commits.length) histories.set(relPath, commits);
    }
    return histories;
}

/**
 * @param {Array<{hash: string, timestamp: string}>} commits oldest first
 * @param {number} targetMs
 * @returns {{hash: string, timestamp: string}|null}
 */
function findCommitAtOrBefore(commits, targetMs) {
    let result = null;
    for (const c of commits) {
        const t = Date.parse(c.timestamp);
        if (!Number.isFinite(t)) continue;
        if (t <= targetMs) result = c;
        else break;
    }
    return result;
}

/**
 * @param {Map<string, Array<{hash: string, timestamp: string}>>} perFileHistories
 * @param {string} nowIso
 * @param {number} [frameCount]
 * @returns {string[]}
 */
function pickGitCheckpointTimestamps(perFileHistories, nowIso, frameCount = DEFAULT_FRAME_COUNT) {
    let earliestMs = null;
    for (const commits of perFileHistories.values()) {
        if (!commits.length) continue;
        const t = Date.parse(commits[0].timestamp);
        if (Number.isFinite(t) && (earliestMs === null || t < earliestMs)) earliestMs = t;
    }
    if (earliestMs === null) return [];

    const nowMs = Date.parse(nowIso);
    if (!Number.isFinite(nowMs) || nowMs <= earliestMs) return [nowIso];

    const count = Math.max(2, frameCount);
    const span = nowMs - earliestMs;
    const out = [];
    for (let i = 0; i < count; i++) {
        out.push(new Date(earliestMs + (span * i) / (count - 1)).toISOString());
    }
    return out;
}

/**
 * Reconstructs one frame's node/edge set from real historical file content —
 * both frontmatter relations AND body-text mentions, since both come from
 * the same raw text the live graph itself would have scanned at that commit.
 *
 * @param {string} timestamp
 * @param {{ root: string, perFileHistories: Map<string, object[]>, contentCache: Map<string, string|null> }} ctx
 * @returns {{ timestamp: string, nodes: object[], edges: object[], incomplete: boolean }}
 */
function buildGitTimelapseFrame(timestamp, { root, perFileHistories, contentCache }) {
    const targetMs = Date.parse(timestamp);

    const fileInfos = [];
    for (const [relPath, commits] of perFileHistories) {
        const commit = findCommitAtOrBefore(commits, targetMs);
        if (!commit) continue; // didn't exist yet at this timestamp

        const cacheKey = commit.hash + '|' + relPath;
        let content = contentCache.get(cacheKey);
        if (content === undefined) {
            content = getFileAtCommit(root, commit.hash, relPath);
            contentCache.set(cacheKey, content);
        }
        if (content === null) continue; // deleted, or git show failed

        const fields = parseFrontmatter(content);
        if (!fields) continue;

        const id = extractCanonicalIdFromFrontmatter(content) || canonicalizeId(path.basename(relPath, '.md'));
        if (!id) continue;

        fileInfos.push({ relPath, id, fields, content });
    }

    // Dedup by id — if two files somehow resolve to the same id at this
    // point in history, keep the first one encountered.
    const seenIds = new Set();
    const infos = [];
    for (const f of fileInfos) {
        if (seenIds.has(f.id)) continue;
        seenIds.add(f.id);
        infos.push(f);
    }

    const idIndex = new Map(infos.map((f) => [f.id, f.relPath]));
    const aliasIndex = new Map();
    for (const f of infos) {
        for (const alias of extractAliasesFromFields(f.fields)) {
            if (!aliasIndex.has(alias)) aliasIndex.set(alias, f.id);
        }
    }

    const nodes = infos.map((f) => ({
        id: f.id,
        label: String(f.fields.name || f.fields.title || f.id),
        kind: xgKind(f.fields.type),
        group: f.fields.type || 'default',
        type: f.fields.type || null,
        weight: 0,
        edges: []
    }));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const edges = [];
    for (const f of infos) {
        const rawEdges = [
            ...extractEdgesFromFrontmatterRaw(f.content),
            ...extractBodyLinksRaw(f.content)
        ];
        const resolved = resolveRawEdges(rawEdges, f.id, idIndex, aliasIndex);
        for (const e of resolved) {
            if (!nodeById.has(e.targetId)) continue;
            edges.push({
                id: `${f.id}->${e.targetId}->${e.field}`,
                source: f.id,
                target: e.targetId,
                field: e.field,
                weight: e.field === 'body' ? 0.6 : 1,
                strength: e.field === 'body' ? 'weak' : 'medium',
                directed: true
            });
        }
    }

    const degree = new Map();
    for (const e of edges) {
        degree.set(e.source, (degree.get(e.source) || 0) + 1);
        degree.set(e.target, (degree.get(e.target) || 0) + 1);
        nodeById.get(e.source).edges.push({ source: e.source, target: e.target });
        nodeById.get(e.target).edges.push({ source: e.source, target: e.target });
    }
    for (const n of nodes) n.weight = Math.min(1, (degree.get(n.id) || 0) / 12);

    return { timestamp, nodes, edges, incomplete: false };
}

/**
 * @param {{ frameCount?: number, now?: string, root?: string, maxCommitsPerFile?: number }} [options]
 * @returns {{ frames: object[], earliest: string|null, latest: string|null, source: 'git' }|null} null if git isn't available for this vault
 */
function buildGitTimelapseSequence(options = {}) {
    const root = options.root || getGitTimelapseRoot();
    if (!isGitTimelapseAvailable(root)) return null;

    const frameCount = Number.isFinite(options.frameCount) ? options.frameCount : DEFAULT_FRAME_COUNT;
    const now = options.now || new Date().toISOString();
    const perFileHistories = loadPerFileHistories(root, options.maxCommitsPerFile);
    const timestamps = pickGitCheckpointTimestamps(perFileHistories, now, frameCount);
    if (!timestamps.length) return { frames: [], earliest: null, latest: null, source: 'git' };

    const contentCache = new Map();
    const frames = timestamps.map((ts) => buildGitTimelapseFrame(ts, { root, perFileHistories, contentCache }));

    // A vault-wide time-lapse's very first frame should read as genuinely
    // empty — growing from nothing — not "whatever happened to already exist
    // at the earliest real checkpoint." That earliest checkpoint can itself
    // contain many notes at once if they were all added in one initial
    // commit, which is common (a vault imported/scaffolded all at once).
    // Prepending a real empty frame makes the opening state unambiguous and
    // makes the first real transition (0 -> N notes) an obvious, undeniable
    // reveal instead of a near-imperceptible one.
    const emptyFrame = { timestamp: timestamps[0], nodes: [], edges: [], incomplete: false };

    return {
        frames: [emptyFrame, ...frames],
        earliest: timestamps[0] || null,
        latest: timestamps[timestamps.length - 1] || null,
        source: 'git'
    };
}

module.exports = {
    isGitTimelapseAvailable,
    getGitTimelapseRoot,
    loadPerFileHistories,
    findCommitAtOrBefore,
    pickGitCheckpointTimestamps,
    buildGitTimelapseFrame,
    buildGitTimelapseSequence
};
