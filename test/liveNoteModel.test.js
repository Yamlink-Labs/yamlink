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
        // Tasks show a done/total ratio, not a raw count — one open task,
        // zero done, out of one total.
        assert.equal(model.metrics.find((entry) => entry.label === 'tasks').value, '0/1');
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

    test('empty frontmatter fields are excluded from the pill row entirely', () => {
        const text = [
            '---',
            'id: johnny-rico',
            'type: character',
            'name: Johnny Rico',
            'gender:',
            'status: ',
            '---',
            '',
            'Body.'
        ].join('\n');

        const model = buildLiveNoteModel(text, '/vault/johnny-rico.md', 'johnny-rico');
        const keys = model.frontmatter.map((entry) => entry.key);
        assert.ok(keys.includes('name'));
        assert.ok(!keys.includes('gender'), 'blank field should not appear as a pill');
        assert.ok(!keys.includes('status'), 'whitespace-only field should not appear as a pill');
    });

    test('metric chips omit zero-value metrics instead of showing a bare zero', () => {
        const text = [
            '---',
            'id: bare-note',
            'type: note',
            '---',
            '',
            '# Just a heading',
            '',
            'No links, no tasks, no views here.'
        ].join('\n');

        const model = buildLiveNoteModel(text, '/vault/bare-note.md', 'bare-note');
        const labels = model.metrics.map((entry) => entry.label);
        assert.ok(labels.includes('fields'));
        assert.ok(labels.includes('sections'));
        assert.ok(!labels.includes('links'), 'zero links should not produce a metric chip');
        assert.ok(!labels.includes('tasks'), 'zero tasks should not produce a metric chip');
        assert.ok(!labels.includes('views'), 'zero views should not produce a metric chip');
    });

    test('task list items become click-to-source targets, marked done or open', () => {
        const text = [
            '---',
            'id: johnny-rico',
            'type: character',
            '---',
            '',
            '- [ ] Open task',
            '- [x] Done task',
            '- Plain bullet, not a task'
        ].join('\n');

        const model = buildLiveNoteModel(text, '/vault/johnny-rico.md', 'johnny-rico');
        assert.match(model.renderedHtml, /class="yl-live-task" data-source-line="5"/);
        assert.match(model.renderedHtml, /class="yl-live-task yl-live-task--done" data-source-line="6"/);
        // The plain bullet must survive untouched — no task class, no
        // source-line attribute grafted onto content that was never a task.
        assert.match(model.renderedHtml, /<li>Plain bullet, not a task<\/li>/);
    });
});
