'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    extractHeadingsFromText,
    countBlockquoteLines,
    extractFootnoteDefinitions,
    extractFootnoteReferences,
    collectUndefinedFootnoteReferences,
    collectBodySignals,
    buildBodySignalHints
} = require('../src/intelligence/bodySignals');
const {
    extractNoteRoleHints
} = require('../src/features/completionContextHelpers');

function makeDocument(text) {
    return {
        getText() {
            return text;
        },
        uri: {
            fsPath: '/vault/research-note.md'
        }
    };
}

describe('body signals', () => {
    test('extracts headings from markdown body without frontmatter noise', () => {
        const headings = extractHeadingsFromText([
            '---',
            'id: mission-note',
            '---',
            '# Overview',
            '## Evidence',
            '### References'
        ].join('\n'));
        assert.deepEqual(headings, ['Overview', 'Evidence', 'References']);
    });

    test('counts blockquote lines and footnotes', () => {
        const text = [
            '# Notes',
            '> Quoted source line one',
            '> Quoted source line two',
            '',
            'Claim with support[^alpha] and more support[^beta].',
            '',
            '[^alpha]: First source',
            '[^beta]: Second source'
        ].join('\n');

        assert.equal(countBlockquoteLines(text), 2);
        assert.deepEqual(extractFootnoteDefinitions(text).sort(), ['alpha', 'beta']);
        assert.deepEqual(extractFootnoteReferences(text).sort(), ['alpha', 'beta']);
        assert.deepEqual(collectUndefinedFootnoteReferences(text), []);
    });

    test('finds referenced footnotes that are still missing definitions', () => {
        const text = [
            'Claim with support[^alpha] and missing support[^beta].',
            '',
            '[^alpha]: First source'
        ].join('\n');

        assert.deepEqual(collectUndefinedFootnoteReferences(text), ['beta']);
    });

    test('builds longform hints from headings, quotes, and footnotes', () => {
        const signals = collectBodySignals([
            '# Evidence',
            '> cited excerpt',
            '> another cited excerpt',
            'Paragraph with support[^s1]',
            '',
            '[^s1]: source detail'
        ].join('\n'));

        const hints = buildBodySignalHints(signals);
        assert.ok(hints.includes('Evidence'));
        assert.ok(hints.includes('source'));
        assert.ok(hints.includes('references'));
        assert.ok(hints.includes('research'));
    });

    test('feeds longform signals into note role hints', () => {
        const doc = makeDocument([
            '---',
            'id: source-note',
            '---',
            '# Overview',
            '## References',
            '> source excerpt',
            '> second source excerpt',
            'Claim[^s1]',
            '',
            '[^s1]: citation'
        ].join('\n'));

        const hints = extractNoteRoleHints(doc, {});
        assert.ok(hints.includes('Overview'));
        assert.ok(hints.includes('References'));
        assert.ok(hints.includes('source'));
        assert.ok(hints.includes('references'));
        assert.ok(hints.includes('research'));
    });
});
