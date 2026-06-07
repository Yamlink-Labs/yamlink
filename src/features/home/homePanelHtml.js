'use strict';

const fs   = require('fs');
const path = require('path');

const HOME_CSS = fs.readFileSync(path.join(__dirname, 'homePanel.css'), 'utf8');

const OUTCOME_TYPES = new Set(['completion_accepted', 'lightbulb_applied']);

/* ── Lucide icon helper ─────────────────────────────────────────────── */
function svgIcon(paths, size = 12) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex-shrink:0">${paths}</svg>`;
}

const LUCIDE = {
    filePlus:    `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>`,
    tag:         `<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>`,
    plusCircle:  `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>`,
    pencil:      `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
    minusCircle: `<circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>`,
    arrowRight:  `<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>`,
    checkCircle: `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`,
    plus:        `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
    calendar:    `<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
};

const ACTIVITY_ICON = {
    note_created:        LUCIDE.filePlus,
    type_set:            LUCIDE.tag,
    field_added:         LUCIDE.plusCircle,
    field_changed:       LUCIDE.pencil,
    field_removed:       LUCIDE.minusCircle,
    relation_changed:    LUCIDE.arrowRight,
    task_status_changed: LUCIDE.checkCircle,
};

/* ── Helpers ────────────────────────────────────────────────────────── */
function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function relTime(iso) {
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    const s = Math.floor(diff / 1000);
    if (s < 90)  return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d === 1) return 'yesterday';
    if (d < 7)   return `${d}d ago`;
    return `${Math.floor(d / 7)}w ago`;
}

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
        case 'relation_changed': return nv ? `Linked <strong>${esc(label)}</strong> · <code>${esc(f)}</code> → <strong>${esc(nv)}</strong>` : `Unlinked <code>${esc(f)}</code> from <strong>${esc(label)}</strong>`;
        case 'task_status_changed': return `Task in <strong>${esc(label)}</strong> marked <strong>${esc(nv || 'done')}</strong>`;
        default:                 return `Updated <strong>${esc(label)}</strong>`;
    }
}

/**
 * @param {{
 *   noteCount: number, typeCount: number, brokenCount: number,
 *   activityEvents: object[], recentNoteIds: string[],
 *   types: string[], nudges: {type:string,count:number}[],
 *   fieldsCache: Map<string,object>, idIndex: Map<string,string>,
 *   vaultName: string, todayDate: string
 * }} model
 * @param {{ nonce: string, csp: string, scriptUri: string, logoUri?: string }} opts
 */
function buildHomeHtml(model, opts) {
    const { nonce, csp, scriptUri, logoUri } = opts;
    const { noteCount, typeCount, brokenCount, activityEvents, recentNoteIds,
            types, nudges, fieldsCache, vaultName, todayDate } = model;

    const pulseHtml = [
        pulseCard(noteCount,  'Notes',        'note-icon',   false),
        pulseCard(typeCount,  'Types',        'type-icon',   false),
        pulseCard(brokenCount,'Broken Links', 'broken-icon', brokenCount > 0),
    ].join('');

    const typeButtons = types.slice(0, 4).map(t =>
        `<button class="action-chip" data-command="yamlink.newNote" aria-label="New ${esc(t)} note">
            ${svgIcon(LUCIDE.plus, 10)}${esc(t)}
         </button>`
    ).join('');

    const actionsHtml = `
        <button class="action-btn action-btn--primary" data-command="yamlink.newNote">
            ${svgIcon(LUCIDE.plus, 13)} New Note
        </button>
        <button class="action-chip" data-command="yamlink.openDailyNote">
            ${svgIcon(LUCIDE.calendar, 11)}Today
        </button>
        ${typeButtons}`;

    const feedHtml     = buildFeedHtml(activityEvents, fieldsCache);
    const recentHtml   = buildRecentHtml(recentNoteIds, fieldsCache);
    const nudgeColHtml = buildNudgeColHtml(nudges);

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp}; img-src ${csp};">
<style>${HOME_CSS}</style>
</head><body>

<header class="home-header">
    <div class="header-left">
        ${logoUri ? `<img src="${logoUri}" class="header-logo-img" alt="" aria-hidden="true">` : ''}
        <span class="header-logo">Yamlink</span>
        <span class="header-vault">${esc(vaultName)}</span>
    </div>
    <span class="header-date">${esc(todayDate)}</span>
</header>

<section class="welcome-bar">
    <div class="welcome-inner">
        <div class="welcome-text">
            <div class="welcome-title">Welcome to Yamlink</div>
            <div class="welcome-sub">Your vault is always learning. Build your first knowledge system:</div>
        </div>
        <div class="welcome-steps">
            <div class="welcome-step">
                <span class="step-num">1</span>
                <span class="step-label">Create a note</span>
                <span class="step-sub">Add your first note</span>
            </div>
            <div class="welcome-step">
                <span class="step-num">2</span>
                <span class="step-label">Add a type</span>
                <span class="step-sub">Organise your notes</span>
            </div>
            <div class="welcome-step">
                <span class="step-num">3</span>
                <span class="step-label">Link two notes</span>
                <span class="step-sub">Build relationships</span>
            </div>
        </div>
        <button class="welcome-cta" data-command="yamlink.newNote">Create Your First Note</button>
    </div>
    <button class="welcome-dismiss" data-action="dismissWelcome" aria-label="Dismiss">✕</button>
</section>

<section class="pulse-bar">${pulseHtml}</section>

<div class="actions-row">${actionsHtml}</div>

<div class="home-grid">
    <div class="col col--recents">
        <div class="col-label">Continue Working</div>
        ${recentHtml}
    </div>
    <div class="col col--feed">
        <div class="col-label">Activity Feed</div>
        ${feedHtml}
    </div>
    <div class="col col--nudges">
        <div class="col-label">Nudge Cards</div>
        ${nudgeColHtml}
    </div>
</div>

<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
}

function pulseCard(n, label, cls, warn) {
    const numClass = warn ? 'pulse-num pulse-num--warn' : 'pulse-num';
    return `<div class="pulse-card">
        <span class="${numClass}">${n}</span>
        <span class="pulse-label">${esc(label)}</span>
    </div>`;
}

function buildFeedHtml(events, fieldsCache) {
    if (!events.length) {
        return '<div class="col-empty">No activity yet — start creating notes.</div>';
    }
    return events.map(event => {
        const iconPath = ACTIVITY_ICON[event.type];
        const iconHtml = iconPath
            ? `<span class="feed-icon feed-icon--${esc(event.type)}">${svgIcon(iconPath)}</span>`
            : `<span class="feed-icon">·</span>`;
        const text    = describeEvent(event, fieldsCache);
        const display = fmtTimestamp(event.timestamp);
        const tooltip = relTime(event.timestamp);
        return `<div class="feed-item" data-id="${esc(event.noteId)}" role="button" tabindex="0">
            ${iconHtml}
            <span class="feed-text">${text}</span>
            <span class="feed-time" title="${esc(tooltip)}">${esc(display)}</span>
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

function buildNudgeColHtml(nudges) {
    if (!nudges.length) {
        return '<div class="col-empty">Vault looks clean.</div>';
    }
    return nudges.map(n => {
        if (n.type === 'broken') {
            return `<div class="nudge-card nudge-card--warn" data-action="openProblems" role="button" tabindex="0">
                <div class="nudge-count">${n.count}</div>
                <div class="nudge-info">
                    <div class="nudge-title">Broken Link${n.count !== 1 ? 's' : ''}</div>
                    <div class="nudge-sub">Fix them before they spread</div>
                </div>
                <span class="nudge-arrow">→</span>
            </div>`;
        }
        if (n.type === 'untyped') {
            return `<div class="nudge-card nudge-card--info" data-action="openUntypedView" role="button" tabindex="0">
                <div class="nudge-count">${n.count}</div>
                <div class="nudge-info">
                    <div class="nudge-title">Untyped Note${n.count !== 1 ? 's' : ''}</div>
                    <div class="nudge-sub">Add a type to unlock intelligence</div>
                </div>
                <span class="nudge-arrow">→</span>
            </div>`;
        }
        return '';
    }).join('');
}

module.exports = { buildHomeHtml, OUTCOME_TYPES };
