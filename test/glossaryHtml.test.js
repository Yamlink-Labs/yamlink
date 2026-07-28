'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, linkifyDefinition, buildEmptyStateHtml, buildGlossaryHtml } = require('../src/features/glossaryHtml');

const NONCE = 'test-nonce-123';

describe('glossaryHtml', () => {
    test('escapeHtml escapes the five special characters', () => {
        assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;\'&lt;/a&gt;');
    });

    test('buildEmptyStateHtml renders a settings prompt, no term data, and a nonce-scoped CSP', () => {
        const html = buildEmptyStateHtml({ nonce: NONCE });
        assert.match(html, /Vault Glossary/);
        assert.match(html, /glossaryTypes/);
        assert.match(html, /data-action="openSettings"/);
        assert.match(html, new RegExp(`nonce-${NONCE}`));
        assert.match(html, new RegExp(`<script nonce="${NONCE}">`));
    });

    test('buildGlossaryHtml renders a "no notes found" message when groups are empty, with a settings button', () => {
        const html = buildGlossaryHtml([], ['faction'], { nonce: NONCE });
        assert.match(html, /No notes found for type\(s\): faction/);
        assert.match(html, /data-action="openSettings"/);
    });

    test('buildGlossaryHtml renders type headings, letters, terms, definitions, and backlink chips', () => {
        const groups = [
            {
                type: 'faction',
                letters: [
                    {
                        letter: 'R',
                        entries: [{
                            id: 'roughnecks',
                            term: 'Roughnecks',
                            type: 'faction',
                            definition: "Rasczak's platoon.",
                            definitionSource: 'field',
                            backlinkIds: ['johnny-rico', 'carl-jenkins'],
                            extra: {}
                        }]
                    }
                ]
            }
        ];
        const html = buildGlossaryHtml(groups, ['faction'], { nonce: NONCE });
        assert.match(html, /class="type-title is-collapsible" data-action="toggleSection" data-target="type-section-0">faction/);
        assert.match(html, /class="letter">R/);
        assert.match(html, /Roughnecks/);
        assert.match(html, /Rasczak&#39;s platoon\.|Rasczak's platoon\./);
        assert.match(html, /Referenced in:/);
        assert.match(html, /data-action="openNode" data-node-id="johnny-rico"/);
        assert.match(html, /data-action="openNode" data-node-id="carl-jenkins"/);
        assert.match(html, /data-action="openNode" data-node-id="roughnecks"/);
    });

    test('buildGlossaryHtml marks a zero-backlink entry as not yet referenced', () => {
        const groups = [{
            type: null,
            letters: [{ letter: 'K', entries: [{
                id: 'klendathu', term: 'Klendathu', type: 'location',
                definition: '', definitionSource: 'none', backlinkIds: [], extra: {}
            }] }]
        }];
        const html = buildGlossaryHtml(groups, ['location'], { nonce: NONCE });
        assert.match(html, /not yet referenced/);
    });

    test('buildGlossaryHtml renders extra fields when present', () => {
        const groups = [{
            type: null,
            letters: [{ letter: 'K', entries: [{
                id: 'klendathu', term: 'Klendathu', type: 'location',
                definition: '', definitionSource: 'none', backlinkIds: [], extra: { region: 'Outer Rim' }
            }] }]
        }];
        const html = buildGlossaryHtml(groups, ['location'], { nonce: NONCE });
        assert.match(html, /region: Outer Rim/);
    });

    test('buildGlossaryHtml escapes entry content to prevent HTML injection', () => {
        const groups = [{
            type: null,
            letters: [{ letter: '<', entries: [{
                id: 'x', term: '<script>alert(1)</script>', type: 'location',
                definition: '<b>bold</b>', definitionSource: 'field', backlinkIds: [], extra: {}
            }] }]
        }];
        const html = buildGlossaryHtml(groups, ['location'], { nonce: NONCE });
        assert.doesNotMatch(html, /<script>alert/);
        assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    });

    test('no type-title rendered when groupByType produced a null type (flat mode)', () => {
        const groups = [{
            type: null,
            letters: [{ letter: 'K', entries: [{
                id: 'klendathu', term: 'Klendathu', type: 'location',
                definition: '', definitionSource: 'none', backlinkIds: [], extra: {}
            }] }]
        }];
        const html = buildGlossaryHtml(groups, ['location'], { nonce: NONCE });
        assert.doesNotMatch(html, /<div class="type-title">/);
    });

    test('buildGlossaryHtml sets a nonce-scoped CSP matching the provided nonce, and no inline event handlers', () => {
        const groups = [{
            type: null,
            letters: [{ letter: 'K', entries: [{
                id: 'klendathu', term: 'Klendathu', type: 'location',
                definition: 'A place.', definitionSource: 'field', backlinkIds: ['rico'], extra: {}
            }] }]
        }];
        const html = buildGlossaryHtml(groups, ['location'], { nonce: NONCE });
        assert.match(html, new RegExp(`script-src 'nonce-${NONCE}'`));
        assert.match(html, new RegExp(`<script nonce="${NONCE}">`));
        assert.doesNotMatch(html, /onclick=/);
    });

    test('buildGlossaryHtml includes a live search input with a lowercased searchable data attribute per entry', () => {
        const groups = [{
            type: null,
            letters: [{ letter: 'K', entries: [{
                id: 'klendathu', term: 'Klendathu', type: 'location',
                definition: 'Homeworld of the Arachnids.', definitionSource: 'body', backlinkIds: [], extra: {}
            }] }]
        }];
        const html = buildGlossaryHtml(groups, ['location'], { nonce: NONCE });
        assert.match(html, /id="glossary-search"/);
        assert.match(html, /data-search="klendathu homeworld of the arachnids\."/);
    });

    describe('linkifyDefinition', () => {
        const idIndex = new Map([['johnny-rico', '/vault/johnny-rico.md']]);
        const aliasIndex = new Map([['rico-alias', 'johnny-rico']]);

        test('renders a resolved [[wikilink]] as a clickable chip', () => {
            const html = linkifyDefinition('Friends with [[johnny-rico]] before the war.', idIndex, aliasIndex);
            assert.match(html, /Friends with <span class="chip" data-action="openNode" data-node-id="johnny-rico">johnny-rico<\/span> before the war\./);
        });

        test('renders an unresolved [[wikilink]] as plain text in the broken-link class, not clickable', () => {
            const html = linkifyDefinition('Mentions [[nonexistent-note]] here.', idIndex, aliasIndex);
            assert.match(html, /<span class="broken-link">nonexistent-note<\/span>/);
            assert.doesNotMatch(html, /data-action="openNode" data-node-id="nonexistent-note"/);
        });

        test('resolves a [[target|label]] wikilink through its alias, displaying the label', () => {
            const html = linkifyDefinition('See [[rico-alias|Johnny]] for details.', idIndex, aliasIndex);
            assert.match(html, /data-node-id="johnny-rico">Johnny<\/span>/);
        });

        test('escapes plain surrounding text and does not treat non-bracket text as a link', () => {
            const html = linkifyDefinition('<b>bold</b> and [[johnny-rico]]', idIndex, aliasIndex);
            assert.match(html, /^&lt;b&gt;bold&lt;\/b&gt; and/);
        });

        test('returns escaped plain text unchanged when there are no wikilinks', () => {
            assert.equal(linkifyDefinition('Just plain text.', idIndex, aliasIndex), 'Just plain text.');
        });
    });

    describe('interactive toolbar controls', () => {
        const groups = [{
            type: 'faction',
            letters: [{ letter: 'R', entries: [{
                id: 'roughnecks', term: 'Roughnecks', type: 'faction',
                definition: '', definitionSource: 'none', backlinkIds: [], extra: {}
            }] }]
        }];

        test('group-by-type checkbox reflects the current config value', () => {
            const checked = buildGlossaryHtml(groups, ['faction'], { nonce: NONCE, groupByType: true });
            assert.match(checked, /id="toggle-group-by-type" checked/);

            const unchecked = buildGlossaryHtml(groups, ['faction'], { nonce: NONCE, groupByType: false });
            assert.doesNotMatch(unchecked, /id="toggle-group-by-type" checked/);
        });

        test('hide-unreferenced checkbox is the inverse of showZeroBacklinkTerms', () => {
            const showing = buildGlossaryHtml(groups, ['faction'], { nonce: NONCE, showZeroBacklinkTerms: true });
            assert.doesNotMatch(showing, /id="toggle-hide-unreferenced" checked/);

            const hiding = buildGlossaryHtml(groups, ['faction'], { nonce: NONCE, showZeroBacklinkTerms: false });
            assert.match(hiding, /id="toggle-hide-unreferenced" checked/);
        });

        test('sort select reflects the current sortBy value', () => {
            const alpha = buildGlossaryHtml(groups, ['faction'], { nonce: NONCE, sortBy: 'alphabetical' });
            assert.match(alpha, /value="alphabetical" selected/);

            const ranked = buildGlossaryHtml(groups, ['faction'], { nonce: NONCE, sortBy: 'mostReferenced' });
            assert.match(ranked, /value="mostReferenced" selected/);
        });

        test('toggling a checkbox posts an updateSetting message with the correct key', () => {
            const html = buildGlossaryHtml(groups, ['faction'], { nonce: NONCE });
            assert.match(html, /key: 'glossaryGroupByType'/);
            assert.match(html, /key: 'glossaryShowZeroBacklinkTerms'/);
            assert.match(html, /key: 'glossarySortBy'/);
        });

        test('a copy-as-Markdown button is present and wired to postMessage', () => {
            const html = buildGlossaryHtml(groups, ['faction'], { nonce: NONCE });
            assert.match(html, /data-action="copyMarkdown"/);
            assert.match(html, /command: 'copyMarkdown'/);
        });

        test('a type section is wrapped for collapsing when the group has a real type', () => {
            const html = buildGlossaryHtml(groups, ['faction'], { nonce: NONCE });
            assert.match(html, /<div class="type-section" id="type-section-0">/);
        });

        test('a flat (null-type) group is not wrapped in a collapsible section', () => {
            const flatGroups = [{ type: null, letters: [{ letter: 'R', entries: groups[0].letters[0].entries }] }];
            const html = buildGlossaryHtml(flatGroups, ['faction'], { nonce: NONCE });
            assert.doesNotMatch(html, /class="type-section"/);
        });

        test('keyboard navigation handlers (ArrowDown/ArrowUp/Enter) are wired on the search input', () => {
            const html = buildGlossaryHtml(groups, ['faction'], { nonce: NONCE });
            assert.match(html, /ArrowDown/);
            assert.match(html, /ArrowUp/);
            assert.match(html, /is-focused/);
        });

        test('a sortBy: mostReferenced group with letter: null renders no letter heading', () => {
            const rankedGroups = [{
                type: 'faction',
                letters: [{ letter: null, entries: groups[0].letters[0].entries }]
            }];
            const html = buildGlossaryHtml(rankedGroups, ['faction'], { nonce: NONCE });
            assert.doesNotMatch(html, /class="letter"/);
        });
    });
});
