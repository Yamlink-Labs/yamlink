const { getFieldsCache, getVaultGeneration } = require('../core/indexService');
const { normaliseDateInput } = require('../core/date');
const { getSchema, getSchemaTargets } = require('../registries/schemaRegistry');
const {
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS,
    inferFieldRole,
    normalizeFieldName
} = require('../intelligence/fieldRolesCore');
const {
    getCachedPriors,
    buildVaultStatusValues,
    buildVaultSemanticRolePriors
} = require('../intelligence/vaultPriors');
const {
    buildObservedFields,
    buildObservedNoteIndex,
    buildNoteContext
} = require('../intelligence/suggestionCore');
const { buildFrontmatterOpportunityModel } = require('../intelligence/frontmatterIntelligence');

function resolveStatusLikeValues(priors) {
    const learned = buildVaultStatusValues(priors?.workflowFields);
    return new Set([
        ...Array.from(DEFAULT_STATUS_LIKE_VALUES),
        ...Array.from(learned || [])
    ]);
}

function resolveSemanticRolePriors(priors) {
    const learned = buildVaultSemanticRolePriors(priors || {});
    /** @type {Record<string, string[]>} */
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

/**
 * @param {string} type
 * @param {{ fieldsCache?: Map<string,object>, observedFields?: object[] }} [options]
 * @returns {string}
 */
function getDefaultSortFieldForType(type, options = {}) {
    const schema = type ? getSchema(type) : null;
    if (schema && schema.fields) {
        if (schema.fields.created) return 'created';
        if (schema.fields.date) return 'date';
        if (schema.fields.name) return 'name';
    }
    const fieldsCache = options.fieldsCache || getFieldsCache();
    const observedFields = options.observedFields || buildObservedFields(fieldsCache);
    const priors = fieldsCache?.size ? getCachedPriors(fieldsCache, getVaultGeneration()) : null;
    const statusLikeValues = resolveStatusLikeValues(priors);
    const semanticRolePriors = resolveSemanticRolePriors(priors);
    let hasCreated = false;
    let hasDate = false;
    let hasName = false;
    const semanticCandidates = new Map();
    const normalizedType = String(type || '').trim().toLowerCase();

    for (const fields of fieldsCache.values()) {
        const nodeType = String(fields?.type || '').trim().toLowerCase();
        if (nodeType !== normalizedType) continue;
        hasCreated = hasCreated || Boolean(fields.created);
        hasDate = hasDate || Boolean(fields.date);
        hasName = hasName || Boolean(fields.name);

        for (const [fieldName, rawValue] of Object.entries(fields || {})) {
            if (!String(rawValue || '').trim()) continue;
            if (fieldName === 'id' || fieldName === 'type') continue;
            const result = inferFieldRole(fieldName, {
                documentType: normalizedType,
                observedFields,
                dateParser: normaliseDateInput,
                statusLikeValues,
                semanticRolePriors
            });
            if (result.semanticRole !== 'date') continue;
            const normalizedField = normalizeFieldName(fieldName);
            semanticCandidates.set(
                normalizedField,
                (semanticCandidates.get(normalizedField) || 0) + 1
            );
        }
    }
    if (hasCreated) return 'created';
    if (hasDate) return 'date';
    if (hasName) return 'name';
    if (semanticCandidates.size) {
        return [...semanticCandidates.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    }
    return '';
}

/**
 * @param {Map<string,object>} fieldsCache
 * @param {object[]|null} [observedFields]
 * @returns {(type: string) => string}
 */
function createDefaultSortFieldResolver(fieldsCache, observedFields = null) {
    const cache = new Map();
    const resolvedObservedFields = observedFields || buildObservedFields(fieldsCache);
    return function resolve(type) {
        const normalizedType = String(type || '').trim().toLowerCase();
        if (!normalizedType) return '';
        if (!cache.has(normalizedType)) {
            cache.set(normalizedType, getDefaultSortFieldForType(normalizedType, {
                fieldsCache,
                observedFields: resolvedObservedFields
            }));
        }
        return cache.get(normalizedType) || '';
    };
}

/**
 * @param {string} nodeId
 * @param {object} nodeFields
 * @param {string} nodeType
 * @param {Map<string,object>} fieldsCache
 * @returns {{ observedFields: object[], observedIndex: object, noteContext: object, frontmatterOpportunities: object, getDefaultSortField: (type: string) => string }}
 */
function buildActivationContext(nodeId, nodeFields, nodeType, fieldsCache) {
    const observedFields = buildObservedFields(fieldsCache);
    const priors = fieldsCache?.size ? getCachedPriors(fieldsCache, getVaultGeneration()) : null;
    const statusLikeValues = resolveStatusLikeValues(priors);
    const semanticRolePriors = resolveSemanticRolePriors(priors);
    const observedIndex = buildObservedNoteIndex(fieldsCache, {
        observedFields,
        getSchemaForType: getSchema,
        dateParser: normaliseDateInput,
        statusLikeValues,
        semanticRolePriors
    });
    const getDefaultSortField = createDefaultSortFieldResolver(fieldsCache, observedFields);
    const noteContext = buildNoteContext(nodeFields, nodeType, {
        observedFields,
        getSchemaForType: getSchema,
        dateParser: normaliseDateInput,
        statusLikeValues,
        semanticRolePriors,
        noteRolePriors: priors?.noteRoleNamePriors,
        noteRoleFieldHints: priors?.noteRoleFieldHints,
        typeRoleMap: priors?.typeRoleMap
    });
    const frontmatterOpportunities = buildFrontmatterOpportunityModel(nodeFields, {
        nodeId,
        nodeType,
        fieldsCache,
        observedFields,
        observedIndex,
        noteContext,
        getSchemaTargets,
        getSchemaForType: getSchema,
        getDefaultSortField,
        dateParser: normaliseDateInput,
        statusLikeValues,
        semanticRolePriors,
        limit: 4,
        connectionLimit: 4
    });
    return { observedFields, observedIndex, noteContext, frontmatterOpportunities, getDefaultSortField };
}

module.exports = {
    createDefaultSortFieldResolver,
    getDefaultSortFieldForType,
    buildActivationContext
};
