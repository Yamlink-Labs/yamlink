'use strict';

const { buildGraphModel } = require('./graph/graphModel');
const { createGraphPanelController } = require('./graph/graphPanelController');
const { createGraph2SidebarController } = require('./graph2/graph2SidebarController');

const {
    openGraphPanel,
    refreshGraphPanel
} = createGraphPanelController();

const {
    registerGraphView,
    refreshGraphSidebarView
} = createGraph2SidebarController();

/** @param {string} text @returns {string[]|null} */
function parseGraphBlocks(text) {
    const blocks = [];
    const fenceRe = /```yamlink-graph\s*\n([\s\S]*?)```/g;
    let match;

    while ((match = fenceRe.exec(text)) !== null) {
        const inner = String(match[1] || '').trim();
        if (inner) blocks.push(inner);
    }

    return blocks.length > 0 ? blocks : null;
}

module.exports = {
    openGraphPanel,
    refreshGraphPanel,
    registerGraphView,
    refreshGraphSidebarView,
    parseGraphBlocks,
    buildGraphModel
};
