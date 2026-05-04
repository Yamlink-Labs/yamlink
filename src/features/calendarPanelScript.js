'use strict';
// Calendar webview client — reads model from window.calendarModel injected by the host.

const vscode = acquireVsCodeApi();
const model = window.calendarModel;
const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const rangeView = document.getElementById('range-view');
const agendaList = document.getElementById('agenda-list');
const agendaTitle = document.getElementById('agenda-title');
const summary = document.getElementById('summary');
const monthSelect = document.getElementById('month-select');
const dateInput = document.getElementById('date-input');
let mode = 'month';
let selectedMonth = model.selectedMonth;
let selectedDate = model.selectedDate;

function startOfWeek(iso) {
  const d = new Date(iso + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0,10);
}

function addDays(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

function formatRange(start, end) {
  if (start === end) return start;
  return start + ' \u2192 ' + end;
}

function rowsForSummary() {
  if (mode === 'day') return model.dated.filter(row => row.date === selectedDate);
  if (mode === 'week') {
    const start = startOfWeek(selectedDate);
    const end = addDays(start, 6);
    return model.dated.filter(row => row.date >= start && row.date <= end);
  }
  return model.dated.filter(row => row.date.startsWith(selectedMonth));
}

function rowsForAgenda() {
  return model.dated.filter(row => row.date === selectedDate);
}

function renderSummary() {
  const rows = rowsForSummary();
  const taskRows = rows.filter(row => row.itemKind === 'task');
  const done = taskRows.filter(row => row.done).length;
  const open = taskRows.length - done;
  const sources = new Set(rows.map(row => row.fileId)).size;
  const range = mode === 'day' ? selectedDate : (mode === 'week' ? formatRange(startOfWeek(selectedDate), addDays(startOfWeek(selectedDate), 6)) : selectedMonth);
  summary.innerHTML = [
    stat('Range', range),
    stat('Items', rows.length),
    stat('Open', open),
    stat('Sources', sources)
  ].join('');
}

function stat(label, value) {
  return '<div class="card"><div class="card-label">' + escapeHtml(label) + '</div><div class="card-value">' + escapeHtml(value) + '</div></div>';
}

function renderAgenda() {
  const rows = rowsForAgenda();
  agendaTitle.textContent = 'Activity on ' + selectedDate;
  if (rows.length === 0) {
    agendaList.innerHTML = '<div class="empty">No activity for this selection.</div>';
    return;
  }
  agendaList.innerHTML = rows.map(row => {
    return '<article class="task' + (row.done ? ' done' : '') + '">' +
      '<div class="task-dot"></div>' +
      '<div class="task-main">' +
        '<div class="task-title">' + escapeHtml(row.text) + '</div>' +
        '<div class="task-meta">' +
          '<span class="pill">' + (row.itemKind === 'task' ? (row.done ? 'done' : 'open') : (row.itemKind === 'created' ? 'created' : 'note')) + '</span>' +
          '<span>' + escapeHtml(row.date || '') + '</span>' +
          '<span class="link" data-open-node="' + escapeHtml(row.fileId) + '">' + escapeHtml(row.sourceLabel) + '</span>' +
          '<span>' + escapeHtml(row.id) + '</span>' +
        '</div>' +
      '</div>' +
      '<div>' + escapeHtml(row.fileType || 'node') + '</div>' +
    '</article>';
  }).join('');
}

function renderMonth() {
  const monthRows = model.months[selectedMonth] || [];
  const [year, month] = selectedMonth.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const firstWeekDay = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const rowsByDate = new Map();
  monthRows.forEach(row => {
    if (!rowsByDate.has(row.date)) rowsByDate.set(row.date, []);
    rowsByDate.get(row.date).push(row);
  });

  const cells = [];
  for (let i = 0; i < firstWeekDay; i++) {
    cells.push('<div class="day muted"></div>');
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = year + '-' + String(month).padStart(2,'0') + '-' + String(day).padStart(2,'0');
    const rows = rowsByDate.get(iso) || [];
    cells.push(
      '<button class="day' + (iso === selectedDate ? ' selected' : '') + '" data-date="' + iso + '">' +
        '<div class="day-head"><span class="day-num">' + day + '</span><span class="day-count">' + rows.length + '</span></div>' +
        '<div class="dots">' + rows.slice(0,6).map(row => '<span class="dot' + (row.done ? ' done' : '') + '"></span>').join('') + '</div>' +
      '</button>'
    );
  }

  return '<div class="month-grid">' + DOW.map(label => '<div class="dow">' + label + '</div>').join('') + cells.join('') + '</div>';
}

function weekdayIndex(iso) {
  const d = new Date(iso + 'T12:00:00');
  return (d.getDay() + 6) % 7;
}

function renderWeek() {
  const start = startOfWeek(selectedDate);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return '<div class="range-stack"><div class="range-strip">' + days.map((iso) => {
    const rows = model.dated.filter(row => row.date === iso);
    return '<button class="range-day' + (iso === selectedDate ? ' selected' : '') + '" data-date="' + iso + '">' +
      '<div class="range-label">' + DOW[weekdayIndex(iso)] + '</div>' +
      '<div class="range-date">' + escapeHtml(iso.slice(8)) + '</div>' +
      '<div class="range-meta">' + rows.length + ' item' + (rows.length === 1 ? '' : 's') + '</div>' +
    '</button>';
  }).join('') + '</div></div>';
}

function renderDay() {
  const rows = model.dated.filter(row => row.date === selectedDate);
  return '<div class="range-stack"><div class="range-day selected" data-date="' + selectedDate + '">' +
    '<div class="range-label">Selected day</div>' +
    '<div class="range-date">' + escapeHtml(selectedDate) + '</div>' +
    '<div class="range-meta">' + rows.length + ' item' + (rows.length === 1 ? '' : 's') + '</div>' +
  '</div></div>';
}

function renderRangeView() {
  if (mode === 'month') {
    rangeView.innerHTML = renderMonth();
    return;
  }
  if (mode === 'week') {
    rangeView.innerHTML = renderWeek();
    return;
  }
  rangeView.innerHTML = renderDay();
}

function applySelection() {
  renderRangeView();
  renderSummary();
  renderAgenda();
  document.querySelectorAll('[data-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
}

function setMode(nextMode) {
  mode = nextMode;
  applySelection();
}

function syncMonthSelection() {
  selectedMonth = selectedDate.slice(0,7);
  monthSelect.value = selectedMonth;
  dateInput.value = selectedDate;
}

function shiftDate(days) {
  selectedDate = addDays(selectedDate, days);
  syncMonthSelection();
  applySelection();
}

function shiftMonth(delta) {
  const [year, month] = selectedMonth.split('-').map(Number);
  const next = new Date(year, month - 1 + delta, 1);
  selectedMonth = next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0');
  monthSelect.value = selectedMonth;
  const monthRows = model.months[selectedMonth] || [];
  selectedDate = monthRows[0] ? monthRows[0].date : (selectedMonth + '-01');
  dateInput.value = selectedDate;
  applySelection();
}

function moveRange(delta) {
  if (mode === 'month') {
    shiftMonth(delta);
    return;
  }
  if (mode === 'week') {
    shiftDate(delta * 7);
    return;
  }
  shiftDate(delta);
}

document.addEventListener('click', (event) => {
  const open = event.target.closest('[data-open-node]');
  if (open) {
    vscode.postMessage({ command: 'openNode', id: open.dataset.openNode });
    return;
  }
  const day = event.target.closest('[data-date]');
  if (day) {
    selectedDate = day.dataset.date;
    dateInput.value = selectedDate;
    applySelection();
    return;
  }
  const modeBtn = event.target.closest('[data-mode]');
  if (modeBtn) {
    setMode(modeBtn.dataset.mode);
  }
});

monthSelect.addEventListener('change', () => {
  selectedMonth = monthSelect.value;
  const monthRows = model.months[selectedMonth] || [];
  selectedDate = monthRows[0] ? monthRows[0].date : (selectedMonth + '-01');
  dateInput.value = selectedDate;
  applySelection();
});

dateInput.addEventListener('change', () => {
  selectedDate = dateInput.value || selectedDate;
  selectedMonth = selectedDate.slice(0,7);
  monthSelect.value = selectedMonth;
  applySelection();
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const tagName = target && target.tagName ? target.tagName.toLowerCase() : '';
  const editable = target && (target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select');
  if (editable) return;

  const key = String(event.key || '').toLowerCase();
  if (key === 'm') {
    event.preventDefault();
    setMode('month');
    return;
  }
  if (key === 'w') {
    event.preventDefault();
    setMode('week');
    return;
  }
  if (key === 'd') {
    event.preventDefault();
    setMode('day');
    return;
  }
  if (key === 't') {
    event.preventDefault();
    selectedDate = model.todayIso;
    syncMonthSelection();
    applySelection();
    return;
  }
  if (event.key === '[') {
    event.preventDefault();
    moveRange(-1);
    return;
  }
  if (event.key === ']') {
    event.preventDefault();
    moveRange(1);
  }
});

function escapeHtml(value) {
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

applySelection();
