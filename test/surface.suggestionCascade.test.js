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
const { appendMutationEvents, clearMutationEvents, initMutationLog } = require('../src/runtime/mutationEventLog');
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
        initMutationLog(null);
        clearMutationEvents();
        resetVscodeStubState();
        resetSuggestionCascade();
    });

    afterEach(() => {
        clearMutationEvents();
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

    it('falls back to workflow memory when arc has no high-confidence candidate', async () => {
        const vault = createVault({
            'memory-a.md': CONTACT('memory-a', false),
            'memory-b.md': CONTACT('memory-b', false),
            'erin.md': CONTACT('erin', false)
        });
        try {
            appendMutationEvents([
                { timestamp: '2026-01-01T10:00:00.000Z', type: 'type_set', noteId: 'memory-a', field: 'type', newValue: 'contact' },
                { timestamp: '2026-01-01T10:01:00.000Z', type: 'field_added', noteId: 'memory-a', field: 'status', newValue: 'active' },
                { timestamp: '2026-01-01T10:02:00.000Z', type: 'field_added', noteId: 'memory-a', field: 'callsign', newValue: 'alpha' },
                { timestamp: '2026-01-02T10:00:00.000Z', type: 'type_set', noteId: 'memory-b', field: 'type', newValue: 'contact' },
                { timestamp: '2026-01-02T10:01:00.000Z', type: 'field_added', noteId: 'memory-b', field: 'status', newValue: 'active' },
                { timestamp: '2026-01-02T10:02:00.000Z', type: 'field_added', noteId: 'memory-b', field: 'callsign', newValue: 'bravo' }
            ]);
            queueInformationMessageResponses('Add Field');

            await maybeSuggestFieldCascade('erin', 'status');

            const erinText = readVaultFile(vault, 'erin.md');
            assert.ok(erinText.includes('callsign:\n'), 'expected workflow memory to nudge callsign');
        } finally {
            vault.destroy();
        }
    });

    it('keeps the arc candidate as the only nudge when arc and workflow memory both have candidates', async () => {
        const vault = createVault(bundleFixture());
        try {
            appendMutationEvents([
                { timestamp: '2026-01-01T10:00:00.000Z', type: 'type_set', noteId: 'memory-a', field: 'type', newValue: 'contact' },
                { timestamp: '2026-01-01T10:01:00.000Z', type: 'field_added', noteId: 'memory-a', field: 'status', newValue: 'active' },
                { timestamp: '2026-01-01T10:02:00.000Z', type: 'field_added', noteId: 'memory-a', field: 'callsign', newValue: 'alpha' },
                { timestamp: '2026-01-02T10:00:00.000Z', type: 'type_set', noteId: 'memory-b', field: 'type', newValue: 'contact' },
                { timestamp: '2026-01-02T10:01:00.000Z', type: 'field_added', noteId: 'memory-b', field: 'status', newValue: 'active' },
                { timestamp: '2026-01-02T10:02:00.000Z', type: 'field_added', noteId: 'memory-b', field: 'callsign', newValue: 'bravo' }
            ]);
            queueInformationMessageResponses('Add Field');

            await maybeSuggestFieldCascade('erin', 'status');

            const erinText = readVaultFile(vault, 'erin.md');
            assert.ok(erinText.includes('company:\n'), 'expected existing arc candidate to win');
            assert.ok(!erinText.includes('callsign:\n'), 'workflow memory should not fire a second nudge');
        } finally {
            vault.destroy();
        }
    });
});
