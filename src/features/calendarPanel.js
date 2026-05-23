'use strict';

const vscode = require('vscode');
const crypto = require('crypto');
const { getIndex, getFieldsCache, getPathIndex, getVaultGeneration } = require('../core/indexService');
const { buildTaskRows } = require('../core/tasks');
const { getTodayIsoLocal, normaliseDateInput } = require('../core/date');

let sidebarView = null;
let _extUri = null;

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
                    const filePath = getIndex().get(msg.id);
                    if (!filePath) return;
                    try {
                        const doc = await vscode.workspace.openTextDocument(filePath);
                        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
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
<style>
:root{
  --bg: #151720;
  --surface: #1a1d28;
  --surface-alt: #20283a;
  --surface-strong: #232c41;
  --surface-card: #191d29;
  --fg: #d6ddf2;
  --muted: #7f8bb2;
  --muted-2: #66749d;
  --border: #2d3550;
  --border-soft: #242a3d;
  --input-border: #313957;
  --input-bg: #171b27;
  --input-fg: #dce3f7;
  --accent: #38d6d8;
  --accent-2: #76a7ff;
  --accent-3: #d9a56a;
  --accent-soft: rgba(56,214,216,.12);
  --accent-2-soft: rgba(118,167,255,.12);
  --accent-3-soft: rgba(217,165,106,.12);
  --shadow-soft: 0 8px 24px rgba(0,0,0,.16);
  --shadow-inset: inset 0 1px 0 rgba(255,255,255,.03);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:linear-gradient(180deg,#20283a 0%, #181b26 18%, #151720 100%);color:var(--fg);font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;min-height:100vh;overflow:auto}
.shell{display:flex;flex-direction:column;min-height:100vh}
.hero{padding:13px 14px 12px;border-bottom:1px solid var(--border);background:linear-gradient(180deg,rgba(118,167,255,.14),rgba(56,214,216,.05));box-shadow:var(--shadow-inset)}
.eyebrow{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-3);margin-bottom:7px}
.title{font-size:17px;font-weight:700;line-height:1.05;color:var(--accent-2)}
.sub{margin-top:6px;color:var(--muted);line-height:1.5;max-width:420px}
.toolbar-wrap{display:flex;flex-direction:column;border-bottom:1px solid var(--border-soft);background:rgba(19,22,31,.92)}
.toolbar{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:center;padding:10px 14px;background:rgba(18,21,30,.94)}
.shortcut-hint{padding:0 14px 10px;font-size:10px;letter-spacing:.05em;color:var(--muted-2)}
.shortcut-hint kbd{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:6px;border:1px solid var(--border);background:var(--surface-card);font:inherit;font-weight:700;color:var(--fg)}
.seg{display:inline-flex;border:1px solid var(--border);border-radius:999px;overflow:hidden;background:var(--surface-card);box-shadow:var(--shadow-inset)}
.seg button{background:transparent;border:none;color:var(--muted);padding:7px 12px;font:inherit;cursor:pointer;transition:background-color .14s ease,color .14s ease,border-color .14s ease}
.seg button:hover{background:rgba(255,255,255,.03);color:var(--fg)}
.seg button.active{background:rgba(56,214,216,.14);color:var(--accent);box-shadow:inset 0 -1px 0 rgba(56,214,216,.45)}
.month-select,.date-input{width:100%;min-width:0;background:var(--input-bg);border:1px solid var(--input-border);border-radius:12px;color:var(--input-fg);padding:9px 11px;font:inherit;box-shadow:var(--shadow-inset)}
.month-select:hover,.date-input:hover{border-color:#3c466b}
.month-select:focus,.date-input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 1px rgba(56,214,216,.22), var(--shadow-inset)}
.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:10px 14px;border-bottom:1px solid var(--border-soft);background:rgba(17,20,29,.92)}
.card{padding:8px 10px;border:1px solid var(--border);border-radius:12px;background:linear-gradient(180deg,rgba(36,43,62,.68),rgba(22,26,37,.92));min-width:0;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;box-shadow:var(--shadow-inset)}
.card-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.card-label{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted-2);white-space:nowrap}
.card-value{font-size:14px;font-weight:700;color:var(--fg)}
.yl-icon{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;color:var(--muted);flex-shrink:0}
.yl-icon svg{width:14px;height:14px;stroke:currentColor;stroke-width:1.45;fill:none;stroke-linecap:round;stroke-linejoin:round}
.body{padding:10px 14px 16px;display:flex;flex-direction:column;gap:12px;background:linear-gradient(180deg,rgba(19,22,31,.92),rgba(21,23,32,1))}
.month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.range-stack{display:flex;flex-direction:column;gap:8px}
.range-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:6px}
.range-day{padding:9px;border:1px solid var(--border);border-radius:14px;background:linear-gradient(180deg,rgba(35,42,61,.72),rgba(22,26,37,.96));display:flex;flex-direction:column;gap:4px;cursor:pointer;transition:border-color .14s ease,background-color .14s ease,transform .14s ease}
.range-day:hover{border-color:rgba(56,214,216,.24);background:linear-gradient(180deg,rgba(38,46,67,.92),rgba(24,29,42,.98));transform:translateY(-1px)}
.range-day.selected{border-color:var(--accent);box-shadow:0 0 0 1px rgba(56,214,216,.28) inset, 0 0 0 1px rgba(56,214,216,.12);background:linear-gradient(180deg,rgba(30,62,74,.75),rgba(23,31,41,.98))}
.range-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted-2)}
.range-date{font-size:13px;font-weight:700;color:var(--fg)}
.range-meta{font-size:11px;color:var(--muted)}
.dow{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted-2);padding:0 4px 3px}
.day{min-height:clamp(56px, 8vw, 74px);border:1px solid var(--border-soft);border-radius:14px;background:linear-gradient(180deg,rgba(28,32,46,.76),rgba(20,23,33,.98));padding:7px;display:flex;flex-direction:column;gap:6px;cursor:pointer;color:var(--fg);font:inherit;transition:border-color .14s ease,background-color .14s ease,transform .14s ease;box-shadow:var(--shadow-inset)}
.day:hover{border-color:#42506f;background:linear-gradient(180deg,rgba(32,37,52,.92),rgba(24,28,40,.98));transform:translateY(-1px)}
.day.muted{opacity:.28}
.day.today{border-color:rgba(118,167,255,.36)}
.day.selected{border-color:var(--accent);box-shadow:0 0 0 1px rgba(56,214,216,.28) inset, 0 0 0 1px rgba(56,214,216,.12);background:linear-gradient(180deg,rgba(28,60,71,.82),rgba(20,29,38,.98))}
.day.today.selected{border-color:var(--accent)}
.day-head{display:flex;justify-content:space-between;align-items:center}
.day-num{font-size:12px;font-weight:700;color:#dfe5f8}
.day.selected .day-num{color:#f0fcff}
.day-count{font-size:10px;color:var(--muted-2)}
.dots{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.dot{width:8px;height:8px;border-radius:999px;background:var(--accent-3);box-shadow:0 0 0 1px rgba(255,255,255,.04) inset}
.dot.done{background:#7f8a94}
.dot-task{background:var(--accent-3)}.dot-date{background:var(--accent-2)}.dot-created{background:var(--accent)}
.dot-overflow{font-size:9px;line-height:1;color:var(--muted);padding:0 2px}
.day-meta{display:flex;justify-content:space-between;align-items:center;gap:4px;font-size:9px;color:var(--muted-2);margin-top:auto}
.day-badges{display:flex;gap:3px;align-items:center}
.day-badge{display:inline-flex;align-items:center;justify-content:center;min-width:14px;height:14px;padding:0 4px;border-radius:999px;border:1px solid var(--border);background:rgba(23,27,38,.9);font-size:9px;line-height:1;color:var(--fg)}
.day-badge.task{color:var(--accent-3)}
.day-badge.note{color:var(--accent-2)}
.agenda{display:flex;flex-direction:column;gap:8px}
.agenda-title{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted-2);padding:2px 2px 0}
.agenda-section{display:flex;flex-direction:column;gap:6px}
.agenda-section+.agenda-section{margin-top:10px}
.agenda-section-label{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted-2);padding:0 3px;display:flex;align-items:center;gap:6px}
.task{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:start;padding:11px 12px;border:1px solid var(--border);border-radius:14px;background:linear-gradient(180deg,rgba(31,36,51,.72),rgba(23,27,38,.96));box-shadow:var(--shadow-inset)}
.task.done{opacity:.7}
.task-dot{width:9px;height:9px;border-radius:999px;background:var(--accent-3);margin-top:6px;box-shadow:0 0 0 1px rgba(255,255,255,.04) inset}
.task-dot-note{background:var(--accent-2)}
.task.done .task-dot{background:#7f8a94}
.task-main{display:flex;flex-direction:column;gap:4px}
.task-title{line-height:1.45;color:#dfe5f8;font-size:13px}
.task.done .task-title{text-decoration:line-through}
.task-body{font-size:11px;color:var(--muted);line-height:1.5;margin-top:3px}
.task-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:var(--muted)}
.item-type{font-size:11px;color:var(--muted-2);white-space:nowrap;padding-top:1px}
.link{color:var(--accent-2);cursor:pointer}
.link:hover{text-decoration:underline}
.pill{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;border:1px solid rgba(56,214,216,.2);background:rgba(56,214,216,.08);color:var(--accent)}
.pill-task{border-color:rgba(217,165,106,.3);background:rgba(217,165,106,.12);color:var(--accent-3)}
.pill-done{border-color:rgba(127,138,148,.3);background:rgba(127,138,148,.1);color:#7f8a94}
.pill-date{border-color:rgba(118,167,255,.3);background:rgba(118,167,255,.12);color:var(--accent-2)}
.pill-created{border-color:rgba(56,214,216,.2);background:rgba(56,214,216,.08);color:var(--accent)}
.empty{padding:16px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:14px;background:rgba(21,24,34,.72)}
@media (max-width:980px){.summary{grid-template-columns:repeat(2,minmax(0,1fr));}.toolbar{grid-template-columns:1fr 1fr;}.seg{grid-column:1 / -1;justify-self:start}}
@media (max-width:760px){.task{grid-template-columns:1fr;}.task-dot{display:none}.range-strip{grid-template-columns:repeat(auto-fit,minmax(92px,1fr));}.month-grid{gap:4px}.day{min-height:48px}}
@media (max-width:560px){.hero{padding:10px}.toolbar,.summary,.body{padding-left:10px;padding-right:10px}.toolbar{grid-template-columns:1fr}.month-select,.date-input{width:100%}.range-strip{grid-template-columns:1fr 1fr}.day{padding:5px}.day-count{display:none}.sub{font-size:12px}.summary{grid-template-columns:1fr 1fr}}
@media (max-width:420px){.summary{grid-template-columns:1fr}.range-strip{grid-template-columns:1fr}.card-value{font-size:16px}.title{font-size:16px}}
</style></head><body>
<div class="shell">
  <div class="hero">
    <div class="eyebrow">Vault-wide calendar</div>
    <div class="title">Calendar</div>
    <div class="sub">Switch between month, week, and day views. Track open work, dated notes, and created activity in one operational timeline.</div>
  </div>
  <div class="toolbar-wrap">
    <div class="toolbar">
      <div class="seg" id="mode-seg">
        <button data-mode="month" class="active">Month</button>
        <button data-mode="week">Week</button>
        <button data-mode="day">Day</button>
      </div>
      <select id="month-select" class="month-select">${monthOptions}</select>
      <input id="date-input" class="date-input" type="date" value="${esc(model.selectedDate)}">
    </div>
    <div class="shortcut-hint">Shortcuts: <kbd>M</kbd>/<kbd>W</kbd>/<kbd>D</kbd> mode · <kbd>[</kbd> / <kbd>]</kbd> move · <kbd>T</kbd> today</div>
  </div>
  <div class="summary" id="summary"></div>
  <div class="body">
    <div id="range-view">
      ${monthGrid}
    </div>
    <div class="agenda">
      <div class="agenda-title" id="agenda-title">Selected activity</div>
      <div id="agenda-list"></div>
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
