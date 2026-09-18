'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { createVault } = require('./lib/vaultSim');
const { parseFrontmatterDocument } = require('../src/core/frontmatter');

const BIN = path.resolve('bin/yamlink.js');

function cli(args, vaultPath) {
    return spawnSync('node', [BIN, ...args, '--vault', vaultPath], {
        encoding: 'utf8',
        cwd: path.resolve('.'),
        timeout: 15000
    });
}

function parseJson(stdout) {
    return JSON.parse(String(stdout || '').trim());
}

function makeBulkSetVault() {
    return createVault({
        'johnny-rico.md': [
            '---',
            'id: johnny-rico',
            'type: contact',
            'name: Johnny Rico',
            'status: active',
            '---',
            ''
        ].join('\n'),
        'carl-jenkins.md': [
            '---',
            'id: carl-jenkins',
            'type: contact',
            'name: Carl Jenkins',
            'status: active',
            '---',
            ''
        ].join('\n'),
        'dizzy-flores.md': [
            '---',
            'id: dizzy-flores',
            'type: contact',
            'name: Dizzy Flores',
            'status: active',
            '---',
            ''
        ].join('\n'),
        'roughnecks.md': [
            '---',
            'id: roughnecks',
            'type: unit',
            'name: Roughnecks',
            '---',
            ''
        ].join('\n')
    });
}

function readFields(vault, fileName) {
    const content = fs.readFileSync(path.join(vault.dir, fileName), 'utf8');
    return parseFrontmatterDocument(content).data;
}

describe('CLI bulk-set', () => {
    test('--value overwrites a field across three notes', () => {
        const vault = makeBulkSetVault();
        try {
            const result = cli([
                'bulk-set',
                '--ids', 'johnny-rico,carl-jenkins,dizzy-flores',
                '--field', 'status',
                '--value', 'deployed',
                '--json'
            ], vault.dir);

            assert.equal(result.status, 0, result.stderr);
            const body = parseJson(result.stdout);
            assert.equal(body.ok, true);
            assert.equal(body.succeeded.length, 3);
            assert.equal(body.failed.length, 0);
            assert.equal(readFields(vault, 'johnny-rico.md').status, 'deployed');
            assert.equal(readFields(vault, 'carl-jenkins.md').status, 'deployed');
            assert.equal(readFields(vault, 'dizzy-flores.md').status, 'deployed');
        } finally {
            vault.destroy();
        }
    });

    test('--add creates a wikilink-list relation across three notes', () => {
        const vault = makeBulkSetVault();
        try {
            const result = cli([
                'bulk-set',
                '--ids', 'johnny-rico,carl-jenkins,dizzy-flores',
                '--field', 'unit',
                '--add', 'roughnecks',
                '--json'
            ], vault.dir);

            assert.equal(result.status, 0, result.stderr);
            const body = parseJson(result.stdout);
            assert.equal(body.succeeded.length, 3);
            assert.deepEqual(readFields(vault, 'johnny-rico.md').unit, ['[[roughnecks]]']);
            assert.deepEqual(readFields(vault, 'carl-jenkins.md').unit, ['[[roughnecks]]']);
            assert.deepEqual(readFields(vault, 'dizzy-flores.md').unit, ['[[roughnecks]]']);
        } finally {
            vault.destroy();
        }
    });

    test('--add is idempotent and does not duplicate existing list entries', () => {
        const vault = makeBulkSetVault();
        try {
            const args = [
                'bulk-set',
                '--ids', 'johnny-rico,carl-jenkins,dizzy-flores',
                '--field', 'unit',
                '--add', 'roughnecks',
                '--json'
            ];

            assert.equal(cli(args, vault.dir).status, 0);
            const second = cli(args, vault.dir);

            assert.equal(second.status, 0, second.stderr);
            const body = parseJson(second.stdout);
            assert.equal(body.succeeded.length, 3);
            assert.ok(body.succeeded.every((entry) => entry.changed === false));
            assert.deepEqual(readFields(vault, 'johnny-rico.md').unit, ['[[roughnecks]]']);
        } finally {
            vault.destroy();
        }
    });

    test('a missing id fails without aborting the rest of the batch', () => {
        const vault = makeBulkSetVault();
        try {
            const result = cli([
                'bulk-set',
                '--ids', 'johnny-rico,no-such-note,carl-jenkins',
                '--field', 'status',
                '--value', 'ready',
                '--json'
            ], vault.dir);

            assert.equal(result.status, 1);
            const body = parseJson(result.stdout);
            assert.equal(body.ok, false);
            assert.deepEqual(body.succeeded.map((entry) => entry.id), ['johnny-rico', 'carl-jenkins']);
            assert.deepEqual(body.failed.map((entry) => entry.id), ['no-such-note']);
            assert.equal(readFields(vault, 'johnny-rico.md').status, 'ready');
            assert.equal(readFields(vault, 'carl-jenkins.md').status, 'ready');
            assert.equal(readFields(vault, 'dizzy-flores.md').status, 'active');
        } finally {
            vault.destroy();
        }
    });

    test('--add fails clearly on scalar fields and does not corrupt the note', () => {
        const vault = makeBulkSetVault();
        try {
            const before = fs.readFileSync(path.join(vault.dir, 'johnny-rico.md'), 'utf8');
            const result = cli([
                'bulk-set',
                '--ids', 'johnny-rico',
                '--field', 'status',
                '--add', 'roughnecks',
                '--json'
            ], vault.dir);

            assert.equal(result.status, 1);
            const body = parseJson(result.stdout);
            assert.equal(body.failed.length, 1);
            assert.match(body.failed[0].error, /scalar value/);
            assert.equal(fs.readFileSync(path.join(vault.dir, 'johnny-rico.md'), 'utf8'), before);
        } finally {
            vault.destroy();
        }
    });

    test('--dry-run reports changes but writes nothing', () => {
        const vault = makeBulkSetVault();
        try {
            const result = cli([
                'bulk-set',
                '--ids', 'johnny-rico,carl-jenkins',
                '--field', 'status',
                '--value', 'dry-only',
                '--dry-run',
                '--json'
            ], vault.dir);

            assert.equal(result.status, 0, result.stderr);
            const body = parseJson(result.stdout);
            assert.equal(body.dryRun, true);
            assert.equal(body.succeeded.length, 2);
            assert.equal(readFields(vault, 'johnny-rico.md').status, 'active');
            assert.equal(readFields(vault, 'carl-jenkins.md').status, 'active');
        } finally {
            vault.destroy();
        }
    });

    test('--json output keeps succeeded and failed arrays in the documented shape', () => {
        const vault = makeBulkSetVault();
        try {
            const result = cli([
                'bulk-set',
                '--ids', 'johnny-rico,missing-note',
                '--field', 'rank',
                '--value', 'Captain',
                '--json'
            ], vault.dir);

            assert.equal(result.status, 1);
            const body = parseJson(result.stdout);
            assert.equal(body.command, 'bulk-set');
            assert.equal(body.operation, 'value');
            assert.equal(body.succeeded[0].id, 'johnny-rico');
            assert.equal(body.succeeded[0].field, 'rank');
            assert.equal(body.succeeded[0].oldValue, null);
            assert.equal(body.succeeded[0].newValue, 'Captain');
            assert.equal(body.failed[0].id, 'missing-note');
            assert.equal(typeof body.failed[0].error, 'string');
        } finally {
            vault.destroy();
        }
    });

    test('usage errors reject ambiguous operations before writing anything', () => {
        const vault = makeBulkSetVault();
        try {
            const before = fs.readFileSync(path.join(vault.dir, 'johnny-rico.md'), 'utf8');
            const result = cli([
                'bulk-set',
                '--ids', 'johnny-rico',
                '--field', 'status',
                '--value', 'ready',
                '--clear',
                '--json'
            ], vault.dir);

            assert.equal(result.status, 1);
            const body = parseJson(result.stdout);
            assert.equal(body.code, 'USAGE');
            assert.equal(fs.readFileSync(path.join(vault.dir, 'johnny-rico.md'), 'utf8'), before);
        } finally {
            vault.destroy();
        }
    });

    test('writes field mutation events with cli_bulk_set cause', () => {
        const vault = makeBulkSetVault();
        try {
            const setResult = cli([
                'bulk-set',
                '--ids', 'johnny-rico,carl-jenkins',
                '--field', 'rank',
                '--value', 'Captain',
                '--json'
            ], vault.dir);
            assert.equal(setResult.status, 0, setResult.stderr);

            const mutations = cli(['mutations', '--type', 'field_added', '--json'], vault.dir);
            assert.equal(mutations.status, 0, mutations.stderr);
            const body = parseJson(mutations.stdout);
            const bulkEvents = body.events.filter((event) =>
                event.source === 'cli' &&
                event.cause === 'cli_bulk_set' &&
                event.field === 'rank'
            );
            assert.equal(bulkEvents.length, 2);
            assert.deepEqual(bulkEvents.map((event) => event.noteId).sort(), ['carl-jenkins', 'johnny-rico']);
        } finally {
            vault.destroy();
        }
    });
});
