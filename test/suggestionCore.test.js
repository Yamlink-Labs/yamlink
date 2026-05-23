'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

let vaultGeneration = 0;
const fieldsCache = new Map([
    ['account-acme', { id: 'account-acme', type: 'account', name: 'Acme', owner: 'javier' }],
    ['contact-jane', { id: 'contact-jane', type: 'contact', account: 'account-acme', email: 'jane@acme.com' }],
    ['meeting-q1', { id: 'meeting-q1', type: 'meeting', account: 'account-acme', date: '2026-05-01' }]
]);

const originalResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, ...rest) {
    if (request === '../core/indexService') return '__suggestion_core_index_service__';
    return originalResolve(request, parent, ...rest);
};

require.cache.__suggestion_core_index_service__ = {
    id: '__suggestion_core_index_service__',
    filename: '__suggestion_core_index_service__',
    loaded: true,
    exports: {
        getVaultGeneration() {
            return vaultGeneration;
        }
    }
};

const {
    buildObservedNoteIndex,
    buildAdaptiveFieldPatterns,
    computeObservedRecency
} = require('../src/intelligence/suggestionCore');

describe('suggestion core', () => {
    test('reuses unchanged observed note entries across generations', () => {
        vaultGeneration = 1;
        const first = buildObservedNoteIndex(fieldsCache);
        const firstContact = first.notes.find((note) => note.id === 'contact-jane');

        fieldsCache.set('meeting-q1', { id: 'meeting-q1', type: 'meeting', account: 'account-acme', date: '2026-05-02' });
        vaultGeneration = 2;

        const second = buildObservedNoteIndex(fieldsCache);
        const secondContact = second.notes.find((note) => note.id === 'contact-jane');

        assert.equal(firstContact, secondContact);
    });

    test('patches changed notes incrementally without rebuilding unaffected notes', () => {
        const patchCache = new Map([
            ['account-acme', { id: 'account-acme', type: 'account', name: 'Acme', owner: 'javier' }],
            ['contact-jane', { id: 'contact-jane', type: 'contact', account: 'account-acme', email: 'jane@acme.com' }],
            ['meeting-q1', { id: 'meeting-q1', type: 'meeting', account: 'account-acme', date: '2026-05-01' }]
        ]);

        vaultGeneration = 10;
        const first = buildObservedNoteIndex(patchCache);
        const firstAccount = first.notes.find((note) => note.id === 'account-acme');
        const firstMeeting = first.notes.find((note) => note.id === 'meeting-q1');

        patchCache.set('meeting-q1', { id: 'meeting-q1', type: 'meeting', account: 'account-acme', date: '2026-05-03' });
        vaultGeneration = 11;

        const second = buildObservedNoteIndex(patchCache);
        const secondAccount = second.notes.find((note) => note.id === 'account-acme');
        const secondMeeting = second.notes.find((note) => note.id === 'meeting-q1');

        assert.equal(firstAccount, secondAccount);
        assert.notEqual(firstMeeting, secondMeeting);
        assert.equal(secondMeeting.fields.date, '2026-05-03');
    });

    test('filters weak adaptive patterns and labels stronger ones with confidence bands', () => {
        const noteFields = {
            id: 'contact-prospect',
            type: 'contact',
            account: 'account-acme',
            email: 'prospect@acme.com'
        };
        const noteContext = {
            noteRole: { noteRole: 'person' },
            currentTags: []
        };

        const patterns = buildAdaptiveFieldPatterns(noteFields, noteContext, fieldsCache, {
            nodeType: 'contact',
            currentTags: [],
            currentMentionedIds: []
        });

        assert.ok(patterns.length > 0);
        assert.ok(patterns.every((pattern) => pattern.confidenceBand === 'medium' || pattern.confidenceBand === 'high'));
        assert.ok(patterns.some((pattern) => pattern.field === 'date'));
    });

    test('uses field-bundle overlap instead of role labels to surface adaptive patterns', () => {
        const localCache = new Map([
            ['contact-jane', { id: 'contact-jane', type: 'contact', account: 'account-acme', email: 'jane@acme.com', phone: '+56 9 1111 1111' }],
            ['contact-bruno', { id: 'contact-bruno', type: 'contact', account: 'account-acme', email: 'bruno@acme.com', phone: '+56 9 2222 2222', manager: '[[alice-smith]]' }],
            ['contact-lina', { id: 'contact-lina', type: 'contact', account: 'account-acme', email: 'lina@acme.com', phone: '+56 9 3333 3333' }],
            ['account-acme', { id: 'account-acme', type: 'account', name: 'Acme' }],
            ['alice-smith', { id: 'alice-smith', type: 'person', name: 'Alice Smith' }]
        ]);

        const noteFields = {
            id: 'contact-prospect',
            email: 'prospect@acme.com',
            phone: '+56 9 9999 9999'
        };
        const noteContext = {
            noteRole: { noteRole: 'record', secondaryRoles: [] },
            currentTags: []
        };

        const patterns = buildAdaptiveFieldPatterns(noteFields, noteContext, localCache, {
            nodeType: 'contact',
            currentTags: [],
            currentMentionedIds: []
        });

        const accountField = patterns.find((pattern) => pattern.field === 'account');
        assert.ok(accountField);
        assert.ok(accountField.sharedFields.has('email'));
        assert.ok(accountField.sharedFields.size >= 1);
    });

    test('recent observed patterns outrank stale ones', () => {
        vaultGeneration = 3;
        const temporalCache = new Map([
            ['recent-contact', {
                id: 'recent-contact',
                type: 'contact',
                account: 'account-acme',
                email: 'recent@acme.com',
                followup: '2026-05-12',
                updated: '2026-05-07'
            }],
            ['stale-contact', {
                id: 'stale-contact',
                type: 'contact',
                account: 'account-acme',
                email: 'stale@acme.com',
                owner: 'javier',
                updated: '2024-01-01'
            }]
        ]);

        const noteFields = {
            id: 'contact-prospect',
            type: 'contact',
            account: 'account-acme',
            email: 'prospect@acme.com'
        };
        const noteContext = {
            noteRole: { noteRole: 'person' },
            currentTags: []
        };

        const patterns = buildAdaptiveFieldPatterns(noteFields, noteContext, temporalCache, {
            nodeType: 'contact',
            currentTags: [],
            currentMentionedIds: [],
            referenceDate: '2026-05-08'
        });

        const followup = patterns.find((pattern) => pattern.field === 'followup');
        const owner = patterns.find((pattern) => pattern.field === 'owner');

        assert.ok(followup);
        assert.ok(owner);
        assert.ok(followup.score > owner.score);
        assert.ok((followup.maxRecencyWeight || 0) > (owner.maxRecencyWeight || 0));
    });

    test('computes recency weights from note dates', () => {
        vaultGeneration = 4;
        const fresh = computeObservedRecency({ updated: '2026-05-07' }, { referenceDate: '2026-05-08' });
        const stale = computeObservedRecency({ updated: '2024-01-01' }, { referenceDate: '2026-05-08' });

        assert.equal(fresh.ageDays, 1);
        assert.ok(fresh.recencyWeight > 1);
        assert.ok(stale.recencyWeight < 1);
    });
});
