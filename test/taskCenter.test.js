'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
    classifyTaskStatus,
    groupTasks,
    priorityRank,
    buildTaskLabel,
    buildGroupLabel,
    buildTaskCenterMessage,
    buildTaskChildrenForGroup,
    filterTaskGroups,
    describeFilterState,
    buildTaskCenterStatus,
    getTaskIcon
} = require('../src/features/taskCenter');

const TODAY = '2026-07-16';

// Minimal fake vscode — getTaskIcon/getGroupIcon take vscode as an explicit
// parameter rather than requiring it at module scope, so a real ThemeIcon/
// ThemeColor class isn't needed, just something that records what was asked for.
const fakeVscode = {
    ThemeIcon: class ThemeIcon {
        constructor(id, color) { this.id = id; this.color = color; }
    },
    ThemeColor: class ThemeColor {
        constructor(id) { this.id = id; }
    }
};

describe('taskCenter — classifyTaskStatus', () => {
    test('done tasks are always "done" regardless of date', () => {
        assert.equal(classifyTaskStatus({ done: true, date: '2026-01-01' }, TODAY), 'done');
        assert.equal(classifyTaskStatus({ done: true, date: '' }, TODAY), 'done');
    });

    test('no date and not done is "undated"', () => {
        assert.equal(classifyTaskStatus({ done: false, date: '' }, TODAY), 'undated');
        assert.equal(classifyTaskStatus({ done: false }, TODAY), 'undated');
    });

    test('date before today, not done, is "overdue"', () => {
        assert.equal(classifyTaskStatus({ done: false, date: '2026-07-15' }, TODAY), 'overdue');
        assert.equal(classifyTaskStatus({ done: false, date: '2020-01-01' }, TODAY), 'overdue');
    });

    test('date exactly today is "today"', () => {
        assert.equal(classifyTaskStatus({ done: false, date: TODAY }, TODAY), 'today');
    });

    test('date after today is "upcoming", with no cap on how far out', () => {
        assert.equal(classifyTaskStatus({ done: false, date: '2026-07-17' }, TODAY), 'upcoming');
        assert.equal(classifyTaskStatus({ done: false, date: '2027-01-01' }, TODAY), 'upcoming');
    });
});

describe('taskCenter — groupTasks', () => {
    test('groups are returned in fixed order and omit empty buckets', () => {
        const tasks = [
            { fileId: 'a', done: false, date: '2026-07-15' }, // overdue
            { fileId: 'b', done: false, date: TODAY }          // today
        ];
        const groups = groupTasks(tasks, TODAY);
        assert.deepEqual(groups.map((g) => g.status), ['overdue', 'today']);
    });

    test('full fixed order when every bucket is populated: overdue, today, upcoming, undated, done', () => {
        const tasks = [
            { fileId: 'done1', done: true, date: '2026-01-01' },
            { fileId: 'undated1', done: false, date: '' },
            { fileId: 'upcoming1', done: false, date: '2026-08-01' },
            { fileId: 'today1', done: false, date: TODAY },
            { fileId: 'overdue1', done: false, date: '2026-07-01' }
        ];
        const groups = groupTasks(tasks, TODAY);
        assert.deepEqual(groups.map((g) => g.status), ['overdue', 'today', 'upcoming', 'undated', 'done']);
    });

    test('tasks within a bucket are sorted by date ascending, then fileId', () => {
        const tasks = [
            { fileId: 'z', done: false, date: '2026-08-05' },
            { fileId: 'a', done: false, date: '2026-08-01' },
            { fileId: 'm', done: false, date: '2026-08-01' }
        ];
        const groups = groupTasks(tasks, TODAY);
        const upcoming = groups.find((g) => g.status === 'upcoming');
        assert.deepEqual(upcoming.tasks.map((t) => t.fileId), ['a', 'm', 'z']);
    });

    test('empty task list produces no groups', () => {
        assert.deepEqual(groupTasks([], TODAY), []);
    });
});

describe('taskCenter — buildTaskLabel', () => {
    test('uses displayText when present, falls back to text', () => {
        assert.equal(buildTaskLabel({ displayText: 'Write the report', text: 'Write the report @today' }).label, 'Write the report');
        assert.equal(buildTaskLabel({ text: 'Call Carmen' }).label, 'Call Carmen');
    });

    test('falls back to a placeholder for an empty task', () => {
        assert.equal(buildTaskLabel({}).label, '(empty task)');
    });

    test('description carries a human due-state plus source note context', () => {
        assert.equal(
            buildTaskLabel({ text: 'x', date: '2026-08-01', fileId: 'mission-briefing' }, TODAY).description,
            'in 16d · mission-briefing'
        );
        assert.equal(
            buildTaskLabel({ text: 'x' }, TODAY).description,
            'no date'
        );
    });

    test('tooltip includes the label, due state, source note id, and body when present', () => {
        const tooltip = buildTaskLabel({
            text: 'Call Carmen',
            date: '2026-08-01',
            fileId: 'mission-briefing',
            body: 'Check the recon numbers first.'
        }, TODAY).tooltip;
        assert.match(tooltip, /Call Carmen/);
        assert.match(tooltip, /2026-08-01/);
        assert.match(tooltip, /in 16d/);
        assert.match(tooltip, /mission-briefing/);
        assert.match(tooltip, /Check the recon numbers first\./);
    });

    test('today and overdue tasks get stronger urgency descriptions', () => {
        assert.equal(buildTaskLabel({ text: 'x', date: TODAY }, TODAY).description, 'today');
        assert.equal(buildTaskLabel({ text: 'x', date: '2026-07-10' }, TODAY).description, '6d overdue');
    });

    test('done tasks are marked as complete in the description', () => {
        assert.equal(
            buildTaskLabel({ text: 'x', done: true, date: '2026-08-01', fileId: 'mission-briefing' }, TODAY).description,
            'done · mission-briefing'
        );
    });
});

describe('taskCenter — buildGroupLabel', () => {
    test('bucket headers carry a plain-language description', () => {
        assert.deepEqual(
            buildGroupLabel({ status: 'overdue', label: 'Overdue', tasks: [{}, {}] }),
            { label: 'Overdue', description: '2 attention' }
        );
        assert.deepEqual(
            buildGroupLabel({ status: 'today', label: 'Today', tasks: [{}] }),
            { label: 'Today', description: '1 due today' }
        );
        assert.deepEqual(
            buildGroupLabel({ status: 'done', label: 'Done', tasks: [{}, {}, {}] }),
            { label: 'Done', description: '3 completed' }
        );
    });
});

describe('taskCenter — buildTaskCenterMessage', () => {
    test('builds a compact summary for the visible buckets', () => {
        const groups = groupTasks([
            { fileId: 'a', done: false, date: '2026-07-15' },
            { fileId: 'b', done: false, date: TODAY },
            { fileId: 'c', done: false, date: '' }
        ], TODAY);
        assert.equal(buildTaskCenterMessage(groups), 'Overdue 1 · Today 1 · Undated 1');
    });

    test('returns a friendly empty state when there are no tasks', () => {
        assert.equal(buildTaskCenterMessage([]), 'No tasks found in this workspace.');
    });
});

describe('taskCenter — group children', () => {
    test('large undated buckets show a triage row instead of dumping every task by default', () => {
        const tasks = Array.from({ length: 8 }, (_, index) => ({ fileId: `task-${index + 1}`, done: false, date: '' }));
        const children = buildTaskChildrenForGroup({ kind: 'group', status: 'undated', label: 'Undated', tasks });
        assert.equal(children.length, 6);
        assert.deepEqual(children.slice(0, 5).map((child) => child.kind), ['task', 'task', 'task', 'task', 'task']);
        assert.deepEqual(children[5], { kind: 'more', hidden: 3 });
    });

    test('show all mode returns every undated task', () => {
        const tasks = Array.from({ length: 8 }, (_, index) => ({ fileId: `task-${index + 1}`, done: false, date: '' }));
        const children = buildTaskChildrenForGroup({ kind: 'group', status: 'undated', label: 'Undated', tasks }, true);
        assert.equal(children.length, 8);
        assert.deepEqual(children.map((child) => child.kind), Array(8).fill('task'));
    });
});

describe('taskCenter — filter state', () => {
    test('open mode hides done tasks', () => {
        const groups = groupTasks([
            { fileId: 'a', done: false, date: '2026-07-15' },
            { fileId: 'b', done: true, date: '2026-07-01' }
        ], TODAY);
        assert.deepEqual(
            filterTaskGroups(groups, { mode: 'open', focusStatus: '' }).map((group) => group.status),
            ['overdue']
        );
    });

    test('attention mode keeps only overdue and today buckets', () => {
        const groups = groupTasks([
            { fileId: 'a', done: false, date: '2026-07-15' },
            { fileId: 'b', done: false, date: TODAY },
            { fileId: 'c', done: false, date: '2026-08-01' }
        ], TODAY);
        assert.deepEqual(
            filterTaskGroups(groups, { mode: 'attention', focusStatus: '' }).map((group) => group.status),
            ['overdue', 'today']
        );
    });

    test('focusStatus narrows the list to one bucket', () => {
        const groups = groupTasks([
            { fileId: 'a', done: false, date: '2026-07-15' },
            { fileId: 'b', done: false, date: TODAY }
        ], TODAY);
        assert.deepEqual(
            filterTaskGroups(groups, { mode: 'all', focusStatus: 'today' }).map((group) => group.status),
            ['today']
        );
    });

    test('status text reflects mode and summary together', () => {
        const groups = groupTasks([
            { fileId: 'a', done: false, date: '2026-07-15' },
            { fileId: 'b', done: false, date: TODAY }
        ], TODAY);
        assert.equal(describeFilterState({ mode: 'attention', focusStatus: 'overdue' }), 'Attention · Overdue');
        assert.equal(
            buildTaskCenterStatus(filterTaskGroups(groups, { mode: 'attention', focusStatus: '' }), { mode: 'attention', focusStatus: '' }),
            'Attention — Overdue 1 · Today 1'
        );
    });
});

describe('taskCenter — priority', () => {
    test('priorityRank orders urgent < medium < low < unprioritized', () => {
        assert.ok(priorityRank({ priority: 'urgent' }) < priorityRank({ priority: 'medium' }));
        assert.ok(priorityRank({ priority: 'medium' }) < priorityRank({ priority: 'low' }));
        assert.ok(priorityRank({ priority: 'low' }) < priorityRank({ priority: null }));
        assert.ok(priorityRank({}) === priorityRank({ priority: undefined }));
    });

    test('groupTasks sorts by priority first within a status bucket, date/fileId only breaking ties', () => {
        const tasks = [
            { fileId: 'low-task', done: false, date: '2026-07-01', priority: 'low' },
            { fileId: 'urgent-task', done: false, date: '2026-07-10', priority: 'urgent' }, // later date, still overdue
            { fileId: 'medium-task', done: false, date: '2026-07-05', priority: 'medium' },
            { fileId: 'unset-task', done: false, date: '2026-06-01', priority: null }
        ];
        const groups = groupTasks(tasks, TODAY);
        const overdue = groups.find((g) => g.status === 'overdue');
        assert.deepEqual(
            overdue.tasks.map((t) => t.fileId),
            ['urgent-task', 'medium-task', 'low-task', 'unset-task']
        );
    });

    test('buildTaskLabel leaves the label itself untouched by priority — color lives on the tree icon, not the text', () => {
        assert.equal(buildTaskLabel({ text: 'x', priority: 'urgent' }).label, 'x');
        assert.equal(buildTaskLabel({ text: 'x', priority: 'medium' }).label, 'x');
        assert.equal(buildTaskLabel({ text: 'x', priority: 'low' }).label, 'x');
        assert.equal(buildTaskLabel({ text: 'x' }).label, 'x');
    });

    test('the priority word appears in the tooltip but not the description — the dot color already carries it there, and repeating it crowded out due-state/source in a narrow sidebar', () => {
        const result = buildTaskLabel({ text: 'x', date: '2026-08-01', fileId: 'mission-briefing', priority: 'urgent' }, TODAY);
        assert.equal(result.description, 'in 16d · mission-briefing');
        assert.match(result.tooltip, /Priority: urgent/);
    });

    test('an unprioritized task has no priority word anywhere', () => {
        const result = buildTaskLabel({ text: 'x', date: '2026-08-01', fileId: 'mission-briefing' }, TODAY);
        assert.doesNotMatch(result.description, /priority/);
        assert.doesNotMatch(result.tooltip, /Priority:/);
    });

    test('getTaskIcon gives each priority level its own filled dot and color — no emoji, a real icon+color pair', () => {
        const urgent = getTaskIcon(fakeVscode, { priority: 'urgent' });
        const medium = getTaskIcon(fakeVscode, { priority: 'medium' });
        const low = getTaskIcon(fakeVscode, { priority: 'low' });
        const none = getTaskIcon(fakeVscode, {});

        assert.equal(urgent.id, 'circle-filled');
        assert.equal(urgent.color.id, 'problemsErrorIcon.foreground');
        assert.equal(medium.id, 'circle-filled');
        assert.equal(medium.color.id, 'problemsWarningIcon.foreground');
        assert.equal(low.id, 'circle-filled');
        assert.equal(low.color.id, 'descriptionForeground');
        assert.equal(none.id, 'circle-outline');
    });
});
