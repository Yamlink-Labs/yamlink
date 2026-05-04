'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

const REGISTRY = new Map([
    ['account', new Set(['acme-inc', 'globex'])],
    ['contact', new Set(['alice-smith'])]
]);

const FIELDS = new Map([
    ['schema-contact', { type: 'schema', target: 'contact' }],
    ['alice-smith', { type: 'contact', account: '[[acme-inc]]', email: 'alice@acme.com', phone: '+56 9 1234 0000' }],
    ['bob-jones', { type: 'contact', account: '[[globex]]', email: 'bob@globex.com', phone: '+56 9 5678 0000' }],
    ['carla-fernandez', { type: 'note', company: '[[acme-inc]]', email: 'carla@acme.com', phone: '+56 9 9999 0000', followup: '2026-05-12' }],
    ['acme-inc', { type: 'account' }],
    ['globex', { type: 'account' }]
]);

const INDEX = new Map([
    ['alice-smith', '/vault/alice-smith.md'],
    ['bob-jones', '/vault/bob-jones.md'],
    ['acme-inc', '/vault/acme-inc.md'],
    ['globex', '/vault/globex.md']
]);

require.cache.__completion_vscode_stub__ = {
    id: '__completion_vscode_stub__',
    filename: '__completion_vscode_stub__',
    loaded: true,
    exports: {}
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
        getVaultGeneration: () => 0
    }
};
require.cache.__completion_date_stub__ = {
    id: '__completion_date_stub__',
    filename: '__completion_date_stub__',
    loaded: true,
    exports: {
        normaliseDateInput(value) {
            return String(value || '').trim() || null;
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
    collectLocalLinkedIds,
    rankCandidateIds,
    buildFieldInferenceDetail
} = require('../src/features/completion');

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
    test('infers likely target types from relation-like field names', () => {
        assert.equal(inferTargetTypeFromFieldName('account'), 'account');
        assert.equal(inferTargetTypeFromFieldName('accounts'), 'account');
        assert.equal(inferTargetTypeFromFieldName('account_id'), 'account');
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
        assert.deepEqual(result.candidateIds.sort(), ['acme-inc', 'alice-smith', 'bob-jones', 'globex']);
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
        assert.deepEqual(result.candidateIds.sort(), ['acme-inc', 'alice-smith', 'bob-jones', 'globex']);
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
        assert.deepEqual(result.candidateIds.sort(), ['acme-inc', 'alice-smith', 'bob-jones', 'globex']);
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

    test('offers archetype-based field suggestions from type and title cues', () => {
        const doc = makeDocument([
            '---',
            'id: acme-inc',
            'type: account',
            '---',
            '# Account Profile'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/account-profile.md' };

        const suggestions = collectArchetypeFieldSuggestions(doc, 'account');
        assert.ok(suggestions.some(entry => entry.key === 'owner'));
        assert.ok(suggestions.some(entry => entry.key === 'status'));
        assert.ok(suggestions.some(entry => entry.key === 'contacts'));
    });

    test('offers note-role-based field suggestions from the note structure itself', () => {
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
        assert.ok(suggestions.some(entry => entry.key === 'purpose'));
        assert.ok(suggestions.some(entry => entry.key === 'participants'));
        assert.ok(suggestions.some(entry => entry.source === 'event'));
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

    test('uses title and field cues to infer note-role suggestions beyond type names alone', () => {
        const doc = makeDocument([
            '---',
            'id: inkjet-overview',
            'type: note',
            'products: [[product-inkjet-pro]]',
            'related: [[inkjet]]',
            'summary: Core inkjet concepts across Kyocera products',
            '---',
            '# Inkjet concept overview'
        ].join('\n'));
        doc.uri = { fsPath: '/vault/inkjet-concept-overview.md' };

        const suggestions = collectNoteRoleFieldSuggestions(doc, 'note', INDEX);
        assert.ok(suggestions.some(entry => entry.key === 'products'));
        assert.ok(suggestions.some(entry => entry.key === 'related'));
        assert.ok(suggestions.some(entry => entry.source === 'concept'));
    });

    test('infers task-style note suggestions from broad workflow structure', () => {
        const doc = makeDocument([
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
        doc.uri = { fsPath: '/vault/graph-selection-bug.md' };

        const suggestions = collectNoteRoleFieldSuggestions(doc, 'note', INDEX);
        assert.ok(suggestions.some(entry => entry.key === 'priority'));
        assert.ok(suggestions.some(entry => entry.key === 'assignee'));
        assert.ok(suggestions.some(entry => entry.source === 'task'));
    });

    test('note-role suggestions carry explainable reasons forward', () => {
        const doc = makeDocument([
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
        doc.uri = { fsPath: '/vault/graph-selection-bug.md' };

        const suggestions = collectNoteRoleFieldSuggestions(doc, 'note', INDEX);
        const taskSuggestion = suggestions.find(entry => entry.source === 'task');
        assert.ok(taskSuggestion);
        assert.ok(Array.isArray(taskSuggestion.reasons));
        assert.ok(taskSuggestion.reasons.some(reason => reason.includes('task') || reason.includes('workflow')));
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
});

Module._resolveFilename = originalResolve;
