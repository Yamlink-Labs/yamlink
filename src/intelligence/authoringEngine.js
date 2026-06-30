'use strict';

const { getSchema } = require('../registries/schemaRegistry');
const { getTypes } = require('../registries/typeRegistry');
const { inferNoteRole } = require('./noteRolesCore');
const { extractBodyMentionedIds } = require('./frontmatterBodyHints');
const { classifyField, CATEGORY } = require('./fieldCategory');
const { planFieldActions, LEVEL } = require('./fieldPlanner');
const { getCachedPriors, getDominantTargetType } = require('./vaultPriors');

const SIGNAL_SKIP_FIELDS = new Set(['id']);
const SILENCE_LEVEL = typeof LEVEL?.SILENCE === 'number' ? LEVEL.SILENCE : 0;

function normalizeTypeList(values) {
    return Array.from(new Set((Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)));
}

function humanJoin(values, conjunction = 'or') {
    const items = (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean);
    if (!items.length) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}

function formatRelationSignal(fieldName, expectedTypes = [], options = {}) {
    const normalizedField = String(fieldName || '').trim().toLowerCase();
    const types = normalizeTypeList(expectedTypes).slice(0, 3);
    if (!normalizedField) return '';
    if (options.soft || types.length === 0) {
        return `${normalizedField} looks like a relation field in this note`;
    }
    return `${normalizedField} most likely links to ${humanJoin(types)} notes`;
}

function formatFieldSignalList(signals = []) {
    return (Array.isArray(signals) ? signals : [])
        .slice(0, 2)
        .map((signal) => {
            const fieldName = String(signal?.fieldName || '').trim().toLowerCase();
            const expected = normalizeTypeList(signal?.expectedTypes || []);
            if (!fieldName) return '';
            if (expected.length) {
                return `${fieldName} -> ${humanJoin(expected.slice(0, 2))}`;
            }
            return fieldName;
        })
        .filter(Boolean)
        .join('; ');
}

function formatWorkflowSignal(values = []) {
    const normalized = (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .slice(0, 4);
    return normalized.length ? `workflow values: ${normalized.join(', ')}` : 'workflow field';
}

function formatDateSignal() {
    return 'date field';
}

function formatLikelyMissingFields(fields = [], options = {}) {
    const normalized = (Array.isArray(fields) ? fields : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .slice(0, options.limit || 3);
    if (!normalized.length) return '';
    return `likely missing fields: ${normalized.join(', ')}`;
}

function getSchemaFieldDef(noteType, fieldName) {
    const normalizedType = String(noteType || '').trim().toLowerCase();
    const normalizedField = String(fieldName || '').trim().toLowerCase();
    if (!normalizedType || !normalizedField) return null;
    const schema = getSchema(normalizedType);
    if (!schema?.fields) return null;
    return schema.fields[normalizedField] || schema.fields[normalizedField.replace(/-/g, '_')] || null;
}

function buildAuthoringContext(options = {}) {
    const {
        noteType = '',
        noteFields = {},
        documentText = '',
        bodyWikilinkCounts = null,
        fieldsCache = null,
        generation = 0
    } = options;
    const safeFields = noteFields && typeof noteFields === 'object' ? noteFields : {};
    const priors = (!fieldsCache || !fieldsCache.size)
        ? {
            fieldTargetTypes: null,
            typeFieldBundles: null,
            fieldAmbiguity: null,
            noteRoleTypePriors: null,
            typeRoleMap: null,
            noteRoleNamePriors: null,
            noteRoleFieldHints: null,
            workflowFields: null,
            valuePatterns: null
        }
        : getCachedPriors(fieldsCache, generation);
    const noteRole = inferNoteRole(safeFields, {
        typeRoleMap: priors.typeRoleMap || null,
        noteRolePriors: priors.noteRoleNamePriors || null,
        noteRoleFieldHints: priors.noteRoleFieldHints || null
    });
    return {
        noteType: String(noteType || '').trim().toLowerCase(),
        noteFields: safeFields,
        bodyWikilinkCounts: bodyWikilinkCounts || (documentText ? extractBodyMentionedIds(documentText) : null),
        noteRole: noteRole.noteRole ? noteRole : null,
        priors
    };
}

function classifyFieldForAuthoring(fieldName, options = {}) {
    const normalizedField = String(fieldName || '').trim().toLowerCase();
    if (!normalizedField) {
        return {
            classification: { category: CATEGORY.UNKNOWN, confidence: 0, source: 'default', reasons: ['missing field name'] },
            context: buildAuthoringContext(options),
            schemaFieldDef: null
        };
    }

    const context = buildAuthoringContext(options);
    const schemaFieldDef = getSchemaFieldDef(context.noteType, normalizedField);
    const classification = classifyField(normalizedField, {
        schemaFieldDef,
        fieldsCache: options.fieldsCache || null,
        noteType: context.noteType,
        noteFields: context.noteFields,
        bodyWikilinkCounts: context.bodyWikilinkCounts,
        noteRole: context.noteRole,
        ...context.priors
    });

    return { classification, context, schemaFieldDef };
}

function evaluateFieldForSurface(fieldName, surface, options = {}) {
    const result = classifyFieldForAuthoring(fieldName, options);
    return {
        ...result,
        plan: planFieldActions(result.classification, surface)
    };
}

function getExpectedRelationTypes(fieldName, options = {}) {
    const normalizedField = String(fieldName || '').trim().toLowerCase();
    if (!normalizedField) return [];

    const {
        noteType = '',
        fieldsCache = null,
        generation = 0,
        minRatio = 0.6,
        minCount = 2
    } = options;

    const schemaFieldDef = getSchemaFieldDef(noteType, normalizedField);
    const schemaTypes = [];
    if (String(schemaFieldDef?.type || '').trim().toLowerCase() === 'relation') {
        if (schemaFieldDef.target) schemaTypes.push(schemaFieldDef.target);
        if (Array.isArray(schemaFieldDef.targetTypes)) schemaTypes.push(...schemaFieldDef.targetTypes);
    }
    const normalizedSchemaTypes = normalizeTypeList(schemaTypes);
    if (normalizedSchemaTypes.length) return normalizedSchemaTypes;

    if (fieldsCache && fieldsCache.size) {
        const priors = getCachedPriors(fieldsCache, generation);
        const dominant = getDominantTargetType(normalizedField, priors.fieldTargetTypes);
        if (dominant && dominant.ratio >= minRatio && dominant.count >= minCount) {
            return [String(dominant.targetType || '').trim().toLowerCase()].filter(Boolean);
        }
    }

    const knownTypes = getTypes ? Array.from(getTypes()) : [];
    if (knownTypes.includes(normalizedField)) return [normalizedField];
    return [];
}

function scoreAuthoringCandidate(candidate, partial, expectedTypes) {
    const query = String(partial || '').trim().toLowerCase();
    const id = String(candidate.id || '').trim().toLowerCase();
    const label = String(candidate.label || candidate.id || '').trim().toLowerCase();
    const aliases = (Array.isArray(candidate.aliases) ? candidate.aliases : [])
        .map((alias) => String(alias || '').trim().toLowerCase())
        .filter(Boolean);
    const type = String(candidate.type || '').trim().toLowerCase();
    const status = String(candidate.status || '').trim();
    const searchable = `${id} ${label} ${aliases.join(' ')}`.trim();
    if (query && !searchable.includes(query)) return -1;

    const expected = new Set(normalizeTypeList(expectedTypes));
    const typeMatch = expected.size > 0 && expected.has(type);
    const exactId = query && id === query;
    const idPrefix = query && id.startsWith(query);
    const labelPrefix = query && label.startsWith(query);
    const aliasPrefix = query && aliases.some((alias) => alias.startsWith(query));
    const contains = query && searchable.includes(query);

    let score = 0;
    if (typeMatch) score += 1000;
    if (exactId) score += 800;
    else if (idPrefix) score += 500;
    else if (labelPrefix) score += 350;
    else if (aliasPrefix) score += 325;
    else if (contains) score += 150;
    else if (!query) score += 100;
    if (status) score += 5;
    score -= id.length * 0.01;
    score -= label.length * 0.005;
    return score;
}

function rankWikilinkTargets(candidateEntries, partial, options = {}) {
    const expectedTypes = options.expectedTypes || [];
    return (Array.isArray(candidateEntries) ? candidateEntries : [])
        .map((candidate) => ({
            ...candidate,
            score: scoreAuthoringCandidate(candidate, partial, expectedTypes)
        }))
        .filter((candidate) => candidate.score >= 0)
        .sort((a, b) => b.score - a.score || String(a.label || a.id).localeCompare(String(b.label || b.id)))
        .map((candidate) => ({
            id: String(candidate.id || '').trim().toLowerCase(),
            label: String(candidate.label || candidate.id || '').trim(),
            aliases: Array.isArray(candidate.aliases)
                ? candidate.aliases.map((alias) => String(alias || '').trim()).filter(Boolean)
                : [],
            type: String(candidate.type || '').trim(),
            status: String(candidate.status || '').trim(),
            score: candidate.score
        }));
}

function hasMeaningfulValue(value) {
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    return String(value).trim().length > 0;
}

function relationStrengthWeight(value) {
    switch (String(value || '').trim().toLowerCase()) {
        case 'certain': return 3;
        case 'likely': return 2;
        case 'weak': return 1;
        default: return 0;
    }
}

function collectAuthoringFieldSignals(surface, options = {}) {
    const noteFields = options.noteFields && typeof options.noteFields === 'object'
        ? options.noteFields
        : {};

    return Object.entries(noteFields)
        .filter(([fieldName, rawValue]) => !SIGNAL_SKIP_FIELDS.has(fieldName) && hasMeaningfulValue(rawValue))
        .map(([fieldName, rawValue]) => {
            const evaluation = evaluateFieldForSurface(fieldName, surface, options);
            return {
                fieldName,
                rawValue,
                expectedTypes: getExpectedRelationTypes(fieldName, options),
                ...evaluation
            };
        })
        .filter((entry) =>
            entry.classification.category === CATEGORY.RELATION
            || entry.plan.level > SILENCE_LEVEL)
        .sort((a, b) =>
            b.plan.level - a.plan.level
            || relationStrengthWeight(b.classification.relationStrength) - relationStrengthWeight(a.classification.relationStrength)
            || b.classification.confidence - a.classification.confidence
            || a.fieldName.localeCompare(b.fieldName));
}

function summarizeAuthoringFieldSignals(surface, options = {}) {
    const signals = collectAuthoringFieldSignals(surface, options);
    if (!signals.length) return null;

    const top = signals[0];
    let summary = formatRelationSignal(top.fieldName, top.expectedTypes, { soft: false });
    if (top.plan.level <= (typeof LEVEL?.HINT === 'number' ? LEVEL.HINT : 2)) {
        summary = formatRelationSignal(top.fieldName, top.expectedTypes, { soft: true });
    }

    return {
        summary,
        primarySignal: top,
        signals
    };
}

module.exports = {
    buildAuthoringContext,
    classifyFieldForAuthoring,
    collectAuthoringFieldSignals,
    evaluateFieldForSurface,
    formatDateSignal,
    formatFieldSignalList,
    formatLikelyMissingFields,
    formatRelationSignal,
    formatWorkflowSignal,
    getSchemaFieldDef,
    getExpectedRelationTypes,
    rankWikilinkTargets,
    summarizeAuthoringFieldSignals
};
