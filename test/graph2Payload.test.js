'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

const edgeMap = new Map();
const backlinkMap = new Map();
const idIndex = new Map();
const fieldsCache = new Map();

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
        getBacklinks: (id) => backlinkMap.get(id) || []
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

    test('vault scope uses the vault node set instead of a ranked subset helper', () => {
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

Module._resolveFilename = originalResolve;
