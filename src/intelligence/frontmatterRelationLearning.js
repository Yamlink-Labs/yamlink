'use strict';

const { buildObservedNoteIndex } = require('./suggestionCore');
const {
    naturalList,
    detectFieldFamily,
    collectCurrentFieldFamilies,
    getFieldRoleResult
} = require('./frontmatterFieldFamilies');
const {
    buildSchemaAdaptiveGaps,
    buildRecommendedBundles
} = require('./frontmatterGapLearning');

function scoreObservedSimilarity(nodeFields = {}, noteContext = {}, observedFields = {}, observedType = '', observedContext = {}, options = {}) {
    const nodeType = String(options.nodeType || nodeFields?.type || '').trim().toLowerCase();
    const currentRole = noteContext?.noteRole?.noteRole || 'record';
    const currentFieldNames = new Set(
        Object.keys(nodeFields || {})
            .map((key) => String(key || '').trim().toLowerCase())
            .filter((key) => key && key !== 'id' && key !== 'type')
    );
    const currentFamilies = collectCurrentFieldFamilies(nodeFields, noteContext);
    const observedFieldNames = Object.keys(observedFields || {})
        .map((key) => String(key || '').trim().toLowerCase())
        .filter((key) => key && key !== 'id' && key !== 'type');
    const observedFamilies = new Set();
    for (const fieldName of observedFieldNames) {
        const family = detectFieldFamily(fieldName, getFieldRoleResult(observedContext, fieldName)?.semanticRole || null);
        if (family) observedFamilies.add(family);
    }

    let similarity = 0;
    if (nodeType && observedType === nodeType) similarity += 220;
    if (observedContext.noteRole?.noteRole === currentRole) similarity += 180;

    const sharedFields = observedFieldNames.filter((field) => currentFieldNames.has(field));
    similarity += sharedFields.length * 45;

    let sharedFamilies = 0;
    for (const family of observedFamilies) {
        if (currentFamilies.has(family)) sharedFamilies++;
    }
    similarity += sharedFamilies * 55;

    return {
        similarity,
        sharedFields,
        sharedFamilies
    };
}

/**
 * Builds a relation model for a field by scoring observed notes that share similar structure.
 * @param {string} fieldName
 * @param {object} [nodeFields]
 * @param {object} [noteContext]
 * @param {Map<string,object>} [fieldsCache]
 * @param {object} [options]
 * @returns {{ family: string|null, field: string, variants: string[], preferredTargets: string[], targetScores: Map<string,number>, supportingNotes: number, sourceRoles: string[], sourceTypes: string[], sharedFields: string[], summary: string, reasonText: string, insertText: string }}
 */
function buildFieldFamilyRelationModel(fieldName, nodeFields = {}, noteContext = {}, fieldsCache = new Map(), options = {}) {
    const normalizedField = String(fieldName || '').trim().toLowerCase();
    const currentRoleResult = getFieldRoleResult(noteContext, normalizedField);
    const requestedFamily = detectFieldFamily(fieldName, currentRoleResult?.semanticRole || null);
    const observedIndex = options.observedIndex || buildObservedNoteIndex(fieldsCache, options);
    const targetScores = new Map();
    const variantScores = new Map();
    const sharedFieldScores = new Map();
    const sourceRoles = new Set();
    const sourceTypes = new Set();
    let supportingNotes = 0;

    for (const observed of observedIndex.notes) {
        const observedType = String(observed?.type || '').trim().toLowerCase();
        const fields = observed?.fields || {};
        const observedContext = observed.noteContext;
        const similarityInfo = scoreObservedSimilarity(nodeFields, noteContext, fields, observedType, observedContext, {
            nodeType: options.nodeType
        });
        const similarity = similarityInfo.similarity;
        if (!similarity) continue;

        for (const [rawFieldName] of observed.fieldEntries) {
            const normalizedObservedField = String(rawFieldName || '').trim().toLowerCase();
            const targets = (observed.relationIdsByField.get(normalizedObservedField) || [])
                .filter((target) => fieldsCache.has(target) || !fieldsCache.size);
            if (!targets.length) continue;

            const observedRoleResult = getFieldRoleResult(observedContext, normalizedObservedField);
            const observedFamily = detectFieldFamily(rawFieldName, observedRoleResult?.semanticRole || null);
            const sameField = normalizedObservedField === normalizedField;
            const sameFamily = requestedFamily && observedFamily === requestedFamily;
            if (!sameField && !sameFamily) continue;

            let weight = similarity;
            if (sameField) weight += 120;
            else if (sameFamily) weight += 80;
            if (observedRoleResult?.relational) weight += 40;
            if (weight <= 0) continue;

            supportingNotes++;
            variantScores.set(normalizedObservedField, (variantScores.get(normalizedObservedField) || 0) + weight);
            for (const field of similarityInfo.sharedFields.slice(0, 4)) {
                sharedFieldScores.set(field, (sharedFieldScores.get(field) || 0) + weight);
            }
            if (observedContext.noteRole?.roleLabel) sourceRoles.add(observedContext.noteRole.roleLabel);
            if (observedType) sourceTypes.add(observedType);
            for (const targetId of targets) {
                targetScores.set(targetId, (targetScores.get(targetId) || 0) + weight);
            }
        }
    }

    const preferredTargets = [...targetScores.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([targetId]) => targetId)
        .slice(0, options.limit || 8);
    const variants = [...variantScores.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name]) => name);
    const sharedFields = [...sharedFieldScores.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name]) => name)
        .slice(0, 3);
    const field = variants[0] || normalizedField;
    const targetLead = preferredTargets.slice(0, 2);
    const roleLead = sourceRoles.size
        ? `${naturalList([...sourceRoles].slice(0, 2))} notes`
        : sourceTypes.size
            ? `${naturalList([...sourceTypes].slice(0, 2))} notes`
            : 'notes like this';
    const contextLead = sharedFields.length
        ? `${roleLead} usually keep ${field} near ${sharedFields.join(' and ')}`
        : `${roleLead} usually keep ${field}`;

    return {
        family: requestedFamily,
        field,
        variants,
        preferredTargets,
        targetScores,
        supportingNotes,
        sourceRoles: [...sourceRoles],
        sourceTypes: [...sourceTypes],
        sharedFields,
        summary: targetLead.length
            ? `${contextLead}, usually pointing to ${targetLead.join(' and ')}`
            : contextLead,
        reasonText: supportingNotes
            ? `${roleLead} already teach this ${requestedFamily || 'relation'} pattern`
            : '',
        insertText: targetLead.length
            ? `${field}: [[${targetLead[0]}]]\n`
            : `${field}: [[\n`
    };
}

module.exports = {
    buildFieldFamilyRelationModel,
    buildSchemaAdaptiveGaps,
    buildRecommendedBundles
};
