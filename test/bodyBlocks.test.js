'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { extractMeaningfulBodyBlocks } = require('../src/core/bodyBlocks');

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
});
