'use strict';

const { getFieldsCache, getVaultGeneration } = require('../core/indexService');
const { normaliseDateInput } = require('../core/date');
const { inferNoteRole } = require('../intelligence/noteRolesCore');
const { filterItemsForSurface } = require('../intelligence/confidence');
const { getVaultPatterns } = require('../intelligence/intelligenceCache');
const {
    getCachedPriors,
    getCommonFieldsForType,
    buildVaultStatusValues,
    buildVaultSemanticRolePriors
} = require('../intelligence/vaultPriors');
const { computeNoteDrift } = require('../intelligence/driftDetector');
const {
    buildFrontmatterOpportunityModel,
    buildFrontmatterGuidanceSummary,
    summarizeGuidanceExplanation
} = require('../intelligence/frontmatterIntelligence');
const {
    buildDocumentIntelligence,
    normalizeFrontmatterKey
} = require('./completionContextHelpers');
const { inferFieldRole } = require('../intelligence/fieldRoles');

function buildBundleFieldSuggestions(noteType, fieldsCache, opts = {}) {
    if (!noteType) return [];
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    return getCommonFieldsForType(noteType, priors.typeFieldBundles, fieldsCache, {
        limit: opts.limit || 8,
        minRatio: opts.minRatio ?? 0.30
    }).map((entry, index) => ({
        key: entry.field,
        count: entry.count,
        ratio: entry.ratio,
        score: Math.round((entry.ratio * 160) + Math.max(0, 120 - (index * 6))),
        source: noteType,
        bundleDerived: true
    }));
}

function buildStarterActionLabel(action) {
    if (action.kind === 'bundle') return 'add smart setup';
    if (action.kind === 'context') return 'add likely context';
    if (action.kind === 'connection') return 'link nearby note';
    if (action.kind === 'body-mention') return 'link body context';
    return 'add next step';
}

/** @param {import('vscode').TextDocument} document @param {string|null} docType @param {Map<string,string>} idIndex @param {((type: string) => any)|null} [getSchema] @returns {Record<string,any>} */
function buildAdaptiveFrontmatterContext(document, docType, idIndex, getSchema) {
    const fieldsCache = getFieldsCache();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const intelligence = buildDocumentIntelligence(document, docType, idIndex);
    const { observedFields, observedIndex } = getVaultPatterns(fieldsCache, getVaultGeneration());
    // Vault-derived semantic values — the vault teaches the system, not the other way round.
    const statusLikeValues = buildVaultStatusValues(priors.workflowFields);
    const semanticRolePriors = buildVaultSemanticRolePriors(priors);
    const opportunities = buildFrontmatterOpportunityModel(intelligence.nodeFields, {
        nodeId: String(intelligence.nodeFields.id || '').trim(),
        nodeType: docType,
        content: document.getText(),
        fieldsCache,
        observedFields,
        observedIndex,
        noteContext: intelligence,
        getSchemaForType: getSchema,
        dateParser: normaliseDateInput,
        statusLikeValues,
        semanticRolePriors,
        getDefaultSortField: () => '',
        limit: 4
    });
    const guidance = buildFrontmatterGuidanceSummary(opportunities);
    return {
        fieldsCache,
        intelligence,
        observedFields,
        opportunities,
        guidance,
        bodyEvidence: guidance.bodyEvidence || ''
    };
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

/** @param {import('vscode').TextDocument} document @param {string|null} docType @param {Map<string,string>} idIndex @param {(type: string) => any} getSchema @param {Record<string,any>} adaptiveContext @returns {Array<Record<string,any>>} */
function collectAdaptiveFrontmatterStarterSuggestions(document, docType, idIndex, getSchema, adaptiveContext) {
    const context = adaptiveContext || buildAdaptiveFrontmatterContext(document, docType, idIndex, getSchema);
    const { guidance, opportunities } = context;
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
        reason: summarizeGuidanceExplanation(guidance),
        headline: guidance.headline,
        why: guidance.why,
        workflowSummary: guidance.workflowSummary,
        setupSummary: guidance.setupSummary,
        bodyEvidence: guidance.bodyEvidence,
        bodyMentions: opportunities.bodyMentionHints || [],
        score: 920 - (index * 110)
    }));
    return filterItemsForSurface(raw, 'frontmatter-actions', {
        scoreScale: 1000
    }).slice(0, 3).map((item, index) => ({
        ...item,
        sortScore: 2000 - (index * 20)
    }));
}

/** @param {string|null} [docType] @returns {Array<{key: string, count: number}>} */
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

/** @param {import('vscode').TextDocument} document @param {string|null} docType @param {Map<string,string>} idIndex @returns {Array<Record<string,any>>} */
function collectRoleAlignedObservedFrontmatterFields(document, docType, idIndex) {
    const fieldsCache = getFieldsCache();
    const intelligence = buildDocumentIntelligence(document, docType, idIndex);
    const noteRole = intelligence.noteRole;
    const observed = collectObservedFrontmatterFields();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const proxyType = noteRole?.noteRole
        ? priors.noteRoleTypePriors.get(noteRole.noteRole)?.dominantType || ''
        : '';
    const vaultBundle = proxyType ? priors.typeFieldBundles.get(proxyType) : null;
    // roleAligned is true only when the vault bundle confirms it — no hardcoded fallback.
    // A field is role-aligned when the vault has actually seen it on notes of this role.
    return observed.map((entry) => ({
        ...entry,
        noteRole,
        roleAligned: Boolean(vaultBundle && vaultBundle.has(entry.key))
    }));
}

/** @param {import('vscode').TextDocument} document @param {string|null} docType @param {Map<string,string>} idIndex @returns {Array<Record<string,any>>} */
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

/** @param {import('vscode').TextDocument} document @param {string|null} docType @param {Map<string,string>} idIndex @param {Record<string,any>} adaptiveContext @returns {Array<Record<string,any>>} */
function collectAdaptiveFrontmatterFieldSuggestions(document, docType, idIndex, adaptiveContext) {
    const context = adaptiveContext || buildAdaptiveFrontmatterContext(document, docType, idIndex);
    const { opportunities, guidance } = context;
    const model = opportunities;
    return filterAdaptiveHints(model.likelyFields, { scoreScale: 700, limit: 4 }).map((hint) => ({
        key: hint.key,
        score: hint.score,
        relational: hint.relational,
        sampleTargets: hint.sampleTargets,
        summary: hint.summary,
        bodyEvidence: guidance.bodyEvidence || '',
        reason: summarizeGuidanceExplanation(guidance)
    }));
}

/** @param {import('vscode').TextDocument} document @param {string|null} docType @param {Map<string,string>} idIndex @param {Record<string,any>} adaptiveContext @returns {Array<Record<string,any>>} */
function collectSchemaAdaptiveGapSuggestions(document, docType, idIndex, adaptiveContext) {
    const context = adaptiveContext || buildAdaptiveFrontmatterContext(document, docType, idIndex);
    const { opportunities, guidance } = context;
    const model = opportunities;
    return filterAdaptiveHints(model.likelyGaps || [], { scoreScale: 700, limit: 4 }).map((hint) => ({
        key: hint.field,
        family: hint.family,
        score: hint.score,
        relational: hint.relational,
        sampleTargets: hint.sampleTargets,
        alternatives: hint.alternatives,
        summary: hint.summary,
        missingSummary: hint.missingSummary,
        bodyEvidence: guidance.bodyEvidence || '',
        reason: summarizeGuidanceExplanation(guidance)
    }));
}

/** @param {import('vscode').TextDocument} document @param {string|null} docType @returns {Array<Record<string,any>>} */
function collectArchetypeFieldSuggestions(document, docType) {
    const fieldsCache = getFieldsCache();
    const bundleSuggestions = buildBundleFieldSuggestions(docType, fieldsCache, { limit: 8, minRatio: 0.30 });
    // Return vault-learned bundle suggestions only. On zero-evidence vaults we return
    // nothing rather than guessing from a global archetype table — the vault teaches
    // the system once it has real examples, not before.
    return bundleSuggestions;
}

/** @param {import('vscode').TextDocument} document @param {string|null} docType @param {Map<string,string>} idIndex @returns {Array<Record<string,any>>} */
function collectDriftMissingFieldSuggestions(document, docType, idIndex) {
    const fieldsCache = getFieldsCache();
    const intelligence = buildDocumentIntelligence(document, docType, idIndex);
    const noteFields = intelligence.nodeFields;
    const noteId = String(noteFields.id || '').trim().toLowerCase();
    if (!noteId) return [];
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const drift = computeNoteDrift(noteId, noteFields, fieldsCache, priors);
    if (!drift || drift.insufficientData || !drift.missingExpected.length) return [];
    return drift.missingExpected.map((entry) => ({
        key: entry.field,
        ratio: entry.ratio,
        score: Math.round(entry.ratio * 200) + 120,
        source: drift.noteType,
        driftMissing: true,
        driftNote: `${Math.round(entry.ratio * 100)}% of ${drift.noteType} notes have this field`
    }));
}

/** @param {import('vscode').TextDocument} document @param {string|null} docType @param {Map<string,string>} idIndex @returns {Array<Record<string,any>>} */
function collectNoteRoleFieldSuggestions(document, docType, idIndex) {
    const fieldsCache = getFieldsCache();
    const intelligence = buildDocumentIntelligence(document, docType, idIndex);
    const noteRole = intelligence.noteRole;
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const proxyType = noteRole?.noteRole
        ? priors.noteRoleTypePriors.get(noteRole.noteRole)?.dominantType || ''
        : '';
    const bundleSuggestions = buildBundleFieldSuggestions(proxyType, fieldsCache, { limit: 8, minRatio: 0.30 });
    // Return vault-bundle suggestions only. When the vault has no evidence for this
    // role's proxy type, we return nothing rather than guessing from a hardcoded
    // field list. The vault builds the right list organically.
    if (!bundleSuggestions.length) return [];
    const raw = bundleSuggestions.map((entry) => ({
        key: entry.key,
        score: entry.score,
        source: proxyType,
        roleSummary: proxyType ? `${proxyType} notes often use this field` : `${noteRole.noteRole} note`,
        confidence: noteRole.confidence,
        reasons: [
            ...(noteRole.supportingSignals || noteRole.reasons || []),
            `vault bundle: ${proxyType} notes commonly include ${entry.key}`
        ],
        conflictingSignals: noteRole.conflictingSignals || [],
        noteRole
    }));
    return filterItemsForSurface(raw, 'frontmatter-note-role', {
        confidenceKey: 'confidence',
        scoreScale: 180
    });
}

module.exports = {
    buildAdaptiveFrontmatterContext,
    collectAdaptiveFrontmatterStarterSuggestions,
    collectObservedFrontmatterFields,
    collectRoleAlignedObservedFrontmatterFields,
    collectContextualObservedFrontmatterFields,
    collectAdaptiveFrontmatterFieldSuggestions,
    collectSchemaAdaptiveGapSuggestions,
    collectArchetypeFieldSuggestions,
    collectNoteRoleFieldSuggestions,
    collectDriftMissingFieldSuggestions
};
