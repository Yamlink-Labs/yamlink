const DEFAULT_INFERENCE_CONFIDENCE = 0.6;
const DEFAULT_STATUS_LIKE_VALUES = new Set([
    'open', 'closed', 'active', 'inactive', 'todo', 'done', 'pending', 'blocked',
    'won', 'lost', 'draft', 'published', 'paused', 'archived', 'scheduled', 'complete',
    'in-progress', 'in_review', 'in-review', 'backlog', 'planned', 'cancelled', 'canceled'
]);

const DEFAULT_SEMANTIC_ROLE_PRIORS = {
    date: ['date', 'created', 'updated', 'due', 'deadline', 'start', 'end', 'followup', 'close-date', 'review-date', 'ship-date', 'release-date'],
    status: ['status', 'stage', 'phase', 'state', 'priority', 'outcome', 'progress', 'health'],
    person: ['owner', 'owners', 'contact', 'contacts', 'participant', 'participants', 'assignee', 'assignees', 'author', 'reporter', 'reviewer', 'editor'],
    container: ['account', 'accounts', 'company', 'companies', 'client', 'clients', 'partner', 'partners', 'project', 'projects', 'repo', 'repos', 'workspace', 'team', 'unit'],
    topic: ['concept', 'concepts', 'topic', 'topics', 'product', 'products', 'component', 'components', 'feature', 'features', 'tag', 'tags', 'chapter', 'chapters', 'scene', 'scenes']
};

function normalizeFieldName(fieldName) {
    return String(fieldName || '')
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function getFieldNameVariants(fieldName) {
    const normalized = normalizeFieldName(fieldName);
    const variants = new Set([normalized]);
    const parts = normalized.split('-').filter(Boolean);
    for (const part of parts) variants.add(part);
    if (parts.length > 1) variants.add(parts.join(''));
    if (normalized.endsWith('_id')) variants.add(normalized.slice(0, -3));
    if (normalized.endsWith('-id')) variants.add(normalized.slice(0, -3));
    if (normalized.endsWith('ies')) variants.add(normalized.slice(0, -3) + 'y');
    if (normalized.endsWith('s')) variants.add(normalized.slice(0, -1));
    return [...variants].filter(Boolean);
}

function normalizeLinkTarget(value) {
    const inner = String(value || '').trim();
    const match = inner.match(/^\[\[([^\]]+)\]\]$/);
    if (!match) return null;
    const rawTarget = match[1].trim();
    const beforeAlias = rawTarget.split('|')[0]?.trim() ?? rawTarget;
    const beforeAnchor = beforeAlias.split('#')[0]?.trim() ?? beforeAlias;
    const beforeBlock = beforeAnchor.split('^')[0]?.trim() ?? beforeAnchor;
    return beforeBlock ? beforeBlock.toLowerCase() : null;
}

function extractLinkTargets(value) {
    const targets = new Set();
    const matches = String(value || '').matchAll(/\[\[([^\]]+)\]\]/g);
    for (const match of matches) {
        const target = normalizeLinkTarget(`[[${match[1]}]]`);
        if (target) targets.add(target);
    }
    return [...targets];
}

function inferTargetTypeFromFieldName(fieldName, knownTypes = []) {
    const types = Array.from(knownTypes).map(type => normalizeFieldName(type)).filter(Boolean);
    if (!types.length) return null;
    for (const variant of getFieldNameVariants(fieldName)) {
        if (types.includes(variant)) return variant;
    }
    return null;
}

function inferTargetTypeFromObservedValues(fieldName, observedFields = [], options = {}) {
    const normalizedField = normalizeFieldName(fieldName);
    const documentType = normalizeFieldName(options.documentType || '');
    const idToType = options.idToType || new Map();
    const typeCounts = new Map();
    let total = 0;

    for (const record of observedFields) {
        const recordType = normalizeFieldName(record?.type || '');
        const fields = record?.fields || {};
        const rawEntry = Object.entries(fields).find(([key]) => normalizeFieldName(key) === normalizedField);
        if (!rawEntry) continue;
        const raw = String(rawEntry[1] || '').trim();
        if (!raw) continue;
        const targets = extractLinkTargets(raw);
        if (!targets.length) continue;

        const sourceWeight = documentType && recordType === documentType ? 3 : 1;
        for (const targetId of targets) {
            const targetType = normalizeFieldName(idToType.get(targetId) || '');
            if (!targetType) continue;
            typeCounts.set(targetType, (typeCounts.get(targetType) || 0) + sourceWeight);
            total += sourceWeight;
        }
    }

    if (!total) return null;

    let bestType = null;
    let bestCount = 0;
    for (const [type, count] of typeCounts.entries()) {
        if (count > bestCount) {
            bestType = type;
            bestCount = count;
        }
    }

    if (!bestType) return null;
    const ratio = bestCount / total;
    if (ratio < 0.5) return null;
    return {
        targetType: bestType,
        confidence: Math.min(0.9, 0.68 + (ratio * 0.18)),
        ratio,
        total
    };
}

function collectFieldEvidence(fieldName, observedFields = [], options = {}) {
    const documentType = normalizeFieldName(options.documentType || '');
    const dateParser = options.dateParser || (() => null);
    const statusLikeValues = options.statusLikeValues || DEFAULT_STATUS_LIKE_VALUES;
    const normalizedField = normalizeFieldName(fieldName);
    const evidence = {
        samples: 0,
        wikilinkValues: 0,
        dateValues: 0,
        statusValues: 0,
        exampleValues: []
    };

    for (const record of observedFields) {
        const recordType = normalizeFieldName(record?.type || '');
        if (documentType && recordType && recordType !== documentType) continue;
        const fields = record?.fields || {};
        const directRaw = fields[fieldName] ?? fields[normalizedField];
        const normalizedMatch = directRaw != null
            ? directRaw
            : Object.entries(fields).find(([key]) => normalizeFieldName(key) === normalizedField)?.[1];
        const raw = String(normalizedMatch ?? '').trim();
        if (!raw) continue;
        evidence.samples++;
        if (evidence.exampleValues.length < 3) evidence.exampleValues.push(raw);
        if (extractLinkTargets(raw).length > 0) evidence.wikilinkValues++;
        if (dateParser(raw)) evidence.dateValues++;
        if (statusLikeValues.has(raw.toLowerCase())) evidence.statusValues++;
    }

    return evidence;
}

function inferSemanticRoleFromName(fieldName, semanticRolePriors = DEFAULT_SEMANTIC_ROLE_PRIORS) {
    const variants = getFieldNameVariants(fieldName);
    for (const [role, names] of Object.entries(semanticRolePriors)) {
        if (variants.some(variant => names.includes(variant))) {
            return { role, confidence: 0.62, reason: `field name resembles a ${role}-like role` };
        }
    }
    return null;
}

function inferTargetTypeFromGraph(fieldName, graphObservations = [], options = {}) {
    const inferenceConfidence = options.inferenceConfidence ?? DEFAULT_INFERENCE_CONFIDENCE;
    const documentType = normalizeFieldName(options.documentType || '');
    const typeCounts = new Map();
    let total = 0;

    for (const edge of graphObservations) {
        if (normalizeFieldName(edge?.field) !== normalizeFieldName(fieldName)) continue;
        const targetType = normalizeFieldName(edge?.targetType);
        if (!targetType) continue;
        const sourceType = normalizeFieldName(edge?.sourceType || '');
        const weight = documentType && sourceType === documentType ? 3 : 1;
        typeCounts.set(targetType, (typeCounts.get(targetType) ?? 0) + weight);
        total += weight;
    }

    if (total === 0) return null;

    let topType = null;
    let topCount = 0;
    for (const [type, count] of typeCounts.entries()) {
        if (count > topCount) {
            topType = type;
            topCount = count;
        }
    }
    return (topCount / total) >= inferenceConfidence ? topType : null;
}

function inferFieldRole(fieldName, options = {}) {
    const normalizedField = normalizeFieldName(fieldName);
    const reasons = [];
    const knownTypes = options.knownTypes || [];
    const schemaField = options.schemaField || null;

    let relational = false;
    let relationConfidence = 0;
    let targetType = null;
    let semanticRole = null;
    let semanticConfidence = 0;

    if (schemaField?.type === 'relation') {
        relational = true;
        relationConfidence = 1;
        targetType = schemaField.target ? normalizeFieldName(schemaField.target) : null;
        reasons.push(`schema marks "${normalizedField}" as a relation${targetType ? ` to ${targetType}` : ''}`);
    }

    const fieldNameTarget = inferTargetTypeFromFieldName(normalizedField, knownTypes);
    if (!targetType && fieldNameTarget) {
        relational = true;
        targetType = fieldNameTarget;
        relationConfidence = Math.max(relationConfidence, 0.72);
        reasons.push(`field name strongly resembles the "${fieldNameTarget}" type`);
    }

    const evidence = collectFieldEvidence(normalizedField, options.observedFields || [], {
        documentType: options.documentType,
        dateParser: options.dateParser,
        statusLikeValues: options.statusLikeValues
    });

    if (!relational && evidence.wikilinkValues > 0) {
        relational = true;
        relationConfidence = Math.max(relationConfidence, 0.7);
        reasons.push(`observed ${evidence.wikilinkValues} wikilink value${evidence.wikilinkValues === 1 ? '' : 's'} for "${normalizedField}"`);
    }

    const observedTarget = inferTargetTypeFromObservedValues(normalizedField, options.observedFields || [], {
        documentType: options.documentType,
        idToType: options.idToType
    });
    if (!targetType && observedTarget) {
        relational = true;
        targetType = observedTarget.targetType;
        relationConfidence = Math.max(relationConfidence, observedTarget.confidence);
        reasons.push(`vault usage often links "${normalizedField}" to ${observedTarget.targetType} notes`);
    }

    const graphTarget = inferTargetTypeFromGraph(normalizedField, options.graphObservations || [], {
        inferenceConfidence: options.inferenceConfidence,
        documentType: options.documentType
    });
    if (!targetType && graphTarget) {
        relational = true;
        targetType = graphTarget;
        relationConfidence = Math.max(relationConfidence, 0.78);
        reasons.push(`graph usage points "${normalizedField}" mostly at ${graphTarget} nodes`);
    }

    const nameSemantic = inferSemanticRoleFromName(normalizedField, options.semanticRolePriors);
    if (nameSemantic) {
        semanticRole = nameSemantic.role;
        semanticConfidence = Math.max(semanticConfidence, nameSemantic.confidence);
        reasons.push(nameSemantic.reason);
    }

    if (evidence.samples > 0) {
        if (evidence.dateValues > 0 && (evidence.dateValues / evidence.samples) >= 0.6) {
            semanticRole = 'date';
            semanticConfidence = Math.max(semanticConfidence, 0.84);
            reasons.push(`most observed values for "${normalizedField}" parse as dates`);
        } else if (evidence.statusValues > 0 && (evidence.statusValues / evidence.samples) >= 0.5) {
            semanticRole = 'status';
            semanticConfidence = Math.max(semanticConfidence, 0.75);
            reasons.push(`observed values for "${normalizedField}" look like workflow states`);
        }
    }

    if (relational && !semanticRole) {
        semanticRole = 'relation';
        semanticConfidence = Math.max(semanticConfidence, relationConfidence);
    }

    return {
        fieldName: normalizedField,
        relational,
        relationConfidence,
        targetType,
        semanticRole,
        semanticConfidence,
        evidence,
        reasons
    };
}

module.exports = {
    DEFAULT_INFERENCE_CONFIDENCE,
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS,
    normalizeFieldName,
    getFieldNameVariants,
    normalizeLinkTarget,
    extractLinkTargets,
    inferTargetTypeFromFieldName,
    inferTargetTypeFromObservedValues,
    collectFieldEvidence,
    inferSemanticRoleFromName,
    inferTargetTypeFromGraph,
    inferFieldRole
};
