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
const { getFieldsCache } = require('../core/index');
const { normaliseDateInput } = require('../core/date');
const { getSchema, getSchemaTargets } = require('../registries/schemaRegistry');
const {
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS
} = require('../intelligence/fieldRolesCore');
const {
    buildObservedFields,
    buildNoteContext,
    extractRelationIds,
    groupStructuredBacklinks,
    buildSchemaRelationGroups,
    buildSharedRelationContexts
} = require('../intelligence/suggestionCore');

const QUERY_SUGGESTION_THRESHOLD = 2;

function flattenQuery(text) {
    return String(text || '')
        .replace(/[ \t]*\r?\n[ \t]*/g, ' ')
        .replace(/  +/g, ' ')
        .trim();
}

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

function getDefaultSortFieldForType(type) {
    const schema = type ? getSchema(type) : null;
    if (!schema || !schema.fields) return '';
    if (schema.fields.created) return 'created';
    if (schema.fields.date) return 'date';
    if (schema.fields.name) return 'name';
    return '';
}

function buildForwardRelationQuery(sourceType, field, nodeId) {
    let query = `!view ${sourceType}\nwhere ${field} = [[${nodeId}]]`;
    const sortField = getDefaultSortFieldForType(sourceType);
    if (sortField) query += `\nsort ${sortField} desc`;
    return query;
}

function buildPeerRelationQuery(nodeType, field, relatedId) {
    let query = `!view ${nodeType}\nwhere ${field} = [[${relatedId}]]`;
    const sortField = getDefaultSortFieldForType(nodeType);
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
        ...suggestion
    });
}

function computeSuggestionsForNode(nodeId, docText = null, options = {}) {
    const backlinks = getBacklinks(nodeId);
    const fieldsCache = getFieldsCache();
    const nodeFields = fieldsCache.get(nodeId) || {};
    const nodeType = String(nodeFields.type || '').trim().toLowerCase();
    const observedFields = buildObservedFields(fieldsCache);
    const noteContext = buildNoteContext(nodeFields, nodeType, {
        observedFields,
        getSchemaForType: getSchema,
        dateParser: normaliseDateInput,
        statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS
    });
    const keepExisting = options.keepExisting === true;

    const { typedGroups, fieldGroups } = groupStructuredBacklinks(backlinks, fieldsCache);
    const { schemaRelationKeys } = buildSchemaRelationGroups(nodeType, typedGroups, {
        getSchemaTargets,
        getSchemaForType: getSchema
    });

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

    for (const group of typedGroups.values()) {
        const typedKey = `${group.field}\x00${group.sourceType}`;
        if (schemaRelationKeys.has(typedKey)) continue;
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
                    queryText: buildPeerRelationQuery(nodeType, fieldName, relatedId)
                }, docText, keepExisting);
            }
        }
    }

    for (const context of buildSharedRelationContexts(nodeFields, noteContext, fieldsCache, {
        getSchemaTargets,
        getSchemaForType: getSchema
    })) {
        const descriptionLead = noteContext.noteRole?.noteRole && noteContext.noteRole.noteRole !== 'record'
            ? `${capitalize(context.sourceType)}s related to this ${noteContext.noteRole.noteRole}`
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
            queryText: buildForwardRelationQuery(context.sourceType, context.field, context.relatedId)
        }, docText, keepExisting);
    }

    return results.sort((a, b) =>
        (b.score - a.score) ||
        (b.count - a.count) ||
        a.title.localeCompare(b.title)
    );
}

function explainSuggestionState(nodeId) {
    const backlinks = getBacklinks(nodeId);
    const fieldsCache = getFieldsCache();
    const nodeFields = fieldsCache.get(nodeId) || {};
    const nodeType = String(nodeFields.type || '').trim().toLowerCase();
    const observedFields = buildObservedFields(fieldsCache);
    const noteContext = buildNoteContext(nodeFields, nodeType, {
        observedFields,
        getSchemaForType: getSchema,
        dateParser: normaliseDateInput,
        statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS
    });
    const structuredBacklinks = backlinks.filter(edge => edge.field !== 'body');
    const bodyMentions = backlinks.filter(edge => edge.field === 'body').length;

    const typedGroups = new Map();
    for (const { field, sourceId } of structuredBacklinks) {
        const sourceFields = fieldsCache.get(sourceId);
        if (!sourceFields) continue;
        const sourceType = String(sourceFields.type || '').trim().toLowerCase();
        if (!sourceType) continue;
        const key = `${field}\x00${sourceType}`;
        typedGroups.set(key, {
            field,
            sourceType,
            count: (typedGroups.get(key)?.count || 0) + 1
        });
    }

    const strongest = [...typedGroups.values()].sort((a, b) =>
        b.count - a.count || a.field.localeCompare(b.field) || a.sourceType.localeCompare(b.sourceType)
    )[0] || null;

    const schemaHints = [];
    if (nodeType) {
        for (const sourceType of getSchemaTargets()) {
            const schema = getSchema(sourceType);
            if (!schema || !schema.fields) continue;
            for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
                if (fieldDef.type !== 'relation') continue;
                if (String(fieldDef.target || '').trim().toLowerCase() !== nodeType) continue;
                schemaHints.push(`${sourceType} → ${fieldName}`);
            }
        }
    }

    const ownRelationFields = [];
    if (noteContext.fieldRoleResults.length) {
        for (const result of noteContext.fieldRoleResults) {
            if (!result.relational) continue;
            if (extractRelationIds(nodeFields[result.fieldName]).length > 0) ownRelationFields.push(result.fieldName);
        }
    }

    const reasons = [];
    if (noteContext.noteRole?.noteRole) {
        reasons.push(`Current note reads most like a ${noteContext.noteRole.noteRole}-style note`);
    }
    if (schemaHints.length) {
        reasons.push(`Schemas already say this ${nodeType} can connect through: ${schemaHints.join(', ')}`);
    }
    if (strongest && strongest.count < QUERY_SUGGESTION_THRESHOLD) {
        reasons.push(`Strongest observed pattern so far is ${strongest.count} ${pluralize(strongest.sourceType, strongest.count)} via "${strongest.field}"`);
    } else if (!structuredBacklinks.length) {
        reasons.push('No structured backlinks point here yet');
    }
    if (bodyMentions > 0) {
        reasons.push(`There ${bodyMentions === 1 ? 'is' : 'are'} ${bodyMentions} body mention${bodyMentions === 1 ? '' : 's'}, but prose mentions are still lower-confidence than structured relations`);
    }
    if (ownRelationFields.length) {
        reasons.push(`This note already has relation fields that can drive peer suggestions: ${ownRelationFields.join(', ')}`);
    }

    if (!reasons.length) {
        reasons.push('Yamlink needs either clearer structured relations or stronger repeated patterns before it can propose a view confidently');
    }

    return {
        title: 'No suggested views yet',
        description: 'Yamlink is looking for schema-backed relations, repeated backlink patterns, and shared structured fields.',
        reasons
    };
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = {
    computeSuggestionsForNode,
    explainSuggestionState,
    queryAlreadyExists,
    QUERY_SUGGESTION_THRESHOLD
};
