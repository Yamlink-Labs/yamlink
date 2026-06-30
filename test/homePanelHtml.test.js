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
                cleanupLift: {
                    confidence: 'high',
                    projectedStaleShare: 0.02,
                    projectedProblematic: 0,
                    summary: 'If cleanup rhythm improves modestly, stale share could fall toward 2% and problematic notes toward 0 over the same horizon.'
                },
                growthHold: {
                    confidence: 'medium',
                    summary: 'If note creation stays at its current pace, character remains the strongest growth lane at roughly 18 notes in 90 days.',
                    topTypes: [{ type: 'character', projected90: 18, confidence: 'medium' }]
                }
            },
            growth: {
                confidence: 'medium',
                evidenceScore: 0.58,
                trend: 'rising',
                summary: 'character notes are growing fastest.',
                topTypes: [{ type: 'character', createdLast30d: 3, currentTotal: 9, projected90: 18, confidence: 'medium' }]
            },
            stale: {
                confidence: 'medium',
                pressure: 'low',
                evidenceScore: 0.51,
                trend: 'improving',
                staleRate: 0.08,
                touchEventsRecent: 6,
                summary: 'Current stale pressure is low.',
                topTypes: [{ type: 'dossier', staleRate: 0.5, stale: 1, total: 2, touchEventsRecent: 0 }]
            },
            structure: {
                confidence: 'high',
                direction: 'improving',
                evidenceScore: 0.82,
                trend: 'rising',
                problematic: 2,
                acceptedCompletionsRecent: 4,
                structureEventsRecent: 7,
                summary: 'Structural edits are trending in the right direction.',
                topTypes: [{ type: 'character', problematicRate: 0.33, problematic: 1, sampled: 3 }]
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

    assert.match(html, /Projection Snapshot/);
    assert.match(html, /Vault Health →/);
    assert.match(html, /projection-trend-strip/);
    assert.match(html, /58% evidence/);
    assert.match(html, /character → ~18/);
    assert.match(html, /dossier 50% stale/);
    assert.match(html, /If cleanup rhythm improves modestly/);
    assert.match(html, /Current stale pressure is low\./);
    assert.match(html, /Structural edits are trending in the right direction\./);
    assert.match(html, /character 33% drift/);
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
