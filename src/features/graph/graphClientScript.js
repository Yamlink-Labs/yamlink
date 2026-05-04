'use strict';

const { buildGraphClientCoreScript } = require('./graphClientCoreScript');
const { buildGraphClientSidebarScript } = require('./graphClientSidebarScript');
const { buildGraphClientRenderScript } = require('./graphClientRenderScript');

function buildGraphClientScript(buildTime) {
    return [
        `const BUILD = '${buildTime}';`,
        buildGraphClientCoreScript(),
        buildGraphClientSidebarScript(),
        buildGraphClientRenderScript()
    ].join('\n\n');
}

module.exports = {
    buildGraphClientScript
};
