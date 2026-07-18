'use strict';

const fs   = require('fs');
const path = require('path');
const { esc, relTime } = require('../../runtime/mutationNarratives');

const HOME_CSS = fs.readFileSync(path.join(__dirname, 'homePanel.css'), 'utf8');

const OUTCOME_TYPES = new Set(['completion_accepted', 'lightbulb_applied']);

/* ── Lucide icon helper ─────────────────────────────────────────────── */
function svgIcon(paths, size = 12) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex-shrink:0">${paths}</svg>`;
}

const LUCIDE = {
    filePlus:      `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>`,
    tag:           `<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>`,
    plusCircle:    `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>`,
    pencil:        `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
    minusCircle:   `<circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>`,
    arrowRight:    `<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>`,
    checkCircle:   `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`,
    plus:          `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
    calendar:      `<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
    alertTriangle: `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
    barChart:      `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`,
    trendingUp:    `<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>`,
};

const ACTIVITY_ICON = {
    note_created:        LUCIDE.filePlus,
    type_set:            LUCIDE.tag,
    field_added:         LUCIDE.plusCircle,
    field_changed:       LUCIDE.pencil,
    field_removed:       LUCIDE.minusCircle,
    relation_added:      LUCIDE.arrowRight,
    relation_changed:    LUCIDE.arrowRight,
    relation_removed:    LUCIDE.arrowRight,
    task_status_changed: LUCIDE.checkCircle,
};

/* ── Chart color constants ──────────────────────────────────────────── */
const HEATMAP_COLORS = [
    'rgba(255,255,255,0.05)',
    'rgba(196,155,240,0.22)',
    'rgba(196,155,240,0.46)',
    'rgba(196,155,240,0.70)',
    'rgba(196,155,240,0.95)',
];

const DONUT_COLORS = [
    '#FF429F', '#C5FFBF', '#C49BF0', '#E7A85A',
    '#5ECFBE', '#E67D61', '#7BC7FF', '#FFD93D',
];

const LIFECYCLE_COLORS = {
    draft:        '#E7A85A',
    growing:      '#C5FFBF',
    consolidated: '#C49BF0',
    hub:          '#FF429F',
    stale:        '#E67D61',
};

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

/* ── SVG chart builders ─────────────────────────────────────────────── */

function buildHeatmapSvg(heatmapData) {
    const CELL = 11, GAP = 2, STEP = CELL + GAP;
    const WEEKS = 52, DAYS = 7;
    const LEFT = 16, TOP = 16;
    const W = WEEKS * STEP + LEFT + 2;
    const H = DAYS * STEP + TOP + 2;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Align start to Monday 52 weeks back
    const start = new Date(today);
    start.setDate(today.getDate() - (WEEKS * 7 - 1));
    const dow = start.getDay();
    start.setDate(start.getDate() - ((dow + 6) % 7));

    let maxCount = 1;
    for (const v of Object.values(heatmapData)) if (/** @type {number} */ (v) > maxCount) maxCount = /** @type {number} */ (v);

    const rects = [];
    const monthLabels = [];
    let lastMonth = -1;
    const d = new Date(start);

    for (let col = 0; col < WEEKS; col++) {
        for (let row = 0; row < DAYS; row++) {
            const key = d.toISOString().slice(0, 10);
            const count = heatmapData[key] || 0;
            const intensity = count === 0 ? 0 : Math.min(4, Math.ceil((count / maxCount) * 4));
            const x = col * STEP + LEFT;
            const y = row * STEP + TOP;
            rects.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${HEATMAP_COLORS[intensity]}" data-date="${key}" data-count="${count}" style="cursor:crosshair"><title>${key}: ${count} change${count !== 1 ? 's' : ''}</title></rect>`);
            if (row === 0 && d.getDate() <= 7 && d.getMonth() !== lastMonth) {
                lastMonth = d.getMonth();
                const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                monthLabels.push(`<text x="${x}" y="${TOP - 3}" fill="rgba(156,156,156,0.65)" font-size="9" font-family="system-ui,sans-serif">${MONTHS[d.getMonth()]}</text>`);
            }
            d.setDate(d.getDate() + 1);
        }
    }

    const dayLabels = [{ l:'M', row:0 },{ l:'W', row:2 },{ l:'F', row:4 }].map(({ l, row }) =>
        `<text x="${LEFT - 3}" y="${row * STEP + TOP + CELL - 1}" fill="rgba(156,156,156,0.55)" font-size="9" font-family="system-ui,sans-serif" text-anchor="end">${l}</text>`
    ).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="Activity heatmap, last 12 months" style="overflow:visible;display:block">
        ${dayLabels}${monthLabels.join('')}${rects.join('')}
    </svg>`;
}

function buildDonutSvg(typeDistribution, noteCount) {
    const entries = Object.entries(typeDistribution).sort((a, b) => b[1] - a[1]);
    const top = entries.slice(0, 8);
    const otherCount = entries.slice(8).reduce((s, [, n]) => s + n, 0);
    if (otherCount > 0) top.push(['other', otherCount]);
    const total = top.reduce((s, [, n]) => s + n, 0);
    if (total === 0) return '<p class="stat-empty">No notes yet</p>';

    const R = 62, r = 38, cx = 75, cy = 75;
    let angle = -Math.PI / 2;
    const segments = top.map(([name, count], i) => {
        const frac = count / total;
        const sweep = frac * 2 * Math.PI;
        const end = angle + sweep;
        const color = DONUT_COLORS[i % DONUT_COLORS.length];
        let d;
        if (frac >= 0.9999) {
            d = `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R} L ${cx - 0.01} ${cy - r} A ${r} ${r} 0 1 0 ${cx} ${cy - r} Z`;
        } else {
            const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
            const x2 = cx + R * Math.cos(end),   y2 = cy + R * Math.sin(end);
            const xi1 = cx + r * Math.cos(angle), yi1 = cy + r * Math.sin(angle);
            const xi2 = cx + r * Math.cos(end),   yi2 = cy + r * Math.sin(end);
            const la = sweep > Math.PI ? 1 : 0;
            d = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${la} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${xi2.toFixed(2)} ${yi2.toFixed(2)} A ${r} ${r} 0 ${la} 0 ${xi1.toFixed(2)} ${yi1.toFixed(2)} Z`;
        }
        angle = end;
        return { name, count, color, d };
    });

    const paths = segments.map(s => `<path d="${s.d}" fill="${s.color}" opacity="0.85"><title>${esc(s.name)}: ${s.count}</title></path>`).join('');
    const center = `<text x="${cx}" y="${cy - 5}" text-anchor="middle" fill="rgba(204,204,204,0.92)" font-size="22" font-weight="700" font-family="system-ui,sans-serif">${noteCount}</text><text x="${cx}" y="${cy + 13}" text-anchor="middle" fill="rgba(156,156,156,0.65)" font-size="9" font-family="system-ui,sans-serif" letter-spacing="0.07em">NOTES</text>`;

    const legend = segments.map(({ name, count, color }) =>
        `<div class="donut-legend-item"><span class="legend-dot" style="background:${color}"></span><span class="legend-name">${esc(name)}</span><span class="legend-count">${count}</span></div>`
    ).join('');

    return `<div class="donut-wrap">
        <svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150" style="flex-shrink:0">${paths}${center}</svg>
        <div class="donut-legend">${legend}</div>
    </div>`;
}

function buildConnectivitySvg(linkDistribution) {
    const buckets = [
        { key: '0',    label: '0 links',    color: 'rgba(255,74,106,0.72)' },
        { key: '1-2',  label: '1-2 links',  color: 'rgba(231,168,90,0.72)' },
        { key: '3-5',  label: '3-5 links',  color: 'rgba(94,207,190,0.72)' },
        { key: '6-10', label: '6-10 links', color: 'rgba(196,155,240,0.72)' },
        { key: '10+',  label: '10+ links',  color: 'rgba(197,255,191,0.72)' },
    ];
    const maxVal = Math.max(1, ...buckets.map(b => linkDistribution[b.key] || 0));
    const BAR_H = 18, GAP = 8, LABEL_W = 54, W = 230, H = buckets.length * (BAR_H + GAP) - GAP;

    const rows = buckets.map((b, i) => {
        const count = linkDistribution[b.key] || 0;
        const barW = Math.max(2, Math.round((count / maxVal) * (W - LABEL_W - 32)));
        const y = i * (BAR_H + GAP);
        const tip = esc(`${b.label}: ${count} note${count !== 1 ? 's' : ''}`);
        // A full-row invisible hit area gives a real hover target even for a
        // near-zero-width bar — the visible bar itself is left exactly as before.
        return `<text x="${LABEL_W - 5}" y="${y + BAR_H / 2 + 4}" fill="rgba(156,156,156,0.78)" font-size="10" font-family="system-ui,sans-serif" text-anchor="end">${b.label}</text><rect x="${LABEL_W}" y="${y}" width="${barW}" height="${BAR_H}" rx="3" fill="${b.color}" style="pointer-events:none"/><rect x="${LABEL_W}" y="${y}" width="${W - LABEL_W}" height="${BAR_H}" fill="transparent" data-tip="${tip}" style="cursor:help"/><text x="${LABEL_W + barW + 5}" y="${y + BAR_H / 2 + 4}" fill="rgba(200,200,200,0.65)" font-size="10" font-family="system-ui,sans-serif" style="pointer-events:none">${count}</text>`;
    }).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="Link density distribution" style="display:block;overflow:visible">${rows}</svg>`;
}

function buildLifecycleSvg(lifecycleCounts) {
    const states = [
        { key: 'draft',        label: 'Draft',        color: LIFECYCLE_COLORS.draft },
        { key: 'growing',      label: 'Growing',      color: LIFECYCLE_COLORS.growing },
        { key: 'consolidated', label: 'Consolidated', color: LIFECYCLE_COLORS.consolidated },
        { key: 'hub',          label: 'Hub',          color: LIFECYCLE_COLORS.hub },
        { key: 'stale',        label: 'Stale',        color: LIFECYCLE_COLORS.stale },
    ];
    const total = states.reduce((s, st) => s + (lifecycleCounts[st.key] || 0), 0);
    if (total === 0) return '<p class="stat-empty">No lifecycle data — add more notes</p>';

    const W = 250, H = 18;
    let x = 0;
    const bars = states.map(st => {
        const count = lifecycleCounts[st.key] || 0;
        if (!count) return '';
        const w = Math.max(2, Math.round((count / total) * W));
        const bar = `<rect x="${x}" y="0" width="${w}" height="${H}" fill="${st.color}" opacity="0.85"><title>${st.label}: ${count}</title></rect>`;
        x += w;
        return bar;
    }).join('');

    const legend = states
        .filter(st => (lifecycleCounts[st.key] || 0) > 0)
        .map(st => {
            const count = lifecycleCounts[st.key] || 0;
            const pct = Math.round((count / total) * 100);
            return `<div class="lc-legend-item"><span class="legend-dot" style="background:${st.color}"></span><span class="legend-name">${st.label}</span><span class="legend-count">${pct}%</span></div>`;
        }).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="Lifecycle state distribution" style="display:block;border-radius:4px;overflow:hidden">${bars}</svg>
    <div class="lc-legend">${legend}</div>`;
}

function buildGrowthSvg(weeklyGrowth) {
    if (!weeklyGrowth || !weeklyGrowth.length) return '<p class="stat-empty">No creation data yet</p>';
    const maxCount = Math.max(1, ...weeklyGrowth.map(w => w.count));
    const W = 250, H = 60, PT = 8, PB = 18, PL = 4, PR = 4;
    const plotW = W - PL - PR;
    const plotH = H - PT - PB;
    const n = weeklyGrowth.length;

    const points = weeklyGrowth.map((w, i) => ({
        x: PL + (n > 1 ? (i / (n - 1)) : 0.5) * plotW,
        y: PT + plotH - (w.count / maxCount) * plotH,
        ...w,
    }));

    const areaPoints = [
        `${PL},${PT + plotH}`,
        ...points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
        `${PL + plotW},${PT + plotH}`,
    ].join(' ');

    const linePoints = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    const dots = points
        .filter(p => p.count > 0)
        .map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="#C49BF0" style="pointer-events:none"/>`)
        .join('');

    // Invisible, larger hit-area circle per week — including zero-count weeks,
    // which otherwise have no visible dot at all to hover.
    const hitAreas = points
        .map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="7" fill="transparent" data-tip="${esc(`${p.label}: ${p.count} note${p.count !== 1 ? 's' : ''} created`)}" style="cursor:help"/>`)
        .join('');

    const labelIdx = [0, Math.floor(n / 2), n - 1];
    const xLabels = labelIdx.map(i => {
        const p = points[i];
        return `<text x="${p.x.toFixed(1)}" y="${H - 2}" fill="rgba(156,156,156,0.65)" font-size="8" font-family="system-ui,sans-serif" text-anchor="middle">${esc(weeklyGrowth[i].label)}</text>`;
    }).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="Note growth over last 12 weeks" style="display:block;overflow:visible">
        <defs><linearGradient id="gg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#C49BF0" stop-opacity="0.38"/><stop offset="100%" stop-color="#C49BF0" stop-opacity="0.02"/></linearGradient></defs>
        <polygon points="${areaPoints}" fill="url(#gg)" style="pointer-events:none"/>
        <polyline points="${linePoints}" fill="none" stroke="#C49BF0" stroke-width="1.5" stroke-linejoin="round" style="pointer-events:none"/>
        ${dots}${xLabels}${hitAreas}
    </svg>`;
}

/* ── Stat card title with optional help badge ───────────────────────── */
function sct(title, tip, secondary) {
    const cls = secondary ? 'stat-card-title stat-card-title--secondary' : 'stat-card-title';
    const badge = tip
        ? `<span class="stat-help" data-tip="${esc(tip)}" aria-label="About this chart">?</span>`
        : '';
    return `<div class="${cls}"><span>${esc(title)}</span>${badge}</div>`;
}

/* ── Main HTML builder ──────────────────────────────────────────────── */

/**
 * @param {{
 *   noteCount: number, typeCount: number, brokenCount: number,
 *   activityEvents: object[], activitySessions?: object[], recentNoteIds: string[],
 *   types: string[], nudges: {type:string,count:number}[],
 *   tasks: {overdue: object[], today: object[], upcoming: object[], undated: object[]},
 *   projections?: object|null, lifecycleCounts?: object,
 *   heatmapData?: object, typeDistribution?: object,
 *   linkDistribution?: object, weeklyGrowth?: object[],
 *   fieldsCache: Map<string,object>, idIndex: Map<string,string>,
 *   vaultName: string, todayDate: string
 * }} model
 * @param {{ nonce: string, csp: string, scriptUri: string, logoUri?: string }} opts
 */
function buildHomeHtml(model, opts) {
    const { nonce, csp, scriptUri, logoUri } = opts;
    const { noteCount, typeCount, brokenCount, activityEvents, activitySessions, recentNoteIds,
            types, nudges, tasks, projections, lifecycleCounts,
            heatmapData, typeDistribution, linkDistribution, weeklyGrowth,
            fieldsCache, vaultName, todayDate } = model;

    const showWelcome = noteCount < 10;

    const pulseHtml = [
        pulseCard(noteCount,   'Notes',        false),
        pulseCard(typeCount,   'Types',        false),
        pulseCard(brokenCount, 'Broken Links', brokenCount > 0),
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

    const overdueAlertHtml = buildOverdueAlertHtml(tasks);

    // Home tab columns
    const recentHtml = buildRecentHtml(recentNoteIds, fieldsCache);
    const feedHtml   = buildFeedHtml(activityEvents, fieldsCache, activitySessions || []);
    const tasksHtml  = buildTasksHtml(tasks, fieldsCache);
    const projStripHtml = buildProjectionStripHtml(projections);

    // Stats tab
    const heatmapSvg      = buildHeatmapSvg(heatmapData || {});
    const donutHtml       = buildDonutSvg(typeDistribution || {}, noteCount);
    const connectivitySvg = buildConnectivitySvg(linkDistribution || {});
    const lifecycleSvgHtml = buildLifecycleSvg(lifecycleCounts || {});
    const growthSvg       = buildGrowthSvg(weeklyGrowth || []);
    const nudgeHtml       = buildNudgesHtml(nudges);

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

${showWelcome ? `
<section class="welcome-bar">
    <div class="welcome-inner">
        <div class="welcome-text">
            <div class="welcome-title">Welcome to Yamlink</div>
            <div class="welcome-sub">Your vault is always learning. Build your first knowledge system:</div>
        </div>
        <div class="welcome-steps">
            <div class="welcome-step"><span class="step-num">1</span><span class="step-label">Create a note</span><span class="step-sub">Add your first note</span></div>
            <div class="welcome-step"><span class="step-num">2</span><span class="step-label">Add a type</span><span class="step-sub">Organise your notes</span></div>
            <div class="welcome-step"><span class="step-num">3</span><span class="step-label">Link two notes</span><span class="step-sub">Build relationships</span></div>
        </div>
        <button class="welcome-cta" data-command="yamlink.newNote">Create Your First Note</button>
    </div>
    <button class="welcome-dismiss" data-action="dismissWelcome" aria-label="Dismiss">✕</button>
</section>
` : ''}

<div class="topbar">
    <section class="pulse-bar">${pulseHtml}</section>
    <div class="actions-row">${actionsHtml}</div>
</div>

${overdueAlertHtml}

<nav class="tab-bar" role="tablist">
    <div class="tab-bar-tabs">
        <button class="tab-btn active" data-tab="home" role="tab" aria-selected="true">Home</button>
        <button class="tab-btn" data-tab="stats" role="tab" aria-selected="false">
            ${svgIcon(LUCIDE.barChart, 11)} Stats
        </button>
    </div>
    <div class="tab-bar-actions">
        <button class="action-chip" data-command="yamlink.openHealthPanel">Open full Vault Health →</button>
    </div>
</nav>

<!-- HOME TAB -->
<div class="tab-content tab-content--home active" id="tab-home" role="tabpanel">
    <div class="home-grid">
        <div class="col col--recent">
            <div class="col-label">Continue Working</div>
            ${recentHtml}
        </div>
        <div class="col col--tasks">
            <div class="col-label">Tasks</div>
            ${tasksHtml}
        </div>
        <div class="col col--activity">
            <div class="col-label">Activity</div>
            ${feedHtml}
        </div>
    </div>
    ${projStripHtml}
</div>

<!-- STATS TAB -->
<div class="tab-content tab-content--stats" id="tab-stats" role="tabpanel">
    <div class="stats-grid">
        <div class="stat-card stat-card--full">
            ${sct('Activity — Last 12 Months', 'Each cell is one day. Color intensity shows how many vault changes happened that day — note edits, new links, field updates. Hover a cell to see the exact date and count.')}
            <div class="stat-chart-wrap stat-chart-wrap--scroll">${heatmapSvg}</div>
        </div>
        <div class="stat-card">
            ${sct('Vault Composition', 'Breakdown of your notes by type. Each slice represents one note type. The number in the center is your total note count. Types with fewer notes than the top 8 are grouped as "other".')}
            ${donutHtml}
        </div>
        <div class="stat-card">
            ${sct('Link Density', 'How connected your notes are. Each bar shows how many notes fall into a link-count bucket (inbound + outbound). A healthy vault has very few notes in the "0 links" bucket — those are orphans.')}
            ${connectivitySvg}
            ${sct('Note Growth (12 weeks)', 'Notes created per week over the last 12 weeks. A rising line means your vault is actively growing. Flat or empty weeks may indicate a creative pause.', true)}
            ${growthSvg}
        </div>
        <div class="stat-card">
            ${sct('Lifecycle State', 'Current lifecycle stage of every note in your vault. Draft = newly created, few fields. Growing = actively being built out. Consolidated = stable and complete. Hub = highly connected. Stale = untouched for a long time.')}
            ${lifecycleSvgHtml}
            ${nudgeHtml ? `<div class="stat-nudges">${nudgeHtml}</div>` : ''}
        </div>
    </div>
</div>

<div id="heat-tooltip" class="heat-tooltip" role="tooltip" aria-hidden="true"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
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

function pct(x) {
    return `${Math.round((x || 0) * 100)}%`;
}

// Compact per-week mini bar chart (created/touches/structure) from the same
// history buckets Vault Health's "Recent 4-week pattern" uses — a smaller,
// glanceable version for the Home tab's tight no-scroll layout. Each column
// carries its full breakdown in a title attribute rather than inline text,
// keeping the strip a single row tall.
function buildProjectionTrendStrip(history) {
    const buckets = history?.buckets || [];
    if (!buckets.length) return '';
    const maxVal = Math.max(1, ...buckets.map(b => Math.max(b.created || 0, b.touches || 0, b.structure || 0)));
    const cols = buckets.map(b => {
        const h = (v) => Math.max(2, Math.round((v / maxVal) * 22));
        const tip = `${b.label}: ${b.created || 0} created, ${b.touches || 0} touches, ${b.structure || 0} structure, ${b.completions || 0} completions`;
        return `<span class="proj-trend-col" title="${esc(tip)}">
            <span class="proj-trend-bar proj-trend-bar--created" style="height:${h(b.created)}px"></span>
            <span class="proj-trend-bar proj-trend-bar--touches" style="height:${h(b.touches)}px"></span>
            <span class="proj-trend-bar proj-trend-bar--structure" style="height:${h(b.structure)}px"></span>
        </span>`;
    }).join('');
    return `<span class="projection-trend-strip">${cols}</span>`;
}

// Below this, there isn't enough real signal to say anything honest about a
// metric — it's left out of the strip entirely (silence) rather than shown
// with a confident-looking sentence backed by almost no evidence. Same floor
// vaultProjectionsCard.js uses for the full Projections tab, so the compact
// strip and the detail view never disagree about what's worth saying.
const EVIDENCE_FLOOR = 0.15;
function evidenceOk(score) {
    return typeof score === 'number' && score >= EVIDENCE_FLOOR;
}

// Plain, concrete sentences — no jargon ("evidence %", "sampled"), no
// unbacked trend claims. Each function either names real numbers from this
// vault, or returns '' so the line is left out rather than shown empty.
function buildGrowthSentence(growth) {
    const leader = growth?.topTypes?.[0];
    if (!growth || !evidenceOk(growth.evidenceScore) || !leader) {
        return 'Not enough activity yet to tell if this vault is growing quickly or slowly.';
    }
    return `<code>${esc(leader.type)}</code> is your fastest-growing type — ${leader.currentTotal} notes now, on track for about ${leader.projected90} in 90 days.`;
}

function buildStaleSentence(stale) {
    if (!stale || !evidenceOk(stale.evidenceScore) || !stale.total) return '';
    const share = pct(stale.staleRate);
    return `Based on your vault activity, about ${share} of notes (${stale.staleCount} of ${stale.total}) haven't been changed in 90+ days.`;
}

function buildStructureSentence(structure) {
    const leader = structure?.topTypes?.[0];
    if (!structure || !evidenceOk(structure.evidenceScore) || !structure.sampled || !leader) return '';
    return `${leader.problematic} of your ${leader.sampled} <code>${esc(leader.type)}</code> notes ${leader.problematic === 1 ? "doesn't" : "don't"} match the shape the rest usually have.`;
}

function buildProjectionStripHtml(projections) {
    if (!projections) return '';
    const { growth, stale, structure, history } = projections;

    const lines = [
        buildGrowthSentence(growth),
        buildStaleSentence(stale),
        buildStructureSentence(structure),
    ].filter(Boolean).map(line => `<div class="proj-snapshot-line">${line}</div>`).join('');

    if (!lines) return '';

    // Links out to Vault Health's own dedicated Projections tab rather than
    // a full duplicate tab inside Home — the real chart/stat-card treatment
    // lives in one place now (see healthHtml.js), this stays a compact
    // teaser. Moved 2026-07-13 per direct user feedback that the Home-tab
    // version wasn't good enough to earn a full feature slot there.
    return `<div class="projection-snapshot" data-command="yamlink.openHealthPanel" role="button" tabindex="0" title="Open Vault Health's Projections tab for full detail">
        <div class="projection-snapshot-row">
            <span class="projection-snapshot-title">Projection Snapshot</span>
            ${buildProjectionTrendStrip(history)}
            <span class="proj-link">Vault Health →</span>
        </div>
        <div class="proj-snapshot-lines">${lines}</div>
    </div>`;
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

module.exports = { buildHomeHtml, OUTCOME_TYPES };
