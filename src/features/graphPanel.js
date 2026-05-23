'use strict';

const { buildGraphModel } = require('./graph/graphModel');
const { createGraphPanelController } = require('./graph/graphPanelController');
const { createGraph2PanelController } = require('./graph2/graph2PanelController');
const { createGraph2SidebarController } = require('./graph2/graph2SidebarController');

const {
    openGraphPanel,
    refreshGraphPanel
} = createGraphPanelController();

const {
    openGraph2Panel,
    refreshGraph2Panel
} = createGraph2PanelController();

const {
    registerGraphView,
    refreshGraphSidebarView
} = createGraph2SidebarController();

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
    openGraph2Panel,
    refreshGraph2Panel,
    registerGraphView,
    refreshGraphSidebarView,
    parseGraphBlocks,
    buildGraphModel
};
