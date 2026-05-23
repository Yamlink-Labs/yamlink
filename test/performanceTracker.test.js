'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

const outputChannels = [];

require.cache.__perf_vscode__ = {
    id: '__perf_vscode__',
    filename: '__perf_vscode__',
    loaded: true,
    exports: {
        window: {
            createOutputChannel(name) {
                const channel = {
                    name,
                    lines: [],
                    shown: false,
                    appendLine(line) { this.lines.push(line); },
                    clear() { this.lines = []; },
                    show() { this.shown = true; }
                };
                outputChannels.push(channel);
                return channel;
            }
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__perf_vscode__';
    return originalResolve(request, parent, ...rest);
};

const { createPerformanceTracker } = require('../src/runtime/performanceTracker');

beforeEach(() => {
    outputChannels.length = 0;
});

after(() => {
    Module._resolveFilename = originalResolve;
});

describe('performance tracker', () => {
    test('records summary statistics for synchronous measurements', () => {
        const tracker = createPerformanceTracker({ slowThresholdMs: 9999 });

        const value = tracker.measureSync('view.runQuery', { type: 'task' }, () => 42);
        const rows = tracker.getSummaryRows();

        assert.equal(value, 42);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].label, 'view.runQuery');
        assert.equal(rows[0].count, 1);
        assert.ok(rows[0].avgMs >= 0);
        assert.equal(rows[0].slowCount, 0);
    });

    test('writes slow samples to the output channel and can show a report', () => {
        const tracker = createPerformanceTracker({ slowThresholdMs: 0 });

        tracker.record('graph.buildPanelPayload', 12.5, { mode: 'vault' });
        tracker.showReport();

        assert.equal(outputChannels.length, 1);
        assert.equal(outputChannels[0].shown, true);
        assert.match(outputChannels[0].lines[0], /Yamlink performance report/);
        assert.match(outputChannels[0].lines[1] || '', /graph\.buildPanelPayload|^$/);
    });
});
