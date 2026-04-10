'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

const edgeMap = new Map();

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
        getIndex: () => new Map()
    }
};

require.cache.__graphpanel_graph_stub__ = {
    id: '__graphpanel_graph_stub__',
    filename: '__graphpanel_graph_stub__',
    loaded: true,
    exports: {
        getEdges: (id) => edgeMap.get(id) || []
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__graphpanel_vscode_stub__';
    if (request === '../core/index') return '__graphpanel_index_stub__';
    if (request === '../core/graph') return '__graphpanel_graph_stub__';
    return originalResolve(request, parent, ...rest);
};

const { parseGraphBlocks, buildGraphModel } = require('../src/features/graphPanel');

describe('graph panel helpers', () => {
    test('parses yamlink-graph fences into queries', () => {
        const text = [
            '```yamlink-graph',
            '!view mission',
            'where commander = [[johnny-rico]]',
            '```',
            '',
            '```yamlink-graph',
            '!view character',
            '```'
        ].join('\n');

        const blocks = parseGraphBlocks(text);
        assert.equal(blocks.length, 2);
        assert.equal(blocks[0].type, 'mission');
        assert.equal(blocks[1].type, 'character');
    });

    test('builds readable graph model data with summary stats', () => {
        edgeMap.clear();
        edgeMap.set('mission-klendathu', [
            { field: 'commander', targetId: 'johnny-rico' },
            { field: 'unit', targetId: 'roughnecks' }
        ]);
        edgeMap.set('johnny-rico', [
            { field: 'unit', targetId: 'roughnecks' }
        ]);

        const rows = [
            { id: 'mission-klendathu', nodeType: 'mission', fields: { name: 'Battle of Klendathu' } },
            { id: 'johnny-rico', nodeType: 'character', fields: { name: 'Johnny Rico' } },
            { id: 'roughnecks', nodeType: 'unit', fields: { name: 'Roughnecks' } }
        ];

        const model = buildGraphModel(rows, 'mission-klendathu');
        assert.equal(model.summary.nodeCount, 3);
        assert.equal(model.summary.edgeCount, 3);
        assert.equal(model.summary.typeCount, 3);
        assert.equal(model.summary.contextId, 'mission-klendathu');
        assert.equal(model.types[0].count, 1);
        assert.ok(model.types.every((entry) => typeof entry.shape === 'string' && entry.shape.length > 0));
        assert.ok(model.relations.some((entry) => entry.field === 'commander' && entry.count === 1));
        assert.ok(model.topNodes.some((node) => node.id === 'mission-klendathu'));
        assert.ok(model.elements.some((el) => el.data && el.data.label === 'commander' && typeof el.data.color === 'string'));
        assert.ok(model.elements.some((el) => el.data && el.data.isContext === true && typeof el.data.shape === 'string'));
        assert.equal(model.summary.primaryFocusId, 'mission-klendathu');
        assert.equal(model.summary.largestClusterSize, 3);
        assert.ok(model.nodeDetails['mission-klendathu']);
        assert.equal(model.nodeDetails['mission-klendathu'].outgoing.length, 2);
        assert.equal(model.nodeDetails['roughnecks'].incoming.length, 2);
        assert.ok(model.nodeDetails['johnny-rico'].connectedTypes.some((entry) => entry.type === 'mission'));
        assert.ok(model.nodeDetails['mission-klendathu'].relationSummary.some((entry) => entry.field === 'commander'));
    });
});

Module._resolveFilename = originalResolve;
