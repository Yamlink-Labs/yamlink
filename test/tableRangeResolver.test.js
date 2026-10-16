'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createVault } = require('./lib/vaultSim');
const { scanInlineCalcs } = require('../src/engine/inlineCalc');
const { createTableRangeResolver } = require('../src/engine/tableRangeResolver');

describe('createTableRangeResolver — real vault, real !view blocks', () => {
    test('a formula can sum a column from this note\'s own first table', () => {
        const vault = createVault({
            'unit-a.md': '---\nid: unit-a\ntype: unit\n---\n',
            'r1.md': '---\nid: r1\ntype: report\nunit: "[[unit-a]]"\nbudget: 100\n---\n',
            'r2.md': '---\nid: r2\ntype: report\nunit: "[[unit-a]]"\nbudget: 200\n---\n',
            'note.md': [
                '---',
                'id: note',
                'type: page',
                '---',
                '',
                '!view report select name, budget',
                '',
                '`=sum(T1.budget)`',
                '`=median(T1.budget)`'
            ].join('\n')
        });
        try {
            const fields = vault.fieldsCache.get('note');
            const noteBody = require('fs').readFileSync(require('path').join(vault.dir, 'note.md'), 'utf8');
            const resolveTableRange = createTableRangeResolver(noteBody.replace(/^[\s\S]*?\n---\n/, ''));
            const blocks = scanInlineCalcs(noteBody, { resolveTableRange, frontmatterFields: fields });
            const sumBlock = blocks.find((b) => b.expr === 'sum(T1.budget)');
            const medianBlock = blocks.find((b) => b.expr === 'median(T1.budget)');
            assert.equal(sumBlock.evalResult.value, 300);
            assert.equal(medianBlock.evalResult.value, 150);
        } finally {
            vault.destroy();
        }
    });

    test('a second !view block is T2, and group-by columns are addressable by their group field name', () => {
        const vault = createVault({
            'a.md': '---\nid: a\ntype: report\npriority: high\nbudget: 10\n---\n',
            'b.md': '---\nid: b\ntype: report\npriority: low\nbudget: 20\n---\n',
            'note.md': [
                '---',
                'id: note',
                'type: page',
                '---',
                '',
                '!view report select name',
                '',
                '!view report group by priority aggregate sum(budget) as total',
                '',
                '`=sum(T2.total)`'
            ].join('\n')
        });
        try {
            const noteBody = require('fs').readFileSync(require('path').join(vault.dir, 'note.md'), 'utf8');
            const resolveTableRange = createTableRangeResolver(noteBody.replace(/^[\s\S]*?\n---\n/, ''));
            const blocks = scanInlineCalcs(noteBody, { resolveTableRange });
            assert.equal(blocks[0].evalResult.value, 30);
        } finally {
            vault.destroy();
        }
    });

    test('referencing a table that does not exist yet fails honestly, not silently', () => {
        const vault = createVault({ 'note.md': '---\nid: note\ntype: page\n---\n\n`=sum(T1.budget)`' });
        try {
            const noteBody = require('fs').readFileSync(require('path').join(vault.dir, 'note.md'), 'utf8');
            const resolveTableRange = createTableRangeResolver(noteBody.replace(/^[\s\S]*?\n---\n/, ''));
            const blocks = scanInlineCalcs(noteBody, { resolveTableRange });
            assert.equal(blocks[0].evalResult.ok, false);
            assert.match(blocks[0].evalResult.error, /no !view tables yet/);
        } finally {
            vault.destroy();
        }
    });
});
