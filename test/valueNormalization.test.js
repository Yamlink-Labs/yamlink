'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createVault } = require('./lib/vaultSim');
const { findNearDuplicateScalarValue } = require('../src/intelligence/valueNormalization');

describe('findNearDuplicateScalarValue', () => {
    test('flags a casing-only near-duplicate as a normalized match', () => {
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: character\nhomeworld: Buenos Aires\n---\n',
            'carmen.md': '---\nid: carmen-ibanez\ntype: character\nhomeworld: Buenos Aires\n---\n'
        });
        try {
            const result = findNearDuplicateScalarValue('homeworld', 'buenos aires', 'character');
            assert.ok(result);
            assert.equal(result.value, 'Buenos Aires');
            assert.equal(result.count, 2);
            assert.equal(result.matchType, 'normalized');
        } finally {
            vault.destroy();
        }
    });

    test('flags a near-duplicate even when the candidate exactly matches its own note\'s already-saved value', () => {
        // Regression test: this exact scenario was caught by the LSP integration
        // test, not by the tests above — the earlier implementation reused
        // rankScalarValues() (built for completion-dropdown ranking, which
        // deliberately collapses "Buenos Aires"/"buenos aires" into ONE
        // representative candidate) as its comparison set. That collapsing is
        // correct for a completion list but wrong here: it silently discarded
        // one of the two distinct casings, and the old exact-match short-circuit
        // then bailed out entirely because the candidate — a note validating its
        // own unchanged value — trivially matched itself. A note whose own
        // value is "buenos aires" must still be flagged when a DIFFERENT note
        // has "Buenos Aires".
        const vault = createVault({
            'rico.md': '---\nid: rico\ntype: character\nhomeworld: buenos aires\n---\n',
            'carmen.md': '---\nid: carmen\ntype: character\nhomeworld: Buenos Aires\n---\n'
        });
        try {
            const result = findNearDuplicateScalarValue('homeworld', 'buenos aires', 'character');
            assert.ok(result, 'must flag even though the candidate matches its own already-saved value verbatim');
            assert.equal(result.value, 'Buenos Aires');
            assert.equal(result.matchType, 'normalized');
        } finally {
            vault.destroy();
        }
    });

    test('flags a collapsed-whitespace near-duplicate as a normalized match', () => {
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: character\nhomeworld: "New York"\n---\n'
        });
        try {
            const result = findNearDuplicateScalarValue('homeworld', 'New  York', 'character');
            assert.ok(result);
            assert.equal(result.value, 'New York');
            assert.equal(result.matchType, 'normalized');
        } finally {
            vault.destroy();
        }
    });

    test('a one-character edit distance (an inserted space) is a fuzzy match, not a normalized one', () => {
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: character\nunit: Roughnecks\n---\n'
        });
        try {
            const result = findNearDuplicateScalarValue('unit', 'Rough necks', 'character');
            assert.ok(result, 'a single inserted space is exactly the kind of typo fuzzy matching exists to catch');
            assert.equal(result.value, 'Roughnecks');
            assert.equal(result.matchType, 'fuzzy');
        } finally {
            vault.destroy();
        }
    });

    test('two genuinely unrelated values are not flagged', () => {
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: character\nunit: Roughnecks\n---\n'
        });
        try {
            const result = findNearDuplicateScalarValue('unit', 'Federal Network', 'character');
            assert.equal(result, null, 'an unrelated value beyond the fuzzy-distance threshold must not match');
        } finally {
            vault.destroy();
        }
    });

    test('flags a close typo as a fuzzy match, distinct from a normalized match', () => {
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: character\nstatus: active\n---\n'
        });
        try {
            const result = findNearDuplicateScalarValue('status', 'activ', 'character');
            assert.ok(result);
            assert.equal(result.value, 'active');
            assert.equal(result.matchType, 'fuzzy');
        } finally {
            vault.destroy();
        }
    });

    test('returns null for an exact match — nothing to flag', () => {
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: character\nstatus: active\n---\n'
        });
        try {
            assert.equal(findNearDuplicateScalarValue('status', 'active', 'character'), null);
        } finally {
            vault.destroy();
        }
    });

    test('returns null when the vault has no existing values for that field', () => {
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: character\n---\n'
        });
        try {
            assert.equal(findNearDuplicateScalarValue('status', 'active', 'character'), null);
        } finally {
            vault.destroy();
        }
    });

    test('returns null for an empty candidate value', () => {
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: character\nstatus: active\n---\n'
        });
        try {
            assert.equal(findNearDuplicateScalarValue('status', '', 'character'), null);
            assert.equal(findNearDuplicateScalarValue('status', '   ', 'character'), null);
        } finally {
            vault.destroy();
        }
    });

    test('never compares across different types', () => {
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: character\nstatus: Active\n---\n',
            'mission.md': '---\nid: mission-klendathu\ntype: mission\nstatus: active\n---\n'
        });
        try {
            const result = findNearDuplicateScalarValue('status', 'active', 'mission');
            assert.equal(result, null, 'the only near-duplicate ("Active") is on a different type and must not match');
        } finally {
            vault.destroy();
        }
    });
});
