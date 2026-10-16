'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

const edgeMap = new Map();
const backlinkMap = new Map();
const idIndex = new Map();
const fieldsCache = new Map();

function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function computeGraphEdgeWeight(label, options = {}) {
    const isMention = label === 'mention';
    const reciprocalBonus = options.reciprocal ? 0.65 : 0;
    const semanticBonus = options.sourceType && options.targetType && options.sourceType !== options.targetType ? 0.2 : 0;
    const base = isMention ? 0.85 : 2.55;
    return round2(base + reciprocalBonus + semanticBonus);
}

function classifyGraphEdgeStrength(label, weight) {
    if (label === 'mention') return 'weak';
    if (weight >= 3.2) return 'strong';
    return 'medium';
}

function computeHubScore({ weightedDegree, relationKinds, connectedTypes, strongEdges, tagCount }) {
    return round2((weightedDegree * 2.2) + (relationKinds * 1.4) + (connectedTypes * 1.1) + (strongEdges * 0.75) + (Math.min(tagCount, 4) * 0.25));
}

function computeNodeWeightedDegree(id) {
    const outgoing = (edgeMap.get(id) || []).map((edge) => computeGraphEdgeWeight(edge.field === 'body' ? 'mention' : edge.field, {
        reciprocal: (edgeMap.get(edge.targetId) || []).some((candidate) => candidate && candidate.targetId === id)
    }));
    const incoming = (backlinkMap.get(id) || []).map((edge) => computeGraphEdgeWeight(edge.field === 'body' ? 'mention' : edge.field, {
        reciprocal: (edgeMap.get(edge.sourceId) || []).some((candidate) => candidate && candidate.targetId === id)
    }));
    return round2([...outgoing, ...incoming].reduce((sum, weight) => sum + weight, 0));
}

function computeNodeExplorerScore(id) {
    const relatedTypes = new Set();
    const relationFields = new Set();
    let strongEdges = 0;
    for (const edge of edgeMap.get(id) || []) {
        const label = edge.field === 'body' ? 'mention' : edge.field;
        relationFields.add(label);
        relatedTypes.add(String((fieldsCache.get(edge.targetId) || {}).type || 'unknown'));
        if (classifyGraphEdgeStrength(label, computeGraphEdgeWeight(label)) !== 'weak') strongEdges += 1;
    }
    for (const edge of backlinkMap.get(id) || []) {
        const label = edge.field === 'body' ? 'mention' : edge.field;
        relationFields.add(label);
        relatedTypes.add(String((fieldsCache.get(edge.sourceId) || {}).type || 'unknown'));
        if (classifyGraphEdgeStrength(label, computeGraphEdgeWeight(label)) !== 'weak') strongEdges += 1;
    }
    const tagCount = String((fieldsCache.get(id) || {}).__yamlink_tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).length;
    return computeHubScore({
        weightedDegree: computeNodeWeightedDegree(id),
        relationKinds: relationFields.size,
        connectedTypes: [...relatedTypes].filter(Boolean).length,
        strongEdges,
        tagCount
    });
}

require.cache.__graph2_index_stub__ = {
    id: '__graph2_index_stub__',
    filename: '__graph2_index_stub__',
    loaded: true,
    exports: {
        getIndex: () => idIndex,
        getFieldsCache: () => fieldsCache
    }
};

require.cache.__graph2_graph_stub__ = {
    id: '__graph2_graph_stub__',
    filename: '__graph2_graph_stub__',
    loaded: true,
    exports: {
        getEdges: (id) => edgeMap.get(id) || [],
        getBacklinks: (id) => backlinkMap.get(id) || [],
        computeGraphEdgeWeight,
        classifyGraphEdgeStrength,
        computeHubScore,
        computeNodeWeightedDegree,
        computeNodeExplorerScore,
        // Mirrors the real core/graph.js's getGraphStats() shape (see its
        // own JSDoc) over this fixture's own edgeMap/backlinkMap, so
        // buildGraph2Payload's new vaultTotals computation (true,
        // uncapped vault-wide node/edge counts — see its own comment) has
        // something real to call in this stubbed test environment.
        getGraphStats: () => {
            let totalEdges = 0;
            for (const edges of edgeMap.values()) totalEdges += edges.length;
            return { nodes: edgeMap.size, totalEdges, totalBacklinks: backlinkMap.size };
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === '../../core/indexService') return '__graph2_index_stub__';
    if (request === '../../core/graph') return '__graph2_graph_stub__';
    return originalResolve(request, parent, ...rest);
};

const { normalizeGraph2State } = require('../src/features/graph2/graph2State');
const { buildGraph2Payload, pruneWorkspaceScope } = require('../src/features/graph2/graph2Payload');

describe('graph 2.0 foundation', () => {
    test('normalizes graph 2 state with neighborhood defaults', () => {
        const state = normalizeGraph2State({}, 'mission-klendathu');
        assert.equal(state.version, 2);
        assert.equal(state.source, 'current');
        assert.equal(state.scope, 'neighborhood');
        assert.equal(state.centerNodeId, 'mission-klendathu');
        assert.equal(state.depth, 2);
        assert.equal(state.nodeCap, 128);
        assert.deepEqual(state.filters.types, []);
        assert.equal(state.filters.hideArchived, true);
    });

    test('builds a neighborhood payload around the active note', () => {
        seedGraph2Fixture();
        const state = normalizeGraph2State({
            scope: 'neighborhood',
            depth: 2,
            nodeCap: 20
        }, 'mission-klendathu');

        const payload = buildGraph2Payload(state, () => 'mission-klendathu');
        assert.equal(payload.scope, 'neighborhood');
        assert.deepEqual(payload.seedNodeIds, ['mission-klendathu']);
        assert.ok(payload.model.summary.nodeCount >= 4);
        assert.ok(payload.facets.types.some((entry) => entry.type === 'mission'));
        assert.ok(payload.facets.relations.some((entry) => entry.field === 'commander'));
    });

    test('filters the payload by tag at the dataset level', () => {
        seedGraph2Fixture();
        const state = normalizeGraph2State({
            scope: 'domain',
            nodeCap: 20,
            filters: {
                tags: ['command']
            }
        }, 'mission-klendathu');

        const payload = buildGraph2Payload(state, () => 'mission-klendathu');
        const nodeIds = payload.model.elements
            .map((element) => element.data)
            .filter((data) => data && data.id && !data.source)
            .map((data) => data.id)
            .sort();

        assert.deepEqual(nodeIds, ['johnny-rico', 'mission-klendathu']);
        assert.ok(payload.model.relations.some((entry) => entry.field === 'commander'));
    });

    test('uses query-defined source to shape the graph seeds', () => {
        seedGraph2Fixture();
        const state = normalizeGraph2State({
            source: 'query',
            scope: 'local',
            queryText: '!view person\nwhere id = johnny-rico'
        }, 'johnny-rico');

        const payload = buildGraph2Payload(state, () => 'johnny-rico');
        assert.deepEqual(payload.seedNodeIds, ['johnny-rico']);
        assert.equal(payload.centerNodeId, 'johnny-rico');
        assert.ok(payload.model.elements.some((element) => element.data?.id === 'johnny-rico'));
    });

    test('filters relation families and hides orphaned nodes', () => {
        seedGraph2Fixture();
        const state = normalizeGraph2State({
            scope: 'neighborhood',
            depth: 2,
            nodeCap: 20,
            filters: {
                relationTypes: ['commander'],
                hideOrphans: true
            }
        }, 'mission-klendathu');

        const payload = buildGraph2Payload(state, () => 'mission-klendathu');
        const edges = payload.model.elements
            .map((element) => element.data)
            .filter((data) => data && data.source);
        const nodeIds = payload.model.elements
            .map((element) => element.data)
            .filter((data) => data && data.id && !data.source)
            .map((data) => data.id)
            .sort();

        assert.equal(edges.length, 1);
        assert.equal(edges[0].label, 'commander');
        assert.deepEqual(nodeIds, ['johnny-rico', 'mission-klendathu']);
    });

    test('prunes dense vault scope into a cleaner structural slice', () => {
        seedDenseGraph2Fixture();
        const state = normalizeGraph2State({
            scope: 'vault',
            nodeCap: 40
        }, 'center-note');

        const payload = buildGraph2Payload(state, () => 'center-note');
        const edges = payload.model.elements
            .map((element) => element.data)
            .filter((data) => data && data.source);

        assert.ok(edges.length < 18);
        assert.ok(edges.every((edge) => edge.strength !== 'weak'));
    });

    test('vault scope includes every real note when they all comfortably fit under the cap (ranking only matters once truncation actually happens — see the dedicated "vault scope — honest totals..." describe block below for that case)', () => {
        seedGraph2Fixture();
        const state = normalizeGraph2State({
            scope: 'vault',
            nodeCap: 10
        }, 'mission-klendathu');

        const payload = buildGraph2Payload(state, () => 'mission-klendathu');
        const nodeIds = payload.model.elements
            .map((element) => element.data)
            .filter((data) => data && data.id && !data.source)
            .map((data) => data.id)
            .sort();

        assert.deepEqual(nodeIds, ['bug-war', 'federation', 'johnny-rico', 'mission-klendathu', 'roughnecks']);
    });

    test('vault scope does not invent a selected node when none was requested', () => {
        seedGraph2Fixture();
        const state = normalizeGraph2State({
            scope: 'vault',
            nodeCap: 10
        }, null);

        const payload = buildGraph2Payload(state, () => null);
        assert.equal(payload.selectedNodeId, null);
    });

    test('vault scope does not carry a visual center from the active note', () => {
        seedGraph2Fixture();
        const state = normalizeGraph2State({
            scope: 'vault',
            nodeCap: 10
        }, 'johnny-rico');

        const payload = buildGraph2Payload(state, () => 'johnny-rico');
        assert.equal(payload.centerNodeId, null);
        assert.equal(payload.selectedNodeId, null);
    });

    test('explicit null center and selection override previous graph state', () => {
        const previous = normalizeGraph2State({
            scope: 'neighborhood',
            centerNodeId: 'johnny-rico',
            selectedNodeId: 'johnny-rico'
        }, 'johnny-rico');

        const next = normalizeGraph2State({
            scope: 'vault',
            centerNodeId: null,
            selectedNodeId: null
        }, null, previous);

        assert.equal(next.centerNodeId, null);
        assert.equal(next.selectedNodeId, null);
    });

    test('current-note workspace payload follows the active note over stale graph state', () => {
        seedGraph2Fixture();
        const previous = normalizeGraph2State({
            scope: 'neighborhood',
            centerNodeId: 'johnny-rico',
            selectedNodeId: 'johnny-rico'
        }, 'johnny-rico');

        const state = normalizeGraph2State({
            scope: 'neighborhood'
        }, 'mission-klendathu', previous);

        const payload = buildGraph2Payload(state, () => 'mission-klendathu');
        assert.equal(payload.centerNodeId, 'mission-klendathu');
        assert.equal(payload.selectedNodeId, 'mission-klendathu');
    });
});

function seedGraph2Fixture() {
    edgeMap.clear();
    backlinkMap.clear();
    idIndex.clear();
    fieldsCache.clear();

    idIndex.set('mission-klendathu', 'c:\\notes\\mission-klendathu.md');
    idIndex.set('johnny-rico', 'c:\\notes\\johnny-rico.md');
    idIndex.set('roughnecks', 'c:\\notes\\roughnecks.md');
    idIndex.set('federation', 'c:\\notes\\federation.md');
    idIndex.set('bug-war', 'c:\\notes\\bug-war.md');

    fieldsCache.set('mission-klendathu', { name: 'Battle of Klendathu', type: 'mission', __yamlink_tags: 'command, invasion' });
    fieldsCache.set('johnny-rico', { name: 'Johnny Rico', type: 'person', __yamlink_tags: 'command, infantry' });
    fieldsCache.set('roughnecks', { name: 'Roughnecks', type: 'unit', __yamlink_tags: 'infantry, squad' });
    fieldsCache.set('federation', { name: 'Federation', type: 'faction', __yamlink_tags: 'government, strategy' });
    fieldsCache.set('bug-war', { name: 'Bug War', type: 'event', __yamlink_tags: 'invasion, history', archived: false });

    edgeMap.set('mission-klendathu', [
        { field: 'commander', targetId: 'johnny-rico' },
        { field: 'unit', targetId: 'roughnecks' },
        { field: 'faction', targetId: 'federation' },
        { field: 'context', targetId: 'bug-war' }
    ]);
    edgeMap.set('johnny-rico', [
        { field: 'unit', targetId: 'roughnecks' }
    ]);
    edgeMap.set('bug-war', [
        { field: 'body', targetId: 'mission-klendathu' }
    ]);

    backlinkMap.set('johnny-rico', [
        { field: 'commander', sourceId: 'mission-klendathu' }
    ]);
    backlinkMap.set('roughnecks', [
        { field: 'unit', sourceId: 'mission-klendathu' },
        { field: 'unit', sourceId: 'johnny-rico' }
    ]);
    backlinkMap.set('federation', [
        { field: 'faction', sourceId: 'mission-klendathu' }
    ]);
    backlinkMap.set('bug-war', [
        { field: 'context', sourceId: 'mission-klendathu' }
    ]);
    backlinkMap.set('mission-klendathu', [
        { field: 'body', sourceId: 'bug-war' }
    ]);
}

function seedDenseGraph2Fixture() {
    edgeMap.clear();
    backlinkMap.clear();
    idIndex.clear();
    fieldsCache.clear();

    idIndex.set('center-note', 'c:\\notes\\center-note.md');
    fieldsCache.set('center-note', { name: 'Center Note', type: 'hub', __yamlink_tags: 'core, dense' });

    const related = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
    for (const id of related) {
        idIndex.set(id, `c:\\notes\\${id}.md`);
        fieldsCache.set(id, { name: id, type: id === 'alpha' || id === 'beta' ? 'contact' : 'note', __yamlink_tags: 'dense' });
    }

    edgeMap.set('center-note', related.map((id, index) => ({
        field: index < 4 ? 'link' : 'body',
        targetId: id
    })));

    for (const id of related) {
        backlinkMap.set(id, [{ field: related.indexOf(id) < 4 ? 'link' : 'body', sourceId: 'center-note' }]);
    }

    edgeMap.set('alpha', [
        { field: 'related', targetId: 'beta' },
        { field: 'related', targetId: 'gamma' }
    ]);
    edgeMap.set('beta', [
        { field: 'related', targetId: 'delta' }
    ]);
    backlinkMap.set('beta', [...(backlinkMap.get('beta') || []), { field: 'related', sourceId: 'alpha' }]);
    backlinkMap.set('gamma', [...(backlinkMap.get('gamma') || []), { field: 'related', sourceId: 'alpha' }]);
    backlinkMap.set('delta', [...(backlinkMap.get('delta') || []), { field: 'related', sourceId: 'beta' }]);
}

describe('workspace focus cap (pruneWorkspaceScope)', () => {
    function makeNodes(...ids) {
        return ids.map(id => ({ id, label: id, type: 'note', hubScore: 0, weightedDegree: 0 }));
    }
    function makeEdge(source, target, weight = 1) {
        return { id: `${source}-${target}`, source, target, target, label: 'link', weight, strength: 'medium' };
    }

    test('keeps top N direct neighbors by combined score', () => {
        const nodes = makeNodes('center', 'a', 'b', 'c', 'd', 'e', 'f', 'g');
        const edges = [
            makeEdge('center', 'a', 5),
            makeEdge('center', 'b', 4),
            makeEdge('center', 'c', 3),
            makeEdge('center', 'd', 2),
            makeEdge('center', 'e', 1),
            makeEdge('center', 'f', 0.5),
            makeEdge('center', 'g', 0.1)
        ];

        const result = pruneWorkspaceScope('neighborhood', nodes, edges, 'center', 3, new Set());

        const nodeIds = result.nodes.map(n => n.id).sort();
        assert.ok(nodeIds.includes('center'), 'center always included');
        assert.ok(nodeIds.includes('a'), 'top-ranked a included');
        assert.ok(nodeIds.includes('b'), 'second-ranked b included');
        assert.ok(nodeIds.includes('c'), 'third-ranked c included');
        assert.ok(!nodeIds.includes('d'), 'd beyond cap excluded');
        assert.equal(result.hiddenNeighborCount, 4, '4 neighbors hidden');
        assert.equal(result.edges.length, 3, 'only 3 center→neighbor edges kept');
    });

    test('reveals depth-2 nodes for expanded neighbors', () => {
        // center → a → secondary; center → b (not expanded)
        const nodes = makeNodes('center', 'a', 'b', 'secondary');
        const edges = [
            makeEdge('center', 'a', 3),
            makeEdge('center', 'b', 2),
            makeEdge('a', 'secondary', 1)
        ];

        const result = pruneWorkspaceScope('neighborhood', nodes, edges, 'center', 5, new Set(['a']));

        const nodeIds = result.nodes.map(n => n.id);
        assert.ok(nodeIds.includes('secondary'), 'depth-2 node revealed for expanded neighbor a');
        assert.ok(nodeIds.includes('b'), 'b visible within cap');
    });

    test('passes through unchanged for vault scope', () => {
        const nodes = makeNodes('center', 'a', 'b', 'c', 'd', 'e', 'f');
        const edges = [
            makeEdge('center', 'a', 1), makeEdge('center', 'b', 1),
            makeEdge('center', 'c', 1), makeEdge('center', 'd', 1),
            makeEdge('center', 'e', 1), makeEdge('center', 'f', 1)
        ];

        const result = pruneWorkspaceScope('vault', nodes, edges, 'center', 2, new Set());

        assert.equal(result.nodes.length, nodes.length, 'vault scope not pruned');
        assert.equal(result.hiddenNeighborCount, 0, 'no hidden count for vault');
    });

    test('workspace payload exposes hiddenWorkspaceNeighborCount', () => {
        seedDenseGraph2Fixture();
        const state = normalizeGraph2State({
            scope: 'neighborhood',
            depth: 1,
            nodeCap: 40,
            workspaceFocusCap: 3
        }, 'center-note');

        const payload = buildGraph2Payload(state, () => 'center-note');
        assert.ok(payload.hiddenWorkspaceNeighborCount > 0, 'hidden count exposed when neighbors exceed cap');
        const nodeIds = payload.model.elements
            .map(e => e.data)
            .filter(d => d && d.id && !d.source)
            .map(d => d.id);
        assert.ok(nodeIds.length <= 4, 'at most center + 3 direct neighbors visible');
    });
});

describe('vault scope — honest totals and ranked (not arbitrary) node selection', () => {
    // A real, user-reported bug: the sidebar's vault-scope count badge showed
    // a capped subset's own count with nothing indicating it wasn't the
    // vault's true size (confirmed directly — the number shown matched the
    // hardcoded default cap exactly, not a coincidence), AND the capped
    // subset itself was selected by Array.from(getIndex().keys())'s
    // arbitrary Map-insertion order, not ranked by importance — meaning a
    // vault's most-connected notes could just as easily be excluded as its
    // least. Both are fixed: vault-scope selection now ranks by hub score
    // (getTopVaultNodes, the same ranking the older Graph Workspace panel
    // already used), and the payload exposes the real, uncapped
    // vaultTotals alongside the (possibly capped) model.summary counts.
    const TOTAL_NOTE_COUNT = 25; // deliberately > MIN_GRAPH2_NODE_CAP (20) — normalizeGraph2State clamps any requested cap up to that floor, so a fixture of 20 or fewer can never actually be truncated no matter what nodeCap is requested.

    function seedRankedVaultFixture() {
        edgeMap.clear();
        backlinkMap.clear();
        idIndex.clear();
        fieldsCache.clear();

        // Inserted FIRST into the index — low connectivity. Under the old
        // arbitrary-slice behavior, these would always survive a cap at the
        // 20-note floor (they come first), displacing anything inserted
        // later regardless of actual importance.
        for (let i = 0; i < TOTAL_NOTE_COUNT - 1; i++) {
            const id = `leaf-${i}`;
            idIndex.set(id, `c:\\notes\\${id}.md`);
            fieldsCache.set(id, { name: id, type: 'note' });
        }

        // Inserted LAST — but genuinely the most-connected note in the
        // vault. Under the old behavior, a cap at the 20-note floor would
        // exclude this entirely just because of insertion order (it's the
        // 25th note in, past any arbitrary first-20 slice); ranked
        // selection must keep it regardless of where it was inserted.
        idIndex.set('hub-note', 'c:\\notes\\hub-note.md');
        fieldsCache.set('hub-note', { name: 'Hub Note', type: 'note' });
        const hubEdges = [];
        for (let i = 0; i < 6; i++) {
            hubEdges.push({ field: 'related', targetId: `leaf-${i}` });
        }
        edgeMap.set('hub-note', hubEdges);
        for (let i = 0; i < 6; i++) {
            backlinkMap.set(`leaf-${i}`, [{ field: 'related', sourceId: 'hub-note' }]);
        }
    }

    test('the node cap keeps the most-connected note, not whichever notes happen to come first in the index', () => {
        seedRankedVaultFixture();
        // nodeCap: 1 gets clamped up to the real 20-note floor — still far
        // fewer than this fixture's 25 real notes, so this only proves
        // something if ranking is actually in effect, not just "everything
        // fits anyway."
        const state = normalizeGraph2State({ scope: 'vault', nodeCap: 1 }, null);
        assert.equal(state.nodeCap, 20, 'sanity check: the real minimum floor this test relies on');
        const payload = buildGraph2Payload(state, () => null);

        const visibleIds = payload.model.elements
            .map((element) => element.data)
            .filter((data) => data && data.id && !data.source)
            .map((data) => data.id);

        assert.ok(visibleIds.includes('hub-note'), `expected the most-connected note to survive the cap, got: ${visibleIds.join(', ')}`);
    });

    test('vaultTotals reports the true, uncapped vault size — not the capped subset\'s own count', () => {
        seedRankedVaultFixture();
        const state = normalizeGraph2State({ scope: 'vault', nodeCap: 1 }, null);
        const payload = buildGraph2Payload(state, () => null);

        assert.equal(payload.vaultTotals.nodeCount, TOTAL_NOTE_COUNT, 'the real vault has 25 notes total, regardless of the cap');
        assert.ok(payload.model.summary.nodeCount < payload.vaultTotals.nodeCount, 'the rendered model should be the smaller, capped count');
        assert.equal(payload.model.summary.nodeCount, 20, 'capped to the real minimum floor');
    });

    test('vaultTotals matches the shown count exactly when the cap is not actually reached — no truncation to report', () => {
        seedRankedVaultFixture();
        const state = normalizeGraph2State({ scope: 'vault', nodeCap: 128 }, null);
        const payload = buildGraph2Payload(state, () => null);

        assert.equal(payload.vaultTotals.nodeCount, TOTAL_NOTE_COUNT);
        assert.equal(payload.model.summary.nodeCount, TOTAL_NOTE_COUNT, 'all 25 real notes fit comfortably under this cap');
    });

    test('vaultTotals.edgeCount reflects the true vault-wide edge count from the graph core, independent of any scope-level pruning', () => {
        seedRankedVaultFixture();
        const state = normalizeGraph2State({ scope: 'vault', nodeCap: 1 }, null);
        const payload = buildGraph2Payload(state, () => null);
        // 6 real edges exist in this fixture (hub-note -> leaf-0..5).
        assert.equal(payload.vaultTotals.edgeCount, 6);
    });
});

Module._resolveFilename = originalResolve;
