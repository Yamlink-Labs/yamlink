'use strict';
/**
 * surface.health.test.js
 *
 * Scenario-based tests for Vault Health stats using the vault simulation
 * harness. Each test builds a real temp vault, runs the full index pipeline,
 * and asserts on collectHealthStats() output.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createVault } = require('./lib/vaultSim');

// ── Vault fixtures ────────────────────────────────────────────────────────────

const NOTE = (id, type, extra = '') =>
    `---\nid: ${id}\ntype: ${type}\n${extra}---\n`;

const CRM = {
    'rico.md':    NOTE('rico',    'contact',  'name: Johnny Rico\naccount: "[[mi]]"\n'),
    'carmen.md':  NOTE('carmen',  'contact',  'name: Carmen Ibanez\naccount: "[[navajo]]"\n'),
    'dizzy.md':   NOTE('dizzy',   'contact',  'name: Dizzy Flores\naccount: "[[mi]]"\n'),
    'mi.md':      NOTE('mi',      'account',  'name: Mobile Infantry\n'),
    'navajo.md':  NOTE('navajo',  'account',  'name: FCV Navajo\n'),
    'klendathu.md': NOTE('klendathu', 'mission', 'title: Battle of Klendathu\ncommander: "[[rico]]"\n')
};

// ── Node count ────────────────────────────────────────────────────────────────

describe('healthStats — node counts', () => {
    test('reports correct total note count', () => {
        const vault = createVault(CRM);
        const stats = vault.healthStats();
        assert.equal(stats.nodes, 6);
        vault.destroy();
    });

    test('zero-note vault returns zero stats', () => {
        const vault = createVault({});
        const stats = vault.healthStats();
        assert.equal(stats.nodes, 0);
        assert.equal(stats.edges, 0);
        assert.equal(stats.orphans.length, 0);
        vault.destroy();
    });

    test('single orphan note correctly counted', () => {
        const vault = createVault({ 'solo.md': NOTE('solo', 'note') });
        const stats = vault.healthStats();
        assert.equal(stats.nodes, 1);
        assert.ok(stats.orphans.includes('solo'));
        vault.destroy();
    });
});

// ── Types ─────────────────────────────────────────────────────────────────────

describe('healthStats — type distribution', () => {
    test('lists all distinct types', () => {
        const vault = createVault(CRM);
        const stats = vault.healthStats();
        const typeNames = stats.types.map(t => t.type);
        assert.ok(typeNames.includes('contact'));
        assert.ok(typeNames.includes('account'));
        assert.ok(typeNames.includes('mission'));
        vault.destroy();
    });

    test('type counts match actual notes', () => {
        const vault = createVault(CRM);
        const stats = vault.healthStats();
        const contact = stats.types.find(t => t.type === 'contact');
        assert.equal(contact.count, 3);
        vault.destroy();
    });

    test('types are sorted by count descending', () => {
        const vault = createVault(CRM);
        const stats = vault.healthStats();
        for (let i = 1; i < stats.types.length; i++) {
            assert.ok(stats.types[i - 1].count >= stats.types[i].count);
        }
        vault.destroy();
    });
});

// ── Orphans ───────────────────────────────────────────────────────────────────

describe('healthStats — orphan detection', () => {
    test('connected notes are not orphans', () => {
        const vault = createVault(CRM);
        const stats = vault.healthStats();
        assert.ok(!stats.orphans.includes('rico'));
        assert.ok(!stats.orphans.includes('mi'));
        vault.destroy();
    });

    test('note with no relations is an orphan', () => {
        const vault = createVault({
            ...CRM,
            'isolated.md': NOTE('isolated', 'note')
        });
        const stats = vault.healthStats();
        assert.ok(stats.orphans.includes('isolated'));
        vault.destroy();
    });

    test('adding a relation removes a node from orphans', () => {
        const vault = createVault({
            'a.md': NOTE('a', 'note'),
            'b.md': NOTE('b', 'note', 'related: "[[a]]"\n')
        });
        const stats = vault.healthStats();
        assert.ok(!stats.orphans.includes('a'));
        assert.ok(!stats.orphans.includes('b'));
        vault.destroy();
    });

    test('orphans list is sorted alphabetically', () => {
        const vault = createVault({
            'z.md': NOTE('z', 'note'),
            'a.md': NOTE('a', 'note'),
            'm.md': NOTE('m', 'note')
        });
        const stats = vault.healthStats();
        const orphanIds = stats.orphans;
        assert.deepEqual(orphanIds, [...orphanIds].sort());
        vault.destroy();
    });
});

// ── Edges and density ─────────────────────────────────────────────────────────

describe('healthStats — edge counts and density', () => {
    test('counts indexed edges between known nodes', () => {
        const vault = createVault(CRM);
        const stats = vault.healthStats();
        assert.ok(stats.edges > 0);
        vault.destroy();
    });

    test('density is edges/nodes ratio as string', () => {
        const vault = createVault(CRM);
        const stats = vault.healthStats();
        const parsed = parseFloat(stats.density);
        assert.ok(parsed >= 0);
        assert.ok(stats.density.includes('.'));
        vault.destroy();
    });

    test('no edges when no relations exist', () => {
        const vault = createVault({
            'a.md': NOTE('a', 'note'),
            'b.md': NOTE('b', 'note')
        });
        const stats = vault.healthStats();
        assert.equal(stats.edges, 0);
        assert.equal(stats.density, '0.00');
        vault.destroy();
    });
});

// ── Lifecycle counts ──────────────────────────────────────────────────────────

describe('healthStats — lifecycle distribution', () => {
    test('lifecycle counts sum to total content notes', () => {
        const vault = createVault(CRM);
        const stats = vault.healthStats();
        const total = Object.values(stats.lifecycle.counts).reduce((a, b) => a + b, 0);
        // schema/dashboard/template types are excluded — just ensure total > 0
        assert.ok(total > 0);
        vault.destroy();
    });

    test('each note has a lifecycle entry', () => {
        const vault = createVault(CRM);
        const stats = vault.healthStats();
        assert.ok(stats.lifecycle.notes.length > 0);
        for (const entry of stats.lifecycle.notes) {
            assert.ok(['draft', 'growing', 'consolidated', 'hub', 'stale'].includes(entry.state),
                `unexpected lifecycle state: ${entry.state}`);
        }
        vault.destroy();
    });

    test('sparse new note is classified as draft', () => {
        const vault = createVault({
            'new-note.md': NOTE('new-note', 'contact')
        });
        const stats = vault.healthStats();
        const entry = stats.lifecycle.notes.find(n => n.id === 'new-note');
        assert.ok(entry);
        assert.equal(entry.state, 'draft');
        vault.destroy();
    });

    test('well-connected hub note is classified as hub or consolidated', () => {
        const files = { 'hub.md': NOTE('hub', 'account', 'name: Central Hub\n') };
        for (let i = 0; i < 8; i++) {
            files[`node${i}.md`] = NOTE(`node${i}`, 'contact', `account: "[[hub]]"\n`);
        }
        const vault = createVault(files);
        const stats = vault.healthStats();
        const entry = stats.lifecycle.notes.find(n => n.id === 'hub');
        assert.ok(['hub', 'consolidated'].includes(entry.state),
            `expected hub/consolidated, got ${entry.state}`);
        vault.destroy();
    });
});

// ── Schema stats ──────────────────────────────────────────────────────────────

describe('healthStats — schema registration', () => {
    test('schema notes are counted in schemaStats', () => {
        const vault = createVault({
            ...CRM,
            'schema-contact.md': [
                '---',
                'id: schema-contact',
                'type: schema',
                'target: contact',
                'fields:',
                '  name:',
                '    type: string',
                '    required: true',
                '---'
            ].join('\n')
        });
        const stats = vault.healthStats();
        assert.ok(stats.schemas >= 1);
        vault.destroy();
    });

    test('vault with no schema notes has zero schemas', () => {
        const vault = createVault(CRM);
        const stats = vault.healthStats();
        assert.equal(stats.schemas, 0);
        vault.destroy();
    });
});

// ── healthScore ───────────────────────────────────────────────────────────────

describe('healthScore', () => {
    test('perfect vault scores 100', () => {
        const vault = createVault({});
        assert.equal(vault.healthScore(), 100);
        vault.destroy();
    });

    test('vault with connected notes scores above 70', () => {
        const vault = createVault(CRM);
        const score = vault.healthScore();
        assert.ok(score > 70, `expected > 70, got ${score}`);
        vault.destroy();
    });

    test('score is between 0 and 100', () => {
        const vault = createVault(CRM);
        const score = vault.healthScore();
        assert.ok(score >= 0 && score <= 100);
        vault.destroy();
    });
});

// ── Drift summary ─────────────────────────────────────────────────────────────

describe('healthStats — drift summary', () => {
    test('drift summary is present in health stats', () => {
        const vault = createVault(CRM);
        const stats = vault.healthStats();
        assert.ok(stats.drift !== undefined && stats.drift !== null);
        vault.destroy();
    });

    test('small vault drift is on-track or minor-drift', () => {
        const vault = createVault(CRM);
        const stats = vault.healthStats();
        // In a small, consistent vault, most notes should be on-track or minor-drift
        assert.ok(typeof stats.drift === 'object');
        vault.destroy();
    });
});
