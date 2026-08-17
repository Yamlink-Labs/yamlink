'use strict';

const { esc } = require('../../runtime/mutationNarratives');

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

module.exports = {
    buildConnectivitySvg,
    buildDonutSvg,
    buildGrowthSvg,
    buildHeatmapSvg,
    buildLifecycleSvg,
    sct
};
