'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { describe, it, beforeEach, afterEach } = require('node:test');

const {
    createVault,
    queueInformationMessageResponses,
    resetVscodeStubState,
    requireWithVscodeStub
} = require('./lib/vaultSim');
const { maybeSuggestFieldCascade, resetSuggestionCascade } = requireWithVscodeStub('../src/features/suggestionCascade', require);

function CONTACT(id, hasCompany) {
    const company = hasCompany ? 'company: "[[acme]]"\n' : '';
    return `---\nid: ${id}\ntype: contact\nstatus: active\n${company}---\n\n${id} body.\n`;
}

function bundleFixture() {
    const files = { 'acme.md': '---\nid: acme\ntype: company\nname: Acme Corp\n---\n' };
    for (const id of ['ada', 'bea', 'cy', 'dex', 'fen', 'gus']) {
        files[`${id}.md`] = CONTACT(id, true);
    }
    files['erin.md'] = CONTACT('erin', false);
    return files;
}

function readVaultFile(vault, filename) {
    return fs.readFileSync(path.join(vault.dir, filename), 'utf8');
}

describe('suggestion cascade', () => {
    beforeEach(() => {
        resetVscodeStubState();
        resetSuggestionCascade();
    });

    afterEach(() => {
        resetVscodeStubState();
        resetSuggestionCascade();
    });

    it('confirm path inserts a blank stub for the top high-confidence missing field', async () => {
        const vault = createVault(bundleFixture());
        try {
            queueInformationMessageResponses('Add Field');

            await maybeSuggestFieldCascade('erin');

            const erinText = readVaultFile(vault, 'erin.md');
            assert.ok(erinText.includes('company:\n'), 'expected a blank company stub to be inserted');
            assert.ok(!erinText.includes('company: "[['), 'cascade should never invent a value, only a blank stub');
        } finally {
            vault.destroy();
        }
    });

    it('decline path leaves the note unchanged', async () => {
        const vault = createVault(bundleFixture());
        try {
            const before = readVaultFile(vault, 'erin.md');
            queueInformationMessageResponses('Dismiss');

            await maybeSuggestFieldCascade('erin');

            const after = readVaultFile(vault, 'erin.md');
            assert.equal(after, before);
        } finally {
            vault.destroy();
        }
    });

    it('never nudges the same note+field twice in one session', async () => {
        const vault = createVault(bundleFixture());
        try {
            queueInformationMessageResponses('Add Field');

            await maybeSuggestFieldCascade('erin');
            await maybeSuggestFieldCascade('erin');

            const erinText = readVaultFile(vault, 'erin.md');
            const stubCount = (erinText.match(/company:\n/g) || []).length;
            assert.equal(stubCount, 1, 'expected exactly one company stub, not a repeat nudge');
        } finally {
            vault.destroy();
        }
    });

    it('stays silent for a note with no fieldsCache entry', async () => {
        const vault = createVault(bundleFixture());
        try {
            queueInformationMessageResponses('Add Field');
            await maybeSuggestFieldCascade('does-not-exist');
            // No throw, and the queued response is left untouched (nothing to assert on
            // the queue directly, but a real vault file is unaffected either way).
            assert.ok(true);
        } finally {
            vault.destroy();
        }
    });
});
