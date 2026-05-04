'use strict';

const { buildGraphModel } = require('./graph/graphModel');
const { createGraphPanelController } = require('./graph/graphPanelController');

const {
    openGraphPanel,
    refreshGraphPanel
} = createGraphPanelController();

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
    parseGraphBlocks,
    buildGraphModel
};
