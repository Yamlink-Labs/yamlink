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
                return {};
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

const { collectDateShortcutDecorations, collectResolvedDateDecorations, collectTagDecorations } = require('../src/features/decorations');

function makeDocument(text) {
    return {
        getText() {
            return text;
        },
        positionAt(offset) {
            return { offset };
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

Module._resolveFilename = originalResolve;
