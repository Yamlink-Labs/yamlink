'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createRefreshRouter } = require('../src/runtime/refreshRouter');

function createServices() {
    const counts = {
        clearDiagnostics: 0,
        validateAll: 0,
        validateTargeted: 0,
        refreshDecorations: 0,
        refreshStatusBar: 0,
        refreshHealthPanel: 0,
        refreshViews: 0,
        refreshGraph: 0,
        refreshEntityHub: 0,
        refreshCalendar: 0,
        refreshSuggestions: 0
    };

    const services = Object.fromEntries(
        Object.keys(counts).map((key) => [
            key,
            () => {
                counts[key] += 1;
            }
        ])
    );

    return { counts, services };
}

describe('refresh router', () => {
    test('passive index sweep refreshes smart suggestions', () => {
        const { counts, services } = createServices();
        const router = createRefreshRouter(services);

        router.refreshForPassiveIndexSweep();

        assert.equal(counts.clearDiagnostics, 1);
        assert.equal(counts.validateAll, 1);
        assert.equal(counts.validateTargeted, 0);
        assert.equal(counts.refreshSuggestions, 1);
        assert.equal(counts.refreshCalendar, 1);
    });

    test('index mutations still refresh suggestions in both light and heavy paths', () => {
        const { counts, services } = createServices();
        const router = createRefreshRouter(services);

        router.refreshForIndexMutation({ changed: false, needsFull: false });
        assert.equal(counts.refreshSuggestions, 1);
        assert.equal(counts.refreshViews, 0);
        assert.equal(counts.validateTargeted, 0);

        router.refreshForIndexMutation({ changed: true, needsFull: false });
        assert.equal(counts.refreshSuggestions, 2);
        assert.equal(counts.refreshViews, 1);
        assert.equal(counts.refreshCalendar, 1);
        assert.equal(counts.validateTargeted, 1);
        assert.equal(counts.validateAll, 0);
    });
});
