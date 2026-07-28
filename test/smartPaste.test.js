'use strict';

const assert = require('assert');
const test = require('node:test');
const {
    detectSmartPaste,
    buildViewBlock,
    buildFrontmatterFromJson,
    buildTaskList,
    buildNotesFromTable
} = require('../src/features/smartPasteCore');
const { parseSingleViewBlock } = require('../src/engine/query');

test('Smart Paste detects TSV tables and builds view and note conversions', () => {
    const detected = detectSmartPaste('Name\tRank\tUnit\nJohnny Rico\tLieutenant\tRoughnecks\nDizzy Flores\tPrivate\tRoughnecks');

    assert.strictEqual(detected.kind, 'table');
    assert.deepStrictEqual(detected.fields, ['name', 'rank', 'unit']);

    const viewBlock = buildViewBlock(detected);
    assert.match(viewBlock, /^!view \*\nselect name, rank, unit\n$/);
    // Regression guard: a bare `!view` with nothing after it on the first
    // line fails queryParser.js's `firstLine.startsWith('!view ')` check and
    // silently renders as an unparseable-query error — verify the generated
    // block is actually valid against the real parser, not just shaped right.
    const parsed = parseSingleViewBlock(viewBlock.split('\n'));
    assert.ok(parsed, 'generated !view block must be parseable by the real query engine');
    assert.deepStrictEqual(parsed.select, ['name', 'rank', 'unit']);

    const notes = buildNotesFromTable(detected);
    assert.deepStrictEqual(notes.map(note => note.id), ['johnny-rico', 'dizzy-flores']);
    assert.match(notes[0].content, /id: johnny-rico/);
    assert.match(notes[0].content, /rank: Lieutenant/);
});

test('Smart Paste detects Markdown tables conservatively', () => {
    const detected = detectSmartPaste('| Name | Status |\n| --- | --- |\n| Battle of Klendathu | active |');

    assert.strictEqual(detected.kind, 'table');
    assert.strictEqual(detected.source, 'markdown');
    assert.deepStrictEqual(detected.fields, ['name', 'status']);
    assert.deepStrictEqual(detected.rows, [['Battle of Klendathu', 'active']]);
});

test('Smart Paste converts JSON objects to frontmatter', () => {
    const detected = detectSmartPaste('{"id":"johnny-rico","type":"character","status":"active"}');

    assert.strictEqual(detected.kind, 'json');
    const frontmatter = buildFrontmatterFromJson(detected);
    assert.match(frontmatter, /^---\n/);
    assert.match(frontmatter, /id: johnny-rico/);
    assert.match(frontmatter, /type: character/);
    assert.match(frontmatter, /status: active/);
});

test('Smart Paste converts plain lists to Yamlink task lines', () => {
    const detected = detectSmartPaste('- Review mission logs #urgent\n- Update Roughnecks roster');

    assert.strictEqual(detected.kind, 'list');
    assert.strictEqual(
        buildTaskList(detected),
        '- [ ] Review mission logs #urgent\n- [ ] Update Roughnecks roster\n'
    );
});

test('Smart Paste treats a rich-text-editor list (Word, Google Docs) as a list, not a disguised 2-column table', () => {
    // Word/Docs put a literal tab between a list marker and its text on copy,
    // so a numbered list followed by a bulleted list looks exactly like a
    // 2-column TSV table (marker column, text column) to a naive tab check.
    const detected = detectSmartPaste('1.\tTest\n2.\tTest 2\n3.\tTest 3\n\n-\tTest 1\n-\tTest 2\n-\tTest 3');

    assert.strictEqual(detected.kind, 'list');
    assert.deepStrictEqual(detected.items, ['Test', 'Test 2', 'Test 3', 'Test 1', 'Test 2', 'Test 3']);
});

test('Smart Paste stays silent on ambiguous plain text', () => {
    assert.strictEqual(detectSmartPaste('Rico met Carmen before deployment.'), null);
    assert.strictEqual(detectSmartPaste('Name\tRank\nOnly one row is not enough'), null);
    assert.strictEqual(detectSmartPaste('- [ ] Already a task\n- [ ] Already structured'), null);
});
