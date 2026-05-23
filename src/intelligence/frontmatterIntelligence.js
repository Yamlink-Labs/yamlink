'use strict';

const {
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS
} = require('./fieldRolesCore');
const {
    buildObservedFields,
    buildObservedNoteIndex,
    buildNoteContext,
    buildAdaptiveFieldPatterns,
    buildBridgePaths
} = require('./suggestionCore');
const {
    SEMANTIC_FIELD_FAMILIES,
    summarizePattern,
    pickConnectionField,
    detectFieldFamily
} = require('./frontmatterFieldFamilies');
const {
    buildFieldFamilyRelationModel,
    buildSchemaAdaptiveGaps,
    buildRecommendedBundles
} = require('./frontmatterRelationLearning');
const {
    buildLikelyContexts,
    buildContextBundles,
    buildContextThreadViews,
    buildLikelyCompanions,
    buildSurroundingSetups,
    buildAffinityConnections,
    buildRelationViewHints
} = require('./frontmatterContextSuggestions');
const {
    extractBodyMentionedIds,
    buildBodyMentionHints
} = require('./frontmatterBodyHints');

function buildFrontmatterOpportunityModel(nodeFields, options = {}) {
    const fieldsCache = options.fieldsCache || new Map();
    const observedFields = options.observedFields || buildObservedFields(fieldsCache);
    const observedIndex = options.observedIndex || buildObservedNoteIndex(fieldsCache, {
        ...options,
        observedFields
    });
    const nodeType = String(options.nodeType || nodeFields?.type || '').trim().toLowerCase();
    const noteContext = options.noteContext || buildNoteContext(nodeFields || {}, nodeType, {
        observedFields,
        getSchemaForType: options.getSchemaForType,
        dateParser: options.dateParser,
        statusLikeValues: options.statusLikeValues || DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: options.semanticRolePriors || DEFAULT_SEMANTIC_ROLE_PRIORS
    });
    const currentMentionedIds = options.currentMentionedIds
        || [...extractBodyMentionedIds(options.content || '').keys()];
    const mentionedIdSet = new Set(
        currentMentionedIds
            .map((id) => String(id || '').trim().toLowerCase())
            .filter(Boolean)
    );

    const patterns = buildAdaptiveFieldPatterns(nodeFields || {}, noteContext, fieldsCache, {
        nodeType,
        observedFields,
        observedIndex,
        currentTags: Array.from(noteContext?.currentTags || []),
        currentMentionedIds,
        getSchemaForType: options.getSchemaForType,
        dateParser: options.dateParser,
        statusLikeValues: options.statusLikeValues || DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: options.semanticRolePriors || DEFAULT_SEMANTIC_ROLE_PRIORS
    });

    const likelyFields = patterns
        .slice(0, options.limit || 4)
        .map((pattern, index) => {
            const sampleTargets = Array.from(pattern.sampleTargets || []);
            const bodySupportedTargets = sampleTargets.filter((target) =>
                mentionedIdSet.has(String(target || '').trim().toLowerCase())
            );
            const bodySupportCount = bodySupportedTargets.length;
            const bodyBoost = bodySupportCount > 0 ? (120 + (bodySupportCount * 30)) : 0;
            const summary = summarizePattern(pattern);
            return {
                key: pattern.field,
                field: pattern.field,
                score: Math.max(0, Math.round((pattern.score || 0) + 220 - (index * 18) + bodyBoost)),
                count: pattern.count || 0,
                relational: Boolean(pattern.relational),
                semanticRole: pattern.semanticRole || null,
                sharedFields: Array.from(pattern.sharedFields || []),
                sourceRoles: Array.from(pattern.sourceRoles || []),
                sampleTargets,
                bodySupported: bodySupportCount > 0,
                bodySupportedTargets,
                summary: bodySupportCount > 0
                    ? `${summary}; the body also keeps pointing to ${bodySupportedTargets.join(', ')}`
                    : summary,
                insertText: pattern.relational ? `${pattern.field}: [[\n` : `${pattern.field}: \n`,
                relationInsertText: pattern.relational && sampleTargets.length
                    ? `${pattern.field}: [[${sampleTargets[0]}]]\n`
                    : null
            };
        })
        .sort((a, b) =>
            (Number(b.score || 0) - Number(a.score || 0))
            || (Number(b.bodySupported ? 1 : 0) - Number(a.bodySupported ? 1 : 0))
            || (Number(b.count || 0) - Number(a.count || 0))
            || String(a.field || '').localeCompare(String(b.field || ''))
        );

    const likelyLinks = likelyFields.filter((hint) => hint.relational && hint.sampleTargets.length);
    const connectionField = pickConnectionField(nodeFields);
    const bridgePaths = buildBridgePaths(options.nodeId || '', nodeFields || {}, noteContext, fieldsCache, {
        nodeType,
        observedFields,
        observedIndex,
        getSchemaTargets: options.getSchemaTargets,
        getSchemaForType: options.getSchemaForType
    });
    const likelyConnections = bridgePaths
        .slice(0, options.connectionLimit || 3)
        .map((bridge, index) => ({
            candidateId: bridge.candidateId,
            candidateType: bridge.candidateType,
            field: bridge.field,
            queryField: bridge.field,
            relatedId: bridge.relatedId,
            relatedType: bridge.relatedType,
            origin: bridge.origin,
            score: Math.max(0, 260 - (index * 20)),
            summary: `${bridge.candidateId} seems to belong in the same flow through ${bridge.relatedId}`,
            detail: `${bridge.candidateId} also uses ${bridge.field} with ${bridge.relatedId}`,
            trail: `${options.nodeId || 'this note'} -> ${bridge.relatedId} -> ${bridge.candidateId}`,
            insertField: connectionField,
            insertText: `${connectionField}: [[${bridge.candidateId}]]\n`
        }));
    const affinityConnections = buildAffinityConnections(nodeFields, noteContext, fieldsCache, {
        nodeId: options.nodeId,
        nodeType,
        currentMentionedIds,
        observedFields,
        observedIndex,
        getSchemaForType: options.getSchemaForType,
        dateParser: options.dateParser,
        statusLikeValues: options.statusLikeValues || DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: options.semanticRolePriors || DEFAULT_SEMANTIC_ROLE_PRIORS,
        connectionLimit: options.connectionLimit || 3
    });
    const connectionMap = new Map();
    for (const hint of [...likelyConnections, ...affinityConnections]) {
        if (!connectionMap.has(hint.candidateId)) {
            connectionMap.set(hint.candidateId, hint);
        }
    }
    const setupFields = likelyFields.slice(0, options.setupLimit || 3);
    const setupInsertText = setupFields.map((hint) => hint.insertText).join('');
    const relationSetupFields = likelyLinks.slice(0, options.relationSetupLimit || 2);
    const relationSetupInsertText = relationSetupFields
        .map((hint) => hint.relationInsertText || hint.insertText)
        .join('');
    const likelyGaps = buildSchemaAdaptiveGaps(nodeFields || {}, noteContext, fieldsCache, {
        nodeType,
        observedFields,
        observedIndex,
        getSchemaForType: options.getSchemaForType,
        dateParser: options.dateParser,
        statusLikeValues: options.statusLikeValues || DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: options.semanticRolePriors || DEFAULT_SEMANTIC_ROLE_PRIORS,
        gapLimit: options.gapLimit || 4
    }).map((gap) => {
        const sampleTargets = Array.from(gap.sampleTargets || []);
        const bodySupportedTargets = sampleTargets.filter((target) =>
            mentionedIdSet.has(String(target || '').trim().toLowerCase())
        );
        const bodySupportCount = bodySupportedTargets.length;
        const bodyBoost = bodySupportCount > 0 ? (110 + (bodySupportCount * 25)) : 0;
        return {
            ...gap,
            score: Math.max(0, Math.round((gap.score || 0) + bodyBoost)),
            bodySupported: bodySupportCount > 0,
            bodySupportedTargets,
            summary: bodySupportCount > 0
                ? `${gap.summary}; the body also keeps pointing to ${bodySupportedTargets.join(', ')}`
                : gap.summary,
            missingSummary: bodySupportCount > 0
                ? `${gap.missingSummary}; the body keeps pointing to ${bodySupportedTargets.join(', ')}`
                : gap.missingSummary
        };
    }).sort((a, b) =>
        (Number(b.score || 0) - Number(a.score || 0))
        || (Number(b.bodySupported ? 1 : 0) - Number(a.bodySupported ? 1 : 0))
        || String(a.field || '').localeCompare(String(b.field || ''))
    );
    const recommendedBundle = buildRecommendedBundles(likelyFields, likelyGaps, {
        bundleLimit: options.bundleLimit || 3
    });
    const likelyContexts = buildLikelyContexts(nodeFields || {}, noteContext, fieldsCache, {
        ...options,
        nodeType,
        observedFields,
        observedIndex,
        likelyFields,
        likelyGaps,
        contextLimit: options.contextLimit || 4,
        buildFieldFamilyRelationModel
    });
    const contextBundle = buildContextBundles(likelyContexts, {
        bundleContextLimit: options.bundleContextLimit || 3
    });
    const contextThreadViews = buildContextThreadViews(likelyContexts, {
        getDefaultSortField: options.getDefaultSortField,
        threadViewLimit: options.threadViewLimit || 3
    });
    const likelyCompanions = buildLikelyCompanions(nodeFields || {}, likelyContexts, fieldsCache, {
        nodeId: options.nodeId,
        observedIndex,
        companionLimit: options.companionLimit || 3
    });
    const surroundingSetups = buildSurroundingSetups(nodeFields || {}, likelyContexts, fieldsCache, {
        nodeId: options.nodeId,
        observedFields,
        observedIndex,
        getSchemaForType: options.getSchemaForType,
        getDefaultSortField: options.getDefaultSortField,
        dateParser: options.dateParser,
        statusLikeValues: options.statusLikeValues || DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: options.semanticRolePriors || DEFAULT_SEMANTIC_ROLE_PRIORS,
        surroundingLimit: options.surroundingLimit || 3,
        surroundingSetupLimit: options.surroundingSetupLimit || 2
    });

    const mergedConnections = [...connectionMap.values()].slice(0, options.connectionLimit || 3);
    const relationViews = buildRelationViewHints(mergedConnections, {
        getDefaultSortField: options.getDefaultSortField
    });
    const bodyMentionHints = buildBodyMentionHints(options.content || '', nodeFields || {}, fieldsCache, {
        threshold: options.bodyMentionThreshold || 2
    }).slice(0, options.bodyMentionLimit || 3);

    return {
        nodeType,
        observedFields,
        noteContext,
        patterns,
        likelyFields,
        likelyLinks,
        likelyGaps,
        likelyContexts,
        contextBundle,
        contextThreadViews,
        likelyCompanions,
        surroundingSetups,
        likelyConnections: mergedConnections,
        relationViews,
        bodyMentionHints,
        setupFields,
        setupInsertText,
        relationSetupFields,
        relationSetupInsertText,
        recommendedBundle
    };
}

function buildFrontmatterGuidanceSummary(model = {}) {
    const nextField = Array.isArray(model.likelyFields) ? model.likelyFields[0] : null;
    const missingPiece = Array.isArray(model.likelyGaps) ? model.likelyGaps[0] : null;
    const nextContext = Array.isArray(model.likelyContexts) ? model.likelyContexts[0] : null;
    const nextConnection = Array.isArray(model.likelyConnections) ? model.likelyConnections[0] : null;
    const nearbyCompanion = Array.isArray(model.likelyCompanions) ? model.likelyCompanions[0] : null;
    const threadView = Array.isArray(model.contextThreadViews) ? model.contextThreadViews[0] : null;
    const surroundingSetup = Array.isArray(model.surroundingSetups) ? model.surroundingSetups[0] : null;
    const bodyMention = Array.isArray(model.bodyMentionHints) ? model.bodyMentionHints[0] : null;
    const recommendedBundle = model.recommendedBundle && Array.isArray(model.recommendedBundle.fields) && model.recommendedBundle.fields.length
        ? model.recommendedBundle
        : null;
    const contextBundle = model.contextBundle && model.contextBundle.summary
        ? model.contextBundle
        : null;

    const summary = {
        nextField,
        missingPiece,
        nextContext,
        nextConnection,
        nearbyCompanion,
        threadView,
        surroundingSetup,
        bodyMention,
        recommendedBundle,
        contextBundle,
        headline: '',
        bestNextStep: null,
        why: '',
        workflowSummary: '',
        setupSummary: '',
        bodyEvidence: '',
        starterActions: []
    };

    if (nextContext) {
        summary.headline = `${nextContext.field} usually points to ${nextContext.targetId} here`;
        summary.bestNextStep = {
            label: `${nextContext.field} -> ${nextContext.targetId}`,
            detail: nextContext.summary,
            insertText: nextContext.insertText,
            kind: 'context'
        };
        summary.why = nextContext.summary;
        summary.starterActions.push(summary.bestNextStep);
    } else if (missingPiece) {
        summary.headline = missingPiece.missingSummary;
        summary.bestNextStep = {
            label: `add ${missingPiece.field}`,
            detail: missingPiece.summary,
            insertText: missingPiece.relationInsertText || missingPiece.insertText,
            kind: 'missing-piece'
        };
        summary.why = missingPiece.summary;
        summary.starterActions.push(summary.bestNextStep);
    } else if (nextField) {
        summary.headline = nextField.summary;
        summary.bestNextStep = {
            label: `add ${nextField.field}`,
            detail: nextField.summary,
            insertText: nextField.relationInsertText || nextField.insertText,
            kind: 'field'
        };
        summary.why = nextField.summary;
        summary.starterActions.push(summary.bestNextStep);
    } else if (bodyMention) {
        summary.headline = `${bodyMention.id} keeps showing up in the body`;
        summary.bestNextStep = {
            label: `link ${bodyMention.id}`,
            detail: `${bodyMention.id} appears ${bodyMention.count} times in the body without a matching frontmatter link`,
            insertText: bodyMention.insertText,
            kind: 'body-mention'
        };
        summary.why = summary.bestNextStep.detail;
        summary.starterActions.push(summary.bestNextStep);
    }

    if (recommendedBundle) {
        const bundleAction = {
            label: `add ${recommendedBundle.fields.map((hint) => hint.field).join(', ')}`,
            detail: `similar notes often include ${recommendedBundle.fields.map((hint) => hint.field).join(', ')}`,
            insertText: recommendedBundle.insertText,
            kind: 'bundle'
        };
        summary.starterActions.push(bundleAction);
        summary.setupSummary = bundleAction.detail;
    } else if (contextBundle) {
        summary.setupSummary = contextBundle.summary;
    }

    if (!summary.setupSummary && surroundingSetup) {
        summary.setupSummary = surroundingSetup.summary;
    }

    if (!summary.workflowSummary && contextBundle) {
        summary.workflowSummary = contextBundle.summary;
    }
    if (!summary.workflowSummary && threadView) {
        summary.workflowSummary = threadView.summary;
    }
    if (!summary.workflowSummary && nearbyCompanion) {
        summary.workflowSummary = nearbyCompanion.summary;
    }
    if (bodyMention) {
        const bodyHints = (model.bodyMentionHints || []).slice(0, 2);
        summary.bodyEvidence = bodyHints.length === 1
            ? `the body already points at ${bodyHints[0].id}`
            : `the body already points at ${bodyHints.map((hint) => hint.id).join(' and ')}`;
    }

    if (nextConnection) {
        summary.starterActions.push({
            label: `link ${nextConnection.candidateId}`,
            detail: nextConnection.summary,
            insertText: nextConnection.insertText,
            kind: 'connection'
        });
    }

    return summary;
}

function summarizeGuidanceExplanation(summary = {}) {
    if (!summary || typeof summary !== 'object') return '';
    if (summary.why) return String(summary.why).trim();
    if (summary.workflowSummary) return String(summary.workflowSummary).trim();
    if (summary.setupSummary) return String(summary.setupSummary).trim();
    if (summary.nextConnection?.summary) return String(summary.nextConnection.summary).trim();
    if (summary.nextContext?.summary) return String(summary.nextContext.summary).trim();
    if (summary.nextField?.summary) return String(summary.nextField.summary).trim();
    if (summary.missingPiece?.summary) return String(summary.missingPiece.summary).trim();
    return '';
}

module.exports = {
    SEMANTIC_FIELD_FAMILIES,
    detectFieldFamily,
    buildFieldFamilyRelationModel,
    buildFrontmatterOpportunityModel,
    buildFrontmatterGuidanceSummary,
    summarizeGuidanceExplanation,
    extractBodyMentionedIds,
    buildBodyMentionHints
};
