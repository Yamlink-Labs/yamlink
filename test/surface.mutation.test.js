'use strict';
/**
 * surface.mutation.test.js
 *
 * Scenario-based tests for the vault mutation cycle: addNote, removeNote,
 * updateNote. Verifies that the index, fieldsCache, and graph reflect changes
 * after each mutation without stale state.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createVault } = require('./lib/vaultSim');

const NOTE = (id, type, extra = '') =>
    `---\nid: ${id}\ntype: ${type}\n${extra}---\n`;

// ── addNote ───────────────────────────────────────────────────────────────────

describe('mutation — addNote', () => {
    test('addNote makes the new node visible in idIndex', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact')
        });
        assert.ok(!vault.idIndex.has('dizzy'), 'dizzy not yet added');
        vault.addNote('dizzy.md', NOTE('dizzy', 'contact'));
        assert.ok(vault.idIndex.has('dizzy'), 'dizzy should be indexed after addNote');
        vault.destroy();
    });

    test('addNote preserves pre-existing nodes', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact')
        });
        vault.addNote('mi.md', NOTE('mi', 'account'));
        assert.ok(vault.idIndex.has('rico'), 'rico should still be indexed');
        assert.ok(vault.idIndex.has('mi'),   'mi should be indexed after addNote');
        vault.destroy();
    });

    test('addNote increments idIndex.size by one', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact')
        });
        const before = vault.idIndex.size;
        vault.addNote('dizzy.md', NOTE('dizzy', 'contact'));
        assert.equal(vault.idIndex.size, before + 1);
        vault.destroy();
    });

    test('addNote populates fieldsCache for the new note', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact')
        });
        vault.addNote('mi.md', NOTE('mi', 'account', 'name: Mobile Infantry\n'));
        const fields = vault.fieldsCache.get('mi');
        assert.ok(fields, 'mi should have a fieldsCache entry after addNote');
        assert.equal(fields.type, 'account');
        vault.destroy();
    });

    test('addNote with a relation creates an edge in the graph payload', () => {
        const vault = createVault({
            'mi.md': NOTE('mi', 'account')
        });
        vault.addNote('rico.md', NOTE('rico', 'contact', 'account: "[[mi]]"\n'));
        const payload = vault.graph2('rico');
        const edges = payload.model.elements.filter(e => e.data && e.data.source);
        assert.ok(
            edges.some(e => e.data.source === 'rico' && e.data.target === 'mi'),
            'expected edge rico→mi after addNote'
        );
        vault.destroy();
    });

    test('addNote to empty vault gives idIndex.size === 1', () => {
        const vault = createVault({});
        assert.equal(vault.idIndex.size, 0);
        vault.addNote('solo.md', NOTE('solo', 'note'));
        assert.equal(vault.idIndex.size, 1);
        vault.destroy();
    });
});

// ── removeNote ────────────────────────────────────────────────────────────────

describe('mutation — removeNote', () => {
    test('removeNote removes the node from idIndex', () => {
        const vault = createVault({
            'rico.md':  NOTE('rico',  'contact'),
            'dizzy.md': NOTE('dizzy', 'contact')
        });
        assert.ok(vault.idIndex.has('dizzy'));
        vault.removeNote('dizzy.md');
        assert.ok(!vault.idIndex.has('dizzy'), 'dizzy should be gone from idIndex');
        vault.destroy();
    });

    test('removeNote does not affect other nodes', () => {
        const vault = createVault({
            'rico.md':  NOTE('rico',  'contact'),
            'dizzy.md': NOTE('dizzy', 'contact')
        });
        vault.removeNote('dizzy.md');
        assert.ok(vault.idIndex.has('rico'), 'rico should still be indexed');
        vault.destroy();
    });

    test('removeNote decrements idIndex.size by one', () => {
        const vault = createVault({
            'rico.md':  NOTE('rico',  'contact'),
            'dizzy.md': NOTE('dizzy', 'contact')
        });
        const before = vault.idIndex.size;
        vault.removeNote('dizzy.md');
        assert.equal(vault.idIndex.size, before - 1);
        vault.destroy();
    });

    test('removeNote removes the node from fieldsCache', () => {
        const vault = createVault({
            'rico.md':  NOTE('rico',  'contact'),
            'dizzy.md': NOTE('dizzy', 'contact')
        });
        vault.removeNote('dizzy.md');
        assert.ok(!vault.fieldsCache.has('dizzy'), 'dizzy should be removed from fieldsCache');
        vault.destroy();
    });

    test('removeNote removes outgoing edges from the deleted node', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi',   'account')
        });
        vault.removeNote('rico.md');
        const payload = vault.graph2('mi');
        const edges = payload.model.elements.filter(e => e.data && e.data.source);
        assert.equal(edges.length, 0, 'no edges should remain after rico is removed');
        vault.destroy();
    });
});

// ── updateNote ────────────────────────────────────────────────────────────────

describe('mutation — updateNote', () => {
    test('updateNote reflects changed field value in fieldsCache', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'status: active\n')
        });
        assert.equal(vault.fieldsCache.get('rico').status, 'active');
        vault.updateNote('rico.md', NOTE('rico', 'contact', 'status: inactive\n'));
        assert.equal(vault.fieldsCache.get('rico').status, 'inactive');
        vault.destroy();
    });

    test('updateNote preserves the node id in idIndex', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact')
        });
        vault.updateNote('rico.md', NOTE('rico', 'contact', 'status: updated\n'));
        assert.ok(vault.idIndex.has('rico'), 'rico should still be in idIndex after update');
        vault.destroy();
    });

    test('updateNote that adds a relation creates a new edge', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact'),
            'mi.md':   NOTE('mi',   'account')
        });
        const before = vault.graph2('rico').model.summary.edgeCount;
        assert.equal(before, 0, 'no edges before relation is added');
        vault.updateNote('rico.md', NOTE('rico', 'contact', 'account: "[[mi]]"\n'));
        const after = vault.graph2('rico').model.summary.edgeCount;
        assert.equal(after, 1, 'edge should appear after relation is added');
        vault.destroy();
    });

    test('updateNote that removes a relation removes the edge', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi',   'account')
        });
        vault.updateNote('rico.md', NOTE('rico', 'contact'));
        const payload = vault.graph2('rico');
        const edges = payload.model.elements.filter(e => e.data && e.data.source);
        assert.equal(edges.length, 0, 'edge should be gone after relation is removed');
        vault.destroy();
    });

    test('updateNote type change updates the type in fieldsCache', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact')
        });
        assert.equal(vault.fieldsCache.get('rico').type, 'contact');
        vault.updateNote('rico.md', NOTE('rico', 'person'));
        assert.equal(vault.fieldsCache.get('rico').type, 'person');
        vault.destroy();
    });

    test('updateNote does not affect other notes', () => {
        const vault = createVault({
            'rico.md':  NOTE('rico',  'contact', 'status: active\n'),
            'dizzy.md': NOTE('dizzy', 'contact', 'status: active\n')
        });
        vault.updateNote('rico.md', NOTE('rico', 'contact', 'status: inactive\n'));
        assert.equal(vault.fieldsCache.get('dizzy').status, 'active',
            'dizzy should be unaffected by rico update');
        vault.destroy();
    });
});
