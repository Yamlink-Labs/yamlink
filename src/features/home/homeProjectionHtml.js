'use strict';

const { esc } = require('../../runtime/mutationNarratives');

// Compact per-week mini bar chart (created/touches/structure) from the same
// history buckets Vault Health's "Recent 4-week pattern" uses — a smaller,
// glanceable version for the Home tab's tight no-scroll layout. Each column
// carries its full breakdown in a title attribute rather than inline text,
// keeping the strip a single row tall.
// Below this, there isn't enough real signal to say anything honest about a
// metric — it's left out of the strip entirely (silence) rather than shown
// with a confident-looking sentence backed by almost no evidence. Same floor
// vaultProjectionsCard.js uses for the full Projections tab, so the compact
// strip and the detail view never disagree about what's worth saying.
// Plain, concrete sentences — no jargon ("evidence %", "sampled"), no
// unbacked trend claims. Each function either names real numbers from this
// vault, or returns '' so the line is left out rather than shown empty.
const EVIDENCE_FLOOR = 0.15;
function pct(x) {
    return `${Math.round((x || 0) * 100)}%`;
}

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

function evidenceOk(score) {
    return typeof score === 'number' && score >= EVIDENCE_FLOOR;
}

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

module.exports = { buildProjectionStripHtml };
