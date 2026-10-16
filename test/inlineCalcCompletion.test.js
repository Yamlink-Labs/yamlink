'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const originalResolve = Module._resolveFilename.bind(Module);
const MOCK_INDEX = new Map();

require.cache.__inline_calc_completion_vscode__ = {
    id: '__inline_calc_completion_vscode__',
    filename: '__inline_calc_completion_vscode__',
    loaded: true,
    exports: {
        CompletionItem: class CompletionItem {
            constructor(label, kind) {
                this.label = label;
                this.kind = kind;
            }
        },
        CompletionItemKind: { Variable: 6, Reference: 18 },
        Position: class Position {
            constructor(line, character) {
                this.line = line;
                this.character = character;
            }
        },
        Range: class Range {
            constructor(start, end) {
                this.start = start;
                this.end = end;
            }
        },
        MarkdownString: class MarkdownString {
            constructor(value = '') {
                this.value = value;
            }
        }
    }
};

const MOCK_FIELDS_CACHE = new Map();
const MOCK_PATH_INDEX = new Map();
let MOCK_GENERATION = 1;

require.cache.__inline_calc_completion_index__ = {
    id: '__inline_calc_completion_index__',
    filename: '__inline_calc_completion_index__',
    loaded: true,
    exports: {
        getIndex: () => MOCK_INDEX,
        getFieldsCache: () => MOCK_FIELDS_CACHE,
        getPathIndex: () => MOCK_PATH_INDEX,
        getVaultGeneration: () => MOCK_GENERATION
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__inline_calc_completion_vscode__';
    if (request === '../core/indexService') return '__inline_calc_completion_index__';
    return originalResolve(request, parent, ...rest);
};

const {
    provideCellReferenceCompletions,
    findEditableCalcContext,
    findUnclosedCalcContext,
    describeCellForPicker,
    collectCrossNoteCalcCellCandidates,
    buildVaultLearnedFormulaItems,
    buildRangeCompletionItems,
    buildFrontmatterFieldItems,
    buildTableFieldItems
} = require('../src/features/inlineCalcCompletion');
const { scanInlineCalcs } = require('../src/engine/inlineCalc');

function writeTempNote(t, body) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-inline-calc-completion-'));
    const filePath = path.join(dir, 'note.md');
    fs.writeFileSync(filePath, `---\nid: note\n---\n${body}`, 'utf8');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return filePath;
}

function makeDocument(text, uriFsPath) {
    return {
        languageId: 'markdown',
        getText: () => text,
        offsetAt: (position) => position.character,
        uri: uriFsPath ? { fsPath: uriFsPath } : undefined,
        lineAt: () => ({ text })
    };
}

describe('findEditableCalcContext and findUnclosedCalcContext — frontmatter-dependent prior cells', () => {
    test('a cell that reads a frontmatter field still counts as a valid prior block, closed-span case', (t) => {
        MOCK_GENERATION++;
        MOCK_INDEX.clear();
        MOCK_FIELDS_CACHE.clear();
        MOCK_PATH_INDEX.clear();

        const text = '`rate=200`\n`subtotal=rate*quantity`\n`=subtotal*1.08`\n`=Y3`';
        const currentPath = writeTempNote(t, text);
        MOCK_INDEX.set('current', currentPath);
        MOCK_FIELDS_CACHE.set('current', { quantity: 4 });
        MOCK_PATH_INDEX.set(currentPath, 'current');

        const offset = text.lastIndexOf('`=Y3`') + 2;
        const ctx = findEditableCalcContext(makeDocument(text, currentPath), { character: offset });
        assert.ok(ctx);
        // All three prior cells must survive — subtotal (frontmatter-dependent)
        // and the tax formula (dependent on subtotal) must not be silently
        // dropped just because this scan didn't know about `quantity`.
        assert.deepEqual(ctx.priorBlocks.map((b) => b.name || b.label), ['rate', 'subtotal', 'Y3']);
    });

    test('same thing, unclosed-formula case — the moment right after typing `=', (t) => {
        MOCK_GENERATION++;
        MOCK_INDEX.clear();
        MOCK_FIELDS_CACHE.clear();
        MOCK_PATH_INDEX.clear();

        const text = '`rate=200`\n`subtotal=rate*quantity`\n`=subtotal*1.08`\n`=';
        const currentPath = writeTempNote(t, text);
        MOCK_INDEX.set('current', currentPath);
        MOCK_FIELDS_CACHE.set('current', { quantity: 4 });
        MOCK_PATH_INDEX.set(currentPath, 'current');

        const ctx = findUnclosedCalcContext(makeDocument(text, currentPath), { character: text.length });
        assert.ok(ctx);
        assert.deepEqual(ctx.priorBlocks.map((b) => b.name || b.label), ['rate', 'subtotal', 'Y3']);
    });
});

describe('findEditableCalcContext', () => {
    test('finds the block the cursor is inside and every cell defined before it', () => {
        const text = '`=1+1`\n`total=1+2`\n`=Y1`';
        const offset = text.lastIndexOf('`=Y1`') + 2; // right after the '=' inside the third block
        const ctx = findEditableCalcContext(makeDocument(text), { character: offset });
        assert.ok(ctx);
        assert.equal(ctx.block.label, 'Y3');
        assert.deepEqual(ctx.priorBlocks.map((b) => b.label), ['Y1', 'Y2']);
    });

    test('returns null when the cursor is not inside any formula', () => {
        const text = 'Just some prose. `=1+1`';
        assert.equal(findEditableCalcContext(makeDocument(text), { character: 5 }), null);
    });

    test('returns null for the very first cell — nothing exists yet to reference', () => {
        const text = '`=1';
        assert.equal(findEditableCalcContext(makeDocument(text), { character: 2 }), null);
    });

    test('a failed prior block is excluded — its value would not be real', () => {
        const text = '`=1+` \n`=Y1`'; // first block is malformed
        const offset = text.lastIndexOf('`=Y1`') + 2;
        const ctx = findEditableCalcContext(makeDocument(text), { character: offset });
        assert.ok(ctx);
        assert.equal(ctx.priorBlocks.length, 0);
    });
});

describe('findUnclosedCalcContext — parity with `[[`, suggestions before the formula is closed', () => {
    test('recognizes an in-progress formula right after `=, with no closing backtick yet', () => {
        const text = '`total=5`\n`=';
        const ctx = findUnclosedCalcContext(makeDocument(text), { character: text.length });
        assert.ok(ctx);
        assert.deepEqual(ctx.priorBlocks.map((b) => b.name || b.label), ['total']);
    });

    test('recognizes an in-progress NAMED formula right after `name=', () => {
        const text = '`total=5`\n`tax=';
        const ctx = findUnclosedCalcContext(makeDocument(text), { character: text.length });
        assert.ok(ctx);
        assert.equal(ctx.priorBlocks.length, 1);
    });

    test('returns null when there is no open formula at the cursor at all', () => {
        const text = 'Just some prose with a `closed=1` formula.';
        assert.equal(findUnclosedCalcContext(makeDocument(text), { character: 10 }), null);
    });

    test('returns null outside a markdown document', () => {
        const doc = { languageId: 'plaintext', getText: () => '`=', lineAt: () => ({ text: '`=' }), offsetAt: (p) => p.character };
        assert.equal(findUnclosedCalcContext(doc, { character: 2 }), null);
    });
});

describe('provideCellReferenceCompletions — unclosed formula', () => {
    test('offers prior cells the moment a formula is opened, before it is closed — same timing as [[', () => {
        const text = '`total=5`\n`=';
        const items = provideCellReferenceCompletions(makeDocument(text), { character: text.length });
        assert.ok(items);
        assert.ok(items.some((i) => i.label === 'total'));
    });
});

describe('buildFrontmatterFieldItems — numeric/scalar frontmatter fields as completion candidates', () => {
    test('offers scalar frontmatter fields the formula could actually read', (t) => {
        MOCK_GENERATION++;
        MOCK_INDEX.clear();
        MOCK_FIELDS_CACHE.clear();
        MOCK_PATH_INDEX.clear();

        const currentPath = writeTempNote(t, '');
        MOCK_INDEX.set('current', currentPath);
        MOCK_FIELDS_CACHE.set('current', { price: 19.99, quantity: 3, label: 'office supplies' });
        MOCK_PATH_INDEX.set(currentPath, 'current');

        const items = buildFrontmatterFieldItems(makeDocument('', currentPath), new Set());
        const names = items.map((i) => i.label).sort();
        assert.deepEqual(names, ['label', 'price', 'quantity']);
    });

    test('excludes a relation/list field — nothing a formula could read as a scalar', (t) => {
        MOCK_GENERATION++;
        MOCK_INDEX.clear();
        MOCK_FIELDS_CACHE.clear();
        MOCK_PATH_INDEX.clear();

        const currentPath = writeTempNote(t, '');
        MOCK_INDEX.set('current', currentPath);
        MOCK_FIELDS_CACHE.set('current', { account: '[[acme]]', tags: ['a', 'b'], price: 10 });
        MOCK_PATH_INDEX.set(currentPath, 'current');

        const items = buildFrontmatterFieldItems(makeDocument('', currentPath), new Set());
        assert.deepEqual(items.map((i) => i.label), ['price']);
    });

    test('excludes a name already offered as a same-note cell label/name', (t) => {
        MOCK_GENERATION++;
        MOCK_INDEX.clear();
        MOCK_FIELDS_CACHE.clear();
        MOCK_PATH_INDEX.clear();

        const currentPath = writeTempNote(t, '');
        MOCK_INDEX.set('current', currentPath);
        MOCK_FIELDS_CACHE.set('current', { price: 10 });
        MOCK_PATH_INDEX.set(currentPath, 'current');

        const items = buildFrontmatterFieldItems(makeDocument('', currentPath), new Set(['price']));
        assert.deepEqual(items, []);
    });

    test('a numeric-looking frontmatter string (as the index actually stores it) is still offered', (t) => {
        MOCK_GENERATION++;
        MOCK_INDEX.clear();
        MOCK_FIELDS_CACHE.clear();
        MOCK_PATH_INDEX.clear();

        const currentPath = writeTempNote(t, '');
        MOCK_INDEX.set('current', currentPath);
        MOCK_FIELDS_CACHE.set('current', { quantity: '3' });
        MOCK_PATH_INDEX.set(currentPath, 'current');

        const items = buildFrontmatterFieldItems(makeDocument('', currentPath), new Set());
        assert.deepEqual(items.map((i) => i.label), ['quantity']);
    });
});

describe('provideCellReferenceCompletions — frontmatter fields in the suggestion box', () => {
    test('a freshly opened formula offers this note\'s own numeric frontmatter fields', (t) => {
        MOCK_GENERATION++;
        MOCK_INDEX.clear();
        MOCK_FIELDS_CACHE.clear();
        MOCK_PATH_INDEX.clear();

        const text = '`=';
        const currentPath = writeTempNote(t, text);
        MOCK_INDEX.set('current', currentPath);
        MOCK_FIELDS_CACHE.set('current', { type: 'expense', price: 20, quantity: 4 });
        MOCK_PATH_INDEX.set(currentPath, 'current');

        const items = provideCellReferenceCompletions(makeDocument(text, currentPath), { character: text.length });
        assert.ok(items);
        assert.ok(items.some((i) => i.label === 'price'));
        assert.ok(items.some((i) => i.label === 'quantity'));
    });
});

describe('buildTableFieldItems — T<N>.<column> as flat suggestion-box items', () => {
    test('offers every column of every !view table already in the note', (t) => {
        MOCK_GENERATION++;
        MOCK_INDEX.clear();
        MOCK_FIELDS_CACHE.clear();
        MOCK_PATH_INDEX.clear();

        MOCK_INDEX.set('inv-a', writeTempNote(t, '---\nid: inv-a\ntype: invoice\ntotal: 820\n---\n'));
        MOCK_FIELDS_CACHE.set('inv-a', { id: 'inv-a', type: 'invoice', total: 820 });

        const currentPath = writeTempNote(t, '!view invoice select id, total');
        MOCK_INDEX.set('current', currentPath);
        MOCK_FIELDS_CACHE.set('current', { type: 'page' });
        MOCK_PATH_INDEX.set(currentPath, 'current');

        const doc = makeDocument('!view invoice select id, total', currentPath);
        const items = buildTableFieldItems(doc);
        assert.deepEqual(items.map((i) => i.label).sort(), ['T1.id', 'T1.total']);
    });

    test('an empty note with no !view blocks offers nothing', (t) => {
        const currentPath = writeTempNote(t, '');
        assert.deepEqual(buildTableFieldItems(makeDocument('', currentPath)), []);
    });
});

describe('provideCellReferenceCompletions — table columns in the suggestion box', () => {
    test('a freshly opened formula offers T1.<column> for a table already in the note', (t) => {
        MOCK_GENERATION++;
        MOCK_INDEX.clear();
        MOCK_FIELDS_CACHE.clear();
        MOCK_PATH_INDEX.clear();

        MOCK_INDEX.set('inv-a', writeTempNote(t, '---\nid: inv-a\ntype: invoice\ntotal: 820\n---\n'));
        MOCK_FIELDS_CACHE.set('inv-a', { id: 'inv-a', type: 'invoice', total: 820 });

        const noteBody = '!view invoice select id, total\n\n`=';
        const currentPath = writeTempNote(t, noteBody);
        MOCK_INDEX.set('current', currentPath);
        MOCK_FIELDS_CACHE.set('current', { type: 'page' });
        MOCK_PATH_INDEX.set(currentPath, 'current');

        const items = provideCellReferenceCompletions(makeDocument(noteBody, currentPath), { character: noteBody.length });
        assert.ok(items);
        assert.ok(items.some((i) => i.label === 'T1.total'));
    });
});

describe('provideCellReferenceCompletions', () => {
    test('offers every prior cell, closest one first, both by label and by name', () => {
        const text = '`=1+1`\n`total=1+2`\n`=Y1`';
        const offset = text.lastIndexOf('`=Y1`') + 2;
        const items = provideCellReferenceCompletions(makeDocument(text), { character: offset });
        assert.ok(items);
        // Y2/total (the block immediately above) sorts before Y1.
        assert.deepEqual(items.map((i) => i.label), ['Y2', 'total', 'Y1']);
        assert.equal(items[0].detail, '= 3');
        assert.equal(items[2].detail, '= 2');
    });

    test('returns undefined when there is nothing to reference yet', () => {
        assert.equal(provideCellReferenceCompletions(makeDocument('`=1'), { character: 2 }), undefined);
    });

    test('returns undefined outside a markdown document', () => {
        const doc = { languageId: 'plaintext', getText: () => '`=1+1`\n`=Y1`', offsetAt: (p) => p.character };
        assert.equal(provideCellReferenceCompletions(doc, { character: 10 }), undefined);
    });
});

describe('range inline calc completions', () => {
    test('offers whole-note, last-two, and last-three ranges when enough prior cells exist', () => {
        const text = '`=10`\n`=20`\n`=30`\n`=40`\n`=sum()`';
        const offset = text.lastIndexOf('(') + 1;
        const items = provideCellReferenceCompletions(makeDocument(text), { character: offset });

        assert.ok(items);
        assert.deepEqual(items.map((item) => item.label), ['Y1:Y4', 'Y3:Y4', 'Y2:Y4']);
        assert.deepEqual(items.map((item) => item.detail), ['sum = 100', 'sum = 70', 'sum = 90']);
    });

    test('offers only distinct ranges when the current note has fewer prior cells', () => {
        const twoCells = '`=10`\n`=20`\n`=average()`';
        const oneCell = '`=10`\n`=min()`';

        const twoItems = provideCellReferenceCompletions(makeDocument(twoCells), { character: twoCells.lastIndexOf('(') + 1 });
        const oneItems = provideCellReferenceCompletions(makeDocument(oneCell), { character: oneCell.lastIndexOf('(') + 1 });

        assert.ok(twoItems);
        assert.deepEqual(twoItems.map((item) => item.label), ['Y1:Y2']);
        assert.equal(twoItems[0].detail, 'average = 15');
        assert.ok(oneItems);
        assert.deepEqual(oneItems.map((item) => item.label), ['Y1:Y1']);
        assert.equal(oneItems[0].detail, 'min = 10');
    });

    test('uses the called function for the live preview', () => {
        const text = '`=10`\n`=20`\n`=30`\n`=max()`';
        const ctx = findEditableCalcContext(makeDocument(text), { character: text.lastIndexOf('(') + 1 });
        const items = buildRangeCompletionItems(makeDocument(text), { character: text.lastIndexOf('(') + 1 }, ctx);

        assert.ok(items);
        assert.equal(items[0].label, 'Y1:Y3');
        assert.equal(items[0].detail, 'max = 30');
    });

    test('does not offer range completions outside a range-taking function call', () => {
        const text = '`=10`\n`=20`\n`=Y`';
        const offset = text.lastIndexOf('Y') + 1;
        const ctx = findEditableCalcContext(makeDocument(text), { character: offset });
        assert.deepEqual(buildRangeCompletionItems(makeDocument(text), { character: offset }, ctx), []);
    });
});

describe('cross-note inline calc completions', () => {
    test('typing [[ inside a formula returns note-id items', () => {
        MOCK_INDEX.clear();
        MOCK_INDEX.set('budget', '/vault/budget.md');
        MOCK_INDEX.set('invoice', '/vault/invoice.md');

        const text = '`=[[`';
        const offset = text.indexOf('[[') + 2;
        const items = provideCellReferenceCompletions(makeDocument(text), { character: offset });

        assert.ok(items);
        assert.deepEqual(items.map((item) => item.label), ['budget', 'invoice']);
        assert.equal(items[0].insertText, '[[budget]]');
    });

    test('typing [[note]]^ inside a formula returns that note\'s successful calc cells with values', (t) => {
        MOCK_INDEX.clear();
        MOCK_INDEX.set('budget', writeTempNote(t, '`total=20+22`\n`=total*2`'));

        const text = '`=[[budget]]^`';
        const offset = text.indexOf('^') + 1;
        const items = provideCellReferenceCompletions(makeDocument(text), { character: offset });

        assert.ok(items);
        assert.deepEqual(items.map((item) => item.label), ['Y1', 'total', 'Y2']);
        assert.equal(items[0].detail, 'Y1 = 42');
        assert.equal(items[1].detail, 'Y1 = 42');
        assert.equal(items[2].detail, 'Y2 = 84');
        assert.equal(items[1].insertText, 'total');
    });

    test('failed cells in the target note are not suggested', (t) => {
        MOCK_INDEX.clear();
        MOCK_INDEX.set('budget', writeTempNote(t, '`ok=1+2`\n`broken=missing+1`'));

        const candidates = collectCrossNoteCalcCellCandidates(MOCK_INDEX, 'budget');

        assert.deepEqual(candidates.map((item) => item.blockId), ['Y1', 'ok']);
    });

    test('does not fire in ordinary body text', () => {
        MOCK_INDEX.clear();
        MOCK_INDEX.set('budget', '/vault/budget.md');

        const text = 'plain body [[budget]]^';
        const offset = text.length;

        assert.equal(provideCellReferenceCompletions(makeDocument(text), { character: offset }), undefined);
    });
});

describe('vault-learned formula suggestions', () => {
    test('suggests a pattern repeated across other same-typed notes, even for a note\'s very first formula (no prior blocks at all)', (t) => {
        MOCK_GENERATION++;
        MOCK_INDEX.clear();
        MOCK_FIELDS_CACHE.clear();
        MOCK_PATH_INDEX.clear();

        MOCK_INDEX.set('other-a', writeTempNote(t, '`total=10*3`'));
        MOCK_INDEX.set('other-b', writeTempNote(t, '`total=10*3`'));
        MOCK_FIELDS_CACHE.set('other-a', { type: 'expense' });
        MOCK_FIELDS_CACHE.set('other-b', { type: 'expense' });

        const currentPath = writeTempNote(t, '');
        MOCK_INDEX.set('current', currentPath);
        MOCK_FIELDS_CACHE.set('current', { type: 'expense' });
        MOCK_PATH_INDEX.set(currentPath, 'current');

        const text = '`=1`'; // the very first (and only) formula in this note — no priorBlocks
        const offset = text.indexOf('1') + 1;
        const items = provideCellReferenceCompletions(makeDocument(text, currentPath), { character: offset });

        assert.ok(items); // today, with zero prior blocks, this would be undefined without the new source
        const learned = items.find((item) => item.label === '10*3');
        assert.ok(learned);
        assert.match(learned.detail, /total.*common in 2 other expense notes/i);
    });

    test('a pattern seen in only one other note is below the suggestion threshold', (t) => {
        MOCK_GENERATION++;
        MOCK_INDEX.clear();
        MOCK_FIELDS_CACHE.clear();
        MOCK_PATH_INDEX.clear();

        MOCK_INDEX.set('other-a', writeTempNote(t, '`total=10*3`'));
        MOCK_FIELDS_CACHE.set('other-a', { type: 'expense' });

        const currentPath = writeTempNote(t, '');
        MOCK_INDEX.set('current', currentPath);
        MOCK_FIELDS_CACHE.set('current', { type: 'expense' });
        MOCK_PATH_INDEX.set(currentPath, 'current');

        const items = buildVaultLearnedFormulaItems(makeDocument('', currentPath));
        assert.deepEqual(items, []);
    });

    test('a note with no type gets no suggestions — schema amplifies, never gates', (t) => {
        MOCK_GENERATION++;
        MOCK_INDEX.clear();
        MOCK_FIELDS_CACHE.clear();
        MOCK_PATH_INDEX.clear();

        const currentPath = writeTempNote(t, '');
        MOCK_INDEX.set('current', currentPath);
        MOCK_FIELDS_CACHE.set('current', {});
        MOCK_PATH_INDEX.set(currentPath, 'current');

        assert.deepEqual(buildVaultLearnedFormulaItems(makeDocument('', currentPath)), []);
    });

    test('a document with no uri (e.g. a test fixture) gets no suggestions, not a crash', () => {
        assert.deepEqual(buildVaultLearnedFormulaItems(makeDocument('`=1`')), []);
    });
});

describe('describeCellForPicker', () => {
    test('formats label, name, expression, and result for the QuickPick list', () => {
        const [named] = scanInlineCalcs('`total=1+2`');
        assert.equal(describeCellForPicker(named), 'Y1 · total  —  1+2 = 3');
    });

    test('formats an unnamed cell without a stray separator', () => {
        const [anon] = scanInlineCalcs('`=5^2`');
        assert.equal(describeCellForPicker(anon), 'Y1  —  5^2 = 25');
    });
});

Module._resolveFilename = originalResolve;
