'use strict';

const INTERNAL_FIELDS = new Set(['__yamlink_tags']);

/** @param {string} a @param {string} b @returns {number} */
function levenshtein(a, b) {
    const left = String(a ?? '');
    const right = String(b ?? '');
    const dp = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
    for (let i = 0; i <= left.length; i++) dp[i][0] = i;
    for (let j = 0; j <= right.length; j++) dp[0][j] = j;
    for (let i = 1; i <= left.length; i++) {
        for (let j = 1; j <= right.length; j++) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }
    return dp[left.length][right.length];
}

function rankClosest(candidate, candidates) {
    const normalized = String(candidate || '').trim().toLowerCase();
    if (!normalized || !Array.isArray(candidates) || candidates.length === 0) return null;
    const ranked = candidates
        .filter(Boolean)
        .map(function (item) {
            return {
                candidate: String(item).trim().toLowerCase(),
                distance: levenshtein(normalized, item)
            };
        })
        .filter(function (item) { return item.candidate; })
        .sort(function (a, b) {
            return a.distance - b.distance || a.candidate.localeCompare(b.candidate);
        });
    if (!ranked.length) return null;
    return ranked[0].distance <= 3 ? ranked[0].candidate : null;
}

function collectTypeCandidates(fieldCache) {
    return [...new Set(
        [...fieldCache.values()]
            .map(function (fields) { return String(fields.type || '').trim().toLowerCase(); })
            .filter(Boolean)
    )];
}

/**
 * @param {string} type
 * @param {Map<string, Record<string, any>>} fieldCache
 * @returns {string[]}
 */
function collectFieldCandidates(type, fieldCache) {
    if (type === 'tasks') return ['date', 'done', 'file', 'line', 'text'];

    const fieldSet = new Set();
    for (const fields of fieldCache.values()) {
        const nodeType = String(fields.type || '').trim().toLowerCase();
        if (type && type !== '*' && nodeType !== type) continue;
        for (const key of Object.keys(fields || {})) {
            const normalizedKey = String(key).trim().toLowerCase();
            if (normalizedKey !== 'id' && !INTERNAL_FIELDS.has(normalizedKey)) fieldSet.add(normalizedKey);
        }
    }
    return [...fieldSet].sort();
}

function valueLooksLikeRelation(value, knownIds) {
    if (value == null) return false;
    if (Array.isArray(value)) {
        return value.some(function (item) { return valueLooksLikeRelation(item, knownIds); });
    }
    const normalized = String(value)
        .trim()
        .replace(/^\[\[/, '')
        .replace(/\]\]$/, '')
        .toLowerCase();
    return Boolean(normalized) && knownIds.has(normalized);
}

/**
 * @param {string} type
 * @param {Map<string, Record<string, any>>} fieldCache
 * @returns {string[]}
 */
function collectRelationFieldCandidates(type, fieldCache) {
    if (!fieldCache || typeof fieldCache.values !== 'function') return [];

    const knownIds = new Set(
        [...fieldCache.entries()]
            .map(function ([id]) { return String(id || '').trim().toLowerCase(); })
            .filter(Boolean)
    );

    const fieldSet = new Set();
    for (const fields of fieldCache.values()) {
        const nodeType = String(fields.type || '').trim().toLowerCase();
        if (type && type !== '*' && nodeType !== type) continue;
        for (const [key, value] of Object.entries(fields || {})) {
            const normalizedKey = String(key || '').trim().toLowerCase();
            if (!normalizedKey || normalizedKey === 'id' || normalizedKey === 'type' || INTERNAL_FIELDS.has(normalizedKey)) continue;
            if (valueLooksLikeRelation(value, knownIds)) fieldSet.add(normalizedKey);
        }
    }
    return [...fieldSet].sort();
}

/** @param {string} type @param {Map<string, Record<string, any>>} fieldCache @returns {string|null} */
function closestTypeMatch(type, fieldCache) {
    return rankClosest(type, collectTypeCandidates(fieldCache));
}

/** @param {string} field @param {string} type @param {Map<string, Record<string, any>>} fieldCache @returns {string|null} */
function closestFieldMatch(field, type, fieldCache) {
    return rankClosest(field, collectFieldCandidates(type, fieldCache));
}

function describeTypeScope(type, incoming) {
    if (type === 'tasks') return 'task rows';
    if (!type || type === '*') return incoming ? 'linked notes' : 'notes';
    return incoming ? `${type} notes` : `${type} notes`;
}

/**
 * @param {Record<string, any>} query
 * @param {Array<Record<string, any>>} rows
 * @param {string[]} warnings
 * @param {Map<string, string>} index
 * @param {Map<string, Record<string, any>>} fieldCache
 * @returns {void}
 */
function addQueryWarnings(query, rows, warnings, index, fieldCache) {
    if (rows.length > 0) return;

    if (index.size === 0) {
        warnings.push('No indexed nodes found. Add id: fields to your Markdown files and save them to index.');
        return;
    }

    const wheres = query.wheres && query.wheres.length > 0 ? query.wheres : (query.where ? [query.where] : []);
    const fieldCandidates = collectFieldCandidates(query.type, fieldCache);
    const relationCandidates = collectRelationFieldCandidates(query.type, fieldCache);
    const hasType = query.type === '*' || query.type === 'tasks'
        || [...fieldCache.values()].some(function (fields) {
            return String(fields.type || '').trim().toLowerCase() === query.type;
        });

    if (query.type !== '*' && query.type !== 'tasks' && !hasType) {
        const suggestion = closestTypeMatch(query.type, fieldCache);
        if (suggestion && suggestion !== query.type) {
            warnings.push(`No nodes matched type "${query.type}". Did you mean "${suggestion}"?`);
        } else {
            warnings.push(`No nodes matched type "${query.type}". Check the type-like field your vault uses for those notes.`);
        }
        return;
    }

    if (query.sort?.field) {
        const sortSuggestion = closestFieldMatch(query.sort.field, query.type, fieldCache);
        if (!fieldCandidates.includes(query.sort.field) && sortSuggestion) {
            warnings.push(`Sort field "${query.sort.field}" is uncommon here. Try "${sortSuggestion}" instead.`);
        }
    }

    if (query.incoming && query.via) {
        const viaSuggestion = rankClosest(query.via, relationCandidates);
        if (!relationCandidates.includes(query.via) && viaSuggestion) {
            warnings.push(`Relation field "${query.via}" is uncommon here. Try "${viaSuggestion}" instead.`);
        }
    }

    for (const cond of wheres) {
        if (cond.op !== 'eq' && cond.op !== 'contains') continue;
        if (cond.field === 'id' && !index.has(cond.value)) {
            warnings.push(`No indexed node with id "${cond.value}". Save that note first or check the id.`);
            continue;
        }
        if (cond.field === 'body' || cond.field === 'any' || cond.field === 'id') continue;
        if (!fieldCandidates.includes(cond.field)) {
            const suggestion = closestFieldMatch(cond.field, query.type, fieldCache);
            if (suggestion && suggestion !== cond.field) {
                warnings.push(`Field "${cond.field}" is uncommon for ${describeTypeScope(query.type, query.incoming)}. Try "${suggestion}" instead.`);
            } else {
                warnings.push(`Field "${cond.field}" is uncommon for ${describeTypeScope(query.type, query.incoming)}. Try a field your similar notes already use.`);
            }
        }
    }

    if (query.incoming) {
        if (query.via && query.type !== '*') {
            warnings.push(`No ${query.type} notes link here through "${query.via}" yet. Try a broader incoming view or a different relation field.`);
        } else if (query.via) {
            warnings.push(`No notes link here through "${query.via}" yet. Try broadening the relation field or removing the via filter.`);
        } else if (query.type !== '*') {
            warnings.push(`No ${query.type} notes link here yet. Try opening a broader backlink view first.`);
        } else {
            warnings.push('No notes link here yet. Try a broader related-thread view or add one of the likely links Yamlink suggests.');
        }
        return;
    }

    if (wheres.length > 0) {
        const filterFields = wheres
            .map(function (cond) { return cond.field; })
            .filter(Boolean)
            .join(', ');
        warnings.push(`No ${describeTypeScope(query.type, query.incoming)} matched those filters. Try loosening ${filterFields || 'the query'} or start from one of Yamlink's smart view starters.`);
        return;
    }

    warnings.push(`No ${describeTypeScope(query.type, query.incoming)} matched yet. Try a broader starter view or add one of the fields Yamlink is suggesting for notes like this.`);
}

module.exports = {
    addQueryWarnings,
    closestFieldMatch,
    closestTypeMatch,
    collectFieldCandidates,
    collectRelationFieldCandidates
};
