'use strict';

const { buildObservedNoteIndex, extractRelationIds } = require('./suggestionNoteIndex');

/**
 * @param {Array<{field: string, sourceId: string}>} backlinks
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {{ typedGroups: Map<string, {field: string, sourceType: string, count: number}>, fieldGroups: Map<string, {field: string, total: number, types: Set<string>}> }}
 */
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

/**
 * @param {string} nodeType
 * @param {Map<string, any>} typedGroups
 * @param {Record<string, any>} [options]
 * @returns {{ schemaRelationKeys: Set<string>, typedGroups: Map<string, any> }}
 */
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
                typedGroups.set(typedKey, { field: fieldName, sourceType, count });
            }
        }
    }

    return { schemaRelationKeys, typedGroups };
}

/**
 * @param {string} nodeType
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {Map<string, {field: string, sourceType: string, count: number, examples: Set<string>}>}
 */
function buildObservedRelationGroups(nodeType, fieldsCache) {
    const normalizedNodeType = String(nodeType || '').trim().toLowerCase();
    const groups = new Map();
    if (!normalizedNodeType) return groups;
    const knownIds = new Set([...fieldsCache.keys()].map((id) => String(id || '').trim().toLowerCase()).filter(Boolean));

    for (const [sourceId, sourceFields] of fieldsCache.entries()) {
        void sourceId;
        const sourceType = String(sourceFields?.type || '').trim().toLowerCase();
        if (!sourceType) continue;

        for (const [fieldName, rawValue] of Object.entries(sourceFields || {})) {
            if (fieldName === 'id' || fieldName === 'type') continue;
            const linkedIds = extractRelationIds(rawValue, knownIds);
            if (!linkedIds.length) continue;

            const matchesTargetType = linkedIds.some(function (linkedId) {
                return String(fieldsCache.get(linkedId)?.type || '').trim().toLowerCase() === normalizedNodeType;
            });
            if (!matchesTargetType) continue;

            const key = `${fieldName}\x00${sourceType}`;
            const current = groups.get(key) || { field: fieldName, sourceType, count: 0, examples: new Set() };
            current.count += 1;
            linkedIds.slice(0, 2).forEach((linkedId) => current.examples.add(linkedId));
            groups.set(key, current);
        }
    }

    return groups;
}

/**
 * @param {Record<string, any>} nodeFields
 * @param {{ fieldRoleResults: Array<Record<string, any>>, noteRole: Record<string, any> }} noteContext
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {Record<string, any>} [options]
 * @returns {Array<{field: string, sourceType: string, relatedId: string, relatedType: string, origin: string}>}
 */
function buildSharedRelationContexts(nodeFields, noteContext, fieldsCache, options = {}) {
    const getSchemaTargets = options.getSchemaTargets || (() => []);
    const getSchemaForType = options.getSchemaForType || (() => null);
    const observedIndex = options.observedIndex || buildObservedNoteIndex(fieldsCache, options);
    const knownIds = options.knownIds || observedIndex.knownIds || new Set();
    const nodeType = String(options.nodeType || nodeFields.type || '').trim().toLowerCase();
    const contexts = [];
    const seen = new Set();

    function addContext(field, sourceType, relatedId, relatedType, origin) {
        const key = `${field}\x00${sourceType}\x00${relatedId}`;
        if (seen.has(key)) return;
        seen.add(key);
        contexts.push({ field, sourceType, relatedId, relatedType, origin });
    }

    for (const result of noteContext.fieldRoleResults || []) {
        if (!result.relational || !result.fieldName) continue;
        const relatedIds = extractRelationIds(nodeFields[result.fieldName], knownIds);
        if (relatedIds.length === 0) continue;

        for (const relatedId of relatedIds.slice(0, 2)) {
            const relatedType = String(fieldsCache.get(relatedId)?.type || result.targetType || '').trim().toLowerCase();
            if (!relatedType) continue;

            for (const sourceType of getSchemaTargets()) {
                const schema = getSchemaForType(sourceType);
                const fieldDef = schema?.fields?.[result.fieldName];
                if (!fieldDef || fieldDef.type !== 'relation') continue;
                if (String(fieldDef.target || '').trim().toLowerCase() !== relatedType) continue;
                addContext(result.fieldName, sourceType, relatedId, relatedType, 'schema');
            }

            const observedBucket = observedIndex.notesByRelationField.get(result.fieldName) || [];
            for (const observed of observedBucket) {
                const sourceType = String(observed?.type || '').trim().toLowerCase();
                if (!sourceType || sourceType === nodeType) continue;
                const linkedIds = observed.relationIdsByField.get(String(result.fieldName || '').trim().toLowerCase()) || [];
                if (!linkedIds.length) continue;
                const matchesTarget = linkedIds.some((linkedId) => {
                    const linkedType = String(fieldsCache.get(linkedId)?.type || '').trim().toLowerCase();
                    return linkedType && linkedType === relatedType;
                });
                if (!matchesTarget) continue;
                addContext(result.fieldName, sourceType, relatedId, relatedType, 'observed');
            }
        }
    }

    return contexts;
}

/**
 * @param {string} origin
 * @returns {string}
 */
function describeContextOrigin(origin) {
    if (origin === 'observed') return 'observed';
    if (origin === 'schema') return 'schema';
    return 'inferred';
}

/**
 * @param {string} nodeId
 * @param {Record<string, any>} nodeFields
 * @param {{ fieldRoleResults: Array<Record<string, any>>, noteRole: Record<string, any> }} noteContext
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {Record<string, any>} [options]
 * @returns {import('./suggestionNoteIndex').BridgePath[]}
 */
function buildBridgePaths(nodeId, nodeFields, noteContext, fieldsCache, options = {}) {
    const observedIndex = options.observedIndex || buildObservedNoteIndex(fieldsCache, options);
    const knownIds = options.knownIds || observedIndex.knownIds || new Set();
    const contexts = buildSharedRelationContexts(nodeFields, noteContext, fieldsCache, {
        ...options,
        observedIndex,
        knownIds
    });
    const directIds = new Set();
    for (const value of Object.values(nodeFields || {})) {
        for (const id of extractRelationIds(value, knownIds)) directIds.add(id);
    }

    const bridges = [];
    const seen = new Set();

    for (const context of contexts) {
        const candidates = observedIndex.notesByRelationFieldTarget.get(`${context.field}\x00${context.relatedId}`) || [];
        for (const candidate of candidates) {
            const candidateId = String(candidate.id || '').trim();
            const candidateFields = candidate.fields || {};
            if (!candidateFields || !candidateId || candidateId === nodeId) continue;
            const candidateType = String(candidate.type || '').trim().toLowerCase();
            if (!candidateType || candidateType !== context.sourceType) continue;

            const candidateLinksBack = Object.values(candidateFields).some(function (value) {
                return extractRelationIds(value, knownIds).includes(nodeId);
            });
            if (directIds.has(candidateId) || candidateLinksBack) continue;

            const key = `${candidateId}\x00${context.field}\x00${context.relatedId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            bridges.push({
                candidateId,
                candidateType,
                field: context.field,
                relatedId: context.relatedId,
                relatedType: context.relatedType,
                origin: context.origin
            });
        }
    }

    return bridges.sort(function (a, b) {
        return a.candidateType.localeCompare(b.candidateType)
            || a.field.localeCompare(b.field)
            || a.candidateId.localeCompare(b.candidateId);
    });
}

/**
 * @param {string} nodeId
 * @param {Record<string, any>} nodeFields
 * @param {{ fieldRoleResults: Array<Record<string, any>>, noteRole: Record<string, any> }} noteContext
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {Record<string, any>} [options]
 * @returns {import('./suggestionNoteIndex').ContextTrace[]}
 */
function buildSharedContextTraces(nodeId, nodeFields, noteContext, fieldsCache, options = {}) {
    return buildBridgePaths(nodeId, nodeFields, noteContext, fieldsCache, options).map(function (bridge) {
        return {
            candidateId: bridge.candidateId,
            candidateType: bridge.candidateType,
            field: bridge.field,
            relatedId: bridge.relatedId,
            relatedType: bridge.relatedType,
            origin: bridge.origin,
            path: [nodeId, bridge.relatedId, bridge.candidateId]
        };
    });
}

/**
 * @param {import('./suggestionNoteIndex').BridgePath[]} [bridges]
 * @param {number} [limit]
 * @returns {Array<{candidateId: string, relatedId: string, field: string, origin: string, summary: string}>}
 */
function summarizeBridgeHints(bridges = [], limit = 2) {
    return bridges
        .slice(0, limit)
        .map(function (bridge) {
            return {
                candidateId: bridge.candidateId,
                relatedId: bridge.relatedId,
                field: bridge.field,
                origin: bridge.origin,
                summary: `${bridge.candidateId} also connects around ${bridge.relatedId}`
            };
        });
}

/**
 * @param {import('./suggestionNoteIndex').ContextTrace[]} [traces]
 * @param {number} [limit]
 * @returns {Array<{candidateId: string, relatedId: string, field: string, origin: string, path: string[], summary: string}>}
 */
function summarizeTraceHints(traces = [], limit = 1) {
    return traces
        .slice(0, limit)
        .map(function (trace) {
            return {
                candidateId: trace.candidateId,
                relatedId: trace.relatedId,
                field: trace.field,
                origin: trace.origin,
                path: trace.path,
                summary: `${trace.candidateId} sits close through ${trace.relatedId}`
            };
        });
}

module.exports = {
    groupStructuredBacklinks,
    buildSchemaRelationGroups,
    buildObservedRelationGroups,
    buildSharedRelationContexts,
    describeContextOrigin,
    buildBridgePaths,
    buildSharedContextTraces,
    summarizeBridgeHints,
    summarizeTraceHints
};
