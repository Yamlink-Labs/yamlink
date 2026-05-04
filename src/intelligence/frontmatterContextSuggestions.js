'use strict';

const {
    buildLikelyContexts,
    buildContextBundles,
    buildContextThreadViews
} = require('./frontmatterContextBuilders');
const {
    buildLikelyCompanions,
    buildSurroundingSetups,
    buildAffinityConnections,
    buildRelationViewHints
} = require('./frontmatterNeighborhoodSuggestions');

module.exports = {
    buildLikelyContexts,
    buildContextBundles,
    buildContextThreadViews,
    buildLikelyCompanions,
    buildSurroundingSetups,
    buildAffinityConnections,
    buildRelationViewHints
};
