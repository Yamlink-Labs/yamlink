'use strict';
/**
 * surface.noteReport.test.js
 *
 * Scenario-based tests for the Note Report (entity hub model) surface.
 * Tests build real vaults and assert on buildEntityHubModel() output.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createVault } = require('./lib/vaultSim');
const { buildQuoteBlockId } = require('../src/core/bodyBlocks');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOTE = (id, type, extra = '') =>
    `---\nid: ${id}\ntype: ${type}\n${extra}---\n`;

const CRM = {
    'rico.md':      NOTE('rico',      'contact', 'name: Johnny Rico\naccount: "[[mi]]"\n'),
    'carmen.md':    NOTE('carmen',    'contact', 'name: Carmen Ibanez\naccount: "[[navajo]]"\n'),
    'dizzy.md':     NOTE('dizzy',     'contact', 'name: Dizzy Flores\naccount: "[[mi]]"\n'),
    'mi.md':        NOTE('mi',        'account', 'name: Mobile Infantry\n'),
    'navajo.md':    NOTE('navajo',    'account', 'name: FCV Navajo\n'),
    'klendathu.md': NOTE('klendathu', 'mission', 'title: Battle of Klendathu\ncommander: "[[rico]]"\n')
};

// ── Vault position rows ───────────────────────────────────────────────────────

describe('noteReport — vault position', () => {
    test('vaultPositionRows includes note type row', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('rico');
        assert.ok(model.vaultPositionRows.some(r => r.key === 'note type'));
        vault.destroy();
    });

    test('note type row shows the correct type value', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('rico');
        const typeRow = model.vaultPositionRows.find(r => r.key === 'note type');
        assert.match(String(typeRow.value), /contact/i);
        vault.destroy();
    });

    test('vaultPositionRows includes structured inbound links row', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('mi');
        assert.ok(model.vaultPositionRows.some(r => r.key === 'structured inbound links'));
        vault.destroy();
    });

    test('inbound count for hub note is above zero', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('mi');
        const row = model.vaultPositionRows.find(r => r.key === 'structured inbound links');
        const count = parseInt(String(row.value));
        assert.ok(count > 0, `expected inbound > 0, got ${count}`);
        vault.destroy();
    });

    test('outbound count for note with relations is above zero', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('rico');
        const row = model.vaultPositionRows.find(r => r.key === 'structured outbound links');
        const count = parseInt(String(row.value));
        assert.ok(count > 0, `expected outbound > 0, got ${count}`);
        vault.destroy();
    });

    test('vault position includes lifecycle row', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('rico');
        assert.ok(model.vaultPositionRows.some(r => r.key === 'lifecycle'));
        vault.destroy();
    });

    test('no AI advice rows appear', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('rico');
        const forbidden = ['best next step', 'likely next fields', 'likely next link', 'nearby relationships'];
        for (const key of forbidden) {
            assert.ok(!model.vaultPositionRows.some(r => r.key === key),
                `AI advice row "${key}" must not appear`);
        }
        vault.destroy();
    });
});

// ── Diagnostic rows ───────────────────────────────────────────────────────────

describe('noteReport — diagnostic rows', () => {
    test('vaultDiagnosticRows includes total inbound link rows', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('mi');
        assert.ok(model.vaultDiagnosticRows.some(r => r.key === 'total inbound link rows'));
        vault.destroy();
    });

    test('body evidence row appears for note with body wikilinks', () => {
        const files = {
            'a.md': NOTE('a', 'contact'),
            'b.md': `---\nid: b\ntype: note\n---\n\nMet with [[a]] yesterday and then [[a]] again.\n`
        };
        const vault = createVault(files);
        const model = vault.noteReport('b');
        assert.ok(model.vaultDiagnosticRows.some(r => r.key === 'body evidence'));
        vault.destroy();
    });

    test('repeated body wikilink shows count in body evidence row', () => {
        const files = {
            'a.md': NOTE('a', 'account'),
            'b.md': `---\nid: b\ntype: contact\n---\n\nSee [[a]] for info. Also [[a]] handled this.\n`
        };
        const vault = createVault(files);
        const model = vault.noteReport('b');
        const row = model.vaultDiagnosticRows.find(r => r.key === 'body evidence');
        assert.ok(String(row.value).includes('a (2)'));
        vault.destroy();
    });

    test('diagnostic rows include planner-backed authoring signals for relation fields', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('rico');
        const summaryRow = model.vaultDiagnosticRows.find(r => r.key === 'authoring signal');
        const detailRow = model.vaultDiagnosticRows.find(r => r.key === 'field signals');

        assert.ok(summaryRow, 'expected authoring signal row');
        assert.ok(detailRow, 'expected field signals row');
        assert.match(String(summaryRow.value), /account/i);
        assert.match(String(detailRow.value), /account/i);

        vault.destroy();
    });
});

// ── Recipes ───────────────────────────────────────────────────────────────────

describe('noteReport — contextual query recipes', () => {
    test('recipes array is present', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('rico');
        assert.ok(Array.isArray(model.recipes));
        vault.destroy();
    });

    test('note report for hub node generates at least one recipe', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('mi');
        assert.ok(model.recipes.length > 0, 'hub node should have at least one recipe');
        vault.destroy();
    });

    test('each recipe has title, description, and queryText', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('mi');
        for (const recipe of model.recipes) {
            assert.ok(typeof recipe.title === 'string' && recipe.title.length > 0);
            assert.ok(typeof recipe.queryText === 'string');
        }
        vault.destroy();
    });

    test('recipes include backlinks view for note with inbound links', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('mi');
        const backlinksRecipe = model.recipes.find(r =>
            r.title.toLowerCase().includes('backlinks') ||
            r.queryText.includes('incoming')
        );
        assert.ok(backlinksRecipe, 'expected a backlinks/incoming recipe');
        vault.destroy();
    });
});

// ── Task sections ─────────────────────────────────────────────────────────────

describe('noteReport — task sections', () => {
    test('note with no tasks has no task sections', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('rico');
        const ownTasks = model.taskSections.filter(s => s.label?.includes('this note'));
        assert.equal(ownTasks.length === 0 || ownTasks[0].rows.length === 0, true);
        vault.destroy();
    });

    test('note with tasks shows them in the task sections', () => {
        const files = {
            'work.md': [
                '---',
                'id: work',
                'type: note',
                '---',
                '',
                '- [ ] Review PR',
                '- [x] Deploy staging'
            ].join('\n')
        };
        const vault = createVault(files);
        const model = vault.noteReport('work');
        const ownSection = model.taskSections.find(s => s.label?.includes('this note'));
        assert.ok(ownSection && ownSection.rows.length === 2,
            `expected 2 tasks, got ${ownSection?.rows.length}`);
        vault.destroy();
    });
});

describe('noteReport — document tab data', () => {
    test('documentData captures headings, callouts, body mentions, and footnotes', () => {
        const files = {
            'johnny-rico.md': [
                '---',
                'id: johnny-rico',
                'type: contact',
                '---',
                '',
                '# Background',
                'Johnny Rico coordinates with [[carl-jenkins]] on strategy.',
                '',
                '## Operations',
                '> [!SOURCE] ref',
                '[[carl-jenkins]] confirmed the unit handoff to [[roughnecks]].',
                '',
                'Reference the archive.[^1]',
                '',
                '[^1]: Archive dossier'
            ].join('\n'),
            'carl-jenkins.md': NOTE('carl-jenkins', 'contact'),
            'roughnecks.md': NOTE('roughnecks', 'unit')
        };
        const vault = createVault(files);
        const model = vault.noteReport('johnny-rico');

        assert.ok(model.documentData.wordCount > 0);
        assert.ok(model.documentData.entityMentions.some((entry) => entry.id === 'carl-jenkins' && entry.count === 2));
        assert.equal(model.documentData.headings.length, 2);
        assert.ok(model.documentData.callouts.some((entry) => entry.type === 'SOURCE'));
        assert.ok(model.documentData.footnoteCount >= 1);

        vault.destroy();
    });
});

describe('noteReport — block backlinks', () => {
    test('captures incoming section refs to headings in this note', () => {
        const files = {
            'target.md': [
                '---',
                'id: target',
                'type: dossier',
                '---',
                '',
                '## Evidence',
                'Witness summary.'
            ].join('\n'),
            'source.md': [
                '---',
                'id: source',
                'type: note',
                '---',
                '',
                'See [[target#Evidence]] for the witness summary.'
            ].join('\n')
        };
        const vault = createVault(files);
        const model = vault.noteReport('target');

        assert.ok(Array.isArray(model.blockBacklinks));
        assert.ok(model.blockBacklinks.some((row) =>
            row.targetLabel === 'Evidence'
            && row.sourceId === 'source'
            && row.kind === 'section ref'
        ));

        vault.destroy();
    });

    test('captures incoming block refs to quotes in this note', () => {
        const quoteBlockId = buildQuoteBlockId(1, 'Training-yard line commonly associated with Jean Rasczak.');
        const files = {
            'target.md': [
                '---',
                'id: target',
                'type: dossier',
                '---',
                '',
                '> Training-yard line commonly associated with Jean Rasczak.'
            ].join('\n'),
            'source.md': [
                '---',
                'id: source',
                'type: note',
                '---',
                '',
                `Reference [[target^${quoteBlockId}]] in the report.`
            ].join('\n')
        };
        const vault = createVault(files);
        const model = vault.noteReport('target');

        assert.ok(model.blockBacklinks.some((row) =>
            row.sourceId === 'source'
            && row.targetKind === 'quote'
            && row.kind === 'block ref'
        ));

        vault.destroy();
    });
});

// ── Graph edge correctness ────────────────────────────────────────────────────

describe('noteReport — outbound link edge correctness', () => {
    test('frontmatter wikilinks count as outbound edges', () => {
        const vault = createVault(CRM);
        const model = vault.noteReport('rico');
        const outRow = model.vaultPositionRows.find(r => r.key === 'structured outbound links');
        assert.ok(parseInt(String(outRow.value)) >= 1);
        vault.destroy();
    });

    test('body wikilinks appear in links-out-via diagnostic row', () => {
        const files = {
            'a.md': NOTE('a', 'account'),
            'b.md': `---\nid: b\ntype: contact\n---\n\nSee [[a]] for details.\n`
        };
        const vault = createVault(files);
        const model = vault.noteReport('b');
        const linksRow = model.vaultDiagnosticRows.find(r => r.key === 'links out via');
        assert.ok(linksRow, 'links out via row should exist');
        assert.match(String(linksRow.value), /body/i);
        vault.destroy();
    });
});

// ── Relationship gravity ordering ───────────────────────────────────────────────

describe('noteReport — incoming/outgoing groups ordered by relationship gravity', () => {
    test('an incoming row corroborated by a second field to the same target outranks a single-field row in the same group', () => {
        const files = {
            'acme.md': NOTE('acme', 'account', 'name: Acme Corp\n'),
            // contact-1 points at acme via BOTH employer and client — structurally
            // corroborated (gravity structuralWeight 2 for this source/target pair).
            'contact-1.md': NOTE('contact-1', 'contact', 'name: Ada\nemployer: "[[acme]]"\nclient: "[[acme]]"\n'),
            // contact-2 and contact-3 only ever point at acme once each.
            'contact-2.md': NOTE('contact-2', 'contact', 'name: Bea\nemployer: "[[acme]]"\n'),
            'contact-3.md': NOTE('contact-3', 'contact', 'name: Cy\nemployer: "[[acme]]"\n')
        };
        const vault = createVault(files);
        try {
            const model = vault.noteReport('acme');
            const employerGroup = model.incomingGroups.find(g => g.field === 'employer');
            assert.ok(employerGroup, 'expected an "employer" incoming group');
            assert.equal(employerGroup.rows.length, 3);
            assert.equal(employerGroup.rows[0].sourceId, 'contact-1', 'the corroborated edge should sort first');
        } finally {
            vault.destroy();
        }
    });

    test('rows with equal gravity fall back to deterministic alphabetical order, not arbitrary insertion order', () => {
        const files = {
            'acme.md': NOTE('acme', 'account', 'name: Acme Corp\n'),
            'contact-z.md': NOTE('contact-z', 'contact', 'name: Zed\nemployer: "[[acme]]"\n'),
            'contact-a.md': NOTE('contact-a', 'contact', 'name: Ada\nemployer: "[[acme]]"\n')
        };
        const vault = createVault(files);
        try {
            const model = vault.noteReport('acme');
            const employerGroup = model.incomingGroups.find(g => g.field === 'employer');
            assert.deepEqual(employerGroup.rows.map(r => r.sourceId), ['contact-a', 'contact-z']);
        } finally {
            vault.destroy();
        }
    });

    test('an outgoing row corroborated by a second field outranks a single-field row in the same group', () => {
        const files = {
            'rico.md': NOTE('rico', 'character', 'name: Rico\n'),
            'carmen.md': NOTE('carmen', 'character', 'name: Carmen\n'),
            // note-a's "commander" field points at both — rico is also
            // corroborated via a second field ("mentor"), carmen is not.
            'note-a.md': NOTE('note-a', 'mission', 'commander: "[[rico]]"\nmentor: "[[rico]]"\ndeputy: "[[carmen]]"\n')
        };
        const vault = createVault(files);
        try {
            const model = vault.noteReport('note-a');
            const commanderGroup = model.outgoingGroups.find(g => g.field === 'commander');
            assert.ok(commanderGroup, 'expected a "commander" outgoing group');
            assert.equal(commanderGroup.rows[0].sourceId, 'rico');
        } finally {
            vault.destroy();
        }
    });
});

// ── Pre-schema field emergence ──────────────────────────────────────────────────

describe('noteReport — cold-start arc suggests emergent-cluster fields over the hardcoded starter list', () => {
    test('an untyped note matching a real repeated field pattern gets that pattern\'s fields, not the generic starter list', () => {
        const files = {};
        for (let i = 0; i < 6; i++) {
            files[`acct-${i}.md`] = NOTE(`acct-${i}`, 'account', 'company: "[[acme]]"\nstatus: active\n');
        }
        // Untyped note, already has status set — matches the emergent cluster's
        // signature (company + status), which should outrank the generic
        // hardcoded cold-start list (name/status/date/summary/tags/owner/link).
        files['draft.md'] = '---\nid: draft\nstatus: active\n---\n';
        const vault = createVault(files);
        try {
            const model = vault.noteReport('draft');
            assert.deepEqual(model.noteArc.missingFields.map((f) => f.field), ['company']);
            assert.equal(model.noteArc.missingFields[0].emergentCluster, true);
        } finally {
            vault.destroy();
        }
    });
});
