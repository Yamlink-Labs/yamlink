const { getTypes, getRegistry } = require('../registries/typeRegistry');
const { getSchema, getSchemaTargets } = require('../registries/schemaRegistry');
const { getEdges } = require('../core/graph');
const { getFieldsCache, getIndex, getVaultGeneration } = require('../core/indexService');
const { normaliseDateInput } = require('../core/date');
const {
    getCachedPriors,
    buildVaultStatusValues,
    buildVaultSemanticRolePriors
} = require('./vaultPriors');
const {
    DEFAULT_INFERENCE_CONFIDENCE,
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS,
    normalizeFieldName,
    getFieldNameVariants,
    normalizeLinkTarget,
    extractLinkTargets,
    inferTargetTypeFromFieldName: inferTargetTypeFromFieldNamePure,
    collectFieldEvidence,
    inferSemanticRoleFromName,
    inferTargetTypeFromGraph,
    inferFieldRole: inferFieldRolePure
} = require('./fieldRolesCore');

function collectKnownTypes() {
    const schemaTargets = typeof getSchemaTargets === 'function'
        ? Array.from(getSchemaTargets())
        : [];
    return new Set([
        ...Array.from(getTypes()),
        ...schemaTargets
    ]);
}

function resolveStatusLikeValues(priors) {
    const learned = buildVaultStatusValues(priors?.workflowFields);
    return new Set([
        ...Array.from(DEFAULT_STATUS_LIKE_VALUES),
        ...Array.from(learned || [])
    ]);
}

function resolveSemanticRolePriors(priors) {
    const learned = buildVaultSemanticRolePriors(priors || {});
    const merged = {};
    const roles = new Set([
        ...Object.keys(DEFAULT_SEMANTIC_ROLE_PRIORS),
        ...Object.keys(learned || {})
    ]);
    for (const role of roles) {
        merged[role] = [
            ...new Set([
                ...(DEFAULT_SEMANTIC_ROLE_PRIORS[role] || []),
                ...(learned?.[role] || [])
            ])
        ];
    }
    return merged;
}

/** @returns {{ type: string, fields: object }[]} */
function buildObservedFields() {
    const observedFields = [];
    for (const value of getFieldsCache().values()) {
        observedFields.push({
            type: normalizeFieldName(value.type || ''),
            fields: value
        });
    }
    return observedFields;
}

function buildGraphObservations(idIndex) {
    const registry = getRegistry();
    const idToType = new Map();
    for (const [type, ids] of registry.entries()) {
        for (const id of ids) idToType.set(id, type);
    }

    const observations = [];
    for (const sourceId of idIndex.keys()) {
        const edges = getEdges(sourceId);
        for (const edge of edges) {
            observations.push({
                field: edge.field,
                sourceType: idToType.get(sourceId) || '',
                targetType: idToType.get(edge.targetId) || ''
            });
        }
    }
    return observations;
}

/**
 * @param {string} fieldName
 * @returns {string|null}
 */
function inferTargetTypeFromFieldName(fieldName) {
    return inferTargetTypeFromFieldNamePure(fieldName, collectKnownTypes());
}

/**
 * @param {string} fieldName
 * @param {{ documentType?: string, idIndex?: Map<string,object> }} [options]
 * @returns {object} Field role inference result from fieldRolesCore.
 */
function inferFieldRole(fieldName, options = {}) {
    const documentType = normalizeFieldName(options.documentType || '');
    const normalizedField = normalizeFieldName(fieldName);
    const schema = documentType ? getSchema(documentType) : null;
    const schemaField = schema?.fields?.[fieldName] || schema?.fields?.[normalizedField] || null;
    const fieldsCache = getFieldsCache();
    const priors = fieldsCache?.size
        ? getCachedPriors(fieldsCache, getVaultGeneration())
        : null;
    const registry = getRegistry();
    const idToType = new Map();
    for (const [type, ids] of registry.entries()) {
        for (const id of ids) idToType.set(id, type);
    }

    const result = inferFieldRolePure(normalizedField, {
        documentType,
        schemaField,
        knownTypes: collectKnownTypes(),
        observedFields: buildObservedFields(),
        graphObservations: buildGraphObservations(options.idIndex || getIndex()),
        idToType,
        dateParser: normaliseDateInput,
        statusLikeValues: resolveStatusLikeValues(priors),
        semanticRolePriors: resolveSemanticRolePriors(priors),
        inferenceConfidence: DEFAULT_INFERENCE_CONFIDENCE
    });
    // Cap name-only semantic role confidence at 0.40. Evidence-backed roles (date → 0.84,
    // status → 0.75) are already above 0.62 and won't be affected.
    if (result.semanticRole && result.semanticRole !== 'relation' && result.semanticConfidence <= 0.62) {
        return { ...result, semanticConfidence: 0.40 };
    }
    return result;
}

module.exports = {
    DEFAULT_INFERENCE_CONFIDENCE,
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS,
    normalizeFieldName,
    getFieldNameVariants,
    normalizeLinkTarget,
    extractLinkTargets,
    inferTargetTypeFromFieldName,
    collectFieldEvidence,
    inferSemanticRoleFromName,
    inferTargetTypeFromGraph,
    inferFieldRole
};
