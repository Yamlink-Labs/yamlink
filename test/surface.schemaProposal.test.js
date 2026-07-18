'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { describe, test, beforeEach, afterEach } = require('node:test');

const {
    createVault,
    queueInformationMessageResponses,
    queueInputBoxResponses,
    resetVscodeStubState,
    requireWithVscodeStub
} = require('./lib/vaultSim');
const { detectClusters } = require('../src/intelligence/clusterEmergence');
const { createSchemaNote } = requireWithVscodeStub('../src/features/healthPanel', require);

function NOTE(id, type, extraFrontmatter = '', body = '') {
    return `---\nid: ${id}\ntype: ${type}\n${extraFrontmatter}---\n\n${body}`;
}

function clusterFixture() {
    return {
        'acme.md': NOTE('acme', 'company', 'name: Acme Corp\n'),
        'ada.md': NOTE('ada', 'contact', 'status: active\ncompany: "[[acme]]"\n', 'Ada body.\n'),
        'bea.md': NOTE('bea', 'contact', 'status: active\ncompany: "[[acme]]"\n', 'Bea body.\n'),
        'cy.md': NOTE('cy', 'contact', 'status: active\ncompany: "[[acme]]"\n', 'Cy body.\n'),
        'dex.md': NOTE('dex', 'contact', 'status: active\ncompany: "[[acme]]"\n', 'Dex body.\n'),
        'erin.md': NOTE('erin', 'contact', 'status: active\n', 'Erin body.\n')
    };
}

function readVaultFile(vault, filename) {
    return fs.readFileSync(path.join(vault.dir, filename), 'utf8');
}

describe('schema proposal surface', () => {
    beforeEach(() => {
        resetVscodeStubState();
    });

    afterEach(() => {
        resetVscodeStubState();
    });

    test('cluster detection surfaces a proposable cluster', () => {
        const vault = createVault(clusterFixture());

        try {
            const result = detectClusters(vault.fieldsCache);
            const contactCluster = result.clusters.find((cluster) => (
                cluster.dominantType === 'contact'
                && cluster.noteCount === 4
                && cluster.fields.includes('company')
                && cluster.fields.includes('status')
            ));

            assert.ok(contactCluster, 'expected a contact cluster with the shared company/status signature');
            assert.deepEqual(contactCluster.noteIds.sort(), ['ada', 'bea', 'cy', 'dex']);
        } finally {
            vault.destroy();
        }
    });

    test('createSchemaNote writes a schema note for the detected cluster fields', async () => {
        const vault = createVault(clusterFixture());

        try {
            queueInformationMessageResponses(undefined, 'Skip');

            await createSchemaNote({
                type: 'contact',
                fields: ['company', 'status'],
                noteIds: ['ada', 'bea', 'cy', 'dex']
            });

            const schemaText = readVaultFile(vault, 'schema-contact.md');
            assert.equal(
                schemaText,
                [
                    '---',
                    'id: schema-contact',
                    'type: schema',
                    'for: contact',
                    'fields:',
                    '  - company',
                    '  - status',
                    '---',
                    ''
                ].join('\n')
            );
        } finally {
            vault.destroy();
        }
    });

    test('backfill confirm path writes blank field stubs into closed files', async () => {
        const vault = createVault(clusterFixture());

        try {
            queueInformationMessageResponses(undefined, 'Add Fields', undefined);

            await createSchemaNote({
                type: 'contact',
                fields: ['company', 'status'],
                noteIds: ['ada', 'bea', 'cy', 'dex', 'erin']
            });

            const erinText = readVaultFile(vault, 'erin.md');
            assert.match(erinText, /id: erin\ntype: contact\nstatus: active\ncompany:\n---/);
            assert.ok(erinText.includes('company:\n---'), 'expected a literal blank company stub before the closing frontmatter fence');
            assert.ok(!erinText.includes('company: "[['), 'backfill should add an empty stub, not invent a value');
        } finally {
            vault.destroy();
        }
    });

    test('backfill confirm path uses the open-document WorkspaceEdit route when the note is already open', async () => {
        const vault = createVault(clusterFixture());

        try {
            await vault.openDocument('erin.md');
            queueInformationMessageResponses(undefined, 'Add Fields', undefined);

            await createSchemaNote({
                type: 'contact',
                fields: ['company', 'status'],
                noteIds: ['ada', 'bea', 'cy', 'dex', 'erin']
            });

            const erinText = readVaultFile(vault, 'erin.md');
            assert.match(erinText, /id: erin\ntype: contact\nstatus: active\ncompany:\n---/);
        } finally {
            vault.destroy();
        }
    });

    test('backfill decline path leaves cluster members unchanged', async () => {
        const vault = createVault(clusterFixture());

        try {
            const before = readVaultFile(vault, 'erin.md');
            queueInformationMessageResponses(undefined, 'Skip');

            await createSchemaNote({
                type: 'contact',
                fields: ['company', 'status'],
                noteIds: ['ada', 'bea', 'cy', 'dex', 'erin']
            });

            const after = readVaultFile(vault, 'erin.md');
            assert.equal(after, before);
        } finally {
            vault.destroy();
        }
    });

    test('when type is omitted, schema creation can be driven by the scripted input-box queue', async () => {
        const vault = createVault(clusterFixture());

        try {
            queueInputBoxResponses('contact');
            queueInformationMessageResponses(undefined, 'Skip');

            await createSchemaNote({
                type: null,
                fields: ['company', 'status'],
                noteIds: ['ada', 'bea', 'cy', 'dex']
            });

            assert.ok(fs.existsSync(path.join(vault.dir, 'schema-contact.md')));
        } finally {
            vault.destroy();
        }
    });
});
