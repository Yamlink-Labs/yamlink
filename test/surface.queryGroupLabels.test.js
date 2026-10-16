'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createVault } = require('./lib/vaultSim');

describe('group by — wikilink field values', () => {
    test('a single wikilink groups under its target name, not raw brackets', () => {
        const vault = createVault({
            'unit-a.md': '---\nid: roughnecks\ntype: unit\n---\n',
            'r1.md': '---\nid: r1\ntype: report\nunit: "[[roughnecks]]"\n---\n',
            'r2.md': '---\nid: r2\ntype: report\nunit: "[[roughnecks|Roughnecks]]"\n---\n',
            'r3.md': '---\nid: r3\ntype: report\nunit: Sky Patrol\n---\n'
        });
        try {
            const r = vault.query('!view report group by unit');
            const keys = r.groups.map((g) => [g.key, g.count]).sort((a, b) => a[0].localeCompare(b[0]));
            assert.deepEqual(keys, [['roughnecks', 2], ['Sky Patrol', 1]]);
        } finally {
            vault.destroy();
        }
    });
});

describe('aggregate with a when condition', () => {
    test('a when condition folds only the matching rows, and count follows the same rule', () => {
        const vault = createVault({
            'a.md': '---\nid: a\ntype: report\npriority: high\nsquad: 10\n---\n',
            'b.md': '---\nid: b\ntype: report\npriority: low\nsquad: 4\n---\n',
            'c.md': '---\nid: c\ntype: report\npriority: high\nsquad: 6\n---\n'
        });
        try {
            const r = vault.query('!view report aggregate sum(squad) when priority = high as high_total, count when priority = high as high_count, sum(squad) as all_total');
            assert.deepEqual(r.aggregates, { high_total: 16, high_count: 2, all_total: 20 });
        } finally {
            vault.destroy();
        }
    });
});
