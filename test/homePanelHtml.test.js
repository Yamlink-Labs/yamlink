'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildHomeHtml } = require('../src/features/home/homePanelHtml');

test('home panel renders projection snapshot when projections exist', () => {
    const html = buildHomeHtml({
        noteCount: 12,
        typeCount: 4,
        brokenCount: 1,
        activityEvents: [],
        recentNoteIds: [],
        types: ['character', 'mission'],
        nudges: [],
        tasks: { overdue: [], today: [], upcoming: [], undated: [] },
        projections: {
            windowDays: 30,
            history: {
                bucketDays: 7,
                buckets: [
                    { label: 'W1', created: 0, touches: 1, structure: 0, completions: 0 },
                    { label: 'W2', created: 1, touches: 2, structure: 1, completions: 0 },
                    { label: 'W3', created: 2, touches: 3, structure: 2, completions: 1 },
                    { label: 'W4', created: 3, touches: 4, structure: 3, completions: 1 }
                ]
            },
            scenarios: {
                horizonDays: 90,
                cleanupHold: {
                    confidence: 'medium',
                    projectedStaleShare: 0.04,
                    projectedProblematic: 1,
                    summary: 'If the current cleanup pace holds for 90 days, stale share could ease to about 4% and problematic notes to about 1.'
                },
            },
            // growthHold removed with the Time-Engine-backed rebuild — the
            // real trend-fit/retrospective-accuracy summary now lives
            // directly on growth.summary/growth.r2/growth.retrospectiveAccuracy.
            growth: {
                confidence: 'medium',
                evidenceScore: 1,
                trend: 'rising',
                summary: 'character notes are growing fastest.',
                r2: 0.91,
                slope: 0.3,
                retrospectiveAccuracy: null,
                topTypes: [{ type: 'character', currentTotal: 9, projected90: 18, r2: 0.91, slope: 0.3, weeklyTotals: [5, 6, 7, 9] }]
            },
            stale: {
                confidence: 'medium',
                pressure: 'low',
                evidenceScore: 0.51,
                trend: 'improving',
                staleRate: 0.08,
                staleCount: 1,
                total: 12,
                touchEventsRecent: 6,
                summary: '1 of 12 notes (8%) haven\'t been changed in 90+ days. At your current review pace, that could fall to about 0 in 90 days.',
                topTypes: [{ type: 'dossier', staleRate: 0.5, stale: 1, total: 2, touchEventsRecent: 0 }]
            },
            structure: {
                confidence: 'high',
                direction: 'improving',
                evidenceScore: 0.82,
                trend: 'rising',
                problematic: 2,
                sampled: 6,
                acceptedCompletionsRecent: 4,
                structureEventsRecent: 7,
                summary: 'Structural edits are trending in the right direction.',
                topTypes: [{ type: 'character', problematicRate: 0.33, problematic: 1, sampled: 3, topMissingFields: ['homeworld', 'rank'] }]
            }
        },
        fieldsCache: new Map(),
        idIndex: new Map(),
        vaultName: 'Test Vault',
        todayDate: 'Monday, June 23, 2026'
    }, {
        nonce: 'nonce',
        csp: "'unsafe-inline'",
        scriptUri: 'home.js',
        logoUri: 'logo.png'
    });

    // Compact teaser strip only — the full Growth/Stale/Structure card (with
    // its own chart/trend-badge/stat-card markup) now lives exclusively in
    // Vault Health's dedicated Projections tab (see healthHtml.js), not
    // duplicated inside Home. This strip is a plain-language summary that
    // links out to Vault Health, per direct user feedback that the
    // full-card treatment inside Home wasn't good enough to earn a full
    // feature slot there.
    assert.match(html, /Projection Snapshot/);
    assert.match(html, /Vault Health →/);
    assert.match(html, /projection-trend-strip/);

    // Real numbers named directly, no "% evidence" jargon, no bare
    // confidence badges.
    assert.match(html, /is your fastest-growing type — 9 notes now, on track for about 18 in 90 days/);
    assert.match(html, /Based on your vault activity, about 8% of notes \(1 of 12\) haven't been changed in 90\+ days/);
    assert.match(html, /doesn't match the shape the rest usually have/);
    assert.ok(!/evidence/i.test(html), 'no "evidence" jargon anywhere in the rendered snapshot');

    // No dedicated Projections tab or full-card markup in Home anymore.
    assert.ok(!html.includes('data-tab="projections"'), 'no Home-tab Projections button — the tab was removed');
    assert.ok(!html.includes('id="tab-projections"'), 'no Home-tab Projections content — the tab was removed');
    assert.ok(!/proj-line-chart/.test(html), 'no growth chart duplicated inside Home');
    assert.ok(!/proj-stat-card/.test(html), 'no stat card duplicated inside Home');

    // The strip links out to Vault Health via the same command as the
    // explicit "Open full Vault Health" action-chip, not a local tab switch.
    assert.match(html, /data-command="yamlink.openHealthPanel"/);
});

test('home panel omits the projection snapshot strip entirely when there are no projections', () => {
    const html = buildHomeHtml({
        noteCount: 2, typeCount: 1, brokenCount: 0, activityEvents: [], recentNoteIds: [],
        types: ['note'], nudges: [], tasks: { overdue: [], today: [], upcoming: [], undated: [] },
        projections: null,
        fieldsCache: new Map(), idIndex: new Map(), vaultName: 'Test Vault', todayDate: 'Monday, June 23, 2026'
    }, { nonce: 'nonce', csp: "'unsafe-inline'", scriptUri: 'home.js', logoUri: 'logo.png' });

    assert.ok(!html.includes('Projection Snapshot'), 'no snapshot strip when there is nothing to show');
});

test('home panel activity feed renders semantic session chips when present', () => {
    const html = buildHomeHtml({
        noteCount: 4,
        typeCount: 2,
        brokenCount: 0,
        activityEvents: [],
        activitySessions: [{
            sessionId: 's1',
            summary: 'smart template applied on Johnny Rico with relation updated',
            primaryType: 'template_applied',
            primaryNoteId: 'johnny-rico',
            primaryTypeName: 'character',
            family: 'templating',
            familyLabel: 'Template',
            outcome: 'expanded',
            outcomeLabel: 'Expanded',
            focusFields: ['unit', 'rank'],
            count: 3,
            endedAt: '2026-06-23T10:02:00.000Z',
            relativeTime: 'just now'
        }],
        recentNoteIds: [],
        types: ['character'],
        nudges: [],
        tasks: { overdue: [], today: [], upcoming: [], undated: [] },
        projections: null,
        fieldsCache: new Map(),
        idIndex: new Map(),
        vaultName: 'Test Vault',
        todayDate: 'Monday, June 23, 2026'
    }, {
        nonce: 'nonce',
        csp: "'unsafe-inline'",
        scriptUri: 'home.js',
        logoUri: 'logo.png'
    });

    assert.match(html, /Template/);
    assert.match(html, /Expanded/);
    assert.match(html, /fields: unit, rank/);
    assert.match(html, /smart template applied on Johnny Rico/i);
});

test('stats charts carry hover tooltips on Link Density and Growth, not just the heatmap', () => {
    const html = buildHomeHtml({
        noteCount: 6,
        typeCount: 2,
        brokenCount: 0,
        activityEvents: [],
        recentNoteIds: [],
        types: ['character'],
        nudges: [],
        tasks: { overdue: [], today: [], upcoming: [], undated: [] },
        projections: null,
        heatmapData: { '2026-06-01': 3 },
        typeDistribution: { character: 4, mission: 2 },
        linkDistribution: { '0': 1, '1-2': 2, '3-5': 0, '6-10': 0, '10+': 0 },
        weeklyGrowth: [
            { label: 'W1', count: 0 },
            { label: 'W2', count: 2 },
            { label: 'W3', count: 1 }
        ],
        lifecycleCounts: { draft: 2, growing: 1, consolidated: 3, hub: 0, stale: 0 },
        fieldsCache: new Map(),
        idIndex: new Map(),
        vaultName: 'Test Vault',
        todayDate: 'Monday, June 23, 2026'
    }, {
        nonce: 'nonce',
        csp: "'unsafe-inline'",
        scriptUri: 'home.js',
        logoUri: 'logo.png'
    });

    // Link Density: every bucket row gets a data-tip hit area, including the empty ones.
    assert.match(html, /data-tip="0 links: 1 note"/);
    assert.match(html, /data-tip="1-2 links: 2 notes"/);
    assert.match(html, /data-tip="3-5 links: 0 notes"/);

    // Growth: every week gets a hover hit area, including zero-count weeks with no visible dot.
    assert.match(html, /data-tip="W1: 0 notes created"/);
    assert.match(html, /data-tip="W2: 2 notes created"/);
    assert.match(html, /data-tip="W3: 1 note created"/);

    // Still present: the heatmap's own native <title> tooltips and the donut/lifecycle <title>s.
    assert.match(html, /<title>2026-06-01: 3 changes<\/title>/);
    assert.match(html, /<title>character: 4<\/title>/);
});
