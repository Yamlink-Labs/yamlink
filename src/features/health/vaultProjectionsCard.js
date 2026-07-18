'use strict';

// Shared Vault Projections dashboard used by both Vault Health and the Home
// panel's dedicated Projections tab. Redesigned 2026-07-12 after direct user
// feedback that the badge/percentage-cluster version was unreadable and, in
// at least one real case, self-contradictory. Redesigned again 2026-07-13
// after direct feedback on three real problems with that version: (1) the
// growth chart was flat, uninteractive, and left most of the card's height
// as dead space; (2) the Stale/Structure "bars" were literally just two
// percentage-filled tracks with no more information than the numbers next
// to them; (3) the Structure summary led with a vault-wide abstract count
// ("1 of 15 sampled notes don't match the shape their type usually has")
// and buried the one piece of information that actually matters — which
// type — in a secondary footnote below it. This pass: a taller, filled-area
// growth chart with real per-checkpoint hover tooltips; a single "now +
// projected marker" bar per metric instead of two parallel percentage bars,
// so direction and magnitude read in one glance; and summary sentences
// (built in healthStats.js) that name the actual offending type inline,
// in the headline sentence itself, not a footnote underneath it.

const MINT = '#C5FFBF';
const ERROR = '#FF4A6A';
const LAVENDER = '#C49BF0';

const GOOD_TRENDS = new Set(['rising', 'improving']);
const BAD_TRENDS = new Set(['falling', 'worsening', 'fragile']);

// Below this, there isn't enough real signal to say anything honest — the
// metric is left out of the toggle row entirely rather than shown with a
// confident-looking trend arrow next to a near-zero evidence score.
const EVIDENCE_FLOOR = 0.15;

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function evidenceOk(score) {
    return typeof score === 'number' && score >= EVIDENCE_FLOOR;
}

function trendMeta(word) {
    if (GOOD_TRENDS.has(word)) return { arrow: '↗', cls: 'good' };
    if (BAD_TRENDS.has(word)) return { arrow: '↘', cls: 'bad' };
    return { arrow: '→', cls: 'neutral' };
}

function trendBadge(word, e) {
    const trend = trendMeta(word);
    return `<span class="proj-trend proj-trend--${trend.cls}">${trend.arrow} ${e(word || 'steady')}</span>`;
}

// Fixed month-name formatting, not Intl/locale-dependent — deterministic
// regardless of the host Node build's ICU data.
function shortDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function attr(value) {
    return String(value).replace(/"/g, '&quot;');
}

/**
 * Real historical points from Time-Engine checkpoints (2-12 of them,
 * whatever the vault actually retains) plus one projected point.
 *
 * Rebuilt 2026-07-13 after the previous version rendered visibly broken in
 * the real webview: an SVG with `preserveAspectRatio="none"` stretched into
 * a wide, short box scales x and y by different factors, which distorts
 * anything whose *shape* matters — `<circle>` elements become ellipses,
 * and stroke width visually thickens or thins depending on a path
 * segment's local direction, exactly the "shitty circles"/"thick lines"
 * the user was pointing at. The fix: only the line and area-fill *paths*
 * are drawn in the distorted SVG coordinate space (a stretched trend line
 * is normal and expected — chart lines are supposed to fill the box).
 * Everything whose shape must stay correct — the dots, the projected
 * marker, the vertical "now" guide — is rendered as ordinary HTML/CSS
 * elements positioned with percentage `left`/`top` over the chart, which
 * are never subject to the SVG viewBox's anisotropic scale. `vector-effect
 * ="non-scaling-stroke"` on the line paths keeps their stroke width
 * constant in real screen pixels regardless of the box's aspect ratio.
 * @param {{weeklyTotals?: number[], checkpointDates?: string[], projected90?: number}} leader
 * @param {number} horizonDays
 * @returns {string}
 */
function buildGrowthLineChart(leader, horizonDays) {
    const totals = (leader.weeklyTotals || []).map((n) => Math.max(0, Number(n) || 0));
    if (totals.length < 2) return '';
    const dates = leader.checkpointDates || [];
    const projected = Math.max(0, Number(leader.projected90) || 0);
    const values = [...totals, projected];
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const rawSpan = rawMax - rawMin;
    // Real, honest headroom above/below the actual data range — not padded
    // out to a round number, since there is no "clean" axis maximum to
    // pretend to here, just whatever the vault's real counts are.
    const pad = rawSpan === 0 ? Math.max(1, Math.round(rawMax * 0.15) || 1) : Math.max(1, rawSpan * 0.2);
    const min = Math.max(0, rawMin - pad);
    const max = rawMax + pad;
    const span = max - min || 1;
    const lastIdx = totals.length - 1;

    // Percentage coordinates (0-100), shared 1:1 between the SVG viewBox and
    // the HTML overlay elements — no separate unit conversion to keep in sync.
    const xPad = 2;
    const xs = values.map((_, i) => xPad + (i / (values.length - 1)) * (100 - xPad * 2));
    const ys = values.map((v) => 100 - ((v - min) / span) * 100);

    const historicalPath = xs.slice(0, totals.length).map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${ys[i].toFixed(2)}`).join(' ');
    const projectedPath = `M${xs[lastIdx].toFixed(2)},${ys[lastIdx].toFixed(2)} L${xs[lastIdx + 1].toFixed(2)},${ys[lastIdx + 1].toFixed(2)}`;
    const areaPath = `${historicalPath} L${xs[lastIdx].toFixed(2)},100 L${xs[0].toFixed(2)},100 Z`;
    const projectedGuideX = xs[lastIdx + 1].toFixed(2);

    const dots = xs.slice(0, totals.length).map((x, i) => {
        const date = shortDate(dates[i]);
        const tip = date ? `${date} — ${totals[i]} note${totals[i] === 1 ? '' : 's'}` : `${totals[i]} note${totals[i] === 1 ? '' : 's'}`;
        return `<div class="proj-dot" style="left:${x.toFixed(2)}%;top:${ys[i].toFixed(2)}%" data-tip="${attr(tip)}"></div>`;
    }).join('');
    const projectedTip = `In ${horizonDays} days (projected) — about ${projected} note${projected === 1 ? '' : 's'}`;
    const projectedDot = `<div class="proj-dot proj-dot--projected" style="left:${xs[lastIdx + 1].toFixed(2)}%;top:${ys[lastIdx + 1].toFixed(2)}%" data-tip="${attr(projectedTip)}"></div>`;

    // Real Y-axis: three horizontal gridlines with the actual numeric values
    // they represent, not a single vague "range N-M" caption in the corner.
    const midValue = (min + max) / 2;
    const yAxisLabels = `
        <div class="proj-yaxis">
            <span class="proj-yaxis-label" style="top:0%">${Math.round(max)}</span>
            <span class="proj-yaxis-label" style="top:50%">${Math.round(midValue)}</span>
            <span class="proj-yaxis-label" style="top:100%">${Math.round(min)}</span>
        </div>`;
    const currentLabel = totals[lastIdx];

    return `
        <div class="proj-line-meta">
            <span class="proj-line-meta-value">${currentLabel} notes now</span>
        </div>
        <div class="proj-chart-body">
            ${yAxisLabels}
            <div class="proj-chart-plot">
                <svg class="proj-line-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Vault note count history, from real reconstructed checkpoints, with a ${horizonDays}-day projection">
                    <defs>
                        <linearGradient id="proj-growth-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="${LAVENDER}" stop-opacity="0.30" />
                            <stop offset="100%" stop-color="${LAVENDER}" stop-opacity="0" />
                        </linearGradient>
                    </defs>
                    <line x1="0" y1="0" x2="100" y2="0" class="proj-grid-line" vector-effect="non-scaling-stroke" />
                    <line x1="0" y1="50" x2="100" y2="50" class="proj-grid-line" vector-effect="non-scaling-stroke" />
                    <line x1="0" y1="100" x2="100" y2="100" class="proj-grid-line proj-grid-line--base" vector-effect="non-scaling-stroke" />
                    <path d="${areaPath}" class="proj-line-area" />
                    <path d="${historicalPath}" class="proj-line-path" fill="none" vector-effect="non-scaling-stroke" />
                    <path d="${projectedPath}" class="proj-line-path proj-line-path--projected" fill="none" vector-effect="non-scaling-stroke" />
                </svg>
                <div class="proj-guide-projected" style="left:${projectedGuideX}%"></div>
                ${dots}
                ${projectedDot}
            </div>
        </div>
        <div class="proj-line-labels">
            <span>Earliest checkpoint</span><span>Now</span><span class="proj-line-label--projected">In ${horizonDays} days</span>
        </div>`;
}

function formatAccuracyNote(retrospectiveAccuracy, horizonDays) {
    if (!retrospectiveAccuracy) return '';
    const pct = Math.round((retrospectiveAccuracy.accuracy || 0) * 100);
    return `<p class="proj-panel-footnote">${horizonDays}d ago, this same model would have projected about ${retrospectiveAccuracy.projected} notes for today — actual is ${retrospectiveAccuracy.actual} (${pct}% accurate on that call).</p>`;
}

function formatFitNote(r2) {
    if (typeof r2 !== 'number') return '';
    const pct = Math.round(r2 * 100);
    return `<span class="proj-fit-note">fit: r²=${r2.toFixed(2)} (${pct}% of the variation in history explained by a straight trend)</span>`;
}


function buildSecondaryList(entries, e) {
    if (!entries.length) return '';
    const rows = entries.map((entry) => `<div class="proj-secondary-row"><code>${e(entry.type)}</code><span>${e(entry.text)}</span></div>`).join('');
    return `<div class="proj-secondary-list">${rows}</div>`;
}

function buildEmptyPanel(key, message) {
    return `<div class="proj-panel" data-proj-panel="${key}" style="display:none"><div class="proj-panel-empty">${message}</div></div>`;
}

function buildGrowthPanel(growth, isActive, e) {
    const key = 'growth';
    if (!growth || !evidenceOk(growth.evidenceScore) || !growth.topTypes?.length) {
        return buildEmptyPanel(key, 'Not enough note-creation activity yet to project growth — this fills in once the vault has a few weeks of new notes to learn from.');
    }
    const leader = growth.topTypes[0];
    const horizonDays = 90;
    const chart = buildGrowthLineChart(leader, horizonDays);
    const also = buildSecondaryList(
        (growth.topTypes || []).slice(1, 3).map((t) => ({ type: t.type, text: `${t.currentTotal} notes now, about ${t.projected90} projected in ${horizonDays} days` })),
        e
    );
    const fitNote = formatFitNote(growth.r2);
    const accuracyNote = formatAccuracyNote(growth.retrospectiveAccuracy, horizonDays);
    return `<div class="proj-panel" data-proj-panel="${key}" style="display:${isActive ? 'flex' : 'none'}">
        <div class="proj-panel-head${fitNote ? ' proj-panel-head--split' : ''}">${trendBadge(growth.trend, e)}${fitNote}</div>
        ${chart ? `<div class="proj-chart-wrap">${chart}</div>` : ''}
        <p class="proj-panel-text">${e(growth.summary)}</p>
        ${also}
        ${accuracyNote}
    </div>`;
}

/**
 * @param {Array<{noteId: string, type: string|null, daysUntilStale: number}>} upcoming
 * @param {function} e
 * @returns {string}
 */
function buildUpcomingStaleList(upcoming, e) {
    if (!upcoming || !upcoming.length) return '';
    const rows = upcoming.slice(0, 5).map((n) =>
        `<div class="proj-secondary-row"><code>${e(n.noteId)}</code><span>in ${n.daysUntilStale} day${n.daysUntilStale === 1 ? '' : 's'}</span></div>`
    ).join('');
    return `<div class="proj-secondary-list">
        <div class="proj-secondary-list-label">Going stale soonest</div>
        ${rows}
    </div>`;
}

// Stale and Structure gained real per-checkpoint historical trajectories in
// the 2026-07-16 Phase 3 rebuild (see src/intelligence/vaultTrends.js's
// buildLaneTrajectories) — both now render the same real line chart Growth
// already used, instead of the old two-number stat card (which existed
// specifically because these two lanes never had real historical points
// before). `buildGrowthLineChart` only ever needed `weeklyTotals`/
// `checkpointDates`/`projected90`, which `stale`/`structure` now carry
// directly — no separate "leader" object needed, unlike Growth's per-type
// breakdown.
function buildStalePanel(stale, scenarios, isActive, e) {
    const key = 'stale';
    if (!stale || !evidenceOk(stale.evidenceScore) || !stale.total) {
        return buildEmptyPanel(key, 'Not enough note history yet to measure staleness with confidence.');
    }
    const horizonDays = 90;
    const chart = buildGrowthLineChart(stale, horizonDays);
    const also = buildSecondaryList(
        (stale.topTypes || []).slice(1, 3).map((t) => ({ type: t.type, text: `${t.stale} of ${t.total} stale` })),
        e
    );
    const fitNote = formatFitNote(stale.r2);
    const accuracyNote = formatAccuracyNote(stale.retrospectiveAccuracy, horizonDays);
    const upcomingList = buildUpcomingStaleList(stale.upcoming, e);
    return `<div class="proj-panel" data-proj-panel="${key}" style="display:${isActive ? 'flex' : 'none'}">
        <div class="proj-panel-head${fitNote ? ' proj-panel-head--split' : ''}">${trendBadge(stale.trend, e)}${fitNote}</div>
        ${chart ? `<div class="proj-chart-wrap">${chart}</div>` : ''}
        <p class="proj-panel-text">${e(stale.summary)}</p>
        ${also}
        ${upcomingList}
        ${accuracyNote}
    </div>`;
}

function buildStructurePanel(structure, scenarios, isActive, e) {
    const key = 'structure';
    if (!structure || !evidenceOk(structure.evidenceScore) || !structure.sampled) {
        return buildEmptyPanel(key, 'No structural sample yet — this fills in once enough typed notes exist to compare shapes.');
    }
    const horizonDays = 90;
    const chart = buildGrowthLineChart(structure, horizonDays);
    // The primary sentence (structure.summary, built in healthStats.js) now
    // names the leading offending type directly — no separate "Most of that
    // comes from..." footnote burying the real answer beneath a vague
    // headline. A second/third type, when one exists, gets the same compact
    // secondary-row treatment Growth already uses, instead of more prose.
    const also = buildSecondaryList(
        (structure.topTypes || []).slice(1, 3).map((t) => ({
            type: t.type,
            text: `${t.problematic} of ${t.sampled}${t.topMissingFields?.length ? ` — missing ${t.topMissingFields.join(', ')}` : ''}`
        })),
        e
    );
    const fitNote = formatFitNote(structure.r2);
    const accuracyNote = formatAccuracyNote(structure.retrospectiveAccuracy, horizonDays);
    return `<div class="proj-panel" data-proj-panel="${key}" style="display:${isActive ? 'flex' : 'none'}">
        <div class="proj-panel-head${fitNote ? ' proj-panel-head--split' : ''}">${trendBadge(structure.direction, e)}${fitNote}</div>
        ${chart ? `<div class="proj-chart-wrap">${chart}</div>` : ''}
        <p class="proj-panel-text">${e(structure.summary)}</p>
        ${also}
        ${accuracyNote}
    </div>`;
}

function buildToggleRow(entries) {
    if (entries.length < 2) return '';
    return `<div class="proj-toggle-row" role="tablist">${entries.map((entry) => `
        <button class="proj-toggle-btn${entry.active ? ' active' : ''}" data-proj-toggle="${entry.key}" role="tab" aria-selected="${entry.active}">${entry.label}</button>`).join('')}</div>`;
}

/** @param {object|null} projections @param {function} e @returns {string} */
function buildVaultProjectionsCardHtml(projections, e) {
    if (!projections) return '';
    const { growth, stale, structure, scenarios } = projections;

    const available = [
        { key: 'growth', label: 'Growth', ok: !!growth && evidenceOk(growth.evidenceScore) && growth.topTypes?.length },
        { key: 'stale', label: 'Stale', ok: !!stale && evidenceOk(stale.evidenceScore) && !!stale.total },
        { key: 'structure', label: 'Structure', ok: !!structure && evidenceOk(structure.evidenceScore) && !!structure.sampled },
    ];
    const firstOkIndex = available.findIndex((entry) => entry.ok);
    const toggleEntries = available.map((entry, i) => ({ ...entry, active: i === firstOkIndex }));

    if (firstOkIndex === -1) {
        return `
        <div class="intel-card proj-dashboard-card" style="grid-column:1 / -1">
            <div class="proj-dashboard-head"><div class="intel-card-title">Vault Projections</div></div>
            <div class="proj-panel-empty">Not enough vault activity yet to project anything — write and link a few more notes, then check back here.</div>
        </div>`;
    }

    return `
        <div class="intel-card proj-dashboard-card" style="grid-column:1 / -1">
            <div class="proj-dashboard-head">
                <div class="intel-card-title">Vault Projections</div>
            </div>
            <div class="intel-confidence-sub proj-dashboard-sub">What the last ${projections.windowDays} days of activity suggest about where the vault is heading over the next 90 days.</div>
            ${buildToggleRow(toggleEntries)}
            ${buildGrowthPanel(growth, toggleEntries[0].active, e)}
            ${buildStalePanel(stale, scenarios, toggleEntries[1].active, e)}
            ${buildStructurePanel(structure, scenarios, toggleEntries[2].active, e)}
        </div>
    `;
}

const VAULT_PROJECTIONS_CSS = `
.intel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.intel-card {
    background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.06);
    border-radius: 8px; padding: 12px 14px;
}
.intel-card-title { font-size: 12px; font-weight: 600; color: var(--vscode-editor-foreground, #cccccc); margin-bottom: 8px; }
.intel-confidence-sub { font-size: 12px; color: var(--vscode-descriptionForeground, #95a1ac); line-height: 1.5; }

.proj-dashboard-card { padding: 10px 12px 11px; position: relative; display: flex; flex-direction: column; }
.proj-dashboard-head { display: block; flex: 0 0 auto; }
.proj-dashboard-head .intel-card-title { margin-bottom: 5px; }
.proj-dashboard-sub { margin-bottom: 10px; max-width: 860px; font-size: 11px; line-height: 1.35; flex: 0 0 auto; }

.proj-toggle-row { display: flex; gap: 6px; margin-bottom: 10px; flex: 0 0 auto; }
.proj-toggle-btn {
    font-size: 11px; font-weight: 600; padding: 5px 12px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.02);
    color: var(--vscode-descriptionForeground, #95a1ac); cursor: pointer;
}
.proj-toggle-btn:disabled { opacity: .35; cursor: not-allowed; }
.proj-toggle-btn.active { background: rgba(196,155,240,.14); border-color: rgba(196,155,240,.4); color: var(--vscode-editor-foreground, #cccccc); }

.proj-panel-empty { font-size: 12px; color: var(--vscode-disabledForeground, #69727d); line-height: 1.4; padding: 6px 0; }
.proj-panel { flex-direction: column; min-height: 0; }
.proj-panel-head { display: flex; justify-content: flex-end; align-items: baseline; gap: 8px; margin-bottom: 4px; flex: 0 0 auto; }
.proj-panel-head--split { justify-content: space-between; }
.proj-fit-note { font-size: 10px; color: var(--vscode-disabledForeground, #69727d); }
.proj-panel-text { font-size: 12px; color: var(--vscode-editor-foreground, #cccccc); line-height: 1.45; margin: 0 0 10px; flex: 0 0 auto; }
.proj-panel-footnote { font-size: 11px; color: var(--vscode-descriptionForeground, #95a1ac); line-height: 1.4; margin: 6px 0 0; flex: 0 0 auto; }
.proj-panel-footnote code, .proj-panel-text code { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; color: ${LAVENDER}; }

.proj-trend { font-size: 10px; font-weight: 600; }
.proj-trend--good { color: ${MINT}; }
.proj-trend--bad { color: ${ERROR}; }
.proj-trend--neutral { color: var(--vscode-descriptionForeground, #95a1ac); }

/* Fixed, bounded height — a concrete pixel value, not a percentage/flex
   chain chasing an ancestor's available space (that blew up to an
   undefined height in the real webview once already — see the
   2026-07-13 regression note in SESSION_LOG.md). */
.proj-chart-wrap {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    margin: 8px 0 12px;
    height: 220px;
    padding: 10px 12px 8px;
    border: 1px solid rgba(255,255,255,.05);
    border-radius: 10px;
    background: rgba(255,255,255,.015);
}
.proj-line-meta {
    flex: 0 0 auto;
    margin-bottom: 8px;
    font-size: 10px;
    color: var(--vscode-editor-foreground, #cccccc);
    font-weight: 600;
    letter-spacing: .03em;
}
/* The plot area: a fixed-width Y-axis label column beside the actual
   chart. Both the SVG (line/area only) and the dot/guide overlay share
   the same percentage coordinate space 1:1. */
.proj-chart-body { flex: 1; min-height: 0; display: flex; gap: 8px; }
.proj-yaxis { flex: 0 0 auto; position: relative; width: 20px; }
.proj-yaxis-label {
    position: absolute; left: 0; transform: translateY(-50%);
    font-size: 9px; color: var(--vscode-disabledForeground, #69727d);
}
.proj-chart-plot { position: relative; flex: 1; min-width: 0; }
.proj-grid-line { stroke: rgba(255,255,255,.06); stroke-width: 1; }
.proj-grid-line--base { stroke: rgba(255,255,255,.14); }
.proj-line-chart { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.proj-line-area { fill: url(#proj-growth-fill); }
.proj-line-path { stroke: ${LAVENDER}; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.proj-line-path--projected { stroke-dasharray: 5 4; opacity: .85; }
/* Dots are real HTML elements, not SVG circles — an SVG circle element
   inside an SVG stretched by preserveAspectRatio=none becomes an ellipse,
   since the viewBox scales x and y by different factors. A fixed-size div
   with border-radius:50% is immune to that; it stays a perfect circle no
   matter how the chart box is stretched. */
.proj-dot {
    position: absolute; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px;
    border-radius: 50%; background: ${LAVENDER}; cursor: default;
}
.proj-dot--projected {
    width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px;
    background: rgba(20,20,20,.9); border: 2px solid ${LAVENDER};
}
.proj-guide-projected {
    position: absolute; top: 0; bottom: 0; width: 0;
    border-left: 1px dashed rgba(196,155,240,.3);
}
.proj-line-labels { display: flex; justify-content: space-between; font-size: 9px; color: var(--vscode-disabledForeground, #69727d); margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.04); flex: 0 0 auto; text-transform: uppercase; letter-spacing: .08em; }
.proj-line-label--projected { font-style: italic; }

.proj-secondary-list { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.05); display: flex; flex-direction: column; gap: 3px; flex: 0 0 auto; }
.proj-secondary-list-label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--vscode-disabledForeground, #69727d); font-weight: 700; margin-bottom: 2px; }
.proj-secondary-row { display: flex; justify-content: space-between; gap: 8px; font-size: 10px; color: var(--vscode-descriptionForeground, #95a1ac); }
.proj-secondary-row code { font-family: var(--vscode-editor-font-family, monospace); color: ${LAVENDER}; }
`;

module.exports = { buildVaultProjectionsCardHtml, VAULT_PROJECTIONS_CSS };
