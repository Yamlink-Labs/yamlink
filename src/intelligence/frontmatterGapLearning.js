'use strict';

const { buildObservedNoteIndex, extractRelationIds } = require('./suggestionCore');
const {
    FAMILY_MAP,
    naturalList,
    detectFieldFamily,
    collectCurrentFieldFamilies
} = require('./frontmatterFieldFamilies');

function buildSchemaAdaptiveGaps(nodeFields, noteContext, fieldsCache, options = {}) {
    const nodeType = String(options.nodeType || nodeFields?.type || '').trim().toLowerCase();
    const observedIndex = options.observedIndex || buildObservedNoteIndex(fieldsCache, options);
    const currentFamilies = collectCurrentFieldFamilies(nodeFields, noteContext);
    const currentFields = new Set(
        Object.entries(nodeFields || {})
            .filter(([, value]) => String(value ?? '').trim() !== '')
            .map(([key]) => String(key || '').trim().toLowerCase())
            .filter(Boolean)
    );
    const currentRole = noteContext?.noteRole?.noteRole || 'record';
    const hasIdentitySignal = Boolean(
        String(nodeFields?.name || '').trim()
        || String(nodeFields?.title || '').trim()
        || String(nodeFields?.id || '').trim()
    );
    const families = new Map();

    for (const observed of observedIndex.notes) {
        const observedType = String(observed?.type || '').trim().toLowerCase();
        const observedFieldEntries = observed.fieldEntries;
        if (!observedFieldEntries.length) continue;
        const observedContext = observed.noteContext;

        const observedFieldNames = observedFieldEntries.map(([key]) => String(key || '').trim().toLowerCase());
        const sharedFields = observedFieldNames.filter((field) => currentFields.has(field));
        let similarity = 0;
        if (nodeType && observedType === nodeType) similarity += 220;
        if (observedContext.noteRole?.noteRole === currentRole) similarity += 180;
        similarity += sharedFields.length * 45;
        if (!similarity) continue;

        for (const [rawFieldName, rawValue] of observedFieldEntries) {
            const normalizedField = String(rawFieldName || '').trim().toLowerCase();
            if (currentFields.has(normalizedField)) continue;
            const matchingRole = (observedContext.fieldRoleResults || []).find((result) => {
                return String(result.fieldName || '').trim().toLowerCase() === normalizedField;
            });
            const family = detectFieldFamily(rawFieldName, matchingRole?.semanticRole || null);
            if (!family || currentFamilies.has(family)) continue;
            if (family === 'title' && hasIdentitySignal) continue;

            const entry = families.get(family) || {
                family,
                score: 0,
                count: 0,
                summary: FAMILY_MAP.get(family)?.summary || `${family} field`,
                variants: new Map(),
                relational: false,
                sampleTargets: new Set(),
                sharedFields: new Set(),
                sourceRoles: new Set()
            };

            entry.score += similarity;
            entry.count += 1;
            entry.relational = entry.relational || Boolean(matchingRole?.relational);
            entry.variants.set(normalizedField, (entry.variants.get(normalizedField) || 0) + similarity);
            extractRelationIds(rawValue).slice(0, 2).forEach((target) => entry.sampleTargets.add(target));
            sharedFields.slice(0, 3).forEach((field) => entry.sharedFields.add(field));
            if (observedContext.noteRole?.roleLabel) entry.sourceRoles.add(observedContext.noteRole.roleLabel);
            families.set(family, entry);
        }
    }

    return [...families.values()]
        .map((entry) => {
            const variants = [...entry.variants.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([field]) => field);
            const field = variants[0];
            const targets = [...entry.sampleTargets];
            const shared = [...entry.sharedFields];
            const roleLead = entry.sourceRoles.size
                ? `${naturalList([...entry.sourceRoles].slice(0, 2))} notes`
                : 'notes like this';
            const sharedLead = shared.length
                ? `${roleLead} often keep ${field} alongside ${shared.slice(0, 2).join(' and ')}`
                : `${roleLead} often keep ${field}`;
            return {
                family: entry.family,
                field,
                alternatives: variants.slice(1, 3),
                score: entry.score,
                count: entry.count,
                relational: entry.relational,
                sampleTargets: targets,
                summary: entry.relational && targets.length
                    ? `${sharedLead}, usually pointing to ${targets.slice(0, 2).join(' and ')}`
                    : `${sharedLead}`,
                missingSummary: `You may still be missing ${field} here`,
                insertText: entry.relational ? `${field}: [[\n` : `${field}: \n`,
                relationInsertText: entry.relational && targets.length
                    ? `${field}: [[${targets[0]}]]\n`
                    : null
            };
        })
        .sort((a, b) => b.score - a.score || a.field.localeCompare(b.field))
        .slice(0, options.gapLimit || 4);
}

function buildRecommendedBundles(likelyFields = [], likelyGaps = [], options = {}) {
    const seen = new Set();
    const hints = [];
    const pool = [...likelyFields, ...likelyGaps];
    for (const hint of pool) {
        if (!hint || !hint.field || seen.has(hint.field)) continue;
        seen.add(hint.field);
        hints.push(hint);
    }

    const primary = hints.slice(0, options.bundleLimit || 3);
    return {
        fields: primary,
        insertText: primary
            .map((hint) => hint.relationInsertText || hint.insertText)
            .join(''),
        summary: primary.map((hint) => hint.field).join(', ')
    };
}

module.exports = {
    buildSchemaAdaptiveGaps,
    buildRecommendedBundles
};
