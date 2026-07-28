'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    parseFrontmatterDocument,
    setField,
    serializeFrontmatterDocument,
    writeFrontmatterFieldSurgically,
    resolveYamlFieldNameForLine
} = require('../src/core/frontmatter');

describe('frontmatter serialization', () => {
    test('keeps plain wikilink relation values unquoted', () => {
        const parsed = parseFrontmatterDocument([
            '---',
            'id: lexcorp',
            'type: account',
            'contact:',
            '---'
        ].join('\n'));

        const next = setField(parsed, 'contact', '[[lex-luthor]]');
        const text = serializeFrontmatterDocument(next);

        assert.match(text, /^contact: \[\[lex-luthor\]\]$/m);
        assert.doesNotMatch(text, /^contact: "\[\[lex-luthor\]\]"$/m);
    });
});

describe('coerceScalar — leading-zero guard', () => {
    test('leading-zero strings are preserved as strings', () => {
        const parsed = parseFrontmatterDocument('---\nid: test\n---');
        const next = setField(parsed, 'zip', '00123');
        assert.equal(next.data.zip, '00123');
        assert.equal(typeof next.data.zip, 'string');
    });

    test('normal numeric strings are coerced to numbers', () => {
        const parsed = parseFrontmatterDocument('---\nid: test\n---');
        const next = setField(parsed, 'priority', '3');
        assert.equal(next.data.priority, 3);
        assert.equal(typeof next.data.priority, 'number');
    });

    test('zero is coerced to number', () => {
        const parsed = parseFrontmatterDocument('---\nid: test\n---');
        const next = setField(parsed, 'count', '0');
        assert.equal(next.data.count, 0);
        assert.equal(typeof next.data.count, 'number');
    });

    test('decimal like 0.5 is coerced to number (no leading digit-after-zero)', () => {
        const parsed = parseFrontmatterDocument('---\nid: test\n---');
        const next = setField(parsed, 'ratio', '0.5');
        assert.equal(next.data.ratio, 0.5);
        assert.equal(typeof next.data.ratio, 'number');
    });
});

describe('writeFrontmatterFieldSurgically', () => {
    test('replaces an existing scalar field without touching other lines', () => {
        const content = '---\nid: my-note\nstatus: draft\ntype: note\n---\nbody\n';
        const result = writeFrontmatterFieldSurgically(content, 'status', 'done');
        assert.match(result, /^status: done$/m);
        assert.match(result, /^id: my-note$/m);
        assert.match(result, /^type: note$/m);
        assert.match(result, /body/);
    });

    test('preserves comments in frontmatter', () => {
        const content = '---\n# project notes\nid: my-note\nstatus: draft\n---\n';
        const result = writeFrontmatterFieldSurgically(content, 'status', 'active');
        assert.ok(result.includes('# project notes'));
        assert.match(result, /^status: active$/m);
    });

    test('appends a new field when it does not exist', () => {
        const content = '---\nid: my-note\ntype: note\n---\n';
        const result = writeFrontmatterFieldSurgically(content, 'status', 'draft');
        assert.match(result, /^status: draft$/m);
        assert.match(result, /^id: my-note$/m);
    });

    test('deletes a field when value is null', () => {
        const content = '---\nid: my-note\nstatus: draft\ntype: note\n---\n';
        const result = writeFrontmatterFieldSurgically(content, 'status', null);
        assert.doesNotMatch(result, /^status:/m);
        assert.match(result, /^id: my-note$/m);
    });

    test('keeps wikilink values unquoted', () => {
        const content = '---\nid: my-note\ncontact: [[old-contact]]\n---\n';
        const result = writeFrontmatterFieldSurgically(content, 'contact', '[[new-contact]]');
        assert.match(result, /^contact: \[\[new-contact\]\]$/m);
    });

    test('returns null for array values (triggers fallback)', () => {
        const content = '---\nid: my-note\n---\n';
        const result = writeFrontmatterFieldSurgically(content, 'tags', ['a', 'b']);
        assert.equal(result, null);
    });

    test('returns null when there is no frontmatter', () => {
        const content = 'just body text\n';
        const result = writeFrontmatterFieldSurgically(content, 'status', 'done');
        assert.equal(result, null);
    });

    test('returns null for multi-line (block) values', () => {
        const content = '---\nid: my-note\nnotes: |\n  line one\n  line two\n---\n';
        const result = writeFrontmatterFieldSurgically(content, 'notes', 'single');
        assert.equal(result, null);
    });
});

describe('resolveYamlFieldNameForLine', () => {
    test('resolves a single-line field directly from its own line', () => {
        const lines = ['---', 'id: enotria', 'type: account', 'owner: [[maria]]', '---'];
        assert.equal(resolveYamlFieldNameForLine(lines, 3), 'owner');
    });

    test('walks upward to find the parent key for a bare YAML list-item line', () => {
        const lines = [
            '---', 'id: enotria', 'type: account', 'name: Enotria', 'owner:', 'contacts:',
            '  - [[theo-theodorou]]', '  - [[cesar-gutierrez]]', '  - [[', '---'
        ];
        assert.equal(resolveYamlFieldNameForLine(lines, 8), 'contacts');
    });

    test('resolves correctly for the first list item, not just later ones', () => {
        const lines = ['---', 'id: enotria', 'type: account', 'contacts:', '  - [['];
        assert.equal(resolveYamlFieldNameForLine(lines, 4), 'contacts');
    });

    test('stops at the frontmatter boundary — never attributes to something outside it', () => {
        const lines = ['name: Something', '---', 'id: enotria', 'type: account', 'contacts:', '  - [['];
        // lineIndex 5 is inside frontmatter (index 1 is the opening ---); scanning
        // upward must stop at that boundary and not read line 0 as a real key.
        assert.equal(resolveYamlFieldNameForLine(lines, 5), 'contacts');
    });

    test('returns null when no parent key can be found (e.g. a list at the very top)', () => {
        const lines = ['---', '  - [['];
        assert.equal(resolveYamlFieldNameForLine(lines, 1), null);
    });

    test('returns null for an out-of-range line index', () => {
        const lines = ['---', 'id: x', '---'];
        assert.equal(resolveYamlFieldNameForLine(lines, 99), null);
        assert.equal(resolveYamlFieldNameForLine(lines, -1), null);
    });
});
