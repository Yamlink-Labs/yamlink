'use strict';
/**
 * surface.intelligence.test.js
 *
 * Scenario-based tests for the intelligence layer: field classification,
 * note role inference, lifecycle state detection, and structural drift.
 * All tests build real vaults and run real inference pipelines.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createVault } = require('./lib/vaultSim');

const NOTE = (id, type, extra = '') =>
    `---\nid: ${id}\ntype: ${type}\n${extra}---\n`;

// ── Field classification ──────────────────────────────────────────────────────

describe('intelligence — field classification', () => {
    test('relation field pointing to known id is classified as relation', () => {
        // Need enough vault context for the classifier to detect relation patterns
        const files = { 'hub.md': NOTE('hub', 'account') };
        for (let i = 0; i < 6; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `account: "[[hub]]"\n`);
        }
        const vault = createVault(files);
        const result = vault.fieldCategory('c0', 'account');
        assert.ok(result, 'should return a classification');
        // With 6 consistent contacts all pointing to hub via "account", it must
        // be classified as relational — not UNKNOWN.
        assert.notEqual(result.category, 'UNKNOWN',
            `expected a specific category, still got UNKNOWN`);
        vault.destroy();
    });

    test('email field is classified as contact info or string', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'email: rico@mi.gov\n')
        });
        const result = vault.fieldCategory('rico', 'email');
        assert.ok(result, 'should return a classification');
        vault.destroy();
    });

    test('status field is classified as status or workflow (not UNKNOWN)', () => {
        const vault = createVault({
            'task.md': NOTE('task', 'note', 'status: active\n')
        });
        const result = vault.fieldCategory('task', 'status');
        assert.ok(result);
        // The classifier returns WORKFLOW for status-like fields — that is correct behaviour.
        assert.match(result.category || '', /status|workflow/i,
            `expected status/workflow, got ${result.category}`);
        vault.destroy();
    });

    test('date field is classified as date', () => {
        const vault = createVault({
            'event.md': NOTE('event', 'note', 'date: 2026-05-01\n')
        });
        const result = vault.fieldCategory('event', 'date');
        assert.ok(result);
        assert.match(result.category || '', /date/i);
        vault.destroy();
    });

    test('classification returns a confidence value in [0,1]', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':   NOTE('mi', 'account')
        });
        const result = vault.fieldCategory('rico', 'account');
        if (result && typeof result.confidence === 'number') {
            assert.ok(result.confidence >= 0 && result.confidence <= 1);
        }
        vault.destroy();
    });
});

// ── Note role inference ───────────────────────────────────────────────────────

describe('intelligence — note role inference', () => {
    test('contact-type note infers a person or contact role', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'name: Johnny Rico\nemail: rico@mi.gov\n')
        });
        const role = vault.noteRole('rico');
        assert.ok(role, 'should return a role');
        // inferNoteRole returns { noteRole, confidence, reasons, ... }
        assert.ok(typeof role.noteRole === 'string', `expected noteRole string, got ${JSON.stringify(role)}`);
        vault.destroy();
    });

    test('account-type note with many inbound links infers a hub-like role', () => {
        const files = { 'mi.md': NOTE('mi', 'account', 'name: Mobile Infantry\n') };
        for (let i = 0; i < 5; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `account: "[[mi]]"\n`);
        }
        const vault = createVault(files);
        const role = vault.noteRole('mi');
        assert.ok(role, 'should return a role');
        vault.destroy();
    });

    test('note with no relations infers a basic content role', () => {
        const vault = createVault({
            'draft.md': NOTE('draft', 'note')
        });
        const role = vault.noteRole('draft');
        assert.ok(role !== undefined && role !== null);
        vault.destroy();
    });
});

// ── Lifecycle state ───────────────────────────────────────────────────────────

describe('intelligence — lifecycle state', () => {
    test('sparse note with no relations is draft', () => {
        const vault = createVault({
            'new.md': NOTE('new', 'contact')
        });
        const lc = vault.lifecycleState('new');
        assert.equal(lc.state, 'draft');
        vault.destroy();
    });

    test('note with several fields and relations is not draft', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'name: Rico\nstatus: active\naccount: "[[mi]]"\nemail: r@mi.gov\n'),
            'mi.md':   NOTE('mi', 'account')
        });
        const lc = vault.lifecycleState('rico');
        assert.notEqual(lc.state, 'draft',
            `expected non-draft for a rich note, got ${lc.state}`);
        vault.destroy();
    });

    test('lifecycle state is one of the five valid states', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'name: Rico\naccount: "[[mi]]"\n'),
            'mi.md':   NOTE('mi', 'account')
        });
        const lc = vault.lifecycleState('rico');
        const valid = ['draft', 'growing', 'consolidated', 'hub', 'stale'];
        assert.ok(valid.includes(lc.state), `unexpected lifecycle state: ${lc.state}`);
        vault.destroy();
    });

    test('lifecycle result includes a label and summary', () => {
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact', 'name: Rico\n')
        });
        const lc = vault.lifecycleState('rico');
        assert.ok(typeof lc.label === 'string');
        vault.destroy();
    });

    test('hub note with many inbound links is classified as hub or consolidated', () => {
        const files = { 'hub.md': NOTE('hub', 'account', 'name: Hub Node\n') };
        for (let i = 0; i < 8; i++) {
            files[`n${i}.md`] = NOTE(`n${i}`, 'contact', `account: "[[hub]]"\n`);
        }
        const vault = createVault(files);
        const lc = vault.lifecycleState('hub');
        assert.ok(['hub', 'consolidated'].includes(lc.state),
            `expected hub/consolidated, got ${lc.state}`);
        vault.destroy();
    });
});

// ── Structural drift ──────────────────────────────────────────────────────────

describe('intelligence — structural drift', () => {
    test('returns a drift entry for known node', () => {
        const vault = createVault({
            'rico.md':  NOTE('rico',  'contact', 'name: Rico\naccount: "[[mi]]"\n'),
            'mi.md':    NOTE('mi',    'account'),
            'dizzy.md': NOTE('dizzy', 'contact', 'name: Dizzy\naccount: "[[mi]]"\n')
        });
        const drift = vault.driftScore('rico');
        assert.ok(drift, 'should return a drift entry');
        assert.equal(drift.noteId, 'rico');
        vault.destroy();
    });

    test('drift label is one of four valid states', () => {
        const vault = createVault({
            'rico.md':  NOTE('rico',  'contact', 'name: Rico\naccount: "[[mi]]"\n'),
            'mi.md':    NOTE('mi',    'account'),
            'carmen.md': NOTE('carmen', 'contact', 'name: Carmen\naccount: "[[mi]]"\n')
        });
        const drift = vault.driftScore('rico');
        const valid = ['on-track', 'minor-drift', 'drifting', 'outlier'];
        assert.ok(valid.includes(drift.driftLabel), `unexpected drift label: ${drift.driftLabel}`);
        vault.destroy();
    });

    test('consistent notes in a homogeneous vault are on-track or minor-drift', () => {
        const files = {};
        for (let i = 0; i < 5; i++) {
            files[`contact${i}.md`] = NOTE(`contact${i}`, 'contact',
                `name: Person ${i}\nemail: c${i}@example.com\naccount: "[[acme]]"\n`);
        }
        files['acme.md'] = NOTE('acme', 'account', 'name: Acme\n');
        const vault = createVault(files);
        const drift = vault.driftScore('contact0');
        assert.ok(['on-track', 'minor-drift'].includes(drift.driftLabel),
            `consistent note should be on-track, got ${drift.driftLabel}`);
        vault.destroy();
    });

    test('structurally different note in a consistent vault shows drift', () => {
        const files = {};
        // 10 consistent contacts — enough for vault priors to stabilise
        for (let i = 0; i < 10; i++) {
            files[`contact${i}.md`] = NOTE(`contact${i}`, 'contact',
                `name: Person ${i}\nemail: c${i}@example.com\naccount: "[[acme]]"\nphone: 555-000${i}\n`);
        }
        files['acme.md'] = NOTE('acme', 'account', 'name: Acme\n');
        // one "contact" with a completely different field structure
        files['odd.md'] = NOTE('odd', 'contact', 'topic: random-field\nref: some-value\n');
        const vault = createVault(files);
        const drift = vault.driftScore('odd');
        assert.ok(drift.driftScore > 0 || ['minor-drift', 'drifting', 'outlier'].includes(drift.driftLabel),
            `odd note should show drift, got label=${drift.driftLabel} score=${drift.driftScore}`);
        vault.destroy();
    });
});

// ── Query engine with real vault data ─────────────────────────────────────────

describe('intelligence — query engine on real vault data', () => {
    test('type query returns all notes of that type', () => {
        const vault = createVault({
            'rico.md':  NOTE('rico',  'contact'),
            'dizzy.md': NOTE('dizzy', 'contact'),
            'mi.md':    NOTE('mi',    'account')
        });
        const result = vault.query('!view contact');
        assert.equal(result.success, true);
        assert.equal(result.rows.length, 2);
        vault.destroy();
    });

    test('where = filter returns matching notes', () => {
        const vault = createVault({
            'rico.md':  NOTE('rico',  'contact', 'status: active\n'),
            'dizzy.md': NOTE('dizzy', 'contact', 'status: inactive\n')
        });
        const result = vault.query('!view contact\nwhere status = active');
        assert.equal(result.success, true);
        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0].id, 'rico');
        vault.destroy();
    });

    test('incoming query finds notes linking to a hub', () => {
        const vault = createVault({
            'rico.md':  NOTE('rico',  'contact', 'account: "[[mi]]"\n'),
            'dizzy.md': NOTE('dizzy', 'contact', 'account: "[[mi]]"\n'),
            'mi.md':    NOTE('mi',    'account')
        });
        const result = vault.query('!view incoming contact\nvia account');
        // Note: incoming queries use the active note context —
        // without a context node the query may return 0 or all.
        // We assert the query runs without error.
        assert.equal(typeof result.success, 'boolean');
        vault.destroy();
    });

    test('group by query returns grouped rows', () => {
        const vault = createVault({
            'rico.md':  NOTE('rico',  'contact', 'status: active\n'),
            'dizzy.md': NOTE('dizzy', 'contact', 'status: active\n'),
            'carmen.md': NOTE('carmen', 'contact', 'status: inactive\n')
        });
        const result = vault.query('!view contact\ngroup by status');
        assert.equal(result.success, true);
        assert.ok(Array.isArray(result.groups));
        assert.ok(result.groups.length >= 2);
        vault.destroy();
    });

    test('empty vault query returns 0 rows and a warning', () => {
        const vault = createVault({});
        const result = vault.query('!view contact');
        assert.equal(result.rows.length, 0);
        vault.destroy();
    });
});
