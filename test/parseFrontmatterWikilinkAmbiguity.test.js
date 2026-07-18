'use strict';

// Real js-yaml regression test for a genuine data-loss bug:
// `field: [[note-id]]` written as a bare frontmatter scalar is ALSO valid
// YAML flow-sequence-of-flow-sequence syntax, so `js-yaml` parses it as a
// nested array (`[["note-id"]]`), not a string — the literal `[[...]]`
// brackets are silently lost by the time the value reaches fieldsCache
// (and therefore the mutation log and every Time Engine historical
// reconstruction downstream of it), even though the live graph's edge
// builder never sees the problem (it scans raw file text directly, bypassing
// YAML parsing entirely).
//
// Uses the real createVault() harness (real files, real js-yaml, real
// buildIndex()) rather than test/index.test.js, which stubs js-yaml with a
// simplified fake that doesn't reproduce real flow-sequence array parsing.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createVault } = require('./lib/vaultSim');
const { getEdges } = require('../src/core/graph');

describe('parseFrontmatter wikilink/YAML-array ambiguity', () => {
    test('a scalar [[wikilink]] frontmatter value keeps its literal brackets in fieldsCache', () => {
        const vault = createVault({
            'carl-jenkins.md': '---\nid: carl-jenkins\ntype: character\nunit: [[federations-fleet]]\n---\n',
            'federations-fleet.md': '---\nid: federations-fleet\ntype: unit\n---\n'
        });
        assert.equal(vault.fieldsCache.get('carl-jenkins').unit, '[[federations-fleet]]');
        // And the live graph resolves a real edge from it, same as before the fix.
        const edges = getEdges('carl-jenkins') || [];
        assert.ok(edges.some((e) => e.field === 'unit' && e.targetId === 'federations-fleet'));
        vault.destroy();
    });

    test('a YAML block list of [[wikilink]]s keeps its literal brackets in fieldsCache', () => {
        const vault = createVault({
            'squad-leader.md': '---\nid: squad-leader\ntype: character\nsquad:\n  - [[member-a]]\n  - [[member-b]]\n---\n',
            'member-a.md': '---\nid: member-a\ntype: character\n---\n',
            'member-b.md': '---\nid: member-b\ntype: character\n---\n'
        });
        assert.equal(vault.fieldsCache.get('squad-leader').squad, '[[member-a]], [[member-b]]');
        vault.destroy();
    });

    test('a [[wikilink|alias]] scalar keeps its literal brackets and pipe alias intact', () => {
        const vault = createVault({
            'a.md': '---\nid: a\ntype: note\ncommander: [[b|Display Name]]\n---\n',
            'b.md': '---\nid: b\ntype: note\n---\n'
        });
        assert.equal(vault.fieldsCache.get('a').commander, '[[b|Display Name]]');
        vault.destroy();
    });

    test('a genuine single-item plain array is not mistaken for a wikilink', () => {
        const vault = createVault({
            'a.md': '---\nid: a\ntype: note\ntags: [urgent]\n---\n'
        });
        assert.equal(vault.fieldsCache.get('a').tags, 'urgent');
        vault.destroy();
    });

    test('a genuine multi-item plain array is unaffected', () => {
        const vault = createVault({
            'a.md': '---\nid: a\ntype: note\ntags: [urgent, review]\n---\n'
        });
        assert.equal(vault.fieldsCache.get('a').tags, 'urgent, review');
        vault.destroy();
    });
});
