'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildNoteCalcHealth, buildVaultCalcHealth } = require('../src/intelligence/calcHealth');

describe('buildNoteCalcHealth', () => {
    test('counts a note with all cells evaluating successfully', () => {
        const health = buildNoteCalcHealth('`=1+1`\n`total=2+3`\n`=total*2`');
        assert.deepEqual(health, {
            total: 3,
            evaluated: 3,
            failed: 0,
            byCode: {}
        });
    });

    test('tallies mixed success and failure codes', () => {
        const health = buildNoteCalcHealth('`=1+1`\n`=Y9*2`\n`=1/0`\n`=foo(1)`\n`Y1=5`');
        assert.equal(health.total, 5);
        assert.equal(health.evaluated, 1);
        assert.equal(health.failed, 4);
        assert.equal(health.evaluated + health.failed, health.total);
        assert.deepEqual(health.byCode, {
            REF: 1,
            DIV0: 1,
            NAME: 1,
            VALUE: 1
        });
    });

    test('returns an all-zero shape for a note with no calc cells', () => {
        assert.deepEqual(buildNoteCalcHealth('# Plain note\n\nNothing calculated here.'), {
            total: 0,
            evaluated: 0,
            failed: 0,
            byCode: {}
        });
    });
});

describe('buildVaultCalcHealth', () => {
    test('aggregates totals, failure buckets, and failed-note count across notes', () => {
        const fieldsCache = new Map([
            ['clean', { type: 'report' }],
            ['broken-a', { type: 'report' }],
            ['broken-b', { type: 'report' }]
        ]);
        const idIndex = new Map([
            ['clean', 'clean.md'],
            ['broken-a', 'broken-a.md'],
            ['broken-b', 'broken-b.md']
        ]);
        const bodies = new Map([
            ['clean.md', '`=1+1`\n`x=2+2`'],
            ['broken-a.md', '`=Y9`\n`=1/0`'],
            ['broken-b.md', '`total=5+5`\n`=missing+1`']
        ]);

        const health = buildVaultCalcHealth(fieldsCache, idIndex, (filePath) => bodies.get(filePath) || null);
        assert.deepEqual(health, {
            totalCells: 6,
            evaluatedCells: 3,
            failedCells: 3,
            byCode: {
                REF: 1,
                DIV0: 1,
                NAME: 1
            },
            notesWithFailures: 2
        });
    });

    test('skips missing file paths and null bodies without throwing', () => {
        const fieldsCache = new Map([
            ['missing-path', { type: 'report' }],
            ['null-body', { type: 'report' }],
            ['clean', { type: 'report' }]
        ]);
        const idIndex = new Map([
            ['null-body', 'null-body.md'],
            ['clean', 'clean.md']
        ]);
        const health = buildVaultCalcHealth(fieldsCache, idIndex, (filePath) => {
            if (filePath === 'clean.md') return '`=2+2`';
            return null;
        });

        assert.deepEqual(health, {
            totalCells: 1,
            evaluatedCells: 1,
            failedCells: 0,
            byCode: {},
            notesWithFailures: 0
        });
    });

    test('default reader strips frontmatter before scanning real files', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-calc-health-'));
        try {
            const notePath = path.join(tmpDir, 'note.md');
            fs.writeFileSync(notePath, '---\nid: x\ntype: report\n---\n\n`total=1+2`\n', 'utf8');
            const fieldsCache = new Map([['x', { type: 'report' }]]);
            const idIndex = new Map([['x', notePath]]);

            assert.deepEqual(buildVaultCalcHealth(fieldsCache, idIndex), {
                totalCells: 1,
                evaluatedCells: 1,
                failedCells: 0,
                byCode: {},
                notesWithFailures: 0
            });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
