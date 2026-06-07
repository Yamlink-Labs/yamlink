// src/engine/suggestions.js
//
// Shared source of truth for Yamlink query suggestions.
//
// Suggestion intelligence now draws from multiple signals:
//   - repeated incoming backlink patterns
//   - schema-aware relation views
//   - mixed-type relation patterns on the same field
//
// The goal is not to be "clever" in isolation. The goal is to make
// structured vaults feel understood across CRM, writing, research,
// and engineering use cases without forcing one rigid field model.

const { getBacklinks } = require('../core/graph');
const { getFieldsCache } = require('../core/indexService');
const { getSchema, getSchemaTargets } = require('../registries/schemaRegistry');
const {
    extractRelationIds,
    groupStructuredBacklinks,
    buildSchemaRelationGroups,
    buildObservedRelationGroups,
    buildSharedRelationContexts,
} = require('../intelligence/suggestionCore');
const { scoreToConfidence } = require('../intelligence/confidence');
const { getCachedContext } = require('../intelligence/activationCache');
const {
    buildActivationContext,
    getDefaultSortFieldForType
} = require('./suggestionsContext');
const { explainSuggestionState } = require('./suggestionsExplain');

const QUERY_SUGGESTION_THRESHOLD = 2;

/**
 * @typedef {{
 *   kind: string,
 *   nodeId: string,
 *   field: string,
 *   sourceType: string,
 *   count: number,
 *   score: number,
 *   title: string,
 *   description: string,
 *   queryText: string,
 *   inserted?: boolean,
 *   confidence?: number
 * }} Suggestion
 */

/** @param {string} text @returns {string} */
function flattenQuery(text) {
    return String(text || '')
        .replace(/[ \t]*\r?\n[ \t]*/g, ' ')
        .replace(/  +/g, ' ')
        .trim();
}

/**
 * @param {string} text @param {string} sourceType @param {string} field @param {string} nodeId
 * @returns {boolean}
 */
function queryAlreadyExists(text, sourceType, field, nodeId) {
    const flat = flattenQuery(text);
    if (flat.includes(`!view incoming ${sourceType} via ${field}`)) return true;
    if (flat.includes(`!view ${sourceType} via ${field}`)) return true;
    if (nodeId && flat.includes(`!view ${sourceType} where ${field} = [[${nodeId}]]`)) return true;
    return false;
}

function queryTextAlreadyExists(text, queryText, sourceType, field, nodeId) {
    if (!text) return false;
    if (queryText && flattenQuery(text).includes(flattenQuery(queryText))) return true;
    if (sourceType && field) return queryAlreadyExists(text, sourceType, field, nodeId);
    return false;
}

function pluralize(type, count) {
    if (!type) return count === 1 ? 'note' : 'notes';
    if (type === '*') return count === 1 ? 'note' : 'notes';
    return count === 1 ? type : `${type}s`;
}

/**
 * @param {string} sourceType @param {string} field @param {string} nodeId @param {Function} [getDefaultSortField]
 * @returns {string}
 */
function buildForwardRelationQuery(sourceType, field, nodeId, getDefaultSortField = getDefaultSortFieldForType) {
    let query = `!view ${sourceType}\nwhere ${field} = [[${nodeId}]]`;
    const sortField = getDefaultSortField(sourceType);
    if (sortField) query += `\nsort ${sortField} desc`;
    return query;
}

/**
 * @param {string} nodeType @param {string} field @param {string} relatedId @param {Function} [getDefaultSortField]
 * @returns {string}
 */
function buildPeerRelationQuery(nodeType, field, relatedId, getDefaultSortField = getDefaultSortFieldForType) {
    let query = `!view ${nodeType}\nwhere ${field} = [[${relatedId}]]`;
    const sortField = getDefaultSortField(nodeType);
    if (sortField) query += `\nsort ${sortField} desc`;
    return query;
}

function addSuggestion(results, seen, suggestion, docText, keepExisting) {
    const queryKey = flattenQuery(suggestion.queryText);
    if (!queryKey || seen.has(queryKey)) return;

    const inserted = queryTextAlreadyExists(
        docText,
        suggestion.queryText,
        suggestion.sourceType,
        suggestion.field,
        suggestion.nodeId
    );

    if (inserted && !keepExisting) return;
    seen.add(queryKey);
    results.push({
        inserted,
        confidence: suggestion.confidence ?? scoreToConfidence(suggestion.score, 130),
        ...suggestion
    });
}

/**
 * @param {string} nodeId
 * @param {string|null} [docText]
 * @param {{ keepExisting?: boolean }} [options]
 * @returns {Suggestion[]}
 */
function computeSuggestionsForNode(nodeId, docText = null, options = {}) {
    const backlinks = getBacklinks(nodeId);
    const fieldsCache = getFieldsCache();
    const nodeFields = fieldsCache.get(nodeId) || {};
    const nodeType = String(nodeFields.type || '').trim().toLowerCase();

    const { observedFields, observedIndex, noteContext, frontmatterOpportunities, getDefaultSortField } = fieldsCache.has(nodeId)
        ? getCachedContext(nodeId, () => buildActivationContext(nodeId, nodeFields, nodeType, fieldsCache))
        : buildActivationContext(nodeId, nodeFields, nodeType, fieldsCache);

    const keepExisting = options.keepExisting === true;

    const { typedGroups, fieldGroups } = groupStructuredBacklinks(backlinks, fieldsCache);
    const { schemaRelationKeys } = buildSchemaRelationGroups(nodeType, typedGroups, {
        getSchemaTargets,
        getSchemaForType: getSchema
    });
    const observedRelationGroups = buildObservedRelationGroups(nodeType, fieldsCache);

    const results = [];
    const seen = new Set();

    for (const typedKey of schemaRelationKeys) {
        const group = typedGroups.get(typedKey);
        const queryText = buildForwardRelationQuery(group.sourceType, group.field, nodeId);
        addSuggestion(results, seen, {
            kind: 'schema-relation',
            nodeId,
            field: group.field,
            sourceType: group.sourceType,
            count: group.count,
            score: 100 + group.count,
            title: `${capitalize(pluralize(group.sourceType, group.count))} for this ${nodeType || 'note'}`,
            description: group.count > 0
                ? `${group.count} ${pluralize(group.sourceType, group.count)} linked here through the schema field "${group.field}"`
                : `Schema says ${pluralize(group.sourceType, 2)} can link here through "${group.field}"`,
            queryText
        }, docText, keepExisting);
    }

    for (const group of observedRelationGroups.values()) {
        const typedKey = `${group.field}\x00${group.sourceType}`;
        if (schemaRelationKeys.has(typedKey)) continue;
        if (group.count < 1) continue;
        if (group.sourceType === 'note' && group.count < QUERY_SUGGESTION_THRESHOLD) continue;

        addSuggestion(results, seen, {
            kind: 'observed-relation',
            nodeId,
            field: group.field,
            sourceType: group.sourceType,
            count: group.count,
            score: 85 + group.count,
            title: `${capitalize(pluralize(group.sourceType, 2))} for this ${nodeType || 'note'}`,
            description: `Other ${pluralize(nodeType || 'note', 2)} are often linked from ${pluralize(group.sourceType, 2)} through "${group.field}"`,
            queryText: buildForwardRelationQuery(group.sourceType, group.field, nodeId, getDefaultSortField)
        }, docText, keepExisting);
    }

    for (const group of typedGroups.values()) {
        const typedKey = `${group.field}\x00${group.sourceType}`;
        if (schemaRelationKeys.has(typedKey)) continue;
        if (observedRelationGroups.has(typedKey)) continue;
        if (group.count < QUERY_SUGGESTION_THRESHOLD) continue;

        addSuggestion(results, seen, {
            kind: 'incoming-pattern',
            nodeId,
            field: group.field,
            sourceType: group.sourceType,
            count: group.count,
            score: 70 + group.count,
            title: `${capitalize(group.sourceType)} backlinks via ${group.field}`,
            description: `${group.count} ${pluralize(group.sourceType, group.count)} already link here through "${group.field}"`,
            queryText: `!view incoming ${group.sourceType}\nvia ${group.field}`
        }, docText, keepExisting);
    }

    for (const fieldGroup of fieldGroups.values()) {
        if (fieldGroup.total < QUERY_SUGGESTION_THRESHOLD) continue;
        if (fieldGroup.types.size < 2) continue;

        addSuggestion(results, seen, {
            kind: 'mixed-incoming',
            nodeId,
            field: fieldGroup.field,
            sourceType: '*',
            count: fieldGroup.total,
            score: 50 + fieldGroup.total,
            title: `Backlinks via ${fieldGroup.field}`,
            description: `${fieldGroup.total} linked notes across ${fieldGroup.types.size} types use "${fieldGroup.field}"`,
            queryText: `!view incoming *\nvia ${fieldGroup.field}`
        }, docText, keepExisting);
    }

    const currentSchema = nodeType ? getSchema(nodeType) : null;
    if (currentSchema && currentSchema.fields) {
        for (const [fieldName, fieldDef] of Object.entries(currentSchema.fields)) {
            if (fieldDef.type !== 'relation') continue;
            const relatedIds = extractRelationIds(nodeFields[fieldName]);
            if (relatedIds.length === 0) continue;

            for (const relatedId of relatedIds.slice(0, 2)) {
                addSuggestion(results, seen, {
                    kind: 'peer-relation',
                    nodeId,
                    field: fieldName,
                    sourceType: nodeType,
                    count: 1,
                    score: 40,
                    title: `${capitalize(pluralize(nodeType, 2))} for this ${fieldName}`,
                    description: `Find other ${pluralize(nodeType, 2)} sharing ${fieldName} → ${relatedId}`,
                    queryText: buildPeerRelationQuery(nodeType, fieldName, relatedId, getDefaultSortField)
                }, docText, keepExisting);
            }
        }
    }

    for (const context of buildSharedRelationContexts(nodeFields, noteContext, fieldsCache, {
        nodeType,
        observedFields,
        observedIndex,
        getSchemaTargets,
        getSchemaForType: getSchema
    })) {
        const descriptionLead = noteContext.noteRole?.noteRole && noteContext.noteRole.noteRole !== 'record'
            ? `${capitalize(context.sourceType)}s related to this ${noteContext.noteRole.roleLabel || noteContext.noteRole.noteRole}`
            : `${capitalize(context.sourceType)}s related to this note`;
        addSuggestion(results, seen, {
            kind: 'shared-relation-context',
            nodeId,
            field: context.field,
            sourceType: context.sourceType,
            count: 1,
            score: context.sourceType === nodeType ? 42 : 48,
            title: `${capitalize(pluralize(context.sourceType, 2))} for this ${context.field}`,
            description: `${descriptionLead} through ${context.field} → ${context.relatedId}`,
            queryText: buildForwardRelationQuery(context.sourceType, context.field, context.relatedId, getDefaultSortField)
        }, docText, keepExisting);
    }

    for (const relationView of frontmatterOpportunities.relationViews || []) {
        addSuggestion(results, seen, {
            kind: 'relation-cluster',
            nodeId,
            field: relationView.field,
            sourceType: relationView.sourceType,
            count: 1,
            score: 58 + Math.min(24, Math.round((relationView.score || 0) / 20)),
            title: capitalize(relationView.title),
            description: relationView.description,
            queryText: relationView.queryText
        }, docText, keepExisting);
    }
    for (const contextView of frontmatterOpportunities.contextThreadViews || []) {
        addSuggestion(results, seen, {
            kind: 'context-thread',
            nodeId,
            field: contextView.field,
            sourceType: contextView.sourceType,
            count: 1,
            score: 62 + Math.min(28, Math.round((contextView.score || 0) / 20)),
            title: `Usual thread: ${capitalize(contextView.summary)}`,
            description: contextView.description,
            queryText: contextView.queryText
        }, docText, keepExisting);
    }
    for (const setup of frontmatterOpportunities.surroundingSetups || []) {
        addSuggestion(results, seen, {
            kind: 'surrounding-setup',
            nodeId,
            field: setup.field,
            sourceType: setup.companionKinds?.[0]?.type || '*',
            count: setup.companionKinds?.reduce((sum, hint) => sum + Number(hint.count || 0), 0) || 1,
            score: 64 + Math.min(32, Math.round((setup.score || 0) / 30)),
            title: `Usual setup: ${capitalize(setup.targetId)}`,
            description: setup.description,
            queryText: setup.queryText
        }, docText, keepExisting);
    }

    return results.sort((a, b) =>
        (b.score - a.score) ||
        (b.count - a.count) ||
        a.title.localeCompare(b.title)
    );
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = {
    computeSuggestionsForNode,
    explainSuggestionState,
    queryAlreadyExists,
    buildActivationContext,
    getDefaultSortFieldForType,
    QUERY_SUGGESTION_THRESHOLD
};
