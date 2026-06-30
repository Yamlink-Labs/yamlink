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
const { getImplicitBoost } = require('./implicitWeights');
const { getFieldCalibrationBoost } = require('./outcomeCalibration');

/**
 * @typedef {{
 *   category: string,
 *   confidence: number,
 *   source: string,
 *   reasons: string[],
 *   relationStrength: string|null,
 *   targetType?: string|null,
 *   observedLinkRatio?: number,
 *   vaultMaturity?: number
 * }} ClassificationResult
 */

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
    if (weightedEligible < 1 || weightedLinks < 1) return { confidence: 0, reasons: [] };
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
    if (total === 0) return null;
    return { ratio: links / total, total, links };
}

/**
 * Classify a single frontmatter field.
 *
 * @param {string} fieldName
 * @param {{ schemaFieldDef?: object|null, fieldsCache?: Map<any,any>|null, noteFields?: object|null, noteType?: string|null, fieldTargetTypes?: Map<any,any>|null, typeFieldBundles?: Map<any,any>|null, fieldAmbiguity?: Map<any,any>|null, bodyWikilinkCounts?: Map<any,any>|null, noteRole?: {noteRole:string,confidence:number}|null, noteRoleTypePriors?: Map<any,any>|null }} [options]
 * @returns {{ category: string, confidence: number, source: string, reasons: string[], relationStrength: string|null }}
 */
/**
 * @param {string} fieldName
 * @param {{
 *   schemaFieldDef?: Record<string, any>|null,
 *   fieldsCache?: Map<string, Record<string, any>>,
 *   noteFields?: Record<string, any>|null,
 *   noteType?: string,
 *   fieldTargetTypes?: Map<string, any>,
 *   typeFieldBundles?: Map<string, any>,
 *   fieldAmbiguity?: Map<string, any>,
 *   bodyWikilinkCounts?: Map<string, number>,
 *   noteRole?: Record<string, any>|null,
 *   noteRoleTypePriors?: Map<string, any>,
 *   implicitFieldWeights?: Map<string, any>,
 *   behavioralRelationPriors?: {
 *     fieldTargetTypeScores?: Map<string, Map<string, number>>,
 *     noteTypeFieldTargetTypeScores?: Map<string, Map<string, Map<string, number>>>
 *   },
 *   workflowFields?: Map<string, any>,
 *   valuePatterns?: Map<string, any>,
 *   outcomeCalibration?: import('./outcomeCalibration').OutcomeCalibration,
 *   vaultMaturity?: number
 * }} [options]
 * @returns {ClassificationResult}
 */
function _doClassifyField(fieldName, options = {}) {
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
        noteRoleTypePriors,
        implicitFieldWeights,
        behavioralRelationPriors,
        workflowFields,
        valuePatterns,
        outcomeCalibration
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

    // 2. Hard patterns — ONLY Yamlink's own structural fields.
    // id and type are Yamlink metadata — their semantics are fixed by the system.
    // Everything else (date names, status names, descriptive names) CAN be used
    // differently per vault. Vault evidence must be allowed to override them.
    if (RE_IDENTITY.test(norm))   return _nonRelationResult(CATEGORY.IDENTITY, 0.95, 'prior', [`"${norm}" matches identity name pattern`]);
    if (RE_STRUCTURAL.test(norm)) return _nonRelationResult(CATEGORY.STRUCTURAL, 0.95, 'prior', [`"${norm}" matches structural name pattern`]);

    // 2.5. Direct value evidence — graph-topology-first.
    //
    // If the field currently contains a wikilink pointing to a typed note, that IS
    // a relational field. One observation is enough. We do not wait for 3 vault-wide
    // examples. The link topology is the evidence — not the field name.
    //
    // This fires before vault priors so a brand-new vault with a single typed link
    // still gets meaningful completion and lightbulb behaviour.
    if (noteFields && fieldsCache && fieldsCache.size) {
        const rawVal = noteFields[fieldName] ?? noteFields[norm];
        if (rawVal !== undefined && rawVal !== null) {
            const vals = Array.isArray(rawVal) ? rawVal : [rawVal];
            let typedLinkCount = 0;
            const targetTypeMap = new Map();
            for (const v of vals) {
                const s = String(v || '').trim();
                const m = s.match(/^\[\[([^\]|#^]+)/);
                if (!m) continue;
                const targetId = m[1].trim().toLowerCase();
                const targetType = String(fieldsCache.get(targetId)?.type || '').trim().toLowerCase();
                if (targetType) {
                    typedLinkCount++;
                    targetTypeMap.set(targetType, (targetTypeMap.get(targetType) || 0) + 1);
                }
            }
            if (typedLinkCount > 0) {
                let dominantType = null, dominantCount = 0;
                for (const [type, count] of targetTypeMap) {
                    if (count > dominantCount) { dominantType = type; dominantCount = count; }
                }
                // Confidence scales from 0.55 (1 typed link) up to 0.79 (5+ typed links).
                // Strong enough to trigger completion and hint-level lightbulb immediately,
                // even on a brand-new vault. Not strong enough to QUICKFIX without vault history.
                const confidence = clamp(0.55 + Math.min(typedLinkCount - 1, 4) * 0.06, 0, 0.82);
                return _relationResult(confidence, 'usage', [
                    typedLinkCount === 1
                        ? `current value links to a "${dominantType}" note — direct typed link`
                        : `${typedLinkCount} current values link to "${dominantType}" notes`
                ], { targetType: dominantType, observedLinkRatio: 1.0 });
            }
        }
    }

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

            const behavioralTargetScores = behavioralRelationPriors?.noteTypeFieldTargetTypeScores?.get(noteType || '')?.get(norm)
                || behavioralRelationPriors?.fieldTargetTypeScores?.get(norm)
                || null;
            if (behavioralTargetScores instanceof Map && behavioralTargetScores.size) {
                const behaviorTotal = Array.from(behavioralTargetScores.values()).reduce((sum, value) => sum + value, 0);
                if (behaviorTotal > 0) {
                    const behaviorScore = (behavioralTargetScores.get(dominantTarget.targetType) || 0) / behaviorTotal;
                    if (behaviorScore >= 0.45) {
                        confidence += Math.min(0.08, behaviorScore * 0.08);
                        reasons.push(
                            noteType
                                ? `recent ${noteType} modeling also links "${norm}" to ${dominantTarget.targetType} notes`
                                : `recent vault modeling also links "${norm}" to ${dominantTarget.targetType} notes`
                        );
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
            const samplePenalty = total === 1 ? 0.20 : total <= 3 ? 0.14 : total <= 6 ? 0.06 : 0;
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
            if (ratio < 0.20) {
                // Vault evidence says this field is almost entirely scalar.
                // Apply soft semantic patterns as a tiebreaker — vault usage
                // won if it reached here, so these are fallback classifications.
                if (workflowFields?.has(norm)) {
                    return _nonRelationResult(CATEGORY.WORKFLOW, 0.84, 'usage', [`"${norm}" observed as a workflow field in this vault (${workflowFields.get(norm).values.slice(0, 4).join(', ')})`], { sampleSize: total });
                }
                if (RE_DATE.test(norm))        return _nonRelationResult(CATEGORY.DATE, 0.78, 'prior', [`"${norm}" has low wikilink ratio and matches date name pattern`], { sampleSize: total });
                if (RE_WORKFLOW.test(norm))    return _nonRelationResult(CATEGORY.WORKFLOW, 0.78, 'prior', [`"${norm}" has low wikilink ratio and matches workflow name pattern`], { sampleSize: total });
                if (RE_DESCRIPTIVE.test(norm)) return _nonRelationResult(CATEGORY.DESCRIPTIVE, 0.65, 'usage', [`"${norm}" matches descriptive pattern; only ${pct}% wikilink ratio confirms scalar`], { sampleSize: total });
            }
        }
    }

    // 4.5. Implicit interaction history — sticky vault knowledge.
    //
    // The field has no current vault evidence (not in fieldTargetTypes, not
    // observed as a wikilink in fieldsCache right now). But the mutation log
    // shows this field was set to [[wikilinks]] in the past. The vault has
    // learned this field is relational — that knowledge doesn't reset just
    // because the user edited or cleared the values.
    //
    // This is the main value of Phase 2: fields the user actively treats as
    // relations stay relational even when current vault state gives no signal.
    if (implicitFieldWeights) {
        const { boost, reason } = getImplicitBoost(norm, implicitFieldWeights);
        if (boost > 0) {
            const confidence = clamp(0.38 + boost, 0, 0.75);
            return _relationResult(confidence, 'implicit', [reason]);
        }
    }

    if (behavioralRelationPriors) {
        const behaviorTargetScores = behavioralRelationPriors?.noteTypeFieldTargetTypeScores?.get(noteType || '')?.get(norm)
            || behavioralRelationPriors?.fieldTargetTypeScores?.get(norm)
            || null;
        if (behaviorTargetScores instanceof Map && behaviorTargetScores.size) {
            const sorted = Array.from(behaviorTargetScores.entries())
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
            const total = sorted.reduce((sum, [, value]) => sum + value, 0);
            const [targetType, topWeight] = sorted[0] || [];
            const ratio = total > 0 ? topWeight / total : 0;
            if (targetType && ratio >= 0.52) {
                const confidence = clamp(0.42 + ratio * 0.18, 0, 0.76);
                return _relationResult(confidence, 'behavior', [
                    noteType
                        ? `recent ${noteType} modeling repeatedly used "${norm}" as a relation to ${targetType} notes`
                        : `recent vault modeling repeatedly used "${norm}" as a relation to ${targetType} notes`
                ], { targetType });
            }
        }
    }

    // 4.7. Outcome calibration — user explicitly accepted our relation suggestion for this field.
    //
    // This is the strongest form of historical evidence: not just that the field was set to
    // a wikilink at some point, but that the SYSTEM predicted it and the USER confirmed it.
    // Sits above soft patterns but below implicit history because calibration data takes time
    // to accumulate — on day 1 it is zero and the system behaves exactly as before.
    if (outcomeCalibration) {
        const { boost, reason } = getFieldCalibrationBoost(norm, outcomeCalibration);
        if (boost > 0) {
            const confidence = clamp(0.42 + boost, 0, 0.80);
            return _relationResult(confidence, 'calibration', [reason]);
        }
    }

    // 5. Soft semantic patterns — only reach here when there is ZERO vault
    // usage data for this field. Vault evidence always wins above this step.
    // The vault's own learned patterns outrank name conventions.
    if (workflowFields?.has(norm)) {
        const wf = workflowFields.get(norm);
        return _nonRelationResult(CATEGORY.WORKFLOW, 0.84, 'usage', [`"${norm}" observed as a workflow field in this vault (${wf.values.slice(0, 4).join(', ')})`]);
    }
    // Date detection from value patterns — no field names inspected, only values
    const _vp = valuePatterns?.get(norm);
    if (_vp) {
        const _total = _vp.dateCount + _vp.wikilinkCount + _vp.shortScalarCount + _vp.longScalarCount;
        if (_total > 0 && (_vp.dateCount / _total) >= 0.50) {
            return _nonRelationResult(CATEGORY.DATE, 0.80, 'usage', [`"${norm}" values are predominantly dates in this vault`]);
        }
    }
    // Name-pattern fallbacks — only when vault evidence is absent
    if (RE_DATE.test(norm))        return _nonRelationResult(CATEGORY.DATE, 0.75, 'prior', [`"${norm}" matches date name pattern (no vault data yet)`]);
    if (RE_WORKFLOW.test(norm))    return _nonRelationResult(CATEGORY.WORKFLOW, 0.75, 'prior', [`"${norm}" matches workflow name pattern (no vault data yet)`]);
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
 * Public entry point — wraps _doClassifyField and stamps vaultMaturity onto the result.
 * Downstream consumers (fieldPlanner) read vaultMaturity from the classification object
 * so they can scale their thresholds without an extra parameter.
 *
 * @param {string} fieldName
 * @param {{
 *   schemaFieldDef?: Record<string, any>|null,
 *   fieldsCache?: Map<string, Record<string, any>>,
 *   noteFields?: Record<string, any>|null,
 *   noteType?: string,
 *   fieldTargetTypes?: Map<string, any>,
 *   typeFieldBundles?: Map<string, any>,
 *   fieldAmbiguity?: Map<string, any>,
 *   bodyWikilinkCounts?: Map<string, number>,
 *   noteRole?: Record<string, any>|null,
 *   noteRoleTypePriors?: Map<string, any>,
 *   implicitFieldWeights?: Map<string, {relationCount: number, total: number}>,
 *   behavioralRelationPriors?: {
 *     fieldTargetTypeScores?: Map<string, Map<string, number>>,
 *     noteTypeFieldTargetTypeScores?: Map<string, Map<string, Map<string, number>>>
 *   },
 *   workflowFields?: Map<string, {values: string[], count: number}>,
 *   valuePatterns?: Map<string, any>,
 *   outcomeCalibration?: import('./outcomeCalibration').OutcomeCalibration,
 *   vaultMaturity?: number
 * }} [options]
 * @returns {ClassificationResult}
 */
function classifyField(fieldName, options = {}) {
    const vaultMaturity = options.vaultMaturity ?? 1;
    const result = _doClassifyField(fieldName, options);
    return { ...result, vaultMaturity };
}

/**
 * Whether a category permits a given action type.
 * @param {string} category  - one of CATEGORY.*
 * @param {string} actionType - 'relationCompletion'|'fieldSetup'|'documentSetup'|'createNote'
 * @returns {boolean}
 */
function canPerformAction(category, actionType) {
    const perms = ACTION_PERMISSIONS[category] || ACTION_PERMISSIONS[CATEGORY.UNKNOWN];
    return Boolean(perms[actionType]);
}

/**
 * Minimum confidence required to trigger an action type.
 * @param {string} actionType
 * @returns {number}
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
