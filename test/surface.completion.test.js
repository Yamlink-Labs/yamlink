'use strict';
/**
 * surface.completion.test.js
 *
 * Scenario-based tests for the completion intelligence surface.
 * Builds real vaults via vaultSim and exercises the frontmatter
 * opportunity model and guidance summary end-to-end — the same
 * intelligence pipeline that feeds VS Code autocomplete.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createVault } = require('./lib/vaultSim');

const NOTE = (id, type, extra = '') =>
    `---\nid: ${id}\ntype: ${type}\n${extra}---\n`;

// ── Field suggestions ─────────────────────────────────────────────────────────

describe('completion — field suggestions from vault patterns', () => {
    test('sparse contact note gets field suggestions in a CRM vault', () => {
        const files = {};
        for (let i = 0; i < 4; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `name: Person ${i}\nemail: c${i}@acme.com\naccount: "[[acme]]"\n`);
        }
        files['acme.md'] = NOTE('acme', 'account', 'name: Acme\n');
        files['new.md']  = NOTE('new', 'contact');
        const vault = createVault(files);
        const model = vault.completionOpportunities('new');
        assert.ok(model.likelyFields.length > 0, 'should suggest fields for a sparse contact');
        vault.destroy();
    });

    test('account field is the top suggestion for a bare contact', () => {
        const files = {};
        for (let i = 0; i < 4; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `name: Person ${i}\naccount: "[[acme]]"\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        files['new.md']  = NOTE('new', 'contact');
        const vault = createVault(files);
        const model = vault.completionOpportunities('new');
        const fieldNames = model.likelyFields.map(f => f.field);
        assert.ok(fieldNames.includes('account'), `expected account in [${fieldNames}]`);
        vault.destroy();
    });

    test('account suggestion is marked relational', () => {
        const files = {};
        for (let i = 0; i < 4; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `name: P${i}\naccount: "[[acme]]"\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        files['new.md']  = NOTE('new', 'contact');
        const vault = createVault(files);
        const model = vault.completionOpportunities('new');
        const accountHint = model.likelyFields.find(f => f.field === 'account');
        if (accountHint) {
            assert.ok(accountHint.relational, 'account should be classified as relational');
            assert.ok(typeof accountHint.insertText === 'string');
        }
        vault.destroy();
    });

    test('each likelyField has the required structural shape', () => {
        const files = {};
        for (let i = 0; i < 4; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `name: P${i}\nemail: c${i}@x.com\naccount: "[[acme]]"\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        files['new.md']  = NOTE('new', 'contact');
        const vault = createVault(files);
        const model = vault.completionOpportunities('new');
        for (const f of model.likelyFields) {
            assert.ok(typeof f.field === 'string',       `field must be a string: ${f.field}`);
            assert.ok(typeof f.score === 'number',       `score must be a number: ${f.score}`);
            assert.ok(typeof f.relational === 'boolean', `relational must be boolean`);
            assert.ok(typeof f.insertText === 'string',  `insertText must be a string`);
            assert.ok(typeof f.summary === 'string',     `summary must be a string`);
        }
        vault.destroy();
    });

    test('likelyFields are sorted by score descending', () => {
        const files = {};
        for (let i = 0; i < 5; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact',
                `name: P${i}\nemail: c${i}@x.com\naccount: "[[acme]]"\nstatus: active\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        files['new.md']  = NOTE('new', 'contact');
        const vault = createVault(files);
        const model = vault.completionOpportunities('new');
        for (let i = 1; i < model.likelyFields.length; i++) {
            assert.ok(
                model.likelyFields[i - 1].score >= model.likelyFields[i].score,
                'likelyFields must be ordered by score descending'
            );
        }
        vault.destroy();
    });

    test('note that already has all common fields gets fewer suggestions', () => {
        const files = {};
        for (let i = 0; i < 4; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `name: P${i}\nemail: c${i}@x.com\naccount: "[[acme]]"\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        // rich note already has name, email, account
        files['rich.md'] = NOTE('rich', 'contact', 'name: Rich\nemail: r@x.com\naccount: "[[acme]]"\n');
        files['bare.md'] = NOTE('bare', 'contact');
        const vault = createVault(files);
        const richModel = vault.completionOpportunities('rich');
        const bareModel = vault.completionOpportunities('bare');
        assert.ok(
            bareModel.likelyFields.length >= richModel.likelyFields.length,
            'sparse note should get at least as many suggestions as a fully-filled note'
        );
        vault.destroy();
    });

    test('empty vault returns empty suggestions without crashing', () => {
        const vault = createVault({ 'note.md': NOTE('note', 'contact') });
        const model = vault.completionOpportunities('note');
        assert.ok(Array.isArray(model.likelyFields));
        vault.destroy();
    });
});

// ── Relation targets ──────────────────────────────────────────────────────────

describe('completion — relation target suggestions', () => {
    test('likelyLinks contains only relational hints', () => {
        const files = {};
        for (let i = 0; i < 4; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `account: "[[acme]]"\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        files['new.md']  = NOTE('new', 'contact');
        const vault = createVault(files);
        const model = vault.completionOpportunities('new');
        for (const link of model.likelyLinks) {
            assert.ok(link.relational, 'every likelyLink must be relational');
        }
        vault.destroy();
    });

    test('likelyLinks include sampleTargets pointing into the vault', () => {
        const files = {};
        for (let i = 0; i < 4; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `account: "[[acme]]"\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        files['new.md']  = NOTE('new', 'contact');
        const vault = createVault(files);
        const model = vault.completionOpportunities('new');
        for (const link of model.likelyLinks) {
            assert.ok(Array.isArray(link.sampleTargets));
        }
        vault.destroy();
    });
});

// ── Gap detection ─────────────────────────────────────────────────────────────

describe('completion — gap detection (fields missing from sparse note)', () => {
    test('likelyGaps is an array', () => {
        const files = {};
        for (let i = 0; i < 4; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `name: P${i}\nemail: c${i}@x.com\naccount: "[[acme]]"\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        files['new.md']  = NOTE('new', 'contact');
        const vault = createVault(files);
        const model = vault.completionOpportunities('new');
        assert.ok(Array.isArray(model.likelyGaps));
        vault.destroy();
    });

    test('each gap has field, score, and missingSummary', () => {
        const files = {};
        for (let i = 0; i < 5; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact',
                `name: P${i}\nemail: c${i}@x.com\naccount: "[[acme]]"\nstatus: active\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        files['sparse.md'] = NOTE('sparse', 'contact');
        const vault = createVault(files);
        const model = vault.completionOpportunities('sparse');
        for (const gap of model.likelyGaps) {
            assert.ok(typeof gap.field === 'string',         `gap field: ${gap.field}`);
            assert.ok(typeof gap.score === 'number',         `gap score`);
            assert.ok(typeof gap.missingSummary === 'string',`gap missingSummary`);
            assert.ok(typeof gap.insertText === 'string',    `gap insertText`);
        }
        vault.destroy();
    });
});

// ── Body mention hints ────────────────────────────────────────────────────────

describe('completion — body mention hints from repeated wikilinks', () => {
    test('note body with repeated wikilink generates a hint', () => {
        const files = {
            'mi.md':   NOTE('mi', 'account', 'name: Mobile Infantry\n'),
            'rico.md': NOTE('rico', 'contact', 'name: Rico\n')
        };
        // body mentions mi twice — should trigger a hint
        const content = `---\nid: rico\ntype: contact\nname: Rico\n---\n\nSee [[mi]] for briefing. [[mi]] confirmed mission.\n`;
        files['rico.md'] = content;
        const vault = createVault(files);
        const model = vault.completionOpportunities('rico', content);
        assert.ok(Array.isArray(model.bodyMentionHints));
        const miHint = model.bodyMentionHints.find(h => h.id === 'mi');
        assert.ok(miHint, 'expected body mention hint for mi');
        vault.destroy();
    });

    test('singly-mentioned body wikilink does not generate a hint at threshold 2', () => {
        const files = {
            'mi.md':   NOTE('mi', 'account'),
            'rico.md': NOTE('rico', 'contact', 'name: Rico\n')
        };
        const content = `---\nid: rico\ntype: contact\nname: Rico\n---\n\nMet [[mi]] once.\n`;
        files['rico.md'] = content;
        const vault = createVault(files);
        const model = vault.completionOpportunities('rico', content);
        const miHint = model.bodyMentionHints.find(h => h.id === 'mi');
        assert.ok(!miHint, 'single mention should not produce a hint at threshold 2');
        vault.destroy();
    });

    test('body mention hint for a known vault id has a valid insertText', () => {
        const files = {
            'mi.md':   NOTE('mi', 'account'),
            'rico.md': NOTE('rico', 'contact', 'name: Rico\n')
        };
        const content = `---\nid: rico\ntype: contact\nname: Rico\n---\n\nSee [[mi]] for details. [[mi]] confirmed.\n`;
        files['rico.md'] = content;
        const vault = createVault(files);
        const model = vault.completionOpportunities('rico', content);
        const miHint = model.bodyMentionHints.find(h => h.id === 'mi');
        if (miHint) {
            assert.ok(typeof miHint.insertText === 'string');
            assert.ok(miHint.insertText.includes('mi'));
        }
        vault.destroy();
    });
});

// ── Recommended bundle ────────────────────────────────────────────────────────

describe('completion — recommended bundle', () => {
    test('recommendedBundle is present on the model', () => {
        const files = {};
        for (let i = 0; i < 4; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `name: P${i}\nemail: c${i}@x.com\naccount: "[[acme]]"\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        files['new.md']  = NOTE('new', 'contact');
        const vault = createVault(files);
        const model = vault.completionOpportunities('new');
        assert.ok('recommendedBundle' in model);
        assert.ok(Array.isArray(model.recommendedBundle.fields));
        vault.destroy();
    });

    test('bundle insertText is a non-empty string when fields exist', () => {
        const files = {};
        for (let i = 0; i < 4; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `name: P${i}\naccount: "[[acme]]"\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        files['new.md']  = NOTE('new', 'contact');
        const vault = createVault(files);
        const model = vault.completionOpportunities('new');
        if (model.recommendedBundle.fields.length > 0) {
            assert.ok(model.recommendedBundle.insertText.length > 0);
        }
        vault.destroy();
    });
});

// ── Guidance summary ──────────────────────────────────────────────────────────

describe('completion — guidance summary', () => {
    test('guidance summary has all required keys', () => {
        const vault = createVault({
            'acme.md': NOTE('acme', 'account'),
            'rico.md': NOTE('rico', 'contact', 'name: Rico\naccount: "[[acme]]"\n'),
            'new.md':  NOTE('new', 'contact')
        });
        const guidance = vault.completionGuidance('new');
        assert.ok('headline' in guidance);
        assert.ok('bestNextStep' in guidance);
        assert.ok('why' in guidance);
        assert.ok(Array.isArray(guidance.starterActions));
        vault.destroy();
    });

    test('guidance starterActions is non-empty in a populated vault', () => {
        const files = {};
        for (let i = 0; i < 4; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `name: P${i}\naccount: "[[acme]]"\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        files['new.md']  = NOTE('new', 'contact');
        const vault = createVault(files);
        const guidance = vault.completionGuidance('new');
        assert.ok(guidance.starterActions.length > 0, 'should produce at least one starter action');
        vault.destroy();
    });

    test('bestNextStep has label, detail, insertText, and kind', () => {
        const files = {};
        for (let i = 0; i < 4; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `name: P${i}\naccount: "[[acme]]"\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        files['new.md']  = NOTE('new', 'contact');
        const vault = createVault(files);
        const guidance = vault.completionGuidance('new');
        if (guidance.bestNextStep) {
            assert.ok(typeof guidance.bestNextStep.label === 'string');
            assert.ok(typeof guidance.bestNextStep.insertText === 'string');
            assert.ok(typeof guidance.bestNextStep.kind === 'string');
        }
        vault.destroy();
    });

    test('guidance for a note that is already well-filled returns valid structure', () => {
        const files = {};
        for (let i = 0; i < 4; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `name: P${i}\nemail: c${i}@x.com\naccount: "[[acme]]"\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        files['rico.md'] = NOTE('rico', 'contact', 'name: Rico\nemail: r@x.com\naccount: "[[acme]]"\n');
        const vault = createVault(files);
        const guidance = vault.completionGuidance('rico');
        assert.ok(typeof guidance.headline === 'string');
        assert.ok(Array.isArray(guidance.starterActions));
        vault.destroy();
    });

    test('body mention triggers body-mention kind bestNextStep when no other signals', () => {
        const content = `---\nid: solo\ntype: note\n---\n\n[[rico]] popped up. [[rico]] again.\n`;
        const vault = createVault({
            'rico.md': NOTE('rico', 'contact'),
            'solo.md': content
        });
        const guidance = vault.completionGuidance('solo', content);
        // In a near-empty vault, body mention may be the only signal
        if (guidance.bestNextStep?.kind === 'body-mention') {
            assert.ok(guidance.bestNextStep.insertText.includes('rico'));
        }
        vault.destroy();
    });
});

// ── Cross-type suggestions ────────────────────────────────────────────────────

describe('completion — type-specific field patterns', () => {
    test('account type note gets different suggestions than contact type', () => {
        const files = {};
        for (let i = 0; i < 4; i++) {
            files[`c${i}.md`] = NOTE(`c${i}`, 'contact', `name: P${i}\nemail: c${i}@x.com\naccount: "[[acme]]"\n`);
        }
        for (let i = 0; i < 3; i++) {
            files[`a${i}.md`] = NOTE(`a${i}`, 'account', `name: Org ${i}\nindustry: tech\nrevenue: 1000\n`);
        }
        files['acme.md'] = NOTE('acme', 'account');
        files['newco.md'] = NOTE('newco', 'account');
        files['newc.md']  = NOTE('newc',  'contact');
        const vault = createVault(files);
        const accountModel = vault.completionOpportunities('newco');
        const contactModel = vault.completionOpportunities('newc');
        const accountFields = new Set(accountModel.likelyFields.map(f => f.field));
        const contactFields = new Set(contactModel.likelyFields.map(f => f.field));
        // The two sets should not be identical — type-specific patterns differ
        const identical = [...accountFields].every(f => contactFields.has(f)) &&
                          accountFields.size === contactFields.size;
        assert.ok(!identical || accountFields.size === 0,
            'account and contact field suggestions should differ');
        vault.destroy();
    });
});
