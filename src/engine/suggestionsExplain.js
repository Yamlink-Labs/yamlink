const { getBacklinks } = require('../core/graph');
const { getFieldsCache } = require('../core/indexService');
const { getSchema, getSchemaTargets } = require('../registries/schemaRegistry');
const { filterItemsForSurface } = require('../intelligence/confidence');
const {
    extractRelationIds,
    groupStructuredBacklinks,
    buildBridgePaths,
    buildSharedContextTraces,
    summarizeBridgeHints,
    summarizeTraceHints,
    summarizeAdaptiveFieldHints
} = require('../intelligence/suggestionCore');
const { summarizeNoteRole } = require('../intelligence/noteRolesCore');
const { getCachedContext } = require('../intelligence/activationCache');
const { buildActivationContext } = require('./suggestionsContext');

const QUERY_SUGGESTION_THRESHOLD = 2;

function naturalList(items = []) {
    const list = items.filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

function explainSuggestionState(nodeId) {
    const backlinks = getBacklinks(nodeId);
    const fieldsCache = getFieldsCache();
    const nodeFields = fieldsCache.get(nodeId) || {};
    const nodeType = String(nodeFields.type || '').trim().toLowerCase();

    const { observedFields, observedIndex, noteContext, frontmatterOpportunities } = fieldsCache.has(nodeId)
        ? getCachedContext(nodeId, () => buildActivationContext(nodeId, nodeFields, nodeType, fieldsCache))
        : buildActivationContext(nodeId, nodeFields, nodeType, fieldsCache);

    const bodyMentions = backlinks.filter(edge => edge.field === 'body').length;

    const { typedGroups } = groupStructuredBacklinks(backlinks, fieldsCache);

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
        reasons.push(`This looks like a ${summarizeNoteRole(noteContext.noteRole)} note`);
        if (noteContext.noteRole.supportingSignals?.length) {
            reasons.push(`Main signals: ${noteContext.noteRole.supportingSignals.slice(0, 2).join('; ')}`);
        }
        if (noteContext.noteRole.conflictingSignals?.length) {
            reasons.push(`Other signals: ${noteContext.noteRole.conflictingSignals.slice(0, 2).join('; ')}`);
        }
    }
    if (schemaHints.length) {
        reasons.push(`Schema links here through ${naturalList(schemaHints)}`);
    }
    if (strongest && strongest.count < QUERY_SUGGESTION_THRESHOLD) {
        reasons.push(`Strongest pattern so far: ${strongest.count} ${strongest.count === 1 ? strongest.sourceType : `${strongest.sourceType}s`} via "${strongest.field}"`);
    } else if (!typedGroups.size) {
        reasons.push('No structured links here yet');
    }
    if (bodyMentions > 0) {
        reasons.push(`Body mentions: ${bodyMentions}. Structured links matter more.`);
    }
    if (ownRelationFields.length) {
        reasons.push(`This note already links through ${naturalList(ownRelationFields)}`);
    }

    const bridgePaths = buildBridgePaths(nodeId, nodeFields, noteContext, fieldsCache, {
        nodeType,
        observedFields,
        observedIndex,
        getSchemaTargets,
        getSchemaForType: getSchema
    });
    const bridgeHints = summarizeBridgeHints(bridgePaths, 2);
    if (bridgeHints.length) {
        reasons.push(
            `Related notes nearby: ${bridgeHints
                .map((bridge) => bridge.summary)
                .join(', ')}`
        );
    }

    const traces = buildSharedContextTraces(nodeId, nodeFields, noteContext, fieldsCache, {
        nodeType,
        observedFields,
        observedIndex,
        getSchemaTargets,
        getSchemaForType: getSchema
    });
    const traceHints = summarizeTraceHints(traces, 1);
    if (traceHints.length) {
        reasons.push(`Path: ${traceHints[0].path.join(' -> ')}`);
    }

    const visibleFields = filterItemsForSurface(frontmatterOpportunities.likelyFields, 'report-opportunities', { scoreScale: 700 });
    const visibleGaps = filterItemsForSurface(frontmatterOpportunities.likelyGaps, 'report-opportunities', { scoreScale: 700 });
    const visibleContexts = filterItemsForSurface(frontmatterOpportunities.likelyContexts, 'report-opportunities', { scoreScale: 700 });
    const visibleConnections = filterItemsForSurface(frontmatterOpportunities.likelyConnections, 'report-opportunities', { scoreScale: 700 });
    const visibleCompanions = filterItemsForSurface(frontmatterOpportunities.likelyCompanions || [], 'report-opportunities', { scoreScale: 700 });
    const visibleRelationViews = filterItemsForSurface(frontmatterOpportunities.relationViews || [], 'report-opportunities', { scoreScale: 900 });
    const visibleThreadViews = filterItemsForSurface(frontmatterOpportunities.contextThreadViews || [], 'report-opportunities', { scoreScale: 900 });
    const visibleSetups = filterItemsForSurface(frontmatterOpportunities.surroundingSetups || [], 'report-opportunities', { scoreScale: 1100 });

    const adaptiveFieldHints = summarizeAdaptiveFieldHints(
        (visibleFields || []).map((hint) => ({
            field: hint.key || hint.field,
            relational: hint.relational,
            sampleTargets: new Set(hint.sampleTargets || []),
            sharedFields: new Set(),
            sharedRelatedIds: new Set(),
            score: hint.score || 0
        })),
        2
    );
    if (adaptiveFieldHints.length) {
        reasons.push(
            `often add ${adaptiveFieldHints
                .map((hint) => `"${hint.field}"`)
                .join(' and ')}`
        );
        const relationFieldHint = adaptiveFieldHints.find((hint) => hint.relational && hint.sampleTargets.length);
        if (relationFieldHint) {
            reasons.push(
                `Next link: "${relationFieldHint.field}" -> ${naturalList(relationFieldHint.sampleTargets.slice(0, 2))}`
            );
        }
    }
    if (visibleGaps.length) {
        reasons.push(
            `Missing: ${visibleGaps
                .slice(0, 2)
                .map((hint) => `"${hint.field}"`)
                .join(' and ')}`
        );
    }
    if (frontmatterOpportunities.recommendedBundle?.fields?.length) {
        reasons.push(
            `Useful fields: ${frontmatterOpportunities.recommendedBundle.fields
                .slice(0, 3)
                .map((hint) => hint.field)
                .join(', ')}`
        );
    }
    if (visibleContexts.length) {
        const topContext = visibleContexts[0];
        reasons.push(`Context: "${topContext.field}" -> ${topContext.targetId}`);
        if (topContext.variants?.length > 1) {
            reasons.push(`Other notes also use ${topContext.variants.slice(0, 2).join(' and ')}`);
        }
    }
    if (frontmatterOpportunities.contextBundle?.summary) {
        reasons.push(`Common flow: ${frontmatterOpportunities.contextBundle.summary}`);
    }

    if (visibleConnections.length) {
        const topConnection = visibleConnections[0];
        reasons.push(`Related note: ${topConnection.candidateId}`);
        if (topConnection.trail) {
            reasons.push(`Path: ${topConnection.trail}`);
        }
    }
    if (visibleCompanions.length) {
        reasons.push(`Nearby note: ${visibleCompanions[0].candidateId}`);
    }

    if (visibleRelationViews.length) {
        const topView = visibleRelationViews[0];
        reasons.push(`Next view: follow ${topView.field} around ${topView.relatedId}`);
    }
    if (visibleThreadViews.length) {
        const topView = visibleThreadViews[0];
        reasons.push(`Common view: follow ${topView.field} around ${topView.relatedId}`);
    }
    if (visibleSetups.length) {
        const topSetup = visibleSetups[0];
        reasons.push(`Common setup: ${topSetup.summary}`);
        if (topSetup.companionKinds?.length) {
            reasons.push(
                `Often includes ${topSetup.companionKinds
                    .slice(0, 2)
                    .map((hint) => hint.label)
                    .join(' and ')}`
            );
        }
    }

    if (!reasons.length) {
        reasons.push('Add a little more structure here first');
    }

    return {
        title: 'No suggested views yet',
        description: 'Yamlink is looking for repeated patterns, shared context, and structured links before suggesting a view.',
        reasons
    };
}

module.exports = {
    naturalList,
    explainSuggestionState
};
