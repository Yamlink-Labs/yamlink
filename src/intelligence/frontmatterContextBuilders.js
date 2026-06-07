'use strict';

const {
    naturalList,
    pickPreferredSourceType,
    detectFieldFamily,
    getFieldRoleResult
} = require('./frontmatterFieldFamilies');

/**
 * @param {object} [nodeFields]
 * @param {object} [noteContext]
 * @param {Map<string,object>} [fieldsCache]
 * @param {object} [options]
 * @returns {object[]}
 */
function buildLikelyContexts(nodeFields = {}, noteContext = {}, fieldsCache = new Map(), options = {}) {
    const seeds = [];
    const seenSeed = new Set();

    for (const [rawFieldName, rawValue] of Object.entries(nodeFields || {})) {
        const value = String(rawValue || '').trim();
        if (!value) continue;
        const role = getFieldRoleResult(noteContext, rawFieldName);
        const family = detectFieldFamily(rawFieldName, role?.semanticRole || null);
        if (role?.relational || family) {
            const key = `${String(rawFieldName || '').trim().toLowerCase()}::present`;
            if (!seenSeed.has(key)) {
                seeds.push({ field: rawFieldName, family, score: 260, source: 'present' });
                seenSeed.add(key);
            }
        }
    }

    for (const hint of options.likelyFields || []) {
        if (!hint?.relational) continue;
        const family = detectFieldFamily(hint.field, hint.semanticRole || null);
        const key = `${String(hint.field || '').trim().toLowerCase()}::likely-field`;
        if (seenSeed.has(key)) continue;
        seeds.push({ field: hint.field, family, score: 220 + (hint.score || 0), source: 'likely-field' });
        seenSeed.add(key);
    }

    for (const gap of options.likelyGaps || []) {
        if (!gap?.relational) continue;
        const family = gap.family || detectFieldFamily(gap.field, null);
        const key = `${String(gap.field || '').trim().toLowerCase()}::gap`;
        if (seenSeed.has(key)) continue;
        seeds.push({ field: gap.field, family, score: 200 + (gap.score || 0), source: 'gap' });
        seenSeed.add(key);
    }

    const contexts = [];
    const seenTargets = new Set();
    for (const seed of seeds) {
        const learned = options.buildFieldFamilyRelationModel(seed.field, nodeFields, noteContext, fieldsCache, options);
        if (!learned.preferredTargets.length) continue;
        const topTarget = learned.preferredTargets[0];
        const dedupe = `${seed.family || learned.field}\x00${topTarget}`;
        if (seenTargets.has(dedupe)) continue;
        seenTargets.add(dedupe);
        contexts.push({
            field: learned.field,
            family: learned.family,
            targetId: topTarget,
            targets: learned.preferredTargets.slice(0, 3),
            variants: learned.variants.slice(0, 3),
            sourceRoles: learned.sourceRoles.slice(0, 3),
            sourceTypes: learned.sourceTypes.slice(0, 3),
            score: seed.score + (learned.targetScores.get(topTarget) || 0),
            source: seed.source,
            summary: `${learned.field} usually points to ${topTarget}`,
            detail: learned.summary,
            reasonText: learned.reasonText,
            insertText: `${learned.field}: [[${topTarget}]]\n`
        });
    }

    return contexts
        .sort((a, b) => b.score - a.score || a.field.localeCompare(b.field))
        .slice(0, options.contextLimit || 4);
}

/**
 * @param {object[]} [likelyContexts]
 * @param {{ bundleContextLimit?: number }} [options]
 * @returns {{ contexts: object[], summary: string, description: string, insertText: string } | null}
 */
function buildContextBundles(likelyContexts = [], options = {}) {
    const familiesSeen = new Set();
    const picked = [];
    for (const hint of likelyContexts) {
        const familyKey = hint.family || hint.field;
        if (familiesSeen.has(familyKey)) continue;
        familiesSeen.add(familyKey);
        picked.push(hint);
        if (picked.length >= (options.bundleContextLimit || 3)) break;
    }
    if (!picked.length) return null;

    const summaryBits = picked.map((hint) => `${hint.field} -> ${hint.targetId}`);
    const roleLead = picked
        .flatMap((hint) => hint.sourceRoles || [])
        .filter(Boolean)
        .slice(0, 2);
    const noteLead = roleLead.length
        ? `${naturalList(roleLead)} notes`
        : 'notes like this';

    return {
        contexts: picked,
        summary: summaryBits.join(', '),
        description: `${noteLead} usually connect through ${summaryBits.join(', ')}`,
        insertText: picked.map((hint) => hint.insertText).join('')
    };
}

/**
 * @param {object[]} [likelyContexts]
 * @param {{ getDefaultSortField?: (type: string) => string, threadViewLimit?: number }} [options]
 * @returns {object[]}
 */
function buildContextThreadViews(likelyContexts = [], options = {}) {
    const sortResolver = options.getDefaultSortField || (() => '');
    const hints = [];
    const seen = new Set();

    for (const context of likelyContexts) {
        const sourceType = String(pickPreferredSourceType(context.sourceTypes || []) || '').trim().toLowerCase();
        const field = String(context.field || '').trim().toLowerCase();
        const relatedId = String(context.targetId || '').trim();
        if (!sourceType || !field || !relatedId) continue;
        const key = `${sourceType}\x00${field}\x00${relatedId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        let queryText = `!view ${sourceType}\nwhere ${field} = [[${relatedId}]]`;
        const sortField = String(sortResolver(sourceType) || '').trim();
        if (sortField) queryText += `\nsort ${sortField} desc`;

        hints.push({
            sourceType,
            field,
            relatedId,
            score: Number(context.score || 0),
            title: `${sourceType} notes through ${relatedId}`,
            description: `${(context.sourceRoles || [])[0] || sourceType} notes often connect through ${field} -> ${relatedId}`,
            summary: `${field} around ${relatedId}`,
            queryText
        });
    }

    return hints
        .sort((a, b) => b.score - a.score || a.sourceType.localeCompare(b.sourceType))
        .slice(0, options.threadViewLimit || 3);
}

module.exports = {
    buildLikelyContexts,
    buildContextBundles,
    buildContextThreadViews
};
