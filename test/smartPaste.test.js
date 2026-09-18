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
const { requireWithVscodeStub, getRegisteredPasteProvider, resetVscodeStubState } = require('./lib/vaultSim');

function makeDataTransfer({ text, fromVscodeEditor }) {
    return {
        get(mimeType) {
            if (mimeType === 'vscode-editor-data') {
                return fromVscodeEditor ? { asString: async () => JSON.stringify({ languageId: 'markdown' }) } : undefined;
            }
            if (mimeType === 'text/plain') {
                return text === undefined ? undefined : { asString: async () => text };
            }
            return undefined;
        }
    };
}

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

test('Smart Paste never fires on content copied/cut from inside VS Code, even when it looks like a convertible list', async () => {
    // A plain bullet list is extremely common inside a note's own body (e.g. "The model"
    // section of this very README) — cutting and pasting one note-to-note inside the editor
    // must behave as a completely normal paste, not trigger the "convert to task list?" prompt
    // meant for content copied in from Slack/email/a planning doc.
    resetVscodeStubState();
    const { registerSmartPaste } = requireWithVscodeStub('../src/features/smartPaste', require);
    registerSmartPaste({ subscriptions: { push: () => {} } });
    const provider = getRegisteredPasteProvider();
    assert.ok(provider, 'registerSmartPaste must register a paste edit provider against the stubbed vscode.languages API');

    const fakeDocument = { languageId: 'markdown', uri: { fsPath: '/vault/note.md' } };
    const internalTransfer = makeDataTransfer({
        text: '- Identity — every note gets a stable id\n- Relations — wikilinks become graph edges',
        fromVscodeEditor: true
    });

    const result = await provider.provideDocumentPasteEdits(fakeDocument, [], internalTransfer);
    assert.strictEqual(result, undefined, 'a paste originating inside VS Code must be left as a plain, unmodified paste');
});

test('Smart Paste still fires on the same content when it did not come from inside VS Code', async () => {
    resetVscodeStubState();
    const { registerSmartPaste } = requireWithVscodeStub('../src/features/smartPaste', require);
    registerSmartPaste({ subscriptions: { push: () => {} } });
    const provider = getRegisteredPasteProvider();

    const fakeDocument = { languageId: 'markdown', uri: { fsPath: '/vault/note.md' } };
    const externalTransfer = makeDataTransfer({
        text: '- Buy milk\n- Call the vet',
        fromVscodeEditor: false
    });

    // vaultSim's stubbed showQuickPick with an empty response queue resolves to undefined,
    // which registerSmartPaste's provider treats as "user dismissed the picker" and falls
    // back to a plain-text paste edit — proving detection still ran (unlike the internal-paste
    // case above, which returns `undefined` itself before ever reaching the picker).
    const result = await provider.provideDocumentPasteEdits(fakeDocument, [], externalTransfer);
    assert.ok(Array.isArray(result), 'external clipboard content must still reach Smart Paste detection');
    assert.strictEqual(result[0].insertText, '- Buy milk\n- Call the vet');
});
