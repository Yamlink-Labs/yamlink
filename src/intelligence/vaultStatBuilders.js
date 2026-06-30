'use strict';

const { inferNoteRole } = require('./noteRolesCore');

const WIKILINK_RE = /^\[\[([^\]|#]+)/;
const DATE_VALUE_RE = /^\d{4}-\d{2}-\d{2}$/;

function _norm(s) { return String(s || '').trim().toLowerCase(); }

function buildFieldTargetTypes(fieldsCache) {
    const result = new Map();
    for (const [, fields] of fieldsCache) {
        for (const [fieldName, rawValue] of Object.entries(fields || {})) {
            const fn = _norm(fieldName);
            if (!fn || fn === 'id' || fn === 'type') continue;
            const values = Array.isArray(rawValue) ? rawValue : [rawValue];
            for (const v of values) {
                const m = WIKILINK_RE.exec(String(v || '').trim());
                if (!m) continue;
                const targetId = _norm(m[1]);
                const targetType = _norm(fieldsCache.get(targetId)?.type);
                if (!targetType) continue;
                if (!result.has(fn)) result.set(fn, new Map());
                const tm = result.get(fn);
                tm.set(targetType, (tm.get(targetType) || 0) + 1);
            }
        }
    }
    return result;
}

function getDominantTargetType(fieldName, fieldTargetTypes) {
    const tm = fieldTargetTypes.get(_norm(fieldName));
    if (!tm || !tm.size) return null;
    let top = null, topCount = 0, total = 0;
    for (const [type, count] of tm) {
        total += count;
        if (count > topCount) { topCount = count; top = type; }
    }
    if (!top) return null;
    return { targetType: top, count: topCount, total, ratio: topCount / total };
}

function buildTypeFieldBundles(fieldsCache) {
    const result = new Map();
    for (const [, fields] of fieldsCache) {
        const nt = _norm(fields?.type);
        if (!nt) continue;
        if (!result.has(nt)) result.set(nt, new Map());
        const bundle = result.get(nt);
        for (const fieldName of Object.keys(fields || {})) {
            const fn = _norm(fieldName);
            if (!fn || fn === 'id' || fn === 'type') continue;
            bundle.set(fn, (bundle.get(fn) || 0) + 1);
        }
    }
    return result;
}

/**
 * Count of notes per type — precomputed to avoid O(n) rescans inside consumers.
 * Stored in VaultPriors as typeBundleTotals.
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {Map<string, number>}
 */
function buildTypeBundleTotals(fieldsCache) {
    const totals = new Map();
    for (const [, fields] of fieldsCache) {
        const nt = _norm(fields?.type);
        if (!nt) continue;
        totals.set(nt, (totals.get(nt) || 0) + 1);
    }
    return totals;
}

// Fields are considered reliably evidenced once a type has this many notes.
// Below this threshold, adjustedRatio is scaled down proportionally.
const MIN_RELIABLE_SAMPLE = 8;

/**
 * @param {string} noteType
 * @param {Map<string, Map<string, number>>} typeFieldBundles
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {{ limit?: number, minRatio?: number }} [opts]
 * @param {Map<string, number>|null} [typeBundleTotals]
 * @returns {Array<{ field: string, count: number, ratio: number, adjustedRatio: number }>}
 */
function getCommonFieldsForType(noteType, typeFieldBundles, fieldsCache, opts = {}, typeBundleTotals = null) {
    const { limit = 8, minRatio = 0.30 } = opts;
    const nt = _norm(noteType);
    const bundle = typeFieldBundles.get(nt);
    if (!bundle || !bundle.size) return [];

    // Use precomputed total when available — avoids O(n) fieldsCache rescan
    let total;
    if (typeBundleTotals?.has(nt)) {
        total = typeBundleTotals.get(nt);
    } else {
        total = 0;
        for (const [, fields] of fieldsCache) {
            if (_norm(fields?.type) === nt) total++;
        }
    }
    if (total === 0) return [];

    // Sample-size weight: a 2-note vault saying density=1.0 is far weaker evidence
    // than a 20-note vault. adjustedRatio reflects this — it drives arc scoring and
    // ranking without gating suggestions (the filter still uses raw ratio).
    const sampleWeight = Math.min(1.0, total / MIN_RELIABLE_SAMPLE);

    return Array.from(bundle.entries())
        .map(([field, count]) => {
            const ratio = count / total;
            const adjustedRatio = ratio * sampleWeight;
            return { field, count, ratio, adjustedRatio };
        })
        .filter(e => e.ratio >= minRatio)
        .sort((a, b) => b.adjustedRatio - a.adjustedRatio || b.ratio - a.ratio || a.field.localeCompare(b.field))
        .slice(0, limit);
}

function buildFieldAmbiguity(fieldsCache) {
    const result = new Map();
    for (const [, fields] of fieldsCache) {
        for (const [fieldName, rawValue] of Object.entries(fields || {})) {
            const fn = _norm(fieldName);
            if (!fn || fn === 'id' || fn === 'type') continue;
            const values = Array.isArray(rawValue) ? rawValue : [rawValue];
            for (const v of values) {
                const s = String(v || '').trim();
                if (!s) continue;
                if (!result.has(fn)) result.set(fn, { linkCount: 0, scalarCount: 0, total: 0, linkRatio: 0 });
                const e = result.get(fn);
                e.total++;
                if (s.startsWith('[[')) e.linkCount++;
                else e.scalarCount++;
            }
        }
    }
    for (const e of result.values()) {
        e.linkRatio = e.total > 0 ? e.linkCount / e.total : 0;
    }
    return result;
}

function buildNoteRoleTypePriors(fieldsCache) {
    const roleCounts = new Map();
    for (const [, fields] of fieldsCache) {
        const noteType = _norm(fields?.type);
        if (!noteType) continue;
        const roleResult = inferNoteRole(fields || {}, {});
        if (!roleResult.noteRole || roleResult.confidence < 0.50) continue;
        if (!roleCounts.has(roleResult.noteRole)) roleCounts.set(roleResult.noteRole, new Map());
        const tc = roleCounts.get(roleResult.noteRole);
        tc.set(noteType, (tc.get(noteType) || 0) + 1);
    }
    const result = new Map();
    for (const [role, typeMap] of roleCounts) {
        let best = null, bestCount = 0;
        for (const [type, count] of typeMap) {
            if (count > bestCount) { best = type; bestCount = count; }
        }
        if (best) result.set(role, { dominantType: best, count: bestCount });
    }
    return result;
}

function inferLikelyTypesForNote(noteFields, fieldsCache, typeFieldBundles, noteRoleTypePriors, noteRole = null, opts = {}) {
    const { limit = 3, minScore = 0.45 } = opts;
    const currentFields = Object.entries(noteFields || {})
        .filter(([fieldName, rawValue]) => {
            const fn = _norm(fieldName);
            if (!fn || fn === 'id' || fn === 'type') return false;
            if (Array.isArray(rawValue)) return rawValue.some((value) => String(value || '').trim());
            return String(rawValue || '').trim().length > 0;
        })
        .map(([fieldName]) => _norm(fieldName));

    if (!currentFields.length) return [];

    const typeTotals = new Map();
    for (const [, fields] of fieldsCache || new Map()) {
        const nt = _norm(fields?.type);
        if (!nt) continue;
        typeTotals.set(nt, (typeTotals.get(nt) || 0) + 1);
    }

    const roleProxy = noteRole?.noteRole && noteRole?.confidence >= 0.65
        ? noteRoleTypePriors?.get(noteRole.noteRole) || null
        : null;

    return Array.from(typeFieldBundles.entries())
        .map(([noteType, bundle]) => {
            const totalNotes = typeTotals.get(noteType) || 0;
            if (!totalNotes || !bundle?.size) return null;

            let matchedCount = 0;
            let weightedPresence = 0;
            const matchedFields = [];
            for (const fieldName of currentFields) {
                const fieldCount = bundle.get(fieldName) || 0;
                if (!fieldCount) continue;
                matchedCount++;
                matchedFields.push(fieldName);
                weightedPresence += fieldCount / totalNotes;
            }
            if (!matchedCount) return null;

            const overlap = matchedCount / currentFields.length;
            const presence = weightedPresence / currentFields.length;
            let roleBoost = 0;
            if (roleProxy?.dominantType === noteType) {
                roleBoost = 0.18 + Math.min(0.08, ((roleProxy.count || 1) - 1) * 0.02);
            }

            const score = (overlap * 0.58) + (presence * 0.32) + roleBoost;
            return {
                noteType,
                score,
                overlap,
                presence,
                roleBoost,
                matchedFields,
                reasons: [
                    `${matchedCount}/${currentFields.length} current fields commonly appear on ${noteType} notes`,
                    roleBoost > 0 ? `note role "${noteRole.noteRole}" often maps to ${noteType} in this vault` : ''
                ].filter(Boolean)
            };
        })
        .filter((entry) => entry && entry.score >= minScore)
        .sort((a, b) => b.score - a.score || b.overlap - a.overlap || a.noteType.localeCompare(b.noteType))
        .slice(0, limit);
}

function buildValuePatterns(fieldsCache) {
    const patterns = new Map();
    for (const fields of fieldsCache.values()) {
        for (const [fn, rawVal] of Object.entries(fields || {})) {
            const norm = _norm(fn);
            if (!norm || norm === 'id' || norm === 'type') continue;
            const values = Array.isArray(rawVal) ? rawVal : [rawVal];
            if (!patterns.has(norm)) {
                patterns.set(norm, { dateCount: 0, wikilinkCount: 0, shortScalarCount: 0, longScalarCount: 0, distinctScalars: new Set() });
            }
            const p = patterns.get(norm);
            for (const v of values) {
                const s = String(v || '').trim();
                if (!s) continue;
                if (s.startsWith('[[')) { p.wikilinkCount++; continue; }
                if (DATE_VALUE_RE.test(s)) { p.dateCount++; continue; }
                if (s.length <= 30 && !s.includes('\n')) {
                    p.shortScalarCount++;
                    p.distinctScalars.add(s.toLowerCase());
                } else {
                    p.longScalarCount++;
                }
            }
        }
    }
    return patterns;
}

function buildWorkflowFields(valuePatterns) {
    const result = new Map();
    for (const [fn, p] of valuePatterns) {
        const total = p.wikilinkCount + p.shortScalarCount + p.longScalarCount + p.dateCount;
        if (total < 2) continue;
        const scalarRatio = p.shortScalarCount / total;
        const distinctCount = p.distinctScalars.size;
        if (scalarRatio >= 0.60 && distinctCount >= 2 && distinctCount <= 15 && p.wikilinkCount === 0 && p.dateCount === 0) {
            result.set(fn, { values: [...p.distinctScalars], count: p.shortScalarCount });
        }
    }
    return result;
}

function buildTypeRoleMap(typeFieldBundles, valuePatterns, fieldTargetTypes, fieldAmbiguity, fieldsCache) {
    const noteCountByType = new Map();
    for (const fields of fieldsCache.values()) {
        const t = _norm(fields?.type);
        if (!t) continue;
        noteCountByType.set(t, (noteCountByType.get(t) || 0) + 1);
    }

    const inboundByType = new Map();
    for (const [, typeMap] of fieldTargetTypes) {
        for (const [type, count] of typeMap) {
            inboundByType.set(type, (inboundByType.get(type) || 0) + count);
        }
    }

    const typeRoleMap = new Map();

    for (const [noteType, bundle] of typeFieldBundles) {
        const totalNotes = noteCountByType.get(noteType) || 0;
        if (totalNotes < 2) continue;

        let relCount = 0, dateCount = 0, workflowCount = 0;

        for (const [fn, count] of bundle) {
            if (count / totalNotes < 0.25) continue;

            const ambig = fieldAmbiguity?.get(fn);
            const vp = valuePatterns.get(fn);
            const isRelational = fieldTargetTypes.has(fn) || (ambig && ambig.linkRatio >= 0.40);

            if (isRelational) {
                relCount++;
                continue;
            }
            if (!vp) continue;
            const total = vp.wikilinkCount + vp.shortScalarCount + vp.longScalarCount + vp.dateCount;
            if (!total) continue;
            const dateRatio = vp.dateCount / total;
            const wikiRatio = vp.wikilinkCount / total;
            const scalarRatio = vp.shortScalarCount / total;
            if (wikiRatio >= 0.40) relCount++;
            else if (dateRatio >= 0.50) dateCount++;
            else if (scalarRatio >= 0.60 && vp.distinctScalars.size >= 2 && vp.distinctScalars.size <= 15) workflowCount++;
        }

        const inbound = inboundByType.get(noteType) || 0;
        const inboundRatio = totalNotes > 0 ? inbound / totalNotes : 0;

        let role = null;
        if (inboundRatio >= 3.0 && totalNotes >= 2) {
            role = 'container';
        } else if (workflowCount >= 1 && dateCount >= 1 && relCount >= 1) {
            role = 'task';
        } else if (dateCount >= 1 && relCount >= 1 && inboundRatio < 2.0) {
            role = 'event';
        } else if (relCount >= 2 && inboundRatio < 2.0) {
            role = 'person';
        } else if (relCount >= 1 && inboundRatio < 0.8) {
            role = 'person';
        } else if (workflowCount >= 1 && relCount >= 1) {
            role = 'project';
        } else if (inboundRatio >= 1.0) {
            role = 'container';
        }

        if (role) {
            const confidence = Math.min(0.88, 0.55 + (totalNotes - 2) * 0.03);
            typeRoleMap.set(noteType, { role, confidence, inboundRatio, relCount, dateCount, workflowCount });
        }
    }

    return typeRoleMap;
}

function getVaultMaturity(fieldsCache) {
    const noteCount = fieldsCache.size;
    if (noteCount === 0) return 0;
    let withLinks = 0;
    for (const fields of fieldsCache.values()) {
        let found = false;
        for (const [fn, v] of Object.entries(fields || {})) {
            if (found) break;
            if (fn === 'id' || fn === 'type') continue;
            const vals = Array.isArray(v) ? v : [v];
            if (vals.some(val => String(val || '').trim().startsWith('[['))) found = true;
        }
        if (found) withLinks++;
    }
    const countScore = Math.min(1, Math.log(noteCount + 1) / Math.log(51));
    const linkDensity = withLinks / noteCount;
    return countScore * 0.6 + linkDensity * 0.4;
}

function buildVaultStatusValues(workflowFields) {
    const values = new Set();
    for (const { values: vals } of (workflowFields || new Map()).values()) {
        for (const v of vals) values.add(v.toLowerCase());
    }
    return values;
}

/**
 * @param {{
 *   valuePatterns?: Map<string, any>,
 *   workflowFields?: Map<string, any>,
 *   fieldTargetTypes?: Map<string, Map<string, number>>,
 *   typeRoleMap?: Map<string, any>
 * }} [options]
 * @returns {{ date: string[], status: string[], person: string[], container: string[], topic: string[] }}
 */
function buildVaultSemanticRolePriors({ valuePatterns, workflowFields, fieldTargetTypes, typeRoleMap } = {}) {
    const result = { date: [], status: [], person: [], container: [], topic: [] };

    for (const [fn, vp] of (valuePatterns || new Map())) {
        const total = vp.dateCount + vp.wikilinkCount + vp.shortScalarCount + vp.longScalarCount;
        if (total >= 2 && vp.dateCount / total >= 0.50) result.date.push(fn);
    }

    for (const [fn] of (workflowFields || new Map())) {
        result.status.push(fn);
    }

    if (fieldTargetTypes && typeRoleMap) {
        for (const [fn, typeMap] of fieldTargetTypes) {
            let topType = null, topCount = 0, total = 0;
            for (const [type, count] of typeMap) {
                total += count;
                if (count > topCount) { topType = type; topCount = count; }
            }
            if (!topType || topCount / Math.max(1, total) < 0.50) continue;
            const role = typeRoleMap.get(topType)?.role;
            if (role === 'person' && !result.person.includes(fn)) result.person.push(fn);
            else if (role === 'container' && !result.container.includes(fn)) result.container.push(fn);
            else if ((role === 'concept' || role === 'artifact') && !result.topic.includes(fn)) result.topic.push(fn);
        }
    }

    return result;
}

function buildNoteRoleNamePriors(typeRoleMap, fieldsCache) {
    const countsByRole = new Map();
    const noteCountByType = new Map();

    for (const fields of (fieldsCache || new Map()).values()) {
        const noteType = _norm(fields?.type);
        if (!noteType) continue;
        noteCountByType.set(noteType, (noteCountByType.get(noteType) || 0) + 1);
    }

    for (const [noteType, entry] of (typeRoleMap || new Map()).entries()) {
        const role = entry?.role;
        if (!role) continue;
        const roleCounts = countsByRole.get(role) || new Map();
        roleCounts.set(noteType, (roleCounts.get(noteType) || 0) + Math.max(1, noteCountByType.get(noteType) || 0));
        countsByRole.set(role, roleCounts);
    }

    const result = {};
    for (const [role, counts] of countsByRole.entries()) {
        result[role] = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([noteType]) => noteType);
    }
    return result;
}

function buildNoteRoleFieldHints(typeFieldBundles, typeBundleTotals, typeRoleMap) {
    const scoresByRole = new Map();

    for (const [noteType, entry] of (typeRoleMap || new Map()).entries()) {
        const role = entry?.role;
        const bundle = typeFieldBundles?.get(noteType);
        const total = typeBundleTotals?.get(noteType) || 0;
        if (!role || !bundle?.size || total < 2) continue;

        const roleScores = scoresByRole.get(role) || new Map();
        for (const [fieldName, count] of bundle.entries()) {
            if (!fieldName || fieldName === 'id' || fieldName === 'type') continue;
            const ratio = count / Math.max(1, total);
            if (ratio < 0.30) continue;
            roleScores.set(fieldName, (roleScores.get(fieldName) || 0) + ratio);
        }
        scoresByRole.set(role, roleScores);
    }

    const result = {};
    for (const [role, scores] of scoresByRole.entries()) {
        result[role] = Array.from(scores.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([fieldName]) => fieldName);
    }
    return result;
}

module.exports = {
    buildFieldTargetTypes,
    getDominantTargetType,
    buildTypeFieldBundles,
    buildTypeBundleTotals,
    getCommonFieldsForType,
    buildFieldAmbiguity,
    buildNoteRoleTypePriors,
    inferLikelyTypesForNote,
    buildValuePatterns,
    buildWorkflowFields,
    buildTypeRoleMap,
    getVaultMaturity,
    buildVaultStatusValues,
    buildVaultSemanticRolePriors,
    buildNoteRoleNamePriors,
    buildNoteRoleFieldHints
};
