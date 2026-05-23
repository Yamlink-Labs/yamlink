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

function iconGlyph(name) {
  const icons = {
    open: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.5"/><path d="M8 2.5v2"/><path d="M13.5 8h-2"/><path d="M8 13.5v-2"/><path d="M2.5 8h2"/></svg>',
    done: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>',
    dated: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="4" width="10" height="9" rx="2"/><path d="M5 2.5v3"/><path d="M11 2.5v3"/><path d="M3 7h10"/></svg>',
    created: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10"/><path d="M3 8h10"/></svg>',
    tasks: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4h7"/><path d="M6 8h7"/><path d="M6 12h7"/><path d="M3 4.5h.01"/><path d="M3 8.5h.01"/><path d="M3 12.5h.01"/></svg>',
    notes: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h6l2.5 2.5v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"/><path d="M10 2.5V5h2.5"/></svg>'
  };
  return '<span class="yl-icon yl-icon-' + escapeHtml(name) + '">' + (icons[name] || icons.open) + '</span>';
}

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
  const dateNotes = rows.filter(row => row.itemKind === 'date').length;
  const createdNotes = rows.filter(row => row.itemKind === 'created').length;
  summary.innerHTML = [
    stat('Open Tasks', open, 'var(--accent-3)'),
    stat('Done Tasks', done, '#7f8a94'),
    stat('Dated', dateNotes, 'var(--accent)'),
    stat('Created', createdNotes, 'var(--accent-2)')
  ].join('');
}

function stat(label, value, color) {
  const valueStyle = color ? ' style="color:' + color + '"' : '';
  const iconName = label === 'Open Tasks' ? 'open'
    : label === 'Done Tasks' ? 'done'
    : label === 'Dated' ? 'dated'
    : 'created';
  return '<div class="card">' +
    iconGlyph(iconName) +
    '<div class="card-copy"><div class="card-label">' + escapeHtml(label) + '</div></div>' +
    '<div class="card-value"' + valueStyle + '>' + escapeHtml(String(value)) + '</div>' +
  '</div>';
}

function renderAgenda() {
  const rows = rowsForAgenda();
  agendaTitle.textContent = 'Activity on ' + selectedDate;
  if (rows.length === 0) {
    agendaList.innerHTML = '<div class="empty">No activity for this selection.</div>';
    return;
  }
  const taskRows = rows.filter(r => r.itemKind === 'task');
  const noteRows = rows.filter(r => r.itemKind !== 'task');
  const sections = [];
  if (taskRows.length > 0) {
    sections.push(
      '<div class="agenda-section">' +
      '<div class="agenda-section-label">' + iconGlyph('tasks') + '<span>Tasks</span></div>' +
      taskRows.map(renderTaskItem).join('') +
      '</div>'
    );
  }
  if (noteRows.length > 0) {
    sections.push(
      '<div class="agenda-section">' +
      '<div class="agenda-section-label">' + iconGlyph('notes') + '<span>Notes</span></div>' +
      noteRows.map(renderNoteItem).join('') +
      '</div>'
    );
  }
  agendaList.innerHTML = sections.join('');
}

function renderTaskItem(row) {
  const pillClass = row.done ? 'pill pill-done' : 'pill pill-task';
  const pillText = row.done ? 'done' : 'open';
  return '<article class="task' + (row.done ? ' done' : '') + '">' +
    '<div class="task-dot"></div>' +
    '<div class="task-main">' +
      '<div class="task-title">' + escapeHtml(row.text) + '</div>' +
      (row.body ? '<div class="task-body">' + escapeHtml(row.body) + '</div>' : '') +
      '<div class="task-meta">' +
        '<span class="' + pillClass + '">' + pillText + '</span>' +
        '<span class="link" data-open-node="' + escapeHtml(row.fileId) + '">' + escapeHtml(row.sourceLabel) + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="item-type">' + escapeHtml(row.fileType || '') + '</div>' +
  '</article>';
}

function renderNoteItem(row) {
  const pillClass = row.itemKind === 'date' ? 'pill pill-date' : 'pill pill-created';
  const pillText = row.itemKind === 'date' ? 'dated' : 'created';
  return '<article class="task">' +
    '<div class="task-dot task-dot-note"></div>' +
    '<div class="task-main">' +
      '<div class="task-title">' + escapeHtml(row.text) + '</div>' +
      '<div class="task-meta">' +
        '<span class="' + pillClass + '">' + pillText + '</span>' +
        '<span class="link" data-open-node="' + escapeHtml(row.fileId) + '">' + escapeHtml(row.sourceLabel) + '</span>' +
        (row.fileType ? '<span>' + escapeHtml(row.fileType) + '</span>' : '') +
      '</div>' +
    '</div>' +
  '</article>';
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
    const taskCount = rows.filter(row => row.itemKind === 'task').length;
    const noteCount = rows.length - taskCount;
    const visible = rows.slice(0, 5);
    const overflow = rows.length - visible.length;
    const dots = visible.map(row => '<span class="dot dot-' + row.itemKind + (row.done ? ' done' : '') + '"></span>').join('') +
      (overflow > 0 ? '<span class="dot-overflow">+' + overflow + '</span>' : '');
    const badges = [
      taskCount > 0 ? '<span class="day-badge task">T' + taskCount + '</span>' : '',
      noteCount > 0 ? '<span class="day-badge note">N' + noteCount + '</span>' : ''
    ].filter(Boolean).join('');
    cells.push(
      '<button class="day' + (iso === selectedDate ? ' selected' : '') + (iso === model.todayIso ? ' today' : '') + '" data-date="' + iso + '">' +
        '<div class="day-head"><span class="day-num">' + day + '</span><span class="day-count">' + (rows.length || '') + '</span></div>' +
        '<div class="dots">' + dots + '</div>' +
        '<div class="day-meta"><span>' + (rows.length ? rows.length + ' item' + (rows.length === 1 ? '' : 's') : '') + '</span><span class="day-badges">' + badges + '</span></div>' +
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
  if (monthRows.length > 0) {
    // Going back: land on the most recent day; going forward: land on the first
    selectedDate = delta < 0 ? monthRows[monthRows.length - 1].date : monthRows[0].date;
  } else {
    selectedDate = selectedMonth + '-01';
  }
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
  const prevMonth = selectedDate.slice(0, 7);
  selectedMonth = monthSelect.value;
  const monthRows = model.months[selectedMonth] || [];
  if (monthRows.length > 0) {
    const goingBack = selectedMonth < prevMonth;
    selectedDate = goingBack ? monthRows[monthRows.length - 1].date : monthRows[0].date;
  } else {
    selectedDate = selectedMonth + '-01';
  }
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
