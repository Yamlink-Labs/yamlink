'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
    createVault,
    resetVscodeStubState,
    queueQuickPickResponses,
    getClipboardWrites,
    getStatusBarMessages,
    getRegisteredCommand,
    getShowTextDocumentCalls,
    getShowQuickPickCalls
} = require('./lib/vaultSim');

// vaultSim.js patches vscode module resolution as a side effect of the
// require above, so this now resolves against the same stub entityHubModel
// (a dependency of blockAffordances.js) is loaded against.
const { registerBlockAffordances, describeBlockKindShort } = require('../src/features/blockAffordances');
const { buildQuoteBlockId } = require('../src/core/bodyBlocks');

function makeContext() {
    return { subscriptions: { push() {} } };
}

function makeDocument(text, fsPath) {
    const lines = text.split('\n');
    return {
        languageId: 'markdown',
        uri: { fsPath },
        lineCount: lines.length,
        getText() { return text; },
        lineAt(line) { return { text: lines[line] }; }
    };
}

describe('block affordances — CodeLens', () => {
    beforeEach(() => {
        resetVscodeStubState();
    });

    test('describeBlockKindShort names each real block type', () => {
        assert.equal(describeBlockKindShort({ type: 'heading' }), 'section');
        assert.equal(describeBlockKindShort({ type: 'task' }), 'task');
        assert.equal(describeBlockKindShort({ type: 'quote' }), 'quote');
        assert.equal(describeBlockKindShort({ type: 'footnote' }), 'footnote');
        assert.equal(describeBlockKindShort(null), 'block');
    });

    test('offers a copy-reference lens for every addressable block, and no backlink lens when there are no backlinks', () => {
        const vault = createVault({
            'report.md': [
                '---',
                'id: report',
                '---',
                '# Overview',
                '',
                '- [ ] Review recon logs'
            ].join('\n')
        });

        const provider = registerBlockAffordances(
            makeContext(),
            () => vault.pathIndex,
            () => vault.idIndex,
            () => vault.fieldsCache
        );

        const fsPath = [...vault.pathIndex.entries()].find(([, id]) => id === 'report')[0];
        const lenses = provider.provideCodeLenses(makeDocument(
            ['---', 'id: report', '---', '# Overview', '', '- [ ] Review recon logs'].join('\n'),
            fsPath
        ));

        const titles = lenses.map((l) => l.command.title);
        assert.ok(titles.some((t) => t.includes('Copy section reference')));
        assert.ok(titles.some((t) => t.includes('Copy task reference')));
        assert.ok(!titles.some((t) => t.includes('reference') && t.includes('$(references)')));

        vault.destroy();
    });

    test('offers "Extract to note" on tasks/quotes/footnotes but never on headings', () => {
        const vault = createVault({
            'report.md': [
                '---',
                'id: report',
                '---',
                '# Overview',
                '',
                '- [ ] Review recon logs'
            ].join('\n')
        });

        const provider = registerBlockAffordances(makeContext(), () => vault.pathIndex, () => vault.idIndex, () => vault.fieldsCache);
        const fsPath = [...vault.pathIndex.entries()].find(([, id]) => id === 'report')[0];
        const text = ['---', 'id: report', '---', '# Overview', '', '- [ ] Review recon logs'].join('\n');
        const lenses = provider.provideCodeLenses(makeDocument(text, fsPath));

        const extractLenses = lenses.filter((l) => l.command.command === 'yamlink.extractBlockToNote');
        assert.equal(extractLenses.length, 1, 'expected exactly one extract lens, for the task block only');
        assert.equal(extractLenses[0].command.arguments[0].type, 'task');

        vault.destroy();
    });

    test('returns no lenses for a note with no id: field (honest silence, not a guess)', () => {
        const vault = createVault({ 'untyped.md': '# Just a heading' });
        const provider = registerBlockAffordances(makeContext(), () => vault.pathIndex, () => vault.idIndex, () => vault.fieldsCache);
        const fsPath = [...vault.pathIndex.keys()][0];
        const lenses = provider.provideCodeLenses(makeDocument('# Just a heading', fsPath));
        assert.deepEqual(lenses, []);
        vault.destroy();
    });

    test('copy-reference command writes the exact block reference to the clipboard', async () => {
        const vault = createVault({
            'report.md': ['---', 'id: report', '---', '# Overview'].join('\n')
        });
        registerBlockAffordances(makeContext(), () => vault.pathIndex, () => vault.idIndex, () => vault.fieldsCache);

        const handler = getRegisteredCommand('yamlink._copyBlockReferenceAt');
        await handler('report', { type: 'heading', blockId: 'h-overview', label: 'Overview' });

        assert.deepEqual(getClipboardWrites(), ['[[report#Overview]]']);
        assert.match(getStatusBarMessages()[0], /Copied \[\[report#Overview\]\]/);
        vault.destroy();
    });

    test('shows a backlink lens when another note references a block in this one, and jumps straight there when there is only one match', async () => {
        const quoteBlockId = buildQuoteBlockId(1, 'Training-yard line.');
        const vault = createVault({
            'target.md': ['---', 'id: target', '---', '', '> Training-yard line.'].join('\n'),
            'source.md': ['---', 'id: source', '---', '', `Reference [[target^${quoteBlockId}]] here.`].join('\n')
        });

        const provider = registerBlockAffordances(makeContext(), () => vault.pathIndex, () => vault.idIndex, () => vault.fieldsCache);
        const targetPath = [...vault.pathIndex.entries()].find(([, id]) => id === 'target')[0];
        const sourcePath = [...vault.pathIndex.entries()].find(([, id]) => id === 'source')[0];
        const targetText = ['---', 'id: target', '---', '', '> Training-yard line.'].join('\n');
        const lenses = provider.provideCodeLenses(makeDocument(targetText, targetPath));

        const backlinkLens = lenses.find((l) => l.command.command === 'yamlink._showBlockBacklinksAt');
        assert.ok(backlinkLens, 'expected a backlink CodeLens on the referenced quote');
        assert.match(backlinkLens.command.title, /1 reference/);

        const vscodeStub = require('vscode');
        vscodeStub.window.activeTextEditor = { document: makeDocument(targetText, targetPath) };

        const handler = getRegisteredCommand('yamlink._showBlockBacklinksAt');
        await handler('target', quoteBlockId);

        assert.deepEqual(getShowQuickPickCalls(), [], 'a single match should jump directly, not prompt');
        assert.deepEqual(getShowTextDocumentCalls(), [sourcePath]);
        vault.destroy();
    });

    test('backlink lens prompts with a QuickPick when there is more than one reference', async () => {
        const quoteBlockId = buildQuoteBlockId(1, 'Shared line.');
        const vault = createVault({
            'target.md': ['---', 'id: target', '---', '', '> Shared line.'].join('\n'),
            'source-a.md': ['---', 'id: source-a', '---', '', `See [[target^${quoteBlockId}]].`].join('\n'),
            'source-b.md': ['---', 'id: source-b', '---', '', `Also [[target^${quoteBlockId}]].`].join('\n')
        });

        registerBlockAffordances(makeContext(), () => vault.pathIndex, () => vault.idIndex, () => vault.fieldsCache);
        const targetPath = [...vault.pathIndex.entries()].find(([, id]) => id === 'target')[0];
        const targetText = ['---', 'id: target', '---', '', '> Shared line.'].join('\n');

        const vscodeStub = require('vscode');
        vscodeStub.window.activeTextEditor = { document: makeDocument(targetText, targetPath) };
        queueQuickPickResponses(undefined);

        const handler = getRegisteredCommand('yamlink._showBlockBacklinksAt');
        await handler('target', quoteBlockId);

        assert.equal(getShowQuickPickCalls().length, 1);
        assert.equal(getShowQuickPickCalls()[0].length, 2, 'both references should be offered');
        vault.destroy();
    });
});
