'use strict';

const { buildHistoricalGraph, reconstructVaultAtTime } = require('./timeEngine');

const DEFAULT_POINTS = 10;
const MAX_POINTS = 50;

function invalidParam(message) {
    /** @type {Error & { code?: string }} */
    const error = new Error(message);
    error.code = 'INVALID_PARAM';
    return error;
}

function parseTimestamp(value, name) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) {
        throw invalidParam(`Invalid "${name}" timestamp - expected ISO-8601`);
    }
    return new Date(ms).toISOString();
}

function parsePoints(value) {
    if (value === null || value === undefined || value === '') return DEFAULT_POINTS;
    const points = Number(value);
    if (!Number.isInteger(points) || points < 1) {
        throw invalidParam('Invalid "points" value - expected a positive integer');
    }
    if (points > MAX_POINTS) {
        throw invalidParam(`Invalid "points" value - maximum is ${MAX_POINTS}`);
    }
    return points;
}

function parseIntervalMs(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const match = raw.match(/^(\d+)(m|h|d|w)$/i);
    if (!match) {
        throw invalidParam('Invalid "interval" value - expected Nm, Nh, Nd, or Nw');
    }
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multipliers = { m: 60000, h: 3600000, d: 86400000, w: 604800000 };
    return amount * multipliers[unit];
}

function buildCheckpointTimestamps({ since, until, points, interval }) {
    const sinceIso = parseTimestamp(since, 'since');
    if (!sinceIso) {
        throw invalidParam('Missing required "since" timestamp');
    }
    const untilIso = parseTimestamp(until, 'until') || new Date().toISOString();
    const startMs = Date.parse(sinceIso);
    const endMs = Date.parse(untilIso);
    if (endMs < startMs) {
        throw invalidParam('"until" must be greater than or equal to "since"');
    }

    const intervalMs = parseIntervalMs(interval);
    if (intervalMs) {
        const timestamps = [];
        for (let ms = startMs; ms <= endMs && timestamps.length < MAX_POINTS; ms += intervalMs) {
            timestamps.push(new Date(ms).toISOString());
        }
        if (!timestamps.length || timestamps[timestamps.length - 1] !== untilIso) {
            if (timestamps.length >= MAX_POINTS) {
                throw invalidParam(`Requested interval produces more than ${MAX_POINTS} checkpoints`);
            }
            timestamps.push(untilIso);
        }
        return { since: sinceIso, until: untilIso, points: timestamps.length, timestamps };
    }

    const count = parsePoints(points);
    if (count === 1) return { since: sinceIso, until: untilIso, points: 1, timestamps: [sinceIso] };
    const step = (endMs - startMs) / (count - 1);
    const timestamps = [];
    for (let i = 0; i < count; i++) {
        timestamps.push(new Date(Math.round(startMs + step * i)).toISOString());
    }
    timestamps[timestamps.length - 1] = untilIso;
    return { since: sinceIso, until: untilIso, points: count, timestamps };
}

function graphStats(nodes, edges) {
    const types = new Set(nodes.map((node) => node.type).filter(Boolean));
    const incomplete = nodes.filter((node) => !node.complete).length;
    return {
        nodes: nodes.length,
        edges: edges.length,
        types: types.size,
        incomplete
    };
}

function buildGraphHistorySeries({ since, until, points, interval }, context, extractRelationTargets) {
    const range = buildCheckpointTimestamps({ since, until, points, interval });
    const snapshots = range.timestamps.map((timestamp) => {
        const reconstructed = reconstructVaultAtTime(timestamp, context);
        const { nodes, edges } = buildHistoricalGraph(reconstructed, extractRelationTargets);
        return { timestamp, nodes, edges, stats: graphStats(nodes, edges) };
    });
    return {
        since: range.since,
        until: range.until,
        points: range.points,
        snapshots
    };
}

module.exports = {
    buildCheckpointTimestamps,
    buildGraphHistorySeries,
    DEFAULT_POINTS,
    MAX_POINTS
};
