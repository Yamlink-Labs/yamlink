'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const path = require('path');
const os = require('os');

const originalResolve = Module._resolveFilename.bind(Module);
let HOVER_FIELDS_CACHE = new Map([
    ['concept-inkjet', {
        type: 'note',
        title: 'Inkjet concept',
        related: '[[inkjet]]',
        products: '[[product-inkjet-pro]]',
        summary: 'Inkjet knowledge and product context'
    }]
]);

require.cache.__hover_vscode__ = {
    id: '__hover_vscode__',
    filename: '__hover_vscode__',
    loaded: true,
    exports: {
        MarkdownString: class MarkdownString {
            constructor(value = '') {
                this.value = value;
                this.isTrusted = false;
                this.supportHtml = false;
                this.supportThemeIcons = false;
            }

            appendMarkdown(text) {
                this.value += text;
            }
        },
        Uri: {
            file(fsPath) {
                const normalized = String(fsPath).replace(/\\/g, '/');
                return {
                    fsPath, scheme: 'file', path: fsPath,
                    toString() { return `file:///${normalized.replace(/^\//, '')}`; }
                };
            }
        },
        Position: class Position {
            constructor(line, character) {
                this.line = line;
                this.character = character;
            }
        },
        Range: class Range {
            constructor(start, end) {
                this.start = start;
                this.end = end;
            }
        },
        Hover: class Hover {
            constructor(contents, range) {
                this.contents = contents;
                this.range = range;
            }
        }
    }
};

require.cache.__hover_index__ = {
    id: '__hover_index__',
    filename: '__hover_index__',
    loaded: true,
    exports: {
        parseFrontmatter(content) {
            const match = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (!match) return null;
            const rows = {};
            for (const line of match[1].split(/\r?\n/)) {
                const fieldMatch = line.match(/^([^:]+):\s*(.*)$/);
                if (!fieldMatch) continue;
                rows[fieldMatch[1].trim()] = fieldMatch[2].trim();
            }
            return rows;
        },
        getPathIndex() {
            return new Map();
        },
        getFieldsCache() {
            return HOVER_FIELDS_CACHE;
        },
        getVaultGeneration() {
            return 0;
        },
        getAliasIndex() {
            return null;
        }
    }
};

require.cache.__hover_date__ = {
    id: '__hover_date__',
    filename: '__hover_date__',
    loaded: true,
    exports: {
        normaliseDateInput(value) {
            return String(value || '').trim() || null;
        },
        getTodayIsoLocal() { return '2026-05-30'; }
    }
};

require.cache.__hover_schema__ = {
    id: '__hover_schema__',
    filename: '__hover_schema__',
    loaded: true,
    exports: {
        getSchema() {
            return null;
        },
        getSchemaTargets() {
            return new Set();
        },
        clearSchemaRegistry() {},
        registerSchema() {},
        getSchemaStats() { return { schemas: 0 }; }
    }
};

require.cache.__hover_query__ = {
    id: '__hover_query__',
    filename: '__hover_query__',
    loaded: true,
    exports: {
        parseViewQuery(text) {
            if (String(text || '').includes('group by')) {
                return { type: 'mission', groupBy: 'commanding-officer' };
            }
            return null;
        },
        parseAllViewQueries(text) {
            const raw = String(text || '');
            if (raw.includes('\n\n!view ')) {
                return [
                    { type: 'mission', wheres: [{ value: 'lt-rasczak' }] },
                    { type: 'character', wheres: [{ value: 'lt-rasczak' }] }
                ];
            }
            if (raw.includes('group by')) {
                return [{ type: 'mission', groupBy: 'commanding-officer' }];
            }
            return null;
        },
        runQuery(query) {
            if (query && query.groupBy === 'commanding-officer') {
                return {
                    success: true,
                    rows: [{ id: 'mission-klendathu', fields: { 'commanding-officer': 'lt-rasczak' } }],
                    groups: [
                        { key: 'lt-rasczak', count: 2 },
                        { key: 'johnny-rico', count: 1 }
                    ],
                    groupBy: 'commanding-officer',
                    columns: ['commanding-officer', 'count']
                };
            }
            return { success: false, rows: [], columns: [] };
        }
    }
};

require.cache.__hover_suggestions__ = {
    id: '__hover_suggestions__',
    filename: '__hover_suggestions__',
    loaded: true,
    exports: {
        computeSuggestionsForNode(id) {
            if (id === 'concept-inkjet') {
                return [{
                    title: 'Products for this concept',
                    description: 'Find products that share this concept'
                }];
            }
            return [];
        },
        explainSuggestionState() {
            return { title: 'No suggested views yet', description: '', reasons: [] };
        },
        getDefaultSortFieldForType() { return ''; }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__hover_vscode__';
    if (request === '../core/index') return '__hover_index__';
    if (request === '../core/indexService') return '__hover_index__';
    if (request === '../core/date') return '__hover_date__';
    if (request === '../registries/schemaRegistry') return '__hover_schema__';
    if (request === '../engine/query') return '__hover_query__';
    if (request === '../engine/suggestions') return '__hover_suggestions__';
    return originalResolve(request, parent, ...rest);
};

const {
    buildHoverIntelligenceSummary, buildHoverContent, buildQueryPreview, isPositionInsideWikilink,
    buildHoverBadgeSvg, buildHoverBadgeDataUri, buildHoverBadgeMarkdown,
    renderInlineWikilinks,
    _buildImagePreviewHover,
    _buildInlineCalcHover
} = require('../src/features/hover');
const { resolveImageEmbed: _resolveImageEmbed } = require('../src/core/imageEmbed');
const { createVault } = require('./lib/vaultSim');
const { buildQuoteBlockId } = require('../src/core/bodyBlocks');

describe('hover intelligence summary', () => {
    test('query preview hover can stay out of the way when hovering a wikilink', () => {
        const line = 'contact: [[bruce-wayne]]';
        const charInsideLink = line.indexOf('bruce');
        assert.equal(isPositionInsideWikilink(line, charInsideLink), true);
        assert.equal(isPositionInsideWikilink(line, 0), false);
    });

    test('keeps wikilink hover cards short and puts note preview content first', () => {
        const content = [
            '---',
            'id: carlos-evert',
            'type: contact',
            'account: [[kyocera]]',
            'email: carlos@kyocera.com',
            '---',
            '# Carlos Evert',
            '',
            'Primary account contact for Kyocera.'
        ].join('\n');

        const hover = buildHoverContent('carlos-evert', content, 'C:\\vault\\carlos-evert.md');
        const markdown = hover.value;
        const previewIndex = markdown.indexOf('### carlos\\-evert');

        assert.ok(previewIndex >= 0);
        assert.match(markdown, /Primary account contact for Kyocera\\\./i);
        // Relation-field values render as their clean resolved name, not raw
        // bracket syntax — no idIndex is passed here, so it's plain text, not
        // a link (see the "clickable" test below for the linked case).
        assert.match(markdown, /\*\*account:\*\* kyocera/i);
        assert.doesNotMatch(markdown, /\[\[kyocera\]\]/);
        assert.match(markdown, /\*\*email:\*\* carlos@kyocera\\\.com/i);
        assert.doesNotMatch(markdown, /Yamlink hints/i);
        assert.doesNotMatch(markdown, /\!view|\bwhere\b|\bselect\b|\bsort\b/i);
        assert.doesNotMatch(markdown, /\[Open\]|\[Open Report\]|command:/i);
    });

    test('keeps the context line quiet and avoids confidence-heavy wording', () => {
        const content = [
            '---',
            'id: concept-inkjet',
            'type: note',
            'title: Inkjet concept',
            'related: [[inkjet]]',
            'products: [[product-inkjet-pro]]',
            '---'
        ].join('\n');

        const summary = buildHoverIntelligenceSummary('concept-inkjet', content);
        assert.ok(summary.length >= 0);
        assert.doesNotMatch(summary, /\(\d+%\)/);
        assert.doesNotMatch(summary, /Yamlink reads this as/);
        assert.doesNotMatch(summary, /\!view|\bwhere\b|\bselect\b|\bsort\b/i);
    });

    test('hover summary stays compact when shared context exists', () => {
        const content = [
            '---',
            'id: concept-inkjet',
            'type: note',
            'title: Inkjet concept',
            'related: [[inkjet]]',
            'products: [[product-inkjet-pro]]',
            '---'
        ].join('\n');

        const originalCache = HOVER_FIELDS_CACHE;
        HOVER_FIELDS_CACHE = new Map([
            ['concept-inkjet', {
                type: 'note',
                title: 'Inkjet concept',
                related: '[[inkjet]]',
                products: '[[product-inkjet-pro]]'
            }],
            ['product-inkjet-pro', {
                type: 'product',
                related: '[[inkjet]]'
            }],
            ['product-colorstream', {
                type: 'product',
                related: '[[inkjet]]'
            }],
            ['inkjet', {
                type: 'concept'
            }]
        ]);

        const summary = buildHoverIntelligenceSummary('concept-inkjet', content);
        assert.ok(summary.split('\n').filter(Boolean).length <= 1);
        assert.ok(summary.length > 0);

        HOVER_FIELDS_CACHE = originalCache;
    });

    test('hover summary stays compact when adaptive field patterns exist', () => {
        const content = [
            '---',
            'id: contact-prospect',
            'type: note',
            'email: prospect@acme.com',
            'phone: +56 9 1111 1111',
            '---'
        ].join('\n');

        const originalCache = HOVER_FIELDS_CACHE;
        HOVER_FIELDS_CACHE = new Map([
            ['contact-prospect', {
                type: 'note',
                email: 'prospect@acme.com',
                phone: '+56 9 1111 1111'
            }],
            ['contact-andreas', {
                type: 'contact',
                email: 'andreas@acme.com',
                phone: '+56 9 2222 2222',
                account: '[[acme]]'
            }],
            ['contact-brenda', {
                type: 'contact',
                email: 'brenda@globex.com',
                phone: '+56 9 3333 3333',
                account: '[[globex]]'
            }],
            ['acme', { type: 'account', name: 'Acme' }],
            ['globex', { type: 'account', name: 'Globex' }]
        ]);

        const summary = buildHoverIntelligenceSummary('contact-prospect', content);
        assert.ok(summary.split('\n').filter(Boolean).length <= 1);
        assert.ok(summary.length > 0);

        HOVER_FIELDS_CACHE = originalCache;
    });

    test('hover summary stays compact when nearby notes share the same flow', () => {
        const content = [
            '---',
            'id: fix-graph-selection',
            'type: note',
            'status: in-progress',
            'project: [[yamlink]]',
            'reporter: [[alice-smith]]',
            '---'
        ].join('\n');

        const originalCache = HOVER_FIELDS_CACHE;
        HOVER_FIELDS_CACHE = new Map([
            ['fix-graph-selection', {
                type: 'note',
                status: 'in-progress',
                project: '[[yamlink]]',
                reporter: '[[alice-smith]]'
            }],
            ['review-hover-card', {
                type: 'task',
                status: 'planned',
                project: '[[yamlink]]'
            }],
            ['yamlink', { type: 'project', name: 'Yamlink' }],
            ['alice-smith', { type: 'person', name: 'Alice Smith' }]
        ]);

        const summary = buildHoverIntelligenceSummary('fix-graph-selection', content);
        assert.ok(summary.split('\n').filter(Boolean).length <= 1);
        assert.ok(summary.length > 0);

        HOVER_FIELDS_CACHE = originalCache;
    });

    test('context line stays single-line even when several signals exist', () => {
        const content = [
            '---',
            'id: contact-prospect',
            'type: note',
            'email: prospect@acme.com',
            'phone: +56 9 1111 1111',
            '---'
        ].join('\n');

        const originalCache = HOVER_FIELDS_CACHE;
        HOVER_FIELDS_CACHE = new Map([
            ['contact-prospect', {
                type: 'note',
                email: 'prospect@acme.com',
                phone: '+56 9 1111 1111'
            }],
            ['contact-andreas', {
                type: 'contact',
                email: 'andreas@acme.com',
                phone: '+56 9 2222 2222',
                account: '[[acme]]'
            }],
            ['contact-brenda', {
                type: 'contact',
                email: 'brenda@globex.com',
                phone: '+56 9 3333 3333',
                account: '[[globex]]'
            }],
            ['acme', { type: 'account', name: 'Acme' }],
            ['globex', { type: 'account', name: 'Globex' }]
        ]);

        const summary = buildHoverIntelligenceSummary('contact-prospect', content);
        const lines = summary.split('\n').filter(Boolean);
        assert.ok(lines.length <= 1);

        HOVER_FIELDS_CACHE = originalCache;
    });

    test('caps hover intelligence to one short line', () => {
        const content = [
            '---',
            'id: fix-graph-selection',
            'type: note',
            'status: in-progress',
            'project: [[yamlink]]',
            'reporter: [[alice-smith]]',
            '---'
        ].join('\n');

        const originalCache = HOVER_FIELDS_CACHE;
        HOVER_FIELDS_CACHE = new Map([
            ['fix-graph-selection', {
                type: 'note',
                status: 'in-progress',
                project: '[[yamlink]]',
                reporter: '[[alice-smith]]'
            }],
            ['review-hover-card', {
                type: 'task',
                status: 'planned',
                project: '[[yamlink]]'
            }],
            ['yamlink', { type: 'project', name: 'Yamlink' }],
            ['alice-smith', { type: 'person', name: 'Alice Smith' }]
        ]);

        const summary = buildHoverIntelligenceSummary('fix-graph-selection', content);
        assert.ok(summary.split('\n').filter(Boolean).length <= 1);
        assert.ok(summary.length <= 120);

        HOVER_FIELDS_CACHE = originalCache;
    });

    test('hover summary can use shared authoring-engine relation signals', () => {
        const content = [
            '---',
            'id: concept-inkjet',
            'type: note',
            'related: [[inkjet]]',
            'products: [[product-inkjet-pro]]',
            '---'
        ].join('\n');

        const originalCache = HOVER_FIELDS_CACHE;
        HOVER_FIELDS_CACHE = new Map([
            ['concept-inkjet', {
                type: 'note',
                related: '[[inkjet]]',
                products: '[[product-inkjet-pro]]'
            }],
            ['inkjet', { type: 'concept' }],
            ['product-inkjet-pro', { type: 'product' }]
        ]);

        const summary = buildHoverIntelligenceSummary('concept-inkjet', content);
        assert.ok(summary.length > 0);
        assert.match(summary, /(related|products)/i);

        HOVER_FIELDS_CACHE = originalCache;
    });

    test('grouped query previews summarize the result instead of rendering a big table', () => {
        const preview = buildQueryPreview('!view mission\ngroup by commanding-officer\nsort count desc', 'mission-klendathu');
        assert.match(preview, /Groups by commanding\\-officer/i);
        assert.match(preview, /lt\\-rasczak \(2\)/i);
        assert.doesNotMatch(preview, /\|/);
    });

    test('compound suggested views are summarized instead of rendered as one broken table', () => {
        const preview = buildQueryPreview('!view mission\nwhere unit = [[lt-rasczak]]\n\n!view character\nwhere commanding-officer = [[lt-rasczak]]', 'mission-klendathu');
        assert.match(preview, /related views will be inserted/i);
        assert.doesNotMatch(preview, /\| .* \| .* \|/);
    });
});

describe('hover anchor previews', () => {
    test('hover for [[a#details]] uses the matching heading section only', () => {
        const vault = createVault({
            'a.md': [
                '---',
                'id: a',
                'type: note',
                '---',
                '',
                '## Background',
                'Some background text here.',
                '',
                '## Details',
                'This is the details paragraph with specific info.'
            ].join('\n'),
            'b.md': [
                '---',
                'id: b',
                'type: note',
                'source: "[[a#details]]"',
                '---'
            ].join('\n')
        });
        const content = fs.readFileSync(path.join(vault.dir, 'a.md'), 'utf8');
        const hover = buildHoverContent('a', content, path.join(vault.dir, 'a.md'), null, 'details');

        assert.match(hover.value, /Details/);
        assert.match(hover.value, /details paragraph/i);
        assert.doesNotMatch(hover.value, /Background/);
        assert.doesNotMatch(hover.value, /background text/i);

        vault.destroy();
    });

    test('hover for missing anchor falls back to the normal note preview', () => {
        const vault = createVault({
            'a.md': [
                '---',
                'id: a',
                'type: note',
                '---',
                '',
                '## Background',
                'Some background text here.',
                '',
                '## Details',
                'This is the details paragraph with specific info.'
            ].join('\n'),
            'b.md': [
                '---',
                'id: b',
                'type: note',
                'source: "[[a#nonexistent-anchor]]"',
                '---'
            ].join('\n')
        });
        const content = fs.readFileSync(path.join(vault.dir, 'a.md'), 'utf8');
        const fallbackAnchor = buildHoverContent('a', content, path.join(vault.dir, 'a.md'), null, 'nonexistent-anchor');
        const plainHover = buildHoverContent('a', content, path.join(vault.dir, 'a.md'));

        assert.match(fallbackAnchor.value, /Some background text here/i);
        assert.equal(fallbackAnchor.value, plainHover.value);
        assert.match(plainHover.value, /Some background text here/i);

        vault.destroy();
    });

    test('an anchor with different accents than the real heading still matches — a real, reported gap: a Spanish/Portuguese-language vault using accented headings never matched before this', () => {
        const vault = createVault({
            'a.md': [
                '---',
                'id: a',
                'type: note',
                '---',
                '',
                '## Monopólio',
                'Definición y características del monopolio.'
            ].join('\n')
        });
        const content = fs.readFileSync(path.join(vault.dir, 'a.md'), 'utf8');
        // Reference written WITHOUT the accent — must still match the
        // accented real heading.
        const hover = buildHoverContent('a', content, path.join(vault.dir, 'a.md'), null, 'Monopolio');
        assert.match(hover.value, /Monopólio/);
        assert.match(hover.value, /Definición y características/);
        vault.destroy();
    });

    test('an anchor that matches no heading, but IS mentioned as plain/bolded prose, shows that surrounding paragraph instead of the generic whole-note summary', () => {
        const vault = createVault({
            'a.md': [
                '---',
                'id: a',
                'type: note',
                '---',
                '',
                '## Glosario',
                '',
                '**Monopolio:** estructura de mercado con un único oferente.',
                '',
                '## Otros temas',
                'Contenido no relacionado.'
            ].join('\n')
        });
        const content = fs.readFileSync(path.join(vault.dir, 'a.md'), 'utf8');
        const hover = buildHoverContent('a', content, path.join(vault.dir, 'a.md'), null, 'Monopolio');
        assert.match(hover.value, /mentioned, not a heading/);
        assert.match(hover.value, /estructura de mercado con un único oferente/);
        // Must NOT have fallen through to the generic whole-note summary
        // (which would render a `###` title heading for the note itself).
        assert.doesNotMatch(hover.value, /^### /m);
        vault.destroy();
    });

    test('an anchor matched nowhere at all (not a heading, not mentioned in prose) still falls back to the generic whole-note summary, unchanged', () => {
        const vault = createVault({
            'a.md': [
                '---',
                'id: a',
                'type: note',
                '---',
                '',
                '## Something else entirely',
                'Unrelated content.'
            ].join('\n')
        });
        const content = fs.readFileSync(path.join(vault.dir, 'a.md'), 'utf8');
        const hover = buildHoverContent('a', content, path.join(vault.dir, 'a.md'), null, 'Monopolio');
        const plainHover = buildHoverContent('a', content, path.join(vault.dir, 'a.md'));
        assert.equal(hover.value, plainHover.value);
        vault.destroy();
    });

    test('pipe-aliased anchor [[a#details|Label]] extracts section not label', () => {
        // buildAnchorHoverContent is called with the extracted anchorRaw.
        // The extraction must strip the pipe alias so "section|Label" doesn't reach the matcher.
        const content = [
            '---', 'id: a', 'type: note', '---', '',
            '## Background', 'Background text.',
            '', '## Details', 'Details paragraph.'
        ].join('\n');
        // Simulate what registerHover extracts from [[a#details|Display]]
        const rawLinkText  = 'a#details|Display';
        const hashIndex    = rawLinkText.indexOf('#');
        const anchorRaw    = hashIndex === -1 ? '' : rawLinkText.slice(hashIndex + 1).split('|')[0].trim();
        assert.equal(anchorRaw, 'details', 'pipe alias stripped from anchor');
        const hover = buildHoverContent('a', content, '', null, anchorRaw);
        assert.match(hover.value, /Details/);
        assert.doesNotMatch(hover.value, /Background/);
    });

    test('hover for [[a]] without an anchor keeps the normal preview behavior', () => {
        const vault = createVault({
            'a.md': [
                '---',
                'id: a',
                'type: note',
                '---',
                '',
                '## Background',
                'Some background text here.',
                '',
                '## Details',
                'This is the details paragraph with specific info.'
            ].join('\n')
        });
        const content = fs.readFileSync(path.join(vault.dir, 'a.md'), 'utf8');
        const hover = buildHoverContent('a', content, path.join(vault.dir, 'a.md'));

        assert.match(hover.value, /Some background text here/i);
        assert.doesNotMatch(hover.value, /\*\*Details\*\*\n\nThis is the details paragraph/i);

        vault.destroy();
    });

    test('hover for [[a^block-id]] uses the matching body block only', () => {
        const content = [
            '---',
            'id: a',
            'type: note',
            '---',
            '',
            '- [ ] Review recon logs with Rico.',
            '',
            '> Training-yard line commonly associated with Jean Rasczak.'
        ].join('\n');

        const quoteBlockId = buildQuoteBlockId(1, 'Training-yard line commonly associated with Jean Rasczak.');
        const hover = buildHoverContent('a', content, '', null, '', quoteBlockId);
        assert.match(hover.value, /Quote/);
        assert.match(hover.value, /Training\\-yard line/i);
        assert.doesNotMatch(hover.value, /Review recon logs/i);
    });
});

describe('hover custom badge rendering', () => {
    test('buildHoverBadgeSvg renders one rect+text pair per label', () => {
        const svg = buildHoverBadgeSvg([{ text: 'contact', bg: '#C49BF0', fg: '#151617' }]);
        assert.match(svg, /^<svg /);
        assert.match(svg, /<rect[^>]*fill="#C49BF0"/);
        assert.match(svg, /<text[^>]*fill="#151617"[^>]*>contact<\/text>/);
    });

    test('buildHoverBadgeSvg escapes XML-sensitive characters in label text', () => {
        const svg = buildHoverBadgeSvg([{ text: '<script>&"test"', bg: '#000', fg: '#fff' }]);
        assert.doesNotMatch(svg, /<script>/);
        assert.match(svg, /&lt;script&gt;/);
        assert.match(svg, /&amp;/);
        assert.match(svg, /&quot;/);
    });

    test('buildHoverBadgeSvg places multiple labels side by side with growing width', () => {
        const svg = buildHoverBadgeSvg([
            { text: 'contact', bg: '#C49BF0', fg: '#151617' },
            { text: 'active', bg: '#5ECFBE', fg: '#151617' }
        ]);
        const widthMatch = svg.match(/width="(\d+)"/);
        assert.ok(widthMatch, 'expected a width attribute on the outer svg');
        assert.ok(Number(widthMatch[1]) > 100, 'two labels should produce a wider badge than one');
        assert.equal((svg.match(/<rect/g) || []).length, 2);
    });

    test('buildHoverBadgeDataUri returns a valid base64 SVG data URI that decodes back to the same markup', () => {
        const labels = [{ text: 'contact', bg: '#C49BF0', fg: '#151617' }];
        const uri = buildHoverBadgeDataUri(labels);
        assert.match(uri, /^data:image\/svg\+xml;base64,/);
        const base64 = uri.replace('data:image/svg+xml;base64,', '');
        const decoded = Buffer.from(base64, 'base64').toString('utf8');
        assert.equal(decoded, buildHoverBadgeSvg(labels));
    });

    test('buildHoverBadgeMarkdown returns markdown image syntax for type and status', () => {
        const markdown = buildHoverBadgeMarkdown({ type: 'contact', status: 'active' });
        assert.match(markdown, /^!\[\]\(data:image\/svg\+xml;base64,/);
    });

    test('buildHoverBadgeMarkdown returns empty string when neither type nor status is set', () => {
        assert.equal(buildHoverBadgeMarkdown({}), '');
        assert.equal(buildHoverBadgeMarkdown({ summary: 'no type or status here' }), '');
    });

    test('buildHoverContent embeds the badge markdown for a note with type and status', () => {
        const content = '---\nid: a\ntype: contact\nstatus: active\n---\n\nBody text.\n';
        const hover = buildHoverContent('a', content);
        assert.match(hover.value, /!\[\]\(data:image\/svg\+xml;base64,/);
    });
});

describe('hover clickable wikilinks', () => {
    test('relation-field values with a resolvable target render as a command:vscode.open link', () => {
        const vault = createVault({
            'kyocera.md': '---\nid: kyocera\ntype: company\nname: Kyocera\n---\n',
            'carlos-evert.md': [
                '---',
                'id: carlos-evert',
                'type: contact',
                'account: [[kyocera]]',
                '---',
                '',
                'Body text.'
            ].join('\n')
        });
        try {
            const content = fs.readFileSync(path.join(vault.dir, 'carlos-evert.md'), 'utf8');
            const hover = buildHoverContent('carlos-evert', content, path.join(vault.dir, 'carlos-evert.md'), vault.idIndex);
            assert.match(hover.value, /\*\*account:\*\* \[kyocera\]\(command:vscode\.open\?/);
            assert.doesNotMatch(hover.value, /\[\[kyocera\]\]/);
        } finally {
            vault.destroy();
        }
    });

    // Real bug, found from a screenshot: a YAML block-list relation field
    // (e.g. `contacts:` with several entries) is flattened by the
    // frontmatter parser into one comma-joined string like
    // "[[a]], [[b]], [[c]]" — a previous `isWikilink` check
    // (`/^\[\[.+\]\]$/`) incorrectly matched this whole multi-value string
    // as if it were a single wikilink (the greedy `.+` doesn't care about
    // brackets in the middle), then `raw.slice(2, -2)` corrupted it by
    // stripping only the outermost two characters on each end — silently
    // eating the first entry's leading `[[` and the last entry's trailing
    // `]]` while leaving the middle entry untouched.
    test('a multi-value block-list relation field renders every entry correctly, none mangled', () => {
        const vault = createVault({
            'carlos-trochez.md': '---\nid: carlos-trochez\ntype: contact\nname: Carlos Trochez\n---\n',
            // Single-line form deliberately, not a multi-line YAML block list:
            // the real frontmatter parser flattens a block list into exactly
            // this comma-joined string shape anyway (see `core/indexService`),
            // which is what buildHoverDetails/renderFieldValueLinks actually
            // operate on regardless of how it was originally authored.
            'xmpie.md': [
                '---',
                'id: xmpie',
                'type: account',
                'contacts: [[yaron-mohaban]], [[don-scott]], [[carlos-trochez]]',
                '---'
            ].join('\n')
        });
        try {
            const content = fs.readFileSync(path.join(vault.dir, 'xmpie.md'), 'utf8');
            const hover = buildHoverContent('xmpie', content, path.join(vault.dir, 'xmpie.md'), vault.idIndex);
            // Every entry's full name must survive intact — none missing a
            // leading or trailing fragment the way the original bug produced.
            assert.match(hover.value, /yaron\\?-mohaban/);
            assert.match(hover.value, /don\\?-scott/);
            assert.match(hover.value, /carlos\\?-trochez/);
            assert.doesNotMatch(hover.value, /\[\[/);
            assert.doesNotMatch(hover.value, /\]\]/);
            // The one resolvable entry still becomes a real clickable link.
            assert.match(hover.value, /\[carlos\\-trochez\]\(command:vscode\.open\?/);
        } finally {
            vault.destroy();
        }
    });

    test('relation-field values with an unresolvable target fall back to plain escaped bracket text, not a broken link', () => {
        const vault = createVault({
            'carlos-evert.md': [
                '---',
                'id: carlos-evert',
                'type: contact',
                'account: "[[does-not-exist]]"',
                '---'
            ].join('\n')
        });
        try {
            const content = fs.readFileSync(path.join(vault.dir, 'carlos-evert.md'), 'utf8');
            const hover = buildHoverContent('carlos-evert', content, path.join(vault.dir, 'carlos-evert.md'), vault.idIndex);
            assert.doesNotMatch(hover.value, /command:vscode\.open/);
        } finally {
            vault.destroy();
        }
    });

    test('body preview wikilinks render as clickable links, with plain text around them still escaped', () => {
        const vault = createVault({
            'rico.md': '---\nid: rico\ntype: character\nname: Rico\n---\n',
            'a.md': [
                '---',
                'id: a',
                'type: note',
                '---',
                '',
                'Trained alongside [[rico]] before the war (see notes).'
            ].join('\n')
        });
        try {
            const content = fs.readFileSync(path.join(vault.dir, 'a.md'), 'utf8');
            const hover = buildHoverContent('a', content, path.join(vault.dir, 'a.md'), vault.idIndex);
            assert.match(hover.value, /Trained alongside \[rico\]\(command:vscode\.open\?/);
            assert.match(hover.value, /before the war \\\(see notes\\\)/);
        } finally {
            vault.destroy();
        }
    });

    test('renderInlineWikilinks with a null idIndex escapes everything and links nothing', () => {
        const out = renderInlineWikilinks('see [[rico]] and *emphasis*', null);
        assert.doesNotMatch(out, /command:/);
        assert.match(out, /\\\[\\\[rico\\\]\\\]/);
        assert.match(out, /\\\*emphasis\\\*/);
    });

    test('renderInlineWikilinks resolves an alias label as the link text', () => {
        const vault = createVault({
            'rico.md': '---\nid: rico\ntype: character\n---\n'
        });
        try {
            const out = renderInlineWikilinks('see [[rico|Johnny Rico]]', vault.idIndex);
            assert.match(out, /\[Johnny Rico\]\(command:vscode\.open\?/);
        } finally {
            vault.destroy();
        }
    });
});

describe('hover image embed preview', () => {
    function withTempDir(fn) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-hover-img-'));
        try {
            return fn(dir);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    test('resolves an image embed relative to the note\'s own directory', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
            const resolved = _resolveImageEmbed('photo.png', dir);
            assert.equal(resolved, path.join(dir, 'photo.png'));
        });
    });

    test('returns null for a target that does not look like an image extension', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'other-note.md'), '---\nid: other-note\n---\n');
            assert.equal(_resolveImageEmbed('other-note.md', dir), null);
        });
    });

    test('returns null when the image file does not actually exist, rather than guessing', () => {
        withTempDir((dir) => {
            assert.equal(_resolveImageEmbed('does-not-exist.png', dir), null);
        });
    });

    test('strips an alias segment before resolving, same as note wikilinks', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'diagram.svg'), '<svg></svg>');
            const resolved = _resolveImageEmbed('diagram.svg|My Diagram', dir);
            assert.equal(resolved, path.join(dir, 'diagram.svg'));
        });
    });

    test('builds a hover with a real file:// image reference and a size label', () => {
        withTempDir((dir) => {
            const imagePath = path.join(dir, 'photo.png');
            fs.writeFileSync(imagePath, Buffer.alloc(2048));
            const hover = _buildImagePreviewHover(imagePath);
            assert.match(hover.value, /!\[photo\\\.png\]\(file:\/\/\//);
            assert.match(hover.value, /photo\\\.png · 2\.0 KB/);
        });
    });

    test('buildHoverContent shows a real image preview for a ![[photo.png]] embed that is not a note', () => {
        withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'photo.png'), Buffer.alloc(100));
            const notePath = path.join(dir, 'a.md');
            const content = 'Body text with an embed: ![[photo.png]]';
            fs.writeFileSync(notePath, content);

            // Simulate the registerHover provider's own resolution path directly,
            // since buildHoverContent itself only handles the resolved-note case.
            const resolved = _resolveImageEmbed('photo.png', path.dirname(notePath));
            assert.ok(resolved, 'image embed should resolve to a real file');
            const hover = _buildImagePreviewHover(resolved);
            assert.doesNotMatch(hover.value, /could not find/i);
            assert.match(hover.value, /!\[photo\\\.png\]/);
        });
    });
});

describe('inline calc hover', () => {
    // Single-line offset-based stand-in for a TextDocument: position.character
    // doubles as the absolute offset, matching the stub's positionAt below.
    function calcDocument(text) {
        return {
            getText: () => text,
            offsetAt: (position) => position.character,
            positionAt: (offset) => ({ line: 0, character: offset })
        };
    }
    function hoverAt(text, marker, idIndex) {
        const doc = calcDocument(text);
        return _buildInlineCalcHover(doc, { line: 0, character: text.indexOf(marker) + 1 }, idIndex);
    }

    test('shows the full expression and result on hover', () => {
        const hover = hoverAt('The total is `=1 + (5+1/-1)` before tax.', '`=');
        assert.ok(hover);
        assert.match(hover.contents.value, /1 \+ \(5\+1\/-1\)/);
        assert.match(hover.contents.value, /\*\*5\*\*/);
    });

    test('shows the cell label, and the name when the block has one', () => {
        const text = '`=1+1`\n`total=1+2`';
        assert.match(hoverAt(text, '`=1+1`').contents.value, /\*\*Y1\*\*/);
        const named = hoverAt(text, '`total').contents.value;
        assert.match(named, /\*\*Y2\*\* · total/);
    });

    test('shows which cells a formula reads, with their values', () => {
        const text = '`total=1+2`\n`=total*3`';
        const hover = hoverAt(text, '`=total');
        assert.match(hover.contents.value, /Uses: total = 3/);
        assert.match(hover.contents.value, /\*\*9\*\*/);
    });

    test('a reference is resolved against blocks above it, not evaluated in isolation', () => {
        const hover = hoverAt('`=4`\n`=Y1+1`', '`=Y1');
        assert.match(hover.contents.value, /\*\*5\*\*/);
        assert.doesNotMatch(hover.contents.value, /#VALUE!|#REF!|#NAME\?|#DIV\/0!/);
    });

    test('shows a typed #VALUE! badge for a malformed expression instead of a wrong number', () => {
        const hover = hoverAt('Broken: `=1 + `', '`=');
        assert.ok(hover);
        assert.match(hover.contents.value, /\*\*#VALUE!\*\*/);
    });

    test('shows a typed #REF! badge for an out-of-range Y<N> reference, worded as a broken reference', () => {
        const hover = hoverAt('`=1+1`\n`=Y5*2`', '`=Y5');
        assert.ok(hover);
        assert.match(hover.contents.value, /\*\*#REF!\*\*/);
        assert.match(hover.contents.value, /Y5 does not exist/i);
    });

    test('shows a typed #NAME? badge for an unknown function', () => {
        const hover = hoverAt('`=foo(1)`', '`=');
        assert.ok(hover);
        assert.match(hover.contents.value, /\*\*#NAME\?\*\*/);
    });

    test('shows a typed #DIV/0! badge for division by zero', () => {
        const hover = hoverAt('`=1/0`', '`=');
        assert.ok(hover);
        assert.match(hover.contents.value, /\*\*#DIV\/0!\*\*/);
    });

    test('returns null when the cursor is not over a calc span', () => {
        const doc = calcDocument('Run `npm install` first.');
        assert.equal(_buildInlineCalcHover(doc, { line: 0, character: 5 }), null);
    });

    test('with no idIndex (every call site before this feature), a cross-note reference fails honestly as #REF!, not a crash', () => {
        const hover = hoverAt('`=[[budget]]^total`', '`=');
        assert.ok(hover);
        assert.match(hover.contents.value, /\*\*#REF!\*\*/);
    });

    test('with a real idIndex, resolves a cross-note reference to the other note\'s real computed value', () => {
        const os = require('os');
        const fs = require('fs');
        const path = require('path');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-hover-xref-'));
        const filePath = path.join(dir, 'budget.md');
        fs.writeFileSync(filePath, '---\nid: budget\n---\n\n`total=100+50`\n', 'utf8');
        try {
            const idIndex = new Map([['budget', filePath]]);
            const hover = hoverAt('`=[[budget]]^total + 10`', '`=', idIndex);
            assert.ok(hover);
            assert.match(hover.contents.value, /\*\*160\*\*/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    describe('step-by-step formula inspector ("How it resolved")', () => {
        test('a range fold shows every constituent cell, including ones not literally written in the source text', () => {
            const text = '`=10`\n`=20`\n`=5`\n`=sum(Y1:Y3)`';
            const hover = hoverAt(text, '`=sum');
            // Y2 never appears as a literal token in "Y1:Y3" — only the
            // trace (threaded through mathExpr.js's range-argument reader)
            // can surface it; collectDependencies()'s flat identifier regex
            // cannot, since there is no "Y2" substring in the source at all.
            assert.match(hover.contents.value, /Y1 = 10/);
            assert.match(hover.contents.value, /Y2 = 20/);
            assert.match(hover.contents.value, /Y3 = 5/);
            assert.match(hover.contents.value, /sum\(10, 20, 5\) → 35/);
            assert.match(hover.contents.value, /How it resolved/);
        });

        test('a cross-note reference step shows the original [[note]]^label text, not the internal __xrefN placeholder', () => {
            const os = require('os');
            const fs = require('fs');
            const path = require('path');
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-hover-trace-xref-'));
            const filePath = path.join(dir, 'budget.md');
            fs.writeFileSync(filePath, '---\nid: budget\n---\n\n`total=100+20`\n', 'utf8');
            try {
                const idIndex = new Map([['budget', filePath]]);
                const hover = hoverAt('`=[[budget]]^total * 2`', '`=', idIndex);
                assert.match(hover.contents.value, /\[\[budget\]\]\^total = 120/);
                assert.doesNotMatch(hover.contents.value, /__xref/);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });

        test('a comparison shows its own resolved step', () => {
            const text = '`requested=4200`\n`budget=5000`\n`=requested>budget`';
            const hover = hoverAt(text, '`=requested');
            assert.match(hover.contents.value, /4200 > 5000 → false/);
        });

        test('if() shows which branch was taken', () => {
            const text = '`x=10`\n`=if(x>0, "positive", "negative")`';
            const hover = hoverAt(text, '`=if');
            assert.match(hover.contents.value, /if condition is true → then-branch = "positive"/);
        });

        test('a block with no interesting resolution steps (a plain literal expression) shows no "How it resolved" section at all', () => {
            const hover = hoverAt('`=1 + 2`', '`=');
            assert.doesNotMatch(hover.contents.value, /How it resolved/);
        });
    });
});

Module._resolveFilename = originalResolve;
