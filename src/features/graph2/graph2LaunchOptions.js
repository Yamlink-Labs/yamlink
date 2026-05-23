'use strict';

function buildRunGraphOptions(hasActiveMarkdownNote) {
    return {
        source: 'current',
        scope: 'neighborhood',
        depth: 2,
        nodeCap: 128
    };
}

function buildRunVaultGraphOptions() {
    return {
        source: 'current',
        scope: 'vault',
        centerNodeId: null,
        selectedNodeId: null,
        depth: 2,
        nodeCap: 200
    };
}

module.exports = {
    buildRunGraphOptions,
    buildRunVaultGraphOptions
};
