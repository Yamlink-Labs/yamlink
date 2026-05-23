'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    addQueryWarnings,
    closestFieldMatch,
    closestTypeMatch,
    collectFieldCandidates,
    collectRelationFieldCandidates
} = require('../src/intelligence/queryDiagnostics');

// ── Fixture builders ──────────────────────────────────────────────────────────

function makeIndex(ids = []) {
    return new Map(ids.map(id => [id, `/vault/${id}.md`]));
}

function makeFieldsCache(entries = []) {
    return new Map(entries.map(([id, fields]) => [id, fields]));
}

const CRM_FIELDS = makeFieldsCache([
    ['rico',   { type: 'contact', name: 'Rico', account: '[[mi', email: 'rico@mi.gov' }],
    ['carmen', { type: 'contact', name: 'Carmen', account: '[[navajo', email: 'carmen@fleet.gov' }],
    ['mi',     { type: 'account', name: 'Mobile Infantry' }],
    ['navajo', { type: 'account', name: 'Navajo' }]
]);

const CRM_INDEX = makeIndex(['rico', 'carmen', 'mi', 'navajo']);

// ── closestTypeMatch ──────────────────────────────────────────────────────────

describe('closestTypeMatch', () => {
    test('returns null for empty cache', () => {
        assert.equal(closestTypeMatch('contact', makeFieldsCache()), null);
    });

    test('returns exact match when type exists', () => {
        assert.equal(closestTypeMatch('contact', CRM_FIELDS), 'contact');
    });

    test('returns null when type is exact match (distance 0 is reported)', () => {
        assert.equal(closestTypeMatch('contact', CRM_FIELDS), 'contact');
    });

    test('finds close match for typo (conact → contact)', () => {
        const match = closestTypeMatch('conact', CRM_FIELDS);
        assert.equal(match, 'contact');
    });

    test('returns null when distance is too large', () => {
        assert.equal(closestTypeMatch('zzzzzzzz', CRM_FIELDS), null);
    });
});

// ── closestFieldMatch ─────────────────────────────────────────────────────────

describe('closestFieldMatch', () => {
    test('returns close match for field typo (emai → email)', () => {
        const match = closestFieldMatch('emai', 'contact', CRM_FIELDS);
        assert.equal(match, 'email');
    });

    test('returns null for a very different field name', () => {
        assert.equal(closestFieldMatch('zzzzz', 'contact', CRM_FIELDS), null);
    });

    test('returns null when field cache is empty', () => {
        assert.equal(closestFieldMatch('email', 'contact', makeFieldsCache()), null);
    });
});

// ── collectFieldCandidates ────────────────────────────────────────────────────

describe('collectFieldCandidates', () => {
    test('returns fields for the specified type', () => {
        const fields = collectFieldCandidates('contact', CRM_FIELDS);
        assert.ok(fields.includes('email'));
        assert.ok(fields.includes('account'));
        assert.ok(fields.includes('name'));
    });

    test('does not include id field', () => {
        assert.ok(!collectFieldCandidates('contact', CRM_FIELDS).includes('id'));
    });

    test('returns all fields when type is wildcard', () => {
        const fields = collectFieldCandidates('*', CRM_FIELDS);
        assert.ok(fields.includes('email'));
        assert.ok(fields.includes('name'));
    });

    test('returns task fields for type "tasks"', () => {
        const fields = collectFieldCandidates('tasks', CRM_FIELDS);
        assert.ok(fields.includes('done'));
        assert.ok(fields.includes('date'));
        assert.ok(fields.includes('text'));
    });

    test('excludes __yamlink_tags internal field', () => {
        const cache = makeFieldsCache([['note', { type: 'note', __yamlink_tags: 'x' }]]);
        assert.ok(!collectFieldCandidates('note', cache).includes('__yamlink_tags'));
    });
});

// ── collectRelationFieldCandidates ────────────────────────────────────────────

describe('collectRelationFieldCandidates', () => {
    // Use IDs that won't accidentally match name values
    const relCache = makeFieldsCache([
        ['abc123', { type: 'contact', account: '[[xyz789]]', email: 'a@example.com' }],
        ['def456', { type: 'contact', account: '[[xyz789]]', email: 'b@example.com' }],
        ['xyz789', { type: 'account', revenue: '5000' }]
    ]);

    test('returns fields that contain explicit wikilink values', () => {
        const fields = collectRelationFieldCandidates('contact', relCache);
        assert.ok(fields.includes('account'));
    });

    test('fields whose values do not match known ids are excluded', () => {
        const fields = collectRelationFieldCandidates('contact', relCache);
        assert.ok(!fields.includes('email'));
        assert.ok(!fields.includes('revenue'));
    });
});

// ── addQueryWarnings ──────────────────────────────────────────────────────────

describe('addQueryWarnings', () => {
    test('no warnings when rows are non-empty', () => {
        const warnings = [];
        addQueryWarnings(
            { type: 'contact', wheres: [] },
            [{ id: 'rico' }],
            warnings,
            CRM_INDEX,
            CRM_FIELDS
        );
        assert.equal(warnings.length, 0);
    });

    test('warns when index is empty', () => {
        const warnings = [];
        addQueryWarnings({ type: 'contact', wheres: [] }, [], warnings, makeIndex(), makeFieldsCache());
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /No indexed nodes/i);
    });

    test('warns on unknown type with typo suggestion', () => {
        const warnings = [];
        addQueryWarnings({ type: 'conact', wheres: [] }, [], warnings, CRM_INDEX, CRM_FIELDS);
        assert.ok(warnings.some(w => w.includes('contact')));
    });

    test('warns on unknown type without typo match', () => {
        const warnings = [];
        addQueryWarnings({ type: 'zzzunknown', wheres: [] }, [], warnings, CRM_INDEX, CRM_FIELDS);
        assert.ok(warnings.some(w => w.includes('zzzunknown')));
    });

    test('warns when where field is a near-typo of existing field', () => {
        const warnings = [];
        addQueryWarnings(
            { type: 'contact', wheres: [{ field: 'emai', op: 'eq', value: 'test' }] },
            [],
            warnings,
            CRM_INDEX,
            CRM_FIELDS
        );
        assert.ok(warnings.some(w => w.includes('email')));
    });

    test('warns on incoming query with no results for a known type', () => {
        const warnings = [];
        addQueryWarnings(
            { type: 'contact', incoming: true, via: 'missing-field', wheres: [] },
            [],
            warnings,
            CRM_INDEX,
            CRM_FIELDS
        );
        assert.ok(warnings.length > 0, 'expected at least one warning');
        assert.ok(warnings.some(w => /link|incoming|via|field/i.test(w)),
            `unexpected warning: ${warnings[0]}`);
    });
});
