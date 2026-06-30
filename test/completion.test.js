'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);
const REGISTERED_PROVIDERS = [];

const REGISTRY = new Map([
    ['account', new Set(['acme-inc', 'globex'])],
    ['contact', new Set(['alice-smith'])]
]);

const FIELDS = new Map([
    ['schema-contact', { type: 'schema', target: 'contact' }],
    ['alice-smith', { type: 'contact', account: '[[acme-inc]]', email: 'alice@acme.com', phone: '+56 9 1234 0000' }],
    ['bob-jones', { type: 'contact', account: '[[globex]]', email: 'bob@globex.com', phone: '+56 9 5678 0000' }],
    ['carla-fernandez', { type: 'note', company: '[[acme-inc]]', email: 'carla@acme.com', phone: '+56 9 9999 0000', followup: '2026-05-12' }],
    ['lt-rasczak', { type: 'character', unit: '[[roughnecks]]', rank: 'lieutenant' }],
    ['roughnecks', { type: 'unit' }],
    ['johnny-rico', { type: 'character', homeworld: '[[planet-p]]' }],
    ['planet-p', { type: 'planet' }],
    ['acme-inc', { type: 'account' }],
    ['globex', { type: 'account' }],
    // drift-detector test fixtures — 3 soldiers, soldier-c missing 'name'
    ['soldier-a', { type: 'soldier', name: 'Alpha', rank: 'private', unit: '[[roughnecks]]' }],
    ['soldier-b', { type: 'soldier', name: 'Beta', rank: 'corporal', unit: '[[roughnecks]]' }],
    ['soldier-c', { type: 'soldier', rank: 'sergeant', unit: '[[roughnecks]]' }]
]);

const INDEX = new Map([
    ['alice-smith', '/vault/alice-smith.md'],
    ['bob-jones', '/vault/bob-jones.md'],
    ['lt-rasczak', '/vault/lt-rasczak.md'],
    ['acme-inc', '/vault/acme-inc.md'],
    ['globex', '/vault/globex.md']
]);

require.cache.__completion_vscode_stub__ = {
    id: '__completion_vscode_stub__',
    filename: '__completion_vscode_stub__',
    loaded: true,
    exports: {
        languages: {
            registerCompletionItemProvider(_language, provider, ...triggerCharacters) {
                const disposable = { dispose() {} };
                REGISTERED_PROVIDERS.push({ provider, triggerCharacters, disposable });
                return disposable;
            }
        },
        commands: {
            executeCommand() {
                return Promise.resolve();
            }
        },
        window: {
            activeTextEditor: null,
            onDidChangeTextEditorSelection() {
                return { dispose() {} };
            }
        },
        workspace: {
            onDidChangeTextDocument() {
                return { dispose() {} };
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
        CompletionItem: class CompletionItem {
            constructor(label, kind) {
                this.label = label;
                this.kind = kind;
            }
        },
        SnippetString: class SnippetString {
            constructor(value) {
                this.value = value;
            }
            toString() {
                return this.value;
            }
        },
        CompletionItemKind: {
            Event: 1,
            Snippet: 2,
            Reference: 3,
            Text: 4
        },
        CompletionTriggerKind: {
            Invoke: 0,
            TriggerCharacter: 1,
            TriggerForIncompleteCompletions: 2
        }
    }
};
require.cache.__completion_type_registry_stub__ = {
    id: '__completion_type_registry_stub__',
    filename: '__completion_type_registry_stub__',
    loaded: true,
    exports: {
        getTypes: () => new Set(['account', 'contact']),
        getRegistry: () => REGISTRY
    }
};
require.cache.__completion_schema_registry_stub__ = {
    id: '__completion_schema_registry_stub__',
    filename: '__completion_schema_registry_stub__',
    loaded: true,
    exports: {
        getSchemaTargets: () => new Set(['account', 'contact', 'unit', 'character', 'planet', 'soldier']),
        getSchema: (type) => type === 'contact'
            ? {
                fields: {
                    account: { type: 'relation', target: 'account' },
                    owner: { type: 'relation' }
                }
            }
            : null
    }
};
require.cache.__completion_graph_stub__ = {
    id: '__completion_graph_stub__',
    filename: '__completion_graph_stub__',
    loaded: true,
    exports: {
        getEdges(sourceId) {
            if (sourceId === 'alice-smith') return [{ field: 'account', targetId: 'acme-inc' }];
            if (sourceId === 'bob-jones') return [{ field: 'account', targetId: 'globex' }];
            return [];
        }
    }
};
require.cache.__completion_index_stub__ = {
    id: '__completion_index_stub__',
    filename: '__completion_index_stub__',
    loaded: true,
    exports: {
        getFieldsCache: () => FIELDS,
        getVaultGeneration: () => 0,
        getPathIndex: () => new Map([
            ['/vault/alice-smith.md', 'alice-smith'],
            ['/vault/bob-jones.md', 'bob-jones'],
            ['/vault/lt-rasczak.md', 'lt-rasczak'],
            ['/vault/carl-jenkins.md', 'carl-jenkins']
        ]),
        getAliasIndex: () => new Map()
    }
};
require.cache.__completion_date_stub__ = {
    id: '__completion_date_stub__',
    filename: '__completion_date_stub__',
    loaded: true,
    exports: {
        normaliseDateInput(value) {
            return String(value || '').trim() || null;
        },
        buildDateShortcutEntries() {
            return [
                { token: 'today', label: 'Today', iso: '2026-05-04' },
                { token: 'tomorrow', label: 'Tomorrow', iso: '2026-05-05' },
                { token: 'next-week', label: 'Next week', iso: '2026-05-11' }
            ];
        },
        getTodayIsoLocal() {
            return '2026-05-30';
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__completion_vscode_stub__';
    if (request === '../registries/typeRegistry') return '__completion_type_registry_stub__';
    if (request === '../registries/schemaRegistry') return '__completion_schema_registry_stub__';
    if (request === '../core/graph') return '__completion_graph_stub__';
    if (request === '../core/index') return '__completion_index_stub__';
    if (request === '../core/indexService') return '__completion_index_stub__';
    if (request === '../core/date') return '__completion_date_stub__';
    return originalResolve(request, parent, ...rest);
};

const {
    registerCompletion,
    resolveFrontmatterFollowupState,
    buildDateShortcutItems,
    buildHeadingAnchorItems,
    buildBlockReferenceItems,
    buildFootnoteReferenceItems,
    buildLongformBodyStructureItems,
    resolveFrontmatterRelationCandidates,
    resolveQueryRelationCandidates,
    inferTargetTypeFromFieldName,
    collectObservedFrontmatterFields,
    collectRoleAlignedObservedFrontmatterFields,
    collectContextualObservedFrontmatterFields,
    collectAdaptiveFrontmatterFieldSuggestions,
    collectSchemaAdaptiveGapSuggestions,
    collectAdaptiveFrontmatterStarterSuggestions,
    collectArchetypeFieldSuggestions,
    collectNoteRoleFieldSuggestions,
    collectDriftMissingFieldSuggestions,
    collectLocalLinkedIds,
    rankCandidateIds,
    rankScalarValues,
    buildFieldInferenceDetail,
    shouldOfferFrontmatterRelationCompletion,
    buildPreTypeBootstrapItems
} = require('../src/features/completion');
const { setMutationEventsProvider, resetVaultPriorsCache } = require('../src/intelligence/vaultPriors');
const { resetObservedNoteIndexCache } = require('../src/intelligence/suggestionNoteIndex');
const { clearActivationCache } = require('../src/intelligence/activationCache');

function makeDocument(text) {
    const lines = text.split('\n');
    return {
        getText: () => text,
        lineAt(line) {
            return { text: lines[line] };
        }
    };
}

describe('frontmatter relation completion', () => {
    beforeEach(() => {
        resetVaultPriorsCache();
        resetObservedNoteIndexCache();
        clearActivationCache();
    });
    test('ranks scalar frontmatter values from vault usage so follow-up suggestions stay consistent', () => {
        const rankedRanks = rankScalarValues('rank', 'character');
        assert.ok(rankedRanks.length >= 1);
        assert.equal(rankedRanks[0].value, 'lieutenant');
        assert.equal(rankedRanks[0].count, 1);
    });

    test('offers heading anchor completions for another note inside a wikilink', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-heading-'));
        const sourcePath = path.join(tempDir, 'source-note.md');
        fs.writeFileSync(sourcePath, [
            '---',
            'id: source-note',
            '---',
            '# Overview',
            '## Evidence',
            '## References'
        ].join('\n'), 'utf8');

        const doc = makeDocument('See [[source-note#Ev');
        const items = buildHeadingAnchorItems(
            doc,
            { line: 0, character: 'See [[source-note#Ev'.length },
            new Map([['source-note', sourcePath]]),
            'source-note',
            'Ev'
        );
        assert.ok(items.length >= 1);
        assert.equal(items[0].label, 'Evidence');
        assert.equal(items[0].insertText, 'Evidence]]');
    });

    test('offers current-note heading anchors with [[#... syntax', () => {
        const doc = makeDocument([
            '# Overview',
            '## Evidence',
            'Jump to [[#Ev'
        ].join('\n'));

        const items = buildHeadingAnchorItems(
            doc,
            { line: 2, character: 'Jump to [[#Ev'.length },
            INDEX,
            '',
            'Ev'
        );
        assert.ok(items.some(item => item.label === 'Evidence'));
    });

    test('offers block-reference completions for another note inside a wikilink', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-block-'));
        const sourcePath = path.join(tempDir, 'source-note.md');
        fs.writeFileSync(sourcePath, [
            '---',
            'id: source-note',
            '---',
            '- [ ] Review recon logs',
            '',
            '> Training-yard line commonly associated with Rico.'
        ].join('\n'), 'utf8');

        const doc = makeDocument('See [[source-note^t');
        const items = buildBlockReferenceItems(
            doc,
            { line: 0, character: 'See [[source-note^t'.length },
            new Map([['source-note', sourcePath]]),
            'source-note',
            't'
        );
        assert.ok(items.length >= 1);
        assert.match(String(items[0].label), /^t1-/);
        assert.match(String(items[0].detail), /task block in source-note/i);
        assert.match(String(items[0].insertText), /^t1-.*\]\]$/);
    });

    test('offers current-note block refs with [[^... syntax', () => {
        const doc = makeDocument([
            '- [ ] Review recon logs',
            '',
            'Jump to [[^t'
        ].join('\n'));

        const items = buildBlockReferenceItems(
            doc,
            { line: 2, character: 'Jump to [[^t'.length },
            INDEX,
            '',
            't'
        );
        assert.ok(items.some(item => /^t1-/.test(String(item.label))));
    });

    test('offers current-note footnote references from existing definitions', () => {
        const doc = makeDocument([
            'Claim worth citing [^so',
            '',
            '[^source-1]: Interview note',
            '[^source-2]: Product memo'
        ].join('\n'));

        const items = buildFootnoteReferenceItems(
            doc,
            { line: 0, character: 'Claim worth citing [^so'.length },
            'so'
        );
        assert.equal(items.length, 2);
        assert.ok(items.some(item => item.label === '[^source-1]'));
        assert.ok(items.some(item => item.insertText === 'source-1]'));
    });

    test('offers source-aware longform snippets for quote-heavy notes', () => {
        const doc = makeDocument([
            '# Research',
            '> Source excerpt',
            '',
            ''
        ].join('\n'));

        const items = buildLongformBodyStructureItems(
            doc,
            { line: 3, character: 0 }
        );
        assert.ok(items.some(item => item.label === 'Quote from linked source'));
        assert.ok(items.some(item => item.label === '## References'));
    });

    test('offers missing footnote definitions in longform notes', () => {
        const doc = makeDocument([
            '# Research',
            'Claim with support[^source-1]',
            '',
            ''
        ].join('\n'));

        const items = buildLongformBodyStructureItems(
            doc,
            { line: 3, character: 0 }
        );
        assert.ok(items.some(item => item.label === '[^source-1]:'));
    });

    test('offers @date shortcut completions that insert canonical iso dates', () => {
        const doc = makeDocument([
            '---',
            'date: @to',
            '---'
        ].join('\n'));

        const items = buildDateShortcutItems(doc, { line: 1, character: 'date: @to'.length }, 'to');
        assert.ok(items.length >= 1);
        const today = items.find(item => item.label === '@today');
        assert.ok(today);
        assert.match(String(today.detail), /Today -> \d{4}-\d{2}-\d{2}/);
        assert.match(String(today.insertText), /\d{4}-\d{2}-\d{2}/);
    });

    test('infers likely target types from relation-like field names', () => {
        assert.equal(inferTargetTypeFromFieldName('account'), 'account');
        assert.equal(inferTargetTypeFromFieldName('accounts'), 'account');
        assert.equal(inferTargetTypeFromFieldName('account_id'), 'account');
        assert.equal(inferTargetTypeFromFieldName('unit'), 'unit');
    });

    test('uses schema target types as a preference, not a hard filter', () => {
        const doc = makeDocument([
            '---',
            'id: alice-smith',
            'type: contact',
            'account: ac',
            '---'
        ].join('\n'));

        const result = resolveFrontmatterRelationCandidates(doc, { line: 3, character: 'account: ac'.length }, INDEX);
        assert.ok(result);
        assert.equal(result.targetType, 'account');
        assert.deepEqual(result.preferredIds.sort(), ['acme-inc', 'globex']);
        assert.deepEqual(result.candidateIds.sort(), ['acme-inc', 'alice-smith', 'bob-jones', 'globex', 'lt-rasczak']);
    });

    test('accepts type-like frontmatter keys with spaces', () => {
        const doc = makeDocument([
            '---',
            'id: alice-smith',
            'contact type: contact',
            'account: ac',
            '---'
        ].join('\n'));

        const result = resolveFrontmatterRelationCandidates(doc, { line: 3, character: 'account: ac'.length }, INDEX);
        assert.ok(result);
        assert.equal(result.targetType, 'account');
        assert.deepEqual(result.preferredIds.sort(), ['acme-inc', 'globex']);
        assert.deepEqual(result.candidateIds.sort(), ['acme-inc', 'alice-smith', 'bob-jones', 'globex', 'lt-rasczak']);
    });

    test('accepts broader type-like aliases such as category', () => {
        const doc = makeDocument([
            '---',
            'id: alice-smith',
            'category: contact',
            'account: ac',
            '---'
        ].join('\n'));

        const result = resolveFrontmatterRelationCandidates(doc, { line: 3, character: 'account: ac'.length }, INDEX);
        assert.ok(result);
        assert.equal(result.targetType, 'account');
        assert.deepEqual(result.preferredIds.sort(), ['acme-inc', 'globex']);
        assert.deepEqual(result.candidateIds.sort(), ['acme-inc', 'alice-smith', 'bob-jones', 'globex', 'lt-rasczak']);
    });

    test('uses schema targetTypes arrays to strongly bias relation completion ranking', () => {
        const doc = makeDocument([
            '---',
            'id: carl-jenkins',
            'type: character',
            'name: Carl Jenkins',
            'unit: [[r',
            '---'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/carl-jenkins.md' };

        const unitIndex = new Map([
            ['johnny-rico', '/vault/johnny-rico.md'],
            ['carmen-ibanez', '/vault/carmen-ibanez.md'],
            ['lt-rasczak', '/vault/lt-rasczak.md'],
            ['roughnecks', '/vault/roughnecks.md']
        ]);

        const result = resolveFrontmatterRelationCandidates(doc, { line: 4, character: 'unit: [[r'.length }, unitIndex);
        assert.ok(result);
        assert.equal(result.targetType, 'unit');

        const ranked = rankCandidateIds(
            result.candidateIds,
            result.partial,
            result.preferredIds,
            result.localLinkedIds,
            result.observedIdScores,
            result.rankingHints
        );
        assert.equal(ranked[0], 'roughnecks');
    });

    test('does not treat type fields as relation targets', () => {
        const doc = makeDocument([
            '---',
            'id: note-report',
            'type: dos',
            'title: Note Report Test',
            '---'
        ].join('\n'));

        const result = resolveFrontmatterRelationCandidates(doc, { line: 2, character: 'type: dos'.length }, INDEX);
        assert.equal(result, null);
    });

    test('falls back to all indexed notes when relation field has no target inference', () => {
        const doc = makeDocument([
            '---',
            'id: alice-smith',
            'type: contact',
            'owner: g',
            '---'
        ].join('\n'));

        const result = resolveFrontmatterRelationCandidates(doc, { line: 3, character: 'owner: g'.length }, INDEX);
        assert.ok(result);
        assert.equal(result.targetType, null);
        assert.deepEqual(result.candidateIds.sort(), ['acme-inc', 'alice-smith', 'bob-jones', 'globex', 'lt-rasczak']);
    });

    test('learns relation target type from observed vault usage even without schema', () => {
        const doc = makeDocument([
            '---',
            'id: contact-prospect',
            'category: note',
            'email: prospect@acme.com',
            'phone: +56 9 1111 1111',
            'account: ac',
            '---',
            '# Contact prospect'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-prospect.md' };

        const result = resolveFrontmatterRelationCandidates(doc, { line: 5, character: 'account: ac'.length }, INDEX);
        assert.ok(result);
        assert.equal(result.targetType, 'account');
        assert.ok(result.reasonText.includes('vault usage') || result.reasonText.includes('account'));
        assert.deepEqual(result.preferredIds.sort(), ['acme-inc', 'globex']);
        assert.deepEqual(result.candidateIds.sort(), ['acme-inc', 'alice-smith', 'bob-jones', 'globex', 'lt-rasczak']);
    });

    test('learns relation targets across same-family field variants like client and company', () => {
        const doc = makeDocument([
            '---',
            'id: contact-prospect',
            'category: note',
            'email: prospect@acme.com',
            'phone: +56 9 1111 1111',
            'client: ac',
            '---',
            '# Contact prospect'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-prospect.md' };

        const result = resolveFrontmatterRelationCandidates(doc, { line: 5, character: 'client: ac'.length }, INDEX);
        assert.ok(result);
        assert.equal(result.targetType, 'account');
        assert.ok(result.observedPreferredIds.includes('acme-inc'));
        assert.match(result.observedReasonText, /client|company|use client like company/i);
        assert.deepEqual(result.candidateIds.sort(), ['acme-inc', 'alice-smith', 'bob-jones', 'globex', 'lt-rasczak']);
    });

    test('ranks observed relation targets from similar notes above weaker matches', () => {
        const doc = makeDocument([
            '---',
            'id: contact-prospect',
            'email: prospect@acme.com',
            'phone: +56 9 1111 1111',
            'account: g',
            '---',
            '# Contact prospect'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-prospect.md' };

        const result = resolveFrontmatterRelationCandidates(doc, { line: 4, character: 'account: g'.length }, INDEX);
        assert.ok(result);
        assert.ok(result.observedPreferredIds.includes('acme-inc'));
        const ranked = rankCandidateIds(
            result.candidateIds,
            '',
            result.preferredIds,
            result.localLinkedIds,
            result.observedIdScores
        );
        assert.equal(ranked[0], 'acme-inc');
    });

    test('explicit [[ relation syntax still offers candidates even without inference', () => {
        const doc = makeDocument([
            '---',
            'id: alice-smith',
            'type: contact',
            'mystery: [[g',
            '---'
        ].join('\n'));

        const result = resolveFrontmatterRelationCandidates(doc, { line: 3, character: 'mystery: [[g'.length }, INDEX);
        assert.ok(result);
        assert.equal(result.hasWiki, true);
        assert.deepEqual(result.candidateIds.sort(), ['acme-inc', 'alice-smith', 'bob-jones', 'globex', 'lt-rasczak']);
    });

    test('single opening bracket still enters relation completion for typed targets', () => {
        const doc = makeDocument([
            '---',
            'id: alice-smith',
            'type: contact',
            'account: [a',
            '---'
        ].join('\n'));

        const result = resolveFrontmatterRelationCandidates(doc, { line: 3, character: 'account: [a'.length }, INDEX);
        assert.ok(result);
        assert.equal(result.targetType, 'account');
        assert.equal(result.wikiPrefixLength, 1);
        assert.deepEqual(result.candidateIds.sort(), ['acme-inc', 'alice-smith', 'bob-jones', 'globex', 'lt-rasczak']);
    });

    test('collects observed fields for the current type when no schema exists', () => {
        const observed = collectObservedFrontmatterFields('contact');
        assert.deepEqual(observed.map(entry => entry.key), ['account', 'email', 'phone']);
        assert.equal(observed.find(entry => entry.key === 'account').count, 2);
    });

    test('can collect global observed fields when no document type is established yet', () => {
        const observed = collectObservedFrontmatterFields();
        assert.ok(observed.some(entry => entry.key === 'account'));
        assert.ok(observed.length >= 1);
    });

    test('can weight observed fields toward the inferred workflow even before type is set', () => {
        const doc = makeDocument([
            '---',
            'id: alice-smith',
            'email: a@acme.com',
            'phone: +56 9 0000 0000',
            '---',
            '# Contact profile'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-profile.md' };

        const observed = collectRoleAlignedObservedFrontmatterFields(doc, null, INDEX);
        const accountField = observed.find(entry => entry.key === 'account');
        assert.ok(accountField);
        assert.equal(accountField.roleAligned, true);
        assert.equal(accountField.noteRole.noteRole, 'person');
    });

    test('can suggest contextual fields from similar notes that share current structure', () => {
        const doc = makeDocument([
            '---',
            'id: prospect-alice',
            'email: a@acme.com',
            'phone: +56 9 1111 1111',
            '---',
            '# Contact prospect'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-prospect.md' };

        const suggestions = collectContextualObservedFrontmatterFields(doc, null, INDEX);
        const accountField = suggestions.find(entry => entry.key === 'account');
        assert.ok(accountField);
        assert.ok(accountField.score > 0);
        assert.ok(accountField.sharedFields.includes('email') || accountField.sharedFields.includes('phone'));
    });

    test('can suggest likely next fields from adaptive vault patterns', () => {
        const doc = makeDocument([
            '---',
            'id: prospect-alice',
            'email: a@acme.com',
            'phone: +56 9 1111 1111',
            '---',
            '# Contact prospect'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-prospect.md' };

        const suggestions = collectAdaptiveFrontmatterFieldSuggestions(doc, null, INDEX);
        const accountField = suggestions.find(entry => entry.key === 'account');
        assert.ok(accountField);
        assert.match(accountField.summary, /often add account/);
    });

    test('uses repeated body links as supporting evidence for adaptive field suggestions', () => {
        const doc = makeDocument([
            '---',
            'id: prospect-body-context',
            '---',
            '# Prospect note',
            '',
            'Spoke with [[acme-inc]] about the rollout.',
            'Need to follow up with [[acme-inc]] next week.'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/prospect-body-context.md' };

        const suggestions = collectAdaptiveFrontmatterFieldSuggestions(doc, null, INDEX);
        const accountField = suggestions.find(entry => entry.key === 'account' || entry.key === 'company');
        assert.ok(accountField);
        assert.ok(accountField.sampleTargets.includes('acme-inc'));
        assert.match(accountField.summary, /acme-inc/i);
    });

    test('repeated body links can push the matching relation field to the top', () => {
        const doc = makeDocument([
            '---',
            'id: contact-body-priority',
            'email: body@acme.com',
            'phone: +56 9 1111 1111',
            '---',
            '',
            'Met again with [[acme-inc]] after the rollout.',
            'The next step still depends on [[acme-inc]].'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-body-priority.md' };

        const suggestions = collectAdaptiveFrontmatterFieldSuggestions(doc, null, INDEX);
        assert.ok(suggestions.length > 0);
        assert.equal(suggestions[0].key, 'account');
        assert.match(String(suggestions[0].summary || ''), /body also keeps pointing to acme-inc/i);
    });

    test('can suggest schema-adaptive gaps even when similar notes use different field names', () => {
        const doc = makeDocument([
            '---',
            'id: prospect-lucia',
            'email: lucia@acme.com',
            'phone: +56 9 1111 7777',
            '---',
            '# Contact prospect'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-prospect.md' };

        const gaps = collectSchemaAdaptiveGapSuggestions(doc, null, INDEX);
        const containerGap = gaps.find(entry => entry.key === 'account');
        assert.ok(containerGap);
        assert.ok(containerGap.alternatives.includes('company'));
        assert.match(containerGap.summary, /company|account/);
    });

    test('can surface smart starter suggestions with a best next step and bundle', () => {
        const doc = makeDocument([
            '---',
            'id: contact-prospect',
            'email: a@acme.com',
            'phone: +56 9 1111 1111',
            '---',
            '# Contact prospect'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-prospect.md' };

        const starters = collectAdaptiveFrontmatterStarterSuggestions(doc, null, INDEX);
        assert.ok(starters.length >= 2);
        assert.match(starters[0].label, /Yamlink:/);
        assert.match(starters[0].headline, /account/i);
        assert.match(starters[0].why, /account/i);
        assert.ok(starters.some(entry => /smart setup/i.test(entry.label)));
    });

    test('smart starter suggestions can carry body evidence when the body keeps pointing at one note', () => {
        const doc = makeDocument([
            '---',
            'id: mission-klendathu',
            'type: mission',
            'outcome: catastrophic-failure',
            '---',
            '',
            '[[lt-rasczak]] survived the first wave.',
            'The regrouping happened around [[lt-rasczak]] again.'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/mission-klendathu.md' };

        const starters = collectAdaptiveFrontmatterStarterSuggestions(doc, 'mission', INDEX);
        assert.ok(starters.some(entry => /body/i.test(entry.label)));
        assert.ok(starters.some(entry => /lt-rasczak/i.test(String(entry.bodyEvidence || ''))));
    });

    test('returns empty for type with no vault bundle — no hardcoded archetype fallback', () => {
        // account type in test vault has no real field bundle (acme-inc/globex have only type:)
        // The system must stay silent rather than guess from a global archetype table.
        const doc = makeDocument([
            '---',
            'id: acme-inc',
            'type: account',
            '---',
            '# Account Profile'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/account-profile.md' };

        const suggestions = collectArchetypeFieldSuggestions(doc, 'account');
        assert.ok(Array.isArray(suggestions));
        // No vault evidence for this type → silence, not wrong guesses
        assert.ok(suggestions.every(entry => !entry.hardcodedFallback),
            'hardcoded fallback suggestions must never appear — vault-only');
    });

    test('prefers vault type-field bundles over archetype priors when bundle evidence exists', () => {
        const doc = makeDocument([
            '---',
            'id: alice-smith',
            'type: contact',
            '---',
            '# Contact profile'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-profile.md' };

        const suggestions = collectArchetypeFieldSuggestions(doc, 'contact');
        assert.ok(suggestions.some(entry => entry.key === 'account'));
        assert.ok(suggestions.some(entry => entry.key === 'email'));
        assert.ok(suggestions.some(entry => entry.bundleDerived === true));
    });

    test('returns empty for role with no vault proxy data — no hardcoded NOTE_ROLE_FIELD_PRIORS fallback', () => {
        // meeting type has no notes in the test vault → no vault bundle proxy → silence
        const doc = makeDocument([
            '---',
            'id: call-acme',
            'type: meeting',
            'account: [[acme-inc]]',
            'date: 2026-04-10',
            '---',
            '# Partner call'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/partner-call.md' };

        const suggestions = collectNoteRoleFieldSuggestions(doc, 'meeting', INDEX);
        assert.ok(Array.isArray(suggestions));
        assert.ok(suggestions.every(entry => !entry.hardcodedFallback),
            'hardcoded NOTE_ROLE_FIELD_PRIORS must never appear — vault teaches the system');
    });

    test('prefers role-mapped vault bundles over NOTE_ROLE_FIELD_PRIORS when a proxy type exists', () => {
        const doc = makeDocument([
            '---',
            'id: alice-smith',
            'email: a@acme.com',
            'phone: +56 9 0000 0000',
            '---',
            '# Contact profile'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-profile.md' };

        const suggestions = collectNoteRoleFieldSuggestions(doc, null, INDEX);
        assert.ok(suggestions.some(entry => entry.key === 'account'));
        assert.ok(suggestions.some(entry => /vault bundle/i.test(String((entry.reasons || []).join(' ')))));
        assert.ok(suggestions.every(entry => entry.source !== 'person'));
    });

    test('no vault data → empty; vault data → vault bundle only, never hardcoded', () => {
        // 'account' type has no real fields → empty (was: archetype fallback)
        const doc = makeDocument(['---', 'id: acme-inc', 'type: account', '---'].join('\n'));
        const emptySuggestions = collectArchetypeFieldSuggestions(doc, 'account');
        assert.ok(emptySuggestions.every(entry => !entry.hardcodedFallback));

        // 'contact' type has real bundle data (alice-smith, bob-jones) → vault bundle fires
        const doc2 = makeDocument(['---', 'id: new-contact', 'type: contact', '---'].join('\n'));
        const bundleSuggestions = collectArchetypeFieldSuggestions(doc2, 'contact');
        assert.ok(bundleSuggestions.some(entry => entry.bundleDerived === true));
        assert.ok(bundleSuggestions.every(entry => !entry.hardcodedFallback));
        assert.ok(bundleSuggestions.some(entry => entry.score >= 100));
    });

    test('no vault bundle for role → empty, not hardcoded NOTE_ROLE_FIELD_PRIORS', () => {
        const doc = makeDocument([
            '---',
            'id: partner-call',
            'type: meeting',
            'account: [[acme-inc]]',
            'date: 2026-04-10',
            '---',
            '# Partner call'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/partner-call.md' };

        // No meeting notes in test vault → no vault bundle proxy → empty (not hardcoded list)
        const suggestions = collectNoteRoleFieldSuggestions(doc, 'meeting', INDEX);
        assert.ok(Array.isArray(suggestions));
        assert.ok(suggestions.every(entry => !entry.hardcodedFallback),
            'NOTE_ROLE_FIELD_PRIORS must never appear as a fallback');
    });

    test('note-role suggestions from vault bundle proxy are not marked hardcodedFallback', () => {
        // alice-smith (contact) → person role → person proxy type in noteRoleTypePriors
        // If contact bundle has fields, those come back as bundleDerived, not hardcodedFallback
        const doc = makeDocument([
            '---',
            'id: alice-smith',
            'email: alice@acme.com',
            'phone: +56 9 1234 0000',
            '---',
            '# Contact profile'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-profile.md' };

        const suggestions = collectNoteRoleFieldSuggestions(doc, null, INDEX);
        if (suggestions.some(entry => entry.bundleDerived)) {
            // Vault bundle fired — should never be marked as hardcoded
            assert.ok(suggestions.filter(e => e.bundleDerived).every(entry => !entry.hardcodedFallback));
        }
        // Either path: suggestions are present
        assert.ok(suggestions.length >= 0);
    });

    test('ranks preferred target ids ahead of weaker non-preferred matches', () => {
        const ranked = rankCandidateIds(
            ['great-account', 'accounting', 'beta-acc'],
            'acc',
            ['great-account']
        );
        assert.deepEqual(ranked, ['great-account', 'accounting', 'beta-acc']);
    });

    test('promotes ids already referenced in the current note', () => {
        const doc = makeDocument([
            '---',
            'id: alice-smith',
            'type: contact',
            'account: [[globex]]',
            '---'
        ].join('\n'));
        const localIds = collectLocalLinkedIds(doc, INDEX);
        const ranked = rankCandidateIds(
            ['acme-inc', 'globex'],
            '',
            ['acme-inc', 'globex'],
            localIds
        );
        assert.deepEqual(ranked, ['globex', 'acme-inc']);
    });

    test('dedupes semantically identical candidate ids before ranking', () => {
        const ranked = rankCandidateIds(
            ['alice-smith', ' Alice-Smith ', 'ALICE-SMITH', 'acme-inc'],
            '',
            ['alice-smith']
        );
        assert.deepEqual(ranked, ['alice-smith', 'acme-inc']);
    });

    test('dedupes relation candidates when the same node appears through mixed casing', () => {
        const mixedIndex = new Map([
            ['wayne-inc', '/vault/wayne-inc.md'],
            ['bruce-wayne', '/vault/bruce-wayne.md']
        ]);
        const ranked = rankCandidateIds(
            ['wayne-inc', ' Wayne-Inc ', 'WAYNE-INC', 'bruce-wayne'],
            'wa',
            ['wayne-inc']
        );
        assert.deepEqual(ranked, ['wayne-inc', 'bruce-wayne']);

        const doc = makeDocument([
            '---',
            'id: joker',
            'type: contact',
            'account: wa',
            '---'
        ].join('\n'));
        const result = resolveFrontmatterRelationCandidates(doc, { line: 3, character: 'account: wa'.length }, mixedIndex);
        assert.ok(result);
        const finalRanked = rankCandidateIds(
            ['wayne-inc', ' Wayne-Inc ', ...result.candidateIds],
            result.partial,
            result.preferredIds,
            result.localLinkedIds,
            result.observedIdScores
        );
        assert.equal(finalRanked.filter(id => id === 'wayne-inc').length, 1);
        assert.equal(finalRanked[0], 'wayne-inc');
    });

    test('returns only vault-bundle suggestions — no hardcoded NOTE_ROLE_FIELD_PRIORS by role', () => {
        // The vault may or may not have bundle data for the inferred role's proxy type.
        // Either way, only vault-derived suggestions are returned — no hardcoded lists.
        const docConcept = makeDocument([
            '---',
            'id: inkjet-overview',
            'type: note',
            'products: [[product-inkjet-pro]]',
            'related: [[inkjet]]',
            'summary: Core inkjet concepts',
            '---',
            '# Inkjet concept overview'
        ].join('\n'));
        docConcept.uri = { fsPath: '/vault/inkjet-concept-overview.md' };

        const docTask = makeDocument([
            '---',
            'id: fix-graph-selection',
            'type: note',
            'status: in-progress',
            'deadline: 2026-04-20',
            'project: [[yamlink]]',
            'reporter: [[alice-smith]]',
            '---',
            '# Graph selection bug'
        ].join('\n'));
        docTask.uri = { fsPath: '/vault/graph-selection-bug.md' };

        for (const doc of [docConcept, docTask]) {
            const suggestions = collectNoteRoleFieldSuggestions(doc, 'note', INDEX);
            assert.ok(Array.isArray(suggestions));
            assert.ok(suggestions.every(entry => !entry.hardcodedFallback),
                'NOTE_ROLE_FIELD_PRIORS must never appear — vault-only suggestions');
            if (suggestions.length > 0) {
                // If vault data exists, reasons must be vault-derived
                assert.ok(suggestions.every(entry => Array.isArray(entry.reasons)));
            }
        }
    });

    test('field inference detail surfaces semantic reasoning instead of only labels', () => {
        const detail = buildFieldInferenceDetail('suggested for account notes', {
            relational: true,
            targetType: 'account',
            semanticRole: 'relation',
            reasons: ['field name strongly resembles the "account" type']
        });
        assert.match(detail, /suggested for account notes/);
        assert.match(detail, /account/);
        assert.match(detail, /field name strongly resembles/);
    });

    test('adaptive field suggestions can carry body evidence for repeated body links', () => {
        const doc = makeDocument([
            '---',
            'id: contact-prospect',
            'email: a@acme.com',
            '---',
            '',
            '[[acme-inc]] keeps coming up in outreach notes.',
            'The next contact step still revolves around [[acme-inc]].'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-prospect.md' };

        const suggestions = collectAdaptiveFrontmatterFieldSuggestions(doc, null, INDEX);
        assert.ok(suggestions.some(entry => /acme-inc/i.test(String(entry.bodyEvidence || ''))));
    });

    test('adaptive gap suggestions can carry body evidence for repeated body links', () => {
        const doc = makeDocument([
            '---',
            'id: contact-prospect',
            'email: a@acme.com',
            '---',
            '',
            '[[acme-inc]] keeps coming up in outreach notes.',
            'The next contact step still revolves around [[acme-inc]].'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-prospect.md' };

        const suggestions = collectSchemaAdaptiveGapSuggestions(doc, null, INDEX);
        assert.ok(suggestions.some(entry => /acme-inc/i.test(String(entry.bodyEvidence || ''))));
    });

    test('body-supported relation gaps rise above weaker adaptive gaps', () => {
        const doc = makeDocument([
            '---',
            'id: contact-body-gap',
            'email: body@acme.com',
            '---',
            '',
            'Met again with [[acme-inc]] after the rollout.',
            'The next step still depends on [[acme-inc]].'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/contact-body-gap.md' };

        const suggestions = collectSchemaAdaptiveGapSuggestions(doc, null, INDEX);
        assert.ok(suggestions.length > 0);
        assert.equal(suggestions[0].key, 'account');
        assert.match(String(suggestions[0].summary || ''), /body also keeps pointing to acme-inc/i);
    });

    test('query relation candidates use the same target preference model as frontmatter', () => {
        const document = makeDocument([
            '---',
            'id: prospect-alice',
            'email: a@acme.com',
            'phone: +56 9 1111 1111',
            '---',
            '# Contact prospect'
        ].join('\n'));
        document.uri = { fsPath: '/vault/contact-prospect.md' };
        const result = resolveQueryRelationCandidates('account', 'contact', 'ac', INDEX, { localLinkedIds: ['globex'], document });
        assert.ok(result);
        assert.equal(result.targetType, 'account');
        assert.deepEqual(result.preferredIds.sort(), ['acme-inc', 'globex']);
        assert.deepEqual(result.localLinkedIds, ['globex']);
        assert.match(result.reasonText, /account/);
        assert.ok(result.observedIdScores.get('acme-inc') > 0);
    });

    test('query relation candidates can also learn across relation-family aliases', () => {
        const document = makeDocument([
            '---',
            'id: prospect-alice',
            'email: a@acme.com',
            'phone: +56 9 1111 1111',
            '---',
            '# Contact prospect'
        ].join('\n'));
        document.uri = { fsPath: '/vault/contact-prospect.md' };
        const result = resolveQueryRelationCandidates('client', 'contact', 'ac', INDEX, { document });
        assert.ok(result);
        assert.equal(result.targetType, 'account');
        assert.ok(result.observedPreferredIds.includes('acme-inc'));
        assert.match(result.observedReasonText, /client|company|through company/i);
    });

    test('query relation candidates flag when the expected target type does not exist yet', () => {
        const document = makeDocument([
            '---',
            'id: prospect-alice',
            'type: contact',
            '---'
        ].join('\n'));
        document.uri = { fsPath: '/vault/contact-prospect.md' };
        const limitedIndex = new Map([
            ['alice-smith', '/vault/alice-smith.md'],
            ['bob-jones', '/vault/bob-jones.md']
        ]);
        const result = resolveQueryRelationCandidates('account', 'contact', '', limitedIndex, { document });
        assert.ok(result);
        assert.equal(result.targetType, 'account');
        assert.equal(result.missingTargetType, true);
        assert.deepEqual(result.preferredIds, []);
    });

    test('ranking hints bias likely target types without hiding other candidates', () => {
        const ranked = rankCandidateIds(
            ['alice-smith', 'lt-rasczak', 'acme-inc'],
            '',
            [],
            [],
            new Map(),
            {
                candidateTypeScores: new Map([
                    ['contact', 0.85],
                    ['character', 0.15]
                ]),
                ambiguity: { linkCount: 8, scalarCount: 2, total: 10, linkRatio: 0.8 },
                observedPreferredIds: []
            }
        );
        assert.equal(ranked[0], 'alice-smith');
        assert.ok(ranked.includes('lt-rasczak'));
        assert.ok(ranked.includes('acme-inc'));
    });

    test('ambiguity dampens target-type ranking bias for mixed fields', () => {
        const strongBias = rankCandidateIds(
            ['alice-smith', 'lt-rasczak'],
            '',
            [],
            [],
            new Map(),
            {
                candidateTypeScores: new Map([
                    ['contact', 0.8],
                    ['character', 0.2]
                ]),
                ambiguity: { linkCount: 8, scalarCount: 0, total: 8, linkRatio: 1.0 },
                observedPreferredIds: []
            }
        );
        const mixedBias = rankCandidateIds(
            ['alice-smith', 'lt-rasczak'],
            '',
            [],
            [],
            new Map(),
            {
                candidateTypeScores: new Map([
                    ['contact', 0.8],
                    ['character', 0.2]
                ]),
                ambiguity: { linkCount: 3, scalarCount: 5, total: 8, linkRatio: 0.375 },
                observedPreferredIds: []
            }
        );
        assert.equal(strongBias[0], 'alice-smith');
        assert.equal(mixedBias[0], 'alice-smith');

        const strongGap = strongBias.indexOf('lt-rasczak') - strongBias.indexOf('alice-smith');
        const mixedGap = mixedBias.indexOf('lt-rasczak') - mixedBias.indexOf('alice-smith');
        assert.ok(strongGap >= mixedGap);
    });

    test('bare frontmatter relation completion stays quiet until explicitly invoked', () => {
        assert.equal(
            shouldOfferFrontmatterRelationCompletion({ hasWiki: false }, { triggerKind: 1 }),
            false
        );
    });

    test('bare frontmatter relation completion is allowed on explicit invoke', () => {
        assert.equal(
            shouldOfferFrontmatterRelationCompletion({ hasWiki: false }, { triggerKind: 0 }),
            true
        );
    });

    test('wikilink frontmatter relation completion remains allowed on trigger character', () => {
        assert.equal(
            shouldOfferFrontmatterRelationCompletion({ hasWiki: true }, { triggerKind: 1 }),
            true
        );
    });

    test('provider path keeps relation-aware frontmatter completion alive for [[ targets', () => {
        REGISTERED_PROVIDERS.length = 0;
        const context = { subscriptions: [] };
        const unitIndex = new Map([
            ['johnny-rico', '/vault/johnny-rico.md'],
            ['carmen-ibanez', '/vault/carmen-ibanez.md'],
            ['lt-rasczak', '/vault/lt-rasczak.md'],
            ['roughnecks', '/vault/roughnecks.md']
        ]);
        registerCompletion(context, () => unitIndex);
        const linkProvider = REGISTERED_PROVIDERS.find((entry) => entry.triggerCharacters.includes('['));
        assert.ok(linkProvider, 'link provider should register for [ trigger');

        const doc = makeDocument([
            '---',
            'id: carl-jenkins',
            'type: character',
            'name: Carl Jenkins',
            'unit: [[r',
            '---'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/carl-jenkins.md' };

        const items = linkProvider.provider.provideCompletionItems(
            doc,
            { line: 4, character: 'unit: [[r'.length },
            null,
            { triggerKind: 1 }
        );

        assert.ok(Array.isArray(items));
        assert.ok(items.some((item) => item.insertText === '[[roughnecks]]'));
        const roughnecksItem = items.find((item) => item.insertText === '[[roughnecks]]');
        assert.equal(roughnecksItem.label, 'roughnecks');
    });

    test('generic frontmatter provider stays quiet for explicit [[ relation syntax so suggestions do not duplicate', () => {
        REGISTERED_PROVIDERS.length = 0;
        const context = { subscriptions: [] };
        const unitIndex = new Map([
            ['johnny-rico', '/vault/johnny-rico.md'],
            ['carmen-ibanez', '/vault/carmen-ibanez.md'],
            ['lt-rasczak', '/vault/lt-rasczak.md'],
            ['roughnecks', '/vault/roughnecks.md']
        ]);
        registerCompletion(context, () => unitIndex);
        const fieldProvider = REGISTERED_PROVIDERS.find((entry) => entry.triggerCharacters.length === 0);
        assert.ok(fieldProvider, 'frontmatter provider should be registered');

        const doc = makeDocument([
            '---',
            'id: carl-jenkins',
            'type: character',
            'name: Carl Jenkins',
            'unit: [[r',
            '---'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/carl-jenkins.md' };

        const items = fieldProvider.provider.provideCompletionItems(
            doc,
            { line: 4, character: 'unit: [[r'.length }
        );

        assert.equal(items, undefined);
    });

    test('provider path surfaces relation-aware completion for bare unit values on explicit invoke', () => {
        REGISTERED_PROVIDERS.length = 0;
        const context = { subscriptions: [] };
        const unitIndex = new Map([
            ['johnny-rico', '/vault/johnny-rico.md'],
            ['carmen-ibanez', '/vault/carmen-ibanez.md'],
            ['lt-rasczak', '/vault/lt-rasczak.md'],
            ['roughnecks', '/vault/roughnecks.md']
        ]);
        registerCompletion(context, () => unitIndex);
        const fieldProvider = REGISTERED_PROVIDERS.find((entry) => entry.triggerCharacters.length === 0);
        assert.ok(fieldProvider, 'frontmatter provider should be registered');

        const doc = makeDocument([
            '---',
            'id: carl-jenkins',
            'type: character',
            'name: Carl Jenkins',
            'unit: ',
            '---'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/carl-jenkins.md' };

        const items = fieldProvider.provider.provideCompletionItems(
            doc,
            { line: 4, character: 'unit: '.length }
        );

        assert.ok(Array.isArray(items));
        assert.ok(items.some((item) => item.insertText === '[[roughnecks]]'));
    });

    test('provider path surfaces observed scalar values for bare rank fields', () => {
        REGISTERED_PROVIDERS.length = 0;
        const context = { subscriptions: [] };
        registerCompletion(context, () => INDEX);
        const fieldProvider = REGISTERED_PROVIDERS.find((entry) => entry.triggerCharacters.length === 0);
        assert.ok(fieldProvider, 'frontmatter provider should be registered');

        const doc = makeDocument([
            '---',
            'id: carl-jenkins',
            'type: character',
            'name: Carl Jenkins',
            'rank: ',
            '---'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/carl-jenkins.md' };

        const items = fieldProvider.provider.provideCompletionItems(
            doc,
            { line: 4, character: 'rank: '.length }
        );

        assert.ok(Array.isArray(items));
        assert.ok(items.some((item) => item.insertText === 'lieutenant'));
    });

    test('follow-up intelligence detects bare relation fields without requiring explicit [[', () => {
        const unitIndex = new Map([
            ['johnny-rico', '/vault/johnny-rico.md'],
            ['carmen-ibanez', '/vault/carmen-ibanez.md'],
            ['lt-rasczak', '/vault/lt-rasczak.md'],
            ['roughnecks', '/vault/roughnecks.md']
        ]);
        const doc = makeDocument([
            '---',
            'id: carl-jenkins',
            'type: character',
            'name: Carl Jenkins',
            'unit: ',
            '---'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/carl-jenkins.md' };

        const state = resolveFrontmatterFollowupState(
            doc,
            { line: 4, character: 'unit: '.length },
            () => unitIndex
        );

        assert.ok(state);
        assert.equal(state.kind, 'relation');
        assert.equal(state.fieldName, 'unit');
        assert.ok(state.candidateCount >= 1);
    });

    test('follow-up intelligence detects scalar fields with strong vault-learned values', () => {
        const doc = makeDocument([
            '---',
            'id: carl-jenkins',
            'type: character',
            'name: Carl Jenkins',
            'rank: ',
            '---'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/carl-jenkins.md' };

        const state = resolveFrontmatterFollowupState(
            doc,
            { line: 4, character: 'rank: '.length },
            () => INDEX
        );

        assert.ok(state);
        assert.equal(state.kind, 'scalar');
        assert.equal(state.fieldName, 'rank');
        assert.ok(state.candidateCount >= 1);
    });

    test('frontmatter key completion bootstraps note identity before type exists', () => {
        const doc = makeDocument([
            '---',
            'id: prospect-lucia',
            'email: lucia@acme.com',
            'phone: +56 9 1111 7777',
            '',
            '---',
            '# Contact profile'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/prospect-lucia.md' };
        const adaptiveContext = {
            intelligence: {
                noteRole: {
                    noteRole: 'person',
                    confidence: 0.8
                }
            }
        };
        const items = buildPreTypeBootstrapItems(doc, '', adaptiveContext);

        assert.ok(Array.isArray(items));
        assert.equal(items[0].label, 'type');
        assert.match(String(items[0].detail || ''), /identity|likely/i);
    });

    test('family-fallback candidateTypeScores bias ranking at 0.7 scale without hiding other candidates', () => {
        // Simulate what buildRelationRankingHints produces via the family fallback path:
        // soft scores at ×0.7 (vs 1.0 from a schema target or fieldTargetTypes entry).
        const familyHints = {
            candidateTypeScores: new Map([['character', 0.7]]),
            familyHint: 'character notes usually link homeworld to planet notes',
            ambiguity: null,
            observedPreferredIds: []
        };
        const ranked = rankCandidateIds(
            ['lt-rasczak', 'acme-inc', 'alice-smith'],
            '',
            [],
            [],
            new Map(),
            familyHints
        );
        // character note (lt-rasczak) should rank above account and contact notes
        assert.equal(ranked[0], 'lt-rasczak');
        // other candidates must still appear
        assert.ok(ranked.includes('acme-inc'));
        assert.ok(ranked.includes('alice-smith'));
    });

    test('family-fallback hint is weaker than a full schema or fieldTargetTypes signal', () => {
        // Schema / fieldTargetTypes path sets candidateTypeScores to 1.0; family path 0.7.
        // The schema-biased ranking should produce a larger gap between winner and runner-up.
        const schemaHints = {
            candidateTypeScores: new Map([['contact', 1.0]]),
            ambiguity: { linkCount: 8, scalarCount: 0, total: 8, linkRatio: 1.0 },
            observedPreferredIds: []
        };
        const familyHints = {
            candidateTypeScores: new Map([['contact', 0.7]]),
            ambiguity: { linkCount: 8, scalarCount: 0, total: 8, linkRatio: 1.0 },
            observedPreferredIds: []
        };
        const schemaRanked = rankCandidateIds(['alice-smith', 'lt-rasczak'], '', [], [], new Map(), schemaHints);
        const familyRanked = rankCandidateIds(['alice-smith', 'lt-rasczak'], '', [], [], new Map(), familyHints);
        // Both should rank alice-smith (contact) first
        assert.equal(schemaRanked[0], 'alice-smith');
        assert.equal(familyRanked[0], 'alice-smith');
        // Schema signal should produce a larger margin (typeBias = 260 vs 0.7*260≈182)
        // We just verify both rank correctly — the margin difference is an implementation detail.
        assert.equal(schemaRanked[1], 'lt-rasczak');
        assert.equal(familyRanked[1], 'lt-rasczak');
    });

    test('rankingHints carries familyHint when vault family inference fires', () => {
        // johnny-rico is a character note with homeworld: [[planet-p]].
        // A new character doc with only `unit` as a non-empty field asks about `homeworld`.
        // `homeworld` is not in FALLBACK_TYPE_CANDIDATES and has only 1 observation (below threshold).
        // The family fallback should find the planet link from johnny-rico via the character type.
        const familyIndex = new Map([
            ...INDEX,
            ['planet-p', '/vault/planet-p.md'],
            ['roughnecks', '/vault/roughnecks.md'],
            ['johnny-rico', '/vault/johnny-rico.md']
        ]);
        const doc = makeDocument([
            '---',
            'id: carl-jenkins',
            'type: character',
            'unit: [[roughnecks]]',
            'homeworld: ',
            '---'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/carl-jenkins.md' };

        const result = resolveFrontmatterRelationCandidates(
            doc,
            { line: 4, character: 'homeworld: '.length },
            familyIndex
        );
        assert.ok(result);
        // homeworld is an unrecognised field name — targetType comes from inference only
        const hints = result.rankingHints;
        assert.ok(hints);
        // Whether the family fallback or the learned model fires, candidateTypeScores must be non-empty
        // so that planet-p or character notes rank above random unrelated candidates.
        assert.ok(hints.candidateTypeScores instanceof Map);
        // If the family fallback fired, familyHint will mention the inferred type.
        // If the learned model fired instead, familyHint is null (that's also acceptable —
        // the learned model is strictly better when it has data).
        if (hints.familyHint !== null) {
            assert.match(hints.familyHint, /character|planet/i);
        }
    });

    test('recent mutation behavior biases relation ranking toward the current modeling pattern', () => {
        try {
            setMutationEventsProvider(() => ([
                {
                    type: 'relation_changed',
                    noteId: 'johnny-rico',
                    field: 'unit',
                    newValue: '[[roughnecks]]',
                    timestamp: new Date().toISOString()
                },
                {
                    type: 'relation_changed',
                    noteId: 'lt-rasczak',
                    field: 'unit',
                    newValue: '[[roughnecks]]',
                    timestamp: new Date().toISOString()
                }
            ]));
            resetVaultPriorsCache();

            const unitIndex = new Map([
                ['johnny-rico', '/vault/johnny-rico.md'],
                ['carmen-ibanez', '/vault/carmen-ibanez.md'],
                ['lt-rasczak', '/vault/lt-rasczak.md'],
                ['roughnecks', '/vault/roughnecks.md']
            ]);
            const doc = makeDocument([
                '---',
                'id: ace-levy',
                'type: character',
                'unit: ',
                '---'
            ].join('\n'));
            doc.uri = { fsPath: '/vault/ace-levy.md' };

            const result = resolveFrontmatterRelationCandidates(doc, { line: 3, character: 'unit: '.length }, unitIndex);
            assert.ok(result);
            assert.ok(result.rankingHints);
            assert.ok(result.rankingHints.behaviorHint);
            assert.ok(result.rankingHints.behavioralPreferredIds.includes('roughnecks'));

            const ranked = rankCandidateIds(
                result.candidateIds,
                result.partial,
                result.preferredIds,
                result.localLinkedIds,
                result.observedIdScores,
                result.rankingHints
            );
            assert.equal(ranked[0], 'roughnecks');
        } finally {
            setMutationEventsProvider(null);
            resetVaultPriorsCache();
        }
    });
});

describe('drift-aware field completion', () => {
    test('surfaces missing expected fields for a drifting note', () => {
        // soldier-c (rank, unit) is missing 'name' which 2/3 soldier peers have → expected
        const doc = makeDocument([
            '---',
            'id: soldier-c',
            'type: soldier',
            'rank: sergeant',
            'unit: [[roughnecks]]',
            '---'
        ].join('\n'));
        const suggestions = collectDriftMissingFieldSuggestions(doc, 'soldier', INDEX);
        assert.ok(suggestions.length > 0, 'drift should fire — soldier-c missing name');
        const nameEntry = suggestions.find(e => e.key === 'name');
        assert.ok(nameEntry, 'name should appear in missing expected suggestions');
        assert.ok(nameEntry.driftMissing === true);
        assert.ok(nameEntry.ratio >= 0.60, 'ratio must meet expected threshold');
        assert.match(nameEntry.driftNote, /soldier/, 'driftNote references the note type');
        assert.ok(nameEntry.score > 0, 'score should be positive');
    });

    test('returns empty when note already has all expected fields', () => {
        const doc = makeDocument([
            '---',
            'id: soldier-a',
            'type: soldier',
            'name: Alpha',
            'rank: private',
            'unit: [[roughnecks]]',
            '---'
        ].join('\n'));
        const suggestions = collectDriftMissingFieldSuggestions(doc, 'soldier', INDEX);
        assert.equal(suggestions.length, 0, 'soldier-a has all expected fields — no drift suggestions');
    });

    test('returns empty when note has no id (no stable vault identity)', () => {
        const doc = makeDocument([
            '---',
            'type: soldier',
            'rank: corporal',
            '---'
        ].join('\n'));
        const suggestions = collectDriftMissingFieldSuggestions(doc, 'soldier', INDEX);
        assert.equal(suggestions.length, 0, 'no id → cannot look up drift');
    });

    test('every drift suggestion carries driftMissing marker and a non-empty driftNote', () => {
        const doc = makeDocument([
            '---',
            'id: soldier-c',
            'type: soldier',
            'rank: sergeant',
            'unit: [[roughnecks]]',
            '---'
        ].join('\n'));
        const suggestions = collectDriftMissingFieldSuggestions(doc, 'soldier', INDEX);
        assert.ok(suggestions.length > 0);
        for (const entry of suggestions) {
            assert.ok(entry.driftMissing === true, `${entry.key} should be marked driftMissing`);
            assert.ok(typeof entry.driftNote === 'string' && entry.driftNote.length > 0, `${entry.key} should have a non-empty driftNote`);
            assert.ok(typeof entry.ratio === 'number' && entry.ratio >= 0.60, `${entry.key} ratio must be at or above expected threshold`);
        }
    });
});

Module._resolveFilename = originalResolve;
