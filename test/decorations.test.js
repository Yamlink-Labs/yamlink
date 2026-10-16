'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

require.cache.__decorations_vscode__ = {
    id: '__decorations_vscode__',
    filename: '__decorations_vscode__',
    loaded: true,
    exports: {
        window: {
            createTextEditorDecorationType() {
                // Each call must return a distinct object identity — updateDecorations
                // tests below distinguish "which decoration type got this range" by
                // object reference, the same way real vscode decoration types are
                // distinct singleton handles.
                return { __decorationType: true };
            },
            __infoMessages: [],
            showInformationMessage(message) {
                this.__infoMessages.push(message);
                return Promise.resolve(undefined);
            },
            __statusBarMessages: [],
            setStatusBarMessage(message) {
                this.__statusBarMessages.push(message);
                return { dispose() {} };
            }
        },
        MarkdownString: class MarkdownString {
            constructor(value = '') {
                this.value = value;
            }
        },
        workspace: {
            getConfiguration() {
                return { get: () => false };
            },
            async applyEdit(edit) {
                for (const { uri, range, text } of edit.__replacements) {
                    const doc = uri.__document;
                    if (!doc) continue;
                    doc._text = doc._text.slice(0, range.start.offset) + text + doc._text.slice(range.end.offset);
                }
                return true;
            }
        },
        WorkspaceEdit: class WorkspaceEdit {
            constructor() {
                this.__replacements = [];
            }
            replace(uri, range, text) {
                this.__replacements.push({ uri, range, text });
            }
        },
        ThemeColor: class ThemeColor {
            constructor(id) {
                this.id = id;
            }
        },
        Range: class Range {
            constructor(start, end) {
                this.start = start;
                this.end = end;
            }
        }
    }
};

require.cache.__decorations_date__ = {
    id: '__decorations_date__',
    filename: '__decorations_date__',
    loaded: true,
    exports: {
        resolveDateShortcutToken(token) {
            const normalized = String(token || '').replace(/^@+/, '').toLowerCase();
            if (normalized === 'today') return '2026-05-04';
            if (normalized === 'next-week') return '2026-05-11';
            return null;
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__decorations_vscode__';
    if (request === '../core/date') return '__decorations_date__';
    return originalResolve(request, parent, ...rest);
};

const {
    collectDateShortcutDecorations,
    collectResolvedDateDecorations,
    collectTagDecorations,
    collectInlineCalcDecorations,
    computeInlineCalcRenumberMap,
    reconcileInlineCalcReferences,
    updateDecorations
} = require('../src/features/decorations');
const { initializeIgnoredDiagnostics, ignoreDiagnostic, describeBrokenLink } = require('../src/diagnostics/ignoredDiagnostics');
// Captured while the 'vscode' resolver override above is still active — test
// bodies run later, after Module._resolveFilename has already been restored
// at the bottom of this file, so a plain require('vscode') inside a test
// would fail; this reference stays valid for the whole file's lifetime.
const stubVscode = require('vscode');

/**
 * A mutable-text document stub for reconcileInlineCalcReferences tests —
 * unlike the read-only makeDocument below, this one supports the real
 * write path (applyEdit mutates `_text` in place) and a `save()` that
 * re-runs reconciliation, the same way a real second save would, so tests
 * can assert the whole insert -> save -> auto-corrected -> re-save ->
 * idempotent round trip end to end.
 *
 * Each call gets its own URI — reconcileInlineCalcReferences keys its
 * last-known-state cache by document.uri.toString(), and that cache is
 * module-level, never reset between tests, exactly like the real one would
 * persist across saves in a real session. A shared URI across calls would
 * leak state between tests the same way two different real files never
 * would.
 */
let _mutableDocCounter = 0;
function makeMutableDocument(initialText, context) {
    _mutableDocCounter += 1;
    const path = `C:\\vault\\test-doc-${_mutableDocCounter}.md`;
    const uri = { fsPath: path, toString: () => `file:///vault/test-doc-${_mutableDocCounter}.md` };
    const doc = {
        _text: initialText,
        languageId: 'markdown',
        getText() { return doc._text; },
        uri,
        positionAt(offset) { return { line: 0, character: offset, offset }; },
        async save() {
            await reconcileInlineCalcReferences(doc, context);
            return true;
        }
    };
    uri.__document = doc;
    return doc;
}

function makeDocument(text) {
    return {
        getText() {
            return text;
        },
        uri: { fsPath: 'C:\\vault\\current.md' },
        positionAt(offset) {
            return { line: 0, character: offset, offset };
        }
    };
}

describe('date shortcut decorations', () => {
    test('collects ranges for supported @date tokens only', () => {
        const text = 'date: @today\nnotes: @unknown\nfollowup: @next-week';
        const ranges = collectDateShortcutDecorations(makeDocument(text));
        assert.equal(ranges.length, 2);
        assert.equal(text.slice(ranges[0].start.offset, ranges[0].end.offset), '@today');
        assert.equal(text.slice(ranges[1].start.offset, ranges[1].end.offset), '@next-week');
    });

    test('collects ranges for resolved iso dates so styling can persist after completion', () => {
        const text = 'date: 2026-05-04\nother: nope\ncreated: 2026-05-11';
        const ranges = collectResolvedDateDecorations(makeDocument(text));
        assert.equal(ranges.length, 2);
        assert.equal(text.slice(ranges[0].start.offset, ranges[0].end.offset), '2026-05-04');
        assert.equal(text.slice(ranges[1].start.offset, ranges[1].end.offset), '2026-05-11');
    });

    test('collects tag ranges from both body hashtags and frontmatter tag fields', () => {
        const text = [
            '---',
            'tags: crm, enterprise',
            'label: #priority-high',
            '---',
            'Need follow-up on #wayne-inc and #q2-review'
        ].join('\n');
        const ranges = collectTagDecorations(makeDocument(text));
        const values = ranges
            .map(({ range }) => text.slice(range.start.offset, range.end.offset))
            .sort();
        assert.deepEqual(values, ['#priority-high', '#q2-review', '#wayne-inc', 'crm', 'enterprise']);
    });

    test('collects tag ranges from labels: (plural) with hash-prefixed values', () => {
        const text = [
            '---',
            'labels: #client, #important',
            '---',
            'See #client-note'
        ].join('\n');
        const ranges = collectTagDecorations(makeDocument(text));
        const values = ranges
            .map(({ range }) => text.slice(range.start.offset, range.end.offset))
            .sort();
        assert.deepEqual(values, ['#client', '#client-note', '#important']);
    });

    test('does not decorate pure-numeric hashtags', () => {
        const text = 'Issue #123 and #456 are not tags, but #real-tag is';
        const ranges = collectTagDecorations(makeDocument(text));
        const values = ranges.map(({ range }) => text.slice(range.start.offset, range.end.offset));
        assert.deepEqual(values, ['#real-tag']);
    });

    test('collects body-only tags when there is no frontmatter', () => {
        const text = 'This note is about #architecture and #design';
        const ranges = collectTagDecorations(makeDocument(text));
        const values = ranges
            .map(({ range }) => text.slice(range.start.offset, range.end.offset))
            .sort();
        assert.deepEqual(values, ['#architecture', '#design']);
    });

    test('deduplicates identical tag positions', () => {
        const text = [
            '---',
            'tags: focus',
            '---',
            'Working on #focus area'
        ].join('\n');
        const ranges = collectTagDecorations(makeDocument(text));
        // 'focus' from frontmatter and '#focus' from body are different positions — both included
        const values = ranges.map(({ range }) => text.slice(range.start.offset, range.end.offset)).sort();
        assert.deepEqual(values, ['#focus', 'focus']);
    });

    // Real bug found live: block-style YAML lists (the idiomatic form, and
    // what Obsidian import produces) rendered zero pills — the field-line
    // regex required same-line content after the colon.
    test('collects tags from a block-style YAML list under tags:', () => {
        const text = [
            '---',
            'tags:',
            '  - project',
            '  - urgent',
            '---',
            'Body text'
        ].join('\n');
        const ranges = collectTagDecorations(makeDocument(text));
        const values = ranges.map(({ range }) => text.slice(range.start.offset, range.end.offset)).sort();
        assert.deepEqual(values, ['project', 'urgent']);
    });

    test('collects tags from a block-style YAML list under labels: (plural)', () => {
        const text = [
            '---',
            'labels:',
            '  - client',
            '  - important',
            '---'
        ].join('\n');
        const ranges = collectTagDecorations(makeDocument(text));
        const values = ranges.map(({ range }) => text.slice(range.start.offset, range.end.offset)).sort();
        assert.deepEqual(values, ['client', 'important']);
    });

    test('block-style tag list stops at the next unindented key, not bleeding into it', () => {
        const text = [
            '---',
            'tags:',
            '  - project',
            'status: active',
            '---'
        ].join('\n');
        const ranges = collectTagDecorations(makeDocument(text));
        const values = ranges.map(({ range }) => text.slice(range.start.offset, range.end.offset));
        assert.deepEqual(values, ['project']);
    });

    test('a blank line inside a block-style tag list does not end the list early', () => {
        const text = [
            '---',
            'tags:',
            '  - project',
            '',
            '  - urgent',
            '---'
        ].join('\n');
        const ranges = collectTagDecorations(makeDocument(text));
        const values = ranges.map(({ range }) => text.slice(range.start.offset, range.end.offset)).sort();
        assert.deepEqual(values, ['project', 'urgent']);
    });

    // Real bug found live: flow-style `tags: [a, b, c]` silently dropped the
    // first item — the item regex only accepted start-of-string or a
    // preceding comma as a valid boundary, never `[`.
    test('collects all items from a flow-style tags: [a, b, c] list, including the first', () => {
        const text = [
            '---',
            'tags: [alpha, beta, gamma]',
            '---'
        ].join('\n');
        const ranges = collectTagDecorations(makeDocument(text));
        const values = ranges.map(({ range }) => text.slice(range.start.offset, range.end.offset)).sort();
        assert.deepEqual(values, ['alpha', 'beta', 'gamma']);
    });

    test('classifies #urgent and #high as urgent priority', () => {
        const text = 'Fix the bug #urgent and ship it #high';
        const ranges = collectTagDecorations(makeDocument(text));
        const byText = Object.fromEntries(ranges.map(({ range, priority }) => [text.slice(range.start.offset, range.end.offset), priority]));
        assert.equal(byText['#urgent'], 'urgent');
        assert.equal(byText['#high'], 'urgent');
    });

    test('classifies #medium and #medium-priority as medium priority', () => {
        const text = 'Review this #medium and that #medium-priority';
        const ranges = collectTagDecorations(makeDocument(text));
        const byText = Object.fromEntries(ranges.map(({ range, priority }) => [text.slice(range.start.offset, range.end.offset), priority]));
        assert.equal(byText['#medium'], 'medium');
        assert.equal(byText['#medium-priority'], 'medium');
    });

    test('classifies #low as low priority', () => {
        const text = 'Read this later #low';
        const ranges = collectTagDecorations(makeDocument(text));
        const byText = Object.fromEntries(ranges.map(({ range, priority }) => [text.slice(range.start.offset, range.end.offset), priority]));
        assert.equal(byText['#low'], 'low');
    });

    test('an ordinary, non-priority tag has a null priority — stays the generic tag color', () => {
        const text = 'Working on #architecture';
        const ranges = collectTagDecorations(makeDocument(text));
        const byText = Object.fromEntries(ranges.map(({ range, priority }) => [text.slice(range.start.offset, range.end.offset), priority]));
        assert.equal(byText['#architecture'], null);
    });

    test('priority classification also applies to frontmatter tags: list items', () => {
        const text = [
            '---',
            'tags: urgent, architecture',
            '---'
        ].join('\n');
        const ranges = collectTagDecorations(makeDocument(text));
        const byText = Object.fromEntries(ranges.map(({ range, priority }) => [text.slice(range.start.offset, range.end.offset), priority]));
        assert.equal(byText.urgent, 'urgent');
        assert.equal(byText.architecture, null);
    });
});

describe('inline calc decorations', () => {
    test('evaluates an explicit `=expr` code span', () => {
        const text = 'The total is `=1 + (5+1/-1)` before tax.';
        const ranges = collectInlineCalcDecorations(makeDocument(text));
        assert.equal(ranges.length, 1);
        assert.equal(ranges[0].evalResult.ok, true);
        assert.equal(ranges[0].evalResult.value, 5);
        assert.equal(text.slice(ranges[0].range.start.offset, ranges[0].range.end.offset), '`=1 + (5+1/-1)`');
    });

    test('reports an honest error for a malformed expression instead of a wrong number', () => {
        const text = 'Broken: `=1 + `';
        const ranges = collectInlineCalcDecorations(makeDocument(text));
        assert.equal(ranges.length, 1);
        assert.equal(ranges[0].evalResult.ok, false);
    });

    test('an ordinary code span with no leading = is never touched', () => {
        const text = 'Run `npm install` first.';
        const ranges = collectInlineCalcDecorations(makeDocument(text));
        assert.equal(ranges.length, 0);
    });

    test('skips a matching span inside a fenced code block', () => {
        const text = [
            'Some text.',
            '```',
            'example: `=1 + 1`',
            '```',
            'Real one: `=2 + 2`'
        ].join('\n');
        const ranges = collectInlineCalcDecorations(makeDocument(text));
        assert.equal(ranges.length, 1);
        assert.equal(ranges[0].evalResult.value, 4);
    });

    test('supports exponents for squared/cubed', () => {
        const text = 'Area: `=5^2`, volume: `=5^3`';
        const ranges = collectInlineCalcDecorations(makeDocument(text));
        assert.equal(ranges.length, 2);
        assert.equal(ranges[0].evalResult.value, 25);
        assert.equal(ranges[1].evalResult.value, 125);
    });
});

describe('inline calc decorations — cross-note references ([[note]]^label)', () => {
    test('resolves through the real collectInlineCalcDecorations surface via an injected resolver', () => {
        const resolver = (noteId, label) => (noteId === 'budget' && label === 'total')
            ? { ok: true, value: 42 }
            : { ok: false, reason: 'not found' };
        const text = 'Summary: `=[[budget]]^total + 10`';
        const ranges = collectInlineCalcDecorations(makeDocument(text), resolver);
        assert.equal(ranges.length, 1);
        assert.equal(ranges[0].evalResult.ok, true);
        assert.equal(ranges[0].evalResult.value, 52);
    });

    test('without an injected resolver, the real default resolver runs against the live vault index and fails honestly rather than crashing', () => {
        const text = 'Summary: `=[[some-other-note]]^total`';
        const ranges = collectInlineCalcDecorations(makeDocument(text));
        assert.equal(ranges.length, 1);
        assert.equal(ranges[0].evalResult.ok, false);
        assert.equal(ranges[0].evalResult.code, 'REF');
    });
});

describe('inline calc — named references (same note)', () => {
    test('a named calc can be referenced by a later expression', () => {
        const text = 'Apples: `total=1+2`\nDouble: `=total*3`';
        const ranges = collectInlineCalcDecorations(makeDocument(text));
        assert.equal(ranges.length, 2);
        assert.equal(ranges[0].evalResult.value, 3);
        assert.equal(ranges[1].evalResult.value, 9);
    });

    test('referencing a name before it is defined fails honestly, never a stale/guessed value', () => {
        const text = 'Double: `=total*3`\nApples: `total=1+2`';
        const ranges = collectInlineCalcDecorations(makeDocument(text));
        assert.equal(ranges.length, 2);
        assert.equal(ranges[0].evalResult.ok, false);
        assert.match(ranges[0].evalResult.error, /Not found: no variable named "total"/i);
        assert.equal(ranges[1].evalResult.value, 3);
    });

    test('redefining the same name later overwrites it for subsequent expressions', () => {
        const text = '`total=1+2`\n`total=10`\n`=total*2`';
        const ranges = collectInlineCalcDecorations(makeDocument(text));
        assert.equal(ranges.length, 3);
        assert.equal(ranges[2].evalResult.value, 20);
    });

    test('a named calc that fails to evaluate never leaks into the environment', () => {
        const text = '`total=1+`\n`=total*2`';
        const ranges = collectInlineCalcDecorations(makeDocument(text));
        assert.equal(ranges.length, 2);
        assert.equal(ranges[0].evalResult.ok, false);
        assert.equal(ranges[1].evalResult.ok, false);
        assert.match(ranges[1].evalResult.error, /Not found: no variable named "total"/i);
    });

    test('naming a variable the same as a reserved function name is rejected at definition', () => {
        const text = '`sqrt=5`\n`=sqrt(9)`';
        const ranges = collectInlineCalcDecorations(makeDocument(text));
        assert.equal(ranges.length, 2);
        assert.equal(ranges[0].evalResult.ok, false);
        assert.match(ranges[0].evalResult.error, /Name reserved: "sqrt" is a built-in function/i);
        // The second line's `sqrt(` must still call the real function — the
        // rejected definition above never entered the environment to shadow it.
        assert.equal(ranges[1].evalResult.value, 3);
    });
});

describe('inline calc — positional c<N> aliases', () => {
    test('every calc block, named or not, also gets a positional alias in document order', () => {
        const text = '`total=1+2`\n`=5*5`\n`=Y1+Y2`';
        const ranges = collectInlineCalcDecorations(makeDocument(text));
        assert.equal(ranges.length, 3);
        assert.equal(ranges[0].evalResult.value, 3); // Y1 / total
        assert.equal(ranges[1].evalResult.value, 25); // Y2
        assert.equal(ranges[2].evalResult.value, 28); // Y1 + Y2
    });
});

describe('computeInlineCalcRenumberMap', () => {
    test('an insertion before existing blocks shifts every later number', () => {
        const renumber = computeInlineCalcRenumberMap(['1+1', '2+2', 'Y1+Y2'], ['3+3', '1+1', '2+2', 'Y1+Y2']);
        assert.deepEqual([...renumber.entries()], [[1, 2], [2, 3], [3, 4]]);
    });

    test('nothing moved is a genuine no-op', () => {
        const renumber = computeInlineCalcRenumberMap(['1+1', '2+2'], ['1+1', '2+2']);
        assert.equal(renumber.size, 0);
    });

    test('a deletion shifts later numbers down', () => {
        const renumber = computeInlineCalcRenumberMap(['1+1', '2+2', '3+3'], ['2+2', '3+3']);
        assert.deepEqual([...renumber.entries()], [[2, 1], [3, 2]]);
    });
});

describe('reconcileInlineCalcReferences — Excel-style live renumbering on save', () => {
    test('inserting a new calc block earlier auto-rewrites a later c<N> reference to keep pointing at the same block', async () => {
        const doc = makeMutableDocument('`=1+1`\n`=2+2`\n`=Y1+Y2`');
        await doc.save(); // establish the baseline (first save just seeds history, nothing to reconcile yet)

        doc._text = '`=3+3`\n`=1+1`\n`=2+2`\n`=Y1+Y2`'; // insert a new block before the first
        await doc.save(); // should auto-rewrite the reference and re-save

        assert.equal(doc._text, '`=3+3`\n`=1+1`\n`=2+2`\n`=Y2+Y3`');

        // The whole point: it still evaluates to what it always meant (1+1 + 2+2 = 6),
        // not whatever now happens to sit at the old Y1/Y2 slots (3+3 + 1+1 = 7).
        const ranges = collectInlineCalcDecorations(doc);
        assert.equal(ranges[3].evalResult.value, 6);
    });

    test('the corrective re-save is idempotent — a third save triggers no further edit', async () => {
        const doc = makeMutableDocument('`=1+1`\n`=2+2`\n`=Y1+Y2`');
        await doc.save();
        doc._text = '`=3+3`\n`=1+1`\n`=2+2`\n`=Y1+Y2`';
        await doc.save();
        const settledText = doc._text;

        await doc.save(); // nothing changed since the last save — must be a true no-op
        assert.equal(doc._text, settledText);
    });

    test('a deletion shifts a later reference down, not up', async () => {
        const doc = makeMutableDocument('`=1+1`\n`=2+2`\n`=3+3`\n`=Y3`');
        await doc.save();

        doc._text = '`=2+2`\n`=3+3`\n`=Y3`'; // the first block was deleted
        await doc.save();

        assert.equal(doc._text, '`=2+2`\n`=3+3`\n`=Y2`');
    });

    test('first time seeing a document does nothing — only a change since a previous save triggers reconciliation', async () => {
        const doc = makeMutableDocument('`=1+1`\n`=Y1`');
        await doc.save();
        assert.equal(doc._text, '`=1+1`\n`=Y1`');
    });

    test('a cross-note reference\'s own label (e.g. [[budget]]^Y2) is never mistaken for a local Y<N> token during renumbering', async () => {
        // Y1, Y2 defined; Y3 is a real local reference to Y1+Y2 (should
        // renumber); the note also has a cross-note reference whose target
        // label happens to numerically collide with a local one being
        // renumbered ([[budget]]^Y2) — that text must stay byte-identical,
        // since Y2 there means budget's own second cell, nothing to do with
        // this note's numbering at all.
        const doc = makeMutableDocument('`=1+1`\n`=2+2`\n`=Y1+Y2`\n`=[[budget]]^Y2 + 1`');
        await doc.save();

        doc._text = '`=3+3`\n`=1+1`\n`=2+2`\n`=Y1+Y2`\n`=[[budget]]^Y2 + 1`'; // insert a new block before the first
        await doc.save();

        assert.equal(
            doc._text,
            '`=3+3`\n`=1+1`\n`=2+2`\n`=Y2+Y3`\n`=[[budget]]^Y2 + 1`'
        );
    });
});

describe('reconcileInlineCalcReferences — notification on rewrite', () => {
    function makeFakeContext(seen) {
        const store = new Map(seen ? [['yamlink.seenInlineCalcRenumberExplainer', true]] : []);
        return { globalState: { get: (key, fallback) => (store.has(key) ? store.get(key) : fallback), update: (key, value) => { store.set(key, value); } } };
    }

    test('the first ever rewrite shows a real one-time explanation, not just a status-bar note', async () => {
        const vscode = stubVscode;
        vscode.window.__infoMessages.length = 0;
        vscode.window.__statusBarMessages.length = 0;
        const context = makeFakeContext(false);
        const doc = makeMutableDocument('`=1+1`\n`=2+2`\n`=Y1+Y2`', context);
        await doc.save();
        doc._text = '`=3+3`\n`=1+1`\n`=2+2`\n`=Y1+Y2`';
        await doc.save();

        assert.equal(vscode.window.__infoMessages.length, 1);
        assert.match(vscode.window.__infoMessages[0], /2 formula references/);
        assert.equal(vscode.window.__statusBarMessages.length, 0);
        assert.equal(context.globalState.get('yamlink.seenInlineCalcRenumberExplainer', false), true);
    });

    test('every rewrite after the first is a quiet status-bar note instead', async () => {
        const vscode = stubVscode;
        vscode.window.__infoMessages.length = 0;
        vscode.window.__statusBarMessages.length = 0;
        const context = makeFakeContext(true); // already seen the explainer
        const doc = makeMutableDocument('`=1+1`\n`=2+2`\n`=Y1+Y2`', context);
        await doc.save();
        doc._text = '`=3+3`\n`=1+1`\n`=2+2`\n`=Y1+Y2`';
        await doc.save();

        assert.equal(vscode.window.__infoMessages.length, 0);
        assert.equal(vscode.window.__statusBarMessages.length, 1);
        assert.match(vscode.window.__statusBarMessages[0], /fixed 2 formula references/);
    });

    test('no rewrite happens, no notification of any kind fires', async () => {
        const vscode = stubVscode;
        vscode.window.__infoMessages.length = 0;
        vscode.window.__statusBarMessages.length = 0;
        const context = makeFakeContext(false);
        const doc = makeMutableDocument('`=1+1`\n`=2+2`', context);
        await doc.save();
        doc._text = '`=1+1`\n`=2+2`\n`=3+3`'; // appended after, nothing shifted
        await doc.save();

        assert.equal(vscode.window.__infoMessages.length, 0);
        assert.equal(vscode.window.__statusBarMessages.length, 0);
    });
});

// ─────────────────────────────────────────────────────────────────
// canonicalizeLinkedTarget — wikilink ID normalization
// ─────────────────────────────────────────────────────────────────

describe('canonicalizeLinkedTarget', () => {
    const { canonicalizeLinkedTarget } = require('../src/core/id');

    test('plain kebab-case id passes through unchanged', () => {
        assert.equal(canonicalizeLinkedTarget('my-note'), 'my-note');
    });

    test('pipe alias is stripped', () => {
        assert.equal(canonicalizeLinkedTarget('my-note|Display Name'), 'my-note');
    });

    test('heading anchor is stripped', () => {
        assert.equal(canonicalizeLinkedTarget('my-note#section-two'), 'my-note');
    });

    test('block reference is stripped', () => {
        assert.equal(canonicalizeLinkedTarget('my-note^abc123'), 'my-note');
    });

    test('alias takes precedence — heading inside alias is also stripped', () => {
        assert.equal(canonicalizeLinkedTarget('my-note#heading|Alias Text'), 'my-note');
    });

    test('spaces in raw id are canonicalized to hyphens', () => {
        assert.equal(canonicalizeLinkedTarget('My Note'), 'my-note');
    });

    test('uppercase is lowercased', () => {
        assert.equal(canonicalizeLinkedTarget('Johnny-Rico'), 'johnny-rico');
    });

    test('empty string returns empty string', () => {
        assert.equal(canonicalizeLinkedTarget(''), '');
    });
});

// ─────────────────────────────────────────────────────────────────
// updateDecorations — broken-link muting must respect "Ignore this
// suggestion here". Real bug: the muted/faded decoration was computed by
// a completely separate pass from the diagnostics array, with zero
// awareness of ignored-diagnostic state, so dismissing the diagnostic via
// the lightbulb never actually un-muted the text.
// ─────────────────────────────────────────────────────────────────

describe('updateDecorations — broken link ignore state', () => {
    // positionAt must return a real {line, character} shape (single-line
    // text here, so character === offset) — buildIgnoredDiagnosticKey reads
    // .line/.character, not .offset, and the key computed from decorations.js's
    // internally-built range must match the key computed from the diagnostic
    // actually passed to ignoreDiagnostic(), or the ignore check silently
    // never matches anything.
    function makeFakeEditor(text) {
        const calls = [];
        return {
            document: {
                languageId: 'markdown',
                uri: { fsPath: 'C:\\vault\\note.md' },
                getText: () => text,
                positionAt: (offset) => ({ line: 0, character: offset })
            },
            selection: { active: { offset: 0 } },
            setDecorations(type, ranges) {
                calls.push({ type, ranges });
            },
            __calls: calls
        };
    }

    function rangesContainingText(editor, text, needle) {
        return editor.__calls.filter(({ ranges }) =>
            ranges.some((r) => text.slice(r.range.start.character, r.range.end.character) === needle)
        );
    }

    test('an ignored broken-link diagnostic stops being muted and renders as a normal link instead', () => {
        const fakeWorkspaceState = (() => {
            let store = [];
            return {
                get: (_key, def) => (store.length ? store : def),
                update: (_key, value) => { store = value; }
            };
        })();
        initializeIgnoredDiagnostics({ workspaceState: fakeWorkspaceState });

        const text = '[[missing-note]] is not a real note yet.';
        const editor = makeFakeEditor(text);

        // Before ignoring: the broken-link decoration pass must be the one
        // that claims the "missing-note" range — not the normal link pass.
        updateDecorations(editor, () => new Map());
        const beforeMatches = rangesContainingText(editor, text, 'missing-note');
        assert.ok(beforeMatches.length > 0, 'expected some decoration call to cover the broken id before ignoring');
        const mutedType = beforeMatches[0].type;

        // Ignore it — the exact same command the "Ignore this suggestion
        // here" quick fix invokes, using the exact same code/message the
        // real diagnostic uses (describeBrokenLink), proving the key
        // actually lines up between diagnostics.js and decorations.js.
        const { code, message } = describeBrokenLink('missing-note', false);
        const fakeDocument = { uri: { fsPath: 'C:\\vault\\note.md' } };
        const fullRange = { start: { line: 0, character: 0 }, end: { line: 0, character: '[[missing-note]]'.length } };
        return ignoreDiagnostic(fakeDocument, { range: fullRange, code, message }).then(() => {
            editor.__calls.length = 0;
            updateDecorations(editor, () => new Map());

            const afterMatches = rangesContainingText(editor, text, 'missing-note');
            assert.ok(afterMatches.length > 0, 'the id text should still render as *something* after being ignored');
            assert.ok(
                afterMatches.every(({ type }) => type !== mutedType),
                'the muted/broken decoration type must no longer receive this range once the diagnostic is ignored'
            );
        });
    });
});

Module._resolveFilename = originalResolve;
