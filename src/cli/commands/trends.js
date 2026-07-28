'use strict';

const { buildVaultTrendsSnapshot } = require('../../features/health/healthStats');
const fmt = require('../format');
const { captureOutput, emitCliSuccess, emitText } = require('../io');

function run({ json, output }) {
    const data = buildVaultTrendsSnapshot();
    if (json) {
        emitCliSuccess(data, output);
        return;
    }

    emitText(captureOutput(() => {
        fmt.header('Vault Trends');
        fmt.row('Generated', data.generatedAt);
        fmt.row('Horizon', `${data.horizonDays || 90} days`);

        fmt.blank();
        fmt.subheader('Trend Lines');
        fmt.table(buildTrendRows(data), [
            { key: 'lane', label: 'lane' },
            { key: 'trend', label: 'trend' },
            { key: 'current', label: 'current' },
            { key: 'projected', label: 'projected' },
            { key: 'slope', label: 'slope/day' },
            { key: 'r2', label: 'r2' }
        ]);

        fmt.blank();
        fmt.subheader('Retrospective Accuracy');
        fmt.table(buildRetrospectiveRows(data), [
            { key: 'lane', label: 'lane' },
            { key: 'projected', label: 'projected' },
            { key: 'actual', label: 'actual' },
            { key: 'accuracy', label: 'accuracy' }
        ]);

        fmt.blank();
        fmt.subheader('Staleness Forecast');
        const upcoming = Array.isArray(data.stale?.upcoming) ? data.stale.upcoming : [];
        fmt.table(upcoming.map((entry) => ({
            note: entry.noteId,
            type: entry.type || '',
            days: entry.daysUntilStale
        })), [
            { key: 'note', label: 'note' },
            { key: 'type', label: 'type' },
            { key: 'days', label: 'days until stale' }
        ]);
        fmt.blank();
    }), output);
}

function buildTrendRows(data) {
    return [
        buildTrendRow('growth', data.growth, data.growth?.topTypes?.[0]?.currentTotal, data.growth?.topTypes?.[0]?.projected90),
        buildTrendRow('stale', data.stale, data.stale?.staleCount, data.stale?.projected90),
        buildTrendRow('structure', data.structure, data.structure?.problematic, data.structure?.projected90)
    ];
}

function buildTrendRow(lane, entry, current, projected) {
    return {
        lane,
        trend: entry?.trend || entry?.direction || 'steady',
        current: current ?? '',
        projected: projected ?? '',
        slope: formatNumber(entry?.slope),
        r2: formatNumber(entry?.r2)
    };
}

function buildRetrospectiveRows(data) {
    return ['growth', 'stale', 'structure'].map((lane) => {
        const retro = data[lane]?.retrospectiveAccuracy || null;
        return {
            lane,
            projected: retro ? retro.projected : 'n/a',
            actual: retro ? retro.actual : 'n/a',
            accuracy: retro ? `${Math.round(Number(retro.accuracy || 0) * 100)}%` : 'n/a'
        };
    });
}

function formatNumber(value) {
    return value === null || value === undefined ? 'n/a' : Number(value).toFixed(3);
}

module.exports = {
    run,
    buildTrendRows,
    buildRetrospectiveRows
};
