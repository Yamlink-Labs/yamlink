'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createVault, requireWithVscodeStub, resetVscodeStubState } = require('./lib/vaultSim');
const { selectSmartFieldInsertions } = requireWithVscodeStub('../src/actions/nodeCreationTemplates', require);

describe('selectSmartFieldInsertions — Smart Templates value pre-fill', () => {

    test('pre-fills a missing relation field when the vault has strong, consistent evidence', () => {
        resetVscodeStubState();
        const vault = createVault({
            'mission-alpha.md': '---\nid: mission-alpha\ntype: mission\ncommander: [[johnny-rico]]\n---\n',
            'mission-beta.md': '---\nid: mission-beta\ntype: mission\ncommander: [[johnny-rico]]\n---\n',
            'mission-gamma.md': '---\nid: mission-gamma\ntype: mission\n---\n',
            'johnny-rico.md': '---\nid: johnny-rico\ntype: character\n---\n'
        });
        try {
            const opportunities = vault.completionOpportunities('mission-gamma', '');
            const { insertLines, smartFilledFields } = selectSmartFieldInsertions(opportunities, ['commander']);
            assert.deepEqual(smartFilledFields, ['commander']);
            assert.deepEqual(insertLines, ['commander: [[johnny-rico]]']);
        } finally {
            vault.destroy();
        }
    });

    test('leaves a missing field blank when the vault has no evidence for it', () => {
        resetVscodeStubState();
        const vault = createVault({
            'mission-alpha.md': '---\nid: mission-alpha\ntype: mission\n---\n',
            'mission-gamma.md': '---\nid: mission-gamma\ntype: mission\n---\n'
        });
        try {
            const opportunities = vault.completionOpportunities('mission-gamma', '');
            const { insertLines, smartFilledFields } = selectSmartFieldInsertions(opportunities, ['outcome']);
            assert.deepEqual(smartFilledFields, []);
            assert.deepEqual(insertLines, ['outcome:']);
        } finally {
            vault.destroy();
        }
    });

    test('mixes smart-filled and blank fields correctly in one call', () => {
        resetVscodeStubState();
        const vault = createVault({
            'mission-alpha.md': '---\nid: mission-alpha\ntype: mission\ncommander: [[johnny-rico]]\n---\n',
            'mission-beta.md': '---\nid: mission-beta\ntype: mission\ncommander: [[johnny-rico]]\n---\n',
            'mission-gamma.md': '---\nid: mission-gamma\ntype: mission\n---\n',
            'johnny-rico.md': '---\nid: johnny-rico\ntype: character\n---\n'
        });
        try {
            const opportunities = vault.completionOpportunities('mission-gamma', '');
            const { insertLines, smartFilledFields } = selectSmartFieldInsertions(opportunities, ['commander', 'outcome']);
            assert.deepEqual(smartFilledFields, ['commander']);
            assert.deepEqual(insertLines, ['commander: [[johnny-rico]]', 'outcome:']);
        } finally {
            vault.destroy();
        }
    });

    test('a null opportunities model (adaptive context unavailable) degrades to all-blank fields, never throws', () => {
        const { insertLines, smartFilledFields } = selectSmartFieldInsertions(null, ['commander', 'outcome']);
        assert.deepEqual(smartFilledFields, []);
        assert.deepEqual(insertLines, ['commander:', 'outcome:']);
    });

});
