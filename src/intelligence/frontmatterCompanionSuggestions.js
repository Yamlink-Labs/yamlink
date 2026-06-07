'use strict';

const { buildObservedNoteIndex } = require('./suggestionCore');
const {
    naturalList,
    pickConnectionField
} = require('./frontmatterFieldFamilies');

/**
 * @param {object} [nodeFields]
 * @param {object[]} [likelyContexts]
 * @param {Map<string,object>} [fieldsCache]
 * @param {{ nodeId?: string, observedIndex?: object, companionLimit?: number }} [options]
 * @returns {object[]}
 */
function buildLikelyCompanions(nodeFields = {}, likelyContexts = [], fieldsCache = new Map(), options = {}) {
    const nodeId = String(options.nodeId || '').trim();
    const observedIndex = options.observedIndex || buildObservedNoteIndex(fieldsCache, options);
    const companions = [];
    const seen = new Set();

    for (const context of likelyContexts) {
        const field = String(context.field || '').trim().toLowerCase();
        const targetId = String(context.targetId || '').trim();
        if (!field || !targetId) continue;

        const candidates = observedIndex.notesByRelationFieldTarget.get(`${field}\x00${targetId}`) || [];
        for (const candidate of candidates) {
            const candidateId = String(candidate.id || '').trim();
            const candidateFields = candidate.fields || {};
            if (!candidateFields || !candidateId || candidateId === nodeId) continue;
            const dedupe = `${candidateId}\x00${field}\x00${targetId}`;
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);
            companions.push({
                candidateId,
                candidateType: String(candidateFields.type || '').trim().toLowerCase() || 'note',
                field,
                targetId,
                score: Number(context.score || 0),
                summary: `${candidateId} also connects through ${field} -> ${targetId}`,
                insertField: pickConnectionField(nodeFields),
                insertText: `${pickConnectionField(nodeFields)}: [[${candidateId}]]\n`
            });
        }
    }

    return companions
        .sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId))
        .slice(0, options.companionLimit || 3);
}

/**
 * @param {object} [nodeFields]
 * @param {object[]} [likelyContexts]
 * @param {Map<string,object>} [fieldsCache]
 * @param {object} [options]
 * @returns {object[]}
 */
function buildSurroundingSetups(nodeFields = {}, likelyContexts = [], fieldsCache = new Map(), options = {}) {
    const nodeId = String(options.nodeId || '').trim();
    const nodeType = String(options.nodeType || nodeFields?.type || '').trim().toLowerCase() || 'note';
    const getDefaultSortField = options.getDefaultSortField || (() => '');
    const observedIndex = options.observedIndex || buildObservedNoteIndex(fieldsCache, options);
    const setups = [];
    const seen = new Set();

    for (const context of likelyContexts) {
        const field = String(context.field || '').trim().toLowerCase();
        const targetId = String(context.targetId || '').trim();
        if (!field || !targetId) continue;

        const key = `${field}\x00${targetId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const companionKinds = new Map();
        companionKinds.set(`${nodeType}\x00${nodeType}`, {
            type: nodeType,
            label: nodeType,
            count: 1,
            score: Number(context.score || 0) + 20,
            examples: new Set(nodeId ? [nodeId] : [])
        });
        const candidates = observedIndex.notesByRelationFieldTarget.get(`${field}\x00${targetId}`) || [];
        for (const candidate of candidates) {
            const candidateId = String(candidate.id || '').trim();
            const candidateFields = candidate.fields || {};
            if (!candidateFields || !candidateId || candidateId === nodeId) continue;

            const candidateType = String(candidate.type || '').trim().toLowerCase() || 'note';
            const candidateContext = candidate.noteContext;
            const label = String(candidateType || candidateContext.noteRole?.roleLabel || 'note').trim().toLowerCase();
            const companionKey = `${candidateType}\x00${label}`;
            const current = companionKinds.get(companionKey) || {
                type: candidateType,
                label,
                count: 0,
                score: 0,
                examples: new Set()
            };
            current.count += 1;
            current.score += Number(context.score || 0) + 40;
            current.examples.add(candidateId);
            companionKinds.set(companionKey, current);
        }

        const rankedKinds = [...companionKinds.values()]
            .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
            .slice(0, options.surroundingLimit || 3);
        if (!rankedKinds.length) continue;

        const labels = rankedKinds.map((entry) => entry.label);
        const queryBlocks = rankedKinds.slice(0, 2).map((entry) => {
            let queryText = `!view ${entry.type}\nwhere ${field} = [[${targetId}]]`;
            const sortField = String(getDefaultSortField(entry.type) || '').trim();
            if (sortField) queryText += `\nsort ${sortField} desc`;
            return queryText;
        });

        setups.push({
            field,
            targetId,
            family: context.family || null,
            score: Number(context.score || 0) + rankedKinds.reduce((sum, entry) => sum + entry.score, 0),
            companionKinds: rankedKinds.map((entry) => ({
                type: entry.type,
                label: entry.label,
                count: entry.count,
                examples: [...entry.examples].slice(0, 2)
            })),
            summary: `${field} around ${targetId} often includes ${naturalList(labels)}`,
            description: `Notes like this usually sit beside ${naturalList(labels)} around ${targetId}`,
            blockText: `\n${queryBlocks.join('\n\n')}\n`,
            queryText: queryBlocks.join('\n\n')
        });
    }

    return setups
        .sort((a, b) => b.score - a.score || a.summary.localeCompare(b.summary))
        .slice(0, options.surroundingSetupLimit || 3);
}

module.exports = {
    buildLikelyCompanions,
    buildSurroundingSetups
};
