'use strict';

const { getIndex, getVaultGeneration } = require('../core/indexService');
const { buildTaskRows } = require('../core/tasks');
const { getTodayIsoLocal } = require('../core/date');

const STATUS_GROUPS = [
    { status: 'overdue', label: 'Overdue' },
    { status: 'today', label: 'Today' },
    { status: 'upcoming', label: 'Upcoming' },
    { status: 'undated', label: 'Undated' },
    { status: 'done', label: 'Done' }
];

const FILTER_MODES = ['all', 'open', 'attention'];

// Fixed, closed vocabulary — mirrors src/core/tasks.js's PRIORITY_ALIASES.
// Lower rank sorts first within a status bucket; unprioritized tasks (rank 3)
// sink to the bottom of their bucket rather than being scattered by date.
const PRIORITY_RANK = { urgent: 0, medium: 1, low: 2 };
// Colored circle emoji, not a ThemeColor — guarantees the task actually
// *looks* red/yellow/gray regardless of which VS Code theme is active,
// unlike ThemeColor tokens which resolve differently per theme and might
// not read clearly as "red" in every one of them.
const PRIORITY_LABEL = { urgent: 'urgent', medium: 'medium priority', low: 'low priority' };

/** @param {{priority?: string|null}} task @returns {number} */
function priorityRank(task) {
    const rank = PRIORITY_RANK[task?.priority];
    return rank === undefined ? 3 : rank;
}

/**
 * Classifies a single task into exactly one status bucket. Mirrors the same
 * date-comparison semantics `queryExecutor.js`'s `applyTaskPreset()` uses for
 * `!view overdue`/`today`/`upcoming` (done first, then date < today =
 * overdue, date === today = today, date > today = upcoming, no date =
 * undated) — deliberately not calling through to it, since that function
 * runs one preset check at a time against a differently-shaped row and would
 * need 4 passes per task for no real benefit here. Unlike the query preset
 * (`upcoming` capped at +13 days, meant for a small glanceable list), a task
 * due any number of days out still lands in "upcoming" — this view isn't
 * space-constrained the way Home's compact columns are.
 * @param {{done?: boolean, date?: string}} task
 * @param {string} [todayIso]
 * @returns {'overdue'|'today'|'upcoming'|'undated'|'done'}
 */
function classifyTaskStatus(task, todayIso = getTodayIsoLocal()) {
    if (task && task.done) return 'done';
    const date = String(task?.date || '').trim();
    if (!date) return 'undated';
    if (date < todayIso) return 'overdue';
    if (date === todayIso) return 'today';
    return 'upcoming';
}

/**
 * Groups tasks into ordered status buckets (Overdue, Today, Upcoming,
 * Undated, Done), each sorted by date ascending then note id for a stable,
 * deterministic order. Empty buckets are omitted.
 * @param {Array<object>} tasks
 * @param {string} [todayIso]
 * @returns {Array<{status: string, label: string, tasks: object[]}>}
 */
function groupTasks(tasks, todayIso = getTodayIsoLocal()) {
    const byStatus = new Map(STATUS_GROUPS.map((g) => [g.status, []]));
    for (const task of tasks || []) {
        byStatus.get(classifyTaskStatus(task, todayIso)).push(task);
    }
    for (const bucket of byStatus.values()) {
        bucket.sort((a, b) => {
            const priorityCompare = priorityRank(a) - priorityRank(b);
            if (priorityCompare !== 0) return priorityCompare;
            const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
            if (dateCompare !== 0) return dateCompare;
            return String(a.fileId || '').localeCompare(String(b.fileId || ''));
        });
    }
    return STATUS_GROUPS
        .map((g) => ({ status: g.status, label: g.label, tasks: byStatus.get(g.status) }))
        .filter((g) => g.tasks.length > 0);
}

function isoToUtcDateParts(iso) {
    const match = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3])
    };
}

function diffDays(fromIso, toIso) {
    const from = isoToUtcDateParts(fromIso);
    const to = isoToUtcDateParts(toIso);
    if (!from || !to) return null;
    const fromMs = Date.UTC(from.year, from.month - 1, from.day);
    const toMs = Date.UTC(to.year, to.month - 1, to.day);
    return Math.round((toMs - fromMs) / 86400000);
}

function describeTaskTiming(task, todayIso = getTodayIsoLocal()) {
    const status = classifyTaskStatus(task, todayIso);
    if (status === 'done') return 'done';
    if (status === 'undated') return 'no date';
    if (status === 'today') return 'today';
    const days = Math.abs(diffDays(todayIso, String(task?.date || '').trim()) || 0);
    if (status === 'overdue') return `${days}d overdue`;
    return `in ${days}d`;
}

function describeGroup(node) {
    const count = node?.tasks?.length || 0;
    if (node?.status === 'overdue') return `${count} need attention`;
    if (node?.status === 'today') return `${count} due today`;
    if (node?.status === 'upcoming') return `${count} coming up`;
    if (node?.status === 'undated') return `${count} unscheduled`;
    if (node?.status === 'done') return `${count} completed`;
    return `${count} tasks`;
}

function buildGroupLabel(node) {
    return {
        label: String(node?.label || '').trim() || 'Tasks',
        description: describeGroup(node)
    };
}

function buildTaskCenterMessage(groups) {
    if (!Array.isArray(groups) || groups.length === 0) return 'No tasks found in this workspace.';
    return groups
        .map((group) => `${group.tasks.length} ${group.status}`)
        .join(' · ');
}

function filterTaskGroups(groups, state) {
    const mode = String(state?.mode || 'all');
    const focusStatus = String(state?.focusStatus || '').trim();
    let filtered = Array.isArray(groups) ? groups.slice() : [];
    if (mode === 'open') filtered = filtered.filter((group) => group.status !== 'done');
    if (mode === 'attention') filtered = filtered.filter((group) => group.status === 'overdue' || group.status === 'today');
    if (focusStatus) filtered = filtered.filter((group) => group.status === focusStatus);
    return filtered;
}

function describeFilterState(state) {
    const mode = String(state?.mode || 'all');
    const focusStatus = String(state?.focusStatus || '').trim();
    const parts = [];
    if (mode === 'open') parts.push('open only');
    else if (mode === 'attention') parts.push('attention');
    else parts.push('all tasks');
    if (focusStatus) parts.push(`focused on ${focusStatus}`);
    return parts.join(' · ');
}

function buildTaskCenterStatus(groups, state) {
    const summary = buildTaskCenterMessage(groups);
    return `${describeFilterState(state)} — ${summary}`;
}

/**
 * @param {{displayText?: string, text?: string, date?: string, fileId?: string, priority?: string, body?: string}} task
 * @param {string} [todayIso]
 * @returns {{label: string, description: string, tooltip: string}}
 */
function buildTaskLabel(task, todayIso = getTodayIsoLocal()) {
    const label = String(task?.displayText || task?.text || '').trim() || '(empty task)';
    const timing = describeTaskTiming(task, todayIso);
    const source = String(task?.fileId || '').trim();
    // Priority already shows as the dot's color (getTaskIcon) — repeating
    // "urgent"/"medium priority" in the description too was redundant and,
    // in a narrow sidebar, crowded out the due-state/source text until it
    // truncated. Description stays to the two things the icon can't show.
    const priorityWord = PRIORITY_LABEL[task?.priority] || '';
    const descriptionParts = [timing, source].filter(Boolean);
    const description = descriptionParts.join(' · ');
    const tooltipLines = [
        label,
        priorityWord ? `Priority: ${priorityWord}` : '',
        task?.date ? `Due: ${task.date} (${timing})` : `Due: ${timing}`,
        source ? `Note: ${source}` : '',
        task?.body ? `Body: ${String(task.body).trim()}` : ''
    ].filter(Boolean);
    const tooltip = tooltipLines.join('\n');
    return { label, description, tooltip };
}

function registerTaskCenterView(context) {
    const vscode = require('vscode');
    const { toggleTaskCheckbox } = require('./viewPanel');

    class TaskCenterProvider {
        constructor() {
            this._emitter = new vscode.EventEmitter();
            this.onDidChangeTreeData = this._emitter.event;
            this._groups = null;
            this._filterState = { mode: 'all', focusStatus: '' };
        }

        refresh() {
            this._groups = null;
            this._emitter.fire(undefined);
        }

        cycleMode() {
            const index = FILTER_MODES.indexOf(this._filterState.mode);
            this._filterState.mode = FILTER_MODES[(index + 1) % FILTER_MODES.length] || 'all';
            this.refresh();
        }

        focusStatus(status) {
            const next = String(status || '').trim();
            this._filterState.focusStatus = this._filterState.focusStatus === next ? '' : next;
            this.refresh();
        }

        clearFilters() {
            this._filterState = { mode: 'all', focusStatus: '' };
            this.refresh();
        }

        _ensureGroups() {
            if (this._groups) return this._groups;
            const tasks = buildTaskRows(getIndex(), getVaultGeneration());
            const grouped = groupTasks(tasks);
            this._groups = filterTaskGroups(grouped, this._filterState);
            if (treeView) treeView.message = buildTaskCenterStatus(this._groups, this._filterState);
            return this._groups;
        }

        getTreeItem(node) {
            if (node.kind === 'group') {
                const collapsibleState = node.status === 'done'
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.Expanded;
                const header = buildGroupLabel(node);
                const item = new vscode.TreeItem(header.label, collapsibleState);
                item.id = `group:${node.status}`;
                item.description = header.description;
                item.tooltip = `${header.label}\n${header.description}`;
                item.contextValue = 'yamlinkTaskGroup';
                item.iconPath = getGroupIcon(vscode, node.status);
                return item;
            }

            const { label, description, tooltip } = buildTaskLabel(node.task);
            const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
            item.id = node.task.id;
            item.description = description;
            item.tooltip = tooltip;
            item.contextValue = 'yamlinkTask';
            item.iconPath = getTaskIcon(vscode, node.task);
            item.checkboxState = node.task.done
                ? vscode.TreeItemCheckboxState.Checked
                : vscode.TreeItemCheckboxState.Unchecked;
            item.command = {
                command: 'yamlink.openTaskLine',
                title: 'Go to task',
                arguments: [node.task.filePath, node.task.line]
            };
            return item;
        }

        getChildren(node) {
            const groups = this._ensureGroups();
            if (!node) {
                return groups.map((g) => ({ kind: 'group', status: g.status, label: g.label, tasks: g.tasks }));
            }
            if (node.kind === 'group') {
                return node.tasks.map((task) => ({ kind: 'task', task }));
            }
            return [];
        }
    }

    const provider = new TaskCenterProvider();
    const treeView = vscode.window.createTreeView('yamlink.tasks', {
        treeDataProvider: provider,
        showCollapseAll: true
    });

    context.subscriptions.push(treeView);

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.taskCenterCycleMode', () => {
            provider.cycleMode();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.taskCenterFocusOverdue', () => {
            provider.focusStatus('overdue');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.taskCenterClearFilters', () => {
            provider.clearFilters();
        })
    );

    context.subscriptions.push(
        treeView.onDidChangeCheckboxState((e) => {
            for (const [node, state] of e.items) {
                if (node.kind !== 'task') continue;
                const newDone = state === vscode.TreeItemCheckboxState.Checked;
                toggleTaskCheckbox(node.task.filePath, node.task.line, newDone).catch(() => {});
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.openTaskLine', async (filePath, line) => {
            try {
                const document = await vscode.workspace.openTextDocument(filePath);
                const editor = await vscode.window.showTextDocument(document, { preview: false });
                const position = new vscode.Position(Math.max(0, line), 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            } catch (_) {
                // Best-effort — a stale row pointing at a since-moved/deleted
                // file simply fails to open rather than throwing.
            }
        })
    );

    _provider = provider;
}

function getGroupIcon(vscode, status) {
    if (status === 'overdue') return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.errorForeground'));
    if (status === 'today') return new vscode.ThemeIcon('calendar', new vscode.ThemeColor('charts.yellow'));
    if (status === 'upcoming') return new vscode.ThemeIcon('clock', new vscode.ThemeColor('charts.blue'));
    if (status === 'undated') return new vscode.ThemeIcon('circle-large-outline', new vscode.ThemeColor('descriptionForeground'));
    if (status === 'done') return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
    return new vscode.ThemeIcon('checklist');
}

// Priority, not status, drives the per-task icon: status is already conveyed
// by which group the task sits under (Overdue/Today/...) and by the human
// due-state in its description ("62d overdue"), so the icon slot is free to
// carry the one thing that otherwise had no visual signal at all. A plain
// colored dot via ThemeIcon+ThemeColor — the same idiom VS Code's own
// Problems panel uses for error/warning severity — not an emoji.
function getTaskIcon(vscode, task) {
    const priority = task?.priority;
    if (priority === 'urgent') return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('problemsErrorIcon.foreground'));
    if (priority === 'medium') return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('problemsWarningIcon.foreground'));
    if (priority === 'low') return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('descriptionForeground'));
    return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
}

let _provider = null;

/** Refresh the Task Center tree if it is registered (called by the refresh router). @returns {void} */
function refreshTaskCenter() {
    if (_provider) _provider.refresh();
}

module.exports = {
    classifyTaskStatus,
    groupTasks,
    priorityRank,
    buildTaskLabel,
    buildGroupLabel,
    buildTaskCenterMessage,
    filterTaskGroups,
    describeFilterState,
    buildTaskCenterStatus,
    getTaskIcon,
    getGroupIcon,
    registerTaskCenterView,
    refreshTaskCenter
};
