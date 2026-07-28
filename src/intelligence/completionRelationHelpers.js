'use strict';

const { getRegistry } = require('../registries/typeRegistry');
const { getFieldsCache, getVaultGeneration } = require('../core/indexService');
const { getBacklinks, getEdges } = require('../core/graph');
const { resolveYamlFieldNameForLine } = require('../core/frontmatter');
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

/**
 * Duck-typed document contract shared by VS Code and the LSP server — only
 * needs getText()/.uri.fsPath (lineAt() when line-level context is used), not
 * the full vscode.TextDocument surface. See CLAUDE.md's completion helpers note.
 * @typedef {{ getText: () => string, lineAt?: (n: number) => {text: string}, uri?: {fsPath?: string} }} DocumentLike
 * @typedef {{ line: number, character: number }} PositionLike
 */

/** @param {string} id @returns {string|null} */
function getHumanLabel(id) {
    const fieldsCache = getFieldsCache();
    const fields = fieldsCache.get(String(id || '').trim().toLowerCase());
    if (!fields) return null;
    const raw = fields.name || fields.title || fields.label || null;
    if (!raw || typeof raw !== 'string') return null;
    return raw.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target).trim() || null;
}

/**
 * Structured evidence for a relation candidate — the note type plus every
 * reason it's ranked where it is. Kept separate from `item.detail` (VS
 * Code's single-line, non-wrapping grey text) specifically so this evidence
 * can be rendered as a real multi-line documentation card instead of being
 * crammed into one line until it wraps mid-word.
 * @param {string} id @param {Record<string,any>} frontmatterRelation @param {boolean} preferred
 * @returns {{ noteType: string, reasons: string[] }}
 */
function buildRelationCandidateEvidence(id, frontmatterRelation, preferred) {
    const fieldsCache = getFieldsCache();
    const noteType = String(fieldsCache.get(String(id || '').trim().toLowerCase())?.type || '').trim();
    const reasons = [];
    if (!preferred && frontmatterRelation.targetType && noteType !== frontmatterRelation.targetType) {
        reasons.push(`Expected type: **${frontmatterRelation.targetType}**`);
    }
    if (frontmatterRelation.localLinkedIds?.includes(id)) {
        reasons.push('Already linked in this note');
    }
    if (frontmatterRelation.observedPreferredIds?.includes(id)) {
        reasons.push(frontmatterRelation.observedReasonText || 'Commonly linked here');
    }
    return { noteType, reasons };
}

function buildRelationCandidateDetail(id, _idIndex, frontmatterRelation, preferred) {
    const fieldsCache = getFieldsCache();
    const noteType = String(fieldsCache.get(String(id || '').trim().toLowerCase())?.type || '').trim();
    if (!preferred && frontmatterRelation.targetType && noteType !== frontmatterRelation.targetType) {
        return noteType ? `${noteType} · expected: ${frontmatterRelation.targetType}` : `expected: ${frontmatterRelation.targetType}`;
    }
    return noteType || 'Yamlink note';
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

/** @param {DocumentLike} document @param {Map<string,string>} idIndex @returns {string[]} */
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

const _SIBLING_WIKILINK_RE = /^\[\[([^\]|#]+)/;

/**
 * Structural autocomplete, part 1 — sibling-field context. If the current
 * note already has another relation field filled in (e.g. `account:
 * [[enotria]]` on a meeting note), candidates already connected to that same
 * value are genuinely more likely to be right for the field being completed
 * now (e.g. `contacts:`) than an arbitrary candidate — they're already known
 * to be associated with something this note is already about. Only ever
 * looks at fields that are ALREADY filled in; a note with nothing else set
 * yet produces no boost at all (honest silence, not a guess).
 * @param {Record<string,any>|null} noteFields - the current note's own frontmatter fields
 * @param {string} excludeFieldName - the field currently being completed
 * @returns {{ ids: Set<string>, evidenceByTargetId: Map<string,string> }}
 */
function computeSiblingContextIds(noteFields, excludeFieldName) {
    const ids = new Set();
    const evidenceByTargetId = new Map();
    if (!noteFields || typeof noteFields !== 'object') return { ids, evidenceByTargetId };

    const excludeKey = normalizeFrontmatterKey(excludeFieldName);
    for (const [siblingField, rawValue] of Object.entries(noteFields)) {
        const normalizedField = normalizeFrontmatterKey(siblingField);
        if (!normalizedField || normalizedField === excludeKey || normalizedField === 'id' || normalizedField === 'type') continue;

        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        for (const v of values) {
            const match = _SIBLING_WIKILINK_RE.exec(String(v || '').trim());
            if (!match) continue;
            const siblingTargetId = match[1].trim().toLowerCase();
            if (!siblingTargetId) continue;

            for (const edge of getBacklinks(siblingTargetId) || []) {
                if (!edge?.sourceId) continue;
                ids.add(edge.sourceId);
                if (!evidenceByTargetId.has(edge.sourceId)) evidenceByTargetId.set(edge.sourceId, siblingTargetId);
            }
            for (const edge of getEdges(siblingTargetId) || []) {
                if (!edge?.targetId) continue;
                ids.add(edge.targetId);
                if (!evidenceByTargetId.has(edge.targetId)) evidenceByTargetId.set(edge.targetId, siblingTargetId);
            }
        }
    }
    return { ids, evidenceByTargetId };
}

const _FAMILY_WIKILINK_RE = /^\[\[([^\]|#]+)/;

function normalizeWeightedMap(weightMap, scale = 1) {
    if (!(weightMap instanceof Map) || !weightMap.size) return new Map();
    const total = Array.from(weightMap.values()).reduce((sum, value) => sum + value, 0);
    if (!total) return new Map();
    return new Map(
        Array.from(weightMap.entries()).map(([key, value]) => [
            String(key || '').trim().toLowerCase(),
            (value / total) * scale
        ])
    );
}

function mergeMaxScores(targetMap, sourceMap) {
    if (!(sourceMap instanceof Map)) return;
    for (const [key, value] of sourceMap.entries()) {
        if (!key || typeof value !== 'number' || value <= 0) continue;
        targetMap.set(key, Math.max(targetMap.get(key) || 0, value));
    }
}

function buildRelationRankingHints(fieldName, targetType, preferredIds = [], observedPreferredIds = [], noteFields = null) {
    const fieldsCache = getFieldsCache();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const fieldKey = normalizeFrontmatterKey(fieldName);
    const siblingContext = computeSiblingContextIds(noteFields, fieldKey);
    const ambiguity = priors.fieldAmbiguity.get(fieldKey) || null;
    const typeCounts = priors.fieldTargetTypes.get(fieldKey) || null;
    const candidateTypeScores = new Map();
    let familyHint = null;
    let behaviorHint = null;
    let effectiveNoteType = String(noteFields?.type || '').trim().toLowerCase() || null;

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
            effectiveNoteType = effectiveNoteType || inferredNoteType;
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

    if (!effectiveNoteType && noteFields && Object.keys(noteFields).length > 0) {
        const likelyTypes = inferLikelyTypesForNote(
            noteFields, fieldsCache, priors.typeFieldBundles, priors.noteRoleTypePriors,
            null, { limit: 1, minScore: 0.45 }
        );
        effectiveNoteType = likelyTypes[0]?.noteType || null;
    }

    const behavioral = priors.behavioralRelationPriors || null;
    const behavioralTypeScores = normalizeWeightedMap(
        behavioral?.noteTypeFieldTargetTypeScores?.get(effectiveNoteType || '')?.get(fieldKey)
        || behavioral?.fieldTargetTypeScores?.get(fieldKey)
        || null,
        effectiveNoteType ? 0.92 : 0.78
    );
    if (behavioralTypeScores.size) {
        mergeMaxScores(candidateTypeScores, behavioralTypeScores);
        const topEntry = Array.from(behavioralTypeScores.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
        if (topEntry) {
            behaviorHint = effectiveNoteType
                ? `recent ${effectiveNoteType} modeling favors ${fieldKey} → ${topEntry[0]}`
                : `recent vault modeling favors ${fieldKey} → ${topEntry[0]}`;
        }
    }

    const behavioralPreferredIds = canonicalizeCandidateIds(
        Array.from(
            Array.from(
                (
                    behavioral?.noteTypeFieldTargetIdScores?.get(effectiveNoteType || '')?.get(fieldKey)
                    || behavioral?.fieldTargetIdScores?.get(fieldKey)
                    || new Map()
                ).entries()
            )
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .slice(0, 6)
                .map(([id]) => id)
        )
    );

    return {
        fieldName: fieldKey,
        targetType: String(targetType || '').trim().toLowerCase(),
        ambiguity,
        candidateTypeScores,
        familyHint,
        behaviorHint,
        behavioralPreferredIds,
        observedPreferredIds: canonicalizeCandidateIds(observedPreferredIds),
        preferredIds: canonicalizeCandidateIds(preferredIds),
        siblingContextIds: siblingContext.ids,
        siblingContextEvidence: siblingContext.evidenceByTargetId
    };
}

/** @param {DocumentLike} document @param {PositionLike} position @param {Map<string,string>} idIndex @returns {Record<string,any>|null} */
function resolveFrontmatterRelationCandidates(document, position, idIndex) {
    if (!isPositionInFrontmatter(document, position.line)) return null;

    const line = document.lineAt(position.line).text;
    const before = line.substring(0, position.character);
    const textAfterCursor = line.substring(position.character);
    const match = before.match(/^\s*([\w-]+):\s*(\[\[?)*([^\]]*)$/);
    if (match) {
        return resolveFrontmatterRelationCandidatesFromMatch(document, position, idIndex, line, textAfterCursor, match);
    }

    const fallbackMatch = before.match(/^\s*([^:\n]+):\s*(\[\[?)*([^\]]*)$/);
    if (fallbackMatch) {
        return resolveFrontmatterRelationCandidatesFromMatch(document, position, idIndex, line, textAfterCursor, fallbackMatch);
    }

    // No colon on this line at all — could be a bare YAML list entry (e.g.
    // "  - [[" under a "contacts:" field declared on a previous line). Walk
    // upward to find the parent field name so a new entry in an existing
    // relation list gets the same "Create <type> note" treatment a
    // single-line field already gets, instead of silently falling through
    // to the generic (untyped) wikilink completion path.
    const listItemMatch = before.match(/^\s*-\s*(\[\[?)*([^\]]*)$/);
    if (listItemMatch) {
        const parentField = resolveYamlFieldNameForLine(document.getText().split('\n'), position.line);
        if (parentField) {
            const syntheticMatch = [listItemMatch[0], parentField, listItemMatch[1], listItemMatch[2]];
            return resolveFrontmatterRelationCandidatesFromMatch(document, position, idIndex, line, textAfterCursor, syntheticMatch);
        }
    }
    return null;
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

/** @param {DocumentLike} document @param {import('vscode').Position} position @returns {Record<string,any>|null} */
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

/**
 * @param {string} fieldName
 * @param {string|null} queryType
 * @param {string} [partial]
 * @returns {{ value: string, count: number }[]}
 */
function rankScalarValues(fieldName, queryType, partial = '') {
    const scalarValues = collectScalarValues(fieldName, queryType);
    if (!scalarValues.length) return [];

    const fieldsCache = getFieldsCache();
    const valueCounts = new Map();
    const normalizedType = String(queryType || '').trim().toLowerCase();
    const normalizedPartial = String(partial || '').trim().toLowerCase();

    for (const fields of fieldsCache.values()) {
        const noteType = String(fields?.type || '').trim().toLowerCase();
        if (normalizedType && noteType !== normalizedType) continue;
        const raw = String(fields?.[fieldName] ?? '').trim();
        if (!raw || /\[\[[^\]]+\]\]/.test(raw)) continue;
        valueCounts.set(raw, (valueCounts.get(raw) || 0) + 1);
    }

    return scalarValues
        .filter((value) => !normalizedPartial || value.toLowerCase().startsWith(normalizedPartial))
        .sort((a, b) => (valueCounts.get(b) || 0) - (valueCounts.get(a) || 0) || a.localeCompare(b))
        .map((value) => ({
            value,
            count: valueCounts.get(value) || 0
        }));
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
    const behavioralPreferred = new Set(canonicalizeCandidateIds(rankingHints?.behavioralPreferredIds || []).map((id) => String(id || '').trim().toLowerCase()));
    const candidateTypeScores = rankingHints?.candidateTypeScores instanceof Map ? rankingHints.candidateTypeScores : new Map();
    const siblingContextIds = rankingHints?.siblingContextIds instanceof Set ? rankingHints.siblingContextIds : new Set();
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
            const behavioralBias = behavioralPreferred.has(canonicalId) ? 180 : 0;
            // Structural autocomplete — sibling-field context: this candidate is
            // already connected to a value the current note has filled in on a
            // DIFFERENT relation field (e.g. this note's account: already links
            // to a target this candidate also links to). Weighted between the
            // observed-usage and preferred-type bonuses — real correlation
            // evidence, but not as strong as an exact schema type match.
            const siblingContextBias = siblingContextIds.has(canonicalId) ? 260 : 0;
            return {
                id,
                score: matchScore >= 0
                    ? matchScore
                        + (preferred.has(canonicalId) ? 1000 : 0)
                        + (local.has(canonicalId) ? 150 : 0)
                        + observedBias
                        + behavioralBias
                        + typeBias
                        + siblingContextBias
                        + Math.min(500, observedIdScores.get(canonicalId) || observedIdScores.get(id) || 0)
                    : matchScore,
                preferred: preferred.has(canonicalId),
                local: local.has(canonicalId),
                siblingContext: siblingContextIds.has(canonicalId)
            };
        })
        .filter(entry => entry.score >= 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .map(entry => entry.id);
}

module.exports = {
    getHumanLabel,
    buildRelationCandidateDetail,
    buildRelationCandidateEvidence,
    collectLocalLinkedIds,
    collectObservedRelationUsage,
    computeSiblingContextIds,
    resolveFrontmatterRelationCandidates,
    resolveFrontmatterRelationCandidatesFromMatch,
    resolveQueryRelationCandidates,
    getViewBlockContext,
    collectFieldsForType,
    inferRelationField,
    collectScalarValues,
    rankScalarValues,
    scoreCandidateMatch,
    scoreFieldSuggestion,
    rankCandidateIds,
    canonicalizeCandidateIds
};
