'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

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
                return { fsPath, scheme: 'file', path: fsPath };
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
        }
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

const { buildHoverIntelligenceSummary, buildHoverContent, buildQueryPreview, isPositionInsideWikilink } = require('../src/features/hover');

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
        assert.match(markdown, /\*\*account:\*\* \\\[\\\[kyocera\\\]\\\]/i);
        assert.match(markdown, /\*\*email:\*\* carlos@kyocera\\\.com/i);
        assert.doesNotMatch(markdown, /Yamlink hints/i);
        assert.match(markdown, /\\\[\\\[kyocera\\\]\\\]/);
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

Module._resolveFilename = originalResolve;
