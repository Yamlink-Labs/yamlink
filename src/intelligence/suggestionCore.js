'use strict';

const {
    inferFieldRole,
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS
} = require('./fieldRolesCore');
const { inferNoteRole } = require('./noteRolesCore');

function buildObservedFields(fieldsCache) {
    const observedFields = [];
    for (const value of fieldsCache.values()) {
        observedFields.push({
            type: String(value?.type || '').trim().toLowerCase(),
            fields: value
        });
    }
    return observedFields;
}

function buildFieldRoleResults(nodeFields, nodeType, options = {}) {
    const observedFields = options.observedFields || [];
    const getSchemaForType = options.getSchemaForType || (() => null);
    const dateParser = options.dateParser || (() => null);
    const statusLikeValues = options.statusLikeValues || DEFAULT_STATUS_LIKE_VALUES;
    const semanticRolePriors = options.semanticRolePriors || DEFAULT_SEMANTIC_ROLE_PRIORS;

    const results = [];
    for (const [fieldName, rawValue] of Object.entries(nodeFields || {})) {
        if (!String(rawValue || '').trim()) continue;
        if (fieldName === 'id' || fieldName === 'type') continue;
        results.push(inferFieldRole(fieldName, {
            documentType: nodeType,
            schemaField: getSchemaForType(nodeType)?.fields?.[fieldName] || null,
            observedFields,
            dateParser,
            statusLikeValues,
            semanticRolePriors
        }));
    }
    return results;
}

function buildNoteContext(nodeFields, nodeType, options = {}) {
    const observedFields = options.observedFields || [];
    const fieldRoleResults = buildFieldRoleResults(nodeFields, nodeType, {
        observedFields,
        getSchemaForType: options.getSchemaForType,
        dateParser: options.dateParser,
        statusLikeValues: options.statusLikeValues,
        semanticRolePriors: options.semanticRolePriors
    });
    const noteRole = inferNoteRole(nodeFields, { fieldRoleResults });
    return {
        fieldRoleResults,
        noteRole
    };
}

function extractRelationIds(value) {
    const text = String(value || '');
    const ids = [];
    const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const id = String(match[1] || '').trim();
        if (id) ids.push(id);
    }
    return [...new Set(ids)];
}

function groupStructuredBacklinks(backlinks, fieldsCache) {
    const typedGroups = new Map();
    const fieldGroups = new Map();

    for (const { field, sourceId } of backlinks || []) {
        if (field === 'body') continue;
        const sourceFields = fieldsCache.get(sourceId);
        if (!sourceFields) continue;
        const sourceType = String(sourceFields.type || '').trim().toLowerCase();
        if (!sourceType) continue;

        const typedKey = `${field}\x00${sourceType}`;
        typedGroups.set(typedKey, {
            field,
            sourceType,
            count: (typedGroups.get(typedKey)?.count || 0) + 1
        });

        const fieldGroup = fieldGroups.get(field) || { field, total: 0, types: new Set() };
        fieldGroup.total += 1;
        fieldGroup.types.add(sourceType);
        fieldGroups.set(field, fieldGroup);
    }

    return { typedGroups, fieldGroups };
}

function buildSchemaRelationGroups(nodeType, typedGroups, options = {}) {
    const getSchemaTargets = options.getSchemaTargets || (() => []);
    const getSchemaForType = options.getSchemaForType || (() => null);
    const schemaRelationKeys = new Set();

    if (!nodeType) return { schemaRelationKeys, typedGroups };

    for (const sourceType of getSchemaTargets()) {
        const schema = getSchemaForType(sourceType);
        if (!schema || !schema.fields) continue;

        for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
            if (fieldDef.type !== 'relation') continue;
            if (String(fieldDef.target || '').trim().toLowerCase() !== nodeType) continue;

            const typedKey = `${fieldName}\x00${sourceType}`;
            const group = typedGroups.get(typedKey);
            const count = group ? group.count : 0;
            schemaRelationKeys.add(typedKey);
            if (!typedGroups.has(typedKey)) {
                typedGroups.set(typedKey, {
                    field: fieldName,
                    sourceType,
                    count
                });
            }
        }
    }

    return { schemaRelationKeys, typedGroups };
}

function buildSharedRelationContexts(nodeFields, noteContext, fieldsCache, options = {}) {
    const getSchemaTargets = options.getSchemaTargets || (() => []);
    const getSchemaForType = options.getSchemaForType || (() => null);
    const contexts = [];

    for (const result of noteContext.fieldRoleResults || []) {
        if (!result.relational || !result.fieldName) continue;
        const relatedIds = extractRelationIds(nodeFields[result.fieldName]);
        if (relatedIds.length === 0) continue;

        for (const relatedId of relatedIds.slice(0, 2)) {
            const relatedType = String(fieldsCache.get(relatedId)?.type || result.targetType || '').trim().toLowerCase();
            if (!relatedType) continue;

            for (const sourceType of getSchemaTargets()) {
                const schema = getSchemaForType(sourceType);
                const fieldDef = schema?.fields?.[result.fieldName];
                if (!fieldDef || fieldDef.type !== 'relation') continue;
                if (String(fieldDef.target || '').trim().toLowerCase() !== relatedType) continue;

                contexts.push({
                    field: result.fieldName,
                    sourceType,
                    relatedId,
                    relatedType
                });
            }
        }
    }

    return contexts;
}

module.exports = {
    buildObservedFields,
    buildFieldRoleResults,
    buildNoteContext,
    extractRelationIds,
    groupStructuredBacklinks,
    buildSchemaRelationGroups,
    buildSharedRelationContexts
};
