'use strict';

const { performance } = require('perf_hooks');
const vscode = require('vscode');

const DEFAULT_SLOW_THRESHOLD_MS = 40;
const DEFAULT_RECENT_SAMPLE_LIMIT = 12;

function nowMs() {
    return performance.now();
}

function formatDuration(durationMs) {
    return `${durationMs.toFixed(1)}ms`;
}

function formatDetails(details) {
    if (!details || typeof details !== 'object') return '';
    const parts = Object.entries(details)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}=${value}`);
    return parts.length ? ` (${parts.join(', ')})` : '';
}

/**
 * @typedef {{ label: string, count: number, avgMs: number, totalMs: number, maxMs: number, minMs: number, lastMs: number, slowCount: number }} PerfSummaryRow
 */

/**
 * @param {{ slowThresholdMs?: number, recentSampleLimit?: number }} [options]
 * @returns {{ createTimer: (label: string, details?: object) => { end: (extra?: object) => number }, measureSync: (label: string, details: object|null, fn: () => *) => *, measureAsync: (label: string, details: object|null, fn: () => Promise<*>) => Promise<*>, record: (label: string, durationMs: number, details?: object|null) => number, showReport: () => void, reset: () => void, buildReport: () => string, getSummaryRows: () => PerfSummaryRow[] }}
 */
function createPerformanceTracker(options = {}) {
    const slowThresholdMs = Number.isFinite(options.slowThresholdMs)
        ? options.slowThresholdMs
        : DEFAULT_SLOW_THRESHOLD_MS;
    const recentSampleLimit = Number.isFinite(options.recentSampleLimit)
        ? options.recentSampleLimit
        : DEFAULT_RECENT_SAMPLE_LIMIT;

    let outputChannel = null;
    const metrics = new Map();

    function getOutputChannel() {
        if (!outputChannel && vscode.window?.createOutputChannel) {
            outputChannel = vscode.window.createOutputChannel('Yamlink Performance');
        }
        return outputChannel;
    }

    function getMetric(label) {
        if (!metrics.has(label)) {
            metrics.set(label, {
                label,
                count: 0,
                totalMs: 0,
                maxMs: 0,
                minMs: Infinity,
                lastMs: 0,
                slowCount: 0,
                recent: []
            });
        }
        return metrics.get(label);
    }

    function appendRecent(metric, sample) {
        metric.recent.push(sample);
        if (metric.recent.length > recentSampleLimit) {
            metric.recent.shift();
        }
    }

    function record(label, durationMs, details = null) {
        if (!label || !Number.isFinite(durationMs)) return durationMs;
        const metric = getMetric(label);
        metric.count += 1;
        metric.totalMs += durationMs;
        metric.maxMs = Math.max(metric.maxMs, durationMs);
        metric.minMs = Math.min(metric.minMs, durationMs);
        metric.lastMs = durationMs;
        if (durationMs >= slowThresholdMs) metric.slowCount += 1;
        appendRecent(metric, {
            durationMs,
            details,
            recordedAt: new Date().toISOString()
        });

        const budgetMs = details && typeof details === 'object' && Number.isFinite(details.budgetMs)
            ? details.budgetMs
            : null;

        if (durationMs >= slowThresholdMs) {
            const channel = getOutputChannel();
            if (channel) {
                channel.appendLine(
                    `[slow] ${label}: ${formatDuration(durationMs)}${formatDetails(details)}`
                );
            }
        }
        if (budgetMs !== null && durationMs >= budgetMs) {
            const channel = getOutputChannel();
            if (channel) {
                channel.appendLine(
                    `[budget] ${label}: ${formatDuration(durationMs)} exceeded ${budgetMs}ms${formatDetails(details)}`
                );
            }
        }
        return durationMs;
    }

    function measureSync(label, details, fn) {
        const start = nowMs();
        try {
            return fn();
        } finally {
            record(label, nowMs() - start, details);
        }
    }

    async function measureAsync(label, details, fn) {
        const start = nowMs();
        try {
            return await fn();
        } finally {
            record(label, nowMs() - start, details);
        }
    }

    function createTimer(label, details) {
        const start = nowMs();
        let finished = false;
        return {
            end(extraDetails = null) {
                if (finished) return 0;
                finished = true;
                const mergedDetails = extraDetails
                    ? { ...(details || {}), ...extraDetails }
                    : details;
                return record(label, nowMs() - start, mergedDetails);
            }
        };
    }

    function getSummaryRows() {
        return Array.from(metrics.values())
            .sort((a, b) => b.totalMs - a.totalMs || b.maxMs - a.maxMs)
            .map((metric) => ({
                label: metric.label,
                count: metric.count,
                avgMs: metric.totalMs / Math.max(1, metric.count),
                totalMs: metric.totalMs,
                maxMs: metric.maxMs,
                minMs: metric.minMs === Infinity ? 0 : metric.minMs,
                lastMs: metric.lastMs,
                slowCount: metric.slowCount
            }));
    }

    function buildReport() {
        const rows = getSummaryRows();
        if (!rows.length) {
            return 'Yamlink performance report\n\nNo measurements recorded yet.';
        }

        const lines = ['Yamlink performance report', ''];
        for (const row of rows) {
            lines.push(
                `${row.label} :: count=${row.count} avg=${formatDuration(row.avgMs)} total=${formatDuration(row.totalMs)} max=${formatDuration(row.maxMs)} last=${formatDuration(row.lastMs)} slow=${row.slowCount}`
            );
        }
        return lines.join('\n');
    }

    function showReport() {
        const channel = getOutputChannel();
        if (!channel) return;
        channel.clear();
        channel.appendLine(buildReport());
        channel.show(true);
    }

    function reset() {
        metrics.clear();
        const channel = getOutputChannel();
        if (channel) {
            channel.appendLine('Performance metrics reset.');
        }
    }

    return {
        createTimer,
        measureAsync,
        measureSync,
        record,
        showReport,
        reset,
        buildReport,
        getSummaryRows
    };
}

const perfTracker = createPerformanceTracker();

module.exports = {
    createPerformanceTracker,
    perfTracker
};
