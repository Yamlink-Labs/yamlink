'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
    buildOutlineModel,
    buildOutlineFilterMessage,
    filterOutlineRoots,
    findActiveNode,
    getNodePath,
    getSiblingNode,
    isNodeInPath,
    nodeMatchesOutlineFilters,
    slugify
} = require('../src/features/noteOutline');

describe('note outline', () => {
    test('builds nested outline nodes from heading depth', () => {
        const text = [
            '---',
            'id: long-note',
            'type: dossier',
            '---',
            '# Overview',
            'Intro text',
            '## Evidence',
            'Detail here',
            '### Witnesses',
            'More detail',
            '## Timeline',
            'Later section'
        ].join('\n');

        const model = buildOutlineModel(text);
        assert.equal(model.roots.length, 1);
        assert.equal(model.roots[0].heading.text, 'Overview');
        assert.equal(model.roots[0].children.length, 2);
        assert.equal(model.roots[0].children[0].heading.text, 'Evidence');
        assert.equal(model.roots[0].children[0].children[0].heading.text, 'Witnesses');
        assert.equal(model.roots[0].children[1].heading.text, 'Timeline');
    });

    test('computes section metrics for tasks, mentions, words, and snippets', () => {
        const text = [
            '# Worklog',
            '- [ ] Review [[johnny-rico]]',
            'This section mentions [[carmen-ibanez]] too.',
            '',
            '## Done',
            'Finished already.'
        ].join('\n');

        const model = buildOutlineModel(text, {
            anchorCounts: new Map([[slugify('Worklog'), 3]])
        });

        const worklog = model.roots[0];
        assert.equal(worklog.metrics.anchorLinks, 3);
        assert.equal(worklog.metrics.taskCount, 1);
        assert.equal(worklog.metrics.mentionCount, 2);
        assert.ok(worklog.metrics.wordCount >= 7);
        assert.match(worklog.metrics.snippet, /Review \[\[johnny-rico\]\]/);
    });

    test('ignores frontmatter and supports notes without headings', () => {
        const noHeadings = buildOutlineModel([
            '---',
            'id: flat-note',
            'type: memo',
            '---',
            'Plain body only'
        ].join('\n'));

        assert.equal(noHeadings.roots.length, 0);
        assert.equal(noHeadings.nodes.length, 0);
    });

    test('finds the current node and keeps only its branch as the active path', () => {
        const text = [
            '# Mission',
            'Lead in',
            '## Evidence',
            'Detail',
            '### Witnesses',
            'Inside active section',
            '## Timeline',
            'Elsewhere'
        ].join('\n');

        const model = buildOutlineModel(text);
        const activeNode = findActiveNode(model.nodes, 5);
        assert.equal(activeNode.heading.text, 'Witnesses');

        const path = getNodePath(activeNode).map(node => node.heading.text);
        assert.deepEqual(path, ['Mission', 'Evidence', 'Witnesses']);
        assert.equal(isNodeInPath(model.roots[0], activeNode), true);
        assert.equal(isNodeInPath(model.roots[0].children[1], activeNode), false);
    });

    test('jumps between sibling sections at the same depth', () => {
        const text = [
            '# Mission',
            '## Evidence',
            'Evidence details',
            '## Timeline',
            'Timeline details',
            '## Outcomes',
            'Outcome details'
        ].join('\n');

        const model = buildOutlineModel(text);
        const timeline = model.roots[0].children[1];
        assert.equal(getSiblingNode(timeline, -1).heading.text, 'Evidence');
        assert.equal(getSiblingNode(timeline, 1).heading.text, 'Outcomes');
        assert.equal(getSiblingNode(model.roots[0], 1), null);
    });

    test('filters outline by search while preserving ancestor path', () => {
        const text = [
            '# Mission',
            '## Evidence',
            'Witness briefing',
            '### Witnesses',
            'Named witness account',
            '## Timeline',
            'Sequence data'
        ].join('\n');

        const model = buildOutlineModel(text);
        const filtered = filterOutlineRoots(model.roots, { query: 'witness' });
        assert.equal(filtered.length, 1);
        assert.equal(filtered[0].heading.text, 'Mission');
        assert.equal(filtered[0].children.length, 1);
        assert.equal(filtered[0].children[0].heading.text, 'Evidence');
    });

    test('filters outline by tasks, mentions, and linked signals', () => {
        const text = [
            '# Mission',
            '- [ ] Check [[johnny-rico]]',
            '## Plain',
            'No special signals'
        ].join('\n');

        const model = buildOutlineModel(text, {
            anchorCounts: new Map([[slugify('Mission'), 2]])
        });
        const mission = model.roots[0];
        const plain = mission.children[0];

        assert.equal(nodeMatchesOutlineFilters(mission, { tasksOnly: true }), true);
        assert.equal(nodeMatchesOutlineFilters(mission, { mentionsOnly: true }), true);
        assert.equal(nodeMatchesOutlineFilters(mission, { linkedOnly: true }), true);
        assert.equal(nodeMatchesOutlineFilters(plain, { tasksOnly: true }), false);
    });

    test('builds a readable filter message', () => {
        assert.equal(
            buildOutlineFilterMessage({
                query: 'timeline',
                tasksOnly: true,
                mentionsOnly: false,
                linkedOnly: true
            }),
            '"timeline" · tasks · linked'
        );
    });
});
