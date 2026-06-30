'use strict';

const { getIndex, getVaultGeneration } = require('../../core/indexService');
const { getEdges, getGraphStats } = require('../../core/graph');
const { getRegistryStats } = require('../../registries/typeRegistry');
const { captureOutput, emitCliSuccess, emitText } = require('../io');
const fmt = require('../format');

function run({ json }) {
    const idIndex = getIndex();
    let brokenLinks = 0;
    for (const [id] of idIndex) {
        for (const edge of getEdges(id) || []) {
            if (!idIndex.has(edge.targetId)) brokenLinks++;
        }
    }

    const graphStats = getGraphStats();
    const registryStats = getRegistryStats();
    const payload = {
        notes: idIndex.size,
        types: registryStats.uniqueTypes,
        edges: graphStats.totalEdges,
        brokenLinks,
        generation: getVaultGeneration()
    };

    if (json) {
        emitCliSuccess(payload);
        return;
    }

    emitText(captureOutput(() => {
        fmt.row('Notes', payload.notes);
        fmt.row('Types', payload.types);
        fmt.row('Edges', payload.edges);
        fmt.row('Broken links', payload.brokenLinks);
        fmt.row('Generation', payload.generation);
    }));
}

module.exports = { run };
