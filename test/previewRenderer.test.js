'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { renderNotePreview } = require('../src/features/preview/previewRenderer');

describe('preview renderer footnotes', () => {
    test('renders footnote references and footnote section instead of raw definitions', () => {
        const text = [
            '---',
            'id: test-note',
            'type: note',
            'title: Test Note',
            '---',
            '',
            'Claim with support[^source-1].',
            '',
            '[^source-1]: Training-yard line associated with [[jean-rasczak]].'
        ].join('\n');

        const html = renderNotePreview(text, 'test-note');

        assert.ok(html.includes('yl-footnotes'));
        assert.ok(html.includes('href="#yl-fn-source-1"'));
        assert.ok(html.includes('Training-yard line associated with'));
        assert.ok(!html.includes('[^source-1]:'));
    });
});
