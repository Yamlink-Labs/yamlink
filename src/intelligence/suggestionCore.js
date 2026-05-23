'use strict';

const {
    inferFieldRole,
    normalizeFieldName,
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS,
    extractBareRelationTargets
} = require('./fieldRolesCore');
const { inferNoteRole, DEFAULT_NOTE_ROLE_PRIORS } = require('./noteRolesCore');
const { getCachedPriors } = require('./vaultPriors');
const { getVaultGeneration } = require('../core/indexService');
const { extractTagsFromNodeFields } = require('./tagSignals');

let _noteIndexCache = null;
let _noteIndexGen = -1;
let _noteEntryCache = new Map();
let _noteIndexSourceMeta = new Map();

function resetObservedNoteIndexCache() {
    _noteIndexCache = null;
    _noteIndexGen = -1;
    _noteEntryCache = new Map();
    _noteIndexSourceMeta = new Map();
}
const RECENCY_REFERENCE_DATE = '2026-05-08';

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
            semanticRolePriors,
            idToType: options.idToType
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
        semanticRolePriors: options.semanticRolePriors,
        idToType: options.idToType
    });
    const noteRole = inferNoteRole(nodeFields, {
        fieldRoleResults,
        titleHints: options.titleHints || buildNoteRoleHints(nodeFields),
        noteRolePriors: options.noteRolePriors
    });
    return {
        fieldRoleResults,
        noteRole
    };
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function buildObservedFingerprint(observed) {
    return stableStringify({
        cacheId: String(observed?.cacheId || '').trim(),
        type: String(observed?.type || '').trim().toLowerCase(),
        fields: observed?.fields || {}
    });
}

function buildNoteRolePriorsSignature(priors) {
    return stableStringify(priors || {});
}

function buildAdaptiveConfidence(pattern) {
    const score = Number(pattern?.score || 0);
    const count = Number(pattern?.count || 0);
    const sharedFields = (pattern?.sharedFields?.size ?? pattern?.sharedFields?.length ?? 0);
    const sharedRelatedIds = (pattern?.sharedRelatedIds?.size ?? pattern?.sharedRelatedIds?.length ?? 0);
    const sharedTags = (pattern?.sharedTags?.size ?? pattern?.sharedTags?.length ?? 0);
    const relationalBoost = pattern?.relational ? 25 : 0;
    const confidenceScore = score + (count * 18) + (sharedFields * 20) + (sharedRelatedIds * 45) + (sharedTags * 16) + relationalBoost;
    if (confidenceScore >= 520) return { confidenceBand: 'high', confidenceScore };
    if (confidenceScore >= 280) return { confidenceBand: 'medium', confidenceScore };
    return { confidenceBand: 'low', confidenceScore };
}

function normalizeDateLikeValue(value, parser) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parsed = typeof parser === 'function' ? parser(text) : null;
    const normalized = String(parsed || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function computeObservedRecency(fields = {}, options = {}) {
    const parser = options.dateParser;
    const referenceDate = normalizeDateLikeValue(options.referenceDate || RECENCY_REFERENCE_DATE, parser) || RECENCY_REFERENCE_DATE;
    const candidates = [
        fields.updated,
        fields.modified,
        fields.last_updated,
        fields.last_modified,
        fields.created,
        fields.date
    ]
        .map((value) => normalizeDateLikeValue(value, parser))
        .filter(Boolean)
        .sort()
        .reverse();
    if (!candidates.length) {
        return {
            referenceDate,
            normalizedDate: null,
            ageDays: null,
            recencyWeight: 1
        };
    }
    const normalizedDate = candidates[0];
    const ageDays = Math.max(0, Math.floor((Date.parse(`${referenceDate}T00:00:00Z`) - Date.parse(`${normalizedDate}T00:00:00Z`)) / 86400000));
    let recencyWeight = 1;
    if (ageDays <= 14) recencyWeight = 1.18;
    else if (ageDays <= 30) recencyWeight = 1.1;
    else if (ageDays <= 90) recencyWeight = 1;
    else if (ageDays <= 180) recencyWeight = 0.92;
    else if (ageDays <= 365) recencyWeight = 0.82;
    else recencyWeight = 0.7;
    return {
        referenceDate,
        normalizedDate,
        ageDays,
        recencyWeight
    };
}

function cloneBucketMap(map) {
    return new Map(Array.from(map.entries(), ([key, values]) => [key, [...values]]));
}

function removeObservedNoteFromIndexes(note, notesByType, notesByRelationField, notesByRelationFieldTarget) {
    if (!note) return;
    if (note.type && notesByType.has(note.type)) {
        const filtered = notesByType.get(note.type).filter((entry) => entry !== note);
        if (filtered.length) notesByType.set(note.type, filtered);
        else notesByType.delete(note.type);
    }
    for (const [fieldName, linkedIds] of (note.relationIdsByField || new Map()).entries()) {
        if (notesByRelationField.has(fieldName)) {
            const filtered = notesByRelationField.get(fieldName).filter((entry) => entry !== note);
            if (filtered.length) notesByRelationField.set(fieldName, filtered);
            else notesByRelationField.delete(fieldName);
        }
        for (const linkedId of linkedIds || []) {
            const targetKey = `${fieldName}\x00${linkedId}`;
            if (!notesByRelationFieldTarget.has(targetKey)) continue;
            const filtered = notesByRelationFieldTarget.get(targetKey).filter((entry) => entry !== note);
            if (filtered.length) notesByRelationFieldTarget.set(targetKey, filtered);
            else notesByRelationFieldTarget.delete(targetKey);
        }
    }
}

function addObservedNoteToIndexes(note, notesByType, notesByRelationField, notesByRelationFieldTarget) {
    if (!note) return;
    if (note.type) {
        const typed = notesByType.get(note.type) || [];
        typed.push(note);
        notesByType.set(note.type, typed);
    }
    for (const [fieldName, linkedIds] of (note.relationIdsByField || new Map()).entries()) {
        const fieldBucket = notesByRelationField.get(fieldName) || [];
        fieldBucket.push(note);
        notesByRelationField.set(fieldName, fieldBucket);
        for (const linkedId of linkedIds || []) {
            const targetKey = `${fieldName}\x00${linkedId}`;
            const targetBucket = notesByRelationFieldTarget.get(targetKey) || [];
            targetBucket.push(note);
            notesByRelationFieldTarget.set(targetKey, targetBucket);
        }
    }
}

function buildObservedNote(observed, observedFields, options, idToType, knownIds, learnedNoteRolePriors, priorsSignature) {
    const type = String(observed?.type || '').trim().toLowerCase();
    const fields = observed?.fields || {};
    const id = String(fields.id || observed.cacheId || '').trim();
    const fieldEntries = Object.entries(fields)
        .filter(([key, value]) => {
            const normalized = String(key || '').trim().toLowerCase();
            return normalized && normalized !== 'id' && normalized !== 'type' && String(value || '').trim();
        });
    if (!fieldEntries.length && !type && !id) return null;

    const observedFingerprint = buildObservedFingerprint(observed);
    const cacheKey = String(id || observed.cacheId || '').trim().toLowerCase();
    const cachedEntry = cacheKey ? _noteEntryCache.get(cacheKey) : null;
    if (cachedEntry && cachedEntry.fingerprint === observedFingerprint && cachedEntry.priorsSignature === priorsSignature) {
        return {
            cacheKey,
            fingerprint: observedFingerprint,
            note: cachedEntry.note
        };
    }

    const noteContext = buildNoteContext(fields, type, {
        observedFields,
        getSchemaForType: options.getSchemaForType,
        dateParser: options.dateParser,
        statusLikeValues: options.statusLikeValues,
        semanticRolePriors: options.semanticRolePriors,
        idToType,
        noteRolePriors: learnedNoteRolePriors
    });
    const fieldNames = fieldEntries.map(([key]) => String(key || '').trim().toLowerCase());
    const relationIdsByField = new Map();
    const relationFields = [];
    const relatedIds = new Set();

    for (const [rawFieldName, rawValue] of fieldEntries) {
        const normalizedField = String(rawFieldName || '').trim().toLowerCase();
        const linkedIds = extractRelationIds(rawValue, knownIds);
        if (!linkedIds.length) continue;
        relationFields.push(normalizedField);
        relationIdsByField.set(normalizedField, linkedIds);
        linkedIds.forEach((linkedId) => relatedIds.add(linkedId));
    }

    return {
        cacheKey,
        fingerprint: observedFingerprint,
        note: {
            id,
            type,
            fields,
            tags: extractTagsFromNodeFields(fields),
            recency: computeObservedRecency(fields, options),
            noteContext,
            fieldEntries,
            fieldNames,
            relationIdsByField,
            relationFields,
            relatedIds: [...relatedIds]
        }
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
    const knownIds = new Set(
        sourceNotes
            .map((observed) => String(observed?.fields?.id || observed?.cacheId || '').trim().toLowerCase())
            .filter(Boolean)
    );
    const idToType = new Map();
    for (const observed of sourceNotes) {
        const observedId = String(observed?.fields?.id || observed?.cacheId || '').trim().toLowerCase();
        const observedType = String(observed?.type || '').trim().toLowerCase();
        if (observedId && observedType) idToType.set(observedId, observedType);
    }
    const learnedNoteRolePriors = buildLearnedNoteRolePriors(sourceNotes);
    const priorsSignature = buildNoteRolePriorsSignature(learnedNoteRolePriors);

    if (!options.observedFields && _noteIndexCache && _noteIndexSourceMeta.size && _noteIndexCache.priorsSignature === priorsSignature) {
        const currentMeta = new Map();
        for (const observed of sourceNotes) {
            const cacheKey = String(observed?.fields?.id || observed?.cacheId || '').trim().toLowerCase();
            if (!cacheKey) continue;
            currentMeta.set(cacheKey, buildObservedFingerprint(observed));
        }

        const addedOrChanged = [];
        const removedKeys = [];
        for (const [cacheKey, fingerprint] of currentMeta.entries()) {
            if (_noteIndexSourceMeta.get(cacheKey) !== fingerprint) addedOrChanged.push(cacheKey);
        }
        for (const cacheKey of _noteIndexSourceMeta.keys()) {
            if (!currentMeta.has(cacheKey)) removedKeys.push(cacheKey);
        }

        if (!addedOrChanged.length && !removedKeys.length) {
            _noteIndexGen = gen;
            return _noteIndexCache;
        }

        const noteByCacheKey = new Map(
            _noteIndexCache.notes.map((note) => [String(note?.id || '').trim().toLowerCase(), note])
        );
        const notesByType = cloneBucketMap(_noteIndexCache.notesByType);
        const notesByRelationField = cloneBucketMap(_noteIndexCache.notesByRelationField);
        const notesByRelationFieldTarget = cloneBucketMap(_noteIndexCache.notesByRelationFieldTarget);
        const nextEntryCache = new Map(_noteEntryCache);

        for (const cacheKey of removedKeys) {
            const oldNote = noteByCacheKey.get(cacheKey);
            removeObservedNoteFromIndexes(oldNote, notesByType, notesByRelationField, notesByRelationFieldTarget);
            noteByCacheKey.delete(cacheKey);
            nextEntryCache.delete(cacheKey);
        }

        const sourceNotesByKey = new Map(
            sourceNotes.map((observed) => [String(observed?.fields?.id || observed?.cacheId || '').trim().toLowerCase(), observed])
        );
        for (const cacheKey of addedOrChanged) {
            const oldNote = noteByCacheKey.get(cacheKey);
            removeObservedNoteFromIndexes(oldNote, notesByType, notesByRelationField, notesByRelationFieldTarget);

            const observed = sourceNotesByKey.get(cacheKey);
            const built = buildObservedNote(observed, observedFields, options, idToType, knownIds, learnedNoteRolePriors, priorsSignature);
            if (!built) {
                noteByCacheKey.delete(cacheKey);
                nextEntryCache.delete(cacheKey);
                continue;
            }
            noteByCacheKey.set(cacheKey, built.note);
            nextEntryCache.set(cacheKey, {
                fingerprint: built.fingerprint,
                priorsSignature,
                note: built.note
            });
            addObservedNoteToIndexes(built.note, notesByType, notesByRelationField, notesByRelationFieldTarget);
        }

        const notes = sourceNotes
            .map((observed) => noteByCacheKey.get(String(observed?.fields?.id || observed?.cacheId || '').trim().toLowerCase()))
            .filter(Boolean);

        const result = {
            observedFields,
            knownIds,
            idToType,
            learnedNoteRolePriors,
            priorsSignature,
            notes,
            notesByType,
            notesByRelationField,
            notesByRelationFieldTarget
        };
        _noteIndexCache = result;
        _noteIndexGen = gen;
        _noteEntryCache = nextEntryCache;
        _noteIndexSourceMeta = currentMeta;
        return result;
    }

    const notes = [];
    const notesByType = new Map();
    const notesByRelationField = new Map();
    const notesByRelationFieldTarget = new Map();
    const nextEntryCache = new Map();
    const nextSourceMeta = new Map();

    for (const observed of sourceNotes) {
        const built = buildObservedNote(observed, observedFields, options, idToType, knownIds, learnedNoteRolePriors, priorsSignature);
        if (!built) continue;
        notes.push(built.note);
        if (built.cacheKey) {
            nextEntryCache.set(built.cacheKey, {
                fingerprint: built.fingerprint,
                priorsSignature,
                note: built.note
            });
            nextSourceMeta.set(built.cacheKey, built.fingerprint);
        }
        addObservedNoteToIndexes(built.note, notesByType, notesByRelationField, notesByRelationFieldTarget);
    }

    const result = {
        observedFields,
        knownIds,
        idToType,
        learnedNoteRolePriors,
        priorsSignature,
        notes,
        notesByType,
        notesByRelationField,
        notesByRelationFieldTarget
    };
    if (!options.observedFields) {
        _noteIndexCache = result;
        _noteIndexGen = gen;
    }
    _noteEntryCache = nextEntryCache;
    if (!options.observedFields) _noteIndexSourceMeta = nextSourceMeta;
    return result;
}

function buildLearnedNoteRolePriors(sourceNotes = []) {
    const learned = Object.fromEntries(
        Object.entries(DEFAULT_NOTE_ROLE_PRIORS).map(([role, names]) => [role, [...names]])
    );
    const roleTypeCounts = new Map();

    for (const observed of sourceNotes) {
        const fields = observed?.fields || {};
        const type = String(observed?.type || '').trim().toLowerCase();
        if (!type) continue;
        const noteRole = inferNoteRole(fields, {
            titleHints: buildNoteRoleHints(fields)
        });
        const broadRole = noteRole?.noteRole;
        if (!broadRole || broadRole === 'record') continue;
        const counts = roleTypeCounts.get(type) || new Map();
        counts.set(broadRole, (counts.get(broadRole) || 0) + 1);
        for (const secondaryRole of noteRole?.secondaryRoles || []) {
            if (!secondaryRole || secondaryRole === 'record') continue;
            counts.set(secondaryRole, (counts.get(secondaryRole) || 0) + 0.5);
        }
        roleTypeCounts.set(type, counts);
    }

    for (const [type, counts] of roleTypeCounts.entries()) {
        let topRole = null;
        let topCount = 0;
        let total = 0;
        for (const [role, count] of counts.entries()) {
            total += count;
            if (count > topCount) {
                topRole = role;
                topCount = count;
            }
        }
        if (!topRole || !total) continue;
        if ((topCount / total) < 0.6) continue;
        if (!learned[topRole]) learned[topRole] = [];
        if (!learned[topRole].includes(type)) learned[topRole].push(type);
    }

    return learned;
}

function extractRelationIds(value, knownIds = new Set()) {
    const text = String(value || '');
    const ids = [];
    const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const id = String(match[1] || '').trim();
        if (id) ids.push(id);
    }
    for (const id of extractBareRelationTargets(text, knownIds)) {
        ids.push(id);
    }
    return [...new Set(ids.map((id) => String(id || '').trim().toLowerCase()).filter(Boolean))];
}

function collectCurrentRelationSignals(nodeFields = {}, currentMentionedIds = [], knownIds = new Set()) {
    const currentRelationFields = new Set();
    const currentRelatedIds = new Set();

    for (const [fieldName, rawValue] of Object.entries(nodeFields || {})) {
        const linkedIds = extractRelationIds(rawValue, knownIds);
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
    const knownIds = options.knownIds || observedIndex.knownIds || new Set();
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

function describeContextOrigin(origin) {
    if (origin === 'observed') return 'observed';
    if (origin === 'schema') return 'schema';
    return 'inferred';
}

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

function buildTypeTotals(fieldsCache) {
    const totals = new Map();
    for (const [, fields] of fieldsCache || new Map()) {
        const noteType = String(fields?.type || '').trim().toLowerCase();
        if (!noteType) continue;
        totals.set(noteType, (totals.get(noteType) || 0) + 1);
    }
    return totals;
}

function computeFieldBundleOverlap(currentFields, observedType, typeFieldBundles, typeTotals) {
    const normalizedType = String(observedType || '').trim().toLowerCase();
    const bundle = typeFieldBundles?.get(normalizedType);
    const totalNotes = typeTotals?.get(normalizedType) || 0;
    if (!bundle?.size || !totalNotes || !currentFields?.size) {
        return {
            matchedFields: [],
            overlap: 0,
            presence: 0,
            score: 0
        };
    }

    let weightedPresence = 0;
    const matchedFields = [];
    for (const fieldName of currentFields) {
        const fieldCount = bundle.get(fieldName) || 0;
        if (!fieldCount) continue;
        matchedFields.push(fieldName);
        weightedPresence += fieldCount / totalNotes;
    }

    if (!matchedFields.length) {
        return {
            matchedFields: [],
            overlap: 0,
            presence: 0,
            score: 0
        };
    }

    const overlap = matchedFields.length / currentFields.size;
    const presence = weightedPresence / currentFields.size;
    return {
        matchedFields,
        overlap,
        presence,
        score: Math.min(320, Math.round((overlap * 220) + (presence * 180)))
    };
}

function buildAdaptiveFieldPatterns(nodeFields, noteContext, fieldsCache, options = {}) {
    const nodeType = String(options.nodeType || nodeFields.type || '').trim().toLowerCase();
    const observedIndex = options.observedIndex || buildObservedNoteIndex(fieldsCache, options);
    const knownIds = options.knownIds || observedIndex.knownIds || new Set();
    const priors = options.typeFieldBundles
        ? { typeFieldBundles: options.typeFieldBundles }
        : getCachedPriors(fieldsCache, getVaultGeneration());
    const typeFieldBundles = priors?.typeFieldBundles || new Map();
    const typeTotals = options.typeTotals || buildTypeTotals(fieldsCache);
    const currentFields = new Set(
        Object.keys(nodeFields || {})
            .map(normalizeFieldName)
            .filter(Boolean)
    );
    const currentTags = new Set(
        (options.currentTags || noteContext?.currentTags || extractTagsFromNodeFields(nodeFields || {}))
            .map((tag) => String(tag || '').trim().toLowerCase())
            .filter(Boolean)
    );
    const {
        currentRelationFields,
        currentRelatedIds
    } = collectCurrentRelationSignals(nodeFields, options.currentMentionedIds, knownIds);
    const patterns = new Map();
    const GENERIC_TYPES = new Set(['note', 'entry', 'page', 'doc', 'document', '']);
    const currentTypeIsSpecific = nodeType && !GENERIC_TYPES.has(nodeType);

    for (const observed of observedIndex.notes) {
        const observedType = String(observed?.type || '').trim().toLowerCase();
        const observedFieldKeys = observed.fieldNames.map(normalizeFieldName);
        if (!observedFieldKeys.length) continue;
        const observedContext = observed.noteContext;
        const observedRelationFields = (observed.relationFields || []).map(normalizeFieldName).filter(Boolean);
        const observedTags = (observed.tags || []).map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean);
        const sharedFields = observedFieldKeys.filter((key) => currentFields.has(key));
        const sharedRelationFields = observedRelationFields.filter((field) => currentRelationFields.has(field));
        const sharedRelatedIds = (observed.relatedIds || []).filter((id) => currentRelatedIds.has(String(id || '').trim().toLowerCase()));
        const sharedTags = observedTags.filter((tag) => currentTags.has(tag));
        const bundleOverlap = computeFieldBundleOverlap(currentFields, observedType, typeFieldBundles, typeTotals);

        let similarity = 0;
        if (nodeType && observedType === nodeType) similarity += 220;
        similarity += bundleOverlap.score;
        similarity += sharedFields.length * 45;
        similarity += sharedRelationFields.length * 90;
        similarity += sharedRelatedIds.length * 220;
        similarity += sharedTags.length * 75;
        if (sharedFields.length >= 2) similarity += 40;
        if (sharedRelationFields.length >= 1 && sharedRelatedIds.length >= 1) similarity += 60;
        if (sharedRelatedIds.length >= 2) similarity += 50;
        if (sharedTags.length >= 2) similarity += 35;

        const hasStrongStructureMatch =
            (nodeType && observedType === nodeType) ||
            bundleOverlap.matchedFields.length >= 2 ||
            bundleOverlap.score >= 120 ||
            sharedFields.length >= 2 ||
            sharedRelationFields.length > 0 ||
            sharedRelatedIds.length > 0 ||
            sharedTags.length > 0;
        const observedTypeIsSpecific = observedType && !GENERIC_TYPES.has(observedType);
        let minSimilarity = (currentTypeIsSpecific && observedTypeIsSpecific && observedType !== nodeType) ? 260 : 160;
        if (sharedRelatedIds.length > 0 || sharedRelationFields.length > 0) {
            minSimilarity = Math.min(minSimilarity, 140);
        }
        if (!hasStrongStructureMatch || similarity < minSimilarity) continue;
        const recencyWeight = Number(observed?.recency?.recencyWeight || 1);
        const weightedSimilarity = Math.round(similarity * recencyWeight);

        for (const [rawFieldName, rawValue] of observed.fieldEntries) {
            const fieldName = normalizeFieldName(rawFieldName);
            if (currentFields.has(fieldName)) continue;

            const role = inferFieldRole(fieldName, {
                documentType: observedType,
                observedFields: observedIndex.observedFields,
                dateParser: options.dateParser,
                statusLikeValues: options.statusLikeValues,
                semanticRolePriors: options.semanticRolePriors,
                idToType: observedIndex.idToType
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
                secondaryRoles: new Set(),
                sharedFields: new Set(),
                sharedRelatedIds: new Set(),
                sharedTags: new Set()
            };
            entry.count += 1;
            entry.score += weightedSimilarity;
            entry.rawScore = (entry.rawScore || 0) + similarity;
            entry.relational = entry.relational || role.relational;
            entry.semanticRole = entry.semanticRole || role.semanticRole || null;
            if (rawValue && entry.exampleValues.size < 3) entry.exampleValues.add(String(rawValue));
            for (const targetId of extractRelationIds(rawValue, knownIds).slice(0, 2)) entry.sampleTargets.add(targetId);
            if (observedContext.noteRole?.noteRole) entry.sourceRoles.add(observedContext.noteRole.noteRole);
            for (const secondaryRole of observedContext.noteRole?.secondaryRoles || []) entry.secondaryRoles.add(secondaryRole);
            for (const field of sharedFields.slice(0, 3)) entry.sharedFields.add(field);
            for (const relatedId of sharedRelatedIds.slice(0, 2)) entry.sharedRelatedIds.add(relatedId);
            for (const tag of sharedTags.slice(0, 3)) entry.sharedTags.add(tag);
            entry.maxRecencyWeight = Math.max(Number(entry.maxRecencyWeight || 0), recencyWeight);
            entry.freshestAgeDays = entry.freshestAgeDays == null
                ? observed?.recency?.ageDays ?? null
                : Math.min(entry.freshestAgeDays, observed?.recency?.ageDays ?? entry.freshestAgeDays);
            patterns.set(fieldName, entry);
        }
    }

    return [...patterns.values()]
        .map((pattern) => ({
            ...pattern,
            ...buildAdaptiveConfidence(pattern)
        }))
        .filter((pattern) => pattern.confidenceBand !== 'low')
        .sort((a, b) =>
            b.confidenceScore - a.confidenceScore ||
            b.score - a.score ||
            b.count - a.count ||
            a.field.localeCompare(b.field)
        );
}

function summarizeAdaptiveFieldHints(patterns = [], limit = 3) {
    return patterns
        .slice(0, limit)
        .map(function (pattern) {
            const sharedFields = [...pattern.sharedFields].slice(0, 2);
            const sharedRelatedIds = [...(pattern.sharedRelatedIds || [])].slice(0, 2);
            const sharedTags = [...(pattern.sharedTags || [])].slice(0, 2);
            const sampleTargets = [...pattern.sampleTargets].slice(0, 2);
            const sharedLead = sharedFields.length
                ? `often add ${pattern.field} with ${sharedFields.join(' and ')}`
                : `often add ${pattern.field}`;
            const tagLead = sharedTags.length
                ? `${sharedLead} in ${sharedTags.join(' and ')} notes`
                : sharedLead;
            const relationLead = pattern.relational && sampleTargets.length
                ? `${tagLead} and link it to ${sampleTargets.join(' and ')}`
                : tagLead;
            const contextLead = sharedRelatedIds.length
                ? `${relationLead} around ${sharedRelatedIds.join(' and ')}`
                : relationLead;
            return {
                field: pattern.field,
                relational: pattern.relational,
                sampleTargets: [...pattern.sampleTargets],
                confidenceBand: pattern.confidenceBand || 'medium',
                summary: contextLead
            };
        });
}

module.exports = {
    buildObservedFields,
    buildObservedNoteIndex,
    resetObservedNoteIndexCache,
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
    buildAdaptiveConfidence,
    computeObservedRecency,
    summarizeBridgeHints,
    summarizeTraceHints,
    summarizeAdaptiveFieldHints,
    collectCurrentRelationSignals
};
