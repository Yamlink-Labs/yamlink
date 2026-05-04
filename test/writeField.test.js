'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// Stub vscode — writeField falls back to fs.writeFileSync when no open docs
const originalResolve = Module._resolveFilename.bind(Module);
require.cache['__wf_vscode_stub__'] = {
    id: '__wf_vscode_stub__',
    filename: '__wf_vscode_stub__',
    loaded: true,
    exports: {
        Uri: { file: (p) => ({ fsPath: p }) },
        workspace: {
            textDocuments: [],
            applyEdit: async () => true
        },
        Range: class Range { constructor(s, e) { this.start = s; this.end = e; } },
        WorkspaceEdit: class WorkspaceEdit {
            replace() {}
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__wf_vscode_stub__';
    return originalResolve(request, parent, ...rest);
};

const { writeFieldValue } = require('../src/core/writeField');

function tmpFile(content) {
    const p = path.join(os.tmpdir(), 'yamlink-wf-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.md');
    fs.writeFileSync(p, content, 'utf8');
    return p;
}

describe('writeFieldValue', () => {
    test('sets a new field in frontmatter', async () => {
        const p = tmpFile('---\nid: alpha\ntitle: Alpha\n---\n\nBody text.\n');
        const result = await writeFieldValue(p, 'status', 'done');
        assert.equal(result, true);
        const written = fs.readFileSync(p, 'utf8');
        assert.ok(/status:\s*done/.test(written), 'status field written');
        assert.ok(/id:\s*alpha/.test(written), 'id preserved');
        fs.unlinkSync(p);
    });

    test('updates an existing field', async () => {
        const p = tmpFile('---\nid: beta\nstatus: open\n---\n');
        await writeFieldValue(p, 'status', 'closed');
        const written = fs.readFileSync(p, 'utf8');
        assert.ok(/status:\s*closed/.test(written));
        assert.ok(!/status:\s*open/.test(written));
        fs.unlinkSync(p);
    });

    test('deletes a field when newValue is empty string', async () => {
        const p = tmpFile('---\nid: gamma\nstatus: open\n---\n');
        const result = await writeFieldValue(p, 'status', '');
        assert.equal(result, true);
        const written = fs.readFileSync(p, 'utf8');
        assert.ok(!/status:/.test(written));
        assert.ok(/id:\s*gamma/.test(written));
        fs.unlinkSync(p);
    });

    test('rejects id field', async () => {
        const p = tmpFile('---\nid: delta\n---\n');
        const result = await writeFieldValue(p, 'id', 'new-id');
        assert.equal(result, false);
        const written = fs.readFileSync(p, 'utf8');
        assert.ok(/id:\s*delta/.test(written), 'original id unchanged');
        fs.unlinkSync(p);
    });

    test('returns false for file with no frontmatter', async () => {
        const p = tmpFile('Just a plain markdown file.\n');
        const result = await writeFieldValue(p, 'status', 'done');
        assert.equal(result, false);
        fs.unlinkSync(p);
    });

    test('returns false for missing file', async () => {
        const result = await writeFieldValue('/nonexistent/path/file.md', 'status', 'done');
        assert.equal(result, false);
    });

    test('returns false for null filePath', async () => {
        const result = await writeFieldValue(null, 'status', 'done');
        assert.equal(result, false);
    });

    test('returns false for null field', async () => {
        const p = tmpFile('---\nid: epsilon\n---\n');
        const result = await writeFieldValue(p, null, 'done');
        assert.equal(result, false);
        fs.unlinkSync(p);
    });

    test('trims whitespace from string values', async () => {
        const p = tmpFile('---\nid: zeta\n---\n');
        await writeFieldValue(p, 'status', '  open  ');
        const written = fs.readFileSync(p, 'utf8');
        assert.ok(/status:\s*open/.test(written));
        assert.ok(!/status:\s*  open  /.test(written));
        fs.unlinkSync(p);
    });
});
