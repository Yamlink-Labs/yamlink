'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildSearchTerms,
    countUnlinkedOccurrences,
    clearUnlinkedRefsCache
} = require('../src/features/entity/unlinkedRefs');

beforeEach(() => clearUnlinkedRefsCache());

// ─── buildSearchTerms ─────────────────────────────────────────────────────

describe('unlinkedRefs — buildSearchTerms', () => {
    it('includes note id as a term', () => {
        const terms = buildSearchTerms('johnny-rico', { type: 'character' });
        assert.ok(terms.includes('johnny-rico'));
    });

    it('includes name field', () => {
        const terms = buildSearchTerms('rico', { name: 'Johnny Rico' });
        assert.ok(terms.some(t => t.includes('johnny rico')));
    });

    it('includes title field when name is absent', () => {
        const terms = buildSearchTerms('rico', { title: 'Roughneck' });
        assert.ok(terms.includes('roughneck'));
    });

    it('includes aliases', () => {
        const terms = buildSearchTerms('rico', { aliases: ['JR', 'Sergeant Rico'] });
        assert.ok(terms.some(t => t.includes('sergeant rico')));
    });

    it('skips terms shorter than 3 characters', () => {
        const terms = buildSearchTerms('jb', { name: 'JB' });
        assert.ok(!terms.includes('jb'));
    });

    it('deduplicates terms', () => {
        const terms = buildSearchTerms('rico', { name: 'Rico', title: 'Rico' });
        const unique = new Set(terms);
        assert.equal(unique.size, terms.length);
    });
});

// ─── countUnlinkedOccurrences ─────────────────────────────────────────────

describe('unlinkedRefs — countUnlinkedOccurrences', () => {
    it('finds a plain-text mention', () => {
        const body = 'I talked to Johnny-Rico about the mission.';
        assert.ok(countUnlinkedOccurrences(body, 'johnny-rico') >= 1);
    });

    it('does not count mentions inside wikilinks', () => {
        const body = 'See [[johnny-rico]] for details.';
        assert.equal(countUnlinkedOccurrences(body, 'johnny-rico'), 0);
    });

    it('counts multiple plain occurrences', () => {
        const body = 'Rico fought bravely. Rico survived. Rico was promoted.';
        assert.ok(countUnlinkedOccurrences(body, 'rico') >= 3);
    });

    it('does not match partial words', () => {
        // "rico" should not match inside "Puerto Rico" when it's a different entity
        // Word boundary check: "ricocheted" should not count as "rico"
        const body = 'The bullet ricocheted off the wall.';
        assert.equal(countUnlinkedOccurrences(body, 'rico'), 0);
    });

    it('is case-insensitive', () => {
        const body = 'RICO led the charge. Rico survived.';
        assert.ok(countUnlinkedOccurrences(body, 'rico') >= 2);
    });

    it('returns 0 when term is not in body', () => {
        const body = 'Carmen flew through the asteroid belt.';
        assert.equal(countUnlinkedOccurrences(body, 'rico'), 0);
    });

    it('does not count the wikilink label but counts nearby plain text', () => {
        const body = 'See [[commander|Rico]] for details. Rico also mentioned it.';
        // [[commander|Rico]] is inside a wikilink — stripped. "Rico" after is plain text.
        assert.ok(countUnlinkedOccurrences(body, 'rico') >= 1);
    });
});
