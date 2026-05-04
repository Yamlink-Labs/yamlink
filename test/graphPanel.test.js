'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

const edgeMap = new Map();
const backlinkMap = new Map();
const idIndex = new Map();
const pathIndex = new Map();
const fieldsCache = new Map();

require.cache.__graphpanel_vscode_stub__ = {
    id: '__graphpanel_vscode_stub__',
    filename: '__graphpanel_vscode_stub__',
    loaded: true,
    exports: {}
};

require.cache.__graphpanel_index_stub__ = {
    id: '__graphpanel_index_stub__',
    filename: '__graphpanel_index_stub__',
    loaded: true,
    exports: {
        getIndex: () => idIndex,
        getPathIndex: () => pathIndex,
        getFieldsCache: () => fieldsCache,
        getVaultGeneration: () => 0
    }
};

require.cache.__graphpanel_graph_stub__ = {
    id: '__graphpanel_graph_stub__',
    filename: '__graphpanel_graph_stub__',
    loaded: true,
    exports: {
        getEdges: (id) => edgeMap.get(id) || [],
        getBacklinks: (id) => backlinkMap.get(id) || []
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__graphpanel_vscode_stub__';
    if (request === '../core/indexService') return '__graphpanel_index_stub__';
    if (request === '../../core/indexService') return '__graphpanel_index_stub__';
    if (request === '../core/graph') return '__graphpanel_graph_stub__';
    if (request === '../../core/graph') return '__graphpanel_graph_stub__';
    return originalResolve(request, parent, ...rest);
};

const { parseGraphBlocks, buildGraphModel } = require('../src/features/graphPanel');
const { buildPanelPayload } = require('../src/features/graph/graphPayload');

describe('graph panel helpers', () => {
    test('parses yamlink-graph fences into blocks', () => {
        const text = [
            '```yamlink-graph',
            'local neighborhood',
            '```',
            '',
            '```yamlink-graph',
            'vault explorer',
            '```'
        ].join('\n');

        const blocks = parseGraphBlocks(text);
        assert.equal(blocks.length, 2);
        assert.equal(blocks[0], 'local neighborhood');
        assert.equal(blocks[1], 'vault explorer');
    });

    test('builds readable graph model data with summary stats', () => {
        seedGraphFixture();

        const model = buildGraphModel(['mission-klendathu', 'johnny-rico', 'roughnecks'], 'mission-klendathu');
        assert.equal(model.summary.nodeCount, 3);
        assert.equal(model.summary.edgeCount, 3);
        assert.equal(model.summary.typeCount, 3);
        assert.equal(model.summary.contextId, 'mission-klendathu');
        assert.equal(model.summary.primaryFocusId, 'mission-klendathu');
        assert.equal(model.summary.largestClusterSize, 3);
        assert.ok(model.types.every((entry) => typeof entry.shape === 'string' && entry.shape.length > 0));
        assert.ok(model.relations.some((entry) => entry.field === 'commander' && entry.count === 1));
        assert.ok(model.topNodes.some((node) => node.id === 'mission-klendathu'));
        assert.ok(model.elements.some((el) => el.data && el.data.isContext === true && typeof el.data.shape === 'string'));
        assert.ok(model.nodeDetails['mission-klendathu']);
        assert.equal(model.nodeDetails['mission-klendathu'].outgoing.length, 2);
        assert.equal(model.nodeDetails['roughnecks'].incoming.length, 2);
        assert.ok(model.nodeDetails['johnny-rico'].connectedTypes.some((entry) => entry.type === 'mission'));
        assert.ok(model.nodeDetails['mission-klendathu'].relationSummary.some((entry) => entry.field === 'commander'));
    });

    test('includes body wikilinks in the graph as mention edges', () => {
        clearFixtures();
        idIndex.set('alpha-note', 'c:\\notes\\alpha.md');
        idIndex.set('beta-note', 'c:\\notes\\beta.md');
        fieldsCache.set('alpha-note', { title: 'Alpha note', type: 'note' });
        fieldsCache.set('beta-note', { title: 'Beta note', type: 'note' });

        edgeMap.set('alpha-note', [
            { field: 'body', targetId: 'beta-note' }
        ]);
        edgeMap.set('beta-note', [
            { field: 'body', targetId: 'alpha-note' }
        ]);
        backlinkMap.set('alpha-note', [
            { field: 'body', sourceId: 'beta-note' }
        ]);
        backlinkMap.set('beta-note', [
            { field: 'body', sourceId: 'alpha-note' }
        ]);

        const model = buildGraphModel(['alpha-note', 'beta-note'], 'alpha-note');
        assert.equal(model.summary.edgeCount, 2);
        assert.ok(model.relations.some((entry) => entry.field === 'mention' && entry.count === 2));
        assert.ok(model.elements.some((el) => el.data && el.data.label === 'mention'));
        assert.equal(model.nodeDetails['alpha-note'].outgoing.length, 1);
        assert.equal(model.nodeDetails['alpha-note'].incoming.length, 1);
    });

    test('buildPanelPayload uses the provided active note fallback for local graph focus', () => {
        seedGraphFixture();

        const payload = buildPanelPayload({
            mode: 'local',
            centerNodeId: null,
            selectedNodeId: null,
            depth: 1,
            maxNodes: 40,
            expandedNodeIds: new Set(),
            forceLayout: true
        }, () => 'johnny-rico');

        assert.equal(payload.mode, 'local');
        assert.equal(payload.centerNodeId, 'johnny-rico');
        assert.equal(payload.selectedNodeId, 'johnny-rico');
        assert.equal(payload.noCenter, false);
        assert.equal(payload.forceLayout, true);
        assert.ok(payload.model.summary.nodeCount >= 2);
    });
});

function seedGraphFixture() {
    clearFixtures();

    idIndex.set('mission-klendathu', 'c:\\notes\\mission-klendathu.md');
    idIndex.set('johnny-rico', 'c:\\notes\\johnny-rico.md');
    idIndex.set('roughnecks', 'c:\\notes\\roughnecks.md');

    fieldsCache.set('mission-klendathu', { name: 'Battle of Klendathu', type: 'mission' });
    fieldsCache.set('johnny-rico', { name: 'Johnny Rico', type: 'character' });
    fieldsCache.set('roughnecks', { name: 'Roughnecks', type: 'unit' });

    edgeMap.set('mission-klendathu', [
        { field: 'commander', targetId: 'johnny-rico' },
        { field: 'unit', targetId: 'roughnecks' }
    ]);
    edgeMap.set('johnny-rico', [
        { field: 'unit', targetId: 'roughnecks' }
    ]);

    backlinkMap.set('johnny-rico', [
        { field: 'commander', sourceId: 'mission-klendathu' }
    ]);
    backlinkMap.set('roughnecks', [
        { field: 'unit', sourceId: 'mission-klendathu' },
        { field: 'unit', sourceId: 'johnny-rico' }
    ]);
}

function clearFixtures() {
    edgeMap.clear();
    backlinkMap.clear();
    idIndex.clear();
    pathIndex.clear();
    fieldsCache.clear();
}

Module._resolveFilename = originalResolve;
