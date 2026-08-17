'use strict';

const fs   = require('fs');
const path = require('path');
const { esc } = require('../../runtime/mutationNarratives');
const {
    buildConnectivitySvg,
    buildDonutSvg,
    buildGrowthSvg,
    buildHeatmapSvg,
    buildLifecycleSvg,
    sct
} = require('./homeChartsHtml');
const { LUCIDE, svgIcon } = require('./homeIcons');
const { buildProjectionStripHtml } = require('./homeProjectionHtml');
const {
    buildFeedHtml,
    buildNudgesHtml,
    buildOverdueAlertHtml,
    buildRecentHtml,
    buildTasksHtml,
    pulseCard
} = require('./homeSectionsHtml');

const HOME_CSS = fs.readFileSync(path.join(__dirname, 'homePanel.css'), 'utf8');

const OUTCOME_TYPES = new Set(['completion_accepted', 'lightbulb_applied']);

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

module.exports = { buildHomeHtml, OUTCOME_TYPES };
