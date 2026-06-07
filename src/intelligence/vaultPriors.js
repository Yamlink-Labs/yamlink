'use strict';

// Per-vault statistical priors — what the vault itself has learned.
//
// Everything here is derived from the actual notes in this vault.
// No global heuristics. No hardcoded type names. No hardcoded field lists.
// The vault teaches the system — the system does not assume.
//
// Ten things are computed:
//   1. fieldTargetTypes     — for relational fields, what note types do they link to?
//   2. typeFieldBundles     — for each note type, what fields commonly co-occur?
//   3. fieldAmbiguity       — per field, what fraction of values are wikilinks vs scalar?
//   4. noteRoleTypePriors   — for each inferred note role, which vault type dominates?
//   5. vaultMaturity        — 0–1 scalar driving adaptive confidence thresholds
//   6. implicitFieldWeights — mutation log history: fields used as wikilinks in the past
//   7. valuePatterns        — per field, what do values actually look like? (date, wikilink, short scalar)
//   8. workflowFields       — vault-detected status-like fields (finite scalar value sets)
//   9. typeRoleMap          — structural role inference per type (no hardcoded type names)
//  10. outcomeCalibration   — user feedback: which field relation suggestions were accepted

const { inferNoteRole } = require('./noteRolesCore');
const { buildImplicitFieldWeights } = require('./implicitWeights');
const { buildOutcomeCalibration } = require('./outcomeCalibration');

const WIKILINK_RE = /^\[\[([^\]|#]+)/;

// Injection point — set by the VS Code extension at activation so vaultPriors
// can access the mutation log without importing from src/runtime/ (which would
// break the pure-module boundary and the CLI/test harness).
let _getMutationEventsFn = null;

/**
 * Inject a function that returns the current mutation events array.
 * Called once from extension.js after initMutationLog().
 * In tests and CLI: left null → implicit weights are empty but everything else works.
 * @param {() => Array<{ type: string, field: string|null, newValue: * }>} fn
 * @returns {void}
 */
function setMutationEventsProvider(fn) {
    _getMutationEventsFn = typeof fn === 'function' ? fn : null;
}

/**
 * @typedef {{ dateCount: number, wikilinkCount: number, shortScalarCount: number, longScalarCount: number, distinctScalars: Set<string> }} ValuePattern
 */

/**
 * @typedef {{ role: string, confidence: number, inboundRatio: number, relCount: number, dateCount: number, workflowCount: number }} TypeRoleEntry
 */

/**
 * @typedef {{
 *   fieldTargetTypes: Map<string, Map<string, number>>,
 *   typeFieldBundles: Map<string, Map<string, number>>,
 *   fieldAmbiguity: Map<string, {linkCount: number, scalarCount: number, total: number, linkRatio: number}>,
 *   noteRoleTypePriors: Map<string, {dominantType: string, count: number}>,
 *   vaultMaturity: number,
 *   implicitFieldWeights: Map<string, {relationCount: number, total: number}>,
 *   valuePatterns: Map<string, ValuePattern>,
 *   workflowFields: Map<string, {values: string[], count: number}>,
 *   typeRoleMap: Map<string, TypeRoleEntry>,
 *   outcomeCalibration: import('./outcomeCalibration').OutcomeCalibration
 * }} VaultPriors
 */

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
    // No minimum observation floor — even 1 typed link is real evidence.
    // The classifier applies a confidence penalty for sparse samples.
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
/**
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {Map<string, Map<string, number>>}
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

/**
 * @param {Record<string, any>} noteFields
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {Map<string, Map<string, number>>} typeFieldBundles
 * @param {Map<string, {dominantType: string, count: number}>} noteRoleTypePriors
 * @param {{ noteRole?: string, confidence?: number }|null} [noteRole]
 * @param {{ limit?: number, minScore?: number }} [opts]
 * @returns {Array<{noteType: string, score: number, overlap: number, presence: number, matchedFields: string[], reasons: string[]}>}
 */
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

// ─── Value patterns ────────────────────────────────────────────────────────
// For every field in the vault, record what its values actually look like:
// dates, wikilinks, short scalars, long text. This is the foundation for
// detecting workflow fields and structural note roles without hardcoding
// any field names or type names.

const DATE_VALUE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * For every field in the vault, characterise its observed values.
 * No field names are inspected — only the VALUES themselves.
 *
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {Map<string, ValuePattern>}
 */
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

// ─── Workflow field detection ───────────────────────────────────────────────
// A field is "workflow-like" when it has 2–15 distinct short scalar values and
// is not dominated by wikilinks or dates. No hardcoded value list needed —
// the vault's own recurring values ARE the vocabulary.

/**
 * Detect workflow (status-like) fields from observed value patterns.
 * A field qualifies when it has a finite set of short repeating scalar values.
 *
 * @param {Map<string, ValuePattern>} valuePatterns
 * @returns {Map<string, {values: string[], count: number}>}
 */
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

// ─── Structural type-role inference ────────────────────────────────────────
// Infer the semantic role of each note type (person, container, event, task…)
// purely from the structural patterns of its field bundle — no hardcoded type
// names, no hardcoded field name lists. Only topology matters:
//
//   - How many inbound links does this type receive?
//   - How many of its common fields are relational? date-like? workflow-like?
//
// The rules use relative thresholds, not absolute ones, so they work on any
// domain vocabulary — CRM, research, fiction, medieval history, all the same.

/**
 * Infer the semantic role of each vault type from field-bundle structure.
 *
 * @param {Map<string, Map<string, number>>} typeFieldBundles
 * @param {Map<string, ValuePattern>} valuePatterns
 * @param {Map<string, Map<string, number>>} fieldTargetTypes
 * @param {Map<string, {linkCount: number, scalarCount: number, total: number, linkRatio: number}>} fieldAmbiguity
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {Map<string, TypeRoleEntry>}
 */
function buildTypeRoleMap(typeFieldBundles, valuePatterns, fieldTargetTypes, fieldAmbiguity, fieldsCache) {
    // Count notes per type and inbound link count per type
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
        if (totalNotes < 2) continue; // need at least 2 notes to make a structural call

        let relCount = 0, dateCount = 0, workflowCount = 0;

        for (const [fn, count] of bundle) {
            if (count / totalNotes < 0.25) continue; // only fields that appear in ≥25% of notes

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
            // Classify by dominant value type — no field names consulted
            const dateRatio = vp.dateCount / total;
            const wikiRatio = vp.wikilinkCount / total;
            const scalarRatio = vp.shortScalarCount / total;
            if (wikiRatio >= 0.40) relCount++;
            else if (dateRatio >= 0.50) dateCount++;
            else if (scalarRatio >= 0.60 && vp.distinctScalars.size >= 2 && vp.distinctScalars.size <= 15) workflowCount++;
        }

        const inbound = inboundByType.get(noteType) || 0;
        const inboundRatio = totalNotes > 0 ? inbound / totalNotes : 0;

        // Structural role decision tree — topology-only, no type names
        let role = null;
        if (inboundRatio >= 3.0 && totalNotes >= 2) {
            role = 'container';                              // heavily referenced = hub
        } else if (workflowCount >= 1 && dateCount >= 1 && relCount >= 1) {
            role = 'task';                                   // status + date + assignment
        } else if (dateCount >= 1 && relCount >= 1 && inboundRatio < 2.0) {
            role = 'event';                                  // date + participants, not a hub
        } else if (relCount >= 2 && inboundRatio < 2.0) {
            role = 'person';                                 // has relationships, not a hub
        } else if (relCount >= 1 && inboundRatio < 0.8) {
            role = 'person';                                 // weak person signal
        } else if (workflowCount >= 1 && relCount >= 1) {
            role = 'project';                                // has workflow + relations
        } else if (inboundRatio >= 1.0) {
            role = 'container';                              // moderate hub
        }

        if (role) {
            const confidence = Math.min(0.88, 0.55 + (totalNotes - 2) * 0.03);
            typeRoleMap.set(noteType, { role, confidence, inboundRatio, relCount, dateCount, workflowCount });
        }
    }

    return typeRoleMap;
}

/**
 * How "mature" a vault is — 0 (brand new) to 1 (well-established).
 *
 * Drives adaptive threshold scaling in fieldPlanner: new vaults get lower bars
 * so the system feels intelligent from the very first note with a wikilink.
 *
 * Formula: blend of note count (log scale, saturates at ~50 notes) and the
 * fraction of notes that have at least one wikilink-valued field.
 *
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {number}  0–1
 */
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
    const countScore = Math.min(1, Math.log(noteCount + 1) / Math.log(51)); // ~50 notes → 1.0
    const linkDensity = withLinks / noteCount;
    return countScore * 0.6 + linkDensity * 0.4;
}

// Generation-keyed cache — rebuilt once per vault mutation, not once per call.
let _cachedGeneration = -1;
let _cachedPriors = null;

/** @returns {void} */
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
/**
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {number} generation
 * @returns {VaultPriors}
 */
function getCachedPriors(fieldsCache, generation) {
    if (generation !== _cachedGeneration || !_cachedPriors) {
        const mutationEvents = _getMutationEventsFn ? _getMutationEventsFn() : [];
        const fieldTargetTypes  = buildFieldTargetTypes(fieldsCache);
        const typeFieldBundles  = buildTypeFieldBundles(fieldsCache);
        const fieldAmbiguity    = buildFieldAmbiguity(fieldsCache);
        const valuePatterns     = buildValuePatterns(fieldsCache);
        _cachedPriors = {
            fieldTargetTypes,
            typeFieldBundles,
            fieldAmbiguity,
            noteRoleTypePriors:   buildNoteRoleTypePriors(fieldsCache),
            vaultMaturity:        getVaultMaturity(fieldsCache),
            implicitFieldWeights: buildImplicitFieldWeights(mutationEvents),
            valuePatterns,
            workflowFields:       buildWorkflowFields(valuePatterns),
            typeRoleMap:          buildTypeRoleMap(typeFieldBundles, valuePatterns, fieldTargetTypes, fieldAmbiguity, fieldsCache),
            outcomeCalibration:   buildOutcomeCalibration(mutationEvents)
        };
        _cachedGeneration = generation;
    }
    return _cachedPriors;
}

// ─── Vault-derived semantic values ─────────────────────────────────────────
// These replace the hardcoded DEFAULT_STATUS_LIKE_VALUES and
// DEFAULT_SEMANTIC_ROLE_PRIORS in fieldRolesCore.js. No static lists.
// The vault's own observed values and field patterns teach the system.

/**
 * Build a Set of status-like values learned from this vault's workflow fields.
 * Replaces DEFAULT_STATUS_LIKE_VALUES — the vault's actual vocabulary, not a global list.
 *
 * @param {Map<string, {values: string[], count: number}>} workflowFields
 * @returns {Set<string>}
 */
function buildVaultStatusValues(workflowFields) {
    const values = new Set();
    for (const { values: vals } of (workflowFields || new Map()).values()) {
        for (const v of vals) values.add(v.toLowerCase());
    }
    return values;
}

/**
 * Build a semantic role priors map from vault evidence.
 * Replaces DEFAULT_SEMANTIC_ROLE_PRIORS — derived from observed value patterns and
 * inferred type roles, not hardcoded field name lists.
 *
 * Returns { date: string[], status: string[], person: string[], container: string[], topic: string[] }
 * — field names that this vault uses for each semantic role.
 *
 * @param {{ valuePatterns?: Map<string,any>, workflowFields?: Map<string,any>, fieldTargetTypes?: Map<string,any>, typeRoleMap?: Map<string,any> }} priors
 * @returns {Record<string, string[]>}
 */
function buildVaultSemanticRolePriors({ valuePatterns, workflowFields, fieldTargetTypes, typeRoleMap } = {}) {
    const result = { date: [], status: [], person: [], container: [], topic: [] };

    // date: fields whose values are predominantly ISO dates
    for (const [fn, vp] of (valuePatterns || new Map())) {
        const total = vp.dateCount + vp.wikilinkCount + vp.shortScalarCount + vp.longScalarCount;
        if (total >= 2 && vp.dateCount / total >= 0.50) result.date.push(fn);
    }

    // status: vault-detected workflow fields (finite scalar value sets)
    for (const [fn] of (workflowFields || new Map())) {
        result.status.push(fn);
    }

    // person / container / topic — from field → target type → target role
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

module.exports = {
    buildFieldTargetTypes,
    getDominantTargetType,
    buildTypeFieldBundles,
    getCommonFieldsForType,
    buildFieldAmbiguity,
    buildNoteRoleTypePriors,
    inferLikelyTypesForNote,
    getCachedPriors,
    resetVaultPriorsCache,
    getVaultMaturity,
    setMutationEventsProvider,
    buildValuePatterns,
    buildWorkflowFields,
    buildTypeRoleMap,
    buildVaultStatusValues,
    buildVaultSemanticRolePriors
};
