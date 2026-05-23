'use strict';

// Per-vault statistical priors — what the vault itself has learned.
//
// These are not global heuristics. They are computed from the actual notes
// in this vault, so they adapt to the user's domain and naming conventions.
//
// Four things are computed:
//   1. fieldTargetTypes    — for relational fields, what note types do they link to?
//   2. typeFieldBundles    — for each note type, what fields commonly co-occur?
//   3. fieldAmbiguity      — per field, what fraction of values are wikilinks vs scalar?
//   4. noteRoleTypePriors  — for each inferred note role, which vault type dominates?
//
// These feed into:
//   - completion ranking  (prefer candidates of the expected target type)
//   - field suggestions   (suggest fields common for this note type)
//   - classifier support  (disambiguate borderline UNKNOWN fields with vault evidence)

const { inferNoteRole } = require('./noteRolesCore');

const WIKILINK_RE = /^\[\[([^\]|#]+)/;

function _norm(s) { return String(s || '').trim().toLowerCase(); }

/**
 * For each field that contains wikilinks in this vault, count how many times
 * each target note type is linked. Minimum 3 observations to report a field.
 *
 * @param {Map} fieldsCache  — nodeId → { field: value, ... }
 * @returns {Map<string, Map<string, number>>}  fieldName → (targetType → count)
 */
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
    // Prune fields with fewer than 3 total link observations
    for (const [fn, tm] of result) {
        const total = Array.from(tm.values()).reduce((s, n) => s + n, 0);
        if (total < 3) result.delete(fn);
    }
    return result;
}

/**
 * Return the dominant target type for a field, if one exists.
 *
 * @param {string} fieldName
 * @param {Map} fieldTargetTypes  — output of buildFieldTargetTypes
 * @returns {{ targetType: string, count: number, total: number, ratio: number } | null}
 */
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

/**
 * For each note type, count how often each field name appears across all notes
 * of that type. Used to suggest what fields are "normal" for this note type.
 *
 * @param {Map} fieldsCache
 * @returns {Map<string, Map<string, number>>}  noteType → (fieldName → count)
 */
function buildTypeFieldBundles(fieldsCache) {
    const result = new Map();
    // First pass: count notes per type so we can compute ratios
    const typeTotals = new Map();
    for (const [, fields] of fieldsCache) {
        const nt = _norm(fields?.type);
        if (!nt) continue;
        typeTotals.set(nt, (typeTotals.get(nt) || 0) + 1);
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
 * Return fields commonly found on notes of a given type, sorted by frequency.
 *
 * @param {string} noteType
 * @param {Map} typeFieldBundles   — output of buildTypeFieldBundles
 * @param {Map} fieldsCache        — to compute note count for this type
 * @param {object} [opts]
 * @param {number} [opts.limit=8]
 * @param {number} [opts.minRatio=0.30]  minimum fraction of notes that must have this field
 * @returns {Array<{ field: string, count: number, ratio: number }>}
 */
function getCommonFieldsForType(noteType, typeFieldBundles, fieldsCache, opts = {}) {
    const { limit = 8, minRatio = 0.30 } = opts;
    const nt = _norm(noteType);
    const bundle = typeFieldBundles.get(nt);
    if (!bundle || !bundle.size) return [];

    // Count total notes of this type
    let total = 0;
    for (const [, fields] of fieldsCache) {
        if (_norm(fields?.type) === nt) total++;
    }
    if (total === 0) return [];

    return Array.from(bundle.entries())
        .map(([field, count]) => ({ field, count, ratio: count / total }))
        .filter(e => e.ratio >= minRatio)
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

/**
 * For each field in the vault, compute scalar vs wikilink ratio.
 * Useful for detecting ambiguous fields ("is this field usually a link or a label?").
 *
 * @param {Map} fieldsCache
 * @returns {Map<string, { linkCount: number, scalarCount: number, total: number, linkRatio: number }>}
 */
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

/**
 * For each inferred note role (person, event, artifact, etc.), find the vault type
 * that most commonly carries that role. Used by the classifier as a fallback when
 * a note has no explicit `type:` field — the inferred role can locate a proxy type
 * for the field-bundle lookup.
 *
 * Only notes where role confidence >= 0.65 contribute.
 *
 * @param {Map} fieldsCache
 * @returns {Map<string, { dominantType: string, count: number }>}  role → dominant type info
 */
function buildNoteRoleTypePriors(fieldsCache) {
    const roleCounts = new Map(); // role → Map<type, count>
    for (const [, fields] of fieldsCache) {
        const noteType = _norm(fields?.type);
        if (!noteType) continue;
        const roleResult = inferNoteRole(fields || {}, {});
        if (!roleResult.noteRole || roleResult.confidence < 0.65) continue;
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

// Generation-keyed cache — rebuilt once per vault mutation, not once per call.
let _cachedGeneration = -1;
let _cachedPriors = null;

function resetVaultPriorsCache() {
    _cachedGeneration = -1;
    _cachedPriors = null;
}

/**
 * Return all four prior maps for the current vault, computing them only when
 * the vault generation has changed since the last call.
 *
 * @param {Map} fieldsCache
 * @param {number} generation  — value from getVaultGeneration()
 * @returns {{ fieldTargetTypes: Map, typeFieldBundles: Map, fieldAmbiguity: Map, noteRoleTypePriors: Map }}
 */
function getCachedPriors(fieldsCache, generation) {
    if (generation !== _cachedGeneration || !_cachedPriors) {
        _cachedPriors = {
            fieldTargetTypes:   buildFieldTargetTypes(fieldsCache),
            typeFieldBundles:   buildTypeFieldBundles(fieldsCache),
            fieldAmbiguity:     buildFieldAmbiguity(fieldsCache),
            noteRoleTypePriors: buildNoteRoleTypePriors(fieldsCache)
        };
        _cachedGeneration = generation;
    }
    return _cachedPriors;
}

module.exports = {
    buildFieldTargetTypes,
    getDominantTargetType,
    buildTypeFieldBundles,
    getCommonFieldsForType,
    buildFieldAmbiguity,
    buildNoteRoleTypePriors,
    inferLikelyTypesForNote,
    getCachedPriors,
    resetVaultPriorsCache
};
