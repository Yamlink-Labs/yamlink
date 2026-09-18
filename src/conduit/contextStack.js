'use strict';

function describePaneContext(pane) {
    const screen = String(pane?.screen || 'briefing');
    const route = pane?.routeState?.[screen] || {};
    const parts = [screen];
    if (route.noteId) parts.push(String(route.noteId));
    else if (route.query) parts.push(String(route.query));
    else if (route.typeFilter && route.typeFilter !== 'all') parts.push(String(route.typeFilter));
    else if (route.filterText) parts.push(String(route.filterText));
    return parts.join(' · ');
}

function cloneLayerPane(pane) {
    return {
        screen: String(pane?.screen || 'briefing'),
        routeState: JSON.parse(JSON.stringify(pane?.routeState || {}))
    };
}

function pushContextLayer(stack, pane, limit = 4) {
    const layer = {
        screen: String(pane?.screen || 'briefing'),
        label: describePaneContext(pane),
        pane: cloneLayerPane(pane)
    };
    const next = [...(Array.isArray(stack) ? stack : []), layer];
    return next.slice(Math.max(0, next.length - limit));
}

function popContextLayer(stack) {
    const current = Array.isArray(stack) ? stack : [];
    if (!current.length) return { stack: current, pane: null };
    const next = current.slice(0, -1);
    return { stack: next, pane: current[current.length - 1].pane };
}

module.exports = {
    describePaneContext,
    pushContextLayer,
    popContextLayer
};
