'use strict';

const vscode = require('vscode');
const crypto = require('crypto');
const { getIndex, getFieldsCache } = require('../core/indexService');
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

function refreshCalendarPanel() {
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

function buildCalendarModel(taskRows, fieldsCache, todayIso) {
    const taskItems = taskRows.map((row) => {
        const fileFields = fieldsCache.get(row.fileId) || {};
        return {
            id: row.id,
            date: isValidIsoDate(row.date) ? row.date : '',
            fileId: row.fileId,
            fileType: String(fileFields.type || ''),
            done: !!row.done,
            text: String(row.text ?? ''),
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
        createdItems.push({
            id: `${fileId}#${primaryDate ? 'date' : 'created'}`,
            date: noteDate,
            fileId,
            fileType: String(fields.type || ''),
            done: false,
            text: `${primaryDate ? 'Dated' : 'Created'} ${String(fields.name || fields.title || fileId)}`,
            sourceLabel: String(fields.name || fields.title || fileId),
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
    const selectedMonth = monthKeys.includes(todayIso.slice(0, 7))
        ? todayIso.slice(0, 7)
        : (monthKeys[0] || todayIso.slice(0, 7));
    const selectedDate = dated.find(row => row.date === todayIso)?.date || (dated[0]?.date || todayIso);

    const stats = {
        total: rows.length,
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
        const model = buildCalendarModel(buildTaskRows(getIndex()), getFieldsCache(), getTodayIsoLocal());
        if ('title' in host) host.title = `Calendar · ${model.stats.total} items`;
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
        'body{background:var(--vscode-sideBar-background,#141414);color:#888;font-family:\'Segoe UI\',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px}',
        '.msg{font-size:12px;color:#6f7781;text-align:center;line-height:1.6}',
        '.hint{font-size:11px;color:#555;text-align:center;line-height:1.6}',
        'code{background:#1e2126;padding:1px 5px;border-radius:4px;font-size:10px}',
        '</style></head><body>',
        '<div class="msg">No dated tasks or notes found.</div>',
        '<div class="hint">Add <code>- [ ] task text · 2025-01-15</code> to a note,<br>or set a <code>date:</code> or <code>created:</code> value in frontmatter.</div>',
        '</body></html>'
    ].join('\n');
}

function buildHtml(model, nonce, csp, scriptUri) {
    const monthOptions = model.monthKeys.map(key => `<option value="${esc(key)}"${key === model.selectedMonth ? ' selected' : ''}>${esc(formatMonthLabel(key))}</option>`).join('');
    const monthGrid = buildMonthGrid(model.selectedMonth, model.months[model.selectedMonth] || [], model.selectedDate);

    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp}; connect-src 'none';">
<style>
:root{
  --bg: var(--vscode-sideBar-background,#141414);
  --surface: var(--vscode-editorWidget-background,var(--vscode-sideBar-background,#171b20));
  --surface-alt: var(--vscode-editor-background,#111318);
  --fg: var(--vscode-sideBar-foreground,var(--vscode-editor-foreground,#d7dce2));
  --muted: var(--vscode-descriptionForeground,#95a1ac);
  --border: var(--vscode-widget-border,var(--vscode-panel-border,#252a30));
  --input-border: var(--vscode-input-border,#30363d);
  --input-bg: var(--vscode-input-background,#111318);
  --input-fg: var(--vscode-input-foreground,#dce2e8);
  --accent: #6eb3f0;
  --accent-2: #4fc4a0;
  --accent-3: #e5a96a;
  --accent-soft: rgba(110,179,240,.1);
  --accent-2-soft: rgba(79,196,160,.12);
  --accent-3-soft: rgba(229,169,106,.12);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--fg);font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;min-height:100vh;overflow:auto}
.shell{display:flex;flex-direction:column;min-height:100vh}
.hero{padding:12px 12px 10px;border-bottom:1px solid var(--border);background:linear-gradient(180deg,rgba(110,179,240,.12),rgba(79,196,160,.05))}
.eyebrow{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#d4a164;margin-bottom:6px}
.title{font-size:18px;font-weight:700;line-height:1.1}
.sub{margin-top:4px;color:var(--muted);line-height:1.4}
.toolbar-wrap{display:flex;flex-direction:column;border-bottom:1px solid var(--border);background:var(--surface)}
.toolbar{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:center;padding:8px 12px;background:var(--surface)}
.shortcut-hint{padding:0 12px 8px;font-size:10px;letter-spacing:.04em;color:var(--muted)}
.shortcut-hint kbd{font:inherit;font-weight:700;color:var(--fg)}
.seg{display:inline-flex;border:1px solid var(--input-border);border-radius:999px;overflow:hidden;background:color-mix(in srgb, var(--surface) 78%, var(--surface-alt))}
.seg button{background:transparent;border:none;color:var(--muted);padding:6px 10px;font:inherit;cursor:pointer;transition:background-color .14s ease,color .14s ease}
.seg button:hover{background:rgba(255,255,255,.035);color:var(--fg)}
.seg button.active{background:var(--accent-2-soft);color:var(--accent-2)}
.month-select,.date-input{width:100%;min-width:0;background:var(--input-bg);border:1px solid var(--input-border);border-radius:10px;color:var(--input-fg);padding:6px 10px;font:inherit}
.month-select:focus,.date-input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 1px rgba(110,179,240,.18)}
.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:8px 12px;border-bottom:1px solid var(--border)}
.card{padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--surface);min-width:0}
.card-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8b949e}
.card-value{margin-top:4px;font-size:18px;font-weight:700}
.body{padding:8px 12px 14px;display:flex;flex-direction:column;gap:10px}
.month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
.range-stack{display:flex;flex-direction:column;gap:8px}
.range-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:6px}
.range-day{padding:8px;border:1px solid var(--border);border-radius:12px;background:var(--surface);display:flex;flex-direction:column;gap:4px;cursor:pointer;transition:border-color .14s ease,background-color .14s ease}
.range-day:hover{border-color:rgba(229,169,106,.24);background:color-mix(in srgb, var(--surface) 88%, var(--accent-3-soft))}
.range-day.selected{border-color:var(--accent-2);box-shadow:0 0 0 1px rgba(79,196,160,.35) inset;background:color-mix(in srgb, var(--surface) 90%, var(--accent-2-soft))}
.range-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8b949e}
.range-date{font-size:13px;font-weight:700;color:var(--fg)}
.range-meta{font-size:11px;color:var(--muted)}
.dow{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#7f8892;padding:0 2px 2px}
.day{min-height:clamp(52px, 8vw, 72px);border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:6px;display:flex;flex-direction:column;gap:4px;cursor:pointer;color:var(--fg);font:inherit;transition:border-color .14s ease,background-color .14s ease}
.day:hover{border-color:rgba(229,169,106,.24);background:color-mix(in srgb, var(--surface) 88%, var(--accent-3-soft))}
.day.muted{opacity:.35}
.day.selected{border-color:var(--accent-2);box-shadow:0 0 0 1px rgba(79,196,160,.35) inset;background:color-mix(in srgb, var(--surface) 90%, var(--accent-2-soft))}
.day-head{display:flex;justify-content:space-between;align-items:center}
.day-num{font-size:12px;font-weight:600;color:var(--fg)}
.day-count{font-size:10px;color:#8b949e}
.dots{display:flex;flex-wrap:wrap;gap:4px}
.dot{width:7px;height:7px;border-radius:999px;background:var(--accent-3)}
.dot.done{background:#7f8a94}
.agenda{display:flex;flex-direction:column;gap:8px}
.agenda-title{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8b949e}
.task{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:start;padding:9px 10px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.task.done{opacity:.7}
.task-dot{width:8px;height:8px;border-radius:999px;background:var(--accent-2);margin-top:6px}
.task.done .task-dot{background:#7f8a94}
.task-main{display:flex;flex-direction:column;gap:4px}
.task-title{line-height:1.45}
.task.done .task-title{text-decoration:line-through}
.task-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:#8b949e}
.link{color:var(--accent-3);cursor:pointer}
.link:hover{text-decoration:underline}
.pill{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;border:1px solid rgba(79,196,160,.25);background:rgba(79,196,160,.08);color:var(--accent-2)}
.empty{padding:14px;text-align:center;color:#8b949e;border:1px dashed var(--input-border);border-radius:12px}
@media (max-width:980px){.summary{grid-template-columns:repeat(2,minmax(0,1fr));}.toolbar{grid-template-columns:1fr 1fr;}.seg{grid-column:1 / -1;justify-self:start}}
@media (max-width:760px){.task{grid-template-columns:1fr;}.task-dot{display:none}.range-strip{grid-template-columns:repeat(auto-fit,minmax(92px,1fr));}.month-grid{gap:4px}.day{min-height:48px}}
@media (max-width:560px){.hero{padding:10px}.toolbar,.summary,.body{padding-left:10px;padding-right:10px}.toolbar{grid-template-columns:1fr}.month-select,.date-input{width:100%}.range-strip{grid-template-columns:1fr 1fr}.day{padding:5px}.day-count{display:none}.sub{font-size:12px}.summary{grid-template-columns:1fr 1fr}}
@media (max-width:420px){.summary{grid-template-columns:1fr}.range-strip{grid-template-columns:1fr}.card-value{font-size:16px}.title{font-size:16px}}
</style></head><body>
<div class="shell">
  <div class="hero">
    <div class="eyebrow">Vault-wide calendar</div>
    <div class="title">Calendar</div>
    <div class="sub">Switch between month, week, and day views. Every task is backed by a stable Yamlink block id.</div>
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

function buildMonthGrid(monthKey, rows, selectedDate) {
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
        cells.push(`<button class="day${iso === selectedDate ? ' selected' : ''}" data-date="${esc(iso)}"><div class="day-head"><span class="day-num">${day}</span><span class="day-count">${dayRows.length}</span></div><div class="dots">${dayRows.slice(0, 6).map(row => `<span class="dot${row.done ? ' done' : ''}"></span>`).join('')}</div></button>`);
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
    host.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>*{box-sizing:border-box;margin:0;padding:0}body{background:var(--vscode-sideBar-background,#141414);color:var(--vscode-sideBar-foreground,#d7dce2);font-family:'Segoe UI',system-ui,sans-serif;padding:16px;display:flex;flex-direction:column;gap:10px}.label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8b949e}.err{color:#ff9b9b;font-size:13px;font-weight:600}.detail{color:#8b949e;font-size:12px;line-height:1.45}</style></head><body><div class="label">${esc(label)}</div><div class="err">Calendar hit a runtime error.</div><div class="detail">${esc(detail)}</div></body></html>`;
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
