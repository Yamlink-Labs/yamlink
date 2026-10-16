'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createCrossNoteResolver } = require('../src/engine/crossNoteCalcResolver');

function makeResolver(bodiesByPath, idIndexEntries) {
    const idIndex = new Map(idIndexEntries);
    const bodies = new Map(bodiesByPath);
    return createCrossNoteResolver({
        getIndex: () => idIndex,
        readBody: (filePath) => bodies.get(filePath) ?? null
    });
}

describe('createCrossNoteResolver', () => {
    test('resolves a named cell in another note', () => {
        const resolve = makeResolver(
            [['/vault/budget.md', '`total=100+50`']],
            [['budget', '/vault/budget.md']]
        );
        assert.deepEqual(resolve('budget', 'total'), { ok: true, value: 150 });
    });

    test('resolves a string- or boolean-valued cell in another note unchanged, not coerced to a number', () => {
        const resolve = makeResolver(
            [['/vault/status.md', '`label="in progress"`\n`done=false`']],
            [['status', '/vault/status.md']]
        );
        assert.deepEqual(resolve('status', 'label'), { ok: true, value: 'in progress' });
        assert.deepEqual(resolve('status', 'done'), { ok: true, value: false });
    });

    test('a redefined name resolves to its LAST definition, matching same-note resolution exactly — not the first, which .find() would silently return', () => {
        const resolve = makeResolver(
            [['/vault/budget.md', '`total=1+2`\n`total=100`\n`=total*2`']],
            [['budget', '/vault/budget.md']]
        );
        // Confirm the target note's own same-note reference (Y3 = total*2)
        // really does see the redefinition, so this test's expectation is
        // grounded in real behavior, not just an assumption about it.
        const { scanInlineCalcs } = require('../src/engine/inlineCalc');
        const ownBlocks = scanInlineCalcs('`total=1+2`\n`total=100`\n`=total*2`');
        assert.equal(ownBlocks[2].evalResult.value, 200); // 100 * 2, proving same-note sees the redefinition

        assert.deepEqual(resolve('budget', 'total'), { ok: true, value: 100 });
    });

    test('resolves by automatic label just as well as by name', () => {
        const resolve = makeResolver(
            [['/vault/budget.md', '`=100+50`']],
            [['budget', '/vault/budget.md']]
        );
        assert.deepEqual(resolve('budget', 'Y1'), { ok: true, value: 150 });
    });

    test('note id lookup is case-insensitive, matching how every other note id lookup in this codebase works', () => {
        const resolve = makeResolver(
            [['/vault/budget.md', '`total=1+1`']],
            [['budget', '/vault/budget.md']]
        );
        assert.equal(resolve('BUDGET', 'total').ok, true);
    });

    test('a non-existent note id fails honestly with a clear reason', () => {
        const resolve = makeResolver([], []);
        const result = resolve('missing', 'total');
        assert.equal(result.ok, false);
        assert.match(result.reason, /Reference broken: note "missing" not found/);
    });

    test('an existing note with no matching cell name/label fails honestly', () => {
        const resolve = makeResolver(
            [['/vault/budget.md', '`other=1+1`']],
            [['budget', '/vault/budget.md']]
        );
        const result = resolve('budget', 'total');
        assert.equal(result.ok, false);
        assert.match(result.reason, /Reference broken: no cell named "total" in "budget"/);
    });

    test('an existing cell that itself failed to evaluate fails honestly, not silently as 0', () => {
        const resolve = makeResolver(
            [['/vault/budget.md', '`total=1+`']],
            [['budget', '/vault/budget.md']]
        );
        const result = resolve('budget', 'total');
        assert.equal(result.ok, false);
        assert.match(result.reason, /Reference broken: "budget\^total" has its own error/);
    });

    test('a note with no readable body (unreadable file) fails honestly rather than throwing', () => {
        const resolve = makeResolver(
            [],
            [['budget', '/vault/budget.md']]
        );
        const result = resolve('budget', 'total');
        assert.equal(result.ok, false);
    });

    test('single-hop: the target note\'s own cross-note reference fails inside its own scan, not recursed into', () => {
        // budget's own formula tries to read a third note — resolving
        // budget^total for the CALLER must not follow that nested reference.
        const resolve = makeResolver(
            [['/vault/budget.md', '`total=[[other]]^x + 1`']],
            [['budget', '/vault/budget.md'], ['other', '/vault/other.md']]
        );
        const result = resolve('budget', 'total');
        assert.equal(result.ok, false);
        assert.match(result.reason, /Reference broken: "budget\^total" has its own error/);
    });

    test('real file reading via the default reader strips frontmatter before scanning', () => {
        const os = require('os');
        const fs = require('fs');
        const path = require('path');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-xref-'));
        const filePath = path.join(dir, 'budget.md');
        fs.writeFileSync(filePath, '---\nid: budget\ntype: note\n---\n\n`total=7+3`\n', 'utf8');
        try {
            const idIndex = new Map([['budget', filePath]]);
            const resolve = createCrossNoteResolver({ getIndex: () => idIndex });
            assert.deepEqual(resolve('budget', 'total'), { ok: true, value: 10 });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
