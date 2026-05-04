'use strict';

const { getFieldsCache } = require('../core/indexService');
const { normaliseDateInput } = require('../core/date');
const {
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS
} = require('../intelligence/fieldRolesCore');
const { inferNoteRole } = require('../intelligence/noteRolesCore');
const { filterItemsForSurface } = require('../intelligence/confidence');
const {
    buildObservedFields
} = require('../intelligence/suggestionCore');
const {
    buildFrontmatterOpportunityModel,
    buildFrontmatterGuidanceSummary
} = require('../intelligence/frontmatterIntelligence');
const {
    FRONTMATTER_ARCHETYPES,
    NOTE_ROLE_FIELD_PRIORS,
    buildDocumentIntelligence,
    extractDocumentArchetype,
    normalizeFrontmatterKey
} = require('./completionContextHelpers');
const { inferFieldRole } = require('../intelligence/fieldRoles');

function buildStarterActionLabel(action) {
    if (action.kind === 'bundle') return 'add smart setup';
    if (action.kind === 'context') return 'add likely context';
    if (action.kind === 'connection') return 'link nearby note';
    return 'add next step';
}

function filterAdaptiveHints(items = [], options = {}) {
    const list = filterItemsForSurface(items, 'report-opportunities', {
        scoreScale: options.scoreScale || 700
    });
    return list
        .sort((a, b) =>
            (Number(b.score || 0) - Number(a.score || 0))
            || (Number(b.count || 0) - Number(a.count || 0))
            || String(a.key || a.field || '').localeCompare(String(b.key || b.field || ''))
        )
        .slice(0, options.limit || 4);
}

function collectAdaptiveFrontmatterStarterSuggestions(document, docType, idIndex, getSchema) {
    const fieldsCache = getFieldsCache();
    const intelligence = buildDocumentIntelligence(document, docType, idIndex);
    const observedFields = buildObservedFields(fieldsCache);
    const opportunities = buildFrontmatterOpportunityModel(intelligence.nodeFields, {
        nodeId: String(intelligence.nodeFields.id || '').trim(),
        nodeType: docType,
        content: document.getText(),
        fieldsCache,
        observedFields,
        noteContext: intelligence,
        getSchemaForType: getSchema,
        dateParser: normaliseDateInput,
        statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS,
        getDefaultSortField: () => '',
        limit: 4
    });
    const guidance = buildFrontmatterGuidanceSummary(opportunities);
    const seen = new Set();
    const raw = (guidance.starterActions || [])
        .filter((action) => {
            const key = `${action.kind}\x00${action.insertText}\x00${action.label}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 4)
        .map((action, index) => ({
        label: `Yamlink: ${buildStarterActionLabel(action)} (${action.label})`,
        insertText: action.insertText,
        detail: action.detail,
        headline: guidance.headline,
        why: guidance.why,
        workflowSummary: guidance.workflowSummary,
        score: 920 - (index * 110)
    }));
    return filterItemsForSurface(raw, 'frontmatter-actions', {
        scoreScale: 1000
    }).slice(0, 3).map((item, index) => ({
        ...item,
        sortScore: 2000 - (index * 20)
    }));
}

function collectObservedFrontmatterFields(docType) {
    const fieldsCache = getFieldsCache();
    const counts = new Map();
    for (const value of fieldsCache.values()) {
        const nodeType = String(value.type || '').trim().toLowerCase();
        if (docType && nodeType !== docType) continue;
        for (const key of Object.keys(value)) {
            const normalized = normalizeFrontmatterKey(key);
            if (!normalized || normalized === 'id' || normalized === 'type') continue;
            counts.set(normalized, (counts.get(normalized) || 0) + 1);
        }
    }
    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([key, count]) => ({ key, count }));
}

function collectRoleAlignedObservedFrontmatterFields(document, docType, idIndex) {
    const intelligence = buildDocumentIntelligence(document, docType, idIndex);
    const noteRole = intelligence.noteRole;
    const observed = collectObservedFrontmatterFields();
    const noteRolePriors = new Set(NOTE_ROLE_FIELD_PRIORS[noteRole.noteRole] || []);
    return observed.map((entry) => ({
        ...entry,
        noteRole,
        roleAligned: noteRolePriors.has(entry.key)
    }));
}

function collectContextualObservedFrontmatterFields(document, docType, idIndex) {
    const fieldsCache = getFieldsCache();
    const intelligence = buildDocumentIntelligence(document, docType, idIndex);
    const currentFields = intelligence.currentFields;
    const currentRole = intelligence.noteRole?.noteRole || 'record';
    const suggestions = new Map();

    for (const value of fieldsCache.values()) {
        const observedType = String(value?.type || '').trim().toLowerCase();
        const observedFields = Object.keys(value || {})
            .map((key) => normalizeFrontmatterKey(key))
            .filter((key) => key && key !== 'id' && key !== 'type');
        if (!observedFields.length) continue;

        const observedRole = inferNoteRole(value, {
            fieldRoleResults: observedFields.map((key) => inferFieldRole(key, { documentType: observedType, idIndex })),
            titleHints: [value.name, value.title].filter(Boolean)
        });

        let similarity = 0;
        const sharedFields = observedFields.filter((key) => currentFields.has(key));
        if (docType && observedType === docType) similarity += 220;
        if (observedRole.noteRole === currentRole) similarity += 160;
        similarity += sharedFields.length * 45;
        const hasStrongMatch =
            (docType && observedType === docType) ||
            observedRole.noteRole === currentRole ||
            sharedFields.length >= 2;
        if (!hasStrongMatch || similarity < 160) continue;

        for (const fieldName of observedFields) {
            if (currentFields.has(fieldName)) continue;
            const current = suggestions.get(fieldName) || {
                key: fieldName,
                count: 0,
                score: 0,
                role: observedRole.noteRole,
                sharedFields: new Set()
            };
            current.count += 1;
            current.score += similarity;
            sharedFields.forEach((field) => current.sharedFields.add(field));
            suggestions.set(fieldName, current);
        }
    }

    return filterAdaptiveHints([...suggestions.values()], { scoreScale: 450, limit: 6 })
        .map((entry) => ({
            key: entry.key,
            count: entry.count,
            score: entry.score,
            role: entry.role,
            sharedFields: [...entry.sharedFields]
        }));
}

function collectAdaptiveFrontmatterFieldSuggestions(document, docType, idIndex) {
    const intelligence = buildDocumentIntelligence(document, docType, idIndex);
    const model = buildFrontmatterOpportunityModel(intelligence.nodeFields, {
        nodeType: docType,
        content: document.getText(),
        fieldsCache: getFieldsCache(),
        observedFields: buildObservedFields(getFieldsCache()),
        noteContext: intelligence.noteRole ? intelligence : {
            noteRole: intelligence.noteRole,
            fieldRoleResults: intelligence.fieldRoleResults
        }
    });
    return filterAdaptiveHints(model.likelyFields, { scoreScale: 700, limit: 4 }).map((hint) => ({
        key: hint.key,
        score: hint.score,
        relational: hint.relational,
        sampleTargets: hint.sampleTargets,
        summary: hint.summary
    }));
}

function collectSchemaAdaptiveGapSuggestions(document, docType, idIndex) {
    const intelligence = buildDocumentIntelligence(document, docType, idIndex);
    const model = buildFrontmatterOpportunityModel(intelligence.nodeFields, {
        nodeType: docType,
        content: document.getText(),
        fieldsCache: getFieldsCache(),
        observedFields: buildObservedFields(getFieldsCache()),
        noteContext: intelligence.noteRole ? intelligence : {
            noteRole: intelligence.noteRole,
            fieldRoleResults: intelligence.fieldRoleResults
        }
    });
    return filterAdaptiveHints(model.likelyGaps || [], { scoreScale: 700, limit: 4 }).map((hint) => ({
        key: hint.field,
        family: hint.family,
        score: hint.score,
        relational: hint.relational,
        sampleTargets: hint.sampleTargets,
        alternatives: hint.alternatives,
        summary: hint.summary,
        missingSummary: hint.missingSummary
    }));
}

function collectArchetypeFieldSuggestions(document, docType) {
    const archetypes = extractDocumentArchetype(document, docType);
    const fields = new Map();
    for (const archetype of archetypes) {
        const suggestions = FRONTMATTER_ARCHETYPES[archetype] || [];
        suggestions.forEach((field, index) => {
            const current = fields.get(field);
            const score = 100 - index;
            if (!current || score > current.score) {
                fields.set(field, { key: field, score, source: archetype });
            }
        });
    }
    return Array.from(fields.values()).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

function collectNoteRoleFieldSuggestions(document, docType, idIndex) {
    const intelligence = buildDocumentIntelligence(document, docType, idIndex);
    const noteRole = intelligence.noteRole;
    const suggestions = NOTE_ROLE_FIELD_PRIORS[noteRole.noteRole] || [];
    const raw = suggestions.map((key, index) => ({
        key,
        score: Math.max(0, 100 - index),
        source: noteRole.noteRole,
        roleSummary: `${noteRole.noteRole} note`,
        confidence: noteRole.confidence,
        reasons: noteRole.supportingSignals || noteRole.reasons || [],
        conflictingSignals: noteRole.conflictingSignals || [],
        noteRole
    }));
    return filterItemsForSurface(raw, 'frontmatter-note-role', {
        confidenceKey: 'confidence',
        scoreScale: 120
    });
}

module.exports = {
    collectAdaptiveFrontmatterStarterSuggestions,
    collectObservedFrontmatterFields,
    collectRoleAlignedObservedFrontmatterFields,
    collectContextualObservedFrontmatterFields,
    collectAdaptiveFrontmatterFieldSuggestions,
    collectSchemaAdaptiveGapSuggestions,
    collectArchetypeFieldSuggestions,
    collectNoteRoleFieldSuggestions
};
