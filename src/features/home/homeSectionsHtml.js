'use strict';

const { esc, relTime } = require('../../runtime/mutationNarratives');
const { ACTIVITY_ICON, LUCIDE, svgIcon } = require('./homeIcons');

/* ── Helpers ────────────────────────────────────────────────────────── */
function fmtTimestamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7)  return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function describeEvent(event, fieldsCache) {
    const { type, noteId, field, newValue } = event;
    const id    = String(noteId  || '').trim();
    const f     = String(field   || '').trim();
    const nv    = String(newValue || '').trim().replace(/^\[\[|\]\]$/g, '');
    const data  = fieldsCache.get(id) || {};
    const label = String(data.name || data.title || '').trim() || id;

    switch (type) {
        case 'note_created':     return `Created <strong>${esc(label)}</strong>`;
        case 'type_set':         return nv ? `Set type on <strong>${esc(label)}</strong> → <code>${esc(nv)}</code>` : `Set type on <strong>${esc(label)}</strong>`;
        case 'field_added':      return f ? `Added <code>${esc(f)}</code> to <strong>${esc(label)}</strong>` : `Updated <strong>${esc(label)}</strong>`;
        case 'field_changed':    return f ? `Updated <code>${esc(f)}</code> on <strong>${esc(label)}</strong>` : `Updated <strong>${esc(label)}</strong>`;
        case 'field_removed':    return f ? `Removed <code>${esc(f)}</code> from <strong>${esc(label)}</strong>` : `Updated <strong>${esc(label)}</strong>`;
        case 'relation_added':   return f ? `Linked <strong>${esc(label)}</strong> · <code>${esc(f)}</code> → <strong>${esc(nv || '?')}</strong>` : `Linked <strong>${esc(label)}</strong>`;
        case 'relation_removed': return f ? `Unlinked <code>${esc(f)}</code> from <strong>${esc(label)}</strong>` : `Unlinked from <strong>${esc(label)}</strong>`;
        case 'relation_changed': return nv ? `Relinked <strong>${esc(label)}</strong> · <code>${esc(f)}</code> → <strong>${esc(nv)}</strong>` : `Updated link on <strong>${esc(label)}</strong>`;
        case 'task_status_changed': return `Task in <strong>${esc(label)}</strong> marked <strong>${esc(nv || 'done')}</strong>`;
        default:                 return `Updated <strong>${esc(label)}</strong>`;
    }
}

/* ── Home tab builders ──────────────────────────────────────────────── */

function pulseCard(n, label, warn) {
    const numClass = warn ? 'pulse-num pulse-num--warn' : 'pulse-num';
    return `<div class="pulse-card"><span class="${numClass}">${n}</span><span class="pulse-label">${esc(label)}</span></div>`;
}

function buildOverdueAlertHtml(tasks) {
    const overdueRows = tasks.overdue || [];
    if (!overdueRows.length) return '';
    const count = overdueRows.length;
    const previews = overdueRows.slice(0, 3).map(row => esc(String(row.text || row.displayText || '').trim() || '(task)'));
    const previewStr = previews.join(' · ') + (count > 3 ? ` · +${count - 3} more` : '');
    return `<section class="overdue-alert" data-command="yamlink.openCalendar">
        <span class="overdue-alert-icon">${svgIcon(LUCIDE.alertTriangle, 13)}</span>
        <span class="overdue-alert-badge">${count} overdue</span>
        <span class="overdue-alert-tasks">${previewStr}</span>
    </section>`;
}

function buildFeedHtml(events, fieldsCache, sessions) {
    if (sessions.length) {
        return sessions.map(session => {
            const iconPath = ACTIVITY_ICON[session.primaryType] || ACTIVITY_ICON.field_changed;
            const iconHtml = `<span class="feed-icon feed-icon--${esc(session.primaryType || 'field_changed')}">${svgIcon(iconPath)}</span>`;
            const chips = [
                session.familyLabel      ? `<span class="feed-chip">${esc(session.familyLabel)}</span>`           : '',
                session.outcomeLabel     ? `<span class="feed-chip feed-chip--outcome">${esc(session.outcomeLabel)}</span>` : '',
                session.primaryTypeName  ? `<span class="feed-chip">${esc(session.primaryTypeName)}</span>`       : '',
                session.count > 1        ? `<span class="feed-chip">${session.count} events</span>`               : '',
                session.focusFields?.length ? `<span class="feed-chip">fields: ${esc(session.focusFields.slice(0, 2).join(', '))}</span>` : '',
            ].join('');
            return `<div class="feed-item" data-id="${esc(session.primaryNoteId)}" role="button" tabindex="0">
                ${iconHtml}
                <span class="feed-text"><strong>${esc(session.summary)}</strong><span class="feed-subtext">${chips}</span></span>
                <span class="feed-time">${esc(fmtTimestamp(session.endedAt))}</span>
            </div>`;
        }).join('');
    }
    if (!events.length) {
        return '<div class="col-empty">No activity yet — start creating notes.</div>';
    }
    return events.map(event => {
        const iconPath = ACTIVITY_ICON[event.type];
        const iconHtml = iconPath
            ? `<span class="feed-icon feed-icon--${esc(event.type)}">${svgIcon(iconPath)}</span>`
            : `<span class="feed-icon">·</span>`;
        return `<div class="feed-item" data-id="${esc(event.noteId)}" role="button" tabindex="0">
            ${iconHtml}
            <span class="feed-text">${describeEvent(event, fieldsCache)}</span>
            <span class="feed-time" title="${esc(relTime(event.timestamp))}">${esc(fmtTimestamp(event.timestamp))}</span>
        </div>`;
    }).join('');
}

function buildRecentHtml(noteIds, fieldsCache) {
    if (!noteIds.length) {
        return '<div class="col-empty">Recently touched notes appear here.</div>';
    }
    return noteIds.map(id => {
        const data = fieldsCache.get(id) || {};
        const name = String(data.name || data.title || '').trim();
        const type = String(data.type || '').trim();
        const ts   = data.__lastMutated || '';
        return `<div class="recent-item" data-id="${esc(id)}" role="button" tabindex="0">
            <div class="recent-body">
                <span class="recent-name">${esc(name || id)}</span>
                ${name ? `<span class="recent-id">${esc(id)}</span>` : ''}
            </div>
            <div class="recent-meta">
                ${type ? `<span class="recent-type">${esc(type)}</span>` : ''}
                ${ts   ? `<span class="recent-time">${esc(relTime(ts))}</span>` : ''}
            </div>
        </div>`;
    }).join('');
}

function buildNudgesHtml(nudges) {
    if (!nudges.length) return '';
    return nudges.map(n => {
        if (n.type === 'broken') {
            return `<div class="nudge-card nudge-card--warn" data-action="openProblems" role="button" tabindex="0">
                <div class="nudge-count">${n.count}</div>
                <div class="nudge-info"><div class="nudge-title">Broken Link${n.count !== 1 ? 's' : ''}</div><div class="nudge-sub">Fix them before they spread</div></div>
                <span class="nudge-arrow">→</span>
            </div>`;
        }
        if (n.type === 'untyped') {
            return `<div class="nudge-card nudge-card--info" data-action="openUntypedView" role="button" tabindex="0">
                <div class="nudge-count">${n.count}</div>
                <div class="nudge-info"><div class="nudge-title">Untyped Note${n.count !== 1 ? 's' : ''}</div><div class="nudge-sub">Add a type to unlock intelligence</div></div>
                <span class="nudge-arrow">→</span>
            </div>`;
        }
        return '';
    }).join('');
}

function buildTasksHtml(tasks, fieldsCache) {
    const groups = [
        { key: 'overdue',  label: 'Overdue',  state: 'overdue',   rows: (tasks.overdue  || []).slice(0, 5) },
        { key: 'today',    label: 'Today',    state: 'today',     rows: (tasks.today    || []).slice(0, 4) },
        { key: 'upcoming', label: 'Upcoming', state: 'upcoming',  rows: (tasks.upcoming || []).slice(0, 4) },
        { key: 'undated',  label: 'Open',     state: 'open',      rows: (tasks.undated  || []).slice(0, 3) },
    ];
    const html = groups
        .filter(g => g.rows.length > 0)
        .map(g => {
            const items = g.rows.map(row => buildTaskItem(row, g.state, fieldsCache)).join('');
            return `<div class="task-group"><div class="task-group-header task-group-header--${g.state}">${esc(g.label)}</div>${items}</div>`;
        })
        .join('');
    return html || '<div class="col-empty">Nothing due — vault looks clear.</div>';
}

function buildTaskItem(row, state, fieldsCache) {
    const noteId   = String(row.file || row.noteId || '').replace(/\.md$/, '');
    const text     = String(row.text || row.displayText || '').trim();
    const date     = String(row.date || '').trim();
    const data     = fieldsCache ? (fieldsCache.get(noteId) || {}) : {};
    const noteName = String(data.name || data.title || '').trim() || noteId;
    return `<div class="task-item task-item--${esc(state)}" data-id="${esc(noteId)}" role="button" tabindex="0">
        <span class="task-dot"></span>
        <div class="task-body">
            <span class="task-text">${esc(text || '(untitled task)')}</span>
            <span class="task-meta">
                ${noteName ? `<span class="task-note">${esc(noteName)}</span>` : ''}
                ${date     ? `<span class="task-date">${esc(date)}</span>`     : ''}
            </span>
        </div>
    </div>`;
}

module.exports = {
    buildFeedHtml,
    buildNudgesHtml,
    buildOverdueAlertHtml,
    buildRecentHtml,
    buildTasksHtml,
    pulseCard
};
