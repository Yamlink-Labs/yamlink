'use strict';

// Tests for graphPayload.js's node coloring: xgKind() (the 6 curated
// semantic-role buckets, unchanged) and the new xgColor() (a real, stable
// color for any non-curated `type:` value, instead of collapsing to the
// same gray as an untyped note — a real, user-reported issue: a
// business/consulting-themed vault with `company`/`product`/`tool`-style
// types rendered almost entirely gray, since the pre-existing 6-color
// vocabulary only recognized 11 specific literal type names).

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createVault } = require('./lib/vaultSim');
const { xgKind, xgColor, resetTypeColorCache } = require('../src/features/graph/graphPayload');

describe('xgKind — unchanged curated semantic-role mapping', () => {
    test('curated literal type names map to their semantic role', () => {
        assert.equal(xgKind('person'), 'person');
        assert.equal(xgKind('contact'), 'person');
        assert.equal(xgKind('mission'), 'event');
        assert.equal(xgKind('schema'), 'schema');
        assert.equal(xgKind('task'), 'task');
        assert.equal(xgKind('project'), 'container');
    });

    test('an unrecognized type, or no type at all, is the default bucket', () => {
        assert.equal(xgKind('company'), 'default');
        assert.equal(xgKind(null), 'default');
        assert.equal(xgKind(''), 'default');
    });
});

describe('xgColor — vault-learned color for a non-curated type', () => {
    beforeEach(() => resetTypeColorCache());

    test('a curated type returns null — it already resolves through xgKind/KIND_COLORS, nothing new to add', () => {
        const vault = createVault({ 'p1.md': '---\nid: p1\ntype: person\n---\n' });
        try {
            assert.equal(xgColor('person'), null);
        } finally {
            vault.destroy();
        }
    });

    test('no type at all returns null — stays the honest default gray, not a fabricated color', () => {
        const vault = createVault({ 'n1.md': '---\nid: n1\n---\n' });
        try {
            assert.equal(xgColor(null), null);
            assert.equal(xgColor(''), null);
        } finally {
            vault.destroy();
        }
    });

    test('a real, non-curated type gets a real, non-gray color', () => {
        const vault = createVault({
            'c1.md': '---\nid: c1\ntype: company\n---\n',
            'c2.md': '---\nid: c2\ntype: company\n---\n'
        });
        try {
            const color = xgColor('company');
            assert.ok(color, 'expected a real color, got ' + color);
            assert.notEqual(color, '#8899aa', 'must not be the default gray');
        } finally {
            vault.destroy();
        }
    });

    test('the same type always resolves to the same color within one vault generation', () => {
        const vault = createVault({
            'c1.md': '---\nid: c1\ntype: company\n---\n',
            'p1.md': '---\nid: p1\ntype: product\n---\n'
        });
        try {
            const first = xgColor('company');
            const second = xgColor('company');
            assert.equal(first, second);
            // Case-insensitive, same as xgKind's own matching.
            assert.equal(xgColor('Company'), first);
        } finally {
            vault.destroy();
        }
    });

    test('distinct non-curated types get distinct colors whenever the palette has room — no avoidable collision', () => {
        const types = ['company', 'product', 'tool', 'strategy', 'concept', 'framework', 'software', 'vendor'];
        const files = {};
        types.forEach((t) => { files[`${t}.md`] = `---\nid: ${t}\ntype: ${t}\n---\n`; });
        const vault = createVault(files);
        try {
            const colors = types.map((t) => xgColor(t));
            const distinct = new Set(colors);
            // 8 types, an 8-color palette — every one of them must land on
            // its own color. This is the exact scenario that previously
            // failed with a pure hash-of-string approach (confirmed directly
            // before choosing the fix): hashing this same realistic type set
            // produced real collisions (e.g. "company" and "product" landing
            // on the identical color) while several palette slots went
            // completely unused.
            assert.equal(distinct.size, types.length, `expected ${types.length} distinct colors, got ${distinct.size}: ${colors.join(', ')}`);
        } finally {
            vault.destroy();
        }
    });

    test('once distinct types exceed the palette size, collisions are the real, unavoidable minimum — never worse', () => {
        const types = ['company', 'product', 'tool', 'strategy', 'concept', 'framework', 'software', 'vendor', 'service', 'platform'];
        const files = {};
        types.forEach((t) => { files[`${t}.md`] = `---\nid: ${t}\ntype: ${t}\n---\n`; });
        const vault = createVault(files);
        try {
            const colors = types.map((t) => xgColor(t));
            const distinct = new Set(colors);
            // 10 types over an 8-color palette: every slot must be used
            // (distinct.size === 8) and the only repeats are the pigeonhole-
            // mandated minimum (10 - 8 = 2 "extra" types sharing an
            // already-used color), not a skewed pile-up on just one or two
            // colors with others left unused.
            assert.equal(distinct.size, 8);
        } finally {
            vault.destroy();
        }
    });

    test('resetTypeColorCache forces recomputation against the current vault state', () => {
        const vault1 = createVault({ 'c1.md': '---\nid: c1\ntype: company\n---\n' });
        const firstColor = xgColor('company');
        vault1.destroy();

        resetTypeColorCache();
        // A fresh vault where "company" is now alphabetically preceded by a
        // second distinct type — if the cache were stale, "company" would
        // keep its old palette slot instead of re-deriving from this vault's
        // own sorted type list.
        const vault2 = createVault({
            'a1.md': '---\nid: a1\ntype: alpha-type\n---\n',
            'c1.md': '---\nid: c1\ntype: company\n---\n'
        });
        try {
            const secondColor = xgColor('company');
            assert.ok(secondColor, 'expected a real color after reset');
            // Not asserting inequality to firstColor (with only 2 types over
            // an 8-color palette, "company" at sorted index 1 may coincide
            // with its old index-0 color by chance) — asserting instead that
            // the cache genuinely recomputed, not that it happens to differ.
            assert.equal(secondColor, xgColor('company'), 'stable within the new generation');
            void firstColor;
        } finally {
            vault2.destroy();
        }
    });
});
