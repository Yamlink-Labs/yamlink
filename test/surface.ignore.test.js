'use strict';
/**
 * surface.ignore.test.js
 *
 * Integration tests for .yamlinkignore: name rules, directory rules, path rules,
 * and their effect on idIndex membership and graph edges.
 * All tests build real vaults on disk with real ignore files.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createVault } = require('./lib/vaultSim');

const NOTE = (id, type, extra = '') =>
    `---\nid: ${id}\ntype: ${type}\n${extra}---\n`;

// ── Name rule (exact filename) ─────────────────────────────────────────────────

describe('ignore — name rule', () => {
    test('ignored file by name is absent from idIndex', () => {
        const vault = createVault({
            '.yamlinkignore': 'secret.md\n',
            'public.md': NOTE('public', 'note'),
            'secret.md': NOTE('secret', 'note')
        });
        assert.ok(vault.idIndex.has('public'), 'public should be indexed');
        assert.ok(!vault.idIndex.has('secret'), 'secret should be excluded');
        vault.destroy();
    });

    test('non-matching files are still indexed with name rule active', () => {
        const vault = createVault({
            '.yamlinkignore': 'secret.md\n',
            'visible.md': NOTE('visible', 'note'),
            'open.md':    NOTE('open',    'note')
        });
        assert.ok(vault.idIndex.has('visible'));
        assert.ok(vault.idIndex.has('open'));
        vault.destroy();
    });

    test('ignored file is absent from fieldsCache too', () => {
        const vault = createVault({
            '.yamlinkignore': 'secret.md\n',
            'public.md': NOTE('public', 'note', 'status: active\n'),
            'secret.md': NOTE('secret', 'note')
        });
        assert.ok(!vault.fieldsCache.has('secret'), 'secret should not be in fieldsCache');
        vault.destroy();
    });

    test('ignoring one file does not corrupt fieldsCache for others', () => {
        const vault = createVault({
            '.yamlinkignore': 'secret.md\n',
            'public.md': NOTE('public', 'note', 'status: active\n'),
            'secret.md': NOTE('secret', 'note')
        });
        const fields = vault.fieldsCache.get('public');
        assert.ok(fields, 'public fields should be present');
        assert.equal(fields.status, 'active');
        vault.destroy();
    });
});

// ── Directory rule (trailing slash) ───────────────────────────────────────────

describe('ignore — directory rule', () => {
    test('dir rule excludes all files inside that directory', () => {
        const vault = createVault({
            '.yamlinkignore': 'private/\n',
            'public.md':         NOTE('public', 'note'),
            'private/hidden.md': NOTE('hidden', 'note')
        });
        assert.ok(vault.idIndex.has('public'),  'public should be indexed');
        assert.ok(!vault.idIndex.has('hidden'), 'hidden inside private/ should be excluded');
        vault.destroy();
    });

    test('all files in an ignored dir are excluded', () => {
        const vault = createVault({
            '.yamlinkignore': 'private/\n',
            'private/a.md': NOTE('priv-a', 'note'),
            'private/b.md': NOTE('priv-b', 'note'),
            'public.md':    NOTE('public', 'note')
        });
        assert.ok(!vault.idIndex.has('priv-a'), 'priv-a should be excluded');
        assert.ok(!vault.idIndex.has('priv-b'), 'priv-b should be excluded');
        assert.ok(vault.idIndex.has('public'),  'public should still be indexed');
        vault.destroy();
    });

    test('dir rule does not exclude files with similar names in root', () => {
        const vault = createVault({
            '.yamlinkignore': 'private/\n',
            'private-notes.md': NOTE('private-notes', 'note'),
            'public.md':        NOTE('public',         'note')
        });
        assert.ok(vault.idIndex.has('private-notes'),
            'private-notes.md at root should not be excluded by private/ dir rule');
        vault.destroy();
    });
});

// ── Path rule (contains slash) ─────────────────────────────────────────────────

describe('ignore — path rule', () => {
    test('path rule excludes the exact relative path', () => {
        const vault = createVault({
            '.yamlinkignore': 'docs/hidden.md\n',
            'docs/hidden.md': NOTE('hidden-doc', 'note'),
            'docs/public.md': NOTE('pub-doc',    'note')
        });
        assert.ok(!vault.idIndex.has('hidden-doc'), 'hidden-doc should be excluded by path');
        assert.ok(vault.idIndex.has('pub-doc'),     'pub-doc should be indexed');
        vault.destroy();
    });
});

// ── Index vs graph separation ─────────────────────────────────────────────────

describe('ignore — index exclusion vs graph traversal', () => {
    test('ignored note is absent from idIndex', () => {
        const vault = createVault({
            '.yamlinkignore': 'secret.md\n',
            'rico.md':   NOTE('rico',   'contact', 'account: "[[secret]]"\n'),
            'secret.md': NOTE('secret', 'account')
        });
        assert.ok(!vault.idIndex.has('secret'), 'secret must not be in idIndex');
        vault.destroy();
    });

    test('ignored note is absent from fieldsCache', () => {
        const vault = createVault({
            '.yamlinkignore': 'secret.md\n',
            'rico.md':   NOTE('rico',   'contact', 'account: "[[secret]]"\n'),
            'secret.md': NOTE('secret', 'account')
        });
        assert.ok(!vault.fieldsCache.has('secret'), 'secret must not be in fieldsCache');
        vault.destroy();
    });

    test('graph traversal reaches ignored note as unknown type (edge still registered)', () => {
        const vault = createVault({
            '.yamlinkignore': 'secret.md\n',
            'rico.md':   NOTE('rico',   'contact', 'account: "[[secret]]"\n'),
            'secret.md': NOTE('secret', 'account')
        });
        // The edge from rico to secret IS stored in the graph module (extracted from
        // rico.md during indexing), so traversal still reaches secret. It appears
        // with type='unknown' since it has no fieldsCache entry.
        const payload    = vault.graph2('rico');
        const secretNode = payload.model.elements.find(e => e.data && e.data.id === 'secret');
        assert.ok(secretNode, 'secret is still reachable via graph traversal');
        assert.equal(secretNode.data.type, 'unknown',
            'ignored note appears with type=unknown (no fieldsCache entry)');
        vault.destroy();
    });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('ignore — edge cases', () => {
    test('empty ignore file excludes nothing', () => {
        const vault = createVault({
            '.yamlinkignore': '',
            'a.md': NOTE('a', 'note'),
            'b.md': NOTE('b', 'note')
        });
        assert.ok(vault.idIndex.has('a'));
        assert.ok(vault.idIndex.has('b'));
        vault.destroy();
    });

    test('comment lines in ignore file are skipped', () => {
        const vault = createVault({
            '.yamlinkignore': '# this is a comment\n',
            'a.md': NOTE('a', 'note')
        });
        assert.ok(vault.idIndex.has('a'), 'a should not be excluded by a comment line');
        vault.destroy();
    });

    test('vault with no ignore file indexes everything', () => {
        const vault = createVault({
            'a.md': NOTE('a', 'note'),
            'b.md': NOTE('b', 'note')
        });
        assert.ok(vault.idIndex.has('a'));
        assert.ok(vault.idIndex.has('b'));
        vault.destroy();
    });

    test('multiple rules in ignore file apply independently', () => {
        const vault = createVault({
            '.yamlinkignore': 'secret.md\nprivate/\n',
            'public.md':         NOTE('public',  'note'),
            'secret.md':         NOTE('secret',  'note'),
            'private/hidden.md': NOTE('hidden',  'note')
        });
        assert.ok(vault.idIndex.has('public'),  'public should be indexed');
        assert.ok(!vault.idIndex.has('secret'), 'secret excluded by name rule');
        assert.ok(!vault.idIndex.has('hidden'), 'hidden excluded by dir rule');
        vault.destroy();
    });
});
