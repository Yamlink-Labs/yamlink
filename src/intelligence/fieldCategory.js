'use strict';

// Field category classifier — the single routing layer for all action decisions.
//
// Every frontmatter field falls into one of seven categories. Category determines
// what actions (completion, lightbulb, note creation) are legal for that field.
// The system derives category from three sources, in priority order:
//   1. schema  — explicit field type in a schema note (authoritative)
//   2. usage   — observed vault ratio of wikilink-shaped values (learned)
//   3. prior   — name pattern matching (fallback heuristic)
//
// Nothing downstream should hardcode field names. Route through classifyField().

const {
    getDominantTargetType,
    getCommonFieldsForType
} = require('./vaultPriors');

const CATEGORY = Object.freeze({
    IDENTITY:    'IDENTITY',    // id, uid — validation only
    STRUCTURAL:  'STRUCTURAL',  // type, kind — type-list only
    DATE:        'DATE',        // date, due — date shortcuts only
    WORKFLOW:    'WORKFLOW',    // status, stage — enum values only
    RELATION:    'RELATION',    // links to other notes — full relation UX
    DESCRIPTIVE: 'DESCRIPTIVE', // name, title, summary — scalar, quiet
    UNKNOWN:     'UNKNOWN'      // insufficient signal — silence
});

const RELATION_STRENGTH = Object.freeze({
    WEAK: 'relationWeak',
    LIKELY: 'relationLikely',
    CERTAIN: 'relationCertain'
});

// What actions each category permits
const ACTION_PERMISSIONS = Object.freeze({
    IDENTITY:    { relationCompletion: false, fieldSetup: false,  documentSetup: false, createNote: false },
    STRUCTURAL:  { relationCompletion: false, fieldSetup: false,  documentSetup: false, createNote: false },
    DATE:        { relationCompletion: false, fieldSetup: false,  documentSetup: false, createNote: false },
    WORKFLOW:    { relationCompletion: false, fieldSetup: false,  documentSetup: false, createNote: false },
    RELATION:    { relationCompletion: true,  fieldSetup: true,   documentSetup: true,  createNote: true  },
    DESCRIPTIVE: { relationCompletion: false, fieldSetup: false,  documentSetup: true,  createNote: false },
    UNKNOWN:     { relationCompletion: false, fieldSetup: false,  documentSetup: true,  createNote: false }
});

// Minimum confidence required per action type
const ACTION_THRESHOLDS = Object.freeze({
    relationCompletion: 0.45,
    fieldSetup:         0.60,
    documentSetup:      0.72,
    createNote:         0.55
});

// Hard name patterns — conclusive regardless of observed usage
const RE_IDENTITY    = /^(id|uid|uuid|identifier|key|slug|ref|code)(-id|-key|-ref|-slug|-code)?$/;
const RE_STRUCTURAL  = /^(type|kind|category|class|genre|format|mode)$/;
const RE_DATE        = /^(date|created|updated|modified|due|deadline|start|end|ship|release|followup|follow-up|review|close|scheduled|published)(-date|-at|-on|-by|-time)?$/;
const RE_WORKFLOW    = /^(status|stage|phase|state|priority|severity|outcome|progress|health|result|disposition)$/;
const RE_DESCRIPTIVE = /^(name|title|label|subject|summary|notes|note|description|overview|details|bio|about|content|caption|heading|subtitle)$/;

function normalizeFieldName(name) {
    return String(name || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getTargetMixInfo(fieldName, fieldTargetTypes) {
    const tm = fieldTargetTypes?.get(normalizeFieldName(fieldName));
    if (!tm || tm.size <= 1) return null;
    const entries = Array.from(tm.entries()).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    if (!total) return null;
    const [, secondCount] = entries[1];
    return {
        total,
        typeCount: entries.length,
        secondRatio: secondCount / total
    };
}

function relationStrengthFor(confidence, source) {
    if (source === 'schema' || confidence >= 0.88) return RELATION_STRENGTH.CERTAIN;
    if (confidence >= 0.58) return RELATION_STRENGTH.LIKELY;
    return RELATION_STRENGTH.WEAK;
}

function _relationResult(confidence, source, reasons, extras = {}) {
    return {
        category: CATEGORY.RELATION,
        confidence,
        source,
        reasons,
        relationStrength: relationStrengthFor(confidence, source),
        ...extras
    };
}

function _nonRelationResult(category, confidence, source, reasons, extras = {}) {
    return {
        category,
        confidence,
        source,
        reasons,
        relationStrength: null,
        ...extras
    };
}

function _eligibleSiblingSignal(fieldName, siblingField, options = {}) {
    const { fieldTargetTypes, fieldAmbiguity, noteType, typeFieldBundles, fieldsCache } = options;
    const siblingNorm = normalizeFieldName(siblingField);
    if (!siblingNorm || siblingNorm === normalizeFieldName(fieldName)) return false;
    if (RE_IDENTITY.test(siblingNorm) || RE_STRUCTURAL.test(siblingNorm) || RE_DATE.test(siblingNorm) || RE_WORKFLOW.test(siblingNorm)) return false;
    if (fieldTargetTypes?.has(siblingNorm)) return true;
    if ((fieldAmbiguity?.get(siblingNorm)?.linkRatio || 0) >= 0.5) return true;
    if (noteType && typeFieldBundles && fieldsCache) {
        const common = getCommonFieldsForType(noteType, typeFieldBundles, fieldsCache, { limit: 12, minRatio: 0.35 });
        return common.some((entry) => normalizeFieldName(entry.field) === siblingNorm);
    }
    return false;
}

// Count how many nearby/co-occurring relational sibling fields in the current note
// already have wikilink values. This is narrower than "the whole note has many links":
// it focuses on local frontmatter neighborhoods and fields the vault already treats as
// relation-like.
function _sameNoteContextSignal(fieldName, noteFields, options = {}) {
    const norm = normalizeFieldName(fieldName);
    const entries = Object.entries(noteFields || {});
    const currentIndex = entries.findIndex(([key]) => normalizeFieldName(key) === norm);
    const neighborhood = currentIndex >= 0
        ? entries.filter((_, index) => index !== currentIndex && Math.abs(index - currentIndex) <= 2)
        : entries.filter(([key]) => normalizeFieldName(key) !== norm);
    let weightedLinks = 0;
    let weightedEligible = 0;
    const siblingReasons = [];

    for (const [key, value] of neighborhood) {
        const kn = normalizeFieldName(key);
        if (!value || !_eligibleSiblingSignal(fieldName, kn, options)) continue;
        const vals = Array.isArray(value) ? value : [value];
        const hasLink = vals.some(v => String(v || '').trim().startsWith('[['));
        const sameTargetFamily =
            Boolean(options.fieldTargetTypes?.has(norm))
            && Boolean(options.fieldTargetTypes?.has(kn))
            && getDominantTargetType(norm, options.fieldTargetTypes)?.targetType
            && getDominantTargetType(norm, options.fieldTargetTypes)?.targetType === getDominantTargetType(kn, options.fieldTargetTypes)?.targetType;
        const weight = sameTargetFamily ? 1.15 : 1.0;
        weightedEligible += weight;
        if (hasLink) {
            weightedLinks += weight;
            siblingReasons.push(kn);
        }
    }
    if (weightedEligible < 2 || weightedLinks < 1) return { confidence: 0, reasons: [] };
    const ratio = weightedLinks / weightedEligible;
    if (ratio < 0.50) return { confidence: 0, reasons: [] };
    return {
        confidence: clamp(0.23 + ratio * 0.20, 0, 0.40),
        reasons: siblingReasons.length
            ? [`nearby/co-occurring fields (${siblingReasons.slice(0, 3).join(', ')}) are already relational in this note`]
            : []
    };
}

// Compute wikilink ratio for a field across the vault — minimum 3 observations
function _observedRelationStats(fieldName, fieldsCache) {
    const norm = normalizeFieldName(fieldName);
    let total = 0;
    let links = 0;
    for (const fields of fieldsCache.values()) {
        // try both original name and normalized form
        const raw = fields[fieldName] ?? fields[norm];
        if (raw === undefined || raw === null) continue;
        const values = Array.isArray(raw) ? raw : [raw];
        for (const v of values) {
            const s = String(v || '').trim();
            if (!s) continue;
            total++;
            if (s.startsWith('[[')) links++;
        }
    }
    if (total < 3) return null; // insufficient data
    return { ratio: links / total, total, links };
}

/**
 * Classify a single frontmatter field.
 *
 * @param {string} fieldName
 * @param {object} options
 * @param {object|null} options.schemaFieldDef      - schema field definition {type, required, ...}
 * @param {Map|null}    options.fieldsCache          - live vault fields cache
 * @param {object|null} options.noteFields           - current note's frontmatter (same-note context)
 * @param {string|null} options.noteType             - current note type, if known
 * @param {Map|null}    options.fieldTargetTypes     - vault prior target-type map
 * @param {Map|null}    options.typeFieldBundles     - vault prior field-bundle map
 * @param {Map|null}    options.fieldAmbiguity       - vault prior link/scalar ambiguity map
 * @param {Map|null}    options.bodyWikilinkCounts   - wikilink ID → mention count from note body prose
 * @param {{noteRole:string,confidence:number}|null} options.noteRole - inferred note role
 * @param {Map|null}    options.noteRoleTypePriors   - vault prior role → dominant vault type map
 * @returns {{ category: string, confidence: number, source: string, reasons: string[], relationStrength: string|null }}
 */
function classifyField(fieldName, options = {}) {
    const {
        schemaFieldDef,
        fieldsCache,
        noteFields,
        noteType,
        fieldTargetTypes,
        typeFieldBundles,
        fieldAmbiguity,
        bodyWikilinkCounts,
        noteRole,
        noteRoleTypePriors
    } = options;
    const norm = normalizeFieldName(fieldName);

    // 1. Schema is authoritative
    if (schemaFieldDef) {
        const st = String(schemaFieldDef.type || '').trim().toLowerCase();
        if (st === 'relation')                    return _relationResult(1.0, 'schema', [`schema declares type: relation`]);
        if (st === 'date')                        return _nonRelationResult(CATEGORY.DATE, 1.0, 'schema', [`schema declares type: date`]);
        if (st === 'status' || st === 'workflow') return _nonRelationResult(CATEGORY.WORKFLOW, 1.0, 'schema', [`schema declares type: ${st}`]);
        if (st === 'identity')                    return _nonRelationResult(CATEGORY.IDENTITY, 1.0, 'schema', [`schema declares type: identity`]);
        if (st === 'text' || st === 'string' || st === 'scalar') {
            return _nonRelationResult(CATEGORY.DESCRIPTIVE, 1.0, 'schema', [`schema declares type: ${st}`]);
        }
    }

    // 2. Hard name patterns
    if (RE_IDENTITY.test(norm))   return _nonRelationResult(CATEGORY.IDENTITY, 0.95, 'prior', [`"${norm}" matches identity name pattern`]);
    if (RE_STRUCTURAL.test(norm)) return _nonRelationResult(CATEGORY.STRUCTURAL, 0.95, 'prior', [`"${norm}" matches structural name pattern`]);
    if (RE_DATE.test(norm))       return _nonRelationResult(CATEGORY.DATE, 0.90, 'prior', [`"${norm}" matches date name pattern`]);
    if (RE_WORKFLOW.test(norm))   return _nonRelationResult(CATEGORY.WORKFLOW, 0.90, 'prior', [`"${norm}" matches workflow name pattern`]);

    // 3. Vault priors — adapt ambiguous fields to how this vault actually uses them.
    // This is still evidence, not a hard filter: it raises or lowers confidence, and
    // keeps broad completion intact while making the likely path more defensible.
    if (fieldsCache && fieldsCache.size && fieldTargetTypes) {
        const dominantTarget = getDominantTargetType(norm, fieldTargetTypes);
        if (dominantTarget) {
            let confidence = 0.18 + (dominantTarget.ratio * 0.52);
            const reasons = [
                `"${norm}" usually links to ${dominantTarget.targetType} notes in this vault (${dominantTarget.count}/${dominantTarget.total})`
            ];
            if (dominantTarget.total >= 8) {
                confidence += 0.05;
                reasons.push(`field has ${dominantTarget.total} observed link targets in this vault`);
            } else if (dominantTarget.total <= 4) {
                confidence -= 0.12;
                reasons.push(`small sample: only ${dominantTarget.total} observed link targets so far`);
            } else if (dominantTarget.total <= 6) {
                confidence -= 0.06;
                reasons.push(`moderate sample: ${dominantTarget.total} observed link targets keeps this cautious`);
            }

            const ambiguity = fieldAmbiguity?.get(norm) || null;
            if (ambiguity && ambiguity.total >= 3) {
                const linkPct = Math.round(ambiguity.linkRatio * 100);
                if (ambiguity.linkRatio >= 0.75) {
                    confidence += 0.05;
                    reasons.push(`${linkPct}% of observed "${norm}" values are wikilinks across the vault`);
                } else if (ambiguity.linkRatio <= 0.35) {
                    confidence -= 0.18;
                    reasons.push(`only ${linkPct}% of observed "${norm}" values are wikilinks, so keep this quieter`);
                } else if (ambiguity.linkRatio <= 0.55) {
                    confidence -= 0.06;
                    reasons.push(`"${norm}" is mixed between links and scalar values in this vault`);
                }
            }

            // Type-bundle lookup — use explicit noteType when present, else fall back to the
            // vault type that most commonly carries the inferred note role.
            if (typeFieldBundles) {
                const roleProxy = (!noteType && noteRole?.confidence >= 0.70)
                    ? (noteRoleTypePriors?.get(noteRole.noteRole)?.dominantType || null)
                    : null;
                const effectiveType = noteType || roleProxy;
                if (effectiveType) {
                    const commonFields = getCommonFieldsForType(effectiveType, typeFieldBundles, fieldsCache, { limit: 12, minRatio: 0.35 });
                    const common = commonFields.find((entry) => normalizeFieldName(entry.field) === norm);
                    if (common) {
                        confidence += 0.05;
                        if (noteType) {
                            reasons.push(`"${norm}" commonly appears on ${noteType} notes in this vault`);
                        } else {
                            reasons.push(`"${norm}" commonly appears on ${effectiveType} notes — matches this note's inferred role (${noteRole.noteRole})`);
                        }
                    }
                }
            }

            // Body evidence — body prose mentions of IDs whose type matches the dominant
            // target type corroborate the vault prior. Capped boost: this is supporting
            // evidence, not a primary signal.
            if (bodyWikilinkCounts?.size && fieldsCache.size) {
                let bodyMatchTotal = 0;
                for (const [id, count] of bodyWikilinkCounts) {
                    if (normalizeFieldName(fieldsCache.get(id)?.type) === dominantTarget.targetType) {
                        bodyMatchTotal += count;
                    }
                }
                if (bodyMatchTotal >= 2) {
                    confidence += Math.min(0.07, bodyMatchTotal * 0.025);
                    reasons.push(`body mentions ${bodyMatchTotal}× links to "${dominantTarget.targetType}" notes — corroborates`);
                }
            }

            const targetMix = getTargetMixInfo(norm, fieldTargetTypes);
            if (targetMix) {
                if (targetMix.secondRatio >= 0.30) {
                    confidence -= 0.10;
                    reasons.push(`"${norm}" splits across ${targetMix.typeCount} target types in this vault, so keep this quieter`);
                } else if (targetMix.secondRatio >= 0.18) {
                    confidence -= 0.05;
                    reasons.push(`"${norm}" has a secondary target type pattern, so keep this somewhat cautious`);
                }
            }

            confidence = clamp(confidence, 0, 0.92);
            if (confidence >= 0.46) {
                return _relationResult(confidence, 'usage', reasons, {
                    sampleSize: dominantTarget.total,
                    targetDiversity: targetMix?.typeCount || 1
                });
            }
        }
    }

    // 4. Observed usage — vault says this field is relational
    if (fieldsCache && fieldsCache.size) {
        const observed = _observedRelationStats(fieldName, fieldsCache);
        if (observed !== null) {
            const { ratio, total } = observed;
            const pct = Math.round(ratio * 100);
            const samplePenalty = total <= 4 ? 0.12 : total <= 6 ? 0.06 : 0;
            if (ratio >= 0.70) return {
                ..._relationResult(clamp((0.60 + ratio * 0.35) - samplePenalty, 0, 0.92), 'usage', [
                    `${pct}% of vault values for "${norm}" are wikilinks (strong signal)`,
                    ...(samplePenalty ? [`small sample: only ${total} observations keeps this cautious`] : [])
                ], {
                    sampleSize: total
                })
            };
            if (ratio >= 0.35) return {
                ..._relationResult(clamp(ratio - samplePenalty, 0, 0.82), 'usage', [
                    `${pct}% of vault values for "${norm}" are wikilinks (ambiguous)`,
                    ...(samplePenalty ? [`small sample: only ${total} observations keeps this cautious`] : [])
                ], {
                    sampleSize: total
                })
            };
            // 20-34% — vault evidence conflicts with name pattern; check same-note context before
            // committing to UNKNOWN, since a strongly relational note can break the tie.
            if (ratio >= 0.20) {
                if (noteFields) {
                    const context = _sameNoteContextSignal(fieldName, noteFields, { fieldTargetTypes, fieldAmbiguity, noteType, typeFieldBundles, fieldsCache });
                    if (context.confidence > 0) {
                        return _relationResult(context.confidence, 'context', [
                            ...context.reasons,
                            `${pct}% vault wikilink ratio alone was ambiguous; context broke the tie`
                        ], {
                            sampleSize: total
                        });
                    }
                }
                return _nonRelationResult(CATEGORY.UNKNOWN, ratio * 0.60, 'usage', [
                    `${pct}% wikilink ratio for "${norm}" is ambiguous — not enough signal to classify`,
                    ...(total <= 6 ? [`small sample: only ${total} observations prevents a stronger call`] : [])
                ], {
                    sampleSize: total
                });
            }
            if (ratio < 0.20 && RE_DESCRIPTIVE.test(norm)) {
                return _nonRelationResult(CATEGORY.DESCRIPTIVE, 0.65, 'usage', [`"${norm}" matches descriptive pattern; only ${pct}% wikilink ratio confirms scalar`], {
                    sampleSize: total
                });
            }
        }
    }

    // 5. Descriptive name pattern — label fields, not links
    if (RE_DESCRIPTIVE.test(norm)) return _nonRelationResult(CATEGORY.DESCRIPTIVE, 0.70, 'prior', [`"${norm}" matches descriptive name pattern`]);

    // 6. Same-note context — other fields in this note are relational, so this one probably is too
    if (noteFields) {
        const context = _sameNoteContextSignal(fieldName, noteFields, { fieldTargetTypes, fieldAmbiguity, noteType, typeFieldBundles, fieldsCache });
        if (context.confidence > 0) {
            return _relationResult(context.confidence, 'context', context.reasons.length ? context.reasons : [`nearby fields suggest "${norm}" is relational in this note`]);
        }
    }

    // 7. No signal
    return _nonRelationResult(CATEGORY.UNKNOWN, 0.0, 'default', [`no schema, usage, or pattern signal for "${norm}"`]);
}

/**
 * Whether a category permits a given action type.
 * @param {string} category  - one of CATEGORY.*
 * @param {string} actionType - 'relationCompletion'|'fieldSetup'|'documentSetup'|'createNote'
 */
function canPerformAction(category, actionType) {
    const perms = ACTION_PERMISSIONS[category] || ACTION_PERMISSIONS[CATEGORY.UNKNOWN];
    return Boolean(perms[actionType]);
}

/**
 * Minimum confidence required to trigger an action type.
 * @param {string} actionType
 */
function getActionThreshold(actionType) {
    return ACTION_THRESHOLDS[actionType] ?? 0.60;
}

module.exports = {
    CATEGORY,
    RELATION_STRENGTH,
    ACTION_PERMISSIONS,
    ACTION_THRESHOLDS,
    classifyField,
    canPerformAction,
    getActionThreshold
};
