'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
    getPublishStatus,
    getPublishFlag,
    isPublishable,
    getSlug,
    getTypeSegment,
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
        test('production mode: only published is publishable, draft and archived are excluded', () => {
            assert.equal(isPublishable({ status: 'draft' }), false);
            assert.equal(isPublishable({ status: 'archived' }), false);
            assert.equal(isPublishable({ status: 'published' }), true);
            assert.equal(isPublishable({}), false);
        });

        test('preview mode includes draft (for staging a review) but still excludes archived', () => {
            assert.equal(isPublishable({ status: 'draft' }, { mode: 'preview' }), true);
            assert.equal(isPublishable({ status: 'archived' }, { mode: 'preview' }), false);
            assert.equal(isPublishable({ status: 'published' }, { mode: 'preview' }), true);
            assert.equal(isPublishable({}, { mode: 'preview' }), false);
        });

        test('strict opt-in: a note with no status: field is never publishable, in either mode', () => {
            assert.equal(isPublishable({ type: 'note', title: 'Untouched' }), false);
            assert.equal(isPublishable({ type: 'note', title: 'Untouched' }, { mode: 'preview' }), false);
        });

        test('an unrecognized status value is treated the same as no status: never publishable', () => {
            assert.equal(isPublishable({ status: 'in-progress' }), false);
            assert.equal(isPublishable({ status: 'in-progress' }, { mode: 'preview' }), false);
        });

        test('publish: true is independent of status: — a note can be status: active (lifecycle) and publish: true (public) at once', () => {
            assert.equal(isPublishable({ status: 'active', publish: true }), true);
            assert.equal(isPublishable({ status: 'blocked', publish: true }), true);
            assert.equal(isPublishable({ status: 'done', publish: true }), true);
        });

        test('publish: true alone, with no status: field at all, is publishable', () => {
            assert.equal(isPublishable({ publish: true }), true);
        });

        test('status: archived always wins over a stale publish: true', () => {
            assert.equal(isPublishable({ status: 'archived', publish: true }), false);
            assert.equal(isPublishable({ status: 'archived', publish: true }, { mode: 'preview' }), false);
        });

        test('publish: false is explicitly not publishable, same as omitting the field', () => {
            assert.equal(isPublishable({ publish: false }), false);
        });

        test('status: published still works as an equivalent alias to publish: true', () => {
            assert.equal(isPublishable({ status: 'published' }), true);
            assert.equal(isPublishable({ status: 'active', publish: true }), true);
        });
    });

    describe('getPublishFlag', () => {
        test('reads a real YAML boolean', () => {
            assert.equal(getPublishFlag({ publish: true }), true);
            assert.equal(getPublishFlag({ publish: false }), false);
        });

        test('reads the string forms "true"/"false", case-insensitively, since frontmatter values can round-trip as strings', () => {
            assert.equal(getPublishFlag({ publish: 'true' }), true);
            assert.equal(getPublishFlag({ publish: 'TRUE' }), true);
            assert.equal(getPublishFlag({ publish: 'false' }), false);
        });

        test('returns null for a missing field or an unrecognized value, never a guess', () => {
            assert.equal(getPublishFlag({}), null);
            assert.equal(getPublishFlag({ publish: 'yes' }), null);
            assert.equal(getPublishFlag({ publish: 1 }), null);
        });
    });

    describe('getSlug', () => {
        test('slug is the canonical id unchanged', () => {
            assert.equal(getSlug('johnny-rico'), 'johnny-rico');
        });
    });

    describe('getTypeSegment', () => {
        test('a normal type passes through unchanged', () => {
            assert.equal(getTypeSegment({ type: 'article' }), 'article');
        });

        test('absent or empty type falls back to _untyped', () => {
            assert.equal(getTypeSegment({}), '_untyped');
            assert.equal(getTypeSegment({ type: '' }), '_untyped');
            assert.equal(getTypeSegment(null), '_untyped');
        });

        test('path traversal characters are stripped, never passed through raw', () => {
            assert.equal(getTypeSegment({ type: '../../../../etc/evil' }), 'etc-evil');
            assert.equal(getTypeSegment({ type: '..' }), '_untyped');
            assert.equal(getTypeSegment({ type: '/' }), '_untyped');
            assert.equal(getTypeSegment({ type: '..\\..\\windows' }), 'windows');
        });

        test('the result never contains a path separator or a leading/trailing dash', () => {
            const result = getTypeSegment({ type: '  spaced out / type!! ' });
            assert.ok(!result.includes('/'));
            assert.ok(!result.includes('\\'));
            assert.ok(!result.startsWith('-'));
            assert.ok(!result.endsWith('-'));
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

        test('a target that exists but is not in publishableIds falls back to plain text, identical to a target that does not exist', () => {
            const publishableIds = new Set(['johnny-rico']);
            assert.equal(
                resolvePublishLinks('[[johnny-rico]] and [[carmen-ibanez]] both served.', idIndex, undefined, publishableIds),
                '[johnny-rico](/johnny-rico) and carmen-ibanez both served.'
            );
        });

        test('omitting publishableIds resolves against idIndex alone (no filtering, for callers with no privacy boundary)', () => {
            assert.equal(
                resolvePublishLinks('[[carmen-ibanez]] led too.', idIndex, undefined, undefined),
                '[carmen-ibanez](/carmen-ibanez) led too.'
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

        test('a target that exists but is not publishable falls back to its raw target text, no slug leaked', () => {
            assert.equal(resolvePublishFieldValue('[[johnny-rico]]', idIndex, undefined, new Set()), 'johnny-rico');
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
