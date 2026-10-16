'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    extractMeaningfulBodyBlocks,
    findBodyBlockInLineRange,
    formatBlockReference,
    normalizeAnchorText,
    foldDiacritics
} = require('../src/core/bodyBlocks');

describe('normalizeAnchorText / foldDiacritics — accent-insensitive anchor matching', () => {
    test('foldDiacritics strips combining diacriticals, matching id.js\'s own canonicalizeId approach', () => {
        assert.equal(foldDiacritics('Monopólio'), 'Monopolio');
        assert.equal(foldDiacritics('Múltiples órganos'), 'Multiples organos');
        assert.equal(foldDiacritics('Niño'), 'Nino');
        assert.equal(foldDiacritics(''), '');
    });

    test('normalizeAnchorText treats an accented heading and its unaccented reference as the same anchor — a real, reported gap for Spanish/Portuguese/French-language vaults', () => {
        assert.equal(normalizeAnchorText('Monopólio'), normalizeAnchorText('Monopolio'));
        assert.equal(normalizeAnchorText('Múltiples Órganos'), normalizeAnchorText('Multiples Organos'));
    });

    test('normalizeAnchorText is otherwise unchanged — case/whitespace/punctuation folding still works exactly as before', () => {
        assert.equal(normalizeAnchorText('Hello World!'), normalizeAnchorText('hello-world'));
        assert.equal(normalizeAnchorText('  Spaced  Out  '), 'spaced-out');
    });
});

describe('body blocks — extractMeaningfulBodyBlocks', () => {
    test('extracts headings, tasks, quotes, and footnotes as addressable blocks', () => {
        const text = [
            '---',
            'id: rico',
            'type: character',
            '---',
            '',
            '## Service Record',
            '',
            '- [ ] Review recon logs',
            '  Additional context',
            '',
            '> Training-yard line associated with Jean Rasczak.',
            '> Still quoted here.',
            '',
            '[^source-1]: Archive dossier'
        ].join('\n');

        const blocks = extractMeaningfulBodyBlocks(text);
        const ids = blocks.map((block) => block.blockId);

        assert.ok(ids.includes('h-service-record'));
        assert.ok(ids.some((id) => /^t1-/.test(id)));
        assert.ok(ids.some((id) => /^q1-/.test(id)));
        assert.ok(ids.includes('fn-source-1'));
    });

    test('extracts calc cells alongside headings, tasks, quotes, and footnotes with correct lines', () => {
        const text = [
            '---',
            'id: calc-note',
            '---',
            '',
            '# Calculations',
            '- [ ] Review totals',
            '',
            '`=1+2`',
            '`total=Y1+3`',
            '> Quote with context',
            '[^source]: Footnote text'
        ].join('\n');

        const blocks = extractMeaningfulBodyBlocks(text);
        assert.ok(blocks.some((block) => block.type === 'heading' && block.line === 4));
        assert.ok(blocks.some((block) => block.type === 'task' && block.line === 5));
        assert.ok(blocks.some((block) => block.type === 'quote' && block.line === 9));
        assert.ok(blocks.some((block) => block.type === 'footnote' && block.line === 10));

        const calcBlocks = blocks.filter((block) => block.type === 'calc');
        assert.deepEqual(
            calcBlocks.map((block) => ({ id: block.blockId, line: block.line, text: block.text })),
            [
                { id: 'Y1', line: 7, text: '1+2' },
                { id: 'Y2', line: 8, text: 'Y1+3' },
                { id: 'total', line: 8, text: 'Y1+3' }
            ]
        );
    });

    test('named calc cells are addressable by label and by name on the same line', () => {
        const blocks = extractMeaningfulBodyBlocks('Intro\n`total=1+2`').filter((block) => block.type === 'calc');

        assert.deepEqual(blocks.map((block) => block.blockId), ['Y1', 'total']);
        assert.equal(blocks[0].line, 1);
        assert.equal(blocks[1].line, 1);
        assert.equal(blocks[0].label, 'Y1 · total');
        assert.equal(blocks[1].label, 'Y1 · total');
    });

    test('unnamed calc cells are addressable only by their automatic label', () => {
        const blocks = extractMeaningfulBodyBlocks('`=1+2`').filter((block) => block.type === 'calc');

        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].blockId, 'Y1');
        assert.equal(blocks[0].label, 'Y1');
        assert.equal(blocks[0].text, '1+2');
    });

    test('failed calc cells are still addressable by label', () => {
        const blocks = extractMeaningfulBodyBlocks('`=Y9+1`').filter((block) => block.type === 'calc');

        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].blockId, 'Y1');
        assert.equal(blocks[0].text, 'Y9+1');
    });

    test('rejected calc names do not create a second name block', () => {
        const blocks = extractMeaningfulBodyBlocks('`Y1=1+2`').filter((block) => block.type === 'calc');

        assert.deepEqual(blocks.map((block) => block.blockId), ['Y1']);
    });

    // Real, previously-undiscovered bug, found while adapting the sample
    // vault: a CRLF-saved file (common on Windows) produced ZERO blocks at
    // all. Splitting on a bare '\n' left every line ending in a trailing
    // '\r', and the heading/task regexes anchor on $ (end of string) with a
    // `.` capture group — `.` never matches `\r`, so `(.+)$` could never be
    // satisfied and every heading/task line silently failed to match.
    test('extracts the same blocks from CRLF-joined content as LF-joined content', () => {
        const lines = [
            '---',
            'id: rico',
            'type: character',
            '---',
            '',
            '## Service Record',
            '',
            '- [ ] Review recon logs',
            '',
            '> Training-yard line associated with Jean Rasczak.',
            '',
            '[^source-1]: Archive dossier'
        ];

        const lfBlocks = extractMeaningfulBodyBlocks(lines.join('\n'));
        const crlfBlocks = extractMeaningfulBodyBlocks(lines.join('\r\n'));

        assert.ok(lfBlocks.length > 0);
        assert.deepEqual(
            crlfBlocks.map((b) => b.blockId),
            lfBlocks.map((b) => b.blockId)
        );
        assert.deepEqual(
            crlfBlocks.map((b) => b.line),
            lfBlocks.map((b) => b.line)
        );
    });

    test('calc cell line numbers are stable between LF and CRLF notes', () => {
        const lines = [
            '---',
            'id: calc-note',
            '---',
            '',
            '# Calculations',
            '',
            '`=1+2`',
            '`total=Y1+3`'
        ];

        const lfCalcBlocks = extractMeaningfulBodyBlocks(lines.join('\n')).filter((block) => block.type === 'calc');
        const crlfCalcBlocks = extractMeaningfulBodyBlocks(lines.join('\r\n')).filter((block) => block.type === 'calc');

        assert.deepEqual(
            crlfCalcBlocks.map((block) => ({ id: block.blockId, line: block.line })),
            lfCalcBlocks.map((block) => ({ id: block.blockId, line: block.line }))
        );
        assert.deepEqual(lfCalcBlocks.map((block) => block.line), [6, 7, 7]);
    });

    test('disambiguates duplicate heading slugs', () => {
        const text = [
            '# Overview',
            'Text',
            '## Overview'
        ].join('\n');

        const blocks = extractMeaningfulBodyBlocks(text).filter((block) => block.type === 'heading');
        assert.deepEqual(blocks.map((block) => block.blockId), ['h-overview', 'h-overview-2']);
    });

    test('findBodyBlockInLineRange prefers the narrower calc block inside a multi-line task', () => {
        const text = [
            '- [ ] Total: `=1+2`',
            '  continued task detail'
        ].join('\n');
        const blocks = extractMeaningfulBodyBlocks(text);
        const found = findBodyBlockInLineRange(blocks, 0);

        assert.equal(found.type, 'calc');
        assert.equal(found.blockId, 'Y1');
    });

    test('formatBlockReference treats calc blocks as ordinary caret block references', () => {
        const [calcBlock] = extractMeaningfulBodyBlocks('`=1+2`').filter((block) => block.type === 'calc');

        assert.equal(formatBlockReference('calc-note', calcBlock), '[[calc-note^Y1]]');
    });
});
