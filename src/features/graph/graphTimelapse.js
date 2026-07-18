'use strict';

// x-graph time-lapse — precomputes a bounded sequence of real historical graph
// snapshots so the webview can animate through vault growth. Reconstruction is
// in-process (reconstructVaultAtTime/buildHistoricalGraph from core/timeEngine),
// same primitives the `?at=` API endpoint uses — never through the HTTP API
// itself, since the webview's CSP has no connect-src and the extension host
// already holds the live index in memory. The whole sequence is computed once,
// up front, on demand (not per animation frame) since a single reconstruction
// is O(total mutation events).

const { getFieldsCache, getIndex, getAliasIndex, getBodyLinksCache, extractAndResolveRelationTargets } = require('../../core/indexService');
const { getMutationEvents, getVaultSnapshots } = require('../../runtime/mutationEventLog');
const { reconstructVaultAtTime, buildHistoricalGraph } = require('../../core/timeEngine');
const { xgKind } = require('./graphPayload');
const { buildGitTimelapseSequence } = require('./graphTimelapseGit');

const DEFAULT_FRAME_COUNT = 14;
const MIN_FRAME_COUNT = 2;

/**
 * Evenly-spaced ISO timestamps between the earliest recorded mutation event
 * and `nowIso`, inclusive. Deliberately NOT restricted to real event
 * boundaries — reconstructVaultAtTime can answer at any arbitrary instant,
 * and even sampling produces a steadier time-lapse than clustering frames
 * around whichever moments happened to have edits.
 *
 * @param {Array<{timestamp: string}>} mutationEvents
 * @param {string} nowIso
 * @param {number} [frameCount]
 * @returns {string[]}
 */
function pickCheckpointTimestamps(mutationEvents, nowIso, frameCount = DEFAULT_FRAME_COUNT) {
    const timestamps = (mutationEvents || []).map((e) => e && e.timestamp).filter(Boolean);
    if (!timestamps.length) return [];

    const earliestMs = Date.parse(timestamps.reduce((a, b) => (a < b ? a : b)));
    const nowMs = Date.parse(nowIso);
    if (!Number.isFinite(earliestMs) || !Number.isFinite(nowMs) || nowMs <= earliestMs) {
        return [nowIso];
    }

    const count = Math.max(MIN_FRAME_COUNT, Math.min(frameCount, timestamps.length + 1));
    const span = nowMs - earliestMs;
    const out = [];
    for (let i = 0; i < count; i++) {
        out.push(new Date(earliestMs + (span * i) / (count - 1)).toISOString());
    }
    return out;
}

/**
 * Reconstructs one frame's node/edge set in the same shape x-graph's live
 * payload already uses (graphPayload.js's buildXGraphData output) so the
 * webview's existing renderer/layout code needs no format-specific branching.
 *
 * @param {string} timestamp
 * @param {{ fieldsCache: Map<string, object>, mutationEvents: object[], snapshots?: object[], bodyLinksCache?: Map<string, string>, idIndex?: Map<string, any>, aliasIndex?: Map<string, string> }} ctx
 * @returns {{ timestamp: string, nodes: object[], edges: object[], incomplete: boolean }}
 */
function buildTimelapseFrame(timestamp, { fieldsCache, mutationEvents, snapshots, idIndex, aliasIndex, bodyLinksCache }) {
    const reconstructed = reconstructVaultAtTime(timestamp, { fieldsCache, mutationEvents, snapshots, bodyLinksCache });
    const resolveTargets = (value) => extractAndResolveRelationTargets(value, idIndex || fieldsCache, aliasIndex);
    const { nodes: rawNodes, edges: rawEdges } = buildHistoricalGraph(reconstructed, resolveTargets);

    const degree = new Map();
    for (const e of rawEdges) {
        degree.set(e.from, (degree.get(e.from) || 0) + 1);
        degree.set(e.to, (degree.get(e.to) || 0) + 1);
    }

    const nodes = rawNodes.map((n) => {
        const fields = (reconstructed.get(n.id) || {}).fields || null;
        const label = (fields && String(fields.name || fields.title || '').trim()) || n.id;
        return {
            id: n.id,
            label,
            kind: xgKind(n.type),
            group: n.type || 'default',
            type: n.type || null,
            weight: Math.min(1, (degree.get(n.id) || 0) / 12),
            edges: []
        };
    });

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const edges = rawEdges
        .filter((e) => nodeById.has(e.from) && nodeById.has(e.to))
        .map((e) => ({
            id: `${e.from}->${e.to}->${e.field}`,
            source: e.from,
            target: e.to,
            field: e.field,
            weight: 1,
            strength: 'medium',
            directed: true
        }));

    for (const e of edges) {
        nodeById.get(e.source).edges.push({ source: e.source, target: e.target });
        nodeById.get(e.target).edges.push({ source: e.source, target: e.target });
    }

    return {
        timestamp,
        nodes,
        edges,
        incomplete: rawNodes.some((n) => !n.complete)
    };
}

/**
 * Builds the full time-lapse frame sequence for the current live vault state.
 *
 * Prefers git history when the vault is a git repo: real historical file
 * content (frontmatter AND body text) beats the mutation-log-based path,
 * since it can answer for edits made before body-link tracking existed at
 * all. Falls back to the mutation log for non-git vaults — which, as of the
 * bodyLinksCache work in core/index.js, now also records body-text mention
 * changes going forward (via the synthetic BODY_LINKS_FIELD), just not for
 * any edit made before that tracking began. Either way the result is tagged
 * with `source` so the UI can be honest about which path actually ran.
 *
 * @param {{ frameCount?: number, now?: string }} [options]
 * @returns {{ frames: object[], earliest: string|null, latest: string|null, source: 'git'|'mutation-log' }}
 */
function buildTimelapseSequence(options = {}) {
    const frameCount = Number.isFinite(options.frameCount) ? options.frameCount : DEFAULT_FRAME_COUNT;
    const now = options.now || new Date().toISOString();

    const gitSequence = buildGitTimelapseSequence({ frameCount, now });
    if (gitSequence) return gitSequence;

    const fieldsCache = getFieldsCache();
    const mutationEvents = getMutationEvents();
    const snapshots = getVaultSnapshots();
    const idIndex = getIndex();
    const aliasIndex = getAliasIndex();
    const bodyLinksCache = getBodyLinksCache();

    const timestamps = pickCheckpointTimestamps(mutationEvents, now, frameCount);
    const frames = timestamps.map((ts) => buildTimelapseFrame(ts, { fieldsCache, mutationEvents, snapshots, idIndex, aliasIndex, bodyLinksCache }));

    // Same reasoning as the git path (graphTimelapseGit.js): a vault-wide
    // time-lapse should open on a genuinely empty frame, not whatever
    // already existed at the earliest reconstructable checkpoint. This
    // matters even more here than for git — a note with zero recorded
    // mutation history is honestly assumed to have "always existed" (there's
    // no evidence otherwise), so the earliest checkpoint can easily contain
    // most of the vault if most notes predate active mutation logging.
    const emptyFrame = { timestamp: timestamps[0] || now, nodes: [], edges: [], incomplete: false };

    return {
        frames: timestamps.length ? [emptyFrame, ...frames] : frames,
        earliest: timestamps[0] || null,
        latest: timestamps[timestamps.length - 1] || null,
        source: 'mutation-log'
    };
}

module.exports = {
    pickCheckpointTimestamps,
    buildTimelapseFrame,
    buildTimelapseSequence
};
