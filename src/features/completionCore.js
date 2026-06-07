'use strict';

const { getTypes } = require('../registries/typeRegistry');
const { FRONTMATTER_ARCHETYPES } = require('./completionContextHelpers');
const { getCachedPriors } = require('../intelligence/vaultPriors');
const { getVaultGeneration } = require('../core/indexService');

function getKnownTypeCandidates() {
    const vaultTypes = Array.from(getTypes());
    if (vaultTypes.length > 0) return vaultTypes.sort();
    return Object.keys(FRONTMATTER_ARCHETYPES).sort();
}

function buildClassificationSignals(noteType, fieldsCache) {
    const priors = (!fieldsCache || !fieldsCache.size)
        ? { fieldTargetTypes: null, typeFieldBundles: null, fieldAmbiguity: null }
        : getCachedPriors(fieldsCache, getVaultGeneration());
    return { noteType, fieldsCache, ...priors };
}

module.exports = { getKnownTypeCandidates, buildClassificationSignals };
