'use strict';
/**
 * surface.graph.test.js
 *
 * Scenario-based tests for the graph topology surface: node/edge structure,
 * scope variants, hub degree, and payload metadata.
 * All tests build real vaults and call vault.graph2().
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createVault } = require('./lib/vaultSim');

const NOTE = (id, type, extra = '') =>
    `---\nid: ${id}\ntype: ${type}\n${extra}---\n`;

const CRM = {
    'rico.md':   NOTE('rico',   'contact', 'name: Johnny Rico\naccount: "[[mi]]"\n'),
    'dizzy.md':  NOTE('dizzy',  'contact', 'name: Dizzy Flores\naccount: "[[mi]]"\n'),
    'carmen.md': NOTE('carmen', 'contact', 'name: Carmen Ibanez\naccount: "[[mi]]"\n'),
    'mi.md':     NOTE('mi',     'account', 'name: Mobile Infantry\n')
};

// ── LOCAL scope — node/edge structure ─────────────────────────────────────────

describe('graph — LOCAL scope node/edge structure', () => {
    test('LOCAL scope includes center node and direct neighbor', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi',   'account')
        });
        const payload = vault.graph2('rico');
        const elements = payload.model.elements;
        const nodes = elements.filter(e => e.data && !e.data.source);
        const edges = elements.filter(e => e.data && e.data.source);
        assert.equal(nodes.length, 2);
        assert.equal(edges.length, 1);
        vault.destroy();
    });

    test('summary.nodeCount and edgeCount match element arrays', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi',   'account')
        });
        const payload = vault.graph2('rico');
        const elements = payload.model.elements;
        const nodeCount = elements.filter(e => e.data && !e.data.source).length;
        const edgeCount = elements.filter(e => e.data && e.data.source).length;
        assert.equal(payload.model.summary.nodeCount, nodeCount);
        assert.equal(payload.model.summary.edgeCount, edgeCount);
        vault.destroy();
    });

    test('center node has isContext=true', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi',   'account')
        });
        const payload = vault.graph2('rico');
        const ricoNode = payload.model.elements.find(e => e.data && e.data.id === 'rico');
        assert.ok(ricoNode, 'rico node should be present in LOCAL scope from rico');
        assert.equal(ricoNode.data.isContext, true);
        vault.destroy();
    });

    test('non-center neighbor has isContext=false', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi',   'account')
        });
        const payload = vault.graph2('rico');
        const miNode = payload.model.elements.find(e => e.data && e.data.id === 'mi');
        assert.ok(miNode, 'mi node should be present');
        assert.equal(miNode.data.isContext, false);
        vault.destroy();
    });

    test('node data has required structural fields', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi',   'account')
        });
        const payload = vault.graph2('rico');
        const node = payload.model.elements.find(e => e.data && !e.data.source);
        assert.ok(node, 'at least one node should exist');
        const d = node.data;
        assert.ok(typeof d.id       === 'string',  'id should be a string');
        assert.ok(typeof d.type     === 'string',  'type should be a string');
        assert.ok(typeof d.color    === 'string',  'color should be a string');
        assert.equal(d.shape, 'ellipse');
        assert.ok(typeof d.degree   === 'number',  'degree should be a number');
        vault.destroy();
    });

    test('edge data has source, target, label, weight, strength', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi',   'account')
        });
        const payload = vault.graph2('rico');
        const edge = payload.model.elements.find(e => e.data && e.data.source);
        assert.ok(edge, 'at least one edge should exist');
        const d = edge.data;
        assert.equal(d.source, 'rico');
        assert.equal(d.target, 'mi');
        assert.equal(d.label,  'account');
        assert.ok(typeof d.weight   === 'number', 'weight should be a number');
        assert.ok(typeof d.strength === 'string', 'strength should be a string');
        vault.destroy();
    });

    test('named relation edge has medium or strong strength', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi',   'account')
        });
        const payload = vault.graph2('rico');
        const edge = payload.model.elements.find(e => e.data && e.data.source);
        assert.ok(edge, 'edge should exist');
        assert.ok(['medium', 'strong'].includes(edge.data.strength),
            `expected medium/strong, got ${edge.data.strength}`);
        vault.destroy();
    });

    test('node type matches the frontmatter type field', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi',   'account')
        });
        const payload = vault.graph2('rico');
        const ricoNode = payload.model.elements.find(e => e.data && e.data.id === 'rico');
        assert.ok(ricoNode, 'rico node should exist');
        assert.equal(ricoNode.data.type, 'contact');
        vault.destroy();
    });

    test('isolated note has 1 node and 0 edges in LOCAL scope', () => {
        const vault = createVault({
            'solo.md': NOTE('solo', 'note')
        });
        const payload = vault.graph2('solo');
        const nodes = payload.model.elements.filter(e => e.data && !e.data.source);
        const edges = payload.model.elements.filter(e => e.data && e.data.source);
        assert.equal(nodes.length, 1);
        assert.equal(edges.length, 0);
        vault.destroy();
    });
});

// ── VAULT scope ───────────────────────────────────────────────────────────────

describe('graph — VAULT scope', () => {
    test('vault scope returns all notes in the vault', () => {
        const vault = createVault(CRM);
        const payload = vault.graph2('rico', { scope: 'vault' });
        assert.equal(payload.model.summary.nodeCount, 4);
        vault.destroy();
    });

    test('vault scope centerNodeId is null', () => {
        const vault = createVault(CRM);
        const payload = vault.graph2('rico', { scope: 'vault' });
        assert.equal(payload.centerNodeId, null);
        vault.destroy();
    });

    test('vault scope includes all contact→account edges', () => {
        const vault = createVault(CRM);
        const payload = vault.graph2('rico', { scope: 'vault' });
        assert.equal(payload.model.summary.edgeCount, 3,
            'expected 3 edges (rico→mi, dizzy→mi, carmen→mi)');
        vault.destroy();
    });

    test('vault scope payload has empty filters', () => {
        const vault = createVault(CRM);
        const payload = vault.graph2('rico', { scope: 'vault' });
        assert.ok(payload.filters, 'filters should be present');
        vault.destroy();
    });
});

// ── Hub degree ────────────────────────────────────────────────────────────────

describe('graph — hub degree correctness', () => {
    test('hub node has higher degree than leaf contacts in VAULT scope', () => {
        const vault = createVault(CRM);
        const payload = vault.graph2('mi', { scope: 'vault' });
        const elements = payload.model.elements;
        const miNode    = elements.find(e => e.data && e.data.id === 'mi');
        const ricoNode  = elements.find(e => e.data && e.data.id === 'rico');
        assert.ok(miNode,   'mi should be in vault graph');
        assert.ok(ricoNode, 'rico should be in vault graph');
        assert.ok(miNode.data.degree > ricoNode.data.degree,
            `mi.degree (${miNode.data.degree}) should exceed rico.degree (${ricoNode.data.degree})`);
        vault.destroy();
    });
});

// ── Model metadata ────────────────────────────────────────────────────────────

describe('graph — model metadata', () => {
    test('nodeDetails is present for each visible node', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi',   'account')
        });
        const payload = vault.graph2('rico');
        assert.ok(payload.model.nodeDetails, 'nodeDetails should be present');
        assert.ok('rico' in payload.model.nodeDetails, 'rico should be in nodeDetails');
        assert.ok('mi'   in payload.model.nodeDetails, 'mi should be in nodeDetails');
        vault.destroy();
    });

    test('nodeDetails.outgoing for center note describes its edge targets', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi',   'account')
        });
        const payload = vault.graph2('rico');
        const ricoDetails = payload.model.nodeDetails['rico'];
        assert.ok(Array.isArray(ricoDetails.outgoing), 'outgoing should be an array');
        assert.ok(ricoDetails.outgoing.some(e => e.targetId === 'mi'),
            'rico.outgoing should contain an edge to mi');
        vault.destroy();
    });

    test('facets.types includes all type values from the vault', () => {
        const vault = createVault(CRM);
        const payload = vault.graph2('mi', { scope: 'vault' });
        const typeNames = payload.facets.types.map(t => t.type);
        assert.ok(typeNames.includes('contact'), 'contact type should be in facets');
        assert.ok(typeNames.includes('account'), 'account type should be in facets');
        vault.destroy();
    });

    test('facets.relations includes the account relation field', () => {
        const vault = createVault(CRM);
        const payload = vault.graph2('mi', { scope: 'vault' });
        const relationFields = payload.facets.relations.map(r => r.field);
        assert.ok(relationFields.includes('account'), 'account relation should be in facets');
        vault.destroy();
    });

    test('topNodes is a non-empty array', () => {
        const vault = createVault(CRM);
        const payload = vault.graph2('mi', { scope: 'vault' });
        assert.ok(Array.isArray(payload.model.topNodes), 'topNodes should be an array');
        assert.ok(payload.model.topNodes.length > 0, 'topNodes should be non-empty');
        vault.destroy();
    });

    test('payload has version=2 and scope field', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi',   'account')
        });
        const payload = vault.graph2('rico');
        assert.equal(payload.version, 2);
        assert.ok(typeof payload.scope === 'string', 'scope should be a string');
        vault.destroy();
    });

    test('empty vault VAULT scope has 0 nodes and 0 edges', () => {
        const vault = createVault({});
        const payload = vault.graph2('nonexistent', { scope: 'vault' });
        assert.equal(payload.model.summary.nodeCount, 0);
        assert.equal(payload.model.summary.edgeCount, 0);
        vault.destroy();
    });
});
