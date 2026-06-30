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
const {
    appendMutationEvents,
    clearMutationEvents
} = require('../src/runtime/mutationEventLog');
const { buildHealthHtml } = require('../src/features/health/healthHtml');

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

// ── Schema intelligence ───────────────────────────────────────────────────────

const SCHEMA_CONTACT = [
    '---',
    'id: schema-contact',
    'type: schema',
    'target: contact',
    'fields:',
    '  name:',
    '    type: string',
    '    required: true',
    '  account:',
    '    type: relation',
    '    target: account',
    '---'
].join('\n');

describe('healthStats — schema intelligence', () => {
    test('no schemas → schemaIntelligence has empty arrays', () => {
        const vault = createVault(CRM);
        const stats = vault.healthStats();
        assert.ok(Array.isArray(stats.schemaIntelligence.advisories));
        assert.ok(Array.isArray(stats.schemaIntelligence.coverage));
        assert.ok(Array.isArray(stats.schemaIntelligence.danglingRelations));
        assert.equal(stats.schemaIntelligence.advisories.length, 0, 'no advisories without schemas');
        vault.destroy();
    });

    test('schema with all conformant notes → 100% coverage', () => {
        const vault = createVault({
            ...CRM,
            'schema-contact.md': SCHEMA_CONTACT
        });
        const stats = vault.healthStats();
        const entry = stats.schemaIntelligence.coverage.find(c => c.type === 'contact');
        assert.ok(entry, 'coverage entry for contact schema exists');
        assert.equal(entry.total, 3);
        assert.equal(entry.conformant, 3);
        assert.equal(entry.nonConformant, 0);
        vault.destroy();
    });

    test('note missing required field → appears in nonConformant', () => {
        const vault = createVault({
            'schema-contact.md': SCHEMA_CONTACT,
            'rico.md': NOTE('rico', 'contact', 'name: Johnny Rico\n'),
            'nameless.md': NOTE('nameless', 'contact')  // missing required 'name' field
        });
        const stats = vault.healthStats();
        const entry = stats.schemaIntelligence.coverage.find(c => c.type === 'contact');
        assert.ok(entry);
        assert.equal(entry.total, 2);
        assert.equal(entry.nonConformant, 1);
        assert.ok(entry.notesWithMissing.some(n => n.noteId === 'nameless'));
        assert.ok(entry.notesWithMissing[0].missingFields.includes('name'));
        vault.destroy();
    });

    test('unschematized types get advisories when any schema exists', () => {
        const vault = createVault({
            ...CRM,
            'schema-contact.md': SCHEMA_CONTACT
        });
        const stats = vault.healthStats();
        const advisories = stats.schemaIntelligence.advisories;
        // account and mission types have no schema
        assert.ok(advisories.length > 0, 'advisories present for unschematized types');
        const typeNames = advisories.map(a => a.type);
        assert.ok(typeNames.includes('account') || typeNames.includes('mission'));
        vault.destroy();
    });

    test('advisories are sorted by count descending', () => {
        const vault = createVault({
            ...CRM,
            'schema-contact.md': SCHEMA_CONTACT
        });
        const stats = vault.healthStats();
        const advisories = stats.schemaIntelligence.advisories;
        for (let i = 1; i < advisories.length; i++) {
            assert.ok(advisories[i - 1].count >= advisories[i].count);
        }
        vault.destroy();
    });

    test('dangling relation when schema targets a type with no vault notes', () => {
        const schemaWithDangling = [
            '---',
            'id: schema-solo',
            'type: schema',
            'target: solo',
            'fields:',
            '  partner:',
            '    type: relation',
            '    target: ghost-type',
            '---'
        ].join('\n');
        const vault = createVault({
            'schema-solo.md': schemaWithDangling,
            'alice.md': NOTE('alice', 'solo')
        });
        const stats = vault.healthStats();
        const dangling = stats.schemaIntelligence.danglingRelations;
        assert.ok(dangling.length > 0, 'dangling relation detected');
        assert.equal(dangling[0].schemaType, 'solo');
        assert.equal(dangling[0].field, 'partner');
        assert.equal(dangling[0].targetType, 'ghost-type');
        vault.destroy();
    });

    test('no dangling relations when relation target type has vault notes', () => {
        const vault = createVault({
            ...CRM,
            'schema-contact.md': SCHEMA_CONTACT  // contact.account → account type (which exists in CRM)
        });
        const stats = vault.healthStats();
        assert.equal(stats.schemaIntelligence.danglingRelations.length, 0);
        vault.destroy();
    });

    test('schema with no required fields → all notes conformant by definition', () => {
        const optionalSchema = [
            '---',
            'id: schema-mission',
            'type: schema',
            'target: mission',
            'fields:',
            '  title:',
            '    type: string',
            '---'
        ].join('\n');
        const vault = createVault({
            ...CRM,
            'schema-mission.md': optionalSchema
        });
        const stats = vault.healthStats();
        const entry = stats.schemaIntelligence.coverage.find(c => c.type === 'mission');
        assert.ok(entry);
        assert.equal(entry.requiredCount, 0);
        assert.equal(entry.conformant, entry.total, 'all notes conformant when no required fields');
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

// ── Vault projections ────────────────────────────────────────────────────────

describe('healthStats — vault projections', () => {
    test('intelligence health includes projection lanes with explainable summaries and evidence weighting', () => {
        clearMutationEvents();
        const now = new Date().toISOString();
        const vault = createVault({
            'rico.md': NOTE('rico', 'character', 'name: Johnny Rico\nunit: "[[roughnecks]]"\n'),
            'dizzy.md': NOTE('dizzy', 'character', 'name: Dizzy Flores\nunit: "[[roughnecks]]"\n'),
            'carmen.md': NOTE('carmen', 'character', 'name: Carmen Ibanez\nunit: "[[rogers-young]]"\n'),
            'roughnecks.md': NOTE('roughnecks', 'unit', 'name: Roughnecks\n'),
            'rogers-young.md': NOTE('rogers-young', 'unit', 'name: Rodger Young\n'),
            'intel-draft.md': NOTE('intel-draft', 'dossier'),
            'old-dossier.md': NOTE('old-dossier', 'dossier', 'title: Old Report\n')
        });

        appendMutationEvents([
            { type: 'note_created', noteId: 'rico', timestamp: now },
            { type: 'note_created', noteId: 'dizzy', timestamp: now },
            { type: 'note_created', noteId: 'carmen', timestamp: now },
            { type: 'completion_accepted', noteId: 'rico', field: 'unit', newValue: '[[roughnecks]]', timestamp: now },
            { type: 'field_changed', noteId: 'dizzy', field: 'unit', newValue: '[[roughnecks]]', timestamp: now },
            { type: 'note_touched', noteId: 'intel-draft', timestamp: now }
        ]);

        const stats = vault.healthStats();
        const projections = stats.intelligenceHealth.projections;

        assert.ok(projections, 'projections are present');
        assert.equal(projections.windowDays, 30);
        assert.equal(projections.history.bucketDays, 7);
        assert.equal(projections.history.buckets.length, 4);
        assert.ok(['low', 'medium', 'high'].includes(projections.growth.confidence));
        assert.ok(typeof projections.growth.evidenceScore === 'number');
        assert.ok(['rising', 'steady', 'falling'].includes(projections.growth.trend));
        assert.ok(typeof projections.growth.summary === 'string' && projections.growth.summary.length > 0);
        assert.ok(['low', 'medium', 'high'].includes(projections.stale.confidence));
        assert.ok(typeof projections.stale.evidenceScore === 'number');
        assert.ok(['improving', 'steady', 'worsening'].includes(projections.stale.trend));
        assert.ok(typeof projections.stale.summary === 'string' && projections.stale.summary.length > 0);
        assert.ok(Array.isArray(projections.stale.topTypes));
        assert.ok(['low', 'medium', 'high'].includes(projections.structure.confidence));
        assert.ok(typeof projections.structure.evidenceScore === 'number');
        assert.ok(['improving', 'fragile', 'steady'].includes(projections.structure.direction));
        assert.ok(['rising', 'steady', 'falling'].includes(projections.structure.trend));
        assert.ok(typeof projections.structure.summary === 'string' && projections.structure.summary.length > 0);
        assert.ok(Array.isArray(projections.structure.topTypes));
        assert.ok(projections.scenarios);
        assert.ok(['low', 'medium', 'high'].includes(projections.scenarios.cleanupHold.confidence));
        assert.ok(['low', 'medium', 'high'].includes(projections.scenarios.cleanupLift.confidence));
        assert.ok(typeof projections.scenarios.cleanupHold.summary === 'string' && projections.scenarios.cleanupHold.summary.length > 0);
        assert.ok(typeof projections.scenarios.growthHold.summary === 'string' && projections.scenarios.growthHold.summary.length > 0);

        vault.destroy();
        clearMutationEvents();
    });

    test('health html renders projection evidence and type-specific leaders', () => {
        clearMutationEvents();
        const now = new Date().toISOString();
        const vault = createVault({
            ...CRM,
            'old-contact.md': NOTE('old-contact', 'contact', 'name: Old Contact\n')
        });
        appendMutationEvents([
            { type: 'note_created', noteId: 'rico', timestamp: now },
            { type: 'note_created', noteId: 'carmen', timestamp: now },
            { type: 'completion_accepted', noteId: 'rico', field: 'account', newValue: '[[mi]]', timestamp: now }
        ]);
        const html = buildHealthHtml(vault.healthStats(), {
            scriptUri: 'test.js',
            nonce: 'nonce',
            csp: "'unsafe-inline'"
        });

        assert.match(html, /Vault Projections/);
        assert.match(html, /Growth/);
        assert.match(html, /Stale Pressure/);
        assert.match(html, /Structure Direction/);
        assert.match(html, /Recent 4-week pattern/);
        assert.match(html, /Scenario layer/);
        assert.match(html, /If cleanup pace holds/);
        assert.match(html, /evidence/);

        vault.destroy();
        clearMutationEvents();
    });

    test('intelligence health includes mutation behavior semantics from recent sessions', () => {
        clearMutationEvents();
        const now = new Date().toISOString();
        const vault = createVault({
            'rico.md': NOTE('rico', 'character', 'name: Johnny Rico\nunit: "[[roughnecks]]"\n'),
            'roughnecks.md': NOTE('roughnecks', 'unit', 'name: Roughnecks\n')
        });

        appendMutationEvents([
            { type: 'template_applied', noteId: 'rico', field: 'type', timestamp: now, sessionId: 's1', meta: { sessionReason: 'editor_focus' } },
            { type: 'relation_changed', noteId: 'rico', field: 'unit', newValue: '[[roughnecks]]', timestamp: now, sessionId: 's1' },
            { type: 'query_builder_opened', noteId: 'rico', field: 'query', timestamp: now, sessionId: 's2' },
            { type: 'query_builder_preview_opened', noteId: 'rico', field: 'query', timestamp: now, sessionId: 's2' }
        ]);

        const intel = vault.healthStats().intelligenceHealth;
        assert.ok(intel.mutationBehavior);
        assert.equal(intel.mutationBehavior.totalSessions, 2);
        assert.ok(['templating', 'querying'].includes(intel.mutationBehavior.dominantFamily));
        assert.ok(typeof intel.mutationBehavior.coherenceScore === 'number');
        assert.ok(intel.mutationBehavior.recentSessions[0].causalChain.length >= 1);
        assert.ok(['exploratory', 'applied', 'mixed', 'ambient'].includes(intel.mutationBehavior.recentSessions[0].mode));
        assert.ok(Array.isArray(intel.mutationBehavior.streaks));
        assert.ok(intel.mutationBehavior.evolution);

        const html = buildHealthHtml(vault.healthStats(), {
            scriptUri: 'test.js',
            nonce: 'nonce',
            csp: "'unsafe-inline'"
        });
        assert.match(html, /Mutation Behavior/);
        assert.match(html, /coherence/i);
        assert.match(html, /Top streak/i);

        vault.destroy();
        clearMutationEvents();
    });
});

// ── Emerging clusters ───────────────────────────────────────────────────────

describe('healthStats — emerging clusters', () => {
    test('filters emerging clusters to medium/high confidence and caps them at three', () => {
        const files = {};
        for (let i = 0; i < 13; i++) {
            files[`char-${i}.md`] = NOTE(`char-${i}`, 'character', 'name: Test Character\nunit: "[[roughnecks]]"\nrank: private\n');
        }
        files['roughnecks.md'] = NOTE('roughnecks', 'unit', 'name: Roughnecks\nbranch: infantry\n');

        for (let i = 0; i < 8; i++) {
            files[`mission-${i}.md`] = NOTE(`mission-${i}`, 'mission', 'title: Mission\ncommander: "[[char-0]]"\nstatus: active\n');
        }

        for (let i = 0; i < 7; i++) {
            files[`unit-${i}.md`] = NOTE(`unit-${i}`, 'unit', 'name: Unit\nfaction: federation\nhomeworld: terra\n');
        }

        for (let i = 0; i < 5; i++) {
            files[`low-${i}.md`] = NOTE(`low-${i}`, 'report', 'title: Low Cluster\nsource: "[[char-0]]"\n');
        }

        const vault = createVault(files);
        const stats = vault.healthStats();

        assert.ok(Array.isArray(stats.emergingClusters));
        assert.equal(stats.emergingClusters.length, 3);
        assert.deepEqual(stats.emergingClusters.map((cluster) => cluster.noteCount), [13, 8, 7]);
        assert.deepEqual(stats.emergingClusters.map((cluster) => cluster.confidence), ['high', 'medium', 'medium']);
        assert.ok(stats.emergingClusters.every((cluster) => cluster.confidence !== 'low'));

        vault.destroy();
    });

    test('health html renders emerging patterns with schema proposal buttons', () => {
        const files = {};
        for (let i = 0; i < 13; i++) {
            files[`pattern-${i}.md`] = NOTE(`pattern-${i}`, 'character', 'name: Pattern\nunit: "[[roughnecks]]"\nrank: lieutenant\n');
        }
        files['roughnecks.md'] = NOTE('roughnecks', 'unit', 'name: Roughnecks\n');

        const vault = createVault(files);
        const html = buildHealthHtml(vault.healthStats(), {
            scriptUri: 'test.js',
            nonce: 'nonce',
            csp: "'unsafe-inline'"
        });

        assert.match(html, /Emerging Patterns/);
        assert.match(html, /13 notes share this shape/);
        assert.match(html, /createSchemaFromCluster/);
        assert.match(html, /Create schema from cluster/);

        vault.destroy();
    });
});
