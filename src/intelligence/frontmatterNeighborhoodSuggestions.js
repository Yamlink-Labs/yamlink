'use strict';

const {
    buildLikelyCompanions,
    buildSurroundingSetups
} = require('./frontmatterCompanionSuggestions');
const {
    buildAffinityConnections,
    buildRelationViewHints
} = require('./frontmatterAffinitySuggestions');

module.exports = {
    buildLikelyCompanions,
    buildSurroundingSetups,
    buildAffinityConnections,
    buildRelationViewHints
};
