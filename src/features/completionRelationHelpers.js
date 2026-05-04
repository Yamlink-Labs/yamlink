'use strict';

const { getRegistry } = require('../registries/typeRegistry');
const { getFieldsCache } = require('../core/indexService');
const { inferFieldRole } = require('../intelligence/fieldRoles');
const { buildFieldFamilyRelationModel } = require('../intelligence/frontmatterIntelligence');
const { buildObservedFields } = require('../intelligence/suggestionCore');
const {
    normalizeFrontmatterKey,
    isPositionInFrontmatter,
    getDocumentType,
    buildDocumentIntelligence,
    fieldLooksRelational,
    summariseInferenceReasons
} = require('./completionContextHelpers');

function buildRelationCandidateDetail(id, idIndex, frontmatterRelation, preferred) {
    const reasonText = frontmatterRelation.reasonText || '';
    const observedText = frontmatterRelation.observedPreferredIds?.includes(id)
        ? (frontmatterRelation.observedReasonText || 'similar notes already connect here')
        : '';
    const learnedText = frontmatterRelation.observedPreferredIds?.includes(id) && frontmatterRelation.learnedSummary
        ? frontmatterRelation.learnedSummary
        : '';
    const localText = frontmatterRelation.localLinkedIds?.includes(id)
        ? 'already referenced in this note'
        : '';
    if (frontmatterRelation.targetType) {
        const base = preferred
            ? `${frontmatterRelation.targetType} relation (preferred match)`
            : `${idIndex.get(id) || 'Yamlink node'} (outside suggested ${frontmatterRelation.targetType} target)`;
        const detail = [base, localText, observedText, learnedText, reasonText].filter(Boolean).join(' · ');
        return detail || base;
    }
    const base = idIndex.get(id) || 'Yamlink node';
    return [base, localText, observedText, learnedText, reasonText].filter(Boolean).join(' · ');
}

function collectLocalLinkedIds(document, idIndex) {
    const text = document.getText();
    const ids = [];
    const regex = /\[\[([^\]|#\^]+)(?:[#\^][^\]|]+)?(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const id = String(match[1] || '').trim().toLowerCase();
        if (!id || !idIndex.has(id)) continue;
        ids.push(id);
    }
    return [...new Set(ids)];
}

function collectObservedRelationUsage(fieldName, document, docType, idIndex) {
    const fieldsCache = getFieldsCache();
    const intelligence = buildDocumentIntelligence(document, docType, idIndex);
    const observedFields = buildObservedFields(fieldsCache);
    const learned = buildFieldFamilyRelationModel(fieldName, intelligence.nodeFields, intelligence, fieldsCache, {
        nodeType: docType,
        observedFields
    });
    const idScores = new Map();
    const targetTypeScores = new Map();
    for (const [targetId, score] of learned.targetScores.entries()) {
        if (!idIndex.has(targetId)) continue;
        idScores.set(targetId, score);
        const targetType = String(fieldsCache.get(targetId)?.type || '').trim().toLowerCase();
        if (targetType) {
            targetTypeScores.set(targetType, (targetTypeScores.get(targetType) || 0) + score);
        }
    }
    const learnedTargetType = Array.from(targetTypeScores.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([type]) => type)[0] || null;

    return {
        preferredIds: Array.from(idScores.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 8)
            .map(([id]) => id),
        idScores,
        supportingNotes: learned.supportingNotes,
        family: learned.family,
        learnedField: learned.field,
        learnedVariants: learned.variants,
        learnedSummary: learned.summary,
        learnedReasonText: learned.reasonText,
        learnedTargetType
    };
}

function resolveFrontmatterRelationCandidates(document, position, idIndex) {
    if (!isPositionInFrontmatter(document, position.line)) return null;

    const line = document.lineAt(position.line).text;
    const before = line.substring(0, position.character);
    const textAfterCursor = line.substring(position.character);
    const match = before.match(/^\s*([\w-]+):\s*(\[\[)?([^\]]*)$/);
    if (!match) {
        const fallbackMatch = before.match(/^\s*([^:\n]+):\s*(\[\[)?([^\]]*)$/);
        if (!fallbackMatch) return null;
        return resolveFrontmatterRelationCandidatesFromMatch(document, position, idIndex, line, textAfterCursor, fallbackMatch);
    }
    return resolveFrontmatterRelationCandidatesFromMatch(document, position, idIndex, line, textAfterCursor, match);
}

function resolveFrontmatterRelationCandidatesFromMatch(document, position, idIndex, line, textAfterCursor, match) {
    if (!match) return null;

    const fieldName = normalizeFrontmatterKey(match[1]);
    const hasWiki = !!match[2];
    const partial = (match[3] || '').trim();
    const relationState = fieldLooksRelational(fieldName, document, idIndex);
    const docType = getDocumentType(document);
    const observedUsage = collectObservedRelationUsage(fieldName, document, docType, idIndex);
    if (!hasWiki && !relationState.relational && !observedUsage.preferredIds.length) return null;

    const candidateIds = Array.from(idIndex.keys());
    const localLinkedIds = collectLocalLinkedIds(document, idIndex);
    let preferredIds = [];
    if (relationState.targetType) {
        const typeNodes = getRegistry().get(relationState.targetType) ?? new Set();
        preferredIds = candidateIds.filter(id => typeNodes.has(id));
    }
    if (!preferredIds.length && observedUsage.learnedTargetType) {
        const typeNodes = getRegistry().get(observedUsage.learnedTargetType) ?? new Set();
        preferredIds = candidateIds.filter(id => typeNodes.has(id));
    }

    return {
        fieldName,
        partial,
        hasWiki,
        hasClosing: hasWiki && textAfterCursor.startsWith(']]'),
        candidateIds,
        preferredIds,
        observedPreferredIds: observedUsage.preferredIds,
        observedIdScores: observedUsage.idScores,
        localLinkedIds,
        targetType: relationState.targetType || observedUsage.learnedTargetType,
        reasonText: summariseInferenceReasons(relationState.reasons),
        observedReasonText: observedUsage.supportingNotes
            ? (observedUsage.family && observedUsage.learnedField && observedUsage.learnedField !== fieldName
                ? `similar notes often use ${fieldName} like ${observedUsage.learnedField}`
                : `similar notes often use ${fieldName} this way`)
            : ''
    };
}

function resolveQueryRelationCandidates(fieldName, queryType, partial, idIndex, options = {}) {
    const normalizedType = String(queryType || '').trim().toLowerCase();
    const relationState = inferFieldRole(fieldName, {
        documentType: normalizedType && normalizedType !== '*' ? normalizedType : '',
        idIndex
    });
    const observedUsage = options.document
        ? collectObservedRelationUsage(fieldName, options.document, normalizedType && normalizedType !== '*' ? normalizedType : '', idIndex)
        : { preferredIds: [], idScores: new Map(), supportingNotes: 0, learnedTargetType: null };
    if (!relationState.relational && !observedUsage.preferredIds.length) return null;

    const candidateIds = Array.from(idIndex.keys());
    let preferredIds = [];
    if (relationState.targetType) {
        const typeNodes = getRegistry().get(relationState.targetType) ?? new Set();
        preferredIds = candidateIds.filter(id => typeNodes.has(id));
    }
    if (!preferredIds.length && observedUsage.learnedTargetType) {
        const typeNodes = getRegistry().get(observedUsage.learnedTargetType) ?? new Set();
        preferredIds = candidateIds.filter(id => typeNodes.has(id));
    }

    return {
        fieldName,
        partial,
        candidateIds,
        preferredIds,
        observedPreferredIds: observedUsage.preferredIds,
        observedIdScores: observedUsage.idScores,
        localLinkedIds: options.localLinkedIds || [],
        targetType: relationState.targetType || observedUsage.learnedTargetType,
        reasonText: summariseInferenceReasons(relationState.reasons),
        observedReasonText: observedUsage.supportingNotes
            ? (observedUsage.family && observedUsage.learnedField && observedUsage.learnedField !== fieldName
                ? `similar ${fieldName} links already appear through ${observedUsage.learnedField}`
                : `similar ${fieldName} links already appear in the vault`)
            : ''
    };
}

function getViewBlockContext(document, position) {
    const lines = document.getText().split('\n');
    let start = position.line;
    while (start >= 0) {
        const t = lines[start].trim();
        if (t.startsWith('!view ')) break;
        if (!t || (!/^(select|where|sort|limit|via)\b/i.test(t) && start !== position.line)) return null;
        start--;
    }
    if (start < 0 || !lines[start].trim().startsWith('!view ')) return null;

    const block = [lines[start]];
    let end = start + 1;
    while (end < lines.length) {
        const t = lines[end].trim();
        if (!t) break;
        if (t.startsWith('!view ')) break;
        if (/^(select|where|sort|limit|via)\b/i.test(t)) {
            block.push(lines[end]);
            end++;
        } else {
            break;
        }
    }

    const first = lines[start].trim();
    const rest = first.slice(6).trim();
    const typeMatch = rest.match(/^([\w*-]+)/);
    const queryType = typeMatch ? typeMatch[1].toLowerCase() : null;

    return { start, end, lines: block, queryType, currentLine: lines[position.line] };
}

function collectFieldsForType(type) {
    const fieldsCache = getFieldsCache();
    const fields = new Set();
    for (const value of fieldsCache.values()) {
        const nodeType = (value.type || '').trim().toLowerCase();
        if (type !== '*' && type !== 'tasks' && nodeType !== type) continue;
        for (const key of Object.keys(value)) {
            if (key !== 'id') fields.add(key.toLowerCase());
        }
    }
    if (type === 'tasks') ['text', 'done', 'date', 'file', 'line'].forEach(f => fields.add(f));
    return Array.from(fields).sort();
}

function inferRelationField(fieldName, queryType) {
    if (queryType === 'tasks') return false;
    const fieldsCache = getFieldsCache();
    let relationHits = 0;
    let scalarHits = 0;
    for (const value of fieldsCache.values()) {
        const nodeType = (value.type || '').trim().toLowerCase();
        if (queryType && queryType !== '*' && nodeType !== queryType) continue;
        const raw = String(value[fieldName] ?? '');
        if (!raw) continue;
        if (/\[\[[^\]]+\]\]/.test(raw)) relationHits++;
        else scalarHits++;
    }
    return relationHits > 0 && relationHits >= scalarHits;
}

function collectScalarValues(fieldName, queryType) {
    const fieldsCache = getFieldsCache();
    const values = new Map();
    for (const value of fieldsCache.values()) {
        const nodeType = (value.type || '').trim().toLowerCase();
        if (queryType && queryType !== '*' && nodeType !== queryType) continue;
        const raw = String(value[fieldName] ?? '').trim();
        if (!raw || /\[\[[^\]]+\]\]/.test(raw)) continue;
        values.set(raw.toLowerCase(), raw);
    }
    return Array.from(values.values()).sort();
}

function scoreCandidateMatch(value, partial) {
    const candidate = String(value || '').toLowerCase();
    const query = String(partial || '').trim().toLowerCase();
    if (!query) return 500;
    if (candidate === query) return 1000;
    if (candidate.startsWith(query)) return 800 - candidate.length;
    if (candidate.includes(query)) return 600 - candidate.indexOf(query);

    let matched = 0;
    let cursor = 0;
    for (const ch of query) {
        const idx = candidate.indexOf(ch, cursor);
        if (idx === -1) return -1;
        matched++;
        cursor = idx + 1;
    }
    return matched === query.length ? 300 - candidate.length : -1;
}

function scoreFieldSuggestion(entry, partialKey) {
    const matchScore = scoreCandidateMatch(entry.key, partialKey);
    if (matchScore < 0) return -1;
    return entry.sortScore + matchScore;
}

function rankCandidateIds(candidateIds, partial, preferredIds = [], localLinkedIds = [], observedIdScores = new Map()) {
    const preferred = new Set(preferredIds);
    const local = new Set(localLinkedIds);
    return candidateIds
        .map(id => {
            const matchScore = scoreCandidateMatch(id, partial);
            return {
                id,
                score: matchScore >= 0
                    ? matchScore + (preferred.has(id) ? 1000 : 0) + (local.has(id) ? 150 : 0) + Math.min(500, observedIdScores.get(id) || 0)
                    : matchScore,
                preferred: preferred.has(id),
                local: local.has(id)
            };
        })
        .filter(entry => entry.score >= 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .map(entry => entry.id);
}

module.exports = {
    buildRelationCandidateDetail,
    collectLocalLinkedIds,
    collectObservedRelationUsage,
    resolveFrontmatterRelationCandidates,
    resolveFrontmatterRelationCandidatesFromMatch,
    resolveQueryRelationCandidates,
    getViewBlockContext,
    collectFieldsForType,
    inferRelationField,
    collectScalarValues,
    scoreCandidateMatch,
    scoreFieldSuggestion,
    rankCandidateIds
};
