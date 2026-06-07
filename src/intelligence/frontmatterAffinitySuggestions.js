'use strict';

const { inferNoteRole } = require('./noteRolesCore');
const {
    buildObservedNoteIndex,
    extractRelationIds,
    collectCurrentRelationSignals
} = require('./suggestionCore');
const {
    naturalList,
    pickConnectionField
} = require('./frontmatterFieldFamilies');

function collectRelationNeighborhood(nodeFields = {}) {
    const relationFields = [];
    const relatedIds = new Set();
    for (const [field, rawValue] of Object.entries(nodeFields || {})) {
        const ids = extractRelationIds(rawValue);
        if (!ids.length) continue;
        relationFields.push(field);
        ids.forEach((id) => relatedIds.add(id));
    }
    return {
        relationFields,
        relatedIds: [...relatedIds]
    };
}

/**
 * Finds notes that share relation targets with the current note but aren't directly linked.
 * @param {object} nodeFields
 * @param {object} noteContext
 * @param {Map<string,object>} fieldsCache
 * @param {object} [options]
 * @returns {object[]}
 */
function buildAffinityConnections(nodeFields, noteContext, fieldsCache, options = {}) {
    const nodeId = String(options.nodeId || '').trim();
    const nodeType = String(options.nodeType || nodeFields?.type || '').trim().toLowerCase();
    const currentRole = noteContext?.noteRole?.noteRole || 'record';
    const currentNeighborhood = collectRelationNeighborhood(nodeFields);
    const relationSignals = collectCurrentRelationSignals(nodeFields, options.currentMentionedIds);
    const currentRelatedIds = relationSignals.currentRelatedIds;
    const observedIndex = options.observedIndex || buildObservedNoteIndex(fieldsCache, options);
    if (!currentRelatedIds.size) return [];

    const seenDirect = new Set(currentNeighborhood.relatedIds);
    const candidates = [];

    for (const candidate of observedIndex.notes) {
        const candidateId = String(candidate.id || '').trim();
        const candidateFields = candidate.fields || {};
        if (!candidateFields || !candidateId || candidateId === nodeId) continue;
        if (seenDirect.has(candidateId)) continue;

        const candidateNeighborhood = {
            relationFields: candidate.relationFields || [],
            relatedIds: candidate.relatedIds || []
        };
        if (!candidateNeighborhood.relatedIds.length) continue;

        const sharedTargets = candidateNeighborhood.relatedIds.filter((id) => currentRelatedIds.has(id));
        if (!sharedTargets.length) continue;
        const sharedFields = candidateNeighborhood.relationFields.filter((field) =>
            relationSignals.currentRelationFields.has(String(field || '').trim().toLowerCase())
        );

        const candidateLinksBack = candidateNeighborhood.relatedIds.includes(nodeId);
        if (candidateLinksBack) continue;

        const candidateType = String(candidate.type || '').trim().toLowerCase();
        const candidateContext = candidate.noteContext;

        let score = sharedTargets.length * 120;
        if (candidateType && nodeType && candidateType === nodeType) score += 80;
        if (candidateContext.noteRole?.noteRole && candidateContext.noteRole.noteRole === currentRole) score += 70;
        score += sharedFields.length * 60;
        if (sharedTargets.length >= 2) score += 40;
        if (sharedTargets.length && sharedFields.length) score += 40;
        if (score < 120) continue;

        candidates.push({
            candidateId,
            candidateType: candidateType || 'note',
            candidateRole: candidateContext.noteRole?.noteRole || inferNoteRole(candidateFields).noteRole || 'record',
            sharedTargets,
            matchedFields: sharedFields,
            score,
            origin: 'shared-neighborhood'
        });
    }

    return candidates
        .sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId))
        .slice(0, options.connectionLimit || 3)
        .map((candidate) => ({
            candidateId: candidate.candidateId,
            candidateType: candidate.candidateType,
            candidateRole: candidate.candidateRole,
            field: candidate.matchedFields[0] || 'related',
            queryField: candidate.matchedFields[0] || 'related',
            relatedId: candidate.sharedTargets[0],
            relatedType: String(fieldsCache.get(candidate.sharedTargets[0])?.type || '').trim().toLowerCase(),
            origin: candidate.origin,
            score: candidate.score,
            summary: candidate.sharedTargets.length >= 2
                ? `${candidate.candidateId} fits the same flow through ${candidate.sharedTargets.slice(0, 2).join(' and ')}`
                : `${candidate.candidateId} fits the same flow through ${candidate.sharedTargets[0]}`,
            detail: candidate.matchedFields.length
                ? `${candidate.candidateId} shares ${candidate.sharedTargets.length} nearby connection${candidate.sharedTargets.length === 1 ? '' : 's'} and uses ${candidate.matchedFields[0]} too`
                : `${candidate.candidateId} shares ${candidate.sharedTargets.length} nearby connection${candidate.sharedTargets.length === 1 ? '' : 's'} with this note`,
            trail: `${candidate.candidateId} shares ${naturalList(candidate.sharedTargets.slice(0, 2))} with this note`,
            insertField: pickConnectionField(nodeFields),
            insertText: `${pickConnectionField(nodeFields)}: [[${candidate.candidateId}]]\n`
        }));
}

/**
 * Turns affinity connections into ready-to-insert !view query hints.
 * @param {object[]} [likelyConnections]
 * @param {{ getDefaultSortField?: (type: string) => string }} [options]
 * @returns {object[]}
 */
function buildRelationViewHints(likelyConnections = [], options = {}) {
    const sortResolver = options.getDefaultSortField || (() => '');
    const seen = new Set();
    const hints = [];

    for (const connection of likelyConnections) {
        const sourceType = String(connection.candidateType || '').trim().toLowerCase();
        const field = String(connection.queryField || connection.field || '').trim();
        const relatedId = String(connection.relatedId || '').trim();
        if (!sourceType || !field || !relatedId) continue;

        const key = `${sourceType}\x00${field}\x00${relatedId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        let queryText = `!view ${sourceType}\nwhere ${field} = [[${relatedId}]]`;
        const sortField = String(sortResolver(sourceType) || '').trim();
        if (sortField) queryText += `\nsort ${sortField} desc`;

        const relatedType = String(connection.relatedType || '').trim().toLowerCase();
        const roleLead = connection.candidateRole && connection.candidateRole !== 'record'
            ? `${connection.candidateRole} notes`
            : `${sourceType} notes`;
        const originLead = connection.origin === 'shared-neighborhood'
            ? 'shared workflow context'
            : 'shared context';

        hints.push({
            sourceType,
            field,
            relatedId,
            relatedType,
            score: Number(connection.score || 0),
            title: `${roleLead} around ${relatedId}`,
            description: `${roleLead} often move together around ${relatedId} through ${field} (${originLead})`,
            queryText,
            summary: `${roleLead} often cluster around ${relatedId}`,
            detail: connection.detail || connection.summary || ''
        });
    }

    return hints.sort((a, b) =>
        (b.score - a.score) ||
        a.sourceType.localeCompare(b.sourceType) ||
        a.relatedId.localeCompare(b.relatedId)
    );
}

module.exports = {
    buildAffinityConnections,
    buildRelationViewHints
};
