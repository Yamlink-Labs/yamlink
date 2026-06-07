'use strict';

const {
    inferFieldRole,
    normalizeFieldName,
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS,
    extractBareRelationTargets
} = require('./fieldRolesCore');
const { inferNoteRole, DEFAULT_NOTE_ROLE_PRIORS } = require('./noteRolesCore');
const { getVaultGeneration } = require('../core/indexService');
const { getTodayIsoLocal } = require('../core/date');
const { extractTagsFromNodeFields } = require('./tagSignals');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {{ type: string, fields: Record<string, any>, cacheId?: string }} ObservedEntry
 */

/**
 * @typedef {{
 *   id: string,
 *   type: string,
 *   fields: Record<string, any>,
 *   tags: string[],
 *   fieldNames: string[],
 *   fieldEntries: Array<[string, any]>,
 *   relationIdsByField: Map<string, string[]>,
 *   relationFields: string[],
 *   relatedIds: string[],
 *   noteContext: Record<string, any>,
 *   recency: { referenceDate: string, normalizedDate: string|null, ageDays: number|null, recencyWeight: number }
 * }} ObservedNote
 */

/**
 * @typedef {{
 *   observedFields: ObservedEntry[],
 *   knownIds: Set<string>,
 *   idToType: Map<string, string>,
 *   learnedNoteRolePriors: Record<string, any>,
 *   priorsSignature: string,
 *   notes: ObservedNote[],
 *   notesByType: Map<string, ObservedNote[]>,
 *   notesByRelationField: Map<string, ObservedNote[]>,
 *   notesByRelationFieldTarget: Map<string, ObservedNote[]>
 * }} ObservedNoteIndex
 */

/**
 * @typedef {{
 *   candidateId: string,
 *   candidateType: string,
 *   field: string,
 *   relatedId: string,
 *   relatedType: string,
 *   origin: string
 * }} BridgePath
 */

/**
 * @typedef {{
 *   candidateId: string,
 *   candidateType: string,
 *   field: string,
 *   relatedId: string,
 *   relatedType: string,
 *   origin: string,
 *   path: string[]
 * }} ContextTrace
 */

/**
 * @typedef {{
 *   field: string,
 *   relational: boolean,
 *   sampleTargets: Set<string>,
 *   sharedFields: Set<string>,
 *   sharedRelatedIds?: Set<string>,
 *   sharedTags?: Set<string>,
 *   count?: number,
 *   score?: number,
 *   semanticRole?: string|null,
 *   exampleValues?: Set<string>,
 *   sourceRoles?: Set<string>,
 *   secondaryRoles?: Set<string>,
 *   confidenceBand?: string,
 *   confidenceScore?: number,
 *   maxRecencyWeight?: number,
 *   freshestAgeDays?: number|null,
 *   rawScore?: number
 * }} AdaptiveFieldPattern
 */

// ---------------------------------------------------------------------------

let _noteIndexCache = null;
let _noteIndexGen = -1;
let _noteEntryCache = new Map();
let _noteIndexSourceMeta = new Map();

/** @returns {void} */
function resetObservedNoteIndexCache() {
    _noteIndexCache = null;
    _noteIndexGen = -1;
    _noteEntryCache = new Map();
    _noteIndexSourceMeta = new Map();
}

// Reference date for recency calculations — always today so aging scores stay current.
function getRecencyReferenceDate() { return getTodayIsoLocal(); }

/**
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {ObservedEntry[]}
 */
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

/**
 * @param {Record<string, any>} nodeFields
 * @param {string} nodeType
 * @param {Record<string, any>} [options]
 * @returns {Array<Record<string, any>>}
 */
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

/**
 * @param {Record<string, any>} [nodeFields]
 * @returns {string[]}
 */
function buildNoteRoleHints(nodeFields = {}) {
    const hints = [];
    if (nodeFields.name) hints.push(nodeFields.name);
    if (nodeFields.title) hints.push(nodeFields.title);
    if (nodeFields.id) hints.push(nodeFields.id);
    return hints;
}

/**
 * @param {Record<string, any>} nodeFields
 * @param {string} nodeType
 * @param {Record<string, any>} [options]
 * @returns {{ fieldRoleResults: Array<Record<string, any>>, noteRole: Record<string, any>, currentTags?: string[] }}
 */
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
    return { fieldRoleResults, noteRole };
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

function normalizeDateLikeValue(value, parser) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parsed = typeof parser === 'function' ? parser(text) : null;
    const normalized = String(parsed || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

/**
 * @param {Record<string, any>} [fields]
 * @param {Record<string, any>} [options]
 * @returns {{ referenceDate: string, normalizedDate: string|null, ageDays: number|null, recencyWeight: number }}
 */
function computeObservedRecency(fields = {}, options = {}) {
    const parser = options.dateParser;
    const today = getRecencyReferenceDate();
    const referenceDate = normalizeDateLikeValue(options.referenceDate || today, parser) || today;
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
        return { referenceDate, normalizedDate: null, ageDays: null, recencyWeight: 1 };
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
    return { referenceDate, normalizedDate, ageDays, recencyWeight };
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

/**
 * @param {any} value
 * @param {Set<string>|string[]} [knownIds]
 * @returns {string[]}
 */
function extractRelationIds(value, knownIds = new Set()) {
    const text = String(value || '');
    const ids = [];
    const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const id = String(match[1] || '').trim();
        if (id) ids.push(id);
    }
    for (const id of extractBareRelationTargets(text, Array.from(knownIds))) {
        ids.push(id);
    }
    return [...new Set(ids.map((id) => String(id || '').trim().toLowerCase()).filter(Boolean))];
}

/**
 * @param {Record<string, any>} [nodeFields]
 * @param {string[]} [currentMentionedIds]
 * @param {Set<string>} [knownIds]
 * @returns {{ currentRelationFields: Set<string>, currentRelatedIds: Set<string> }}
 */
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

    return { currentRelationFields, currentRelatedIds };
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
            if (count > topCount) { topRole = role; topCount = count; }
        }
        if (!topRole || !total) continue;
        if ((topCount / total) < 0.6) continue;
        if (!learned[topRole]) learned[topRole] = [];
        if (!learned[topRole].includes(type)) learned[topRole].push(type);
    }

    return learned;
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
        return { cacheKey, fingerprint: observedFingerprint, note: cachedEntry.note };
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

/**
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {Record<string, any>} [options]
 * @returns {ObservedNoteIndex}
 */
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
            nextEntryCache.set(cacheKey, { fingerprint: built.fingerprint, priorsSignature, note: built.note });
            addObservedNoteToIndexes(built.note, notesByType, notesByRelationField, notesByRelationFieldTarget);
        }

        const notes = sourceNotes
            .map((observed) => noteByCacheKey.get(String(observed?.fields?.id || observed?.cacheId || '').trim().toLowerCase()))
            .filter(Boolean);

        const result = {
            observedFields, knownIds, idToType, learnedNoteRolePriors, priorsSignature,
            notes, notesByType, notesByRelationField, notesByRelationFieldTarget
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
            nextEntryCache.set(built.cacheKey, { fingerprint: built.fingerprint, priorsSignature, note: built.note });
            nextSourceMeta.set(built.cacheKey, built.fingerprint);
        }
        addObservedNoteToIndexes(built.note, notesByType, notesByRelationField, notesByRelationFieldTarget);
    }

    const result = {
        observedFields, knownIds, idToType, learnedNoteRolePriors, priorsSignature,
        notes, notesByType, notesByRelationField, notesByRelationFieldTarget
    };
    if (!options.observedFields) {
        _noteIndexCache = result;
        _noteIndexGen = gen;
    }
    _noteEntryCache = nextEntryCache;
    if (!options.observedFields) _noteIndexSourceMeta = nextSourceMeta;
    return result;
}

module.exports = {
    buildObservedFields,
    buildObservedNoteIndex,
    resetObservedNoteIndexCache,
    buildFieldRoleResults,
    buildNoteRoleHints,
    buildNoteContext,
    extractRelationIds,
    collectCurrentRelationSignals,
    computeObservedRecency
};
