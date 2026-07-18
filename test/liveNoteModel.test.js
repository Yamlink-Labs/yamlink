'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildLiveNoteModel, buildLiveNoteBodyHtml } = require('../src/features/preview/liveNoteModel');

describe('live note model', () => {
    test('builds a live note model from frontmatter and body structure', () => {
        const text = [
            '---',
            'id: johnny-rico',
            'type: character',
            'name: Johnny Rico',
            'unit: [[roughnecks]]',
            '---',
            '',
            '# Overview',
            '',
            '- [ ] Review recon logs',
            '',
            'Linked to [[roughnecks]] and [[planet-p-assault]].',
            '',
            '!view mission',
            'select date, outcome'
        ].join('\n');

        // Forward slashes, not a Windows-style backslash path: path.basename()/
        // path.dirname() are platform-native (backslash isn't a separator on
        // POSIX), so a hardcoded 'C:\\...' path here would parse correctly on
        // Windows but produce a garbage title on Linux CI. Forward slashes are
        // valid path separators on both platforms.
        const model = buildLiveNoteModel(text, '/vault/johnny-rico.md', 'johnny-rico');

        assert.equal(model.title, 'johnny-rico');
        assert.equal(model.noteId, 'johnny-rico');
        assert.equal(model.noteType, 'character');
        assert.equal(model.frontmatter.find((entry) => entry.key === 'name').value, 'Johnny Rico');
        assert.equal(model.frontmatter.find((entry) => entry.key === 'name').line, 3);
        assert.equal(model.metrics.find((entry) => entry.label === 'fields').value, '4');
        assert.equal(model.metrics.find((entry) => entry.label === 'links').value, '2');
        assert.equal(model.metrics.find((entry) => entry.label === 'tasks').value, '1');
        assert.equal(model.metrics.find((entry) => entry.label === 'views').value, '1');
        assert.equal(model.metrics.find((entry) => entry.label === 'sections').value, '1');
        assert.ok(model.renderedHtml.includes('view-block'));
        assert.ok(model.renderedHtml.includes('data-source-line="7"'));
        assert.ok(model.renderedHtml.includes('data-source-line="13"'));
    });

    test('builds live note body html with identity pills and rendered body', () => {
        const html = buildLiveNoteBodyHtml({
            title: 'johnny-rico',
            noteId: 'johnny-rico',
            noteType: 'character',
            metrics: [
                { label: 'fields', value: '4' },
                { label: 'links', value: '3' }
            ],
            frontmatter: [
                { key: 'name', value: 'Johnny Rico', line: 3 },
                { key: 'unit', value: '[[roughnecks]]' }
            ],
            renderedHtml: '<p>Rendered body</p>'
        });

        assert.ok(html.includes('Live note'));
        assert.ok(html.includes('johnny-rico'));
        assert.ok(html.includes('Johnny Rico'));
        assert.ok(html.includes('Rendered body'));
        assert.ok(html.includes('data-source-line="3"'));
    });
});
