'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
    extractFirstParagraph,
    buildGlossaryEntries,
    groupGlossaryEntries
} = require('../src/intelligence/glossary');

describe('glossary', () => {
    describe('extractFirstParagraph', () => {
        test('returns the first paragraph, trimmed', () => {
            const body = '\nHomeworld of the Arachnids.\nSite of the first drop.\n\nSecond paragraph here.\n';
            assert.equal(extractFirstParagraph(body), 'Homeworld of the Arachnids. Site of the first drop.');
        });

        test('returns empty string for empty body', () => {
            assert.equal(extractFirstParagraph(''), '');
            assert.equal(extractFirstParagraph('   \n\n  '), '');
        });
    });

    describe('buildGlossaryEntries', () => {
        const fieldsCache = new Map([
            ['klendathu', { type: 'location', name: 'Klendathu' }],
            ['roughnecks', { type: 'faction', name: 'Roughnecks', definition: 'Rasczak\'s platoon.' }],
            ['johnny-rico', { type: 'contact', name: 'Johnny Rico' }],
            ['mobile-infantry', { type: 'faction', summary: 'Orbital drop assault branch.' }]
        ]);
        const idIndex = new Map([
            ['klendathu', '/vault/klendathu.md'],
            ['roughnecks', '/vault/roughnecks.md'],
            ['johnny-rico', '/vault/johnny-rico.md'],
            ['mobile-infantry', '/vault/mobile-infantry.md']
        ]);

        function backlinksFor(id) {
            const map = {
                klendathu: [{ field: 'body', sourceId: 'johnny-rico' }, { field: 'body', sourceId: 'johnny-rico' }],
                roughnecks: [{ field: 'unit', sourceId: 'johnny-rico' }],
                'mobile-infantry': []
            };
            return map[id] || [];
        }

        test('returns empty array when no types are configured', () => {
            const result = buildGlossaryEntries({ fieldsCache, idIndex }, { types: [] }, { getBacklinksFn: backlinksFor });
            assert.deepEqual(result, []);
        });

        test('filters to only the configured types', () => {
            const result = buildGlossaryEntries(
                { fieldsCache, idIndex },
                { types: ['location', 'faction'] },
                { getBacklinksFn: backlinksFor }
            );
            const ids = result.map((e) => e.id).sort();
            assert.deepEqual(ids, ['klendathu', 'mobile-infantry', 'roughnecks']);
        });

        test('prefers an explicit definition:/summary: field over body text', () => {
            const result = buildGlossaryEntries(
                { fieldsCache, idIndex },
                { types: ['faction'] },
                { getBacklinksFn: backlinksFor }
            );
            const roughnecks = result.find((e) => e.id === 'roughnecks');
            assert.equal(roughnecks.definition, 'Rasczak\'s platoon.');
            assert.equal(roughnecks.definitionSource, 'field');

            const mi = result.find((e) => e.id === 'mobile-infantry');
            assert.equal(mi.definition, 'Orbital drop assault branch.');
            assert.equal(mi.definitionSource, 'field');
        });

        test('falls back to the first body paragraph when no field is present', () => {
            const readBodyFn = (filePath) => {
                if (filePath === '/vault/klendathu.md') return '\nHomeworld of the Arachnids.\n\nMore lore.\n';
                return '';
            };
            const result = buildGlossaryEntries(
                { fieldsCache, idIndex },
                { types: ['location'] },
                { getBacklinksFn: backlinksFor, readBodyFn }
            );
            const klendathu = result.find((e) => e.id === 'klendathu');
            assert.equal(klendathu.definition, 'Homeworld of the Arachnids.');
            assert.equal(klendathu.definitionSource, 'body');
        });

        test('definitionSource is "none" when neither a field nor body text is available', () => {
            const result = buildGlossaryEntries(
                { fieldsCache, idIndex },
                { types: ['location'] },
                { getBacklinksFn: backlinksFor, readBodyFn: () => '' }
            );
            const klendathu = result.find((e) => e.id === 'klendathu');
            assert.equal(klendathu.definition, '');
            assert.equal(klendathu.definitionSource, 'none');
        });

        test('deduplicates and sorts backlink ids', () => {
            const result = buildGlossaryEntries(
                { fieldsCache, idIndex },
                { types: ['location'] },
                { getBacklinksFn: backlinksFor, readBodyFn: () => '' }
            );
            const klendathu = result.find((e) => e.id === 'klendathu');
            assert.deepEqual(klendathu.backlinkIds, ['johnny-rico']);
        });

        test('showZeroBacklinkTerms: false filters out terms with no backlinks', () => {
            const result = buildGlossaryEntries(
                { fieldsCache, idIndex },
                { types: ['faction'], showZeroBacklinkTerms: false },
                { getBacklinksFn: backlinksFor, readBodyFn: () => '' }
            );
            const ids = result.map((e) => e.id);
            assert.ok(ids.includes('roughnecks'));
            assert.ok(!ids.includes('mobile-infantry'), 'mobile-infantry has zero backlinks and should be excluded');
        });

        test('showZeroBacklinkTerms: true (default) keeps zero-backlink terms', () => {
            const result = buildGlossaryEntries(
                { fieldsCache, idIndex },
                { types: ['faction'] },
                { getBacklinksFn: backlinksFor, readBodyFn: () => '' }
            );
            const mi = result.find((e) => e.id === 'mobile-infantry');
            assert.ok(mi);
            assert.deepEqual(mi.backlinkIds, []);
        });

        test('includes only present, non-empty extraFields values', () => {
            const cacheWithExtra = new Map([
                ['klendathu', { type: 'location', name: 'Klendathu', region: 'Outer Rim' }],
                ['roughnecks', { type: 'faction', name: 'Roughnecks' }]
            ]);
            const result = buildGlossaryEntries(
                { fieldsCache: cacheWithExtra, idIndex },
                { types: ['location', 'faction'], extraFields: ['region'] },
                { getBacklinksFn: () => [], readBodyFn: () => '' }
            );
            const klendathu = result.find((e) => e.id === 'klendathu');
            const roughnecks = result.find((e) => e.id === 'roughnecks');
            assert.deepEqual(klendathu.extra, { region: 'Outer Rim' });
            assert.deepEqual(roughnecks.extra, {});
        });

        test('term falls back to id when no name/title field exists', () => {
            const cache = new Map([['some-id', { type: 'location' }]]);
            const idx = new Map([['some-id', '/vault/some-id.md']]);
            const result = buildGlossaryEntries(
                { fieldsCache: cache, idIndex: idx },
                { types: ['location'] },
                { getBacklinksFn: () => [], readBodyFn: () => '' }
            );
            assert.equal(result[0].term, 'some-id');
        });
    });

    describe('groupGlossaryEntries', () => {
        const entries = [
            { id: 'klendathu', term: 'Klendathu', type: 'location', definition: '', definitionSource: 'none', backlinkIds: [], extra: {} },
            { id: 'roughnecks', term: 'Roughnecks', type: 'faction', definition: '', definitionSource: 'none', backlinkIds: [], extra: {} },
            { id: 'mobile-infantry', term: 'Mobile Infantry', type: 'faction', definition: '', definitionSource: 'none', backlinkIds: [], extra: {} }
        ];

        test('groupByType: true buckets by type, then alphabetically within each type', () => {
            const groups = groupGlossaryEntries(entries, { groupByType: true });
            assert.equal(groups.length, 2);
            const factionGroup = groups.find((g) => g.type === 'faction');
            const terms = factionGroup.letters.flatMap((l) => l.entries.map((e) => e.term));
            assert.deepEqual(terms, ['Mobile Infantry', 'Roughnecks']);
        });

        test('groupByType: false produces a single ungrouped bucket sorted alphabetically', () => {
            const groups = groupGlossaryEntries(entries, { groupByType: false });
            assert.equal(groups.length, 1);
            assert.equal(groups[0].type, null);
            const terms = groups[0].letters.flatMap((l) => l.entries.map((e) => e.term));
            assert.deepEqual(terms, ['Klendathu', 'Mobile Infantry', 'Roughnecks']);
        });

        test('letter groups are keyed by the first uppercased character of the term', () => {
            const groups = groupGlossaryEntries(entries, { groupByType: false });
            const letters = groups[0].letters.map((l) => l.letter);
            assert.deepEqual(letters, ['K', 'M', 'R']);
        });

        test('a single selected type still produces one harmless type group, not a special case', () => {
            const single = entries.filter((e) => e.type === 'faction');
            const groups = groupGlossaryEntries(single, { groupByType: true });
            assert.equal(groups.length, 1);
            assert.equal(groups[0].type, 'faction');
        });

        test('empty entry list returns an empty group list', () => {
            assert.deepEqual(groupGlossaryEntries([], { groupByType: true }), []);
            assert.deepEqual(groupGlossaryEntries([], { groupByType: false }), [{ type: null, letters: [] }]);
        });

        describe('sortBy: mostReferenced', () => {
            const refEntries = [
                { id: 'a', term: 'Alpha', type: 'faction', definition: '', definitionSource: 'none', backlinkIds: ['x', 'y'], extra: {} },
                { id: 'b', term: 'Bravo', type: 'faction', definition: '', definitionSource: 'none', backlinkIds: ['x', 'y', 'z'], extra: {} },
                { id: 'c', term: 'Charlie', type: 'faction', definition: '', definitionSource: 'none', backlinkIds: [], extra: {} },
                { id: 'd', term: 'Delta', type: 'faction', definition: '', definitionSource: 'none', backlinkIds: ['x'], extra: {} }
            ];

            test('ranks entries by backlink count descending', () => {
                const groups = groupGlossaryEntries(refEntries, { groupByType: false, sortBy: 'mostReferenced' });
                const terms = groups[0].letters[0].entries.map((e) => e.term);
                assert.deepEqual(terms, ['Bravo', 'Alpha', 'Delta', 'Charlie']);
            });

            test('ties in backlink count break alphabetically by term', () => {
                const tied = [
                    { id: 'z', term: 'Zulu', type: 'faction', definition: '', definitionSource: 'none', backlinkIds: ['x'], extra: {} },
                    { id: 'a', term: 'Alpha', type: 'faction', definition: '', definitionSource: 'none', backlinkIds: ['x'], extra: {} }
                ];
                const groups = groupGlossaryEntries(tied, { groupByType: false, sortBy: 'mostReferenced' });
                const terms = groups[0].letters[0].entries.map((e) => e.term);
                assert.deepEqual(terms, ['Alpha', 'Zulu']);
            });

            test('produces a single letter:null bucket per group instead of A-Z letter sections', () => {
                const groups = groupGlossaryEntries(refEntries, { groupByType: false, sortBy: 'mostReferenced' });
                assert.equal(groups[0].letters.length, 1);
                assert.equal(groups[0].letters[0].letter, null);
            });

            test('applies within each type bucket when groupByType is also true', () => {
                const mixed = [
                    ...refEntries,
                    { id: 'e', term: 'Echo', type: 'location', definition: '', definitionSource: 'none', backlinkIds: ['x', 'y', 'z', 'w'], extra: {} },
                    { id: 'f', term: 'Foxtrot', type: 'location', definition: '', definitionSource: 'none', backlinkIds: [], extra: {} }
                ];
                const groups = groupGlossaryEntries(mixed, { groupByType: true, sortBy: 'mostReferenced' });
                const locationGroup = groups.find((g) => g.type === 'location');
                const terms = locationGroup.letters[0].entries.map((e) => e.term);
                assert.deepEqual(terms, ['Echo', 'Foxtrot']);
            });

            test('defaults to alphabetical when sortBy is omitted or unrecognized', () => {
                const groups = groupGlossaryEntries(refEntries, { groupByType: false });
                const terms = groups[0].letters.flatMap((l) => l.entries.map((e) => e.term));
                assert.deepEqual(terms, ['Alpha', 'Bravo', 'Charlie', 'Delta']);
            });
        });
    });
});
