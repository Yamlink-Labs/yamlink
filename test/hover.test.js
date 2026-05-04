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
    exports: {}
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
        }
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
        parseViewQuery() {
            return null;
        },
        runQuery() {
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

const { buildHoverIntelligenceSummary } = require('../src/features/hover');

describe('hover intelligence summary', () => {
    test('keeps the summary quiet and avoids confidence-heavy wording', () => {
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
        assert.match(summary, /This looks like a \*\*concept\*\* note/);
        assert.doesNotMatch(summary, /\(\d+%\)/);
        assert.doesNotMatch(summary, /Yamlink reads this as/);
    });

    test('can include one quiet nearby hint when shared context exists', () => {
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
        assert.match(summary, /Nearby: product-colorstream sits close through inkjet/);
        assert.match(summary, /Next view: Products for this concept/);

        HOVER_FIELDS_CACHE = originalCache;
    });

    test('can include one quiet likely-next hint when adaptive field patterns exist', () => {
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
        assert.match(summary, /Next step:/);
        assert.match(summary, /Why:/);
        assert.match(summary, /Next field:/);
        assert.match(summary, /often add account/);
        assert.match(summary, /Missing:/);
        assert.match(summary, /Context:/);
        assert.match(summary, /account usually points to acme/i);
        assert.match(summary, /Useful fields:/);
        assert.match(summary, /Pattern:/);
        assert.match(summary, /Try: add account/);

        HOVER_FIELDS_CACHE = originalCache;
    });

    test('can include one quiet possible-link hint when nearby notes share the same flow', () => {
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
        assert.match(summary, /Next step:/);
        assert.match(summary, /Why:/);
        assert.match(summary, /Related note:/);
        assert.match(summary, /review-hover-card seems to belong in the same flow through yamlink/);
        assert.match(summary, /Flow:/);
        assert.match(summary, /project -> yamlink/);
        assert.match(summary, /Nearby note:/);
        assert.match(summary, /review-hover-card also connects through project -> yamlink/);
        assert.match(summary, /Thread:/);
        assert.match(summary, /Common view:/);
        assert.match(summary, /Setup:/);
        assert.match(summary, /project around yamlink often includes task and note/);
        assert.match(summary, /task notes often cluster around yamlink/i);

        HOVER_FIELDS_CACHE = originalCache;
    });
});

Module._resolveFilename = originalResolve;
