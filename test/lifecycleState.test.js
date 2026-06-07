'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildTypeFieldBundles, buildNoteRoleTypePriors } = require('../src/intelligence/vaultPriors');
const { inferNoteRole } = require('../src/intelligence/noteRolesCore');
const { inferLifecycleState } = require('../src/intelligence/lifecycleState');

describe('lifecycle state', () => {
    test('classifies sparse unlinked notes as draft', () => {
        const fieldsCache = new Map([
            ['carl-jenkins', { type: 'character', name: 'Carl Jenkins', unit: '[[roughnecks]]', rank: 'lieutenant' }]
        ]);
        const lifecycle = inferLifecycleState('new-note', { title: 'Scratch idea' }, {
            fieldsCache,
            typeFieldBundles: buildTypeFieldBundles(fieldsCache),
            noteRoleTypePriors: buildNoteRoleTypePriors(fieldsCache),
            noteRole: inferNoteRole({ title: 'Scratch idea' }, {}),
            inboundCount: 0,
            avgInbound: 0,
            nowMs: Date.UTC(2026, 4, 17)
        });

        assert.equal(lifecycle.state, 'draft');
    });

    test('classifies bundle-matching notes as consolidated', () => {
        const fieldsCache = new Map([
            ['carl-jenkins', { type: 'character', name: 'Carl Jenkins', unit: '[[roughnecks]]', rank: 'lieutenant', homeworld: '[[earth]]' }],
            ['dizzy-flores', { type: 'character', name: 'Dizzy Flores', unit: '[[roughnecks]]', rank: 'private', homeworld: '[[earth]]' }],
            ['johnny-rico', { type: 'character', name: 'Johnny Rico', unit: '[[roughnecks]]', rank: 'captain', homeworld: '[[earth]]' }],
            ['earth', { type: 'planet', name: 'Earth' }],
            ['roughnecks', { type: 'unit', name: 'Roughnecks' }]
        ]);
        const lifecycle = inferLifecycleState('ace-levy', {
            type: 'character',
            name: 'Ace Levy',
            unit: '[[roughnecks]]',
            rank: 'private',
            homeworld: '[[earth]]'
        }, {
            fieldsCache,
            typeFieldBundles: buildTypeFieldBundles(fieldsCache),
            noteRoleTypePriors: buildNoteRoleTypePriors(fieldsCache),
            noteRole: inferNoteRole({ type: 'character', name: 'Ace Levy', unit: '[[roughnecks]]', rank: 'private', homeworld: '[[earth]]' }, {}),
            inboundCount: 1,
            avgInbound: 1,
            nowMs: Date.UTC(2026, 4, 17)
        });

        assert.equal(lifecycle.state, 'consolidated');
        assert.ok(lifecycle.reasons[0].includes('common character fields'));
    });

    test('classifies high-inbound notes as hub', () => {
        const fieldsCache = new Map([
            ['yamlink', { type: 'project', name: 'Yamlink', status: 'active' }]
        ]);
        const lifecycle = inferLifecycleState('yamlink', { type: 'project', name: 'Yamlink', status: 'active' }, {
            fieldsCache,
            typeFieldBundles: buildTypeFieldBundles(fieldsCache),
            noteRoleTypePriors: buildNoteRoleTypePriors(fieldsCache),
            noteRole: inferNoteRole({ type: 'project', name: 'Yamlink', status: 'active' }, {}),
            inboundCount: 8,
            avgInbound: 2,
            nowMs: Date.UTC(2026, 4, 17)
        });

        assert.equal(lifecycle.state, 'hub');
    });

    test('classifies notes with stale dates as stale', () => {
        const fieldsCache = new Map([
            ['review', { type: 'task', title: 'Review hover', status: 'open', due: '2026-03-01' }]
        ]);
        const lifecycle = inferLifecycleState('review', { type: 'task', title: 'Review hover', status: 'open', due: '2026-03-01' }, {
            fieldsCache,
            typeFieldBundles: buildTypeFieldBundles(fieldsCache),
            noteRoleTypePriors: buildNoteRoleTypePriors(fieldsCache),
            noteRole: inferNoteRole({ type: 'task', title: 'Review hover', status: 'open', due: '2026-03-01' }, {}),
            inboundCount: 0,
            avgInbound: 0,
            nowMs: Date.UTC(2026, 4, 17)
        });

        assert.equal(lifecycle.state, 'stale');
        assert.equal(lifecycle.isStale, true);
    });

    test('hub takes precedence over stale when both conditions fire', () => {
        const fieldsCache = new Map([
            ['yamlink', { type: 'project', name: 'Yamlink', status: 'active' }]
        ]);
        const lifecycle = inferLifecycleState('yamlink', {
            type: 'project', name: 'Yamlink', status: 'active',
            due: '2025-01-01'
        }, {
            fieldsCache,
            typeFieldBundles: buildTypeFieldBundles(fieldsCache),
            noteRoleTypePriors: buildNoteRoleTypePriors(fieldsCache),
            noteRole: inferNoteRole({ type: 'project', name: 'Yamlink', status: 'active' }, {}),
            inboundCount: 8,
            avgInbound: 2,
            nowMs: Date.UTC(2026, 4, 17)
        });

        assert.equal(lifecycle.state, 'hub');
        assert.equal(lifecycle.isStale, true);
        assert.ok(lifecycle.reasons[0].includes('inbound link'));
    });

    test('isStale is false for non-stale notes', () => {
        const fieldsCache = new Map([
            ['yamlink', { type: 'project', name: 'Yamlink', status: 'active' }]
        ]);
        const lifecycle = inferLifecycleState('yamlink', {
            type: 'project', name: 'Yamlink', status: 'active'
        }, {
            fieldsCache,
            typeFieldBundles: buildTypeFieldBundles(fieldsCache),
            noteRoleTypePriors: buildNoteRoleTypePriors(fieldsCache),
            noteRole: inferNoteRole({ type: 'project', name: 'Yamlink', status: 'active' }, {}),
            inboundCount: 0,
            avgInbound: 0,
            nowMs: Date.UTC(2026, 4, 17)
        });

        assert.equal(lifecycle.isStale, false);
    });

    test('lastMutationMs overrides mtime for stale detection when more recent', () => {
        // Note has no date fields and no idIndex (no mtime lookup).
        // mtimeMs says 90 days ago → stale. lastMutationMs says yesterday → not stale.
        const nowMs = Date.UTC(2026, 4, 17);
        const fieldsCache = new Map([
            ['active-project', { type: 'project', name: 'Active project', status: 'active' }]
        ]);
        const lifecycle = inferLifecycleState('active-project', {
            type: 'project', name: 'Active project', status: 'active'
        }, {
            fieldsCache,
            typeFieldBundles: buildTypeFieldBundles(fieldsCache),
            noteRoleTypePriors: buildNoteRoleTypePriors(fieldsCache),
            noteRole: inferNoteRole({ type: 'project', name: 'Active project', status: 'active' }, {}),
            inboundCount: 0,
            avgInbound: 0,
            nowMs,
            mtimeMs: nowMs - 90 * 24 * 60 * 60 * 1000,  // 90 days ago → would be stale
            lastMutationMs: nowMs - 1 * 24 * 60 * 60 * 1000  // yesterday → not stale
        });

        assert.equal(lifecycle.isStale, false);
        assert.notEqual(lifecycle.state, 'stale');
    });

    test('lastMutationMs contributes to stale when it is the most recent signal', () => {
        const nowMs = Date.UTC(2026, 4, 17);
        const fieldsCache = new Map([
            ['old-note', { type: 'project', name: 'Old note', status: 'active' }]
        ]);
        const lifecycle = inferLifecycleState('old-note', {
            type: 'project', name: 'Old note', status: 'active'
        }, {
            fieldsCache,
            typeFieldBundles: buildTypeFieldBundles(fieldsCache),
            noteRoleTypePriors: buildNoteRoleTypePriors(fieldsCache),
            noteRole: inferNoteRole({ type: 'project', name: 'Old note', status: 'active' }, {}),
            inboundCount: 0,
            avgInbound: 0,
            nowMs,
            mtimeMs: null,  // no file mtime
            lastMutationMs: nowMs - 60 * 24 * 60 * 60 * 1000  // 60 days ago → stale
        });

        assert.equal(lifecycle.isStale, true);
        assert.equal(lifecycle.state, 'stale');
        assert.ok(lifecycle.reasons[0].includes('60 day'));
    });
});
