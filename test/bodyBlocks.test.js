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
