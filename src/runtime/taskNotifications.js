'use strict';

const DEFAULT_CONFIG = {
    enabled: true,
    includeOverdue: true,
    includeDueToday: true,
    maxItemsPerAlert: 3,
    reminderCooldownMinutes: 240
};

function pluralize(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}

// Mirrors src/features/taskCenter.js's PRIORITY_RANK — kept as a separate
// literal rather than a shared import, since this module intentionally has
// no dependency on the VS-Code-only taskCenter.js (it's registered from
// extension.js independently and needs to stay usable headless-adjacent).
const PRIORITY_RANK = { urgent: 0, medium: 1, low: 2 };
function priorityRank(task) {
    const rank = PRIORITY_RANK[task?.priority];
    return rank === undefined ? 3 : rank;
}

function compareTasks(a, b) {
    const priorityCompare = priorityRank(a) - priorityRank(b);
    if (priorityCompare !== 0) return priorityCompare;
    const dateA = String(a.date || '');
    const dateB = String(b.date || '');
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const noteA = String(a.fileId || '');
    const noteB = String(b.fileId || '');
    if (noteA !== noteB) return noteA.localeCompare(noteB);
    return Number(a.line || 0) - Number(b.line || 0);
}

function getNotificationConfig() {
    const vscode = require('vscode');
    const cfg = vscode.workspace.getConfiguration('yamlink');
    return {
        enabled: cfg.get('taskNotifications.enabled', DEFAULT_CONFIG.enabled),
        includeOverdue: cfg.get('taskNotifications.includeOverdue', DEFAULT_CONFIG.includeOverdue),
        includeDueToday: cfg.get('taskNotifications.includeDueToday', DEFAULT_CONFIG.includeDueToday),
        maxItemsPerAlert: Math.max(1, Number(cfg.get('taskNotifications.maxItemsPerAlert', DEFAULT_CONFIG.maxItemsPerAlert)) || DEFAULT_CONFIG.maxItemsPerAlert),
        reminderCooldownMinutes: Math.max(0, Number(cfg.get('taskNotifications.reminderCooldownMinutes', DEFAULT_CONFIG.reminderCooldownMinutes)) || DEFAULT_CONFIG.reminderCooldownMinutes)
    };
}

function summarizeTaskNotifications(taskRows, todayIso, options = {}) {
    const config = {
        includeOverdue: options.includeOverdue !== false,
        includeDueToday: options.includeDueToday !== false,
        maxItemsPerAlert: Math.max(1, Number(options.maxItemsPerAlert) || DEFAULT_CONFIG.maxItemsPerAlert)
    };

    const openWithDates = Array.isArray(taskRows)
        ? taskRows.filter((row) => !row.done && !!row.date)
        : [];

    const overdue = config.includeOverdue
        ? openWithDates.filter((row) => row.date < todayIso).sort(compareTasks)
        : [];
    const dueToday = config.includeDueToday
        ? openWithDates.filter((row) => row.date === todayIso).sort(compareTasks)
        : [];

    const candidates = [...overdue, ...dueToday];
    const items = candidates.slice(0, config.maxItemsPerAlert);
    // Urgent-priority overdue tasks escalate past the normal warning —
    // real, explicit user-set urgency slipping past its due date is a
    // stronger signal than an ordinary overdue task.
    const urgentOverdueCount = overdue.filter((row) => row.priority === 'urgent').length;
    const severity = urgentOverdueCount > 0
        ? 'critical'
        : overdue.length > 0 ? 'warning' : (dueToday.length > 0 ? 'info' : 'silent');
    const urgentClause = urgentOverdueCount > 0 ? ` (${pluralize(urgentOverdueCount, 'urgent')})` : '';
    const message = overdue.length > 0 && dueToday.length > 0
        ? `Yamlink: ${pluralize(overdue.length, 'overdue task')}${urgentClause} and ${pluralize(dueToday.length, 'task')} due today.`
        : overdue.length > 0
            ? `Yamlink: ${pluralize(overdue.length, 'overdue task')}${urgentClause}.`
            : dueToday.length > 0
                ? `Yamlink: ${pluralize(dueToday.length, 'task')} due today.`
                : '';

    return {
        overdueCount: overdue.length,
        dueTodayCount: dueToday.length,
        urgentOverdueCount,
        items,
        severity,
        shouldNotify: items.length > 0,
        message
    };
}

function buildNotificationFingerprint(summary) {
    if (!summary || !summary.shouldNotify) return 'silent';
    const itemBits = (summary.items || []).map((item) => `${item.id}@${item.date}@${item.priority || ''}`).join('|');
    return `o:${summary.overdueCount}|t:${summary.dueTodayCount}|u:${summary.urgentOverdueCount || 0}|${itemBits}`;
}

function createTaskNotificationRuntime(context, services) {
    const vscode = require('vscode');
    const {
        getIndex,
        getVaultGeneration,
        buildTaskRows,
        openHomeCommand = 'yamlink.openHome',
        openCalendarCommand = 'yamlink.openCalendar'
    } = services;

    let lastGeneration = null;
    let lastFingerprint = context.workspaceState.get('yamlink.taskNotifications.lastFingerprint', 'silent');
    let lastNotifiedAt = Number(context.workspaceState.get('yamlink.taskNotifications.lastTimestamp', 0)) || 0;

    async function persistState() {
        await context.workspaceState.update('yamlink.taskNotifications.lastFingerprint', lastFingerprint);
        await context.workspaceState.update('yamlink.taskNotifications.lastTimestamp', lastNotifiedAt);
    }

    async function openTask(task) {
        if (!task || !task.filePath) return;
        const doc = await vscode.workspace.openTextDocument(task.filePath);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const line = Math.max(0, Number(task.line || 1) - 1);
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }

    async function refreshTaskNotifications(options = {}) {
        const config = getNotificationConfig();
        if (!config.enabled) {
            lastGeneration = getVaultGeneration();
            lastFingerprint = 'silent';
            lastNotifiedAt = 0;
            await persistState();
            return;
        }

        const generation = getVaultGeneration();
        if (!options.force && generation === lastGeneration) return;
        lastGeneration = generation;

        const todayIso = options.todayIso || new Date().toISOString().slice(0, 10);
        const rows = buildTaskRows(getIndex(), generation);
        const summary = summarizeTaskNotifications(rows, todayIso, config);
        const fingerprint = buildNotificationFingerprint(summary);

        if (!summary.shouldNotify) {
            lastFingerprint = fingerprint;
            lastNotifiedAt = 0;
            await persistState();
            return;
        }

        const nowMs = Number(options.nowMs || Date.now());
        const cooldownMs = config.reminderCooldownMinutes * 60 * 1000;
        const withinCooldown = cooldownMs > 0 && lastFingerprint === fingerprint && (nowMs - lastNotifiedAt) < cooldownMs;
        if (withinCooldown) return;

        const actions = ['Review first task', 'Open Calendar', 'Open Home'];
        const showMessage = summary.severity === 'critical'
            ? vscode.window.showErrorMessage
            : summary.severity === 'warning'
                ? vscode.window.showWarningMessage
                : vscode.window.showInformationMessage;
        const choice = await showMessage(summary.message, ...actions);

        lastFingerprint = fingerprint;
        lastNotifiedAt = nowMs;
        await persistState();

        if (choice === 'Review first task') {
            await openTask(summary.items[0]);
        } else if (choice === 'Open Calendar') {
            await vscode.commands.executeCommand(openCalendarCommand);
        } else if (choice === 'Open Home') {
            await vscode.commands.executeCommand(openHomeCommand);
        }
    }

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('yamlink.taskNotifications')) {
            lastGeneration = null;
            void refreshTaskNotifications({ force: true });
        }
    }));

    return {
        refreshTaskNotifications,
        resetTaskNotifications() {
            lastGeneration = null;
            lastFingerprint = 'silent';
            lastNotifiedAt = 0;
        }
    };
}

module.exports = {
    DEFAULT_CONFIG,
    buildNotificationFingerprint,
    createTaskNotificationRuntime,
    summarizeTaskNotifications
};
