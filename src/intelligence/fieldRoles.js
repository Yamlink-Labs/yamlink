const { getTypes, getRegistry } = require('../registries/typeRegistry');
const { getSchema } = require('../registries/schemaRegistry');
const { getEdges } = require('../core/graph');
const { getFieldsCache, getIndex } = require('../core/indexService');
const { normaliseDateInput } = require('../core/date');
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

function inferTargetTypeFromFieldName(fieldName) {
    return inferTargetTypeFromFieldNamePure(fieldName, getTypes());
}

function inferFieldRole(fieldName, options = {}) {
    const documentType = normalizeFieldName(options.documentType || '');
    const normalizedField = normalizeFieldName(fieldName);
    const schema = documentType ? getSchema(documentType) : null;
    const schemaField = schema?.fields?.[fieldName] || schema?.fields?.[normalizedField] || null;
    const registry = getRegistry();
    const idToType = new Map();
    for (const [type, ids] of registry.entries()) {
        for (const id of ids) idToType.set(id, type);
    }

    return inferFieldRolePure(normalizedField, {
        documentType,
        schemaField,
        knownTypes: getTypes(),
        observedFields: buildObservedFields(),
        graphObservations: buildGraphObservations(options.idIndex || getIndex()),
        idToType,
        dateParser: normaliseDateInput,
        statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS,
        inferenceConfidence: DEFAULT_INFERENCE_CONFIDENCE
    });
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
