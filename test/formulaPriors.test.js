'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildFormulaPriors, getCachedFormulaPriors, resetFormulaPriorsCache } = require('../src/intelligence/formulaPriors');

function makeFixture(fieldsEntries, bodiesByPath) {
    const fieldsCache = new Map(fieldsEntries.map(([id, type]) => [id, { type }]));
    const idIndex = new Map(fieldsEntries.map(([id]) => [id, `${id}.md`]));
    const readBody = (filePath) => bodiesByPath.get(filePath) ?? null;
    return { fieldsCache, idIndex, readBody };
}

describe('buildFormulaPriors', () => {
    test('a named formula repeated across same-typed notes is tallied with the right count', () => {
        const { fieldsCache, idIndex, readBody } = makeFixture(
            [['e1', 'expense'], ['e2', 'expense'], ['e3', 'expense']],
            new Map([
                ['e1.md', '`total=10*3`'],
                ['e2.md', '`total=10*3`'],
                ['e3.md', '`total=10*3`']
            ])
        );
        const priors = buildFormulaPriors(fieldsCache, idIndex, readBody);
        const expensePatterns = priors.get('expense');
        assert.equal(expensePatterns.length, 1);
        assert.equal(expensePatterns[0].name, 'total');
        assert.equal(expensePatterns[0].expr, '10*3');
        assert.equal(expensePatterns[0].count, 3);
    });

    test('patterns are bucketed per note type — an expense pattern never leaks into an unrelated type', () => {
        const { fieldsCache, idIndex, readBody } = makeFixture(
            [['e1', 'expense'], ['m1', 'mission']],
            new Map([
                ['e1.md', '`total=10*3`'],
                ['m1.md', '`casualties=100-20`']
            ])
        );
        const priors = buildFormulaPriors(fieldsCache, idIndex, readBody);
        assert.equal(priors.get('expense').length, 1);
        assert.equal(priors.get('mission').length, 1);
        assert.equal(priors.has('casualties'), false);
    });

    test('the same name with a DIFFERENT expression is tracked as a separate pattern, not merged', () => {
        const { fieldsCache, idIndex, readBody } = makeFixture(
            [['e1', 'expense'], ['e2', 'expense']],
            new Map([
                ['e1.md', '`total=10*3`'],
                ['e2.md', '`total=10+5`']
            ])
        );
        const priors = buildFormulaPriors(fieldsCache, idIndex, readBody);
        const patterns = priors.get('expense');
        assert.equal(patterns.length, 2);
        assert.equal(patterns.every((p) => p.count === 1), true);
    });

    test('an unnamed cell (automatic Y<N> label only) is never counted — no reusable intent', () => {
        const { fieldsCache, idIndex, readBody } = makeFixture(
            [['e1', 'expense']],
            new Map([['e1.md', '`=10*3`']])
        );
        const priors = buildFormulaPriors(fieldsCache, idIndex, readBody);
        assert.equal(priors.has('expense'), false);
    });

    test('a failed cell is never counted as a pattern — only successfully-evaluated formulas teach the vault', () => {
        const { fieldsCache, idIndex, readBody } = makeFixture(
            [['e1', 'expense']],
            new Map([['e1.md', '`total=price*`']])
        );
        const priors = buildFormulaPriors(fieldsCache, idIndex, readBody);
        assert.equal(priors.has('expense'), false);
    });

    test('a note with no type, a missing file path, or a null body is skipped without throwing', () => {
        const fieldsCache = new Map([
            ['no-type', {}],
            ['missing-path', { type: 'expense' }],
            ['null-body', { type: 'expense' }]
        ]);
        const idIndex = new Map([['null-body', 'null-body.md']]);
        const priors = buildFormulaPriors(fieldsCache, idIndex, () => null);
        assert.equal(priors.size, 0);
    });

    test('results are sorted by descending count within each type', () => {
        const { fieldsCache, idIndex, readBody } = makeFixture(
            [['e1', 'expense'], ['e2', 'expense'], ['e3', 'expense']],
            new Map([
                ['e1.md', '`total=10*3`\n`rare=1+1`'],
                ['e2.md', '`total=10*3`'],
                ['e3.md', '`total=10*3`']
            ])
        );
        const priors = buildFormulaPriors(fieldsCache, idIndex, readBody);
        const patterns = priors.get('expense');
        assert.equal(patterns[0].name, 'total');
        assert.equal(patterns[0].count, 3);
        assert.equal(patterns[1].name, 'rare');
        assert.equal(patterns[1].count, 1);
    });

    test('the default reader strips frontmatter before scanning real files', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-formula-priors-'));
        try {
            const notePath = path.join(tmpDir, 'note.md');
            fs.writeFileSync(notePath, '---\nid: e1\ntype: expense\n---\n\n`total=10*3`\n', 'utf8');
            const fieldsCache = new Map([['e1', { type: 'expense' }]]);
            const idIndex = new Map([['e1', notePath]]);
            const priors = buildFormulaPriors(fieldsCache, idIndex);
            assert.equal(priors.get('expense')[0].expr, '10*3');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('getCachedFormulaPriors', () => {
    test('recomputes only when the generation changes', () => {
        resetFormulaPriorsCache();
        let readCount = 0;
        const { fieldsCache, idIndex } = makeFixture(
            [['e1', 'expense']],
            new Map([['e1.md', '`total=10*3`']])
        );
        const readBody = (filePath) => { readCount++; return filePath === 'e1.md' ? '`total=10*3`' : null; };

        const first = getCachedFormulaPriors(fieldsCache, idIndex, 1, readBody);
        const second = getCachedFormulaPriors(fieldsCache, idIndex, 1, readBody);
        assert.equal(first, second); // same cached object, no recompute
        assert.equal(readCount, 1); // only scanned once across both calls

        getCachedFormulaPriors(fieldsCache, idIndex, 2, readBody);
        assert.equal(readCount, 2); // generation changed, recomputed
    });
});
