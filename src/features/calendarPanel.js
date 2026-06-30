'use strict';
const fs = require('fs');
const path = require('path');

const vscode = require('vscode');
const crypto = require('crypto');
const { getIndex, getFieldsCache, getPathIndex, getVaultGeneration } = require('../core/indexService');
const { buildTaskRows } = require('../core/tasks');
const { getTodayIsoLocal, normaliseDateInput } = require('../core/date');
const { openNoteTarget } = require('./navigation/openNoteTarget');

let sidebarView = null;
let _extUri = null;
const CALENDAR_CSS = fs.readFileSync(path.join(__dirname, 'calendarPanel.css'), 'utf8');

/**
 * @param {import('vscode').ExtensionContext} context
 * @returns {void}
 */
function registerCalendarView(context) {
    _extUri = context.extensionUri;
    const provider = {
        resolveWebviewView(view) {
            try {
                sidebarView = view;
                view.webview.options = {
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'src', 'features')]
                };
                view.webview.onDidReceiveMessage(async (msg) => {
                    if (!msg || msg.command !== 'openNode') return;
                    try {
                        await openNoteTarget(msg.id, { viewColumn: vscode.ViewColumn.One, preview: false });
                    } catch (err) {
                        console.error('Yamlink — calendar openNode failed:', err.message);
                    }
                }, null, context.subscriptions);
                renderCalendar();
            } catch (error) {
                renderError('Calendar failed to load', error);
            }
        }
    };

    context.subscriptions.push(vscode.window.registerWebviewViewProvider('yamlink.calendar', provider));
}

function openCalendarPanel() {
    renderCalendar();
}

function refreshCalendarPanel(changedId) {
    if (changedId) {
        const fields = getFieldsCache().get(changedId) || {};
        if (!Object.values(fields).some(v => ISO_DATE_RE.test(String(v || '')))) return;
    }
    renderCalendar();
}

function getHost() {
    return sidebarView || null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(val) {
    return typeof val === 'string' && ISO_DATE_RE.test(val);
}

function safeLocale(a, b) {
    return String(a || '').localeCompare(String(b || ''));
}

function buildCalendarModel(taskRows, fieldsCache, todayIso, preferredDate = '') {
    const taskItems = taskRows.map((row) => {
        const fileFields = fieldsCache.get(row.fileId) || {};
        return {
            id: row.id,
            date: isValidIsoDate(row.date) ? row.date : '',
            fileId: row.fileId,
            fileType: String(fileFields.type || ''),
            done: !!row.done,
            text: String(row.displayText || row.text || ''),
            body: String(row.body || ''),
            sourceLabel: String(fileFields.name || fileFields.title || row.fileId || ''),
            itemKind: 'task'
        };
    });
    const createdItems = [];
    for (const [fileId, fields] of fieldsCache.entries()) {
        const primaryDate = normaliseDateInput(fields.date || '') || '';
        const createdDate = normaliseDateInput(fields.created || '') || '';
        const noteDate = primaryDate || createdDate;
        if (!noteDate) continue;
        const noteName = String(fields.name || fields.title || fileId);
        createdItems.push({
            id: `${fileId}#${primaryDate ? 'date' : 'created'}`,
            date: noteDate,
            fileId,
            fileType: String(fields.type || ''),
            done: false,
            text: noteName,
            body: '',
            sourceLabel: noteName,
            itemKind: primaryDate ? 'date' : 'created'
        });
    }
    const rows = [...taskItems, ...createdItems];

    const dated = rows
        .filter(row => row.date)
        .sort((a, b) => a.date.localeCompare(b.date) || safeLocale(a.fileId, b.fileId) || safeLocale(a.id, b.id));
    const undated = rows
        .filter(row => !row.date)
        .sort((a, b) => safeLocale(a.fileId, b.fileId) || safeLocale(a.id, b.id));

    const months = new Map();
    for (const row of dated) {
        const monthKey = row.date.slice(0, 7);
        if (!months.has(monthKey)) months.set(monthKey, []);
        months.get(monthKey).push(row);
    }

    const monthKeys = Array.from(months.keys()).sort();
    const preferredIso = isValidIsoDate(preferredDate) ? preferredDate : '';
    const preferredMonth = preferredIso ? preferredIso.slice(0, 7) : '';
    const selectedMonth = preferredMonth
        || (monthKeys.includes(todayIso.slice(0, 7))
            ? todayIso.slice(0, 7)
            : (monthKeys[0] || todayIso.slice(0, 7)));

    // Prefer explicit note context → today → most recent past date → nearest future date
    let selectedDate;
    if (preferredIso) {
        selectedDate = preferredIso;
    } else if (dated.find(row => row.date === todayIso)) {
        selectedDate = todayIso;
    } else {
        const past = dated.filter(row => row.date < todayIso);
        selectedDate = past.length > 0 ? past[past.length - 1].date : (dated[0]?.date || todayIso);
    }

    const stats = {
        total: rows.length,
        tasksOpen: taskItems.filter(t => !t.done).length,
        tasksDone: taskItems.filter(t => t.done).length,
        dateNotes: createdItems.filter(i => i.itemKind === 'date').length,
        createdNotes: createdItems.filter(i => i.itemKind === 'created').length,
        tasks: taskItems.length,
        created: createdItems.length,
        dated: dated.length,
        undated: undated.length,
        today: rows.filter(row => row.date === todayIso).length,
        completed: rows.filter(row => row.done).length
    };

    return {
        todayIso,
        selectedMonth,
        selectedDate,
        monthKeys,
        months: Object.fromEntries(months),
        dated,
        undated,
        stats
    };
}

function renderCalendar() {
    const host = getHost();
    if (!host) return;
    try {
        const taskRows = buildTaskRows(getIndex(), getVaultGeneration());
        const fieldsCache = getFieldsCache();
        const model = buildCalendarModel(taskRows, fieldsCache, getTodayIsoLocal(), derivePreferredCalendarDate(taskRows, fieldsCache));
        if ('title' in host) {
            const { tasksOpen, tasksDone, dateNotes, createdNotes } = model.stats;
            const parts = [];
            if (tasksOpen + tasksDone > 0) parts.push(`${tasksOpen} open`);
            if (dateNotes > 0) parts.push(`${dateNotes} dated`);
            if (createdNotes > 0) parts.push(`${createdNotes} created`);
            host.title = parts.length ? `Calendar · ${parts.join(' · ')}` : 'Calendar';
        }
        if (model.stats.total === 0) {
            host.webview.html = buildCalendarEmptyHtml();
            return;
        }
        const nonce = crypto.randomBytes(16).toString('hex');
        const csp = host.webview.cspSource;
        const scriptUri = host.webview.asWebviewUri(
            vscode.Uri.joinPath(_extUri, 'src', 'features', 'calendarPanelScript.js')
        );
        host.webview.html = buildHtml(model, nonce, csp, scriptUri);
    } catch (error) {
        renderError('Calendar failed to render', error);
    }
}

function buildCalendarEmptyHtml() {
    return [
        '<!DOCTYPE html><html><head><meta charset="UTF-8">',
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">',
        '<style>',
        '*{margin:0;padding:0;box-sizing:border-box}',
        'body{background:linear-gradient(180deg,#20283a 0%, #171a24 22%, #151720 100%);color:#d7dff4;font-family:\'Segoe UI\',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px}',
        '.msg{font-size:13px;color:#d7dff4;text-align:center;line-height:1.6;font-weight:600}',
        '.hint{font-size:11px;color:#8e99bb;text-align:center;line-height:1.7;max-width:320px}',
        'code{background:#1c2030;border:1px solid #2d3550;padding:1px 5px;border-radius:999px;font-size:10px;color:#73a5ff}',
        '</style></head><body>',
        '<div class="msg">No dated tasks or notes found.</div>',
        '<div class="hint">Add <code>- [ ] task text · 2025-01-15</code> to a note,<br>or set a <code>date:</code> or <code>created:</code> value in frontmatter.</div>',
        '</body></html>'
    ].join('\n');
}

function derivePreferredCalendarDate(taskRows, fieldsCache) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') return '';

    const fileId = getPathIndex().get(editor.document.uri.fsPath);
    if (!fileId) return '';

    const fields = fieldsCache.get(fileId) || {};
    const primaryDate = normaliseDateInput(fields.date || '') || '';
    const createdDate = normaliseDateInput(fields.created || '') || '';
    if (primaryDate) return primaryDate;
    if (createdDate) return createdDate;

    const noteTaskDates = taskRows
        .filter(row => row.fileId === fileId)
        .map(row => normaliseDateInput(row.date || '') || '')
        .filter(isValidIsoDate)
        .sort();

    return noteTaskDates[0] || '';
}

function buildHtml(model, nonce, csp, scriptUri) {
    const monthOptions = model.monthKeys.map(key => `<option value="${esc(key)}"${key === model.selectedMonth ? ' selected' : ''}>${esc(formatMonthLabel(key))}</option>`).join('');
    const monthGrid = buildMonthGrid(model.selectedMonth, model.months[model.selectedMonth] || [], model.selectedDate, model.todayIso);

    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp}; connect-src 'none';">
<style>${CALENDAR_CSS}</style></head><body>
<div class="shell">
  <div class="hero">
    <div class="eyebrow">Vault-wide calendar</div>
    <div class="title">Calendar</div>
    <div class="sub">Switch between month, week, and day views. Track open work, dated notes, and created activity in one operational timeline.</div>
  </div>
  <div class="toolbar-wrap">
    <div class="toolbar">
      <div class="seg" id="mode-seg" role="group" aria-label="Calendar range">
        <button type="button" data-mode="month" class="active" aria-pressed="true">Month</button>
        <button type="button" data-mode="week" aria-pressed="false">Week</button>
        <button type="button" data-mode="day" aria-pressed="false">Day</button>
      </div>
      <label class="sr-only" for="month-select">Selected month</label>
      <select id="month-select" class="month-select" aria-label="Selected month">${monthOptions}</select>
      <label class="sr-only" for="date-input">Selected date</label>
      <input id="date-input" class="date-input" type="date" value="${esc(model.selectedDate)}" aria-label="Selected date">
    </div>
    <div class="shortcut-hint">Shortcuts: <kbd>M</kbd>/<kbd>W</kbd>/<kbd>D</kbd> mode · <kbd>[</kbd> / <kbd>]</kbd> move · <kbd>T</kbd> today</div>
  </div>
  <div class="summary" id="summary" role="status" aria-live="polite"></div>
  <div class="body">
    <div id="range-view" aria-label="Calendar range view">
      ${monthGrid}
    </div>
    <div class="agenda">
      <div class="agenda-title" id="agenda-title">Selected activity</div>
      <div id="agenda-list" aria-live="polite"></div>
    </div>
  </div>
</div>
<script nonce="${nonce}">window.calendarModel = ${JSON.stringify(model)};</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
}

function buildMonthGrid(monthKey, rows, selectedDate, todayIso) {
    const [year, month] = monthKey.split('-').map(Number);
    const first = new Date(year, month - 1, 1);
    const firstWeekDay = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const rowsByDate = new Map();
    for (const row of rows) {
        if (!rowsByDate.has(row.date)) rowsByDate.set(row.date, []);
        rowsByDate.get(row.date).push(row);
    }
    const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
        .map(label => `<div class="dow">${label}</div>`)
        .join('');
    const cells = [];
    for (let i = 0; i < firstWeekDay; i++) cells.push('<div class="day muted"></div>');
    for (let day = 1; day <= daysInMonth; day++) {
        const iso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const dayRows = rowsByDate.get(iso) || [];
        const taskCount = dayRows.filter(row => row.itemKind === 'task').length;
        const noteCount = dayRows.length - taskCount;
        const visible = dayRows.slice(0, 5);
        const overflow = dayRows.length - visible.length;
        const dots = visible.map(row => `<span class="dot dot-${esc(row.itemKind)}${row.done ? ' done' : ''}"></span>`).join('') +
            (overflow > 0 ? `<span class="dot-overflow">+${overflow}</span>` : '');
        const badges = [
            taskCount > 0 ? `<span class="day-badge task">T${taskCount}</span>` : '',
            noteCount > 0 ? `<span class="day-badge note">N${noteCount}</span>` : ''
        ].filter(Boolean).join('');
        const classes = [
            'day',
            iso === selectedDate ? 'selected' : '',
            iso === todayIso ? 'today' : ''
        ].filter(Boolean).join(' ');
        cells.push(
            `<button class="${classes}" data-date="${esc(iso)}">` +
                `<div class="day-head"><span class="day-num">${day}</span><span class="day-count">${dayRows.length || ''}</span></div>` +
                `<div class="dots">${dots}</div>` +
                `<div class="day-meta"><span>${dayRows.length ? `${dayRows.length} item${dayRows.length === 1 ? '' : 's'}` : ''}</span><span class="day-badges">${badges}</span></div>` +
            `</button>`
        );
    }
    return `<div class="month-grid">${labels}${cells.join('')}</div>`;
}

function formatMonthLabel(key) {
    const [year, month] = key.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function esc(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderError(label, error) {
    const host = getHost();
    if (!host) return;
    if ('title' in host) host.title = 'Calendar';
    const detail = error && error.message ? error.message : String(error || 'Unknown error');
    host.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>*{box-sizing:border-box;margin:0;padding:0}body{background:var(--vscode-sideBar-background,#141414);color:var(--vscode-sideBar-foreground,#d7dce2);font-family:'Segoe UI',system-ui,sans-serif;padding:16px;display:flex;flex-direction:column;gap:10px}.label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--vscode-descriptionForeground,#8b949e)}.err{color:#ff9b9b;font-size:13px;font-weight:600}.detail{color:var(--vscode-descriptionForeground,#8b949e);font-size:12px;line-height:1.45}</style></head><body><div class="label">${esc(label)}</div><div class="err">Calendar hit a runtime error.</div><div class="detail">${esc(detail)}</div></body></html>`;
}

function focusCalendarView() {
    if (sidebarView && typeof sidebarView.show === 'function') {
        sidebarView.show?.(true);
    }
}

module.exports = {
    registerCalendarView,
    openCalendarPanel,
    refreshCalendarPanel,
    buildCalendarModel,
    focusCalendarView
};
