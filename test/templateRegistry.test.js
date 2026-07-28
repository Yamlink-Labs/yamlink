'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    loadTemplates,
    getTemplateForType,
    getTemplateDrift,
    summarizeTemplateDrift,
    extractTemplateType,
    extractTemplateFields,
    buildTemplateFromNote,
    saveTemplateFile
} = require('../src/core/templateRegistry');

function makeTmpVault(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-tmpl-'));
    const templatesDir = path.join(root, '_templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(templatesDir, name), content, 'utf8');
    }
    return root;
}

describe('templateRegistry', () => {
    test('extractTemplateType reads type from frontmatter', () => {
        const content = '---\nid:\ntype: contact\nemail:\n---\n';
        assert.equal(extractTemplateType(content), 'contact');
    });

    test('extractTemplateType returns empty string for missing type', () => {
        const content = '---\nid:\nemail:\n---\n';
        assert.equal(extractTemplateType(content), '');
    });

    test('extractTemplateFields excludes id, type, created', () => {
        const content = '---\nid:\ntype: contact\nemail:\nrole:\ncreated:\naccount:\n---\n';
        const fields = extractTemplateFields(content);
        assert.deepEqual(fields, ['email', 'role', 'account']);
    });

    test('loadTemplates reads all .md files from _templates/', () => {
        const root = makeTmpVault({
            'contact.md': '---\nid:\ntype: contact\nemail:\nrole:\n---\n',
            'account.md': '---\nid:\ntype: account\nstatus:\nurl:\n---\n'
        });
        const templates = loadTemplates(root);
        assert.equal(templates.length, 2);
        const names = templates.map(t => t.name).sort();
        assert.deepEqual(names, ['account', 'contact']);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('loadTemplates returns empty array when _templates/ does not exist', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-notmpl-'));
        assert.deepEqual(loadTemplates(root), []);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('getTemplateForType returns the matching template', () => {
        const root = makeTmpVault({
            'contact.md': '---\nid:\ntype: contact\nemail:\nrole:\n---\n',
            'account.md': '---\nid:\ntype: account\nstatus:\n---\n'
        });
        const t = getTemplateForType(root, 'contact');
        assert.ok(t);
        assert.equal(t.type, 'contact');
        assert.deepEqual(t.fields, ['email', 'role']);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('getTemplateForType returns null for unknown type', () => {
        const root = makeTmpVault({
            'contact.md': '---\nid:\ntype: contact\nemail:\n---\n'
        });
        assert.equal(getTemplateForType(root, 'research'), null);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('getTemplateDrift identifies notes missing template fields', () => {
        const root = makeTmpVault({
            'contact.md': '---\nid:\ntype: contact\nemail:\nrole:\naccount:\n---\n'
        });
        const fieldsCache = new Map([
            ['alvaro-gonzalez', { type: 'contact', email: 'alvaro@test.cl', role: 'director' }],
            ['pedro-ruiz', { type: 'contact', email: 'pedro@test.cl' }]
        ]);
        const drift = getTemplateDrift(root, fieldsCache);
        assert.equal(drift.length, 2);
        const alvaro = drift.find(d => d.noteId === 'alvaro-gonzalez');
        assert.ok(alvaro);
        assert.deepEqual(alvaro.missingFields, ['account']);
        const pedro = drift.find(d => d.noteId === 'pedro-ruiz');
        assert.ok(pedro);
        assert.ok(pedro.missingFields.includes('role'));
        assert.ok(pedro.missingFields.includes('account'));
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('getTemplateDrift ignores notes whose type has no template', () => {
        const root = makeTmpVault({
            'contact.md': '---\nid:\ntype: contact\nemail:\n---\n'
        });
        const fieldsCache = new Map([
            ['gonsa', { type: 'account', status: 'prospect' }]
        ]);
        assert.deepEqual(getTemplateDrift(root, fieldsCache), []);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('getTemplateDrift skips schema/template/dashboard type notes', () => {
        const root = makeTmpVault({
            'schema.md': '---\nid:\ntype: schema\ntarget:\n---\n'
        });
        const fieldsCache = new Map([
            ['my-schema', { type: 'schema', target: 'contact' }]
        ]);
        assert.deepEqual(getTemplateDrift(root, fieldsCache), []);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('getTemplateDrift returns empty when note has all template fields', () => {
        const root = makeTmpVault({
            'contact.md': '---\nid:\ntype: contact\nemail:\nrole:\n---\n'
        });
        const fieldsCache = new Map([
            ['full-contact', { type: 'contact', email: 'x@x.com', role: 'ceo' }]
        ]);
        assert.deepEqual(getTemplateDrift(root, fieldsCache), []);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('summarizeTemplateDrift groups by type with counts', () => {
        const drift = [
            { type: 'contact', noteId: 'a', missingFields: ['email'] },
            { type: 'contact', noteId: 'b', missingFields: ['role', 'email'] },
            { type: 'account', noteId: 'c', missingFields: ['status'] }
        ];
        const summary = summarizeTemplateDrift(drift);
        assert.equal(summary.size, 2);
        assert.equal(summary.get('contact').driftCount, 2);
        assert.equal(summary.get('account').driftCount, 1);
        assert.equal(summary.get('contact').notes.length, 2);
    });

    describe('buildTemplateFromNote', () => {
        test('preserves type, blanks id, and blanks scalar values', () => {
            const note = [
                '---',
                'id: acme-inc',
                'type: account',
                'name: Acme Inc',
                'status: active',
                '---',
                ''
            ].join('\n');
            const result = buildTemplateFromNote(note);
            assert.match(result, /^---\nid:\ntype: account\nname: \nstatus: \n---\n/);
        });

        test('blanks a single-line wikilink value to [[]]', () => {
            const note = '---\nid: bob-jones\ntype: contact\naccount: [[acme-inc]]\n---\n';
            const result = buildTemplateFromNote(note);
            assert.match(result, /account: \[\[\]\]/);
        });

        test('collapses a YAML block-list relation field to a single blank placeholder item', () => {
            const note = [
                '---', 'id: enotria', 'type: account', 'name: Enotria',
                'contacts:',
                '  - [[theo-theodorou]]',
                '  - [[cesar-gutierrez]]',
                '  - [[edith-santos]]',
                '---', ''
            ].join('\n');
            const result = buildTemplateFromNote(note);
            const lines = result.split('\n');
            const contactsIdx = lines.indexOf('contacts:');
            assert.ok(contactsIdx !== -1, 'contacts: key preserved');
            assert.equal(lines[contactsIdx + 1], '  - [[]]');
            assert.equal(lines[contactsIdx + 2], '---', 'no leftover real list items after the placeholder');
        });

        test('blanks a non-wikilink block-list field to a blank list item', () => {
            const note = [
                '---', 'id: mission-1', 'type: mission',
                'tags:',
                '  - urgent',
                '  - offworld',
                '---', ''
            ].join('\n');
            const result = buildTemplateFromNote(note);
            const lines = result.split('\n');
            const tagsIdx = lines.indexOf('tags:');
            assert.equal(lines[tagsIdx + 1], '  - ');
        });

        test('keeps body heading structure and drops prose', () => {
            const note = [
                '---', 'id: rico', 'type: character', '---',
                '',
                '## Summary',
                'Some real prose specific to this note.',
                '',
                '## Next Steps',
                '- a real action item',
                ''
            ].join('\n');
            const result = buildTemplateFromNote(note);
            assert.match(result, /## Summary\n## Next Steps/);
            assert.doesNotMatch(result, /Some real prose/);
            assert.doesNotMatch(result, /a real action item/);
        });

        test('a note with no body produces a template with a trailing blank line, no headings section', () => {
            const note = '---\nid: x\ntype: note\n---\n';
            const result = buildTemplateFromNote(note);
            assert.equal(result, '---\nid:\ntype: note\n---\n\n');
        });
    });

    describe('saveTemplateFile', () => {
        test('writes a new template file for a type with no existing template', () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-savetmpl-'));
            const filePath = saveTemplateFile(root, 'contact', '---\nid:\ntype: contact\n---\n');
            assert.ok(fs.existsSync(filePath));
            assert.equal(path.basename(filePath), 'contact.md');
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('refuses to overwrite an existing template without force', () => {
            const root = makeTmpVault({ 'contact.md': '---\nid:\ntype: contact\nhand-authored: true\n---\n' });
            assert.throws(
                () => saveTemplateFile(root, 'contact', '---\nid:\ntype: contact\n---\n'),
                /already exists/
            );
            const untouched = fs.readFileSync(path.join(root, '_templates', 'contact.md'), 'utf8');
            assert.match(untouched, /hand-authored: true/);
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('overwrites an existing template when force is set', () => {
            const root = makeTmpVault({ 'contact.md': '---\nid:\ntype: contact\nold-field:\n---\n' });
            saveTemplateFile(root, 'contact', '---\nid:\ntype: contact\nnew-field:\n---\n', { force: true });
            const updated = fs.readFileSync(path.join(root, '_templates', 'contact.md'), 'utf8');
            assert.match(updated, /new-field:/);
            assert.doesNotMatch(updated, /old-field:/);
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('creates the _templates/ directory if it does not exist yet', () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-notmpldir-'));
            saveTemplateFile(root, 'account', '---\nid:\ntype: account\n---\n');
            assert.ok(fs.existsSync(path.join(root, '_templates', 'account.md')));
            fs.rmSync(root, { recursive: true, force: true });
        });
    });
});
