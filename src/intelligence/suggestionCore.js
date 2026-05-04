'use strict';

const {
    inferFieldRole,
    normalizeFieldName,
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS
} = require('./fieldRolesCore');
const { inferNoteRole } = require('./noteRolesCore');
const { getVaultGeneration } = require('../core/indexService');

let _noteIndexCache = null;
let _noteIndexGen = -1;

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

function buildNoteRoleHints(nodeFields = {}) {
    const hints = [];
    if (nodeFields.name) hints.push(nodeFields.name);
    if (nodeFields.title) hints.push(nodeFields.title);
    if (nodeFields.id) hints.push(nodeFields.id);
    return hints;
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
    const noteRole = inferNoteRole(nodeFields, {
        fieldRoleResults,
        titleHints: options.titleHints || buildNoteRoleHints(nodeFields)
    });
    return {
        fieldRoleResults,
        noteRole
    };
}

function buildObservedNoteIndex(fieldsCache, options = {}) {
    const gen = getVaultGeneration();
    if (_noteIndexCache && _noteIndexGen === gen && !options.observedFields) {
        return _noteIndexCache;
    }
    const observedFields = options.observedFields || buildObservedFields(fieldsCache);
    const sourceNotes = fieldsCache && fieldsCache.size
        ? [...fieldsCache.entries()].map(([cacheId, fields]) => ({
            cacheId: String(cacheId || '').trim(),
            type: String(fields?.type || '').trim().toLowerCase(),
            fields: fields || {}
        }))
        : observedFields.map((observed) => ({
            cacheId: String(observed?.fields?.id || '').trim(),
            type: String(observed?.type || '').trim().toLowerCase(),
            fields: observed?.fields || {}
        }));
    const notes = [];
    const notesByType = new Map();
    const notesByRelationField = new Map();
    const notesByRelationFieldTarget = new Map();

    for (const observed of sourceNotes) {
        const type = String(observed?.type || '').trim().toLowerCase();
        const fields = observed?.fields || {};
        const id = String(fields.id || observed.cacheId || '').trim();
        const fieldEntries = Object.entries(fields)
            .filter(([key, value]) => {
                const normalized = String(key || '').trim().toLowerCase();
                return normalized && normalized !== 'id' && normalized !== 'type' && String(value || '').trim();
            });
        if (!fieldEntries.length && !type && !id) continue;

        const noteContext = buildNoteContext(fields, type, {
            observedFields,
            getSchemaForType: options.getSchemaForType,
            dateParser: options.dateParser,
            statusLikeValues: options.statusLikeValues,
            semanticRolePriors: options.semanticRolePriors
        });
        const fieldNames = fieldEntries.map(([key]) => String(key || '').trim().toLowerCase());
        const relationIdsByField = new Map();
        const relationFields = [];
        const relatedIds = new Set();

        for (const [rawFieldName, rawValue] of fieldEntries) {
            const normalizedField = String(rawFieldName || '').trim().toLowerCase();
            const linkedIds = extractRelationIds(rawValue);
            if (!linkedIds.length) continue;
            relationFields.push(normalizedField);
            relationIdsByField.set(normalizedField, linkedIds);
            linkedIds.forEach((linkedId) => relatedIds.add(linkedId));
        }

        const note = {
            id,
            type,
            fields,
            noteContext,
            fieldEntries,
            fieldNames,
            relationIdsByField,
            relationFields,
            relatedIds: [...relatedIds]
        };
        notes.push(note);

        if (type) {
            const typed = notesByType.get(type) || [];
            typed.push(note);
            notesByType.set(type, typed);
        }
        for (const [fieldName, linkedIds] of relationIdsByField.entries()) {
            const fieldBucket = notesByRelationField.get(fieldName) || [];
            fieldBucket.push(note);
            notesByRelationField.set(fieldName, fieldBucket);
            for (const linkedId of linkedIds) {
                const targetKey = `${fieldName}\x00${linkedId}`;
                const targetBucket = notesByRelationFieldTarget.get(targetKey) || [];
                targetBucket.push(note);
                notesByRelationFieldTarget.set(targetKey, targetBucket);
            }
        }
    }

    const result = {
        observedFields,
        notes,
        notesByType,
        notesByRelationField,
        notesByRelationFieldTarget
    };
    if (!options.observedFields) {
        _noteIndexCache = result;
        _noteIndexGen = gen;
    }
    return result;
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

function collectCurrentRelationSignals(nodeFields = {}, currentMentionedIds = []) {
    const currentRelationFields = new Set();
    const currentRelatedIds = new Set();

    for (const [fieldName, rawValue] of Object.entries(nodeFields || {})) {
        const linkedIds = extractRelationIds(rawValue);
        if (!linkedIds.length) continue;
        currentRelationFields.add(normalizeFieldName(fieldName));
        linkedIds.forEach((linkedId) => currentRelatedIds.add(linkedId));
    }

    for (const mentionedId of currentMentionedIds || []) {
        const normalizedId = String(mentionedId || '').trim().toLowerCase();
        if (normalizedId) currentRelatedIds.add(normalizedId);
    }

    return {
        currentRelationFields,
        currentRelatedIds
    };
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

function buildObservedRelationGroups(nodeType, fieldsCache) {
    const normalizedNodeType = String(nodeType || '').trim().toLowerCase();
    const groups = new Map();
    if (!normalizedNodeType) return groups;

    for (const [sourceId, sourceFields] of fieldsCache.entries()) {
        void sourceId;
        const sourceType = String(sourceFields?.type || '').trim().toLowerCase();
        if (!sourceType) continue;

        for (const [fieldName, rawValue] of Object.entries(sourceFields || {})) {
            if (fieldName === 'id' || fieldName === 'type') continue;
            const linkedIds = extractRelationIds(rawValue);
            if (!linkedIds.length) continue;

            const matchesTargetType = linkedIds.some(function (linkedId) {
                return String(fieldsCache.get(linkedId)?.type || '').trim().toLowerCase() === normalizedNodeType;
            });
            if (!matchesTargetType) continue;

            const key = `${fieldName}\x00${sourceType}`;
            const current = groups.get(key) || {
                field: fieldName,
                sourceType,
                count: 0,
                examples: new Set()
            };
            current.count += 1;
            linkedIds.slice(0, 2).forEach((linkedId) => current.examples.add(linkedId));
            groups.set(key, current);
        }
    }

    return groups;
}

function buildSharedRelationContexts(nodeFields, noteContext, fieldsCache, options = {}) {
    const getSchemaTargets = options.getSchemaTargets || (() => []);
    const getSchemaForType = options.getSchemaForType || (() => null);
    const observedIndex = options.observedIndex || buildObservedNoteIndex(fieldsCache, options);
    const nodeType = String(options.nodeType || nodeFields.type || '').trim().toLowerCase();
    const contexts = [];
    const seen = new Set();

    function addContext(field, sourceType, relatedId, relatedType, origin) {
        const key = `${field}\x00${sourceType}\x00${relatedId}`;
        if (seen.has(key)) return;
        seen.add(key);
        contexts.push({
            field,
            sourceType,
            relatedId,
            relatedType,
            origin
        });
    }

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

function describeContextOrigin(origin) {
    if (origin === 'observed') return 'observed';
    if (origin === 'schema') return 'schema';
    return 'inferred';
}

function buildBridgePaths(nodeId, nodeFields, noteContext, fieldsCache, options = {}) {
    const observedIndex = options.observedIndex || buildObservedNoteIndex(fieldsCache, options);
    const contexts = buildSharedRelationContexts(nodeFields, noteContext, fieldsCache, {
        ...options,
        observedIndex
    });
    const directIds = new Set();
    for (const value of Object.values(nodeFields || {})) {
        for (const id of extractRelationIds(value)) directIds.add(id);
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
                return extractRelationIds(value).includes(nodeId);
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

function buildAdaptiveFieldPatterns(nodeFields, noteContext, fieldsCache, options = {}) {
    const nodeType = String(options.nodeType || nodeFields.type || '').trim().toLowerCase();
    const observedIndex = options.observedIndex || buildObservedNoteIndex(fieldsCache, options);
    const currentFields = new Set(
        Object.keys(nodeFields || {})
            .map(normalizeFieldName)
            .filter(Boolean)
    );
    const currentRole = noteContext?.noteRole?.noteRole || 'record';
    const {
        currentRelationFields,
        currentRelatedIds
    } = collectCurrentRelationSignals(nodeFields, options.currentMentionedIds);
    const patterns = new Map();

    for (const observed of observedIndex.notes) {
        const observedType = String(observed?.type || '').trim().toLowerCase();
        const observedFieldKeys = observed.fieldNames.map(normalizeFieldName);
        if (!observedFieldKeys.length) continue;
        const observedContext = observed.noteContext;
        const observedRelationFields = (observed.relationFields || []).map(normalizeFieldName).filter(Boolean);
        const sharedFields = observedFieldKeys.filter((key) => currentFields.has(key));
        const sharedRelationFields = observedRelationFields.filter((field) => currentRelationFields.has(field));
        const sharedRelatedIds = (observed.relatedIds || []).filter((id) => currentRelatedIds.has(String(id || '').trim().toLowerCase()));

        let similarity = 0;
        if (nodeType && observedType === nodeType) similarity += 220;
        if (observedContext.noteRole?.noteRole === currentRole) similarity += 160;
        similarity += sharedFields.length * 45;
        similarity += sharedRelationFields.length * 90;
        similarity += sharedRelatedIds.length * 150;
        if (sharedFields.length >= 2) similarity += 40;
        if (sharedRelationFields.length >= 1 && sharedRelatedIds.length >= 1) similarity += 60;
        if (sharedRelatedIds.length >= 2) similarity += 50;

        const hasStrongStructureMatch =
            (nodeType && observedType === nodeType) ||
            observedContext.noteRole?.noteRole === currentRole ||
            sharedFields.length >= 2 ||
            sharedRelationFields.length > 0 ||
            sharedRelatedIds.length > 0;
        if (!hasStrongStructureMatch || similarity < 160) continue;

        for (const [rawFieldName, rawValue] of observed.fieldEntries) {
            const fieldName = normalizeFieldName(rawFieldName);
            if (currentFields.has(fieldName)) continue;

            const role = inferFieldRole(fieldName, {
                documentType: observedType,
                observedFields: observedIndex.observedFields,
                dateParser: options.dateParser,
                statusLikeValues: options.statusLikeValues,
                semanticRolePriors: options.semanticRolePriors
            });
            const entry = patterns.get(fieldName) || {
                field: fieldName,
                count: 0,
                score: 0,
                relational: false,
                semanticRole: null,
                exampleValues: new Set(),
                sampleTargets: new Set(),
                sourceRoles: new Set(),
                sharedFields: new Set(),
                sharedRelatedIds: new Set()
            };
            entry.count += 1;
            entry.score += similarity;
            entry.relational = entry.relational || role.relational;
            entry.semanticRole = entry.semanticRole || role.semanticRole || null;
            if (rawValue && entry.exampleValues.size < 3) entry.exampleValues.add(String(rawValue));
            for (const targetId of extractRelationIds(rawValue).slice(0, 2)) entry.sampleTargets.add(targetId);
            if (observedContext.noteRole?.noteRole) entry.sourceRoles.add(observedContext.noteRole.noteRole);
            for (const field of sharedFields.slice(0, 3)) entry.sharedFields.add(field);
            for (const relatedId of sharedRelatedIds.slice(0, 2)) entry.sharedRelatedIds.add(relatedId);
            patterns.set(fieldName, entry);
        }
    }

    return [...patterns.values()]
        .sort((a, b) => b.score - a.score || b.count - a.count || a.field.localeCompare(b.field));
}

function summarizeAdaptiveFieldHints(patterns = [], limit = 3) {
    return patterns
        .slice(0, limit)
        .map(function (pattern) {
            const sharedFields = [...pattern.sharedFields].slice(0, 2);
            const sharedRelatedIds = [...(pattern.sharedRelatedIds || [])].slice(0, 2);
            const sampleTargets = [...pattern.sampleTargets].slice(0, 2);
            const sharedLead = sharedFields.length
                ? `often add ${pattern.field} with ${sharedFields.join(' and ')}`
                : `often add ${pattern.field}`;
            const relationLead = pattern.relational && sampleTargets.length
                ? `${sharedLead} and link it to ${sampleTargets.join(' and ')}`
                : sharedLead;
            const contextLead = sharedRelatedIds.length
                ? `${relationLead} around ${sharedRelatedIds.join(' and ')}`
                : relationLead;
            return {
                field: pattern.field,
                relational: pattern.relational,
                sampleTargets: [...pattern.sampleTargets],
                summary: contextLead
            };
        });
}

module.exports = {
    buildObservedFields,
    buildObservedNoteIndex,
    buildFieldRoleResults,
    buildNoteRoleHints,
    buildNoteContext,
    extractRelationIds,
    groupStructuredBacklinks,
    buildSchemaRelationGroups,
    buildObservedRelationGroups,
    buildSharedRelationContexts,
    describeContextOrigin,
    buildBridgePaths,
    buildSharedContextTraces,
    buildAdaptiveFieldPatterns,
    summarizeBridgeHints,
    summarizeTraceHints,
    summarizeAdaptiveFieldHints,
    collectCurrentRelationSignals
};
