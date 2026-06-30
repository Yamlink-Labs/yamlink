'use strict';

const { getTypes } = require('../registries/typeRegistry');
const { getSchemaTargets } = require('../registries/schemaRegistry');
const { getCachedPriors } = require('../intelligence/vaultPriors');
const { getVaultGeneration } = require('../core/indexService');

function getKnownTypeCandidates() {
    const vaultTypes = Array.from(getTypes());
    if (vaultTypes.length > 0) return vaultTypes.sort();
    const schemaTargets = Array.from(getSchemaTargets());
    if (schemaTargets.length > 0) return schemaTargets.sort();
    return [];
}

function buildClassificationSignals(noteType, fieldsCache) {
    const priors = (!fieldsCache || !fieldsCache.size)
        ? { fieldTargetTypes: null, typeFieldBundles: null, fieldAmbiguity: null }
        : getCachedPriors(fieldsCache, getVaultGeneration());
    return { noteType, fieldsCache, ...priors };
}

module.exports = { getKnownTypeCandidates, buildClassificationSignals };
