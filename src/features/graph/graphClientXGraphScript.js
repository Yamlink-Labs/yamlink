'use strict';

const {
    _clientBodySetup,
    _clientBodyRendering,
    _clientBodyTooltipsAndContextMenu,
    _clientBodySelection,
    _clientBodySearchAndFilter,
    _clientBodySidebarAndPayload,
    _clientBodyTimelapse,
} = require('./xgraphClientBody');

/**
 * Generates the inline <script type="module"> content for the x-graph webview.
 * Uses Canvas2DRenderer directly with a self-contained SimpleLayout (no d3-force).
 *
 * @param {string} rendererUri  - webview URI for graph/renderer/Canvas2DRenderer.js
 * @param {string} buildTime    - ISO timestamp injected as BUILD constant
 */
function buildGraphClientXGraphScript(rendererUri, buildTime) {
    return (
        'import { Canvas2DRenderer } from \'' + rendererUri + '\';\n' +
        'const BUILD = \'' + buildTime + '\';\n' +
        _clientBody()
    );
}

function _clientBody() {
    return _clientBodySetup()
        + _clientBodyRendering()
        + _clientBodyTooltipsAndContextMenu()
        + _clientBodySelection()
        + _clientBodySearchAndFilter()
        + _clientBodySidebarAndPayload()
        + _clientBodyTimelapse();
}

module.exports = { buildGraphClientXGraphScript };
