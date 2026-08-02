'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
    getPublishStatus,
    isPublishable,
    getSlug,
    getOrder,
    sortByOrder,
    resolvePublishLinks,
    resolvePublishFieldValue,
    filterOutFencedLines
} = require('../src/core/publish');

describe('publish', () => {
    describe('getPublishStatus', () => {
        test('recognizes draft/published/archived, case-insensitively', () => {
            assert.equal(getPublishStatus({ status: 'draft' }), 'draft');
            assert.equal(getPublishStatus({ status: 'Published' }), 'published');
            assert.equal(getPublishStatus({ status: ' ARCHIVED ' }), 'archived');
        });

        test('returns null for missing or unrecognized status values', () => {
            assert.equal(getPublishStatus({}), null);
            assert.equal(getPublishStatus({ status: '' }), null);
            assert.equal(getPublishStatus({ status: 'in-progress' }), null);
        });
    });

    describe('isPublishable', () => {
        test('production mode excludes draft and archived, includes published and unset', () => {
            assert.equal(isPublishable({ status: 'draft' }), false);
            assert.equal(isPublishable({ status: 'archived' }), false);
            assert.equal(isPublishable({ status: 'published' }), true);
            assert.equal(isPublishable({}), true);
        });

        test('preview mode includes draft but still excludes archived', () => {
            assert.equal(isPublishable({ status: 'draft' }, { mode: 'preview' }), true);
            assert.equal(isPublishable({ status: 'archived' }, { mode: 'preview' }), false);
            assert.equal(isPublishable({ status: 'published' }, { mode: 'preview' }), true);
        });

        test('a vault that never sets status: sees every note as publishable', () => {
            assert.equal(isPublishable({ type: 'note', title: 'Untouched' }), true);
        });
    });

    describe('getSlug', () => {
        test('slug is the canonical id unchanged', () => {
            assert.equal(getSlug('johnny-rico'), 'johnny-rico');
        });
    });

    describe('getOrder / sortByOrder', () => {
        test('getOrder parses a numeric order field, ignores invalid values', () => {
            assert.equal(getOrder({ order: 3 }), 3);
            assert.equal(getOrder({ order: '3' }), 3);
            assert.equal(getOrder({}), null);
            assert.equal(getOrder({ order: 'not-a-number' }), null);
        });

        test('sorts ascending by order, notes without order trail in original relative order', () => {
            const notes = [
                { id: 'c', fields: { order: 2 } },
                { id: 'a', fields: { order: 1 } },
                { id: 'unordered-1', fields: {} },
                { id: 'b', fields: { order: 3 } },
                { id: 'unordered-2', fields: {} }
            ];
            const sorted = sortByOrder(notes).map((n) => n.id);
            assert.deepEqual(sorted, ['a', 'c', 'b', 'unordered-1', 'unordered-2']);
        });

        test('ties on the same order value break by original relative order', () => {
            const notes = [
                { id: 'first', fields: { order: 1 } },
                { id: 'second', fields: { order: 1 } }
            ];
            const sorted = sortByOrder(notes).map((n) => n.id);
            assert.deepEqual(sorted, ['first', 'second']);
        });
    });

    describe('resolvePublishLinks', () => {
        const idIndex = new Map([
            ['johnny-rico', '/vault/johnny-rico.md'],
            ['carmen-ibanez', '/vault/carmen-ibanez.md']
        ]);

        test('resolves a plain wikilink to a Markdown link with the display label', () => {
            assert.equal(
                resolvePublishLinks('Serving alongside [[johnny-rico]].', idIndex),
                'Serving alongside [johnny-rico](/johnny-rico).'
            );
        });

        test('uses the alias label when a pipe alias is present', () => {
            assert.equal(
                resolvePublishLinks('[[johnny-rico|Johnny]] led the platoon.', idIndex),
                '[Johnny](/johnny-rico) led the platoon.'
            );
        });

        test('an unresolvable link falls back to plain text, never raw bracket syntax', () => {
            assert.equal(
                resolvePublishLinks('See [[nonexistent-note]] for more.', idIndex),
                'See nonexistent-note for more.'
            );
        });

        test('multiple links in one string all resolve independently', () => {
            assert.equal(
                resolvePublishLinks('[[johnny-rico]] and [[carmen-ibanez]] both served.', idIndex),
                '[johnny-rico](/johnny-rico) and [carmen-ibanez](/carmen-ibanez) both served.'
            );
        });

        test('plain text with no links passes through unchanged', () => {
            assert.equal(resolvePublishLinks('No links here at all.', idIndex), 'No links here at all.');
        });

        test('a fenced code block showing example wikilink syntax is left untouched, not resolved', () => {
            const body = 'Real link: [[johnny-rico]].\n\n```yaml\nunit: [[johnny-rico]]\n```\n\nDone.';
            const result = resolvePublishLinks(body, idIndex);
            assert.ok(result.includes('[johnny-rico](/johnny-rico).'));
            assert.ok(result.includes('unit: [[johnny-rico]]'));
        });
    });

    describe('resolvePublishFieldValue', () => {
        const idIndex = new Map([['johnny-rico', '/vault/johnny-rico.md']]);

        test('resolves a frontmatter relation value to a bare relative URL, no Markdown syntax', () => {
            assert.equal(resolvePublishFieldValue('[[johnny-rico]]', idIndex), '/johnny-rico');
        });

        test('a multi-value flattened relation field resolves every entry', () => {
            assert.equal(
                resolvePublishFieldValue('[[johnny-rico]], [[carmen-ibanez]]', new Map([
                    ['johnny-rico', '/vault/johnny-rico.md'],
                    ['carmen-ibanez', '/vault/carmen-ibanez.md']
                ])),
                '/johnny-rico, /carmen-ibanez'
            );
        });

        test('unresolvable target falls back to its raw target text', () => {
            assert.equal(resolvePublishFieldValue('[[nonexistent]]', idIndex), 'nonexistent');
        });
    });

    describe('filterOutFencedLines', () => {
        test('removes fenced code block lines, keeps everything else', () => {
            const body = 'Before.\n\n```yaml\nunit: [[johnny-rico]]\n```\n\nAfter.';
            const result = filterOutFencedLines(body);
            assert.ok(!result.includes('unit: [[johnny-rico]]'));
            assert.ok(result.includes('Before.'));
            assert.ok(result.includes('After.'));
        });

        test('a real link outside any fence survives', () => {
            const body = '[[real-link]] here.\n\n```\n[[fenced-example]]\n```';
            const result = filterOutFencedLines(body);
            assert.ok(result.includes('[[real-link]]'));
            assert.ok(!result.includes('[[fenced-example]]'));
        });
    });
});
