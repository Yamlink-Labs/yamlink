'use strict';

const { getRegistry } = require('../registries/typeRegistry');
const { getFieldsCache, getVaultGeneration } = require('../core/indexService');
const { inferFieldRole } = require('../intelligence/fieldRoles');
const { buildFieldFamilyRelationModel } = require('../intelligence/frontmatterIntelligence');
const { buildObservedFields } = require('../intelligence/suggestionCore');
const { getCachedPriors, inferLikelyTypesForNote } = require('../intelligence/vaultPriors');
const {
    normalizeFrontmatterKey,
    isPositionInFrontmatter,
    isTypeLikeField,
    getDocumentType,
    buildDocumentIntelligence,
    fieldLooksRelational,
    summariseInferenceReasons
} = require('./completionContextHelpers');

/** @param {string} id @returns {string|null} */
function getHumanLabel(id) {
    const fieldsCache = getFieldsCache();
    const fields = fieldsCache.get(String(id || '').trim().toLowerCase());
    if (!fields) return null;
    const raw = fields.name || fields.title || fields.label || null;
    if (!raw || typeof raw !== 'string') return null;
    return raw.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target).trim() || null;
}

function buildRelationCandidateDetail(id, _idIndex, frontmatterRelation, preferred) {
    const fieldsCache = getFieldsCache();
    const noteType = String(fieldsCache.get(String(id || '').trim().toLowerCase())?.type || '').trim();
    const parts = [];
    if (noteType) parts.push(noteType);
    if (!preferred && frontmatterRelation.targetType && noteType !== frontmatterRelation.targetType) {
        parts.push(`expected: ${frontmatterRelation.targetType}`);
    }
    if (frontmatterRelation.localLinkedIds?.includes(id)) {
        parts.push('already linked');
    }
    if (frontmatterRelation.observedPreferredIds?.includes(id)) {
        parts.push(frontmatterRelation.observedReasonText || 'commonly linked here');
    }
    return parts.filter(Boolean).join(' · ') || 'Yamlink note';
}

/** @param {any[]|null|undefined} candidateIds @param {Map<string,string>|null} [idIndex] @returns {string[]} */
function canonicalizeCandidateIds(candidateIds, idIndex = null) {
    const seen = new Set();
    const resolved = [];
    for (const rawId of candidateIds || []) {
        const trimmed = String(rawId || '').trim();
        if (!trimmed) continue;
        const canonical = trimmed.toLowerCase();
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        resolved.push(idIndex?.has(canonical) ? canonical : trimmed);
    }
    return resolved;
}

function collectIdsForType(candidateIds, targetType) {
    if (!targetType) return [];
    const normalizedType = String(targetType || '').trim().toLowerCase();
    const registryIds = getRegistry().get(normalizedType) ?? new Set();
    const registryMatches = canonicalizeCandidateIds(candidateIds).filter((id) => registryIds.has(String(id || '').trim().toLowerCase()));
    if (registryMatches.length) return registryMatches;

    const fieldsCache = getFieldsCache();
    return canonicalizeCandidateIds(candidateIds).filter((id) => String(fieldsCache.get(String(id || '').trim().toLowerCase())?.type || '').trim().toLowerCase() === normalizedType);
}

/** @param {import('vscode').TextDocument} document @param {Map<string,string>} idIndex @returns {string[]} */
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
        learnedTargetType,
        nodeFields: intelligence.nodeFields || {}
    };
}

const _FAMILY_WIKILINK_RE = /^\[\[([^\]|#]+)/;

function buildRelationRankingHints(fieldName, targetType, preferredIds = [], observedPreferredIds = [], noteFields = null) {
    const fieldsCache = getFieldsCache();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const fieldKey = normalizeFrontmatterKey(fieldName);
    const ambiguity = priors.fieldAmbiguity.get(fieldKey) || null;
    const typeCounts = priors.fieldTargetTypes.get(fieldKey) || null;
    const candidateTypeScores = new Map();
    let familyHint = null;

    if (typeCounts && typeCounts.size) {
        const total = Array.from(typeCounts.values()).reduce((sum, count) => sum + count, 0);
        for (const [type, count] of typeCounts.entries()) {
            if (!total) continue;
            candidateTypeScores.set(String(type || '').trim().toLowerCase(), count / total);
        }
    } else if (targetType) {
        candidateTypeScores.set(String(targetType || '').trim().toLowerCase(), 1);
    } else if (noteFields && Object.keys(noteFields).length > 0) {
        // No vault-wide signal and no schema target — infer the note's family from its
        // existing fields, then scan that family's notes for any wikilinks in this field.
        const likelyTypes = inferLikelyTypesForNote(
            noteFields, fieldsCache, priors.typeFieldBundles, priors.noteRoleTypePriors,
            null, { limit: 1, minScore: 0.50 }
        );
        if (likelyTypes.length > 0) {
            const inferredNoteType = likelyTypes[0].noteType;
            const linkTypeCounts = new Map();
            let linkTotal = 0;
            for (const [, noteFieldData] of fieldsCache) {
                const noteType = String(noteFieldData?.type || '').trim().toLowerCase();
                if (noteType !== inferredNoteType) continue;
                const rawValue = noteFieldData[fieldKey];
                if (!rawValue) continue;
                const values = Array.isArray(rawValue) ? rawValue : [rawValue];
                for (const v of values) {
                    const m = _FAMILY_WIKILINK_RE.exec(String(v || '').trim());
                    if (!m) continue;
                    const targetId = m[1].trim().toLowerCase();
                    const targetType2 = String(fieldsCache.get(targetId)?.type || '').trim().toLowerCase();
                    if (!targetType2) continue;
                    linkTypeCounts.set(targetType2, (linkTypeCounts.get(targetType2) || 0) + 1);
                    linkTotal++;
                }
            }
            if (linkTotal > 0) {
                for (const [type, count] of linkTypeCounts.entries()) {
                    candidateTypeScores.set(type, (count / linkTotal) * 0.7);
                }
                const topEntry = Array.from(linkTypeCounts.entries()).sort((a, b) => b[1] - a[1])[0];
                if (topEntry) {
                    familyHint = `${inferredNoteType} notes usually link ${fieldKey} to ${topEntry[0]} notes`;
                }
            }
        }
    }

    return {
        fieldName: fieldKey,
        targetType: String(targetType || '').trim().toLowerCase(),
        ambiguity,
        candidateTypeScores,
        familyHint,
        observedPreferredIds: canonicalizeCandidateIds(observedPreferredIds),
        preferredIds: canonicalizeCandidateIds(preferredIds)
    };
}

/** @param {import('vscode').TextDocument} document @param {import('vscode').Position} position @param {Map<string,string>} idIndex @returns {Record<string,any>|null} */
function resolveFrontmatterRelationCandidates(document, position, idIndex) {
    if (!isPositionInFrontmatter(document, position.line)) return null;

    const line = document.lineAt(position.line).text;
    const before = line.substring(0, position.character);
    const textAfterCursor = line.substring(position.character);
    const match = before.match(/^\s*([\w-]+):\s*(\[\[?)*([^\]]*)$/);
    if (!match) {
        const fallbackMatch = before.match(/^\s*([^:\n]+):\s*(\[\[?)*([^\]]*)$/);
        if (!fallbackMatch) return null;
        return resolveFrontmatterRelationCandidatesFromMatch(document, position, idIndex, line, textAfterCursor, fallbackMatch);
    }
    return resolveFrontmatterRelationCandidatesFromMatch(document, position, idIndex, line, textAfterCursor, match);
}

function resolveFrontmatterRelationCandidatesFromMatch(document, position, idIndex, line, textAfterCursor, match) {
    if (!match) return null;

    const fieldName = normalizeFrontmatterKey(match[1]);
    if (isTypeLikeField(fieldName)) return null;
    const wikiPrefix = match[2] || '';
    const hasWiki = wikiPrefix.length > 0;
    const partial = (match[3] || '').trim();
    const relationState = fieldLooksRelational(fieldName, document, idIndex);
    const docType = getDocumentType(document);
    const observedUsage = collectObservedRelationUsage(fieldName, document, docType, idIndex);
    if (!hasWiki && !relationState.relational && !observedUsage.preferredIds.length) return null;

    const allCandidateIds = canonicalizeCandidateIds(Array.from(idIndex.keys()), idIndex);
    const localLinkedIds = canonicalizeCandidateIds(collectLocalLinkedIds(document, idIndex), idIndex);
    let preferredIds = [];
    if (relationState.targetType) {
        preferredIds = collectIdsForType(allCandidateIds, relationState.targetType);
    }
    if (!preferredIds.length && observedUsage.learnedTargetType) {
        preferredIds = collectIdsForType(allCandidateIds, observedUsage.learnedTargetType);
    }
    const targetType = relationState.targetType || observedUsage.learnedTargetType;
    const candidateIds = allCandidateIds;

    return {
        fieldName,
        partial,
        hasWiki,
        wikiPrefixLength: wikiPrefix.length,
        closingLength: hasWiki
            ? (textAfterCursor.startsWith(']]') ? 2 : (textAfterCursor.startsWith(']') ? 1 : 0))
            : 0,
        candidateIds,
        preferredIds: canonicalizeCandidateIds(preferredIds, idIndex),
        observedPreferredIds: canonicalizeCandidateIds(observedUsage.preferredIds, idIndex),
        observedIdScores: observedUsage.idScores,
        localLinkedIds,
        targetType,
        missingTargetType: !!targetType && preferredIds.length === 0,
        reasonText: summariseInferenceReasons(relationState.reasons),
        observedReasonText: observedUsage.supportingNotes
            ? (observedUsage.family && observedUsage.learnedField && observedUsage.learnedField !== fieldName
                ? `similar notes often use ${fieldName} like ${observedUsage.learnedField}`
                : `similar notes often use ${fieldName} this way`)
            : '',
        rankingHints: buildRelationRankingHints(fieldName, targetType, preferredIds, observedUsage.preferredIds, observedUsage.nodeFields)
    };
}

/** @param {string} fieldName @param {string|null} queryType @param {string} partial @param {Map<string,string>} idIndex @param {Record<string,any>} [options] @returns {Record<string,any>|null} */
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

    const candidateIds = canonicalizeCandidateIds(Array.from(idIndex.keys()), idIndex);
    let preferredIds = [];
    if (relationState.targetType) {
        preferredIds = collectIdsForType(candidateIds, relationState.targetType);
    }
    if (!preferredIds.length && observedUsage.learnedTargetType) {
        preferredIds = collectIdsForType(candidateIds, observedUsage.learnedTargetType);
    }

    return {
        fieldName,
        partial,
        candidateIds,
        preferredIds: canonicalizeCandidateIds(preferredIds, idIndex),
        observedPreferredIds: canonicalizeCandidateIds(observedUsage.preferredIds, idIndex),
        observedIdScores: observedUsage.idScores,
        localLinkedIds: canonicalizeCandidateIds(options.localLinkedIds || [], idIndex),
        targetType: relationState.targetType || observedUsage.learnedTargetType,
        missingTargetType: !!(relationState.targetType || observedUsage.learnedTargetType) && preferredIds.length === 0,
        reasonText: summariseInferenceReasons(relationState.reasons),
        observedReasonText: observedUsage.supportingNotes
            ? (observedUsage.family && observedUsage.learnedField && observedUsage.learnedField !== fieldName
                ? `similar ${fieldName} links already appear through ${observedUsage.learnedField}`
                : `similar ${fieldName} links already appear in the vault`)
            : '',
        rankingHints: buildRelationRankingHints(fieldName, relationState.targetType || observedUsage.learnedTargetType, preferredIds, observedUsage.preferredIds)
    };
}

/** @param {import('vscode').TextDocument} document @param {import('vscode').Position} position @returns {Record<string,any>|null} */
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

/** @param {string} type @returns {string[]} */
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

/** @param {string} value @param {string} partial @returns {number} */
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

/** @param {string[]} candidateIds @param {string} partial @param {string[]} [preferredIds] @param {string[]} [localLinkedIds] @param {Map<string,number>} [observedIdScores] @param {Record<string,any>|null} [rankingHints] @returns {string[]} */
function rankCandidateIds(candidateIds, partial, preferredIds = [], localLinkedIds = [], observedIdScores = new Map(), rankingHints = null) {
    const normalizedCandidates = canonicalizeCandidateIds(candidateIds);
    const preferred = new Set(canonicalizeCandidateIds(preferredIds).map((id) => String(id || '').trim().toLowerCase()));
    const local = new Set(canonicalizeCandidateIds(localLinkedIds).map((id) => String(id || '').trim().toLowerCase()));
    const observedPreferred = new Set(canonicalizeCandidateIds(rankingHints?.observedPreferredIds || []).map((id) => String(id || '').trim().toLowerCase()));
    const candidateTypeScores = rankingHints?.candidateTypeScores instanceof Map ? rankingHints.candidateTypeScores : new Map();
    const ambiguity = rankingHints?.ambiguity || null;
    const relationBiasScale = ambiguity
        ? (ambiguity.linkRatio >= 0.75 ? 1.0 : ambiguity.linkRatio >= 0.5 ? 0.75 : 0.45)
        : 0.8;
    const fieldsCache = getFieldsCache();
    return normalizedCandidates
        .map(id => {
            const canonicalId = String(id || '').trim().toLowerCase();
            const candidateType = String(fieldsCache.get(canonicalId)?.type || '').trim().toLowerCase();
            const matchScore = scoreCandidateMatch(id, partial);
            const candidateTypeScore = candidateType ? (candidateTypeScores.get(candidateType) || 0) : 0;
            const typeBias = Math.round(candidateTypeScore * 260 * relationBiasScale);
            const observedBias = observedPreferred.has(canonicalId) ? 220 : 0;
            return {
                id,
                score: matchScore >= 0
                    ? matchScore
                        + (preferred.has(canonicalId) ? 1000 : 0)
                        + (local.has(canonicalId) ? 150 : 0)
                        + observedBias
                        + typeBias
                        + Math.min(500, observedIdScores.get(canonicalId) || observedIdScores.get(id) || 0)
                    : matchScore,
                preferred: preferred.has(canonicalId),
                local: local.has(canonicalId)
            };
        })
        .filter(entry => entry.score >= 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .map(entry => entry.id);
}

module.exports = {
    getHumanLabel,
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
    rankCandidateIds,
    canonicalizeCandidateIds
};
