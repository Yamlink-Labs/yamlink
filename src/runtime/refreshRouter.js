'use strict';

const { appendMutationEvents } = require('./mutationEventLog');

/**
 * @typedef {{ dirty?: string[], full?: boolean, changedId?: string|null }} RefreshEvent
 * @typedef {{ changed?: boolean, needsFull?: boolean, changedId?: string|null, mutationEvents?: object[] }} IndexMutationResult
 */

/**
 * Creates a refresh coordinator that fans dirty signals out to registered VS Code services.
 * @param {object} services
 * @returns {{ refresh: (event?: RefreshEvent) => void, refreshForIndexMutation: (result?: IndexMutationResult, options?: object) => void, refreshForPassiveIndexSweep: () => void }}
 */
function createRefreshRouter(services) {
    function refresh(event = {}) {
        const dirty = new Set(event.dirty || []);
        const full = event.full === true || dirty.has('all');
        const changedId = event.changedId ?? null;

        if (full || dirty.has('fullDiagnostics')) {
            services.clearDiagnostics();
            services.validateAll();
        } else if (dirty.has('diagnostics') && services.validateTargeted) {
            services.validateTargeted();
        }

        if (full || dirty.has('decorations')) services.refreshDecorations();
        if (full || dirty.has('status')) services.refreshStatusBar();
        if (full || dirty.has('health')) services.refreshHealthPanel();
        if (full || dirty.has('home') || full) { if (services.refreshHome) services.refreshHome(); }
        if (full || dirty.has('views')) services.refreshViews();
        if (full || dirty.has('graph')) { services.refreshGraph(); if (services.refreshGraphSidebar) services.refreshGraphSidebar(); }
        if (full || dirty.has('entityHub')) services.refreshEntityHub(changedId);
        if (full || dirty.has('calendar')) services.refreshCalendar(changedId);
        if (full || dirty.has('suggestions')) services.refreshSuggestions();
    }

    function refreshForIndexMutation(result = {}, options = {}) {
        const indexChanged = !!(result.changed || result.needsFull || options.forceHeavy);
        const diagnosticsDirty = !!(result.needsFull || options.forceHeavy);
        const changedId = result.changedId ?? null;
        if (Array.isArray(result.mutationEvents) && result.mutationEvents.length) {
            appendMutationEvents(result.mutationEvents);
        }
        const dirty = indexChanged
            ? ['decorations', 'status', 'suggestions']
            : ['status', 'suggestions'];

        if (diagnosticsDirty) dirty.unshift('fullDiagnostics');
        else if (indexChanged) dirty.unshift('diagnostics');
        if (indexChanged) dirty.push('health', 'views', 'graph', 'entityHub', 'calendar');
        refresh({ dirty, full: !!options.full, changedId });
    }

    function refreshForPassiveIndexSweep() {
        refresh({ dirty: ['fullDiagnostics', 'decorations', 'status', 'health', 'views', 'graph', 'entityHub', 'calendar', 'suggestions'] });
    }

    return {
        refresh,
        refreshForIndexMutation,
        refreshForPassiveIndexSweep
    };
}

module.exports = { createRefreshRouter };
