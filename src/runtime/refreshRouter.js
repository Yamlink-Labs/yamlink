'use strict';

function createRefreshRouter(services) {
    function refresh(event = {}) {
        const dirty = new Set(event.dirty || []);
        const full = event.full === true || dirty.has('all');

        if (full || dirty.has('diagnostics')) {
            services.clearDiagnostics();
            services.validateAll();
        }

        if (full || dirty.has('backlinks')) services.refreshBacklinks();
        if (full || dirty.has('related')) services.refreshRelated();
        if (full || dirty.has('decorations')) services.refreshDecorations();
        if (full || dirty.has('status')) services.refreshStatusBar();
        if (full || dirty.has('health')) services.refreshHealthPanel();
        if (full || dirty.has('views')) services.refreshViews();
        if (full || dirty.has('graph')) services.refreshGraph();
        if (full || dirty.has('entityHub')) services.refreshEntityHub();
        if (full || dirty.has('calendar')) services.refreshCalendar();
        if (full || dirty.has('suggestions')) services.refreshSuggestions();
    }

    function refreshForIndexMutation(result = {}, options = {}) {
        const indexChanged = !!(result.changed || result.needsFull || options.forceHeavy);
        const dirty = indexChanged
            ? ['diagnostics', 'backlinks', 'related', 'decorations', 'status', 'suggestions']
            : ['status', 'suggestions'];

        if (indexChanged) dirty.push('health', 'views', 'graph', 'entityHub', 'calendar');
        refresh({ dirty, full: !!options.full });
    }

    function refreshForPassiveIndexSweep() {
        refresh({ dirty: ['diagnostics', 'backlinks', 'decorations', 'status', 'health', 'views', 'graph', 'entityHub', 'calendar', 'suggestions'] });
    }

    return {
        refresh,
        refreshForIndexMutation,
        refreshForPassiveIndexSweep
    };
}

module.exports = { createRefreshRouter };
