'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const { createVault } = require('./lib/vaultSim');
const {
    initMutationLog,
    appendMutationEvents,
    clearMutationEvents
} = require('../src/runtime/mutationEventLog');
const { buildStaleConnectedNotes } = require('../src/features/entityHubModel');

// 100+ days ago (stale) and 10 days ago (fresh)
const STALE_TS = new Date(Date.now() - 100 * 86400000).toISOString();
const FRESH_TS = new Date(Date.now() - 10 * 86400000).toISOString();

describe('buildStaleConnectedNotes', () => {
    let vault;

    beforeEach(() => {
        initMutationLog(null);
        clearMutationEvents();
    });

    after(() => { if (vault) vault.destroy(); });

    test('returns empty array when no connected notes', () => {
        vault = createVault({
            'rico.md': '---\nid: rico\ntype: contact\n---\n'
        });
        const idIndex = vault.idIndex;
        const fieldsCache = vault.fieldsCache;
        const result = buildStaleConnectedNotes('rico', idIndex, fieldsCache);
        assert.deepEqual(result, []);
        vault.destroy();
        vault = null;
    });

    test('returns empty when connected note has no mutation events', () => {
        vault = createVault({
            'rico.md': '---\nid: rico\ntype: contact\nunit: "[[roughnecks]]"\n---\n',
            'roughnecks.md': '---\nid: roughnecks\ntype: unit\n---\n'
        });
        const idIndex = vault.idIndex;
        const fieldsCache = vault.fieldsCache;
        const result = buildStaleConnectedNotes('rico', idIndex, fieldsCache);
        assert.deepEqual(result, []);
        vault.destroy();
        vault = null;
    });

    test('returns connected note with stale events', () => {
        vault = createVault({
            'rico.md': '---\nid: rico\ntype: contact\nunit: "[[roughnecks]]"\n---\n',
            'roughnecks.md': '---\nid: roughnecks\ntype: unit\nname: Roughnecks\n---\n'
        });
        appendMutationEvents([
            { timestamp: STALE_TS, type: 'field_changed', noteId: 'roughnecks', field: 'status', newValue: 'active' }
        ]);
        const idIndex = vault.idIndex;
        const fieldsCache = vault.fieldsCache;
        const result = buildStaleConnectedNotes('rico', idIndex, fieldsCache);
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'roughnecks');
        assert.equal(result[0].label, 'Roughnecks');
        assert.equal(result[0].type, 'unit');
        assert.ok(result[0].daysSince >= 60);
        vault.destroy();
        vault = null;
    });

    test('excludes connected notes with fresh events', () => {
        vault = createVault({
            'rico.md': '---\nid: rico\ntype: contact\nunit: "[[roughnecks]]"\n---\n',
            'roughnecks.md': '---\nid: roughnecks\ntype: unit\n---\n'
        });
        appendMutationEvents([
            { timestamp: FRESH_TS, type: 'field_changed', noteId: 'roughnecks', field: 'status', newValue: 'active' }
        ]);
        const idIndex = vault.idIndex;
        const fieldsCache = vault.fieldsCache;
        const result = buildStaleConnectedNotes('rico', idIndex, fieldsCache);
        assert.deepEqual(result, []);
        vault.destroy();
        vault = null;
    });

    test('includes stale but not fresh when both exist', () => {
        vault = createVault({
            'rico.md': '---\nid: rico\ntype: contact\nunit: "[[roughnecks]]"\ncommander: "[[rasczak]]"\n---\n',
            'roughnecks.md': '---\nid: roughnecks\ntype: unit\n---\n',
            'rasczak.md': '---\nid: rasczak\ntype: contact\n---\n'
        });
        appendMutationEvents([
            { timestamp: STALE_TS, type: 'note_created', noteId: 'roughnecks' },
            { timestamp: FRESH_TS, type: 'note_created', noteId: 'rasczak' }
        ]);
        const idIndex = vault.idIndex;
        const fieldsCache = vault.fieldsCache;
        const result = buildStaleConnectedNotes('rico', idIndex, fieldsCache);
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'roughnecks');
        vault.destroy();
        vault = null;
    });

    test('caps at 5 results, sorted by most stale first', () => {
        const VERY_STALE_TS = new Date(Date.now() - 200 * 86400000).toISOString();
        vault = createVault({
            'hub.md': [
                '---', 'id: hub', 'type: hub',
                'a: "[[n1]]"', 'b: "[[n2]]"', 'c: "[[n3]]"',
                'd: "[[n4]]"', 'e: "[[n5]]"', 'f: "[[n6]]"',
                '---'
            ].join('\n'),
            'n1.md': '---\nid: n1\ntype: contact\n---\n',
            'n2.md': '---\nid: n2\ntype: contact\n---\n',
            'n3.md': '---\nid: n3\ntype: contact\n---\n',
            'n4.md': '---\nid: n4\ntype: contact\n---\n',
            'n5.md': '---\nid: n5\ntype: contact\n---\n',
            'n6.md': '---\nid: n6\ntype: contact\n---\n'
        });
        for (const id of ['n1', 'n2', 'n3', 'n4', 'n5']) {
            appendMutationEvents([{ timestamp: STALE_TS, type: 'note_created', noteId: id }]);
        }
        appendMutationEvents([{ timestamp: VERY_STALE_TS, type: 'note_created', noteId: 'n6' }]);
        const idIndex = vault.idIndex;
        const fieldsCache = vault.fieldsCache;
        const result = buildStaleConnectedNotes('hub', idIndex, fieldsCache);
        assert.equal(result.length, 5);
        assert.equal(result[0].id, 'n6');
        vault.destroy();
        vault = null;
    });
});
