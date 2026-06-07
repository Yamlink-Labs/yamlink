'use strict';

const { inferFieldRole, normalizeFieldName } = require('./fieldRolesCore');
const { getCachedPriors } = require('./vaultPriors');
const { getVaultGeneration } = require('../core/indexService');
const { extractTagsFromNodeFields } = require('./tagSignals');
const {
    buildObservedNoteIndex,
    extractRelationIds,
    collectCurrentRelationSignals
} = require('./suggestionNoteIndex');

/**
 * @param {Record<string, any>} pattern
 * @returns {{ confidenceBand: string, confidenceScore: number }}
 */
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

/**
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {Map<string, number>}
 */
function buildTypeTotals(fieldsCache) {
    const totals = new Map();
    for (const [, fields] of fieldsCache || new Map()) {
        const noteType = String(fields?.type || '').trim().toLowerCase();
        if (!noteType) continue;
        totals.set(noteType, (totals.get(noteType) || 0) + 1);
    }
    return totals;
}

/**
 * @param {Set<string>} currentFields
 * @param {string} observedType
 * @param {Map<string, Map<string, number>>} typeFieldBundles
 * @param {Map<string, number>} typeTotals
 * @returns {{ matchedFields: string[], overlap: number, presence: number, score: number }}
 */
function computeFieldBundleOverlap(currentFields, observedType, typeFieldBundles, typeTotals) {
    const normalizedType = String(observedType || '').trim().toLowerCase();
    const bundle = typeFieldBundles?.get(normalizedType);
    const totalNotes = typeTotals?.get(normalizedType) || 0;
    if (!bundle?.size || !totalNotes || !currentFields?.size) {
        return { matchedFields: [], overlap: 0, presence: 0, score: 0 };
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
        return { matchedFields: [], overlap: 0, presence: 0, score: 0 };
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

/**
 * @param {import('./suggestionNoteIndex').AdaptiveFieldPattern[]} [patterns]
 * @param {number} [limit]
 * @returns {Array<{field: string, relational: boolean, sampleTargets: string[], confidenceBand: string, summary: string}>}
 */
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

/**
 * @param {Record<string, any>} nodeFields
 * @param {{ fieldRoleResults: Array<Record<string, any>>, noteRole: Record<string, any>, currentTags?: string[] }} noteContext
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {Record<string, any>} [options]
 * @returns {import('./suggestionNoteIndex').AdaptiveFieldPattern[]}
 */
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

module.exports = {
    buildAdaptiveConfidence,
    buildTypeTotals,
    computeFieldBundleOverlap,
    buildAdaptiveFieldPatterns,
    summarizeAdaptiveFieldHints
};
