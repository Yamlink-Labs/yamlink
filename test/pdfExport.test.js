'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildNoteExportModel } = require('../src/export/pdf');
const { buildIndex } = require('../src/core/index');

describe('pdf export models', () => {
    test('builds a structured note export model with embedded view results', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-pdf-'));
        const notePath = path.join(root, 'table-types.md');
        const text = [
            '---',
            'id: table-types',
            'type: lab',
            'name: Table Types',
            'active: true',
            'score: 7',
            'due: 2026-03-31',
            'owner: [[johnny-rico]]',
            'status: active',
            '---',
            '',
            '# Table Types',
            '',
            'This note is here to test typed cell editing.',
            '',
            '!view lab',
            'select active, score, due, owner, status'
        ].join('\n');
        fs.writeFileSync(notePath, text, 'utf8');
        buildIndex([{ uri: { fsPath: root } }]);

        const model = buildNoteExportModel(text, 'table-types');

        assert.equal(model.title, 'Table Types');
        assert.equal(model.id, 'table-types');
        assert.equal(model.type, 'lab');
        assert.equal(model.views.length, 1);
        assert.deepEqual(model.views[0].columns, ['id', 'active', 'score', 'due', 'owner', 'status']);
        fs.rmSync(root, { recursive: true, force: true });
    });
});
