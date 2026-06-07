'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { inferNoteRole } = require('../src/intelligence/noteRolesCore');

describe('note-role intelligence', () => {
    test('mixed workflow notes can carry secondary project roles', () => {
        const result = inferNoteRole({
            type: 'note',
            title: 'Graph selection bug',
            status: 'in-progress',
            deadline: '2026-04-20',
            project: '[[yamlink]]',
            reporter: '[[contact-andreas]]'
        }, {
            titleHints: ['Graph selection bug'],
            fieldRoleResults: [
                { fieldName: 'status', semanticRole: 'status' },
                { fieldName: 'deadline', semanticRole: 'date' },
                { fieldName: 'project', semanticRole: 'container', relational: true },
                { fieldName: 'reporter', semanticRole: 'person', relational: true }
            ]
        });

        assert.equal(result.noteRole, 'task');
        assert.ok(result.secondaryRoles.includes('project'));
        assert.ok(result.secondaryRoleLabels.includes('project'));
    });

    test('mixed relationship notes can carry secondary container roles', () => {
        const result = inferNoteRole({
            type: 'note',
            name: 'Prospect Contact',
            email: 'prospect@cloudlabs.com',
            phone: '+56 9 1111 1111',
            account: '[[cloudlabs-solutions]]'
        }, {
            titleHints: ['Prospect Contact'],
            fieldRoleResults: [
                { fieldName: 'email', semanticRole: 'person' },
                { fieldName: 'phone', semanticRole: 'person' },
                { fieldName: 'account', semanticRole: 'container', relational: true }
            ]
        });

        assert.equal(result.noteRole, 'person');
        assert.ok(result.secondaryRoles.includes('container'));
    });

    test('vault-derived typeRoleMap overrides hardcoded prior at higher confidence', () => {
        const typeRoleMap = new Map([
            ['fighter', { role: 'person', confidence: 0.82, inboundRatio: 0.3, relCount: 2, dateCount: 0, workflowCount: 0 }]
        ]);
        const result = inferNoteRole({ type: 'fighter' }, { typeRoleMap });
        assert.equal(result.noteRole, 'person');
        assert.ok(result.confidence >= 0.80, `expected vault confidence >= 0.80, got ${result.confidence}`);
        assert.ok(result.reasons[0].includes('structurally matches'));
    });

    test('hardcoded prior fires at lower confidence when typeRoleMap has no entry', () => {
        const result = inferNoteRole({ type: 'contact' }, { typeRoleMap: new Map() });
        assert.equal(result.noteRole, 'person');
        assert.ok(result.confidence <= 0.70, `expected weak prior confidence ≤ 0.70, got ${result.confidence}`);
    });

    test('vault-derived role for type not in DEFAULT_NOTE_ROLE_PRIORS', () => {
        const typeRoleMap = new Map([
            ['kommandant', { role: 'person', confidence: 0.75, inboundRatio: 0.5, relCount: 3, dateCount: 0, workflowCount: 0 }]
        ]);
        const result = inferNoteRole({ type: 'kommandant' }, { typeRoleMap });
        assert.equal(result.noteRole, 'person');
    });
});
