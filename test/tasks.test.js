'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { parseTasksFromContent } = require('../src/core/tasks');

const NOTE_PREFIX = '---\nid: test-note\ntype: note\n---\n\n';

function parse(body, fileId = 'test-note', filePath = '/vault/test-note.md') {
    return parseTasksFromContent(NOTE_PREFIX + body, fileId, filePath);
}

describe('tasks — parseTasksFromContent', () => {

    test('parses a simple open task', () => {
        const tasks = parse('- [ ] Follow up with Rico');
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].done, false);
        assert.match(tasks[0].text, /Follow up with Rico/);
    });

    test('parses a completed task', () => {
        const tasks = parse('- [x] Send report');
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].done, true);
    });

    test('uppercase X also marks done', () => {
        const tasks = parse('- [X] Archive files');
        assert.equal(tasks[0].done, true);
    });

    test('returns empty array when no tasks exist', () => {
        const tasks = parse('Just a paragraph with no tasks.');
        assert.equal(tasks.length, 0);
    });

    test('parses multiple tasks from the same note', () => {
        const body = [
            '- [ ] Task one',
            '- [x] Task two done',
            '- [ ] Task three'
        ].join('\n');
        const tasks = parse(body);
        assert.equal(tasks.length, 3);
    });

    test('extracts ISO date from task text', () => {
        const tasks = parse('- [ ] Follow up 2026-06-15');
        assert.equal(tasks[0].date, '2026-06-15');
    });

    test('displayText strips @-prefixed date markers', () => {
        const tasks = parse('- [ ] Follow up @2026-06-15');
        assert.doesNotMatch(tasks[0].displayText, /2026-06-15/);
        assert.match(tasks[0].displayText, /Follow up/);
    });

    test('task with no date has falsy date field', () => {
        const tasks = parse('- [ ] Write docs');
        assert.ok(!tasks[0].date, `expected falsy, got "${tasks[0].date}"`);
    });

    test('extracts wikilinks from task text', () => {
        const tasks = parse('- [ ] Meet with [[carmen-ibanez]] about [[mission-klendathu]]');
        assert.deepEqual(tasks[0].links, ['carmen-ibanez', 'mission-klendathu']);
    });

    test('task with no wikilinks has empty links array', () => {
        const tasks = parse('- [ ] Write tests');
        assert.deepEqual(tasks[0].links, []);
    });

    test('assigns fileId and filePath to each task', () => {
        const tasks = parseTasksFromContent(NOTE_PREFIX + '- [ ] Test task', 'my-note', '/vault/my-note.md');
        assert.equal(tasks[0].fileId, 'my-note');
        assert.equal(tasks[0].filePath, '/vault/my-note.md');
    });

    test('task id is unique per task within a file', () => {
        const body = '- [ ] Task A\n- [ ] Task B\n- [ ] Task C';
        const tasks = parse(body);
        const ids = tasks.map(t => t.id);
        assert.equal(new Set(ids).size, 3);
    });

    test('task id includes the fileId prefix', () => {
        const tasks = parseTasksFromContent(NOTE_PREFIX + '- [ ] Task', 'rico', '/vault/rico.md');
        assert.match(tasks[0].id, /^rico#/);
    });

    test('collects indented body lines after task', () => {
        const body = [
            '- [ ] Main task',
            '  Context for this task',
            '  More context'
        ].join('\n');
        const tasks = parse(body);
        assert.match(tasks[0].body, /Context for this task/);
    });

    test('body collection stops at blank line', () => {
        const body = [
            '- [ ] Main task',
            '  Context line',
            '',
            '  After blank — should not be included'
        ].join('\n');
        const tasks = parse(body);
        assert.ok(tasks[0].body.includes('Context line'));
    });

    test('fields object has text, done, file, line keys', () => {
        const tasks = parse('- [ ] Sample task');
        const f = tasks[0].fields;
        assert.ok('text' in f);
        assert.ok('done' in f);
        assert.ok('file' in f);
        assert.ok('line' in f);
    });

    test('nodeType is always "tasks"', () => {
        const tasks = parse('- [ ] Task');
        assert.equal(tasks[0].nodeType, 'tasks');
    });

    test('ignores non-task list items', () => {
        const body = '- [ ] Real task\n- Regular list item\n- Another item';
        const tasks = parse(body);
        assert.equal(tasks.length, 1);
    });

    test('ignores tasks inside frontmatter block', () => {
        const content = '---\nid: test\ntype: note\n---\n- [ ] Body task';
        const tasks = parseTasksFromContent(content, 'test', '/test.md');
        assert.equal(tasks.length, 1);
        assert.match(tasks[0].text, /Body task/);
    });
});
