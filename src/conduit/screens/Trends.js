'use strict';

const React = require('react');
const Panel = require('../components/Panel');
const { p, SYM } = require('../palette');

function pad(text, width) {
    const value = String(text ?? '');
    return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function truncate(text, width) {
    const value = String(text ?? '');
    if (value.length <= width) return value;
    if (width <= 1) return value.slice(0, width);
    return value.slice(0, width - 1) + '…';
}

function formatLaneRows(trends) {
    return [
        {
            lane: 'growth',
            status: trends?.growth?.trend || 'steady',
            current: currentGrowth(trends),
            projected: trends?.growth?.topTypes?.[0]?.projected90 ?? '',
            r2: formatNumber(trends?.growth?.r2),
            summary: trends?.growth?.summary || ''
        },
        {
            lane: 'stale',
            status: trends?.stale?.trend || 'steady',
            current: trends?.stale?.staleCount ?? '',
            projected: trends?.stale?.projected90 ?? '',
            r2: formatNumber(trends?.stale?.r2),
            summary: trends?.stale?.summary || ''
        },
        {
            lane: 'structure',
            status: trends?.structure?.trend || trends?.structure?.direction || 'steady',
            current: trends?.structure?.problematic ?? '',
            projected: trends?.structure?.projected90 ?? '',
            r2: formatNumber(trends?.structure?.r2),
            summary: trends?.structure?.summary || ''
        }
    ];
}

function formatRetrospectiveRows(trends) {
    return ['growth', 'stale', 'structure'].map((lane) => {
        const retro = trends?.[lane]?.retrospectiveAccuracy || null;
        return {
            lane,
            projected: retro ? retro.projected : 'n/a',
            actual: retro ? retro.actual : 'n/a',
            accuracy: retro ? `${Math.round(Number(retro.accuracy || 0) * 100)}%` : 'n/a'
        };
    });
}

function formatForecastRows(trends, limit = 8) {
    const upcoming = Array.isArray(trends?.stale?.upcoming) ? trends.stale.upcoming : [];
    return upcoming.slice(0, limit).map((entry) => ({
        note: String(entry.noteId || ''),
        type: String(entry.type || ''),
        days: Number(entry.daysUntilStale || 0)
    }));
}

function currentGrowth(trends) {
    const top = trends?.growth?.topTypes?.[0];
    if (top && top.currentTotal !== undefined) return top.currentTotal;
    return '';
}

function formatNumber(value) {
    return value === null || value === undefined ? 'n/a' : Number(value).toFixed(2);
}

function trendColor(status) {
    const value = String(status || '').toLowerCase();
    if (value === 'rising' || value === 'improving') return p.ok;
    if (value === 'worsening' || value === 'fragile' || value === 'falling') return p.warn;
    return p.secondary;
}

function Trends({ ink, host, port, getTrends, onNavigate, onQuit, disabled, width }) {
    const { Box, Text, useInput } = ink;
    const [state, setState] = React.useState({ loading: true, trends: null, error: '' });

    useInput((input, key) => {
        if (key.ctrl && input === 'c') { onQuit(); return; }
        if (input === '1') { onNavigate('briefing'); return; }
        if (input === '5') { onNavigate('health'); return; }
        if (key.escape || input === 'q') { onNavigate('briefing'); return; }
    }, { isActive: !disabled });

    React.useEffect(() => {
        let cancelled = false;
        setState((current) => ({ ...current, loading: true, error: '' }));
        getTrends({ host, port }).then((trends) => {
            if (cancelled) return;
            setState({ loading: false, trends, error: '' });
        }).catch((err) => {
            if (cancelled) return;
            setState({ loading: false, trends: null, error: err.message || String(err) });
        });
        return () => { cancelled = true; };
    }, [getTrends, host, port]);

    if (state.loading) {
        return React.createElement(
            Box,
            { flexDirection: 'column', width: width || '100%', paddingX: 1 },
            React.createElement(Panel, {
                ink, title: 'Vault Trends', flexGrow: 1,
                children: React.createElement(Text, null, p.muted(`  ${SYM.idle}  loading...`))
            })
        );
    }

    if (state.error) {
        return React.createElement(
            Box,
            { flexDirection: 'column', width: width || '100%', paddingX: 1 },
            React.createElement(Panel, {
                ink, title: 'Vault Trends', flexGrow: 1,
                children: React.createElement(Text, null, p.err('  ' + state.error))
            })
        );
    }

    const laneRows = formatLaneRows(state.trends);
    const retroRows = formatRetrospectiveRows(state.trends);
    const forecastRows = formatForecastRows(state.trends);

    return React.createElement(
        Box,
        { flexDirection: 'column', width: width || '100%', paddingX: 1 },
        React.createElement(Panel, {
            ink, title: 'Trend Lines',
            children: React.createElement(
                Box,
                { flexDirection: 'column' },
                React.createElement(Text, null,
                    '  ' + p.muted(pad('LANE', 12)) +
                    p.muted(pad('TREND', 12)) +
                    p.muted(pad('NOW', 8)) +
                    p.muted(pad('90D', 8)) +
                    p.muted('R²')
                ),
                React.createElement(Text, null, ''),
                ...laneRows.map((row) => React.createElement(Text, { key: row.lane },
                    '  ' + p.primary(pad(row.lane, 12)) +
                    trendColor(row.status)(pad(row.status, 12)) +
                    p.num(pad(row.current, 8)) +
                    p.num(pad(row.projected, 8)) +
                    p.secondary(row.r2)
                )),
                React.createElement(Text, null, ''),
                ...laneRows.map((row) => React.createElement(Text, { key: `${row.lane}-summary` },
                    '  ' + p.faint(SYM.dot + ' ') + p.muted(truncate(row.summary, 120))
                ))
            )
        }),
        React.createElement(Panel, {
            ink, title: 'Retrospective Accuracy',
            children: React.createElement(
                Box,
                { flexDirection: 'column' },
                ...retroRows.map((row) => React.createElement(Text, { key: row.lane },
                    '  ' + p.primary(pad(row.lane, 12)) +
                    p.muted('projected ') + p.num(pad(row.projected, 8)) +
                    p.muted('actual ') + p.num(pad(row.actual, 8)) +
                    p.muted('accuracy ') + p.ok(row.accuracy)
                ))
            )
        }),
        React.createElement(Panel, {
            ink, title: 'Staleness Forecast',
            children: forecastRows.length
                ? React.createElement(
                    Box,
                    { flexDirection: 'column' },
                    ...forecastRows.map((row) => React.createElement(Text, { key: row.note },
                        '  ' + p.primary(pad(truncate(row.note, 28), 30)) +
                        p.type(pad(truncate(row.type, 14), 16)) +
                        p.warn(`${row.days}d`)
                    ))
                )
                : React.createElement(Text, null, '  ' + p.muted('No notes are approaching the stale threshold.'))
        })
    );
}

module.exports = Trends;
module.exports.formatLaneRows = formatLaneRows;
module.exports.formatRetrospectiveRows = formatRetrospectiveRows;
module.exports.formatForecastRows = formatForecastRows;
